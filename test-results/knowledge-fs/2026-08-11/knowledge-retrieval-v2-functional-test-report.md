# Workflow Knowledge Retrieval v2 / KnowledgeFS 功能补测报告

## 1. 结论

本轮已把原报告中 `TC-RE-022`、`TC-AU-015`、`TC-AU-016` 对应的 Workflow `knowledge-retrieval-v2` 未测试范围扩展为独立矩阵，并完成真实 Chrome、已发布 Web App、Workflow Service API blocking/streaming、DSL、发布绑定和自动化合同测试。

已验证可用的部分：节点可见性、有效 DSL 导入/导出、刷新恢复、查询变量绑定、空间搜索与多选、Fast/Deep/Research/跟随空间的配置保存、Top N、绝大多数 metadata filter 的配置持久化、输出变量、空白与 16000/16001 查询边界、未解析空间发布拦截、Workflow 发布版本、绑定精确同步、运行日志，以及 Service API 失败响应合同。真实 mode 与 filter 召回效果未通过，仍属于后文 `ENV-BLOCKED`。

初测环境仍不能判定 Workflow KnowledgeFS retrieval 可用。有效 Workflow 发布成功后，KnowledgeFS Overview 的“关联应用”为 `1`，证明绑定记录已经创建；但当时草稿完整运行、单节点运行、已发布 Web App、Service API blocking 和 Service API streaming 全部稳定失败为：

```text
KnowledgeFS Space <control-space-id> is not bound to this workflow
```

QA 空间的 API Access 临时开启/恢复也已测试；按合同该开关只控制 Service API 与 Agent、会保留原 `workflow_enabled`，因此它不应解除 Workflow 阻塞，也不作为 runtime 缺陷证据。初测部署的 Settings UI 没有可发现的 Workflow channel 开关，Overview 同时显示 `Knowledge-space permissions are not ready`。因此真实 Fast/Deep/Research 召回、引用、真实 filters、多空间合并和 capability 撤权继续标记为 `ENV-BLOCKED`，不能用 mock 单测冒充通过。

本轮新增 5 个已确认缺陷：`KF-BUG-020`～`KF-BUG-024`，均已创建到 Linear 项目 `Make RAG Great Again`、Milestone `测试联调`。KF-BUG-020/021 已完成代码修复、专项自动化回归和 Linear 关闭；KF-BUG-022～024 保持 Backlog。020 修复了通用 Workflow history 初始化器卸载子树的问题；021 增加独立 Workflow Access 控件、细分 admission 原因，并将稳定错误 marker 映射为 24 个 locale 的本地化消息。两项修复尚未部署到测试环境，所以下文保留原始浏览器 FAIL，且仍需真实 Chrome/Web/Service 正向复测。

## 2. 环境与测试对象

- Console：`https://new-rag.dify.dev`
- Web App：`https://new-rag-app.dify.dev`
- Service API：`https://new-rag-api.dify.dev/v1`
- 浏览器：用户已登录的 Google Chrome
- 角色：Workspace Owner
- 有效测试 Workflow：`KF-WF-V2-LIVE-CESHI-20260811`
- App ID：`98bcd2c4-e371-405f-a972-d21bb41b5fa2`
- 未解析空间 Workflow：`KF-WF-V2-UNRESOLVED-20260811`
- App ID：`5c6687c6-4b30-4abf-81e2-efc4d9fa1514`
- UI 新增节点复现 Workflow：`KF-WF-V2-QA-20260811`
- App ID：`fbed98e7-5370-4eca-a2a9-f128ce69a50e`
- 既有空间 `ceshi`：`019fac9f-bfb0-75ee-9af5-252ebafbac1c`
- QA 空间：`019fef0d-732b-73d4-95e6-e943be794403`
- 当前 workspace 仅有 6 个可选空间；线上 10/11 空间边界由组件和后端合同测试补齐。
- 有效 DSL fixture：[kf-wf-v2-live-ceshi.yml](./test-data/kf-wf-v2-live-ceshi.yml)
- 未解析空间 fixture：[kf-wf-v2-unresolved-space.yml](./test-data/kf-wf-v2-unresolved-space.yml)

## 3. 已执行矩阵

