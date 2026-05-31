# 02 · 微信开发者工具与 CLI 最新版本

> 调研日期：2026-05-31
> 数据来源：微信开放文档下载页、开放社区公告

## 1. 开发者工具版本现状（与 SDK 形成鲜明对比）

| 维度 | 事实 |
|------|------|
| 最新稳定版（Stable） | **v2.01.2510260**（2025-10 发布） |
| 更高的开发版/Nightly | 存在更新的开发版（如 2.01.25102xx 系列） |
| 发布节奏 | **活跃更新中**，稳定版/预发布版/开发版三轨并行 |
| 版本号格式 | `主.次.日期` 形式（如 2.01.2510260 = 2025-10-26 构建） |
| 平台支持 | macOS / Windows；1.06 起停止支持 Windows 7 |
| 官方下载页 | developers.weixin.qq.com/miniprogram/dev/devtools/download.html |
| Nightly 下载 | developers.weixin.qq.com/miniprogram/dev/devtools/nightly.html |

**核心对比**：开发者工具 2025 年仍在月度迭代（v2.x），而驱动它的自动化 SDK 停在 2023 年的 0.12.1。**工具在前进，SDK 在原地**——但二者通过稳定的 CLI + WebSocket 协议解耦，所以兼容性目前未破裂（见文件 04）。

## 2. CLI 路径与定位

| 平台 | CLI 路径 |
|------|---------|
| macOS | `/Applications/wechatwebdevtools.app/Contents/MacOS/cli` |
| Windows | `<安装路径>/cli.bat`（如 `C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat`） |

> 本项目 `launch.ts` 的 `DEFAULT_CLI_PATH` 与 macOS 路径完全一致，无需更新。

## 3. CLI 自动化命令（官方文档确认）

### 开启自动化（项目核心依赖）
```bash
cli auto --project <项目路径> --auto-port <端口> [--auto-account <openid>]
```
- `--project`：项目路径
- `--auto-port <port>`：自动化监听端口（WebSocket）
- `--auto-account <openid>`：可选，指定测试用 openid
- 最低可用工具版本：**1.05.2111232**

### 自动化回放窗口
```bash
cli auto-replay --project <项目路径> [--replay-all]
```

### 其他常用命令
`cli preview` / `cli upload` / `cli build-npm` / `cli open` / `cli cache`，均支持 `-h`。

## 4. 自动化端口开启方式

两条路径，二选一：
1. **CLI 直接拉起**（项目 launch 用的方式）：`cli auto --auto-port 9420` —— 工具会自动以该端口开启自动化服务。
2. **GUI 手动开启**：开发者工具 设置 → 安全设置 → 开启「服务端口」/「CLI/HTTP 调用」，再由 `automator.connect({wsEndpoint})` 连接。

> 默认自动化端口约定为 **9420**（SDK 内部默认值，本项目也用此值）。
