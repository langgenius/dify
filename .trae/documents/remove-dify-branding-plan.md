# 前端去品牌化 (Remove Dify Branding) 计划

## 目标
在不影响功能正常使用的前提下，移除前端页面中所有用户可见的 "Dify" 品牌标识。

## 原则

| ✅ 必须修改（UI 可见） | ❌ 不可修改（影响功能） |
|----------------------|----------------------|
| i18n 翻译值中的 "Dify" | API 请求头 `X-Dify-Version` |
| 浏览器页面标题 | 内部变量/函数名 (`isDifyVersionCompatible`, `UseDifyPath` 等) |
| Logo 图片/图标 | i18n key 名称 (只改 value, 不改 key) |
| "Powered by Dify" | 测试 mock 数据中的 `author: 'Dify'` |
| 聊天嵌入中的品牌 | 类型定义 |
| 页面中显示的品牌文字 | 文件/组件名（`dify-logo.tsx` 等） |

---

## 执行步骤

### 第 1 步：Logo 组件改造（2 个文件）

#### 1.1 DifyLogo 组件 (`web/app/components/base/logo/dify-logo.tsx`)
- **现状**: 引用 `/logo/login_dg.png` 图片，该图片包含 Dify 品牌 Logo
- **方案**: 将组件改为渲染一个通用占位 Logo（纯色方块或空白），保留组件接口不变（Props: style, size, className），避免调用方报错
- **影响范围**: 所有引用该组件的地方自动生效（Header、Signin、Form、Chat、Billing 等 10+ 页面）

#### 1.2 Dify SVG Icon (`web/app/components/base/icons/src/public/common/Dify.tsx` + `Dify.json`)
- **现状**: SVG 数据渲染 Dify 品牌字母图形
- **方案**: 替换 SVG path 数据为通用图标（如一个抽象方块/圆点图标），保持文件名和组件名不变
- **影响范围**: 聊天嵌入等使用该图标的地方

---

### 第 2 步：浏览器页面标题（1 个文件）

#### `web/hooks/use-document-title.ts`
- **现状**: `titleStr = \`${prefix}Dify\``
- **方案**: 改为 `titleStr = prefix \|\| 'Application'`（或空字符串）
- **影响范围**: 所有页面的浏览器 Tab 标题

---

### 第 3 步：嵌入聊天品牌逻辑（2 个文件）

#### 3.1 `web/app/components/base/chat/embedded-chatbot/utils.ts`
- **现状**: `isDify()` 检查 `document.referrer.includes('dify.ai')`
- **方案**: 改为始终返回 `false`（或移除该判断逻辑）
- **影响范围**: 聊天嵌入中的品牌展示切换

#### 3.2 依赖 `isDify()` 的文件
- `chat-wrapper.tsx` — `isDify()` 控制 answerIcon
- `index.tsx` — `isDify()` 控制 customerIcon 和 Logo 显示
- **方案**: 移除依赖 `isDify()` 的品牌分支逻辑，统一使用非品牌样式

---

### 第 4 步：i18n 翻译文件（~427 个文件，需批量处理）

**范围**: 23 种语言，每语言约 15-19 个 JSON 文件包含 "Dify"

**方案**: 用脚本批量替换翻译值中的 "Dify"

#### 4.1 创建一个批量替换脚本 `scripts/remove-dify-i18n.js`
- 遍历 `web/i18n/` 下所有 JSON 文件
- 对每个文件中的每个字符串值，将包含 "Dify" 的文本替换为通用文案

#### 4.2 替换规则（en-US 参考，其他语言同理）

