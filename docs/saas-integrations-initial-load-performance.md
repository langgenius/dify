# SaaS Integrations 首次加载性能优化清单

> 状态（2026-07-22）：Built-in Tools 已完成三项前端改动：Integration 分类首批改为 30 条并自动加载下一页；字符串卡片图标改用带尺寸的原生 `<img>` 并对非首屏图片启用懒加载；Integration 分类页面离开后只保留 Infinite Query 的第一页。2026-07-22 的 Slow 4G Warm trace 新确认：历史分页缓存会造成约 90 张卡片重新 mount 并顺序刷新 3 页；30 条列表响应和单个原始图标仍然过大。
>
> Model Provider 已完成独立 Cold/Warm HAR 与 Performance Trace 分析：**RSC 仅约 175–179ms，不是主要问题**；关键路径是 `plugin/model/list` 约 4.44s、随后 46 个版本 GET + 46 个 OPTIONS，以及首屏不必要的 System Model、Marketplace 和图标工作。2026-07-22 已完成两项前端改动：版本历史仅在对应 Popover 打开后请求；System Model 的四类候选模型仅在 Dialog 打开后请求。底部 Marketplace 的“首批 20 条 + 滚动分页 + 第一页缓存”方案已撤回，待单独复审；下一优先级是 Summary API；Quota / Model Selector 的固定 Provider 安装查询暂不处理；Provider 图标缩略图与缓存暂缓。
>
> **接口边界澄清（2026-07-22）：** `/plugin/model/list` 是「已安装 Model Plugin 的完整管理列表」，不是 Provider 卡片主体的数据源；卡片主体来自 `/workspaces/current/model-providers`。因此优化目标不是用 Plugin summary 替代 Provider card，而是让 Provider card 先由 Provider summary 画出，再按时机加载已安装 Plugin summary 和交互详情。

## 目标与边界

目标是缩短用户首次进入 **Integrations** 后，到首屏可操作内容出现的时间，并避免首屏发起与当前操作无关的大请求。

这里的“首次加载”分为两段：

1. **点击到有界面反馈**：用户从 Console 进入 Integrations，应该很快看到稳定的页面或骨架。
2. **界面反馈到内容可用**：首屏所需数据返回，并完成必要的卡片渲染。

这两个阶段的问题不同，不能只用一个“加载更快”的指标混在一起判断。

本文只记录已通过代码确认的候选问题。实际优先级应在生产构建下，用 Chrome Network/HAR、Performance trace 和可重复的 Playwright 测量确认后再调整。

## Model Provider 调查结论（已由 HAR、Trace 与代码确认）

测试对象为 `/integrations/model-provider`，条件为 Fast 4G、CPU 4× slowdown。Cold 使用独立首次导航；Warm Trace 的后段包含 Extension 和再次进入 Model Provider，因此 Warm 只分析第一次目标导航窗口，总量以 HAR 为准。

### 先给结论

Model Provider **不是 SSR 慢**。RSC 只用了约 175–179ms；页面变慢是以下几层叠加：

1. `plugin/model/list` 服务端等待约 3.92s，且返回了 3.447MB 解码后的完整已安装 Model Plugin 管理对象；
2. 已安装 Plugin 列表返回后，46 张 Provider 卡片获得 Plugin detail 并同时挂载版本选择器，立刻发出 46 个 `versions` GET 和 46 个 CORS OPTIONS；
3. 用户尚未打开 System Model 弹窗，页面已经请求 embedding、rerank、speech2text、tts 四类模型列表；
4. 页面同时请求 98 个 Marketplace 搜索结果和 10 个 pinned 结果，并一次性挂载卡片；
5. Provider 图标使用原始资产且缓存策略不足，Cold 图片传输占约 78%。

### 已确认的目标加载边界（后续实现以此为准）

| 阶段 | 数据 / 接口 | 目的 | 是否应在首屏立即请求 |
| --- | --- | --- | --- |
| 1. 卡片主体 | `GET /workspaces/current/model-providers?view=summary`（待提供） | Provider 名称、图标、描述、模型类型、认证/额度状态摘要 | 是 |
| 2. 已安装 Plugin 摘要 | `GET /workspaces/current/plugin/model/list?view=summary`（待提供） | `plugin_id`、来源、当前版本、是否有更新；用于版本徽标和升级入口 | 卡片主体首次可见后加载，不能与主体争抢 Cold 网络 |
| 3. 单 Plugin 版本历史 | Marketplace `/plugins/:plugin_id/versions` | 用户在版本选择器中选择历史版本 | 否，只在 Popover 打开时 |
| 4. Provider 模型列表 | `/workspaces/current/model-providers/:provider/models` | 用户点击「Show Models」后显示该 Provider 的模型 | 否，现有 `expanded` 按需查询保持不变 |
| 5. 认证 / 自定义模型详情 | Provider credential / configuration detail（需补齐 detail contract） | API Key 列表、表单 schema、custom models | 否，只在相应面板打开时 |

### 暂缓方案：先 Provider、后现有完整 Plugin List

**状态：已实施前端请求调度；仍待 Summary API 方案验证。**

在尚未提供 `/plugin/model/list?view=summary` 前，曾评估将现有完整 `plugin/model/list?page=1&page_size=100` 改为仅在 `/model-providers` 成功后才通过 TanStack Query 的 `enabled` 发起；不使用 `useEffect`。这样 Provider 卡片会先出现，版本徽标、更新提示和 Plugin 操作随后补齐。

该方案只能改善首屏视觉优先级，**不会减少**完整列表约 3.45MB 解码数据、约 7.93s 请求耗时，或列表返回后版本请求 fan-out 的成本；它将共享 `useInstalledPluginList` 改为正向 `enabled` 参数，并从 Provider Context 读取 Model Provider Query 的成功状态。当前仍优先推进版本选择器按打开加载、System Model 按打开加载和 Summary API；该调度层不是替代方案。

**注意：**第 3 项版本历史接口不应改成 summary；用户既然打开版本选择器，就需要该 Plugin 的完整可选版本。需要收窄的是第 2 项当前 3.447MB 的完整已安装 Plugin 管理列表。

### 实施状态与下一步

| 项目 | 状态 | 当前实现 / 后续边界 |
| --- | --- | --- |
| Provider card 与完整 Plugin List 解耦 | 已完成 | Provider Query 成功后才启用已安装 Model Plugin List；卡片主体不再等待 Plugin 管理列表。 |
| 单 Plugin 版本历史 | 已完成 | `PluginVersionPicker` 仅在 Popover 打开且可操作时启用 versions Query；首屏 versions GET/OPTIONS 目标为 0。 |
| System Model 候选模型 | 已完成 | Dialog 的本地 `open` 通过 Query `enabled` 控制 embedding、rerank、speech2text、tts；关闭 Dialog 时不请求，缓存保留供再次打开使用。 |
| 已安装 Plugin Summary API | 下一项 | 后端提供 `plugin/model/list?view=summary`，前端保持当前 gate，仅消费版本徽标、来源、升级状态等卡片增强字段。 |
| Marketplace 安装列表分页 | 暂缓 | “首批 `page_size=20` + 列表尾部滚动取下一页”的本地实现已撤回，等待对数据源、加载时机与缓存所有权的单独复审。 |
| Marketplace 分页缓存 | 暂缓 | 第一页缓存裁剪实现已随分页方案撤回；后续若重新实施，需先明确 query owner，并在裁剪前取消精确的在途分页请求。 |
| Quota / Model Selector 固定 Provider 安装 | 暂缓 | 两处都是“按已知 `plugin_id` 安装一个 Provider”却复用全量 Marketplace 列表的问题；作为同一项后续处理，不纳入本轮。 |
| Provider 图标缩略图与缓存 | 部分完成 | 与 Built-in Tools 共享“原始图过大、缓存不足”的后端资产问题。Model Provider 的 `ProviderIcon` / `ModelIcon` 已补原生 `<img loading="lazy">`、固定尺寸和异步解码；仍待后端提供 40/80px 缩略图、ETag 或版本化缓存 URL，才能降低原始图片传输。 |

