# Knowledge Retrieval v2 节点迭代计划

新增独立的 `knowledge-retrieval-v2` 工作流节点，对接 KnowledgeFS 知识库。与现有
`knowledge-retrieval` 节点（旧 dataset 体系）并存，互不混用。

## 需求范围

**覆盖**：workflow / chatflow 画布中的 KnowledgeFS 检索节点（配置、执行、试运行、发布、
运行详情展示）。

**不覆盖（明确非目标）**：

- Agent 应用的 dataset 工具、其他旧知识库引用面的 KFS 化。
- v1 节点的退役与自动迁移工具（仅通过输出变量结构兼容为其预留可能性）。
- 检索质量回流（workflow 空结果进 failed-query 体系）——独立立项，见"后续项"。

## 核心设计决策（已定）

| # | 决策 | 结论 |
|---|---|---|
| D1 | 节点标识 | 全新 NodeType 字符串 `knowledge-retrieval-v2`，backend `version()="1"`；前端新增 `BlockEnum.KnowledgeRetrievalV2`。**不采用** agent_v2 的同 type + version 判别模式（那是原地升级语义，本需求要求两节点并存） |
| D2 | 检索 API | 网关 `POST /knowledge-spaces/{id}/retrieval-tests`（evidence-only），**不用** `createQuery`（会走 LLM 生成答案，成本/延迟/语义都不符） |
| D3 | 配置归属 | 节点配置面保持薄：空间选择 + query 变量 + mode（+ manual metadata filters）。topK/阈值/rerank 归空间的 published retrieval profile，节点不复刻 v1 的节点级检索参数 |
| D4 | 多空间 | MVP 支持多空间：最多 10 个空间、最多 4 路并发检索、保留 KFS 返回的 profile-final `score` 做稳定降序合并并全局 topN 截断；**不做每空间二次 min-max 归一化**（它会把弱相关单结果错误抬到 1）。跨空间统一 rerank 留 P2，文档明示分数仅弱可比 |
| D5 | 绑定生命周期 | 发布含 v2 节点的 workflow 时对 `caller_kind=workflow` 做**精确同步**：新增/恢复目标绑定，并撤销已从已发布 graph 移除的绑定。`orphan_reconciler` 当前只处理 Space 生命周期，不能替代 workflow 引用清理；admission 失败运行时报确定性错误码 |
| D6 | mode 默认值 | 节点默认不传 mode（每个空间分别跟随其 published `defaultMode`）。显式值仅允许 `fast/deep/research`；KFS 当前没有 `auto` retrieval mode，不能向该端点发送 `auto`。research 模式允许选择但 UI 标注高延迟高成本 |
| D7 | metadata 过滤 | 迭代 1 在 retrieval-tests 暴露有界的 KFS 固定字段 filters；节点 MVP 仅 manual 模式。不能复用旧 dataset 的任意 `name/operator/value` 条件，因为两者合同不兼容；automatic（LLM 抽条件）为 P2 |

## 开发前评审修订（2026-08-09）

原方案整体可实施，但开发以以下约束为准：

- `retrieval-tests` 是 evidence-only 产品操作，即使 method 为 POST，也登记为只读 action；
  `includeText=true` 只返回有界正文，不透传候选内部 metadata。
- 单候选正文最多 8,192 Unicode 字符，最多 100 个候选；产品操作响应上限 4 MiB。
- 多空间查询任一空间失败时 fail-closed，不返回容易被误认为完整结果的 partial evidence；空结果是成功。
- 多空间未显式指定 mode 时，各空间可能采用不同默认模式，因此聚合 metrics 的 `mode` 允许
  `mixed`，同时返回 requested/effective mode 与 per-space 摘要，不能假设只有一个 mode。
- 草稿 debugger/explore 运行可在授权校验前幂等创建所选空间绑定；已发布/终端用户运行绝不
  自动补绑定。发布路径先校验所有目标空间，再在一个事务里精确同步绑定，避免半发布状态。