| i18n Key (en-US) | 原值 | 替换为 |
|------------------|------|--------|
| `login.json > explore` | "Explore Dify" | "Explore" |
| `login.json > go` | "Go to Dify" | "Go to App" |
| `login.json > joinTipEnd` | " team on Dify" | " team" |
| `login.json > pageTitle` | "Log in to Dify" | "Log in" |
| `login.json > resetPasswordDesc` | "Type the email you used to sign up on Dify..." | "...sign up..." |
| `common.json > about.latestAvailable` | "Dify {{version}} is the latest..." | "{{version}} is the latest..." |
| `common.json > about.nowAvailable` | "Dify {{version}} is now available." | "{{version}} is now available." |
| `common.json > members.invitationSentTip` | "...sign in to Dify to access..." | "...sign in to access..." |
| `workflow.json > difyTeam` | "Dify Team" | "System" |
| `workflow.json > common.clipboardVersionCompatibilityWarning` | "...from a different Dify app version" | "...from a different app version" |
| `plugin.json > difyVersionNotCompatible` | "The current Dify version is not compatible..." | "Current version is not compatible..." |
| `plugin.json > marketplace.difyMarketplace` | "Dify Marketplace" | "Marketplace" |
| `plugin.json > marketplace.partnerTip` | "Verified by a Dify partner" | "Verified partner" |
| `plugin.json > marketplace.verifiedTip` | "Verified by Dify" | "Verified" |
| `custom.json > webapp.removeBrand` | "Remove Powered by Dify" | "Remove Powered by" |
| `education.json > applied.noPaymentPermission.returnHome` | "Back to Dify" | "Back" |
| `explore.json > apps.title` | "Try Dify's curated apps..." | "Try curated apps..." |
| `oauth.json > tips.loggedIn` | "...from your Dify Cloud account." | "...from your Cloud account." |
| `oauth.json > tips.notLoggedIn` | "...access your Dify Cloud account" | "...access your Cloud account" |
| `billing.json` 中的多个 key | 替换 "Dify" 引用 | 移除或替换 |
| `dataset.json`, `app.json`, `app-api.json`, `app-overview.json` 等 | 替换文本中的 "Dify" | 保持语义去掉品牌名 |

**注意**: i18n key 名称（如 `difyTeam`, `difyMarketplace`, `difyVersionNotCompatible`）是代码内部的标识符，**不改动**。

---

### 第 5 步：PoweredByBrand 组件（1 个文件）

#### `web/app/components/custom/custom-web-app-brand/components/powered-by-brand.tsx`
- **现状**: 显示 "POWERED BY" + DifyLogo
- **方案**: 
  - 将 "POWERED BY" 文字移除或改为通用文字
  - 移除 DifyLogo fallback（只显示自定义 logo，无自定义 logo 时返回 null）

---

### 第 6 步：开发者模板文档（12 个 MDX 文件）

#### `web/app/components/develop/template/*.mdx`
- **现状**: 示例代码中包含 "Hello Dify", "I am Dify", "author_name: Dify" 等
- **方案**: 替换为 "Hello World", "I am AI", "author_name: AI Assistant" 等通用示例
- **影响**: 开发者 API 文档中的示例代码

---

### 第 7 步：离线 HTML 页面（1 个文件）

#### `web/public/_offline.html`
- **现状**: `<title>Dify - Offline</title>`
- **方案**: 改为 `<title>App - Offline</title>`

---

### 第 8 步：其他零散 UI 文字

| 文件 | 现状 | 方案 |
|------|------|------|
| `web/i18n-config/language.ts` L96 | 公告中提及 Dify | 移除品牌名 |
| `web/i18n-config/languages.ts` | "Hello, Dify!" 示例 | 改为 "Hello!" |
| `web/i18n-config/README.md` | "Hello, Dify!" 示例 | 改为 "Hello!" |

---

## 不修改的技术性引用清单（确认保留）

以下内容虽然包含 "Dify"，但不影响 UI 且修改会破坏功能，**不修改**：

1. `service/fetch.ts` — `X-Dify-Version` 请求头（API 协议）
2. `service/client.ts` — `X-Dify-Version` 请求头（API 协议）
3. `types/doc-paths.ts` — `UseDifyPath`, `UseDifyNodesPath` 类型
4. `scripts/gen-doc-paths.ts` — 文档路径生成脚本
5. 组件中的 `isDifyVersionCompatible` 变量（功能逻辑，不显示 "Dify" 文字，文字来自 i18n）
6. 所有测试文件中的 `author: 'Dify'`（mock 数据，不影响 UI）
7. 测试文件中的 "What is Dify?" 等测试数据（不影响 UI）
8. `DifySelectItem` 别名（内部组件命名）
9. `resolveDifyCompactTypeString` 函数（内部逻辑）

## 验证方式

1. **启动 dev server** — `cd web && npm run dev`
2. 检查以下页面无 "Dify" 品牌显示：
   - 登录页 (`/signin`)
   - 首页 Header
   - 页面 Tab 标题
   - 嵌入式聊天机器人
   - "Powered by" 区域
   - Plugin Marketplace
   - 教育认证页
3. **运行测试** — `npm run test` 确保原有测试通过
4. **类型检查** — `npm run type-check` 确保类型无误

## 风险点

1. **i18n 跳转 key 名称**: 注意区分 key 名（如 `difyTeam`）和 value（"Dify Team"），只改 value
2. **参数插值**: i18n 值中包含 `{{version}}` 等模板参数，替换时不要删除这些占位符
3. **多语言同步**: 英文 en-US 和中文 zh-Hans 等所有 23 种语言都要替换