#### Marketplace 当前实现与暂缓的 Quota 定向查询

`InstallFromMarketplace` 仍随 Model Provider 页面显示，当前恢复为原有 `page_size=1000` 的列表查询。首批 20 条、滚动分页与第一页缓存的本地改动已撤回；后续先复审是否应延迟整个安装区的请求，再决定分页和缓存策略。

Cloud 的 `QuotaPanel` 与 `ModelSelector` 内的额度 Provider 安装入口仍会为固定 `plugin_id` 复用全量 Marketplace 数据；两者归为同一项，当前明确暂缓。后续应改为单 Plugin 或小批固定 Plugin ID 查询，而不是将列表分页结果当作安装详情来源。

### Cold / Warm 数据

| 指标 | Cold | Warm | 结论 |
| --- | --- | --- | --- |
| HAR 请求 / 传输 | 403 requests / 5.397MB | 175 requests / 2.075MB | Warm 的差异主要来自 Query 与资源缓存。 |
| DevTools Resources | 12.0MB | 2.9MB | 首次进入资源成本明显偏高。 |
| 目标 RSC | 约 175–179ms | 约 175–179ms | 不应把根因归为 SSR。 |
| 图片 | 239 requests / 4.231MB | 148 requests / 2.021MB | Cold 图片约占总传输 78%；Warm 仍有 MB 级传输。 |
| `plugin/model/list` | 4.439s | 缓存后不再是首屏 blocker | 完整 Plugin 管理列表会与 Provider card 主体、图标等首屏资源争抢网络；不应在卡片主体前加载。 |
| 版本请求 | 46 GET + 46 OPTIONS；1,028 条版本记录 | 0（命中 Query cache） | Warm 快不代表首屏 eager 请求合理。 |

### Cold 关键时间线

| 相对导航 | 请求 / 事件 | 数据 | 含义 |
| --- | --- | --- | --- |
| 0–179ms | Model Provider RSC | 约 175–179ms | 路由壳返回快，排除 SSR 为主因。 |
| +1.862s → +6.301s | `plugin/model/list?page=1&page_size=100` | 4.439s；Waiting 3.917s；83.8KB transfer；3.447MB decoded；46 个已安装 Model Plugin | 完整 Plugin 管理列表与 Provider card 主体并发；它不应决定卡片 skeleton 结束，但会占用 Cold 首屏网络并触发后续版本请求。 |
| +1.863s → +2.870s | Marketplace advanced search | 1.007s；98 plugins | 主列表未完成时，页面已经启动下方 Marketplace。 |
| +1.866s → +2.348s | Marketplace pinned collection | 约 0.482s；10 plugins；653.6KB decoded | 首屏并发了不属于当前操作的推荐数据。 |
| +6.692s → +6.713s | 46 个 `versions` GET + 46 个 OPTIONS | 约 21ms 内启动；1,028 条记录；约 0.495MB decoded | 形成 `provider list → 版本请求 fan-out` 的真实依赖瀑布。 |
| +6.717s → +7.045s | `latest-versions` | 约 328ms | 批量摘要可保留，逐卡版本详情应按需请求。 |

### 后端等待、负载和浏览器成本

| 现象 | 直接证据 | 代码层根因 | 建议 |
| --- | --- | --- | --- |
| 已安装 Model Plugin 列表过重 | `plugin/model/list` 4.439s；Waiting 3.917s；46 plugins；3.447MB decoded | Controller 直接编码 daemon 返回的完整 `plugins`；46 个 `declaration` 合计约 2.48MB，最大单项约 627KB。 | 列表改用安装摘要 DTO，并在 Provider card 主体首次可见后加载；加 `Server-Timing` 分解 Console→daemon、组装、序列化和压缩。 |
| 关闭弹窗也请求模型列表 | rerank 3.834s、speech2text 2.425s、tts 2.346s、embedding 1.735s | `SystemModelSelector` 挂载即执行四个 query。 | 只在弹窗第一次打开后启用；首屏只保留必要的 default model summary。 |
| 版本请求数量过多 | 46 GET + 46 OPTIONS | 每张 Provider card 都挂载 `PluginVersionPicker`，Picker mount 后即调用版本 query。 | query 仅在 Popover 打开后启用；hover/focus 仅作可取消的预取。 |
| Marketplace 过度查询和渲染 | 98 search + 10 pinned；无搜索时 `page_size=1000` | `useMarketplaceAllPlugins` 合并并一次性渲染 Marketplace cards；Quota Panel 也依赖该全量数据。 | 默认折叠或进入视口加载；首批限制 20–30；Quota 改成目标 Provider 的窄查询。 |
| DOM 和主线程负担 | DOM 5,863 → 19,055；listeners 1,422 → 2,765；Cold 4 个 ≥50ms 长任务，最大 378.3ms | Provider、Marketplace 和图标集中完成后一次性 mount。 | 先消除无效 query，再渐进或分页渲染；目标初始无 >200ms task。 |
| 图标成本过高 | Cold 图片 4.231MB；单图 233–564KB；Warm 仍 2.021MB | icon 直接返回原始 bytes，`Cache-Control: no-cache`、无 ETag；卡片没有列表缩略图。 | 生成 40/80px 缩略图、建议 ≤30KB；用 ETag 或版本化 immutable URL。 |

### 代码定位

| 层级 | 位置 | 已确认行为 |
| --- | --- | --- |
| 前端 | [provider-card-actions.tsx](/web/app/components/header/account-setting/model-provider-page/provider-added-card/provider-card-actions.tsx:85) | 每张已安装 Provider card 都挂载 `PluginVersionPicker`。 |
| 前端 | [plugin-version-picker.tsx](/web/app/components/plugins/update-plugin/plugin-version-picker.tsx:51)、[use-plugins.ts](/web/service/use-plugins.ts:733) | 已改为 Popover 打开且可操作时才启用 `/plugins/:id/versions?page_size=100`。 |
| 前端 | [index.tsx](/web/app/components/header/account-setting/model-provider-page/index.tsx:50) | 首屏初始化 5 个 default-model query 和 installed model plugins query。 |
| 前端 | [system-model-selector/index.tsx](/web/app/components/header/account-setting/model-provider-page/system-model-selector/index.tsx:69) | 已改为 Dialog 打开时才请求四类 model-type 列表。 |
| 前端 | [hooks.ts](/web/app/components/header/account-setting/model-provider-page/hooks.ts:203)、[install-from-marketplace.tsx](/web/app/components/header/account-setting/model-provider-page/install-from-marketplace.tsx:35) | 安装列表当前使用原有全量查询；首批 20 条、滚动分页与第一页缓存方案已撤回，Quota / Model Selector 同样仍使用默认 `page_size=1000`。 |
| 后端 | [plugin.py](/api/controllers/console/workspace/plugin.py:539)、[plugin.py](/api/core/plugin/impl/plugin.py:79) | Model category list 透传 plugin-daemon `management/model/list` 的完整结果。 |
| 后端 | [models.py](/api/controllers/console/workspace/models.py:631)、[model_provider_service.py](/api/services/model_provider_service.py:421)、[provider_manager.py](/api/core/provider_manager.py:601) | model-type 请求分别构建 ProviderConfigurations 和对应模型列表。 |
| 后端 | [model_providers.py](/api/controllers/console/workspace/model_providers.py:300) | icon 直接 `send_file(BytesIO)`，没有缩略图、长期缓存或 ETag。 |

### Model Provider 建议实施顺序

