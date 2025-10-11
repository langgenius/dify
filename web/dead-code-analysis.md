# 死代码分析报告

**生成时间**: 2025-10-11
**检测工具**: Knip v5.64.1
**检测范围**: web/ 目录（组件和页面）

## 执行摘要

- 🔍 检测到 155 个未使用的文件
- 📤 检测到 130 个未使用的导出
- ✅ 安全删除分类
- ⚠️ 需要保留的文件

---

## 未使用文件分类

### 类别 1: 图标组件 (32 个文件) - 建议删除

**分析**: 这些图标文件未被直接引用，因为应用使用动态 URL 加载图标（通过 API 返回的 `icon_small`）

```
app/components/base/icons/src/image/llm/BaichuanTextCn.tsx
app/components/base/icons/src/image/llm/index.ts
app/components/base/icons/src/image/llm/Minimax.tsx
app/components/base/icons/src/image/llm/MinimaxText.tsx
app/components/base/icons/src/image/llm/Tongyi.tsx
app/components/base/icons/src/image/llm/TongyiText.tsx
app/components/base/icons/src/image/llm/TongyiTextCn.tsx
app/components/base/icons/src/image/llm/Wxyy.tsx
app/components/base/icons/src/image/llm/WxyyText.tsx
app/components/base/icons/src/image/llm/WxyyTextCn.tsx
app/components/base/icons/src/public/model/Checked.tsx
app/components/base/icons/src/public/model/index.ts
app/components/base/icons/src/public/plugins/Google.tsx
app/components/base/icons/src/public/plugins/index.ts
app/components/base/icons/src/public/plugins/WebReader.tsx
app/components/base/icons/src/public/plugins/Wikipedia.tsx
app/components/base/icons/src/public/thought/DataSet.tsx
app/components/base/icons/src/public/thought/index.ts
app/components/base/icons/src/public/thought/Loading.tsx
app/components/base/icons/src/public/thought/Search.tsx
app/components/base/icons/src/public/thought/ThoughtList.tsx
app/components/base/icons/src/public/thought/WebReader.tsx
app/components/base/icons/src/vender/line/layout/AlignLeft01.tsx
app/components/base/icons/src/vender/line/layout/AlignRight01.tsx
app/components/base/icons/src/vender/line/layout/Grid01.tsx
app/components/base/icons/src/vender/line/layout/index.ts
app/components/base/icons/src/vender/line/layout/LayoutGrid02.tsx
app/components/base/icons/src/vender/line/mapsAndTravel/index.ts
app/components/base/icons/src/vender/line/mapsAndTravel/Route.tsx
app/components/base/icons/src/vender/line/users/index.ts
app/components/base/icons/src/vender/line/users/User01.tsx
app/components/base/icons/src/vender/line/users/Users01.tsx
app/components/base/icons/src/vender/line/weather/index.ts
app/components/base/icons/src/vender/line/weather/Stars02.tsx
app/components/base/icons/src/vender/solid/arrows/ChevronDown.tsx
app/components/base/icons/src/vender/solid/arrows/HighPriority.tsx
app/components/base/icons/src/vender/solid/arrows/index.ts
app/components/base/icons/src/vender/solid/layout/Grid01.tsx
app/components/base/icons/src/vender/solid/layout/index.ts
app/components/base/icons/assets/vender/knowledge/index.ts
```

**安全性**: ✅ 高 - 已验证图标通过 API URL 动态加载

---

### 类别 2: Demo/Mock 数据文件 (6 个文件) - 建议删除

**分析**: 演示和测试数据，不用于生产环境

```
app/components/base/form/form-scenarios/demo/contact-fields.tsx
app/components/base/form/form-scenarios/demo/index.tsx
app/components/base/form/form-scenarios/demo/shared-options.tsx
app/components/base/form/form-scenarios/demo/types.ts
app/components/datasets/create/website/base/mock-crawl-result.ts
app/components/workflow/store/workflow/debug/mock-data.ts
app/components/tools/mcp/mock.ts
service/demo/index.tsx
```

**安全性**: ✅ 高 - 演示和模拟数据文件

---

### 类别 3: 数据源配置组件 (10 个文件) - 建议删除

**分析**: Notion 和网站数据源的旧配置页面，已被新实现替代