| ID      | P   | 场景                                                        | 期望                                                          | 结果                                                                                                                                           |
| ------- | --- | ----------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| WF2-001 | P0  | feature 开启时打开添加节点面板                              | 显示“KnowledgeFS 检索”                                        | PASS                                                                                                                                           |
| WF2-002 | P0  | Start 后从节点选择器点击“KnowledgeFS 检索”                  | 创建节点并打开配置面板                                        | **初测 FAIL**；主编辑区变为空白，未处理 `AbortError`，见 KF-BUG-020；代码已修复并通过专项回归，待部署后真实 Chrome 复测                        |
| WF2-003 | P0  | 打开通过 DSL 已存在的 v2 节点                               | 配置面板正常加载                                              | PASS；6 个空间、当前选择和 settings 摘要正常                                                                                                   |
| WF2-004 | P0  | 导入 Start→v2→End 合法 DSL                                  | 创建 Workflow，保留 v2 节点                                   | PASS                                                                                                                                           |
| WF2-005 | P0  | 导入后刷新                                                  | 图、空间、模式、Top N 和 End 映射恢复                         | PASS                                                                                                                                           |
| WF2-006 | P0  | 导出已保存 DSL                                              | 保留 `control_space_ids`、filters、mode、top_n、result 输出   | PASS                                                                                                                                           |
| WF2-007 | P0  | 导入引用不存在空间的 DSL                                    | 草稿可导入，但明确保留 unresolved warning                     | **FAIL-PARTIAL**；导入成功，面板和检查清单无持久警告，见 KF-BUG-024                                                                            |
| WF2-008 | P0  | 发布未解析空间 Workflow                                     | 发布失败且不创建 published snapshot                           | PASS；保持“未发布”，明确列出缺失 ID                                                                                                            |
| WF2-009 | P0  | 运行未解析空间草稿                                          | fail closed，不触碰 KFS                                       | PASS；`draft binding could not be enabled`                                                                                                     |
| WF2-010 | P0  | 绑定 `Start.query`                                          | 面板显示 string selector，刷新不丢失                          | PASS                                                                                                                                           |
| WF2-011 | P1  | 搜索空间并清除搜索                                          | 过滤正确，键盘可清除并恢复列表                                | PASS                                                                                                                                           |
| WF2-012 | P0  | 取消全部空间                                                | `0/10` 且检查清单阻止发布                                     | PASS；“KnowledgeFS 空间不能为空”                                                                                                               |
| WF2-013 | P0  | 选择 1 个和全部 6 个可见空间                                | 计数、checked 状态和节点摘要一致                              | PASS；`1/10`、`6/10`                                                                                                                           |
| WF2-014 | P0  | 空间上限 10/11、去重、顺序                                  | 10 允许，11 拒绝，重复 ID 去重                                | PASS-AUTO；当前线上只有 6 个，未伪造 live 10/11                                                                                                |
| WF2-015 | P0  | Fast、Deep、Research、跟随空间配置                          | 均可保存；跟随配置不写字面 `auto`                             | PASS；刷新验证 Deep，其他模式即时保存验证                                                                                                      |
| WF2-016 | P0  | DSL 使用字面 `mode: auto`                                   | 合同拒绝                                                      | PASS-AUTO；Auto 语义是省略 mode/`space-default`                                                                                                |
| WF2-017 | P0  | Top N = 0/1/100/101                                         | 仅 1～100 生效                                                | PASS；0/101 保留原值 5，1/100 精确显示                                                                                                         |
| WF2-018 | P1  | document type/entity/freshness/language/source/tags filters | 逗号值解析、保存、刷新和 DSL 导出一致                         | PASS                                                                                                                                           |
| WF2-019 | P0  | created after/before 输入合法 datetime                      | 保存、刷新和 DSL 导出保留                                     | **FAIL**；刷新后为空，DSL 无字段，见 KF-BUG-022                                                                                                |
| WF2-020 | P1  | 同时选择 section/table node kinds                           | 多选和 DSL 导出一致                                           | PASS                                                                                                                                           |
| WF2-021 | P1  | 逐个取消 node kinds，最后取消剩余项                         | 最后一项也可清除                                              | **FAIL**；最后一项永久 checked，见 KF-BUG-023                                                                                                  |
| WF2-022 | P0  | 展开输出变量                                                | 显示 result 与 metrics 完整合同                               | PASS；result/content/title/metadata、metrics/mode/total_ms/degradation_flags                                                                   |
| WF2-023 | P0  | query 仅空格                                                | trim 后拒绝且 0 token                                         | PASS；`must not be empty`                                                                                                                      |
| WF2-024 | P0  | query 精确 16000 字符                                       | 通过长度校验                                                  | PASS；进入下一步绑定校验                                                                                                                       |
| WF2-025 | P0  | query 16001 字符                                            | 在上游调用前拒绝                                              | PASS；`at most 16000 characters`                                                                                                               |
| WF2-026 | P0  | 未发布草稿完整运行                                          | debugger/account 自动 upsert 所选 binding 后执行 retrieval    | **初测 FAIL**；admission 统一返回未绑定，无法从 UI 区分 join、channel 或 permissions 状态，归入 KF-BUG-021；代码已细分错误并本地化，待部署实测 |
| WF2-027 | P0  | 发布合法 Workflow                                           | 创建 published snapshot 并同步 binding                        | PASS；UI 操作成功，Overview 关联应用 0→1                                                                                                       |
| WF2-028 | P0  | 从 `ceshi` 切到 QA 后发布                                   | 新 binding active，旧 binding revoke                          | PASS；`ceshi` 关联应用 1→0                                                                                                                     |
| WF2-029 | P0  | 切回 `ceshi` 再发布                                         | QA 解绑、`ceshi` 恢复且不重复                                 | PASS；`ceshi` 关联应用恢复为 1                                                                                                                 |
| WF2-030 | P1  | 查看版本历史                                                | 每次发布产生完整快照                                          | PASS；10:10、10:25、10:27 三个版本可见                                                                                                         |
| WF2-031 | P0  | QA API Access off→on→运行→off                               | 保存即时，测试后恢复                                          | PASS；最终 `未启用`                                                                                                                            |
| WF2-032 | P0  | 发布后完整草稿运行                                          | 已绑定 Workflow 可检索或准确说明 channel/permission 问题      | **初测 FAIL**；误报未绑定，见 KF-BUG-021；错误分类代码已修复，真实正向召回待部署复测                                                           |
| WF2-033 | P0  | “运行此步骤”                                                | 与完整运行同一绑定/错误合同                                   | **初测 FAIL-BLOCKED**；稳定误报未绑定，无法到达 KFS；代码已修复，环境阻塞仍未解除                                                              |
| WF2-034 | P0  | 已发布 Web App 运行                                         | 返回 evidence 或真实 no-result                                | **初测 FAIL-BLOCKED**；稳定误报未绑定；代码已修复，待部署后真实 Web App 复测                                                                   |
| WF2-035 | P0  | Service API blocking                                        | HTTP 200，`data.status/error/outputs` 合同完整                | PASS-NEGATIVE；`failed`、同一绑定错误、`outputs={}`、2 steps、0 tokens                                                                         |
| WF2-036 | P0  | Service API streaming                                       | workflow/node terminal SSE 顺序和错误一致                     | PASS-NEGATIVE；start succeeded，v2 node failed，workflow failed                                                                                |
| WF2-037 | P0  | 撤销临时 App API key 后重试                                 | 立即 401                                                      | PASS；完整 secret 未写入报告                                                                                                                   |
| WF2-038 | P1  | 日志列表和详情                                              | Web/API 运行可查，错误与运行一致                              | PASS；5 条失败记录，详情显示绑定错误                                                                                                           |
| WF2-039 | P0  | 自动化合同回归                                              | UI、节点、绑定、capability、remote HTTP 和 operation 测试全绿 | PASS；Web 6 个关联 spec 整体 22/22，API 13 个关联文件整体 340/340                                                                              |