1. **MP-P0：版本选择器按用户意图加载（已完成）。** 首次进入前 `versions` GET=0、OPTIONS=0；打开一张卡时只请求这张卡。
2. **MP-P0：System Model 弹窗按打开时加载（已完成）。** 弹窗关闭时四类 model-type 请求均为 0。
3. **MP-P0：收窄 `plugin/model/list` 为 Summary API（下一项）。** 列表 endpoint 只返回安装摘要字段，并保留 Provider card 主体成功后的加载时机；目标 p75 <400ms、decoded <500KB；先补 `Server-Timing` 再决定 daemon、缓存或序列化的具体优化。
4. **MP-P1：Quota / Model Selector 的固定 Provider 定向查询（暂缓）。** 两处合并为同一项；仅在实际点击安装时按已知 `plugin_id` 获取安装所需字段。
5. **MP-P1：Provider 图标缩略图与缓存（部分完成）。** `ProviderIcon` / `ModelIcon` 已对齐原生 `<img loading="lazy">`、固定尺寸和异步解码；仍需后端缩略图和 ETag / 版本化缓存，才能根治原始图标过大的传输成本。
6. **MP-P1：渐进渲染卡片。** 当前面工作完成后再评估分页、分批 mount 或 virtualization，目标初始无 >200ms long task。

## Built-in Tools 调查结论

已有 Cold / Warm 调查给出的现象是：首批列表约 100 条、图标使用原始大图、列表全量 mount，并存在约 1 秒的 plugin-daemon 服务等待。Feishu 中的 Network、Performance 和图片明细没有随本文一起提供，因此具体请求数量、图片字节数和时间分段仍以原始 HAR / trace 为准；下面的代码链路已经能够解释这些现象。

### 页面实际做了什么

Built-in Tools 不是一次请求或单一瀑布，而是四层成本叠加：

1. **首屏列表请求过宽（已处理）**：原先页面用 `page_size=100` 请求已安装的 Tool Plugin；现在 Integration 分类页首批请求 30 条，同时接口仍返回 hardcoded Built-in Tool Provider。
2. **非首屏 Marketplace 提前工作**：页面底部 Marketplace 在首次 mount 时立即获取所有 Tool Provider，用它们计算 Marketplace 的 `exclude`，随后继续请求 Marketplace collections / plugins。
3. **拿到数据后一次渲染全部卡片（已缓解）**：原先首批 100 条已安装 Tool Plugin 会与 Built-in Tool Provider 一起直接 `.map()`。现在首批只 mount 30 条 Plugin，滚动接近列表末尾时再加载下一页；每个已加载页内部仍是普通 Grid 渲染。
4. **所有已 mount 卡片立即下载原始图标（已缓解，资产大小待测）**：原先卡片用 CSS `background-image` 显示 icon，无法使用原生图片懒加载。现在字符串 icon 使用原生 `<img loading="lazy">`；后端仍返回源 icon 文件，尚无列表缩略图规格。

### 两条 plugin-daemon 链路

**主列表链路**

```text
Built-in Tools 页面
  -> GET /workspaces/current/plugin/tool/list?page=1&page_size=30
  -> PluginService.list_by_category(...)
  -> plugin-daemon /management/tool/list
  -> 等 daemon 返回后，再组装 hardcoded builtin_tools
  -> 前端结束列表 loading
```

- 前端请求：[plugins-panel.tsx](/web/app/components/plugins/plugin-page/plugins-panel.tsx:91)
- 前端请求参数：[use-plugins.ts](/web/service/use-plugins.ts:609)
- API 串行等待点：[plugin.py](/api/controllers/console/workspace/plugin.py:539)
- plugin-daemon 调用：[plugin.py](/api/core/plugin/impl/plugin.py:79)

这条链路说明：已有数据中的约 1 秒 plugin-daemon 等待是首屏响应时间的后端下限。前端可以减少额外工作，但不能让这个同步等待本身消失。

**Marketplace 附加链路**

```text
Built-in Tools 主列表 mount
  -> 页面底部 BuiltinMarketplacePanel 同时 mount
  -> useMarketplace()
  -> GET /workspaces/current/tool-providers
  -> ToolManager.list_builtin_providers()
  -> plugin-daemon /management/tools?page=1&page_size=256
  -> 完整 provider/tool schema 在 API 内转换
  -> 再请求 Marketplace collections / plugins
```

- Marketplace 挂载点：[plugins-panel-results.tsx](/web/app/components/plugins/plugin-page/plugins-panel-results.tsx:159)
- 立即执行的数据 Hook：[use-tool-marketplace-panel.ts](/web/app/components/integrations/hooks/use-tool-marketplace-panel.ts:11)
- 未限制类型的 Provider 请求：[hooks.ts](/web/app/components/tools/marketplace/hooks.ts:11)
- `/tool-providers` 服务链路：[tool_providers.py](/api/controllers/console/workspace/tool_providers.py:483)
- plugin-daemon `page_size=256`：[tool.py](/api/core/plugin/impl/tool.py:18)

这条请求只为页面底部 Marketplace 计算排除项，却与主列表争抢首屏资源。API 本身支持 `type=builtin`，但当前前端没有传；更进一步，Tool 类别列表已经包含已安装 Tool Plugin，理论上可以直接从主查询结果推导 `exclude`，避免第二次 Provider 聚合。实施前需要确认 bundle / 多类别 Plugin 的排除语义。

### `/workspaces/current/tool-providers` 当前返回什么

当前前端通过 `useAllToolProviders()` 请求 `/workspaces/current/tool-providers`，没有传 `type` 参数。因此后端默认聚合以下 Provider：

- Built-in Tools；
- 已安装的 Plugin Tools；
- API Tools；
- Workflow Tools；
- MCP Tools。

接口最终返回一个 Provider 数组，而不是只返回插件 ID。每个 Provider 主要包含：

- `id`、`name`、`plugin_id`、`plugin_unique_identifier`；
- `description`、`label`、`icon`、`icon_dark`；
- `type`、`team_credentials`、`is_team_authorization`、`allow_delete`；
- `tools`、`labels`；
- MCP 或 Workflow Provider 额外的配置字段。

公共响应结构定义在 [api_entities.py](/api/core/tools/entities/api_entities.py:28)，接口入口在 [tool_providers.py](/api/controllers/console/workspace/tool_providers.py:483)。

需要特别区分“最终返回给前端的数据”和“后端为了生成这些数据做的工作”：

1. Built-in、Plugin、API 和 Workflow Provider 的最终 `tools` 通常为空，MCP Provider 可能包含工具定义。
2. Plugin Provider 在后端仍会请求 plugin-daemon 的 `management/tools` 接口，参数为 `page=1&page_size=256`。
3. plugin-daemon 返回 Provider 和 Tool 定义后，API 会遍历 Tool，并处理 `output_schema` 中的 `$ref`，之后才转换成前端响应。
4. Marketplace 这条前端链路最终只使用返回结果里的 `plugin_id`，用来生成已安装插件的 `exclude` 列表；它并不使用 Provider 的完整 `tools`、schema 或配置字段。

因此，这个请求的本质问题是：**前端只需要一组已安装 Plugin ID，后端却执行了完整 Tool Provider 聚合和 Plugin Tool schema 转换。** 响应 JSON 看起来可能不大，但请求耗时仍然会受到 plugin-daemon 服务等待、Tool 遍历和 schema 转换影响。

这部分暂不实施。后续如果重新处理 Marketplace，候选方向按优先级为：

1. 让底部 Marketplace 接近可视区域或用户主动触发时再请求；
2. 确认主列表数据能否完整覆盖已安装 Plugin，再直接复用其 `plugin_id`；
3. 如不能安全复用，增加只返回已安装 Plugin ID 的轻量数据源；
4. 如果仍需调用当前接口，至少评估传 `type=builtin`，减少无关 Provider 聚合；
5. 对其他确实需要完整 Tool 定义的场景，再考虑拆分 Provider summary 和完整 Tool schema 链路。

在 Marketplace 重新排期前，不修改这条请求链路及相关前端组件。

### Cold 与 Warm 为什么都可能有成本

