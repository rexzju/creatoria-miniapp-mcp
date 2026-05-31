# 连接 / 截图超时问题诊断与优化方案

> 版本: 1.0.0
> 日期: 2026-05-31
> 状态: 🔍 诊断完成，待修复

## 0. 调研结论速览（TL;DR）

| 任务 | 结论 |
|------|------|
| **1. 代码是否需要更新以适配小程序 CLI** | ⚠️ 需要少量更新。SDK `miniprogram-automator@0.12.1` 是当前最新可用版本，CLI 路径/端口适配本身没问题，但 **launch 传入的 `timeout` 参数 SDK 内部根本没使用**，connect 的 `wsEndpoint` 在不传 port 时传了 `undefined` 会触发 SDK 异常路径。 |
| **2. 修复现有超时问题** | 🔴 必须修复。**根因是 `connect`/`launch` 两个 handler 完全没有超时/重试保护**，连接超时卡死的概率最高；截图虽已有保护，但 `withTimeout` 实现有「超时后底层 promise 不取消」的泄漏缺陷。 |

---

## 1. 问题现象

- 调用 `automator_connect` / `automator_launch` 经常卡住无响应，最终 MCP 调用超时
- 调用 `miniprogram_screenshot`（尤其 `fullPage`）偶发卡顿
- 卡死后后续工具调用全部被阻塞

---

## 2. 根因分析（基于 SDK 源码逐行确认）

### 2.1 🔴 P0：connect / launch 无任何超时保护（连接卡死的主因）

**位置**：
- `src/capabilities/automator/handlers/connect.ts:47`
- `src/capabilities/automator/handlers/launch.ts:58`

两个 handler 都是直接 `await automator.connect()/launch()`，**没有 `withTimeout` 也没有 `withRetry`**，与 screenshot/evaluate 的保护策略不一致。

#### SDK connect 内部行为（`node_modules/miniprogram-automator/out/Launcher.js` + `Connection.js`）

```
connect(opts) → connectTool(opts) → Connection.create(wsEndpoint) → new ws(endpoint)
```

`Connection.create` 仅 `new ws(e)` 并监听 `open`，**没有连接超时**。
当出现以下情况时，`new ws()` 会永久挂起、既不 resolve 也不 reject：
- 端口可达（TCP 层通），但 DevTools 未开启「CLI/HTTP 调用」
- DevTools 进程假死 / 自动化端口被占用但无响应
- 防火墙吞包（SYN 通、握手后无数据）

→ **这是「连接经常超时」的根因**：超时不是发生在我们这层，而是 SDK 的 WebSocket 永远不返回，MCP 层只能等到上游（MCP client）整体超时。

#### SDK launch 内部行为（已逐行核验 Launcher.js + licia/waitUntil.js）

```
launch() → spawn(cli) → waitUntil(condition, timeout=30s, interval=1s) → checkVersion() → sleep(5000) → 返回
```

condition 内部：`p(spawn error) || f(exit+15s 超时标志) || (d = await connectTool({wsEndpoint:'ws://127.0.0.1:'+port}))`

**关键缺陷（决定性）**：`licia/waitUntil` 的超时判断 `elapsed >= timeout` **只在 condition() 这个 Promise resolve 之后**才执行：

```js
evalCondition().then(function(val){
  var elapsed = now() - startTime
  if (val) resolve(val)
  else if (timeout && elapsed >= timeout) reject(...)  // ← 只有 condition 返回后才走到
  else setTimeout(pollCondition, interval)
}, reject)
```

而 condition 里 `await connectTool()` → `Connection.create()` → `new ws()`。**端口通但 DevTools 无响应时 `new ws()` 永不 resolve → condition() 永不返回 → 30s 超时判断永远执行不到 → launch 永久挂死。SDK 的 30s `timeout` 在最常见故障场景下完全失效。**

- `ILaunchOptions.timeout`（默认 `3e4`）**确实被用作 waitUntil 的总超时**（我初版误判为"未引用"，此处已纠正）；但因上面缺陷，它只在「CLI 进程起不来 / 端口轮询返回 false」时生效，对「ws 挂起」无效
- CLI 进程 `exit` 后再过 **15s** 才把 `f=!0` 置位（仅覆盖进程崩溃场景）
- 因此 **launch 与 connect 共享同一根因**：都死在 `Connection.create` 那个无超时的 `new ws()`

### 2.2 🟠 P1：`withTimeout` 超时后底层 promise 不取消（资源泄漏 + 误导性日志）

**位置**：`src/runtime/timeout/timeout.ts:20-44`

```typescript
const result = await Promise.race([promise, timeoutPromise])
```

