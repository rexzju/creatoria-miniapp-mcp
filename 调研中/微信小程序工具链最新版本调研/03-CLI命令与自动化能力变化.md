# 03 · CLI 命令与自动化能力变化

> 调研日期：2026-05-31

## 1. CLI 自动化接口：稳定，无破坏性变化

`cli auto --project <path> --auto-port <port>` 这套接口自工具 **1.05.2111232**（2021）确立后保持稳定，到 2025 年的 v2.01.2510260 仍是同一形态。本项目 `launch.ts` 拼装的启动参数与官方一致：

```
cli --auto <projectPath> --auto-port <port>   ← 项目/SDK 内部实际用 "auto --project ... --auto-port ..."
```

> SDK 0.12.1 内部 spawn 的参数（已反编译确认）：
> `["auto", "--project", <path>, "--auto-port", <port>]`，可选追加 `--auto-account` / `--ticket` / `--trust-project`。
> 与官方 CLI 文档完全吻合。

## 2. 自动化连接协议：WebSocket，未变

- 工具开启自动化后，在 `--auto-port` 上启动 WebSocket 服务
- SDK `connect({wsEndpoint: 'ws://127.0.0.1:<port>'})` 或 `launch` 内部轮询连接
- 协议为基于自增 id 的 JSON-RPC 风格请求/响应（`Connection.send` 用 callback Map 管理）

**这套协议多年未变**，是工具版本前进而 SDK 不更新仍能工作的根本原因。

## 3. SDK 能力清单（0.12.1 提供，项目已覆盖）

| 层级 | 能力 |
|------|------|
| Automator | connect / launch（disconnect/close 为 SDK 之上的封装） |
| MiniProgram | navigateTo/redirectTo/reLaunch/switchTab/navigateBack、callWxMethod、evaluate、screenshot（含 fullPage）、pageStack、systemInfo、mockWxMethod/restoreWxMethod、currentPage、callPluginWxMethod 等 |
| Page | query/queryAll、data、waitFor、setData、size、scrollTop |
| Element | 属性、交互、各类组件专用方法 |

## 4. 已知能力缺口与限制（不会因升级解决，因 SDK 停更）

| 限制 | 影响 | 根因 |
|------|------|------|
| `Connection.create` 的 `new ws()` 无连接超时 | connect/launch 在端口通但无响应时永久挂起 | SDK 未在 ws 外包超时；ws@6 老版本 |
| 超时后底层请求不可取消 | `withTimeout` race 掉后 SDK callback 仍挂在 Map | SDK 未暴露 cancel API |
| `launch` 的 `timeout` 仅作 waitUntil 总预算 | ws 挂起场景下该预算失效（licia/waitUntil 需子 promise 返回才判超时） | 见项目 docs/current/03 诊断 |
| fullPage 截图慢 | 大页面拼接耗时（jimp 处理） | 实现本身耗时，非 bug |

> 这些缺口已在本项目 v0.2.3 修复方案中通过**外层 withTimeout/withRetry 兜底**绕过，不依赖 SDK 升级。