Integration 分类页显式设置了 `refetchOnMount: 'always'`。因此 Warm 场景即使 TanStack Query 中已有数据，重新 mount 仍会触发后台刷新；缓存可能让旧卡片更早显示，但不会消除服务端和网络成本。

- 位置：[plugins-panel.tsx](/web/app/components/plugins/plugin-page/plugins-panel.tsx:97)

图标接口仅设置一小时浏览器缓存。Warm 场景可能受益于 icon cache；Cold 场景会同时下载所有已 mount 卡片的源图并进行解码。

- CSS background icon：[card-icon.tsx](/web/app/components/plugins/card/base/card-icon.tsx:53)
- Built-in icon 原文件响应：[tool_providers.py](/api/controllers/console/workspace/tool_providers.py:664)
- Plugin icon 原文件响应：[plugin.py](/api/controllers/console/workspace/plugin.py:611)

## 已确认的前端工作项

### P0-1：版本下拉框在卡片挂载时就请求完整版本列表

**状态：已完成。** `PluginVersionPicker` 仅在 Popover 打开且可操作时启用 versions Query；首次进入不再为每张卡请求版本历史。

**问题**

每个已安装的 Model Provider 卡片都会使用 `PluginVersionPicker`。该组件一挂载就调用 `useVersionListOfPlugin(pluginID)`，即使用户从未打开“切换版本”下拉框，也会请求最多 100 个版本。

- 组件请求位置：[plugin-version-picker.tsx](/web/app/components/plugins/update-plugin/plugin-version-picker.tsx:51)
- 请求参数位置：[use-plugins.ts](/web/service/use-plugins.ts:733)

**为什么慢**

安装的 Provider 越多，首次进入页面时并发版本请求越多。版本数据只服务于用户主动打开的下拉框，不属于首屏展示的必需数据。

**修改核心逻辑**

把“组件存在”与“开始请求”分开：Popover 第一次打开时才启用 query；打开后保留 Query cache，后续再次打开不重复请求。

**实现范围**

- `web/app/components/plugins/update-plugin/plugin-version-picker.tsx`
- `web/service/use-plugins.ts`
- 对应的 `plugin-version-picker` 单测

**验收**

- 首次进入 Model Provider 页面时，不出现每张卡片各自的 `/plugins/:id/versions` 请求。
- 打开某张卡的版本下拉框后，只出现该 Provider 的一次请求。
- 关闭再打开同一张卡时复用 TanStack Query 缓存。

### P0-2：Quota Panel 为少量信息拉取 1000 条 Marketplace 插件

**状态：暂缓。** Quota Panel 与 Model Selector 的固定 Provider 安装入口归为同一项，后续以按 `plugin_id` 的窄查询处理。

**问题**

`QuotaPanel` 在页面挂载时调用 `useMarketplaceAllPlugins(providers, '')`。无搜索词时，这个 Hook 会请求 `page_size: 1000` 的 Model Marketplace 插件。

- 调用位置：[quota-panel.tsx](/web/app/components/header/account-setting/model-provider-page/provider-added-card/quota-panel.tsx:93)
- 大请求位置：[hooks.ts](/web/app/components/header/account-setting/model-provider-page/hooks.ts:227)

**为什么慢**

Quota Panel 只需要判断少数付费模型 Provider 是否可从 Marketplace 安装，却先下载并在浏览器合并大量插件数据。这会抢占首屏网络、JSON 解析和渲染资源。

**修改核心逻辑**

不要把“Marketplace 全量搜索结果”作为 Quota Panel 的数据源。改为请求或复用一个仅包含所需 Provider ID 的小结果集；若现有 Marketplace API 不支持精确查询，再新增一个窄接口。

**实现范围**

- 优先前端：为 Quota Panel 新建一个窄的 query / selector，避免调用 `useMarketplaceAllPlugins`。
- 如 Marketplace 无法按 ID 查询：增加后端支持（见 P1-8）。

**验收**

- 打开 Model Provider 页面时，不再出现 `page_size=1000` 的 Marketplace 请求。
- Quota Panel 原有的安装入口、已安装状态和权限判断保持正确。

### MP-P0-3：关闭的 System Model 弹窗不应加载四类模型列表

**状态：已完成。** 四类候选列表由 Dialog 本地 `open` 控制；关闭时不请求，打开后并发加载并复用 Query cache。

**问题**

用户尚未打开 System Model 弹窗时，页面已请求 embedding、rerank、speech2text、tts 四类模型列表。Cold 中这些请求分别约为 1.735s、3.834s、2.425s、2.346s，耗时主要是 Waiting，不是下载。

- 组件位置：[system-model-selector/index.tsx](/web/app/components/header/account-setting/model-provider-page/system-model-selector/index.tsx:69)
- 后端入口：[models.py](/api/controllers/console/workspace/models.py:631)
- 服务组装：[model_provider_service.py](/api/services/model_provider_service.py:421)

**修改核心逻辑**

将 query 的启用条件绑定到弹窗第一次打开，而不是组件 mount。首屏如果需要展示默认模型，只保留轻量 default model summary；打开弹窗后再并发加载四类可选列表，并复用已有 Query cache。

**验收**

- 首次进入 Model Provider、未打开弹窗时，四类 model-type 请求均为 0；
- 打开弹窗后，四类列表正常出现；
- 关闭后再次打开不重复请求仍然新鲜的数据；
- 现有默认模型展示和保存行为不变。

### P0-3：Built-in Tools 为非首屏 Marketplace 提前聚合全部 Provider

**状态：部分完成。** 底部安装列表已改为 20 条首批 + observer 分页 + 第一页缓存；Quota / Model Selector 的固定 Provider 查询仍暂缓，且安装区尚未改为默认折叠或视口触发。

**问题**

只要 Marketplace 功能开启，`BuiltinMarketplacePanel` 就随主列表一起 mount。它立即调用 `useAllToolProviders()` 获取所有 builtin、API、workflow 和 MCP Provider，随后再请求 Marketplace 内容。该数据只服务于页面底部的推荐区，不是 Built-in Tools 首屏必需数据。

- 挂载位置：[plugins-panel-results.tsx](/web/app/components/plugins/plugin-page/plugins-panel-results.tsx:159)
- 查询位置：[hooks.ts](/web/app/components/tools/marketplace/hooks.ts:11)
- API 已支持的 `type` 参数：[tool_providers.py](/api/controllers/console/workspace/tool_providers.py:94)

**为什么慢**

它创建了第二条 plugin-daemon 路径，并触发 Marketplace 网络、数据转换、卡片渲染和图片下载。这些工作与主列表争抢首屏资源，但用户可能根本没有滚动到 Marketplace。

**修改核心逻辑**

优先让 Marketplace 数据链只在接近可视区域或用户主动跳转到推荐区时启用。进一步复用主列表中已安装 Tool Plugin 的 ID 来计算 `exclude`，避免再次请求 `/tool-providers`。如果暂时不能复用，至少请求 `type=builtin`，不要聚合无关的 API / Workflow / MCP Provider。

**搜索 / 筛选语义约束（2026-07-22 调查）**

当前 Built-in Tools 的搜索词和 tag filter 同时传给已安装列表与 Marketplace。Marketplace 在有搜索词或 tag 时会按相同条件请求可安装 Plugin；因此不能仅以“滚动接近 Marketplace”为启用条件，否则用户搜索一个未安装 Plugin 时会错误地只看到空列表。

后续若实现延迟加载，应使用 `marketplaceActivated || hasActiveSearchOrTagFilter` 作为 Marketplace query 的 `enabled` 条件：

1. 无搜索、无筛选且未接近底部：不请求 Marketplace；
2. 用户输入搜索词或选择 tag：立即启用 Marketplace 查询，保持当前搜索结果语义；
3. 用户滚动接近推荐区或点击跳转箭头：启用默认推荐查询；
4. 一次页面停留内激活后保持激活，避免反复滚动导致重置请求。