## 4. 当前无法完成但未遗漏的真实运行矩阵

下列项目均已准备步骤和断言。WF2-LIVE-001～015 需要先部署 KF-BUG-021 修复，通过新控件设置 `workflow_enabled=true`，并提供 permissions ready、Capability v2 可达、含唯一 marker 且已索引的空间；在此之前仍标记为 15 个 `ENV-BLOCKED`。WF2-LIVE-016 缺少节点到同步 remote 的 cancellation signal；WF2-LIVE-017～018 则因为产品未给 v2 节点开放 error strategy/retry 配置而无法执行，3 个规格/实现阻塞状态不变，不能误归因为环境问题。

| ID           | 场景与验收标准                                                                                    | 状态                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| WF2-LIVE-001 | Fast 返回唯一 marker、最终 score 和正确 citation                                                  | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-002 | Deep 返回同一 marker 的深度召回证据                                                               | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-003 | Research 仍走同步 JSON evidence retrieval，不创建 Console Research task/SSE                       | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-004 | 省略 mode 使用每个 space Settings；多空间可汇总为 mixed                                           | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-005 | 合法无结果查询成功返回 `result=[]`，不是 failed                                                   | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-006 | 多空间按最终 score 全局排序、全局 top_n、同分稳定                                                 | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-007 | tags/document/source/language/freshness/node kind/date filters 真正缩小结果                       | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-008 | citation 保留 document/version/hash/section/page/offset                                           | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-009 | metrics 汇总每空间 mode、候选数、耗时和 degradation                                               | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-010 | 每个空间恰好一次 JSON `POST /knowledge-spaces/{id}/retrieval-tests`                               | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-011 | 不调用 KFS `/queries`、SSE 或 Research task                                                       | ENV-BLOCKED；静态合同/单测已通过                                                                            |
| WF2-LIVE-012 | draft、published Web、Service API、Trigger 对同 snapshot 返回等价 evidence                        | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-013 | binding/channel/revision 撤权在下一次 admission 立即 fail closed                                  | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-014 | 已签发旧 capability 在 epoch 变化后被真实 KFS 拒绝                                                | ENV-BLOCKED                                                                                                 |
| WF2-LIVE-015 | 4/10 空间真实并发、超时、无重复 capability/HTTP                                                   | ENV-BLOCKED；线上仅 6 个空间                                                                                |
| WF2-LIVE-016 | Workflow stop/cancel 对在途 retrieval HTTP 的终止语义                                             | SPEC/IMPLEMENTATION-BLOCKED；当前节点用同步 ThreadPool/remote，未传 cancellation signal，需先定义并实现语义 |
| WF2-LIVE-017 | v2 节点配置 fail-branch/default-value 后，上游失败按策略继续且暴露受控 `error_type/error_message` | NOT-SUPPORTED/SPEC-BLOCKED；当前 UI 的 error-handle node allowlist 不包含 Knowledge Retrieval v2            |
| WF2-LIVE-018 | v2 节点开启 retry 后，暂态失败严格按次数重试且不会重复 capability/计费                            | NOT-SUPPORTED/SPEC-BLOCKED；当前 UI 的 retry node allowlist 不包含 Knowledge Retrieval v2                   |