```
app/components/header/account-setting/data-source-page/data-source-notion/index.tsx
app/components/header/account-setting/data-source-page/data-source-notion/operate/index.tsx
app/components/header/account-setting/data-source-page/data-source-website/config-firecrawl-modal.tsx
app/components/header/account-setting/data-source-page/data-source-website/config-jina-reader-modal.tsx
app/components/header/account-setting/data-source-page/data-source-website/config-watercrawl-modal.tsx
app/components/header/account-setting/data-source-page/data-source-website/index.tsx
app/components/header/account-setting/data-source-page/panel/config-item.tsx
app/components/header/account-setting/data-source-page/panel/index.tsx
app/components/header/account-setting/data-source-page/panel/types.ts
app/components/datasets/documents/create-from-pipeline/data-source/online-drive/connect/index.tsx
app/components/datasets/documents/create-from-pipeline/data-source/online-drive/header.tsx
```

**安全性**: ✅ 高 - 旧实现已被替代

---

### 类别 4: 未使用的配置和工具组件 (107 个文件) - 建议删除

**分析**: 各种未使用的 UI 组件、工具函数和配置文件

详细列表见附录 A。

**安全性**: ✅ 中高 - 已通过 knip 检测确认未使用

---

## 未使用导出分析

### 类别 A: Service 层导出 (60+ 个) - 需谨慎

**分析**: 这些可能被外部脚本或未来功能使用

**建议**: 保留暂不删除，或添加 `@deprecated` 标记

### 类别 B: 组件内部导出 (30+ 个) - 可删除

**分析**: 组件内未使用的辅助函数和常量

**建议**: 可安全删除

### 类别 C: Hook 和上下文 (20+ 个) - 可删除

**分析**: 未使用的自定义 hooks

**建议**: 可安全删除

---

## 删除策略

### 第一批：低风险删除 (建议立即执行)

1. ✅ 所有 demo 和 mock 文件 (8 个)
2. ✅ 未使用的图标组件 (40 个)
3. ✅ 数据源旧配置页面 (10 个)

**预计影响**: 无，这些文件明确未被使用

---

### 第二批：中等风险删除 (需验证后执行)

1. ⚠️ App 配置相关组件 (20+ 个)
2. ⚠️ Workflow 节点工具函数 (15+ 个)
3. ⚠️ 表单和输入组件 (10+ 个)

**预计影响**: 低，但需要完整构建验证

---

### 暂不删除 (保留观察)

1. 🔒 Service 层未使用导出 - 可能有外部调用
2. 🔒 复杂类型定义 - 可能被类型推断使用
3. 🔒 上下文提供者 - 可能有间接依赖

---

## 验证计划

每批删除后执行：

```bash
cd /workspaces/dify-2/web
pnpm lint              # ESLint 检查
pnpm type-check        # TypeScript 类型检查（实际是 tsc --noEmit）
pnpm build             # Next.js 生产构建
pnpm test              # Jest 测试套件
```

---

## 附录 A: 完整未使用配置和工具组件列表