实现时应让 Hook 始终按 React 规则调用，只将 `enabled` 传给内部 TanStack Query；不能用条件调用 Hook 来延迟请求。

**实现范围**

- `web/app/components/integrations/hooks/use-tool-marketplace-panel.ts`
- `web/app/components/tools/marketplace/hooks.ts`
- `web/app/components/plugins/plugin-page/plugins-panel.tsx`
- Marketplace 可见性和请求启用条件测试。

**验收**

- 首屏不再为了底部 Marketplace 请求 `/workspaces/current/tool-providers`。
- 首屏不请求 Marketplace collections / plugins。
- 滚动接近 Marketplace 或主动点击跳转后，推荐内容正常加载。
- 已安装 Tool Plugin 不会错误地再次出现在 Marketplace 推荐中。

### P0-4：Built-in Tools 首批请求 100 条并全量 mount

**状态：Cold 首批策略已完成；Warm 返回仍会恢复所有历史分页，见 P1-6。**

**问题**

原先 `PluginsPanel` 固定以 `page_size=100` 请求 Tool 类别；响应到达后，已安装 Tool Plugin 和全部 Built-in Tool Provider 都进入同一个 Grid 并直接 `.map()`。

- 请求大小：[plugins-panel.tsx](/web/app/components/plugins/plugin-page/plugins-panel.tsx:97)
- Plugin 卡片全量渲染：[list/index.tsx](/web/app/components/plugins/plugin-page/list/index.tsx:23)
- Built-in Tool 卡片全量渲染：[plugins-panel-results.tsx](/web/app/components/plugins/plugin-page/plugins-panel-results.tsx:128)

**为什么慢**

网络返回的数据越多，API 序列化、JSON 解析和 React 初次 commit 越重。100 条以上卡片全部 mount 后，浏览器还要计算样式并加载每张卡片的 icon。分页按钮存在，但首批大小已经过大。

**修改核心逻辑**

Integration 的 Tool、Trigger、Agent Strategy、Extension 首批 Plugin page size 已统一为 30。页面使用 `IntersectionObserver` 观察列表末尾的 sentinel；它接近可视区域时自动请求下一页。独立 `/plugins` 页面仍保持原有 100 条 + 手动 Load More 行为。

hardcoded Built-in Tool Provider 当前只有 4 个，虽然仍随第一响应返回并 mount，但量级很小，不作为单独性能问题处理。已加载很多页后只渲染可见卡片的真正 virtualization，主要改善长列表滚动和内存，不会明显缩短首屏；当前不做。

**实现范围**

- `web/app/components/plugins/plugin-page/plugins-panel.tsx`
- `web/app/components/plugins/plugin-page/plugins-panel-results.tsx`
- `web/app/components/plugins/plugin-page/plugins-panel-results.tsx`
- `web/app/components/plugins/plugin-page/__tests__/plugins-panel.spec.tsx`

**验收**

- 已验证：四个 Integration 分类均以 `page_size=30` 发起首批请求，末尾进入观察区后自动请求下一页；请求中或没有下一页时不会重复触发。
- 待实测：Cold / Warm HAR 中的首屏卡片数、初次 React commit、Long Task 与实际可交互时间。
- **后端依赖（未处理）**：当前搜索和标签筛选仍在前端对“已加载页”过滤。首批缩小为 30 后，搜索可能遗漏尚未加载页面的 Plugin。后端需要为 category list API 提供 query / tags 筛选和分页语义；届时 Tool、Trigger、Agent Strategy、Extension 都可共用同一套前端 query。

### P0-5：Built-in Tools 的原始 icon 随全部卡片立即加载

**状态：前端懒加载已完成；trace 已确认需要列表缩略图策略。**

**问题**

原先卡片用 CSS `background-image` 显示 icon。所有卡片一旦 mount，浏览器就会开始下载对应资源；CSS 背景图没有 `<img loading="lazy">` 的原生懒加载能力。API 返回源 icon 文件，没有列表缩略图或尺寸转换。

- Card icon：[card-icon.tsx](/web/app/components/plugins/card/base/card-icon.tsx:53)
- Card 调用位置：[tool-provider-card.tsx](/web/app/components/integrations/tool-provider-card.tsx:118)

**为什么慢**

Cold 场景会同时产生大量图片请求、传输和解码；即使最终只显示 40px 图标，也可能下载远大于展示尺寸的源文件。Warm 场景是否更快主要取决于一小时浏览器缓存是否命中。

**修改核心逻辑**

已通过 P0-4 减少首屏 mount 数量，并已将字符串 icon 改为有明确宽高的 `<img loading="lazy" decoding="async">`，保留原有成功/失败状态角标。该改动只控制请求和解码时机，不会压缩原始图片字节数。

2026-07-22 的 Slow 4G Warm trace 已记录 18 个 Plugin icon、合计 587 KB；其中一张 40px 展示的 PNG 为 487 KB，完整传输约 10.9 秒。没有超过 1ms 的图片 decode 事件，因此当前瓶颈是原始资产字节数和网络排队，而不是浏览器解码。

需要后端或静态资产链提供列表缩略图（例如 80px 或 96px），或在上传/发布时限制并预处理 icon。前端 `<img>` 懒加载保留；它只能减少非可见图片请求，不能压缩可见的大图。

**验收**

- Cold 首屏只请求已 mount / 临近可视区域卡片的 icon。
- 非首屏图片在滚动接近时才请求。
- 图片展示尺寸稳定，没有 CLS 或模糊放大。
- 记录图片请求数、总字节数和 decode 时间，而不只比较 Network Finish。

### P1-6：Warm mount 强制刷新 Tool 类别列表

**状态：已完成前端分页缓存窗口收敛；workspace revision / 变更事件仍待后端方案。**

**问题**

所有 Integration Category 页面都使用 `refetchOnMount: 'always'`。`useInstalledPluginList` 将 Infinite Query 已缓存的全部 `pages` 扁平为一个列表。因此用户此前滚到第 3 页后，Warm 返回 Built-in Tools 时会同时发生：

1. 立刻从缓存重新 mount 全部历史页的卡片，而不是只显示首批 30 条；
2. TanStack Query 顺序刷新已缓存的 page 1、2、3；
3. 刷新响应中的新对象引用使 `React.memo(PluginItem)` 无法跳过全部卡片更新。

2026-07-22 的 Slow 4G trace 中，3 页分别传输 152 KB、142 KB、116 KB，严格顺序完成；并记录到约 90 张缓存卡片的 React 工作造成 539ms 主线程长任务，最后一页更新又造成 87ms 长任务。

**修改核心逻辑**

本地安装、卸载、升级可通过 TanStack Query invalidation 更新；但工作空间可能有其他成员同时修改 Tool。仅依赖本地 invalidation 后移除 `refetchOnMount: 'always'`，会让用户返回页面时继续看到旧列表。

因此不能直接删除强制刷新。前端先处理“离开页面后保留多少缓存页”，后端仍需处理“何时需要刷新”的判断：

1. 用户停留在页面时，仍保留并展示已加载页；离开 Integration 分类页面时，前端取消该 Query 的在途请求并将 `pages/pageParams` 裁剪为第一页。下一次 mount 保留 `refetchOnMount: 'always'`，但只会刷新第一页。
2. 该生命周期规则位于 `useRetainFirstInstalledPluginPageOnUnmount`，由页面声明性调用；Effect 只负责同步组件卸载与 QueryClient 这个 React 外部缓存，不复制 Query data 到 React/Jotai state，也不在 Effect 中发起列表请求。
3. 只有 workspace Plugin revision 变化、收到变更事件，或缓存超过明确时限时才刷新，是后续的后端一致性方案；本地安装、卸载、升级继续通过现有 invalidation 立即更新。
4. 若 revision 未变化，后续可进一步避免第一页刷新；用户再次滚动时再按需请求下一页。