### 4.1 已补齐的本地边界与故障合同

以下项目通过实际运行的 13 个 Dify API 关联测试文件验证，文件整体 340/340 通过；其中 controller/DTO/remote 文件同时包含非 v2 的 KnowledgeFS 用例。它们属于分层自动化结果，不能提升为真实 KFS E2E，但可排除未执行的输入、绑定和 HTTP 错误合同遗漏。

| ID               | 场景                                                                                                     | 结果                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| WF2-AUTO-001     | space ID trim/去重、1～10 上限、0/11 拒绝；query selector 与 Top N 合同                                  | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-002     | mode 仅 Fast/Deep/Research/省略；字面 `auto` 拒绝；filters 每类上限和去重                                | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-003     | 未绑定、已撤销、错误 app、跨租户、Agent/Workflow channel 关闭时，在 capability/remote I/O 前 fail closed | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-004     | publish binding 创建/重放/重新激活、精确同步、移除空间撤权、目标授权失败整批不变更                       | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-005     | debugger/account 自动 upsert 所选 binding；published Web/Service 永不自动补 binding                      | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-006     | `retrieveEvidence` 精确签发 read capability，并只调用 JSON `POST /knowledge-spaces/{id}/retrieval-tests` | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-007     | HTTP 400/409/413/422 映射 request rejected；404、500、连接失败映射受控错误                               | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-008     | 错误 media type、无效 JSON、请求/响应超限、manifest/path/header 不匹配均在边界拒绝并关闭响应             | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-009     | 2xx 响应缺失/畸形 evidence、citation 或 metrics 时 Pydantic 合同拒绝                                     | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-010     | 多空间全局按 score 合并、同分稳定、全局 Top N、mixed metrics、空结果成功                                 | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-011     | 多空间并发有界；任一空间 unavailable 时整个节点失败且 `outputs={}`，不泄漏部分结果                       | PASS-AUTO                                                                                                                                   |
| WF2-AUTO-012     | Capability v2/cutover 未就绪时在签发前 fail closed                                                       | PASS-AUTO                                                                                                                                   |
| WF2-CONTRACT-001 | `KNOWLEDGE_FS_BASE_URL` 未配置时，Workflow v2 对外稳定映射为 RetrievalUnavailable                        | CONTRACT-GAP；runtime factory 会在 I/O 前失败，但 `_service()`/draft runtime 解析发生在节点内部错误映射之外，不能由现有单测证明公开错误稳定 |

