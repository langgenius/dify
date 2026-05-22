# 前端代码 "Dify" 扫描报告

**扫描时间**: 2026-05-22  
**扫描范围**: `web/` 目录（排除 node_modules, .next, dist, .venv）  
**扫描命令**: `grep -rn "Dify" --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=.venv web/`

---

## 一、总览

| 指标 | 数值 |
|------|------|
| 包含 "Dify" 的总文件数 | 525 |
| i18n 翻译文件数 | 427 |
| 非 i18n 源码/文档文件数 | 98 |
| 总匹配行数 | ~1284 (i18n) + 数百行非 i18n |

---

## 二、按文件类型分布

| 类型 | 文件数 | 说明 |
|------|--------|------|
| `.json` | 429 | i18n 翻译文件为主，少量配置文件 |
| `.tsx` | 58 | React 组件 + 测试文件 |
| `.ts` | 18 | TypeScript 逻辑/类型/工具文件 |
| `.mdx` | 12 | 开发者模板文档 |
| `.md` | 4 | 项目文档、README |
| `.js` | 2 | 脚本文件 |
| `.html` | 1 | 离线页面 |
| `.css` | 1 | 样式文件 |

---

## 三、按目录分布

| 目录 | 文件数 | 说明 |
|------|--------|------|
| `web/i18n/` (23 种语言) | 427 | 国际化翻译，每语言 15-19 个文件 |
| `web/app/components/` | ~50 | React 组件 + 组件的测试文件 |
| `web/app/components/develop/template/` | 12 | 开发者 API 模板文档 (MDX) |
| `web/__tests__/` | 5 | 端到端/集成测试文件 |
| `web/hooks/` | 2 | React Hooks |
| `web/service/` | 2 | API 服务层 |
| `web/types/` | 1 | TypeScript 类型定义 |
| `web/scripts/` | 3 | 构建/重构脚本 |
| `web/i18n-config/` | 3 | i18n 配置 + README |
| `web/public/` | 1 | 静态资源 (offline.html) |
| `web/docs/` | 2 | 项目文档 (test.md, overlay.md) |
| `web/app/` (其他) | ~12 | 页面组件 (signin, form, education, account) |
| `web/app/styles/` | 2 | 样式文件 |

---

## 四、详细文件列表

### 【A】i18n 国际化文件 (web/i18n/)

共 **427 个文件**，覆盖 **23 种语言**。每语言约 19 个 JSON 文件中包含 "Dify"。

#### A1. 各语言文件分布

| 语言 | 包含 "Dify" 的文件数 |
|------|---------------------|
| zh-Hant, zh-Hans, vi-VN, uk-UA, tr-TR, ru-RU, ro-RO, pt-BR, pl-PL, nl-NL, ko-KR, ja-JP, it-IT, id-ID, es-ES, en-US, de-DE | 19 个 |
| th-TH, sl-SI, fr-FR, ar-TN | 18 个 |
| fa-IR | 17 个 |
| hi-IN | 15 个 |

#### A2. 以 en-US 为例，包含 "Dify" 的 i18n key 列表 (57 处)