- `control_space_ids` 最多 10 个并去重；`top_n` 范围 1–100；query 限 16,000 字符；
  filters 采用 dates/documentTypes/entities/freshnessStatuses/languages/nodeKinds/sourceIds/tags。
- DSL 跨环境不会静默接受缺失 Space：导入进入 checklist warning，发布前 validation 阻断。

## 现状事实（调研结论，开发前置依赖）

- 执行链路已备好：`api/services/knowledge_fs/app_execution_capability.py` 是 App 运行时
  唯一入口（admission → capability broker 签发 → `product_remote_http`），
  `KnowledgeFSAppSpaceJoinType.WORKFLOW` 已存在，`create_research_task()` 是完整参考实现。
- 绑定设施齐全：`app_binding_management.py`、`orphan_reconciler.py`、Console API
  `/console/api/knowledge-fs/spaces/{id}/app-bindings`（upsert/revoke/list）。
- 缺口 1：`retrieval-tests` 未注册进 `api/knowledge-fs-product-operations.json`
  （目前查询类只有 `createQuery`）。
- 缺口 2：`retrieval-tests` 响应 items **无证据正文**（仅 nodeId/citation/score/sources），
  需网关侧新增 `includeText`。
- 缺口 3：`retrieval-tests` 请求体无 filters（KFS 管线内部支持，端点未暴露）。
- 节点注册机制：后端 `NODE_TYPE_CLASSES_MAPPING`（type → version → class，Node 子类自动注册）；
  前端 `BlockEnum` + `nodes/components.ts` 两个 Map + `workflow/constants.ts` 面板列表。

---

## 迭代 1：网关侧——检索操作产品化（knowledge-fs 仓库，3-4 人日）

1. `RetrievalTestRequestSchema` 增加 `includeText: boolean`（默认 false）与有界
   `filters`（结构对齐管线内部 `normalizeRetrievalMetadataFilters` 支持的形态，显式上限）。
   响应 items 增加 `text`（按 `maxTextCharsPerCandidate` 思路截断）。
   改 `packages/api/src/retrieval-test-routes.ts` + `retrieval-test-handlers.ts` + 测试。
2. Capability v2 合同登记：`contracts/dify-capability-v2-operations.json` 新增操作
   （action `queries.retrieval_test`，resource `knowledge_space`），跑
   `scripts/export-capability-v2-operations.mjs`，补 `dify-capability-v2.test.ts` 断言。
   参考样例：2026-07-31 difyctl fs 命令的合同变更（同一套流程）。
3. OpenAPI 快照更新（`pnpm openapi:export:test`）。
4. 响应体量核算：topK(≤100) × 截断后 text 的最大字节数必须低于产品操作限额
   （同类操作多为 1–4MB），超限则下调默认 text 上限。

**验收**：带 capability token 的 retrieval-tests 返回含 text/filters 生效的 items；
合同测试与 OpenAPI 快照绿。

## 迭代 2：Dify API 侧——产品操作 + 执行服务（3 人日）

1. `api/knowledge-fs-product-operations.json` 注册 `retrieveEvidence`
   （POST `/knowledge-spaces/{id}/retrieval-tests`，transport json，限额对齐核算结果），
   同步 `api/knowledge-fs-contract.lock.json`。
2. `services/knowledge_fs/product_dto.py`：`KnowledgeFSRetrievalTestPayload` /
   `KnowledgeFSRetrievalTestResponse`（mode/query/includeText/filters；items 含
   text/citation/score/sources；metrics 摘要含 mode/totalMs/degradationFlags）。
3. `app_execution_capability.py` 新增 `run_retrieval(run_context, caller_kind, resource,
   payload)`，完整照 `create_research_task()` 模式（operation ready 检查 → `issue()` →
   `execute_json` → DTO 校验）。
4. 单测照 `tests/.../test_knowledge_fs_capability.py`、`test_knowledge_fs_product_dto.py`
   既有模式补齐。

