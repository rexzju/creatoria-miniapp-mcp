# 当前待实施改动总览

> 最后更新: 2025-12-27
> 版本: 0.3.0 (规划中)

## 概述

本目录包含两个待实施的改动计划：

1. **架构迁移**：完全使用新架构（capabilities + runtime）
2. **截图修复**：解决截图超时卡住问题

---

## 改动一览

| 改动 | 类型 | 优先级 | 预计工时 | 文档 |
|------|------|--------|---------|------|
| 架构迁移 | 重构 | 高 | 18-25h | [01-architecture-migration.md](./01-architecture-migration.md) |
| 截图修复 | Bug Fix | 紧急 | 8-9h | [02-screenshot-timeout-fix.md](./02-screenshot-timeout-fix.md) |

---

## 改动一：架构迁移

### 背景

项目当前处于混合架构状态：
- 运行时服务 (runtime/) 已完成迁移：100%
- 工具实现 (tools/) 完全未迁移：0%
- 能力框架 (capabilities/) 仅作为代理：50%

### 目标

将 5,244 行工具代码从 `src/tools/` 迁移到 `src/capabilities/`，实现：
- 模块化工具组织
- Schema 驱动的输入验证
- 动态工具加载
- 删除旧的 tools/ 和 core/ 目录

### 核心改动

```
当前结构:                         目标结构:
src/                              src/
├── tools/          ❌ 5,244行     ├── capabilities/    🆕 模块化
│   ├── index.ts    1,645行       │   ├── automator/
│   ├── automator.ts              │   │   ├── schemas/
│   ├── miniprogram.ts            │   │   └── handlers/
│   └── ...                       │   ├── miniprogram/
├── core/           ❌ 兼容层      │   │   ├── schemas/
│   └── *.ts        → runtime     │   │   └── handlers/
└── runtime/        ✅ 保持       │   ├── page/
                                  │   ├── element/
                                  │   ├── loader.ts     🆕
                                  │   └── registry.ts   🆕
                                  └── runtime/          ✅ 保持
```

### 工作量

| 阶段 | 内容 | 预计时间 |
|------|------|---------|
| Phase 1 | 基础设施（loader/registry） | 3-4h |
| Phase 2 | Automator 迁移（4工具） | 2-3h |
| Phase 3 | MiniProgram 迁移（6工具） | 2-3h |
| Phase 4 | Page 迁移（8工具） | 2-3h |
| Phase 5 | Element 迁移（23工具） | 3-4h |
| Phase 6 | Assert/Snapshot/Record/Network | 4-5h |
| Phase 7 | 清理与测试 | 2-3h |
| **总计** | - | **18-25h** |

---

## 改动二：截图超时修复

### 问题

`miniprogram_screenshot` 工具调用时经常卡住：
- 无超时保护：Promise 永不 resolve/reject
- base64 返回被删除：必须走文件保存路径
- 级联影响：所有 snapshot 工具都会卡住

### 根本原因

```typescript
// ❌ 当前代码 - 无超时保护
const screenshotBuffer = await session.miniProgram.screenshot({
  path: fullPath,
  fullPage,
})

// ✅ 应该使用 withTimeout
const screenshotBuffer = await withTimeout(
  session.miniProgram.screenshot({ ... }),
  timeoutMs,
  'Screenshot capture'
)
```

### 核心改动

1. **P0**：为 screenshot 添加 withTimeout 保护
2. **P0**：恢复 returnBase64 参数和 base64 返回
3. **P1**：为其他 miniprogram 操作添加超时
4. **P1**：添加重试机制
5. **P2**：优化 fullPage 超时配置

### 工作量

| 任务 | 预计时间 | 优先级 |
|------|---------|--------|
| screenshot 超时保护 | 1h | P0 |
| 恢复 base64 返回 | 1h | P0 |
| 其他操作超时保护 | 2h | P1 |
| 重试机制 | 1.5h | P1 |
| 配置优化 | 1h | P2 |
| 测试 | 2h | P1 |
| **总计** | **8-9h** | - |