`maxPages` 不适合当前单向列表：它会在用户仍向下浏览时淘汰前页，并要求额外实现反向分页。当前方案的 Effect cleanup 是有意使用的生命周期同步点；它只在组件离开时调整外部 Query cache 的保留窗口。

**验收**

- 在数据仍新鲜时返回 Built-in Tools，不重复请求 Tool 类别列表。
- 安装、升级、删除 Tool Plugin 后列表仍立即更新。
- workspace 切换不复用上一个 workspace 的数据。

### P1-10：Tool Plugin 列表接口返回完整详情，30 条仍有约 152 KB

**状态：已完成方案调查，暂置，不作为当前优先项。**

**问题**

当前 Tool category list 每页返回完整 Plugin Detail / declaration。2026-07-22 的 Slow 4G trace 中，第 1 页仅 30 条，传输量仍为 152 KB，完整请求约 4.3 秒；第 2、3 页分别为 142 KB、116 KB。

**调查结论与后续方案**

2026-07-22 的 trace 精确记录该响应 JSON body 为 151,004 B、网络传输为 152,476 B。请求参数是 `page_size=30`；该数字包含响应 envelope 与 hardcoded Built-in Tool Provider，因此只能得出“每条 Plugin 的平均上限约 5 KB”，不能从 Performance trace 反推出每个 JSON property 的实际字节数。若要做字段级统计，需要导出 Network HAR 或复制 Response JSON 后再递归计算。

当前列表返回完整 `PluginDetail.declaration`，而卡片只使用摘要：插件和安装标识、来源/版本、名称/描述/图标/认证信息、最低 Dify 版本，以及 endpoint 是否存在和可见数量。完整的 `tool.credentials_schema`、`endpoint.settings`、Model/Agent Strategy/Datasource 声明、Trigger events 与订阅 schema 都不是卡片首屏所需数据。

最优的长期契约是：

1. category list 返回扁平的 `PluginListItem` summary；
2. 用户点击卡片后，用语义明确的单 Plugin detail API 返回完整 declaration；
3. Drawer 内的 Tool action 列表继续调用现有 `/tools`，版本历史继续调用现有 `/versions`，不要重新塞回 list；
4. `/versions` 应改为版本 Popover 首次打开时才启用请求，而不是 Drawer mount 时即请求。

现有 `POST /workspaces/current/plugin/list/installations/ids` 已能从 daemon 取得完整 installation，可复用为后端实现 detail API 的底层能力；但不建议让前端长期以“批量 ID 查询”作为 Drawer 的详情契约。

当前不实施的原因：分页首批 30 条、缓存尾页裁剪和图标懒加载已先降低首屏成本；这项需要同时修改后端响应契约、前端列表类型、详情加载状态和回归测试。应在获得真实 Response JSON 的字段级容量统计后，与图标缩略图和后端搜索/筛选一起重新排序。

**验收**

- 30 条 Tool Plugin 首页的传输量显著低于当前 152 KB。
- 首屏卡片和已有状态标记保持正确。
- 打开 Plugin Drawer 后仍可取得完整详情。

### P2-11：Built-in Tools 的 Marketplace 组件边界需要收敛

**状态：已完成结构调查，暂置；未来处理 Marketplace 延迟加载时一并实施。**

**当前结构**

Built-in Tools 的路由与已安装 Plugin 列表复用关系本身合理：`integrations/` 负责路由、侧栏和 section 编排，`plugins/plugin-page/` 同时被独立 `/plugins` 页面和 Integration 分类页复用。

但 Marketplace 相关代码存在两处边界问题：

1. `plugins/plugin-page/plugins-panel-results.tsx` 直接 import `integrations/hooks/use-tool-marketplace-panel` 和 `integrations/tool-provider-card`。通用 Plugin 页面依赖上层产品页面目录，依赖方向倒置。
2. 相同的 `BuiltinMarketplacePanel` 同时存在于 `plugins/plugin-page/plugins-panel-results.tsx` 与 `integrations/tool-provider-list.tsx`；当前仅 `contentInset` 类型不同。未来改可见性、搜索/筛选激活规则时，容易出现只改一处的行为分叉。

另一个相关事实是：`integrations/tool-provider-card.tsx` 已被 `tools/tool-provider-grid.tsx` 使用，因此它实际上是 Tool Provider 通用展示组件，而不是 Integration 专属组件。

**目标边界**

```text
integrations/
  page / routes / section-renderer / sidebar / plugin-category-page
plugins/
  plugin-page / plugin-detail-panel
tools/
  marketplace/
    hooks
    tool-marketplace-panel
    builtin-marketplace-panel
  tool-provider-card
  tool-provider-grid
```

`integrations/` 只决定当前 section；`plugins/` 只负责已安装 Plugin 列表与详情；`tools/marketplace/` 负责 Tool Marketplace 的数据、滚动和启用条件；通用 Provider Card 放在 `tools/`。

**实施时机与顺序**

不要为目录整洁单独移动文件。恢复 P0-3（Marketplace 延迟加载）时，按以下顺序处理：

1. 提取唯一的 `BuiltinMarketplacePanel` 到 `tools/marketplace/`；
2. 将 `use-tool-marketplace-panel` 移到同一目录；
3. 将 `tool-provider-card` 移到 `tools/` 并改为中性命名；
4. 更新 imports 与测试，确保 `plugins/` 不再 import `integrations/`；
5. 在唯一的 Marketplace owner 中实现 `visible || hasActiveSearchOrTagFilter` 的 query 启用规则。

### MP-P1-4：Model Provider 首屏混入非首屏 Marketplace 内容

**状态：已由 Cold HAR 和代码确认，尚未实施。**

**问题**

Model Provider 页面在主内容后会渲染 Marketplace 安装区；Integrations 的 section renderer 也会额外挂载安装查询组件。

- 主页面 Marketplace 区：[model-provider-page-body.tsx](/web/app/components/header/account-setting/model-provider-page/model-provider-page-body.tsx:221)
- Integrations 额外挂载点：[section-renderer.tsx](/web/app/components/integrations/section-renderer.tsx:100)

**为什么慢**

用户首次进入时通常先看已配置的 Provider。首屏同时计算、请求或渲染页面底部的 Marketplace 推荐，会和真正的首屏竞争资源。

**修改核心逻辑**

把 Marketplace 安装区定义为“用户滚动接近区域、点击安装入口或首屏 Provider 列表为空时”才加载。空状态仍需立即显示合适的安装引导。

**实现范围**

- `web/app/components/header/account-setting/model-provider-page/model-provider-page-body.tsx`
- `web/app/components/integrations/section-renderer.tsx`
- 相关 Marketplace 安装组件和测试。

**验收**

- 已有 Provider 的常规首屏不请求/不渲染底部 Marketplace 内容。
- 用户滚动到该区域或主动点击安装后，功能正常出现。
- 没有 Provider 的空状态仍能直接进入安装流程。

## Model Provider 卡片数据与 API 改造报告

### 结论

当前 Model Provider 页面把两类本应分层的数据都放在首屏：

1. **Provider 配置数据**：控制卡片主体、认证状态和模型能力；
2. **已安装 Plugin 管理数据**：控制版本、升级、卸载和 Plugin 信息。

前者目前由 `/model-providers` 完整返回，后者目前由 `plugin/model/list` 完整返回。改造目标不是删除后续功能，而是把首屏改为两个小型 summary；用户点击具体功能时，再读取当前 Provider 或 Plugin 的 detail。

### 当前 API：分别负责什么