**验收**：服务层以 `caller_kind=workflow` 对本地 KFS 完成一次真实检索冒烟。

## 迭代 3：后端节点实现（4-5 人日）

新目录 `api/core/workflow/nodes/knowledge_retrieval_v2/`：

1. `entities.py`：`KnowledgeRetrievalV2NodeData`
   - `type = "knowledge-retrieval-v2"`；
   - `control_space_ids: list[str]`（Dify 侧 control_space_id，非上游 space uuid）；
   - `query_variable_selector`；
   - `mode: Literal["fast","deep","research"] | None`（None=各空间跟随自己的默认）；
   - `top_n: int`（多空间合并后截断数）；
   - `metadata_filters`（manual，使用 KFS 固定字段合同，不复用旧 dataset 的通用条件）。
   - 直接继承 BaseNode，**不继承 LLMNode**（v1 的历史包袱，v2 无 single-retrieval 模式）。
2. `knowledge_retrieval_v2_node.py`：`version()="1"`。执行：解析 query 变量 → 逐空间有界并发
   `run_retrieval` → 保留 KFS final score 做稳定合并 + topN → 组装输出。
3. `exc.py` 错误分类：admission 拒绝（未绑定/权限撤销）、KFS 不可用（fail-closed 503）、
   合同校验失败；检索为空不是错误。
4. **输出变量**（与前端 outputVars 声明严格一致）：
   - `result[]`：`{content, title, metadata: {citation: {document_id, document_version,
     section_path, page_number, start_offset, end_offset, artifact_hash}, score, sources,
     space_id}}`。content/title 命名对齐 v1，保证下游 prompt 模板迁移成本最低；citation 为
     v2 增值结构。
   - `metrics`：`{mode, total_ms, degradation_flags}`（供条件分支）。
5. 注册确认：Node 子类进 lazy registry；`node_factory.py` 无需特殊 init kwargs
   （依赖经 service 获取，不像 agent 节点注入 backend client）；工作流校验 / DSL 导入导出
   对该 type 的处理路径确认。
6. 单测：mock `KnowledgeFSAppExecutionCapabilityService`，覆盖单/多空间、变量解析、
   filters、空结果、错误路径、输出 schema。

**验收**：curl 构造 DSL 可跑通含 v2 节点的 workflow；single-step run 可用。

## 迭代 4：绑定与生命周期（2-3 人日）

1. 发布钩子：扫描 graph 中 v2 节点的 `control_space_ids`，逐个
   `app_bindings.upsert(caller_kind=WORKFLOW)`；权限失败发布报错并指明空间。
2. **草稿运行 admission 语义**（本迭代最高风险项，建议与迭代 2 同步定义）：draft/single-step
   运行时绑定可能尚未 upsert——方案二选一：draft run 按需 upsert，或提供 preview 专用
   admission 放行。定义后补集成场景验证。
3. DSL 导入/跨环境迁移：`control_space_id` 环境相关，导入时校验存在性，缺失进 checklist
   警告（对齐 v1 对 `dataset_ids` 的处理），不静默保留脏引用。
4. 生命周期验证：空间删除/成员变更 → admission 拒绝 → 节点确定性错误码；确认
   发布精确同步会撤销已从 graph 移除的 workflow 绑定。`orphan_reconciler`
   只负责 Space 生命周期孤儿，不承担 app graph 引用清理。

**验收**：发布→运行→撤权→运行失败→恢复→运行成功全链路行为确定；草稿运行语义有测试锁定。

## 迭代 5：前端节点（5-6 人日，D1–D7 定稿后即可与迭代 2-4 并行，先 mock 服务层）

1. 注册：`web/app/components/workflow/types.ts` 增 `KnowledgeRetrievalV2 =
   'knowledge-retrieval-v2'`；`nodes/components.ts` 的 NodeComponentMap/PanelComponentMap
   各一行；`workflow/constants.ts` 面板列表（置于 v1 旁）；独立 icon（与 v1 区分配色/角标）。