```
app/components/app/configuration/base/icons/citation.tsx
app/components/app/configuration/base/icons/more-like-this-icon.tsx
app/components/app/configuration/base/icons/remove-icon/index.tsx
app/components/app/configuration/base/icons/suggested-questions-after-answer-icon.tsx
app/components/app/configuration/config-var/select-type-item/index.tsx
app/components/app/configuration/config/agent/prompt-editor.tsx
app/components/app/configuration/config/assistant-type-picker/index.tsx
app/components/app/configuration/config/feature/use-feature.tsx
app/components/app/configuration/ctrl-btn-group/index.tsx
app/components/app/configuration/dataset-config/card-item/index.tsx
app/components/app/configuration/dataset-config/type-icon/index.tsx
app/components/app/configuration/prompt-mode/advanced-mode-waring.tsx
app/components/app/configuration/prompt-value-panel/utils.ts
app/components/app/configuration/tools/index.tsx
app/components/base/auto-height-textarea/common.tsx
app/components/base/chat/chat/thought/panel.tsx
app/components/base/chat/chat/thought/tool.tsx
app/components/base/copy-btn/index.tsx
app/components/base/custom-icon/index.tsx
app/components/base/divider/with-label.tsx
app/components/base/float-popover-container/index.tsx
app/components/base/form/components/field/mixed-variable-text-input/index.tsx
app/components/base/form/components/field/mixed-variable-text-input/placeholder.tsx
app/components/base/form/components/field/variable-or-constant-input.tsx
app/components/base/form/form-scenarios/input-field/utils.ts
app/components/base/form/form-scenarios/node-panel/field.tsx
app/components/base/form/form-scenarios/node-panel/types.ts
app/components/base/image-uploader/audio-preview.tsx
app/components/base/image-uploader/chat-image-uploader.tsx
app/components/base/image-uploader/video-preview.tsx
app/components/base/install-button/index.tsx
app/components/base/logo/logo-site.tsx
app/components/base/markdown-blocks/index.ts
app/components/base/markdown-blocks/pre-code.tsx
app/components/base/prompt-editor/plugins/tree-view.tsx
app/components/base/radio-card/simple/index.tsx
app/components/base/select/locale.tsx
app/components/base/tag-management/tag-remove-modal.tsx
app/components/billing/header-billing-btn/index.tsx
app/components/datasets/api/index.tsx
app/components/datasets/create-from-pipeline/create-options/create-from-dsl-modal/dsl-confirm-modal.tsx
app/components/datasets/create/step-two/preview-item/index.tsx
app/components/datasets/create/stop-embedding-modal/index.tsx
app/components/datasets/create/website/jina-reader/base/url-input.tsx
app/components/datasets/preview/index.tsx
app/components/header/account-setting/Integrations-page/index.tsx
app/components/header/account-setting/key-validator/hooks.ts
app/components/header/account-setting/key-validator/index.tsx
app/components/header/account-setting/key-validator/KeyInput.tsx
app/components/header/account-setting/key-validator/Operate.tsx
app/components/header/account-setting/model-provider-page/provider-added-card/add-model-button.tsx
app/components/header/account-setting/plugin-page/index.tsx
app/components/header/account-setting/plugin-page/SerpapiPlugin.tsx
app/components/header/account-setting/plugin-page/utils.ts
app/components/header/app-back/index.tsx
app/components/header/app-selector/index.tsx
app/components/plugins/plugin-auth/utils.ts
app/components/plugins/plugin-detail-panel/tool-selector/tool-credentials-form.tsx
app/components/plugins/plugin-page/filter-management/constant.ts
app/components/plugins/plugin-page/filter-management/store.ts
app/components/share/text-generation/result/content.tsx
app/components/share/text-generation/result/header.tsx
app/components/tools/add-tool-modal/category.tsx
app/components/tools/add-tool-modal/index.tsx
app/components/tools/add-tool-modal/tools.tsx
app/components/tools/add-tool-modal/type.tsx
app/components/tools/labels/store.ts
app/components/with-i18n.tsx
app/components/workflow/block-selector/use-check-vertical-scrollbar.ts
app/components/workflow/header/global-variable-button.tsx
app/components/workflow/nodes/_base/components/input-field/add.tsx
app/components/workflow/nodes/_base/components/input-field/index.tsx
app/components/workflow/nodes/_base/components/retry/utils.ts
app/components/workflow/nodes/_base/components/variable/assigned-var-reference-popup.tsx
app/components/workflow/nodes/answer/utils.ts
app/components/workflow/nodes/assigner/components/var-list/use-var-list.ts
app/components/workflow/nodes/code/dependency-picker.tsx
app/components/workflow/nodes/code/utils.ts
app/components/workflow/nodes/end/utils.ts
app/components/workflow/nodes/http/components/key-value/bulk-edit/index.tsx
app/components/workflow/nodes/loop/components/condition-files-list-value.tsx
app/components/workflow/nodes/loop/components/condition-value.tsx
app/components/workflow/nodes/loop/insert-block.tsx
app/components/workflow/nodes/question-classifier/utils.ts
app/components/workflow/nodes/start/utils.ts
app/components/workflow/nodes/template-transform/utils.ts
app/components/workflow/nodes/tool/components/input-var-list.tsx
app/components/workflow/nodes/tool/utils.ts
app/components/workflow/nodes/variable-assigner/components/node-variable-item.tsx
app/components/workflow/nodes/variable-assigner/components/var-list/use-var-list.ts
app/components/workflow/run/loop-result-panel.tsx
app/components/workflow/utils/debug.ts
hooks/use-moderate.ts
models/user.ts
service/knowledge/use-hit-testing.ts
utils/context.ts
```

---

## 执行记录

- **2025-10-11**: 初始检测完成
- **待定**: 第一批删除
- **待定**: 第二批删除
- **待定**: 最终验证

---

## 备注

1. 所有删除操作可通过 Git 回滚
2. 建议在独立分支执行
3. 每批删除后进行完整测试
4. Service 层导出建议保留至与后端团队确认