`Promise.race` 在超时时只是让外层 race 出结果，**底层 SDK 调用仍在继续运行**。后果：
1. SDK `Connection` 内部用自增 `id` 累积 pending callback（`Connection.js:30,46`），超时后这些 callback 永不清理 → 内存泄漏
2. 截图重试时，上一次「超时」的截图请求其实还在跑，与重试请求并发，**加重 DevTools 负载**，让超时更易复现
3. `setTimeout` 定时器未 `unref()`，进程退出时可能被 timer 拖住

### 2.3 🟡 P2：connect 的 wsEndpoint 默认值缺陷

**位置**：`src/capabilities/automator/handlers/connect.ts:47-49`

```typescript
const miniProgram = await automator.connect({
  wsEndpoint: port ? `ws://localhost:${port}` : undefined,  // ← undefined
} as any)
```

`IConnectOptions.wsEndpoint` 是**必填 string**。传 `undefined` 时 SDK 走 `new ws(undefined)`，行为未定义（多数情况立刻抛错或挂起），错误信息也不友好。应在 handler 层兜底默认端口 9420。

### 2.4 🟡 P2：launch 未利用 connectTimeout 配置 + 缺少 connectTimeout 配置项

`SessionConfig` 有 `launchTimeout`/`screenshotTimeout`，但 **没有 `connectTimeout`**，且 launch handler 没有读取 `launchTimeout` 来做外层 race 兜底。

---

## 3. 修复方案

### 3.1 P0：给 connect / launch 加超时 + 重试保护

**connect.ts**：
- `wsEndpoint` 不传 port 时兜底为 `ws://127.0.0.1:9420`（与 SDK 默认端口一致，用 127.0.0.1 避免 localhost 解析到 IPv6 ::1 导致连不上）
- 用 `withTimeout` 包裹，默认 `connectTimeout = 30s`
- 用 `withRetry` 包裹，`maxRetries: 1`，`shouldRetry: onConnectionError`

**launch.ts**：
- 用 `withTimeout` 包裹，默认 `launchTimeout = 60s`（SDK 内部轮询 + sleep(5s) 较慢，给足余量）
- 不再依赖 SDK 失效的 `timeout` 参数，改由外层 race 兜底
- 超时时给出明确指引："请检查 DevTools 是否已打开、自动化端口是否开启"

### 3.2 P1：修复 withTimeout（unref + 可选 onTimeout 清理）

```typescript
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string
): Promise<T> {
  let timeoutId: NodeJS.Timeout
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    // 避免 timer 阻止进程退出
    if (typeof timeoutId.unref === 'function') timeoutId.unref()
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    clearTimeout(timeoutId!)
  }
}
```

> 注：底层 SDK promise 无法真正 abort（SDK 未暴露 cancel），但 `unref` + `finally clearTimeout` 已能消除 timer 泄漏。SDK pending callback 泄漏需 SDK 层支持，列为已知限制。

### 3.3 P2：新增 connectTimeout 配置项

- `types.ts` `SessionConfig` 增加 `connectTimeout?: number`
- `config/defaults.ts` 增加默认值 30000
- `config/loader.ts` 支持 `MCP_CONNECT_TIMEOUT` 环境变量
- `timeout.ts` `DEFAULT_TIMEOUTS.connect` 已存在（30000），复用

---

## 4. 任务 1（适配 CLI）结论详述

`miniprogram-automator@0.12.1` 已是该包目前可用最新版本，对接的是微信开发者工具 CLI（`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`），CLI 接口长期稳定，**不需要为「适配新版 CLI」做大改**。需要做的「代码更新」仅限：

1. launch 应显式传 `timeout`（= launchTimeout），SDK 确实会用它做轮询总超时；但因 SDK ws 挂起缺陷，仍需外层 race 兜底
2. connect `wsEndpoint` 兜底默认端口（见 3.3），并改用 `127.0.0.1` 与 SDK launch 内部一致（避免 localhost → IPv6 ::1）
3. 在 handler 层补齐超时/重试（见 3.1），这才是 CLI 交互不稳定时的真正防护

---

## 5. 验证计划

- 单元测试：connect/launch handler 在底层 promise 永不 resolve 时，能在 `connectTimeout/launchTimeout` 内抛出明确错误（用 fake miniProgram + 永挂 promise）
- 单元测试：`withTimeout` 超时后 timer 被清理（无 open handle）
- 回归：`pnpm test:unit` 全绿、`pnpm typecheck` 通过
- 集成（需真机 DevTools）：故意不开自动化端口，确认 connect 在 30s 内失败而非永久挂起
