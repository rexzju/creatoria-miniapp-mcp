# 微信小程序工具链最新版本调研

> 调研日期：2026-05-31
> 调研范围：微信开发者工具 + miniprogram CLI + 自动化 SDK（miniprogram-automator）最新版本现状及对本项目的影响

## 执行摘要

| 对象 | 最新版本 | 发布时间 | 状态 |
|------|---------|---------|------|
| **自动化 SDK** miniprogram-automator | **0.12.1** | 2023-11-07 | ⛔ 已停更，npm latest 即此版 |
| **微信开发者工具** | **v2.01.2510260** | 2025-10 | ✅ 活跃迭代 |
| **CLI auto 接口** | （随工具） | 1.05.2111232 起稳定 | ✅ 多年未变 |

**核心结论**：
1. 项目用的 SDK 0.12.1 **已是最高版本，无可升级**；SDK 事实停更，官方更新日志停在 0.12.0（2022-09）。
2. 最新开发者工具仍兼容此 SDK，因 CLI 命令 + WebSocket 协议两层契约稳定。
3. **"更新代码适配新 CLI"是伪命题**——CLI 接口、路径、端口均未变；项目 launch.ts 与官方一致。
4. 真正的痛点是 SDK 先天缺陷（ws 无连接超时导致 connect/launch 卡死），**已在上一轮通过项目层兜底修复**，与版本号无关。

## 文档索引

| 文件 | 内容 |
|------|------|
| [01-自动化SDK版本现状.md](./01-自动化SDK版本现状.md) | SDK 版本/发布时间/依赖链/停更证据 |
| [02-开发者工具与CLI最新版本.md](./02-开发者工具与CLI最新版本.md) | 工具最新版本、CLI 路径、auto 命令、端口开启 |
| [03-CLI命令与自动化能力变化.md](./03-CLI命令与自动化能力变化.md) | CLI 接口稳定性、协议、能力清单、已知缺口 |
| [04-兼容性与项目影响.md](./04-兼容性与项目影响.md) | 兼容性判断、风险矩阵、对两个任务的回答 |
| [05-结论与建议.md](./05-结论与建议.md) | 关键发现矩阵、分级行动建议 |

## 数据来源

- npm registry：`npm view miniprogram-automator` + registry.npmjs.org/miniprogram-automator
- 微信开放文档 - 小程序自动化：https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/
- 微信开放文档 - 自动化更新日志：https://developers.weixin.qq.com/miniprogram/dev/devtools/auto/changelog.html
- 微信开放文档 - CLI：https://developers.weixin.qq.com/miniprogram/dev/devtools/cli.html
- 微信开发者工具下载页：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
- 本地 node_modules/miniprogram-automator 反编译源码（Launcher.js / Connection.js）