---

## 建议实施顺序

### 方案 A：先修复后迁移（推荐）

```
Week 1: 截图修复 (8-9h)
  ├─ Day 1-2: P0 任务（超时保护 + base64）
  └─ Day 3-4: P1 任务（其他超时 + 重试）

Week 2-3: 架构迁移 (18-25h)
  ├─ Day 1: Phase 1（基础设施）
  ├─ Day 2-3: Phase 2-4（核心工具）
  ├─ Day 4-5: Phase 5-6（剩余工具）
  └─ Day 6: Phase 7（清理测试）
```

**优势**：
- 先解决紧急问题
- 迁移时可以同时应用超时保护

### 方案 B：迁移时同步修复

```
直接进行架构迁移，迁移 miniprogram 工具时顺带修复超时
```

**优势**：
- 避免重复修改同一文件
- 代码只需 review 一次

**劣势**：
- 紧急问题需要等待更长时间

---

## 文件变更汇总

### 新建文件（约 40 个）

| 目录 | 文件数 | 描述 |
|------|--------|------|
| capabilities/*/schemas/ | ~20 | Zod schema 定义 |
| capabilities/*/handlers/ | ~12 | 工具处理器 |
| capabilities/ | 3 | loader/registry/index |
| runtime/retry/ | 2 | 重试机制 |
| tests/ | 3 | 新增测试 |

### 修改文件（约 10 个）

| 文件 | 改动 |
|------|------|
| src/server.ts | 使用新的 capabilities 入口 |
| src/tools/miniprogram.ts | 添加超时保护（临时，迁移后删除） |
| src/config/defaults.ts | 新增超时配置 |
| src/types.ts | 更新类型定义 |
| tests/**/*.test.ts | 更新导入路径 |

### 删除文件（约 17 个）

| 目录 | 文件数 | 描述 |
|------|--------|------|
| src/tools/ | 9 | 全部工具文件 |
| src/core/ | 8 | 全部兼容层文件 |

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 迁移过程中引入 bug | 中 | 高 | 逐阶段提交，完整测试 |
| 超时时间设置不合理 | 低 | 中 | 配置化，允许用户调整 |
| 测试覆盖不足 | 低 | 中 | 先补充测试再迁移 |
| 文档不同步 | 低 | 低 | 同步更新 README |

---

## 验收标准

### 架构迁移

- [ ] 所有 65 个工具迁移到 capabilities/
- [ ] tools/ 和 core/ 目录删除
- [ ] 所有工具有 Zod schema
- [ ] 单元测试 100% 通过
- [ ] 集成测试通过
- [ ] TypeScript 编译无错误

### 截图修复

- [ ] 截图 10s 内返回或超时
- [ ] fullPage 截图 30s 内返回或超时
- [ ] returnBase64=true 正确返回 base64
- [ ] 所有 miniprogram 操作有超时保护
- [ ] 超时测试覆盖

---

## 相关文档

- [01-architecture-migration.md](./01-architecture-migration.md) - 架构迁移详细计划
- [02-screenshot-timeout-fix.md](./02-screenshot-timeout-fix.md) - 截图修复详细方案
- [03-connect-screenshot-timeout-diagnosis.md](./03-connect-screenshot-timeout-diagnosis.md) - 连接与截图超时问题诊断
- [04-toolchain-version-baseline.md](./04-toolchain-version-baseline.md) - 工具链版本基线与超时配置说明
- [../../调研中/微信小程序工具链最新版本调研/README.md](../../调研中/微信小程序工具链最新版本调研/README.md) - SDK/CLI/开发者工具版本调研
- [../directory-structure-and-code-style-best-practices.md](../directory-structure-and-code-style-best-practices.md) - 代码规范
- [../migration/](../migration/) - 历史迁移文档
