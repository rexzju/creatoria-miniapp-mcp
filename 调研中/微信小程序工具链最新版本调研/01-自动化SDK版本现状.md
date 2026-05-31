# 01 · 自动化 SDK（miniprogram-automator）版本现状

> 调研日期：2026-05-31
> 数据来源：npm registry、微信官方更新日志、本地 node_modules

## 1. 权威版本事实（已交叉验证）

| 维度 | 事实 | 来源 |
|------|------|------|
| npm `latest` tag | **0.12.1** | `npm view miniprogram-automator version` + registry.npmjs.org |
| 0.12.1 发布时间 | **2023-11-07** | npm time 元数据 |
| 官方更新日志最新记录 | **仅记到 0.12.0（2022-09-28）** | developers.weixin.qq.com/.../auto/changelog.html |
| beta tag | `0.12.0-beta.1`（更旧） | npm dist-tags |
| 本地项目锁定版本 | **0.12.1**（已是最新） | pnpm-lock.yaml + node_modules |

**结论：`miniprogram-automator` 的 npm 最新版就是项目当前用的 0.12.1，且自 2023-11 起已两年半无更新。官方更新日志甚至停留在 0.12.0。这是一个事实上已停止维护的 SDK。**

## 2. SDK 版本历史（官方 changelog + npm）

| 版本 | 日期 | 关键变更 | 对应基础库/工具 |
|------|------|---------|----------------|
| 0.12.1 | 2023-11-07 | npm 有，官方 changelog 未记录（疑似仅修复/打包） | — |
| 0.12.0 | 2022-09-28 | 支持获取/设置工具登录票据（ticket） | — |
| 0.11.0 | 2021-09-14 | 新增插件方法 callPluginWxMethod/mockPluginWxMethod/restorePluginWxMethod；修复插件页跳转 | 基础库 2.19.3 |
| 0.10.0 | 2020-07-20 | 新增 miniProgram.stopAudits | 工具 1.04.2006242 |
| 0.5.1 | 2019 | 首批公开版本 | — |

## 3. SDK 依赖链（印证超时根因）

本地 `node_modules/miniprogram-automator/package.json` 的 dependencies：

```json
{
  "debug": "^4.1.1",
  "jimp": "^0.6.4",          // 截图图像处理（fullPage 拼接耗时来源之一）
  "licia": "^1.4.4",         // waitUntil 等工具函数
  "qrcode-reader": "^1.0.4",
  "qrcode-terminal": "^0.12.0",
  "ws": "^6.1.3"             // ⚠️ WebSocket 客户端，老版本，Connection.create 不带连接超时
}
```

**关键印证**：`ws@^6.1.3` 是 2018 年的老版本。本项目此前诊断的"connect/launch 卡死根因 = `new ws()` 无连接超时"在依赖层得到佐证——SDK 既未升级 ws，也未在 `Connection.create` 外包超时。

## 4. 是否有替代/更新版 SDK

- **官方无新包**：微信未发布 miniprogram-automator 的后继 npm 包，Node 自动化能力仍指向此 SDK。
- **真机自动化（remote）**：官方有"真机自动化"页面，但仍由同一 SDK + 工具驱动，非独立新包。
- **第三方 minium**：腾讯出品的 Python 框架，主要面向真机，与本项目 Node/MCP 架构不匹配，不构成替换项。