## 5. 新确认缺陷

以下五项均归属 Linear 项目 `Make RAG Great Again`、Milestone `测试联调`。020/021 已完成并指派给 `jyong`；022～024 保持 Backlog。

### KF-BUG-020：从节点选择器新增 KnowledgeFS 检索导致 Workflow 主编辑区空白

- 严重度：P1 / Major
- Linear：[WTA-1954](https://linear.app/dify/issue/WTA-1954)，High，Done
- 复现率：2/2
- 步骤：空白 Workflow → 选择“用户输入”Start → 添加节点 → 点击“KnowledgeFS 检索”。
- 实际：`<main>` 变为空白，侧栏仍在；没有局部错误、Retry 或恢复入口。Console 记录未处理 `AbortError: signal is aborted without reason`。刷新后新增节点未保存。
- 对照：通过 DSL 已存在的 v2 节点可以打开配置面板，说明故障集中在新增节点生命周期。
- 根因：并非 KnowledgeFS 节点、collaboration 或查询本身。通用 `WorkflowHistoryStoreInitializer` 订阅 history，并以对象引用变化作为“初始化异常”条件；新增节点触发的 history 保存约 500 ms 后写入新对象，initializer 随即返回空内容并卸载整棵 Workflow 子树。TanStack Query 的 `AbortError` 来自观察者随组件卸载取消，是故障后果。
- 修复验证：initializer 只在首次 history 注入完成前阻止渲染，后续 history 引用变化不再卸载子树；更宽的 Workflow 组合回归 9 个 spec、27 个测试通过。当前尚未部署，因此未把本地自动化记为真实 Chrome 复测通过。

### KF-BUG-021：Settings UI 缺少 Workflow channel 开关，channel/permissions 失败被统一误报为未绑定

- 严重度：P1 / Blocker
- Linear：[WTA-1953](https://linear.app/dify/issue/WTA-1953)，High，Done；assignee `jyong`
- 证据：发布后 `ceshi` Overview 的关联应用为 1；换空间发布后精确变 0，再切回恢复 1，证明 binding sync 生效。
- 实际：未发布 debugger/account 草稿会经过自动 upsert 路径，发布图也已有真实 binding；但完整草稿、单步、Web App、Service blocking、Service streaming 都只返回相同“not bound”，无法区分 channel disabled、permissions not ready 与 join 缺失。
- 影响：初测部署的产品 UI 没有可发现的方式把 Workflow channel 从默认关闭改为开启，Workflow v2 因而无法完成真实召回；统一“not bound”还会把 channel/permission 未就绪误导为 binding sync 失败。QA API Access 仅控制 Service/Agent，按合同不应承担开启 Workflow 的作用。
- 修复：Settings 增加独立 Workflow Access 开关并保存 `workflow_enabled`，同时保持 API/Agent/MCP 值；失败时回滚完整 access draft，Retry 仍提交原意图。后端 admission 将 binding 未启用、Workflow channel 关闭、space 不可用、authorization 未就绪分为四类，并在节点错误中携带稳定 marker；前端在 Workflow 运行、聊天、Web App/text-generation 等表面映射为 24 个 locale 的本地化消息，未知错误保持原样。
- 修复验证：020/021 最终 Web 组合 7 个 spec、70 个测试通过；Dify API admission/node 18 个测试通过；全量 Web TypeScript 检查及目标 locale ESLint 通过。真实 Workflow 正向召回仍待部署后验证。

### KF-BUG-022：created after/before 过滤器保存后静默丢失

- 严重度：P1 / Major
- Linear：[WTA-1956](https://linear.app/dify/issue/WTA-1956)，High，Backlog
- 步骤：输入 `2026-01-01T00:00` 和 `2026-12-31T23:59`，等待自动保存并刷新。
- 实际：输入立即可见；刷新后两个字段为空，导出 DSL 也没有 `created_after/created_before`。其他 filter 同批正常保存。
- 影响：用户以为时间范围生效，实际检索未应用，可能返回超出预期的数据。

### KF-BUG-023：最后一个 node kind filter 无法取消选择

- 严重度：P2 / Normal
- Linear：[WTA-1955](https://linear.app/dify/issue/WTA-1955)，Medium，Backlog
- 步骤：选择 `section` 与 `table`，再逐个取消。
- 实际：可以从两项减少为一项，但最后一项重复鼠标点击、键盘 Space、刷新后再点击都保持 checked。
- 影响：用户无法恢复为“不限制节点类型”，只能重建/修改 DSL。

### KF-BUG-024：未解析 KnowledgeFS 空间在草稿中无持久警告，发布才暴露原始英文错误

- 严重度：P2 / Normal
- Linear：[WTA-1957](https://linear.app/dify/issue/WTA-1957)，Medium，Backlog
- 实际：DSL 导入成功，空间显示为原始 UUID 和 `— · Top K — · 重排 —`，检查清单仍为 0；直到发布才显示英文 `KnowledgeFS Spaces are missing or inactive...`。
- 影响：导入/迁移后的不可用引用难以及早发现，发布反馈未本地化且直接暴露内部 control-space ID。

## 6. 自动化回归

### Web

```text
Test Files  6 passed (6)
Tests       22 passed (22)
```

其中 16 项为 v2 直接断言：v2 目录 5 个 spec 共 15 项，加节点元数据 hook 中 1 项 feature-gate 断言；同一 hook spec 的其余 6 项是通用节点元数据用例。覆盖节点注册/feature gate、默认值、card、panel、config helpers、use-config；均使用 mocked query/provider 和 happy-dom，不证明真实新增节点生命周期、发布 binding 或 KFS upstream。

### Dify API

```text
265 passed, 3 warnings in 25.87s
75 passed in 18.88s
```

前一组覆盖 v2 node、publish binding event、admission、app binding management、app execution/capability、broker、DTO、product operations、runtime 与 controller；后一组覆盖 product remote HTTP 的网络、状态码、media type、JSON、大小和资源关闭合同。它们验证 10/11 空间、`auto` 拒绝、多空间排序/并发、空结果、绑定原子同步、JSON `/retrieval-tests` transport；capability/remote 仍为 fake、mock HTTP 或进程内边界。

### KF-BUG-020/021 修复专项

```text
KF-BUG-020 broader Web   9 spec / 27 tests passed
020/021 final Web        7 spec / 70 tests passed
020/021 final API        18 tests passed
Web type-check      passed
Target locale lint  passed
```

020 的回归覆盖首次 history 初始化与后续 history 新引用，证明子树不再因正常保存而卸载。021 的回归覆盖独立开关保存、失败回滚/重试、四类 admission 错误、稳定 marker 和所有用户运行表面的本地化映射。它们是代码层修复证据，不改变 WF2-002、026、032～034 的原始浏览器结果，也不解除 15 个 `ENV-BLOCKED` 和 3 个规格/实现阻塞。

## 7. 清理与环境恢复

- QA 空间 API Access 已恢复为 `未启用`。
- 临时 Workflow App API key 已删除；删除后同 key 请求返回 HTTP 401。
- `ceshi` 最终关联应用恢复为 1，测试 Workflow 最终重新发布为只引用 `ceshi`。
- 未删除任何既有知识库、文档、数据源或检索记录。
- 保留 3 个名称明确的合成 Workflow，便于研发直接复现；未解析空间 Workflow 保持未发布。
- 工作区模型消息额度仍显示 0；但本轮 Workflow 的 `not bound` 发生在 Dify 侧 app admission 阶段、早于 KFS remote/retrieval/model 执行，因此模型额度不是这些失败的成因。

## 8. 发布门禁建议

1. KF-BUG-020/021 已完成代码修复；发布前先部署，再用真实 Chrome 验证新增任意节点后等待超过 history 保存窗口仍不白屏，并用新的 Workflow Access 开关完成草稿、单步、Web App、Service blocking/streaming 正向召回。
2. KF-BUG-022 仍是发布风险；修复后必须用刷新、导出 DSL 和真实 filtered retrieval 三重验证，而不是只断言输入框。
3. 在部署后分别制造 missing binding、channel disabled、permissions not ready、space inactive，确认所有运行表面都展示对应的本地化错误且不泄露内部信息。
4. 建立登录态 Playwright/Cucumber E2E：创建 Workflow → 添加 v2 → 选择空间 → 发布 → Web/Service 运行 → 断言 marker/citation → 撤权后立即失败。
5. KFS upstream 断言必须明确为 JSON `retrieveEvidence`；Dify Service API 可以使用 SSE 包装 Workflow 事件，但这不是 KFS `/queries` SSE。
6. 补齐 `KNOWLEDGE_FS_BASE_URL` 缺失时的节点级错误映射回归，确保所有运行表面得到受控 unavailable，而不是未捕获异常或 generic 500。