| 文件 | i18n Key | 翻译值 (en-US) |
|------|----------|----------------|
| `login.json` | `explore` | "Explore Dify" |
| `login.json` | `go` | "Go to Dify" |
| `login.json` | `joinTipEnd` | " team on Dify" |
| `login.json` | `license.tip` | "Before starting Dify Community Edition, read the GitHub" |
| `login.json` | `licenseExpiredTip` | "The Dify Enterprise license for your workspace has expired..." |
| `login.json` | `licenseInactiveTip` | "The Dify Enterprise license for your workspace is inactive..." |
| `login.json` | `licenseLostTip` | "Failed to connect Dify license server..." |
| `login.json` | `pageTitle` | "Log in to Dify" |
| `login.json` | `resetPasswordDesc` | "Type the email you used to sign up on Dify..." |
| `common.json` | `about.latestAvailable` | "Dify {{version}} is the latest version available." |
| `common.json` | `about.nowAvailable` | "Dify {{version}} is now available." |
| `common.json` | `apiBasedExtension.title` | "API extensions provide centralized API management... across Dify's applications." |
| `common.json` | `members.invitationSentTip` | "...sign in to Dify to access your team data." |
| `common.json` | `provider.openaiHosted.desc` | "The OpenAI hosting service provided by Dify..." |
| `workflow.json` | `common.clipboardVersionCompatibilityWarning` | "...copied from a different Dify app version." |
| `workflow.json` | `difyTeam` | "Dify Team" |
| `workflow.json` | `nodes.knowledgeBase.chunkStructureTip.message` | "The Dify Knowledge Base supports three chunking structures..." |
| `app.json` | `tracing.aliyun.description` | "...monitoring, tracing, and evaluation of Dify applications." |
| `app-overview.json` | `apiKeyInfo.tryCloud` | "Or try the cloud version of Dify with free quote" |
| `app-overview.json` | `overview.appInfo.customize.way1.step1Operation` | "Dify-WebClient" |
| `app-overview.json` | `overview.appInfo.embedded.chromePlugin` | "Install Dify Chatbot Chrome Extension" |
| `app-overview.json` | `overview.appInfo.settings.more.privacyPolicyTip` | "...see Dify's Privacy Policy." |
| `app-api.json` | `chatMode.info` | "...depend on Dify Prompt Eng. settings." |
| `app-api.json` | `completionMode.info` | "...set in Dify Prompt Engineering." |
| `billing.json` | (多个 key) | "Complies with Dify Open Source License", "Dify Partners", "Dify Officially", "Dify API Rate Limit" 等 |
| `custom.json` | `webapp.removeBrand` | "Remove Powered by Dify" |
| `dataset.json` | `externalAPIPanelDescription` | "...knowledge base outside of Dify" |
| `dataset.json` | `intro1` | "The Knowledge can be integrated into the Dify application" |
| `dataset-creation.json` | `otherDataSource.description` | "Currently, Dify's knowledge base only has limited data sources..." |
| `dataset-documents.json` | `list.desc` | "...linked to Dify citations" |
| `dataset-documents.json` | `list.empty.sync.tip` | "Dify will periodically download files..." |
| `dataset-settings.json` | `form.descPlaceholder` | "...Dify will use the default hit strategy." |
| `dataset-pipeline.json` | `knowledgeDescriptionPlaceholder` | "...Dify will use the default hit strategy." |
| `education.json` | (多个 key) | "Back to Dify", "Dify Education Verified", "Dify Professional Plan" 等 |
| `explore.json` | `apps.title` | "Try Dify's curated apps to find AI solutions..." |
| `oauth.json` | `tips.loggedIn` | "...from your Dify Cloud account." |
| `oauth.json` | `tips.notLoggedIn` | "...access your Dify Cloud account" |
| `plugin.json` | `difyVersionNotCompatible` | "The current Dify version is not compatible..." |
| `plugin.json` | `marketplace.difyMarketplace` | "Dify Marketplace" |
| `plugin.json` | `marketplace.partnerTip` | "Verified by a Dify partner" |
| `plugin.json` | `marketplace.verifiedTip` | "Verified by Dify" |
| `plugin-trigger.json` | `modal.oauth.authorization.description` | "Authorize Dify to access your account" |
| `tools.json` | `contribute.line2` | "contributing tools to Dify." |
| `tools.json` | `customToolTip` | "Learn more about Dify custom tools" |

---

### 【B】React 组件中的 "Dify" 引用

#### B1. 品牌 Logo 展示组件