| API | 当前返回 / 行为 | 当前页面用途 | 主要问题 |
| --- | --- | --- | --- |
| `GET /workspaces/current/model-providers` | 每个 Provider 的展示信息、认证列表、custom models、可新增模型、Provider/Model credential schema、quota 配置等 | Provider 卡片主体、API Key 状态、Add/Edit API Key、Custom Model | 为所有卡片预取了只在配置操作中使用的 detail。 |
| `GET /workspaces/current/plugin/model/list?page=1&page_size=100` | 已安装 Model Plugin 的完整管理对象和完整 `declaration` | 当前版本、版本选择器、升级、删除、Plugin 信息 / 跳转 | Cold 中解码 3.447MB；完整 declaration 不应在首屏为所有 Plugin 下载。 |
| `POST /workspaces/current/plugin/list/latest-versions` | 指定 Plugin ID 的最新版本状态 | 更新红点、升级到最新版本 | 可以保留批量摘要，但应在 Plugin summary 之后再触发。 |
| Marketplace `GET /plugins/:plugin_id/versions` | 单个 Plugin 的完整可选版本历史 | 用户打开 Version List 后选择升级 / 降级版本 | 当前错误地在每张卡挂载时请求；应只在 Popover 打开时请求。 |
| `GET /workspaces/current/model-providers/:provider/models` | 单个 Provider 的模型列表 | 用户点击 `Show Models` | 已按 `expanded` 启用，方向正确。 |
| `GET /workspaces/current/model-providers/:provider/credentials` | 当前或指定 credential，不是该 Provider 的完整可选 credential 列表 | 编辑某一 credential 时读取详情 | 不能单独替代卡片认证下拉框需要的 `available_credentials[]`。 |
| `POST/PUT/DELETE /model-providers/:provider/credentials`，`POST .../credentials/switch` | 创建、编辑、删除、切换 Provider credential | API Key 操作 | 写接口可以保留。 |
| `POST /model-providers/:provider/preferred-provider-type` | 切换 system / custom 优先级 | 卡片认证状态操作 | 可保留。 |
| `POST /plugin/upgrade/marketplace`，`POST /plugin/uninstall` | 启动升级任务、卸载安装记录 | Plugin 生命周期操作 | 可保留；前者只需要原/新 Plugin unique identifier，后者需要 installation ID。 |

### 卡片显示：字段与当前数据来源

| 卡片显示内容 | 当前字段 | 当前 API | 首屏 Summary 是否应保留 |
| --- | --- | --- | --- |
| 名称、图标、描述 | `provider`、`label`、`icon_small`、`icon_small_dark`、`description` | `/model-providers` | 是 |
| 模型类型标签 | `supported_model_types` | `/model-providers` | 是 |
| 能否配置 API Key / Custom Model | `configurate_methods` | `/model-providers` | 是 |
| 当前认证状态 | `preferred_provider_type`、current credential name、是否有 credential | `/model-providers` | 是，但只保留状态摘要，不保留完整 credential 数组 |
| system / quota 可用性 | `system_configuration` 相关状态 | `/model-providers` | 是，但只保留 `enabled` / `has_valid_quota` 等最终状态 |
| 当前 Plugin 版本 | `plugin_id`、`version`、`source` | `/plugin/model/list` | 是，放入 Plugin summary |
| 是否有新版本 | `latest_version`、`latest_unique_identifier`、状态 | `latest-versions` + `/plugin/model/list` | 是，放入 Plugin summary 或延后批量 latest 查询 |
| Provider description / author 兜底 | `declaration.description`、`declaration.author` | `/plugin/model/list` | 否；优先使用 Provider summary，本字段可在 detail 时获取 |

### 点击操作：当前依赖、目标数据和 API

| 用户操作 | 当前依赖 / 当前读取方式 | Summary 后需要保留的字段 | 点击后目标 API | 是否需要新增 API |
| --- | --- | --- | --- | --- |
| 打开 Version List | 卡片 mount 即请求全部 Plugin versions | `plugin_id`、`version`、`source` | 现有 Marketplace `GET /plugins/:plugin_id/versions`，只在 Popover 打开时请求 | 否；仅改 Query `enabled` 条件 |
| 手动升级 / 降级版本 | 完整 Plugin detail + versions 返回的目标 unique ID | `plugin_unique_identifier` | 现有 `POST /plugin/upgrade/marketplace` | 否 |
| 升级到最新版本 | 完整 Plugin detail + latest versions | `plugin_unique_identifier`、`latest_unique_identifier` | 现有 `POST /plugin/upgrade/marketplace` | 否 |
| 删除 Plugin | 完整 Plugin detail | `installation_id`、展示名称 | 现有 `POST /plugin/uninstall` | 否 |
| 打开 Plugin Info / GitHub 操作 | `declaration`、`meta.repo/version/package` | 可仅保留 GitHub 必需的 `repo/version/package`；其余在打开时取 detail | 现有 manifest API 可复用或补单 Plugin detail | **v1 非必须**；若 Info 需完整安装状态，再新增单 Plugin detail API |
| 点击 Show Models | Provider card 中的 `provider` | `provider` | 现有 `GET /model-providers/:provider/models` | 否，当前已按需加载 |
| 展开 API Key 下拉框 | 首屏 `available_credentials[]` | Provider ID 和认证状态摘要 | `GET /model-providers/:provider/configuration` | **是**；当前 credentials GET 不是列表接口 |
| Add / Edit API Key | 首屏 Provider credential schema；编辑时读取指定 credential | `provider`、`configurate_methods` | 同一个 configuration detail；保存仍走现有 credential mutation | **是**；detail 必须带 credential list + Provider schema |
| Add / Manage Custom Model | 首屏 `custom_models`、`can_added_models`、Model credential schema | `provider`、`configurate_methods` | 同一个 configuration detail；模型/credential mutation 保持现有 API | **是**；detail 必须带 custom model 和 Model schema |
| 切换 system / API Key 优先级 | 首屏 Provider 配置状态 | `provider`、`preferred_provider_type` | 现有 `POST .../preferred-provider-type` | 否 |

### 目标 API 合同

#### 1. Provider Card Summary（新增视图）

建议扩展现有 API，而不是改变默认响应：

```text
GET /workspaces/current/model-providers?view=summary
```

```ts
type ProviderCardSummary = {
  provider: string
  label: I18nObject
  description?: I18nObject
  icon_small?: I18nObject
  icon_small_dark?: I18nObject
  supported_model_types: ModelType[]
  configurate_methods: ConfigurateMethod[]
  preferred_provider_type: 'system' | 'custom'
  credential_summary: {
    status: 'active' | 'no-configure'
    has_credentials: boolean
    current_credential_name?: string
  }
  system_summary: {
    enabled: boolean
    has_valid_quota: boolean
  }
}
```

#### 2. Installed Model Plugin Summary（新增视图，延后加载）

```text
GET /workspaces/current/plugin/model/list?view=summary
```

```ts
type InstalledModelPluginSummary = {
  installation_id: string
  plugin_id: string
  plugin_unique_identifier: string
  category: 'model'
  source: 'marketplace' | 'github' | 'debugging'
  version: string
  has_update: boolean
  latest_version?: string
  latest_unique_identifier?: string
  status: 'active' | 'deleted'
  deprecated_reason?: string
  alternative_plugin_id?: string
  name: string
  author?: string
  label?: I18nObject
  github?: { repo: string; version: string; package: string }
}
```

它在 Provider card 主体首次可见后加载；不再返回完整 `declaration`。

#### 3. Provider Configuration Detail（新增）

```text
GET /workspaces/current/model-providers/:provider/configuration
```

```ts
type ProviderConfigurationDetail = {
  available_credentials: Credential[]
  custom_models: CustomModel[]
  can_added_models: AddableModel[]
  provider_credential_schema?: ProviderCredentialSchema
  model_credential_schema?: ModelCredentialSchema
  quota_configurations?: QuotaConfiguration[]
}
```

只在打开 API Key 下拉框、Add/Edit API Key、Add/Manage Custom Model 等配置操作时请求。现有写操作 API 不变。

### 改造范围汇总

