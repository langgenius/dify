# 前端去品牌化 — 验证执行计划

## 当前状态

所有 **8 个修改步骤**（Logo、页面标题、嵌入聊天、i18n、PoweredBy、MDX 模板、离线页面、零散文字）**已完成**。

剩余 **Step 9: 验证** 因缺少环境依赖（无 pnpm、Node 版本 v18 < 要求的 v22）未执行。

---

## 验证方案

### 方案 A：搭建完整环境验证（推荐，但耗时较长）

| 步骤 | 操作 | 命令 | 预期结果 |
|------|------|------|---------|
| A1 | 安装 Node.js v22+ | 使用 `nvm install 22` 或 `n 22` | node --version → v22.x |
| A2 | 安装 pnpm | `npm install -g pnpm` 或 `corepack enable` | pnpm --version → 11.x |
| A3 | 安装依赖 | `pnpm install` | 无报错，node_modules 生成 |
| A4 | 类型检查 | `pnpm type-check`（根目录）或 `cd web && npm run type-check` | tsgo 通过，无类型错误 |
| A5 | 运行测试 | `cd web && npm test` | 测试全部通过（Pass） |
| A6 | 启动 dev server | `cd web && npm run dev` | 本地可访问 http://localhost:3000 |

### 方案 B：轻量验证（无需完整环境，快速确认）

如果不想安装完整工具链，可以用以下方式替代验证：

| 步骤 | 操作 | 说明 |
|------|------|------|
| B1 | 语法验证 | 使用 Node.js 内置 parser 检查修改过的 TSX 文件是否有语法错误 |
| B2 | i18n 完整性验证 | 运行已有脚本 `cd web && node scripts/check-i18n.js` 检查 i18n key 完整性 |
| B3 | 差异确认 | `cd web && git diff --stat` 确认所有修改文件列表与预期一致 |
| B4 | 手动 grep 检查 | 搜索修改后的代码中是否存在残留的可见品牌文字 |

> ⚠️ **注意**：方案 B 无法保证类型安全和测试通过，有运行时风险。

---

## 已修改文件清单（供验证时对照检查）

### UI 组件修改（4 个文件）
1. `web/app/components/base/logo/dify-logo.tsx` — Logo 改为通用占位
2. `web/app/components/base/icons/src/public/common/Dify.json` — SVG 改为通用图标
3. `web/app/components/base/icons/src/public/common/Dify.tsx` — displayName 更新
4. `web/app/components/custom/custom-web-app-brand/components/powered-by-brand.tsx` — 移除品牌文字

### 嵌入聊天修改（3 个文件）
5. `web/app/components/base/chat/embedded-chatbot/utils.ts` — isDify() 始终返回 false
6. `web/app/components/base/chat/embedded-chatbot/chat-wrapper.tsx` — 移除品牌逻辑
7. `web/app/components/base/chat/embedded-chatbot/index.tsx` — 移除品牌逻辑

### 页面标题（1 个文件）
8. `web/hooks/use-document-title.ts` — 标题不再包含 "Dify"

### 离线页面（1 个文件）
9. `web/public/_offline.html` — 标题改为 "App - Offline"

### i18n/custom 配置（3 个文件）
10. `web/i18n-config/language.ts` — 公告文字移除品牌
11. `web/i18n-config/languages.ts` — 示例文字移除品牌
12. `web/scripts/remove-dify-i18n.cjs`（新增）— 批处理脚本

### MDX 开发者模板（12 个文件）
13-24. `web/app/components/develop/template/*.mdx`

### i18n 翻译文件（498 个文件，批量修改）
25-522. `web/i18n/**/*.json`

---

## 手动检查页面清单

启动 dev server 后，检查以下页面无 "Dify" 品牌文字：

| 页面 | URL | 检查要点 |
|------|-----|---------|
| 登录页 | `/signin` | 页面标题、Logo、表单文字 |
| 应用列表 | `/apps` | Header、页面标题 |
| 应用详情 | `/app/:id` | "Powered by" 区域 |
| Plugin Marketplace | `/plugins` | "Dify Marketplace" 已改为 "Marketplace" |
| 教育认证页 | `/education` | "Back to Dify" 已改为 "Back" |
| 浏览器 Tab | 任意页面 | Tab 标题不含 "Dify" |
| 嵌入聊天 | 测试页面 | 底部无 "POWERED BY" 文字 |
| 设置页面 | `/settings` | "Remove Powered by Dify" 已改为 "Remove Powered by" |

---

## 风险与回退

- **类型错误风险**：如果 `tsgo` 类型检查发现错误，先确认是否与本次修改相关（而非已有的类型问题），然后修正
- **i18n key 缺失风险**：如果 `check-i18n.js` 发现缺失 key，可能是在批量替换时误删了 key（但脚本设计只替换 value），需回退对应文件
- **回退命令**：`git checkout -- web/i18n/` 可回退所有 i18n 修改（最后手段）
- **Node 版本限制**：当前 v18.19.1 不符合要求（v22+），但 `type-check` (tsgo) 和 `test` (vp test) 可能仍可运行；如果不可行，需升级 Node

---

## 执行计划（按顺序）

1. **尝试直接运行验证命令**（用当前 v18 Node）→ 如果失败则
2. **安装 pnpm** → `npm install -g pnpm`
3. **安装依赖** → `pnpm install`
4. **类型检查** → `pnpm type-check` 或 `cd web && npm run type-check`
5. **运行测试** → `cd web && npm test`
6. **如有错误** → 定位并修复
7. **最终确认** → 输出验证报告