2. 新目录 `web/app/components/workflow/nodes/knowledge-retrieval-v2/`（对照 v1 结构：
   `default.ts` / `node.tsx` / `panel.tsx` / `types.ts` / `use-config.ts` /
   `use-single-run-form-params.ts`）：
   - `default.ts`：metaData、默认值（mode 空）、`checkValid`（query 变量 + ≥1 空间）。
   - panel：空间多选（`GET /console/api/knowledge-fs/spaces`）、query 变量选择器（复用
     VarReferencePicker）、mode 下拉（research 标注高延迟高成本）、manual metadata filters、
     只读展示所选空间 retrieval profile 摘要（topK/rerank/defaultMode——传达"检索配置在
     空间侧"）。
   - `node.tsx`：空间名 chips + mode 徽标。
3. 门控：workspace 未启用 KnowledgeFS（`system-features-state.ts`）时节点不出现在面板。
4. 输出变量声明与运行详情：outputVars 对齐后端；运行结果面板展示 citation
   （文档名 + 章节路径 + 页码）——相对 v1 的体验升级重点。
5. i18n：en-US / zh-Hans 全量 key，其余语言英文兜底。
6. Vitest：panel 交互、checkValid、use-config（按 frontend-testing 规范）。

**验收**：画布添加/配置/试运行/发布全通；checklist 生效；未启用 KFS 的 workspace 不可见。

## 迭代 6：可观测性（2 人日）

1. `WorkflowNodeExecutionMetadataKey` 是上游闭合枚举，不强行塞入自定义 key。mode、
   totalMs、candidateCounts、degradationFlags 落节点 `process_data.knowledge_fs`，
   同时将稳定子集作为 `metrics` 输出，运行详情可见且不污染全局元数据合同。
2. trace 贯通：workflow trace id 经 `issue(trace_id=...)` 传入，KFS 侧 metrics 可反查。

## 迭代 7：测试收尾与发布（3 人日）

1. 后端 integration 测试（CI-only）与前端 Vitest 全绿。当 `e2e/` 具备可重置的
   KnowledgeFS 服务和预置文档 fixture 后，再启用“建空间→传文档→建 workflow→
   v2 节点检索→断言输出” Cucumber 场景；本期不提交无可用 fixture 的永久 skip/
   假绿场景，以 KFS route、Dify service、node 和 DSL fixture 的分层合同测试替代。
2. 含 v2 节点的 DSL 导出样例进测试 fixture，防 schema 回归。
3. 文档：节点使用文档 + v1/v2 对比表（数据源、配置归属、citation、模式差异）。
4. 发布策略：随 workspace 级 KnowledgeFS 开关走，不设独立 flag；回滚 = 关空间侧开关，
   节点运行 fail-closed 报 503，错误文案给出指引。

---

## 依赖与并行

- 关键路径：迭代 1 → 2 → 3 → 4（合同链，串行）。
- 迭代 5 在设计决策定稿后即可并行（mock 服务层）。
- 总量约 22–26 人日；一前一后两人约三周到可发布。

## 风险清单（按优先级）

1. 草稿运行 admission 语义（迭代 4.2）——最易返工，提前到迭代 2 一起定义。
2. includeText 后响应体量触产品操作限额——迭代 1 内完成核算并定截断上限。
3. research 模式同步延迟——允许但默认不选，待 PageIndex research v2 落地后再放开宣传。
4. 跨空间分数合并可解释性——文档先行，避免用户拿跨空间分数做阈值分支。
5. 双节点并存的面板认知成本——命名与门控按 D1/迭代 5.3 执行；纯 greenfield 空间是否隐藏
   v1 为待定产品决策，不阻塞开发。

## 后续项（明确不在本期）

- automatic metadata 过滤（LLM 抽取条件）。
- 跨空间统一 rerank。
- workflow 检索空结果回流 KFS failed-query 质量体系（需网关侧记录开关，独立立项）。
- v1 → v2 迁移工具与 v1 退役计划。
