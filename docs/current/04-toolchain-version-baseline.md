# 工具链版本基线与超时配置说明

> 最后更新: 2026-05-31
> 版本: 0.3.0 (规划中)

---

## 工具链版本基线

| 组件 | 当前版本 | 状态 | 说明 |
|------|---------|------|------|
| miniprogram-automator | 0.12.1 (2023-11-07) | 已停更（约两年半，changelog 停在 0.12.0 / 2022-09） | 自动化能力仍可用，但不会有新特性 |
| 微信开发者工具 | v2.01.2510260 (2025-10) | 活跃迭代 | 推荐使用最新稳定版 |
| CLI auto 最低工具版本 | 1.05.2111232 | 最低要求 | 低于此版本不支持 auto 命令 |
| Node.js | >= 18.0.0 | 必需 | 运行时环境 |

---

## CLI 命令与路径

### 命令格式

```bash
cli auto --project <path> --auto-port <port> [--auto-account <openid>]
```

### CLI 路径

**macOS:**

```text
/Applications/wechatwebdevtools.app/Contents/MacOS/cli
```

**Windows:**

```text
<安装路径>/cli.bat
```

### 启用自动化

在开发者工具中：**设置 → 安全 → 开启 CLI/HTTP 调用**。

默认自动化端口：`9420`。

---

## 超时配置说明

### 配置项一览

| 配置项 | SessionConfig 字段 | 默认值 | 作用范围 |
|--------|-------------------|--------|---------|
| 全局操作超时 | `timeout` | 30s | 导航、wait 等通用操作 |
| JS 执行超时 | `evaluateTimeout` | 5s | evaluate / wx 调用 |
| 启动超时 | `launchTimeout` | 60s | miniprogram_launch |
| 连接超时 | `connectTimeout` | 30s | miniprogram_connect |
| 截图超时 | `screenshotTimeout` | 10s | 普通截图；fullPage 截图基础超时也基于此值 |

### 配置方式

#### 方式一：.mcp.json 配置文件（推荐）

在项目根目录创建 `.mcp.json`，写入超时字段（单位：毫秒）：

```json
{
  "projectPath": "/path/to/miniprogram",
  "cliPath": "/Applications/wechatwebdevtools.app/Contents/MacOS/cli",
  "port": 9420,
  "timeout": 30000,
  "evaluateTimeout": 5000,
  "launchTimeout": 60000,
  "connectTimeout": 30000,
  "screenshotTimeout": 10000,
  "capabilities": ["core", "assert", "snapshot", "record", "network"]
}
```

#### 方式二：CLI 参数

通过命令行参数传递项目路径和端口：

```bash
npx -y @creatoria/miniapp-mcp --project-path /path/to/miniprogram --port 9420
```

超时参数可通过配置文件设置。

#### 方式三：环境变量

已确认支持的环境变量：

```bash
export MCP_PROJECT_PATH=/path/to/miniprogram
export MCP_PORT=9420
export MCP_CAPABILITIES=core,assert,snapshot
```

超时相关配置可通过 `.mcp.json` 配置文件设置。

### 调优建议

- **网络慢 / 真机调试**：适当调大 `connectTimeout` 和 `launchTimeout`，避免连接阶段超时。
- **fullPage 截图慢**：fullPage 截图需要截取整个页面内容，耗时通常比普通截图更长，可调大 `screenshotTimeout`。
- **evaluate 执行慢**：如果小程序逻辑复杂，evaluate 可能需要更多时间，可调大 `evaluateTimeout`。

---

## 兼容性与影响

- `miniprogram-automator` SDK 已停更，但现有自动化功能仍然可用，不影响当前项目运行。
- 微信开发者工具处于活跃迭代中，新版本可能带来协议变化，需关注更新日志。
- CLI auto 命令要求开发者工具版本 >= 1.05.2111232，低于此版本需先升级。

---

## 相关文档

- [故障排查指南](../troubleshooting.md)
- [连接与截图超时诊断](./03-connect-screenshot-timeout-diagnosis.md)
- [微信小程序工具链版本调研](../../调研中/微信小程序工具链最新版本调研/README.md)