| 类别 | API | 处理 |
| --- | --- | --- |
| 改造为 Summary | `/model-providers` | 新增 `view=summary`，卡片主体首屏使用该视图。 |
| 改造为 Summary | `/plugin/model/list` | 新增 `view=summary`，卡片主体可见后加载。 |
| 新增读取 API | `/model-providers/:provider/configuration` | 承接 API Key 与 Custom Model 的完整配置数据。 |
| 保留并改前端触发时机 | Marketplace `/plugins/:plugin_id/versions` | 仅 Popover 打开时请求，不改返回体。 |
| 保留 | `/model-providers/:provider/models` | 继续按 `expanded` 请求。 |
| 保留 | credential / priority / upgrade / uninstall mutations | 继续作为写操作接口。 |

## 需要后端配合的工作项

### MP-P0-4：将 `plugin/model/list` 从完整 Plugin 管理对象改为延后加载的安装摘要

**状态：已由 Cold HAR 和代码确认，尚未实施。**

**问题**

`GET /workspaces/current/plugin/model/list?page=1&page_size=100` 在 Cold 中总耗时 4.439s，其中 Waiting 为 3.917s。虽然压缩传输仅 83.8KB，但解码后的 JSON 为 3.447MB；46 个 `declaration` 合计约 2.48MB，单个 Tongyi Provider 对象约 627KB。Model Provider 卡片首屏并不需要完整 schema。

**修改核心逻辑**

将「Provider 卡片主体」「已安装 Plugin 摘要」「单 Plugin 操作详情」分为三个契约：

1. `/model-providers?view=summary` 返回 Provider card 主体字段；这是卡片 skeleton 结束所依赖的数据；
2. `plugin/model/list?view=summary` 仅返回 `plugin_id`、来源、当前版本、更新状态等 Plugin 徽标/升级入口字段；应在卡片主体可见后加载；
3. 用户打开版本选择器时，才请求该 Plugin 的完整 versions；用户打开 Plugin Info、认证或自定义模型管理时，才取相应 detail；
4. 在 Console API 增加 `Server-Timing`，至少拆出 Console→daemon、daemon 响应、配置组装、JSON 序列化和压缩；
5. 有了分段数据后，再判断应优先优化 daemon、结果缓存、字段投影还是序列化。

**验收**

- `plugin/model/list` decoded payload <500KB；
- p75 总耗时 <400ms；
- Provider card 主体先于 Plugin 摘要稳定出现；
- 已安装状态、版本/升级入口在摘要到达后补齐；
- 版本历史、认证、配置和 Plugin Info 的完整 detail 只在用户打开相应功能时发生。

### P1-8：为 Quota Panel 提供窄的 Marketplace 查询能力

**状态：暂置，暂不实施。**

**触发条件**

仅当 P0-2 发现前端无法从已有数据源精确获得所需 Provider 信息时实施。

**问题与方向**

现有全量 Marketplace 查询不适合仅判断少数 Provider 的可安装状态。后端可提供按 `plugin_id` / Provider ID 批量查询的轻量响应，只返回 Quota Panel 所需字段。

**验收**

- 请求和响应大小与查询 Provider 数量成正比，而不是与 Marketplace 总量成正比。
- 严格保留 workspace、权限和 Marketplace 开关语义。

### P1-9：为 Built-in Tools 提供真正的 Provider 摘要链路

**状态：暂置，暂不实施。**

**问题**

Marketplace 附加链路通过 `/tool-providers` 获取 Provider 摘要，但后端内部向 Plugin Daemon 请求 `page=1&page_size=256` 的完整 Tool Provider，并遍历每个 Tool、解析 `output_schema`。列表最终主要使用 Provider ID、名称、图标、标签和授权状态，完整 tools / schema 不属于列表首屏需要的数据。

- 位置：[tool.py](/api/core/plugin/impl/tool.py:17)

**为什么慢**

即使前端只收到 Provider 摘要，Plugin Daemon 和 API 仍承担了完整数据读取及转换成本。这能解释已有数据中约 1 秒的 service waiting，并且不是通过 React 优化可以消除的。

**修改核心逻辑**

优先由 P0-3 消除首屏对这条链路的需求。如果其他页面仍需要 `/tool-providers`，再将“Provider 摘要”与“完整 Tool 声明”分开：Plugin Daemon 提供 summary 能力，或 API 为摘要建立有明确失效策略的 tenant-scoped cache；用户进入详情或配置时再请求完整工具定义。

**验收**

- Built-in Tools 首屏不再等待不需要的完整 Tool schema。
- `/tool-providers?type=builtin` 的 daemon 数据量和转换时间明显下降。
- 进入单个 Provider 配置后，工具列表和 schema 仍完整可用。
- 安装、升级、删除后的 cache invalidation 明确且可测试。

## 独立实验：Next.js 16.3 Instant Navigations

这不是当前首屏数据性能问题的替代方案，但可改善“用户点击进入 Integrations 后，多久能看到反馈”。

当前项目使用 Next.js `16.2.10`，Integrations 路由没有 `loading.tsx`，并且页面会读取动态 `params` 和 `searchParams`：

- Next 版本：[pnpm-workspace.yaml](/pnpm-workspace.yaml:210)
- 路由入口：[page.tsx](/web/app/(commonLayout)/integrations/[[...slug]]/page.tsx:13)
- 当前 Next 配置：[next.config.ts](/web/next.config.ts:12)

**实验内容**

1. 在单独的 POC 分支升级至 `next@preview`。
2. 打开 `cacheComponents` 和 `partialPrefetching`。
3. 为 Integrations 添加不读取动态参数的 loading shell。
4. 用 Navigation Inspector 检查预取的 shell。
5. 用 `instant()` Playwright 测试约束“点击后立即可见”的 UI。

**重要限制**

- 它只优化客户端导航，不加速刷新页面或直接输入 URL 的首次服务端加载。
- 它不会消除上面 P0 项中的前端请求、Plugin Daemon 延迟或大列表渲染。
- 16.3 在当前调研时仍是 Preview；不要直接作为生产依赖升级。
- 不要对 workspace / 用户相关的 Integration 数据宽泛使用 `'use cache'`。

## 建议实施顺序

1. **MP-P0-1 / MP-P0-3：已完成。** 版本选择器仅在打开时请求；System Model 四类列表仅在 Dialog 打开时请求。
2. **MP-P0-4：收窄 `plugin/model/list` 并补 Server-Timing。** 这是 Model Provider 的最大单点 blocker；先测清 daemon、组装和序列化占比，再决定后端优化的落点。
3. **MP-P1-4：安装 Marketplace 延迟加载 / 分页策略待复审。** 当前已撤回首批 20 条、observer / 手动分页和第一页缓存；Quota / Model Selector 的窄查询暂缓。
4. **验证 P0-4 / P0-5 收益。** 用同一 workspace 的 Cold / Warm HAR 和 Performance trace 比较 Built-in 的首批 30 条、图片懒加载和缓存页裁剪改动前后数据。
5. **图标资产决策。** Model Provider 和 Built-in 共用“缩略图 + 可缓存 URL”的问题；优先用真实 HAR 确认可见 icon 的总字节数和缓存命中，再设计统一资产规格。
6. **后端搜索与筛选。** 为 category list API 提供 query / tags + 分页；前端接入后，Tool、Trigger、Agent Strategy、Extension 一并解决“只搜已加载页”的边界。
7. **P1-6 一致性协议。** 设计 workspace Plugin revision / 事件失效，再继续收敛 Warm mount 的刷新成本。
8. **P0-3 / P1-9（Built-in Marketplace）**：恢复排期时先推迟底部 Marketplace，再评估 Provider summary / cache。
9. **Next 16.3 POC**：独立验证，不阻塞数据和渲染主线。

## 每项开始前的统一测量

在改动前后，针对同一个测试 workspace 记录：

- 首次点击 Integrations 到骨架/页面反馈的时间；
- 首屏关键内容可见、可点击的时间；
- 首屏 API 数量、总传输大小和最慢请求；
- React commit / Long Task / 图片解码造成的主线程阻塞；
- 滚动后加载更多卡片时的帧率和交互表现。

这样每次只解决一个问题时，能清楚判断收益是否真实来自该改动。