| 文件路径 | 行号 | 匹配内容 | 说明 |
|---------|------|---------|------|
| [web/app/components/base/logo/dify-logo.tsx](file:///home/project/dify/web/app/components/base/logo/dify-logo.tsx) | 20-40 | `DifyLogo` 组件定义 | 核心 Logo 组件 |
| [web/app/components/base/logo/__tests__/dify-logo.spec.tsx](file:///home/project/dify/web/app/components/base/logo/__tests__/dify-logo.spec.tsx) | 2-38 | `DifyLogo` 组件测试 | 测试文件 |
| [web/app/components/base/icons/src/public/common/Dify.tsx](file:///home/project/dify/web/app/components/base/icons/src/public/common/Dify.tsx) | 7-18 | `Dify` SVG Icon 组件 | 图标组件 |
| [web/app/components/base/logo/index.stories.tsx](file:///home/project/dify/web/app/components/base/logo/index.stories.tsx) | 4-60 | Storybook stories | 组件文档 |

#### B2. Header / 导航栏中使用 DifyLogo 的组件

| 文件路径 | 行号 | 匹配内容 |
|---------|------|---------|
| [web/app/components/header/index.tsx](file:///home/project/dify/web/app/components/header/index.tsx) | 4, 59 | `import DifyLogo` / `<DifyLogo />` |
| [web/app/components/header/__tests__/index.spec.tsx](file:///home/project/dify/web/app/components/header/__tests__/index.spec.tsx) | 185-203 | "Dify logo", "Dify text", `screen.getByText('Dify')` |
| [web/app/components/header/account-about/index.tsx](file:///home/project/dify/web/app/components/header/account-about/index.tsx) | 9, 56 | `import DifyLogo` / `<DifyLogo size="large" />` |
| [web/app/account/(commonLayout)/header.tsx](file:///home/project/dify/web/app/account/(commonLayout)/header.tsx) | 7, 33 | `import DifyLogo` / `<DifyLogo />` |
| [web/app/signin/_header.tsx](file:///home/project/dify/web/app/signin/_header.tsx) | 12, 35 | `DifyLogo` (dynamic import) / `<DifyLogo size="large" />` |

#### B3. 嵌入聊天 / Chatbot 组件

| 文件路径 | 行号 | 匹配说明 |
|---------|------|---------|
| [web/app/components/base/chat/embedded-chatbot/utils.ts](file:///home/project/dify/web/app/components/base/chat/embedded-chatbot/utils.ts) | 1 | `export const isDify = () => {...}` |
| [web/app/components/base/chat/embedded-chatbot/index.tsx](file:///home/project/dify/web/app/components/base/chat/embedded-chatbot/index.tsx) | 12, 25, 64, 91 | `DifyLogo`, `isDify()` |
| [web/app/components/base/chat/embedded-chatbot/chat-wrapper.tsx](file:///home/project/dify/web/app/components/base/chat/embedded-chatbot/chat-wrapper.tsx) | 31, 289 | `isDify()` |
| [web/app/components/base/chat/embedded-chatbot/header/index.tsx](file:///home/project/dify/web/app/components/base/chat/embedded-chatbot/header/index.tsx) | 12, 104 | `DifyLogo` |
| [web/app/components/base/chat/chat-with-history/sidebar/index.tsx](file:///home/project/dify/web/app/components/base/chat/chat-with-history/sidebar/index.tsx) | 23, 168 | `DifyLogo` |

#### B4. 品牌定制 / Powered-by 组件

| 文件路径 | 行号 | 匹配说明 |
|---------|------|---------|
| [web/app/components/custom/custom-web-app-brand/components/powered-by-brand.tsx](file:///home/project/dify/web/app/components/custom/custom-web-app-brand/components/powered-by-brand.tsx) | 1, 26 | `import DifyLogo` / `<DifyLogo size="small" />` |
| [web/app/components/custom/custom-web-app-brand/components/__tests__/powered-by-brand.spec.tsx](file:///home/project/dify/web/app/components/custom/custom-web-app-brand/components/__tests__/powered-by-brand.spec.tsx) | 30, 33 | "Dify logo" |
| [web/app/components/custom/custom-web-app-brand/components/__tests__/chat-preview-card.spec.tsx](file:///home/project/dify/web/app/components/custom/custom-web-app-brand/components/__tests__/chat-preview-card.spec.tsx) | 16 | "Talk to Dify" |

#### B5. 其他使用 DifyLogo 的页面组件

| 文件路径 | 行号 | 匹配说明 |
|---------|------|---------|
| [web/app/(humanInputLayout)/form/[token]/form.tsx](file:///home/project/dify/web/app/(humanInputLayout)/form/[token]/form.tsx) | 22, 120-281 | `<DifyLogo size="small" />` (多处) |
| [web/app/education-apply/education-apply-page.tsx](file:///home/project/dify/web/app/education-apply/education-apply-page.tsx) | 33, 119, 174, 187, 203 | `DifyLogo`, `renderBackToDifyButton()` |
| [web/app/components/billing/pricing/header.tsx](file:///home/project/dify/web/app/components/billing/pricing/header.tsx) | 6, 23 | `<DifyLogo className="h-[27px] w-[60px]" />` |

#### B6. Plugin 插件系统中的 "Dify"

| 文件路径 | 行号 | 匹配说明 |
|---------|------|---------|
| [web/app/components/plugins/plugin-item/index.tsx](file:///home/project/dify/web/app/components/plugins/plugin-item/index.tsx) | 72, 126-136 | `isDifyVersionCompatible`, `difyVersionNotCompatible` |
| [web/app/components/plugins/install-plugin/install-from-marketplace/steps/install.tsx](file:///home/project/dify/web/app/components/plugins/install-plugin/install-from-marketplace/steps/install.tsx) | 126, 138-140 | `isDifyVersionCompatible`, `difyVersionNotCompatible` |
| [web/app/components/plugins/install-plugin/install-from-local-package/steps/install.tsx](file:///home/project/dify/web/app/components/plugins/install-plugin/install-from-local-package/steps/install.tsx) | 111, 129-131 | `isDifyVersionCompatible`, `difyVersionNotCompatible` |

#### B7. Workflow 节点/工具组件

| 文件路径 | 行号 | 匹配说明 |
|---------|------|---------|
| [web/app/components/workflow/nodes/tool/output-schema-utils.ts](file:///home/project/dify/web/app/components/workflow/nodes/tool/output-schema-utils.ts) | 6, 11, 82 | `resolveDifyCompactTypeString`, "Dify VarType strings" |
| [web/app/components/workflow/nodes/_base/components/form-input-item.sections.tsx](file:///home/project/dify/web/app/components/workflow/nodes/_base/components/form-input-item.sections.tsx) | 7, 71, 85 | `DifySelectItem` (别名) |
| [web/app/components/workflow/utils/gen-node-meta-data.ts](file:///home/project/dify/web/app/components/workflow/utils/gen-node-meta-data.ts) | 2, 11 | `UseDifyNodesPath` 类型 |

#### B8. Nodes 节点组合中的 author: 'Dify' 引用

大量 Workflow 块选择器、节点操作菜单、工具的测试文件中使用 `author: 'Dify'` 作为 mock 数据，包括以下文件：

- [web/app/components/workflow/block-selector/__tests__/](file:///home/project/dify/web/app/components/workflow/block-selector/__tests__/) — main.spec.tsx, utils.spec.ts, blocks.spec.tsx, index.spec.tsx, data-sources.spec.tsx
- [web/app/components/workflow/node-actions-menu/__tests__/](file:///home/project/dify/web/app/components/workflow/node-actions-menu/__tests__/) — details.spec.tsx, index.spec.tsx
- [web/app/components/workflow/nodes/_base/components/__tests__/](file:///home/project/dify/web/app/components/workflow/nodes/_base/components/__tests__/) — agent-strategy-selector.spec.tsx
- [web/app/components/workflow/hooks/__tests__/](file:///home/project/dify/web/app/components/workflow/hooks/__tests__/) — use-nodes-meta-data.spec.tsx
- [web/app/components/workflow/utils/__tests__/](file:///home/project/dify/web/app/components/workflow/utils/__tests__/) — gen-node-meta-data.spec.ts
- [web/app/components/workflow/collaboration/core/__tests__/](file:///home/project/dify/web/app/components/workflow/collaboration/core/__tests__/) — collaboration-manager.logs-and-events.spec.ts
- [web/app/components/tools/__tests__/](file:///home/project/dify/web/app/components/tools/__tests__/) — provider-list.spec.tsx
- [web/app/components/header/account-setting/data-source-page-new/__tests__/](file:///home/project/dify/web/app/components/header/account-setting/data-source-page-new/__tests__/) — index.spec.tsx

---

### 【C】测试文件中的 "Dify" 引用

#### C1. isDify 工具函数测试

| 文件 | 匹配行数 | 说明 |
|------|---------|------|
| [web/app/components/base/chat/embedded-chatbot/__tests__/utils.spec.ts](file:///home/project/dify/web/app/components/base/chat/embedded-chatbot/__tests__/utils.spec.ts) | 20+ | `isDify()` 函数的多场景测试 |
| [web/app/components/base/chat/embedded-chatbot/__tests__/chat-wrapper.spec.tsx](file:///home/project/dify/web/app/components/base/chat/embedded-chatbot/__tests__/chat-wrapper.spec.tsx) | 4 | `mockIsDify` Mock |
| [web/app/components/base/chat/embedded-chatbot/__tests__/index.spec.tsx](file:///home/project/dify/web/app/components/base/chat/embedded-chatbot/__tests__/index.spec.tsx) | 4 | `mockIsDify` Mock |

#### C2. 测试数据中的 "Dify"

| 文件 | 匹配内容 |
|------|---------|
| [web/app/components/datasets/__tests__/chunk.spec.tsx](file:///home/project/dify/web/app/components/datasets/__tests__/chunk.spec.tsx) | question: 'What is Dify?', answer: 'Dify is...' |
| [web/app/components/rag-pipeline/components/chunk-card-list/__tests__/q-a-item.spec.tsx](file:///home/project/dify/web/app/components/rag-pipeline/components/chunk-card-list/__tests__/q-a-item.spec.tsx) | "What is Dify?" |
| [web/app/components/rag-pipeline/components/chunk-card-list/__tests__/index.spec.tsx](file:///home/project/dify/web/app/components/rag-pipeline/components/chunk-card-list/__tests__/index.spec.tsx) | "What is Dify?" / "Dify is..." |
| [web/app/components/rag-pipeline/components/panel/test-run/result/result-preview/__tests__/index.spec.tsx](file:///home/project/dify/web/app/components/rag-pipeline/components/panel/test-run/result/result-preview/__tests__/index.spec.tsx) | "What is Dify?" / "Dify is..." |
| [web/app/components/base/chat/chat/answer/__tests__/suggested-questions.spec.tsx](file:///home/project/dify/web/app/components/base/chat/chat/answer/__tests__/suggested-questions.spec.tsx) | "What is Dify?" |
| [web/app/components/workflow/run/__tests__/output-panel.spec.tsx](file:///home/project/dify/web/app/components/workflow/run/__tests__/output-panel.spec.tsx) | "Hello Dify" |
| [web/app/components/workflow/nodes/human-input/components/delivery-method/recipient/__tests__/index.spec.tsx](file:///home/project/dify/web/app/components/workflow/nodes/human-input/components/delivery-method/recipient/__tests__/index.spec.tsx) | "Dify's Lab" |
| [web/app/__tests__/datasets/hit-testing-flow.test.tsx](file:///home/project/dify/web/__tests__/datasets/hit-testing-flow.test.tsx) | "What is Dify?" |
| [web/__tests__/tools/](file:///home/project/dify/web/__tests__/tools/) (3 files) | `author: 'Dify'`, `expect(...).toHaveTextContent('Dify')` |
| [web/__tests__/real-browser-flicker.test.tsx](file:///home/project/dify/web/__tests__/real-browser-flicker.test.tsx) | "Simulate real page component based on Dify's actual theme usage", "Dify Application" |

#### C3. Plugin 测试

| 文件 | 匹配说明 |
|------|---------|
| [web/app/components/plugins/marketplace/description/__tests__/index.spec.tsx](file:///home/project/dify/web/app/components/plugins/marketplace/description/__tests__/index.spec.tsx) | "Dify Marketplace" 多语言顺序测试 |
| [web/app/components/plugins/reference-setting-modal/auto-update-setting/__tests__/tool-item.spec.tsx](file:///home/project/dify/web/app/components/plugins/reference-setting-modal/auto-update-setting/__tests__/tool-item.spec.tsx) | `author: 'Dify'`, `expect(screen.getByText('Dify'))` |
| [web/app/components/plugins/plugin-item/__tests__/index.spec.tsx](file:///home/project/dify/web/app/components/plugins/plugin-item/__tests__/index.spec.tsx) | "Dify version is not compatible" |

---

### 【D】Hooks / Service / Types

| 文件 | 行号 | 匹配内容 |
|------|------|---------|
| [web/hooks/use-document-title.ts](file:///home/project/dify/web/hooks/use-document-title.ts) | 21 | `titleStr = \`${prefix}Dify\`` |
| [web/hooks/use-document-title.spec.ts](file:///home/project/dify/web/hooks/use-document-title.spec.ts) | 7, 33-48 | "Default 'Dify' branding", "test - Dify", "Dify" |
| [web/service/fetch.ts](file:///home/project/dify/web/service/fetch.ts) | 191 | `headers.set('X-Dify-Version', ...)` |
| [web/service/client.ts](file:///home/project/dify/web/service/client.ts) | 22 | `'X-Dify-Version': ...` |
| [web/types/doc-paths.ts](file:///home/project/dify/web/types/doc-paths.ts) | 10-11, 119, 121, 265 | `UseDifyPath`, `UseDifyNodesPath` 类型定义 |

---

### 【E】配置 / 脚本

| 文件 | 行号 | 匹配内容 |
|------|------|---------|
| [web/scripts/gen-doc-paths.ts](file:///home/project/dify/web/scripts/gen-doc-paths.ts) | 286-291, 327 | `UseDifyNodesPath`, `UseDifyPath`, `DifyDocPath` |
| [web/scripts/refactor-component.js](file:///home/project/dify/web/scripts/refactor-component.js) | 150 | "Follow Dify project conventions" |
| [web/scripts/component-analyzer.js](file:///home/project/dify/web/scripts/component-analyzer.js) | 78 | "Dify-specific types" |
| [web/i18n-config/languages.ts](file:///home/project/dify/web/i18n-config/languages.ts) | 7-161 | 各语言示例: "Hello, Dify!", "你好，Dify！" 等 |
| [web/i18n-config/language.ts](file:///home/project/dify/web/i18n-config/language.ts) | 96 | 中文公告中提及 "Dify" |
| [web/i18n-config/README.md](file:///home/project/dify/web/i18n-config/README.md) | 53-137 | 文档中的示例 |

---

### 【F】文档

| 文件 | 行号 | 匹配内容 |
|------|------|---------|
| [web/README.md](file:///home/project/dify/web/README.md) | 1, 159 | "# Dify Frontend", "The Dify community can be found on Discord" |
| [web/docs/test.md](file:///home/project/dify/web/docs/test.md) | 3, 292, 355 | "Dify frontend project", "Dify primarily targets desktop", "Dify-Specific Components" |
| [web/docs/overlay.md](file:///home/project/dify/web/docs/overlay.md) | 39 | "All body-portalled Dify UI overlays use z-50." |
| [web/public/_offline.html](file:///home/project/dify/web/public/_offline.html) | 6 | `<title>Dify - Offline</title>` |
| [web/app/styles/markdown.css](file:///home/project/dify/web/app/styles/markdown.css) | 560 | "bridge shadcn/ui tokens to Dify design system" |
| [web/app/styles/plugins/typography.ts](file:///home/project/dify/web/app/styles/plugins/typography.ts) | 2 | "configured with Dify's prose color tokens." |

---

## 五、总结分类统计

| 类别 | 文件数 | 匹配行数(约) |
|------|--------|-------------|
| i18n 品牌名翻译 | 427 | 1284 |
| Logo 组件 / UI 品牌展示 | 12 | 35+ |
| Plugin 版本兼容 (isDifyVersionCompatible) | 6 | 20+ |
| Mock 测试数据 (author: 'Dify') | 10+ | 40+ |
| 测试数据/断言中的 "Dify" | 15+ | 60+ |
| API 请求头 (X-Dify-Version) | 2 | 2 |
| 类型定义 (UseDifyPath, UseDifyNodesPath) | 2 | 6 |
| 文档 / README | 5 | 10+ |
| 构建/脚本 | 3 | 4 |
| 样式文件 | 2 | 2 |

---

## 六、关键模式识别

1. **品牌展示链**: `DifyLogo` 组件被广泛复用 — 在 Header、Signin、Form、Education、Billing、Chat 等多个页面中出现
2. **版本兼容性**: Plugin 系统中有完整的 `isDifyVersionCompatible` 检测逻辑，贯穿 plugin-item、install 等多个组件
3. **API 标识**: 通过 `X-Dify-Version` 请求头标识前端版本
4. **类型系统**: `UseDifyPath` / `UseDifyNodesPath` 类型定义用于文档路径
5. **i18n 全覆盖**: 品牌名在 23 种语言的翻译文件中统一出现，Key 覆盖登录、通用、工作流、插件、定价、教育等模块