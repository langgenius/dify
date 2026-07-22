# Figma New RAG 后端对齐迭代计划

## 1. 目标与范围

本计划把 Figma `New RAG` 仅作为产品能力与业务流程的需求输入，用于审查和迭代当前后端服务；
不在本仓库实现页面、组件、样式、前端 API client 或 BFF。后端范围包括：

- Knowledge Space 基础信息、成员权限、API Access 与安全删除。
- 空间级 reasoning、embedding、rerank、retrieval depth、Top K、Score Threshold 配置。
- Source provider、连接凭据、OAuth、抓取预览、同步任务与同步策略。
- Document 上传、逻辑文档 revision、编译任务、chunks、metadata 与索引发布。
- Overview、Evidence History、Quality、Bad Case Replay 与审计活动。

不在本计划中改变的既有约束：

- Embedding 维度由用户选择的 plugin-daemon 模型实际能力决定，禁止写死为 1536。
- 每个 Knowledge Space 先独立持久化用户选择的 embedding route；首次激活后再持久化由该模型实际响应派生的 vector-space 标识、维度与 revision。
- `Fast` 使用普通混合检索 + rerank。
- `Research` 使用 Summary / Outline / PageIndex。
- `Deep` 使用普通混合检索 + Graph + rerank。
- Graph 不进入 Research 路由，Outline/PageIndex 不进入 Deep 路由。
- Hono API 是业务、鉴权和产品状态的唯一服务边界；任何前端或 BFF 集成都属于仓库外调用方。

## 2. 实施原则

1. **安全边界先于设置表单**：先修复越权和敏感信息泄漏，再开放新的管理 API。
2. **候选版本先构建、验证后发布**：解析、embedding、多模态和 smoke evaluation 全部成功前，新索引不可被查询。
3. **配置版本化**：空间设置、检索配置和成员策略使用 `revision`/CAS，避免并发保存覆盖。
4. **长任务持久化**：crawl、sync、upload、reindex、delete、replay 均使用 durable job，不依赖单个 HTTP 连接或进程内 Map。
5. **密钥与业务元数据分离**：Source DTO 永不返回明文凭据，数据库只保存 `credentialRef`。
6. **旧接口兼容迁移**：先 dual-read/default fallback，再 backfill，最后切换写路径并移除旧字段。
7. **逐阶段可验收**：每个迭代都必须有单元、repository、route 和失败路径测试，不把验证集中到最后。

## 3. 总体里程碑

| 迭代 | 目标 | 状态 | 主要风险等级 |
| --- | --- | --- | --- |
| 0 | 风险止血：凭据脱敏、三模式 published 检索、索引原子发布门禁 | 已完成（R0、R1、3B3/3C；profile/head 联合迁移归迭代 3） | P0/P1 |
| 1 | Space ACL、主体鉴权、API Access | 已完成（ACL、API Access、权限快照、durable Research、SecretStore） | P0/P1 |
| 2 | Space/Source/Document 安全删除与生命周期一致性 | 已完成（durable job、tombstone、writer fence、全域清理与残留证明） | P1 |
| 3 | 版本化 RetrievalProfile、模型预检和 embedding 原子迁移 | 已完成（动态维度、profile/publication 联合切换、legacy backfill） | P1/P2 |
| 4 | Source provider/connection、OAuth、crawl/sync durable jobs | 已完成（0021、durable workflow、Logical Revision bridge） | P1/P2 |
| 5 | Document revision、逐文件上传、Tasks/Chunks/Metadata | 已完成（0022、candidate admission、联合 publication） | P1/P2 |
| 6 | Overview、Evidence History、Quality Replay、审计与端到端验收 | 已完成（bounded API、durable replay、fresh permission/deletion fence） | P2 |

## 4. 迭代 0：风险止血

### 4.1 Source 响应脱敏

任务：

- 在 Source API 输出边界增加统一 sanitizer。
- 删除或掩码 `credentials`、`apiKey`、`accessToken`、`refreshToken`、`secret`、`password` 等字段。
- sanitizer 必须递归处理嵌套对象和数组，且不得修改 repository 中保存的原对象。
- list/get/create/update/crawl/import 等所有返回 Source 的 API 使用同一输出映射。
- 保持 connector 内部读取旧 `metadata.credentials` 的兼容性；Secret Vault 在迭代 1 完成。

验收：

- 任意 read scope 响应中不出现凭据值。
- 非敏感 metadata 完整保留。
- 输入对象未被原地修改。
- route/schema 单元测试覆盖嵌套字段、大小写变体和数组。

### 4.2 Research durable job 参数完整性

任务：

- 将请求中的 `mode`、`topK` 写入 job record/payload。
- worker 从持久化 payload 构建 retrieval plan，不重新使用全局默认值覆盖。
- 对旧 job payload 提供默认值兼容。
- 确认 retry/resume 后参数不丢失。

验收：

- 同一个 Research 请求的同步/异步路径使用相同 mode、topK。
- job serialize/deserialize、retry 和 worker 测试通过。

### 4.3 索引发布门禁

任务：

- reindex 只构建 `building/candidate` projection。
- multimodal、smoke evaluation 和所有必要检查成功后才发布为 `ready/active`。
- 失败时 candidate 标记 `failed` 或清理，但保留旧 active revision 可查询。
- 发布动作使用 repository CAS；并发编译不得覆盖更新的 active revision。

验收：

- smoke evaluation 失败时，新 projection 不出现在检索集合中。
- 新版本成功前旧版本持续可用。
- 成功发布只有一个 active generation。
- 单元测试覆盖成功、失败、取消和并发冲突。

### 4.4 迭代 0 完成定义

- 定向测试全部通过。
- `@knowledge/api` typecheck 通过。
- Source 公共响应无敏感字段。
- 异步 Research 参数与请求一致。
- 编译失败内容无法被任何检索路径命中。

## 5. 迭代 1：Space ACL、主体鉴权与 API Access

### 5.1 数据模型

新增建议：

- `knowledge_space_members`
  - `tenant_id`, `space_id`, `subject_id`
  - `role`: `owner | editor | viewer`
  - `created_at`, `updated_at`, `policy_revision`
  - 唯一键 `(tenant_id, space_id, subject_id)`
- `knowledge_space_access_policy`
  - `visibility`: `only_me | all_members | partial_members`
  - `revision`, `updated_by`, timestamps
- `knowledge_space_api_access`
  - `enabled`, `revision`, `disabled_at`, `updated_by`
  - API key 仅保存 hash、prefix、last_used_at、revoked_at

规则：

- 每个 Space 必须至少一个 owner。
- `partial_members` 至少一个成员，否则保存失败。
- viewer 只能读取，不能修改设置、上传、同步、删除或进入危险区。
- tenant scope 是第一层隔离，space membership 是第二层授权，二者缺一不可。

### 5.2 API 与中间件

新增/调整：

- `GET/PATCH /knowledge-spaces/:id/access-policy`
- `GET/POST /knowledge-spaces/:id/members`
- `PATCH/DELETE /knowledge-spaces/:id/members/:subjectId`
- `GET/PATCH /knowledge-spaces/:id/api-access`
- `POST /knowledge-spaces/:id/api-keys`
- `DELETE /knowledge-spaces/:id/api-keys/:keyId`
- 在所有 space/source/document/query 路由统一调用 space authorization guard。
- Query、MCP、Service API 和 Agent Access 在 API Access 关闭后立即拒绝新请求。

调用方身份契约：

- Knowledge API 只接受受信认证层产生的可验证 subject 与权限上下文，不能把共享管理员 token 当作用户身份。
- 所有授权在 Hono API 内执行，不能依赖调用方隐藏按钮或预过滤资源。
- 浏览器会话、Origin/CSRF 和 BFF 代理属于仓库外客户端职责，不在本项目实现。

### 5.3 凭据迁移

- 定义 `SecretStoreAdapter`：`put/get/delete/rotate`。
- 新建 Source Connection 只保存 `credentialRef`。
- backfill 旧 `metadata.credentials` 后清除明文字段。
- 迁移期间 dual-read：优先 `credentialRef`，旧字段仅作为短期 fallback 并记录告警。

### 5.4 验收

- 跨 Space 读写均返回 403，不能依赖前端隐藏。
- viewer 所有 mutation 返回 403。
- API Access 关闭后 Service API/Agent 请求立即失效。
- Source list/get/create/update 的响应和日志均无凭据。
- 所有 mutation 都需要可验证主体，并在后端校验对应 space role。

## 6. 迭代 2：安全删除与生命周期一致性

### 6.1 通用删除状态机

新增 durable deletion job：

`requested -> quiescing -> deleting_objects -> deleting_derived_data -> deleting_primary_data -> completed`

失败进入 `failed_retryable`，每个阶段保存 cursor/checkpoint 和幂等键。

### 6.2 Space 删除

- API 要求 owner/admin、完整知识库名称 challenge 和 expected revision。
- CAS 将 Space 标记为 `deleting`，立即拒绝新 upload/sync/query/settings mutation。
- 停止或 drain crawl、sync、compile、research、reindex job。
- 分页枚举并删除 raw/artifact/image/staging 对象。
- 清理/redact trace、evidence、cache、projection、outline、graph、path 等派生数据。
- 最后删除主记录并保留最小 tombstone/audit。

### 6.3 Source 与 Document 删除

- Source 先标 `deleting`，再按 checkpoint 删除或 detach 文档，最后删除 Source。
- `documents=keep` 必须清除 source reference，不允许悬挂 sourceId。
- Document 先保存所有 object key，再事务清理派生引用，最后幂等删除对象。
- 删除/替换 revision 后失效相关 cache，并真正执行 trace/evidence redaction。

### 6.4 验收

- 任意阶段失败后可从 checkpoint 重试。
- 超过单批上限时返回未完成状态，不能误报 204 completed。
- 删除结束后 DB、Object Storage、cache、trace/evidence 不残留可识别内容。
- 活动 job 不会在 tombstone 后重新发布索引。

## 7. 迭代 3：空间级 RetrievalProfile 与模型迁移

### 7.1 配置模型

建议建立版本化 `retrieval_profile`：

```ts
type RetrievalProfile = {
  revision: number;
  reasoningModel: {
    pluginId: string;
    provider: string;
    model: string;
  };
  embedding: {
    pluginId: string;
    provider: string;
    model: string;
    vectorSpaceId: string;
    dimension: number;
    revision: number;
  };
  rerank: {
    enabled: boolean;
    pluginId?: string;
    provider?: string;
    model?: string;
  };
  defaultMode: "fast" | "deep" | "research";
  topK: number;
  scoreThreshold: {
    enabled: boolean;
    value?: number;
    stage: "rerank" | "normalized-final";
  };
};
```

覆盖优先级：`validated request override > frozen active space profile`。pending selection 在完成能力验证前不得被 query/ingestion 消费，生产不回退 deployment default。

### 7.2 Score Threshold 语义

- Fast 的 RRF score 与 reranker score 不同，禁止直接共用未归一化的 0.5。
- `rerank` stage 只允许 rerank 启用时使用。
- `normalized-final` 必须对各 retrieval path 输出稳定的 `[0, 1]` 归一化分数。
- 明确 threshold 是过滤 evidence，还是触发 no-evidence/low-confidence；生成器不得绕过过滤结果。

### 7.3 模型目录与预检

- plugin-daemon 暴露 model/provider/capability catalog。
- 新建空空间与尚无 active profile/head 的未发布空间，保存 reasoning/embedding/rerank 时只 CAS 持久化
  `pendingModelConfiguration` 的 selection/digest/revision，返回 `pending-validation`，plugin-daemon 调用必须为 0。
- 首个文档的 durable async compilation attempt 取得 lease 后才执行 tenant-scoped catalog、credential 和真实 invocation
  preflight；该阶段从 embedding 实际响应取得 dimension/metric/model identity，派生 vectorSpaceId 并激活 immutable
  embedding/retrieval profile heads。
- 激活必须在 daemon 调用前后重验 pending digest/revision；首个 embedding/retrieval profile、两个 active heads 与
  pending clear 在同一个数据库事务中提交，再用 fenced `bindInitialProfiles` 将 exact refs 恰好一次绑定到 attempt，
  然后才进入 parser/index worker；过时验证结果不得激活，也不得暴露 partial tuple。
- 非可重试失败仅保存 allow-listed `validation-failed` 代码/时间/retryable，不回显 provider 原始错误、候选 selection
  或凭据；用户可修改 pending config 后由下次 durable attempt 重试。
- 已发布空间保持旧 active tuple 可用，模型/检索设置变更走 capability validation + durable candidate migration，不得用
  pending selection 直接覆盖当前 profile/publication。
- Research 的索引/检索契约是 Summary/Outline/PageIndex，首次模型激活与 query-time 检索都不依赖 Graph；Fast/Deep
  才要求已验证 embedding，Deep 在普通混合召回后使用 Graph 扩展。

### 7.4 Embedding 原子迁移

- 模型变化生成 candidate `vectorSpaceId/revision`。
- 后台完整重建 dense/相关 projection，不覆盖 current active。
- smoke evaluation 成功后 CAS 切换 active profile。
- 失败保留旧 profile，并允许 retry/cancel。
- 即使 route 字符串相同，也允许显式 bump revision 触发重建。

### 7.5 验收

- 不同 Space 可选择不同模型和不同维度。
- ingestion/query 始终使用同一 active vector-space。
- Reasoning、Rerank、Mode、Top K、Threshold 的空间级值均在运行时被消费。
- Fast/Deep/Research 仍严格使用各自既定索引路径。

## 8. 迭代 4：Source 控制面与 durable jobs

### 8.1 Provider 与 Connection

- `GET /source-providers` 返回 provider、capabilities、configuration schema 和连接状态。
- `POST /knowledge-spaces/{id}/source-connections` 支持 API key/endpoint 类型。
- OAuth：start、callback、PKCE/state、refresh、revoke。
- Source 引用 `connectionId`，不直接保存凭据。

### 8.2 Crawl Preview Job

状态机：

`queued -> crawling -> preview_ready -> importing -> syncing -> completed`

异常状态：`zero_results | failed | canceled`。

接口：

- 创建 preview job。
- 分页读取已发现页面，不返回无界完整 content。
- SSE/轮询进度。
- stop/cancel/retry。
- 提交选中的 page IDs 后才 materialize。

### 8.3 Sync Policy 与历史

- first-class policy：`provider | manual | interval | custom`。
- 支持 6h/12h/24h/3d/7d 与明确单位的 custom interval。
- `source_sync_runs` 保存 run、进度、错误、cursor、retry 信息。
- 提供单个和 bulk Sync/Disable/Remove，结果必须包含 eligible/skipped/failed。
- Online Drive continuation token 贯穿 browse API。

### 8.4 版本与远端删除

- 用 `providerItemId + contentHash/etag` 识别逻辑对象。
- 新 revision ready 后再下线旧 revision，防止重复检索。
- 远端删除使用可配置 tombstone policy。

## 9. 迭代 5：Document 产品模型

### 9.1 Logical Document 与 Revision

- `documents`：逻辑文档、activeRevisionId、source identity。
- `document_revisions`：不可变 revision、contentHash、status、object keys、parser/model versions。
- duplicate upload 根据规则创建 v2，而不是新的 version=1 asset。
- candidate revision 成功后 CAS 切 active；支持查看历史和 rollback。

### 9.2 逐文件上传

- 每个文件独立 admission：accepted/excluded/reason。
- 合法文件即使同批其他文件失败也能返回 202 并继续处理。
- MIME、extension、size、count 在写 Object Storage 前验证。
- 任务失败时清理 staging，不能留下会运行但 raw object 已删除的 job。

Figma 契约确认项：

- 统一 15 MB 与 50 MB 两套限制。
- 统一每批 20 与当前 25 的差异。
- 统一 DOCX、CSV、JSONL 的支持范围。

### 9.3 Tasks、Chunks、Metadata

- Tasks 支持按 space/document 分页、retry、cancel、SSE/轮询。
- Document 聚合 status：upload/parse/chunk/embed/evaluate/publish。
- Chunks API：分页、搜索、parent-child、token count、enable/disable。
- Metadata 分成 `systemMetadata` 与 `userMetadata`；PATCH 使用 expected revision。
- Document Settings 支持索引行为，但不得破坏 active revision 一致性。

## 10. 迭代 6：Overview、Evidence 与 Quality

实施状态：已完成。数据库迁移 `0023`/`0024`、repository、route、worker、权限/删除围栏和 PostgreSQL/TiDB SQL 回归均已落地；本迭代未增加任何前端代码。

### 10.1 Overview

- 建立 query/evidence/quality/source-sync/document-index 指标事件。
- 支持 24h/7d/30d 聚合：query count、answer rate、knowledge count、linked apps、freshness。
- Needs Attention 由可追踪规则生成，并提供对应 action。
- Recent Activity 保存 actor、action、resource、timestamp 和结果。

### 10.2 Evidence History

- AnswerTrace repository 增加按 space 分页、搜索和时间筛选。
- Evidence item 返回 passage/citation、source revision、offset/chunk/page、retrieval/rerank/final score。
- 支持 missing evidence dismiss，并记录 actor/reason。
- EvidenceBundle 统一为明确 repository 或明确只嵌入 Trace，移除当前双重架构漂移。

### 10.3 Quality 与 Replay

- first-class bad case：`open | replaying | fixed`。
- replay job：`queued | running | passed | failed | canceled`。
- 保存输入 profile revision、trace、diff、evidence 变化和运行历史。
- 提供 outcome trend、top unanswered、triage 与 baseline comparison。

### 10.4 端到端验收

- Figma 中每个需要跨请求保存、影响权限或驱动任务的产品状态都有对应后端 API/状态机；纯视觉状态不进入本项目。
- Viewer、API Access off、失败编译、删除中、crawl cancel、revision rollback 均有 E2E。
- PostgreSQL/TiDB migration artifact 一致。
- Swagger/API reference、operator manual 与部署环境变量同步更新。

实施结果：

- Overview stats/attention/activity/health 均提供 bounded tenant/space/grant scoped API；failed-query attention 额外绑定 exact requester。
- Evidence history、missing-evidence CAS/audit、bad-case lifecycle/history 已落地。
- Replay 使用 durable run/items/outbox、lease/checkpoint 与 frozen profile/publication/model/vector-space snapshot；Fast/Research/Deep 通过同一真实 retrieval-test executor 执行。
- Quality/failed-query/attention 的外部 mutation 均由 handler 签发 fresh permission snapshot，在数据库事务内先锁定 active space/deletion admission，再重验 subject/channel/revision/member/policy/API Access/scopes 后写入。
- legacy failed-query 无 provenance 行默认不可读；list、metrics、cluster、annotate、Overview 与 trends 均不会形成跨 subject、partial-grant 或 pagination/aggregation oracle。

## 11. 迁移和发布策略

每个含 Schema 的迭代采用以下发布顺序：

1. 添加 nullable/default-compatible schema 与 repository dual-read。
2. 部署新读路径，保持旧写路径可用。
3. bounded backfill，记录 cursor 和失败项。
4. 切换新写路径，并监控旧字段 fallback 命中率。
5. fallback 归零后再收紧约束或删除旧字段。

高风险功能使用 feature flag：

- `SPACE_ACL_ENFORCEMENT`
- `SOURCE_SECRET_STORE`
- `CANDIDATE_INDEX_PUBLISH`
- `RETRIEVAL_PROFILE_V2`
- `SOURCE_DURABLE_JOBS`
- `DOCUMENT_REVISIONS`

feature flag 只用于渐进启用，不能长期绕过安全校验。

## 12. 测试矩阵

每个迭代至少覆盖：

- Core schema：合法/非法输入、默认值和版本兼容。
- Repository：tenant+space scope、CAS、cursor、事务失败。
- Handler/route：401/403/404/409/422、脱敏和错误 DTO。
- Worker：成功、失败、取消、重试、进程重启和幂等。
- Retrieval：Fast/Deep/Research 路由、模型配置和 threshold。
- Migration：PostgreSQL/TiDB artifact 与 backfill fixture。
- Auth boundary：主体可信链、tenant+space role、API Access off 与 viewer read-only。
- E2E：创建→接入 Source/上传→编译→检索→Evidence→删除。

## 13. 当前执行批次

以下批次按实际实施时间保留为历史轨迹；当前权威完成状态以 13.10 和可追踪矩阵为准。计划创建后首先执行迭代 0：

1. Source API 响应脱敏。
2. Research job 持久化并消费 `mode/topK`。
3. 编译流程延迟 projection publish，失败不暴露候选索引。
4. 合并后运行定向测试、API typecheck，并记录仍需在迭代 1/2 完成的架构性缺口。

### 13.1 迭代 0 批次 1 执行记录（2026-07-13）

已完成：

- Source Create/List/Get/Update 公共响应统一递归移除敏感 metadata；repository 与 connector 内部保持兼容。
- Research task 将规范化后的 `mode/topK` 写入 job 与 queue payload，resume 后继续透传；OpenAPI 字段保持可选以兼容旧任务。
- Document compilation 在支持状态切换的 repository 上先创建 `building` candidate，multimodal 与 smoke evaluation 成功后发布；失败或部分发布时将本次 candidate 标记为 `failed`，不影响旧 ready revision。

验证结果：

- `@knowledge/api` 全量测试：173 个文件、1086 项测试通过（包含批次 2 回归用例）。
- `@knowledge/api` TypeScript typecheck 通过。
- 本批目标文件 Biome check 通过。

留到后续迭代的架构项：

- Source 明文凭据仍需在迭代 1 迁移到 `SecretStoreAdapter`；本批只保证不从公共 API 泄漏。
- Projection publish 当前是按批状态更新，不是数据库级单事务 active pointer 切换；迭代 3 需要 candidate generation + CAS publication。
- Smoke evaluation 尚需显式绑定 candidate publication/fingerprint，确保评估只读取本次候选的 FTS、dense 与其他 projection。

批次 1 复审后新增的阻断项：

- 通用 Source metadata PATCH 必须保留服务端现有敏感字段，避免客户端把 GET 的脱敏结果回写后误删凭据。
- 同步 ingestion 也必须使用 staged projection publication，不能只修 durable worker。
- Candidate 必须有独立 build/generation identity；同一 document revision 的重试或并发 worker 不能覆盖已 ready 的 projection。
- Outline、KnowledgePath、Semantic Graph、multimodal manifest 需要和 dense/FTS 一样绑定 candidate generation，失败 candidate 对 Deep/Research 不可见。
- Smoke evaluation 必须提供 candidate-only preview read，不能在 candidate 为 `building`、asset 为 `pending` 时退回评估旧 ready index。

### 13.2 迭代 0 批次 2 执行记录（2026-07-13）

已完成：

- Source metadata PATCH 改为 fresh-read + CAS 安全合并。客户端把 GET 的脱敏 metadata 回写时，服务端现有凭据和嵌套 token 仍会保留；通用 PATCH 不能新增、覆盖或删除敏感值。
- 同步 document compilation 与 durable worker 一样使用 staged projection publication。Manifest、Segments 或分批 publish 失败时，本批 `building/ready` projection 全部转为 `failed`。
- 增加脱敏 round-trip 后 credential tester 仍可用、同步 pipeline 成功发布、segments 失败不发布、分批 publish 中途失败完整清理等回归测试。

迭代 0 尚未完成的 P1：

- 现有 staged publish 仍只隔离 dense/FTS projection；Outline、KnowledgePath、Graph、multimodal manifest 还没有 publication fingerprint。
- Smoke evaluation 还不能读取且只能读取本次 candidate，当前可能实际评估旧 published index。
- Candidate identity 尚未独立于 document revision；同 revision 并发或 retry 仍可能覆盖已发布行。
- Publication 应延迟到外层 staged commit/status 完成，并通过单个数据库事务 CAS 切换 space publication head。

### 13.3 迭代 0 批次 3A 执行记录（2026-07-13）

已完成：

- 新增持久化 `projection_set_publications` 历史账本与每空间唯一的
  `projection_set_publication_heads`，提供单调 `head_revision`。
- PostgreSQL/TiDB 0003 migration 与 schema catalog 同步；TiDB 外键和索引字段使用有界
  `VARCHAR`，避免 `TEXT` 参与复合外键。
- 数据库与内存 repository 使用严格 `expectedHeadRevision` CAS；首次发布竞争、普通发布、
  rollback、delete 与 GC 均以 tenant+space 为作用域。
- PostgreSQL 发布事务固定使用同一连接执行 `BEGIN/COMMIT/ROLLBACK`；状态切换与 head 更新在
  同一事务内完成。无事务能力时 fail closed，不伪装成原子发布。
- publish/delete 统一按 `head/current -> target` 加锁，避免删除当前 head 与发布新候选时形成
  反向锁等待；失败事务保留旧 head 并回滚候选状态。
- 创建 publication 前验证 Knowledge Space 的 tenant 归属；UUID、tenant 长度、INT 和时间字段
  在 SQL 前按实际数据库边界校验并规范化。
- API 数据库 repository bundle 已注入持久化 publication repository，供下一批编译流程接线。

本批验证：

- Publication 定向测试覆盖 PostgreSQL/TiDB SQL、CAS 冲突、并发首发、rollback、锁序、
  tenant 归属、GC cursor 与输入边界。
- Workspace typecheck：20/20 tasks 通过。
- Workspace test：20/20 tasks 通过；其中 `@knowledge/api` 174 个文件、1099 项测试通过，
  `@knowledge/api-app` 95 项、adapters 100 项（1 项环境集成测试跳过）、database 28 项、core
  41 项通过。
- PostgreSQL/TiDB migration drift、目标文件 Biome 与 `git diff --check` 通过。

迭代 0 仍未完成的 P1：

- 编译 orchestrator 尚未消费新的 publication head；必须先让 Outline、KnowledgePath、Graph、
  multimodal manifest、dense/FTS 全部绑定同一 publication fingerprint。
- Candidate build ID 仍需从 document revision 中拆分，保证同 revision retry/concurrency 不覆盖。
- Smoke evaluation 必须只读 candidate publication；通过后才允许从 `validating` CAS 发布。完成前
  新 repository 不暴露正式发布 API，直接从 `candidate` 发布的兼容路径将在批次 3C 收紧。
- TiDB 当前仅有双方言 SQL与事务 fake 测试；生产 transaction runner 未提供，因此继续明确
  fail closed。若启用 TiDB 生产部署，必须先补真实事务 adapter 与数据库集成测试。

### 13.4 迭代 0 批次 3B1 执行记录（2026-07-13）

本批采用“整空间 publication + 多 generation 成员快照”，而不是直接用 publication fingerprint
过滤单文档派生表。原因是 fingerprint 表示整个 Knowledge Space 的发布快照，而编译是单文档增量；
若把新 fingerprint 写到本次文档并作为所有表的等值过滤条件，未重编译文档会从新快照中消失。

已完成：

- IndexProjection、DocumentOutline、multimodal manifest、KnowledgePath、Graph Entity、Graph
  Relation 六类派生数据支持可选、不可变 build generation；旧调用保持 `NULL` generation 兼容。
- 新增 `projection_set_publication_members`，以 publication、component type、物理 component key、
  generation 和可选 document asset 记录不可变快照成员；一个 publication 可继承多个历史 generation。
- Member repository 支持从当前 published head 继承、按 component type 替换、按 document 原子替换和
  fingerprint 读取；mutation 强制 tenant+space scope、candidate status 与 expected head revision CAS。
- Publication head 变更与 member mutation 在读取 head 前统一锁定稳定的 Knowledge Space 行，首次发布时
  即使 head 尚不存在也能串行化，避免“锁空行”导致 expected revision=0 被并发发布绕过。
- PostgreSQL 的 head/candidate 锁定、成员删除和写入固定在同一连接事务；当前 TiDB transaction runner
  不满足该原子性要求，因此 mutation 继续 fail closed。
- PostgreSQL/TiDB `0004` expand migration 为六个派生表增加 nullable generation，并把逻辑唯一索引
  改为 generation-aware；legacy `NULL` 统一映射 zero UUID，保留旧 writer 的幂等语义。
- Outline 与 Graph Relation 的新唯一约束遇到 legacy duplicate 时让 migration fail closed，不任意删除
  可能携带权限/evidence 的旧行；Outline 数据库写入从 delete+insert 改为原子 upsert，避免并发读到空洞。
- 四类派生 repository 的 logical upsert 保留首次 physical ID；PostgreSQL `RETURNING` 和 TiDB 回读都返回
  实际持久化 ID，且 upsert 不允许迁移 space、generation 或 logical identity。
- Graph list/prune/traverse 与 projection publish/rollback/summarize/prune 全部 generation-scoped；未显式传
  generation 时只作用 legacy `NULL`，指定时严格等值，Deep candidate 不会混入 legacy read 或被跨代裁剪。
- 五个高频读取/遍历索引把 generation 放在 space scope 后的前导位置，避免保留历史 generation 后扫描放大。
- API 数据库 repository bundle 已注入 member repository；本批没有引入固定 vector typmod，embedding
  维度仍完全由 Knowledge Space 选择的 plugin-daemon 模型和持久化 vector-space 决定。

本批验证：

- Workspace typecheck：20/20 tasks 通过。
- Workspace test：20/20 tasks 通过；其中 `@knowledge/api` 176 个文件、1131 项测试通过。
- PostgreSQL/TiDB migration drift、目标文件 Biome 与 `git diff --check` 通过。

批次 3B2–3C 的剩余发布闭环：

- 编译 attempt 必须创建独立 generation，并把同一 generation 透传到六类 builder/writer；builder 的
  deterministic physical ID 必须包含 generation，避免新 generation 撞到旧行全局主键。
- 每个 attempt 独占 candidate，并持久化 attemptId、ownerDocumentAssetId、baseHeadRevision；head 变化后
  废弃并 rebase 整个 attempt，禁止两个文档共享 candidate 后重复 inherit。
- Candidate 先继承 published 成员，再按 document 替换本次 generation；Graph 必须生成完整一致的候选
  子图，不能把 candidate observation 合并进 published canonical row。
- 进入 validating 前校验六类 member 对应实体真实存在，且 space、generation、document owner 一致；成员
  读取改为分页或 transaction-local chunking，不能受当前 100/1000 默认边界截断。
- 为现有 published head 建立可审计的 legacy `NULL` membership bootstrap；切换正式 read 前验证成员数量，
  禁止空 membership 让存量知识空间静默检索为空。
- Fast、Deep、Research 三条正式查询必须从 published head 解析成员范围并 fail closed；兼容 fallback 只能
  在显式迁移窗口启用，不能在 fingerprint/member 缺失时静默放宽到全表。
- Smoke evaluation 改为 candidate-only preview；通过后才允许 `validating -> published` CAS，失败必须保留
  旧 head 并把 candidate 标记为 failed。

### 13.5 迭代 0 批次 3B2A 执行记录（2026-07-13）

本批先建立 generation-safe 的编译与派生写入契约，不直接切换正式检索。原因是复审确认生产环境尚未
持久化 document compilation attempt，现有 retry 还会把已重新排队的任务错误标成 terminal failed；若在
这个状态下直接启用 generation writer，新派生行会与 legacy published read 脱节。

已完成：

- `DocumentCompilationJob`、queue payload 与 API response 增加可渐进启用的独立
  `publicationGenerationId`。配置 generation 模式时在 enqueue 前生成一次；幂等 enqueue 返回旧 payload
  时复用旧 generation，queue redelivery 不会临时换代；legacy job 默认仍不生成该字段。
- Outline、multimodal manifest、KnowledgePath、FTS、dense、visual、Graph Entity 与 Graph Relation 的
  builder/writer input 全部支持可选 generation，并由统一的 non-zero UUID schema 校验。generation UUID 在
  进入 deterministic seed 前统一转成小写，大小写不同的同一 UUID 不会产生两组物理 ID。
- generation 模式的默认 physical ID 由 generation 与逻辑 identity 确定：同一 generation 重试返回相同 ID，
  不同 generation 不共用主键；未提供 generation 时保留原 legacy ID/seed 和写入行为。
- 复审确认 `KnowledgeNode` 尚无 generation scope，直接把 candidate node 写入共享表会被 legacy
  `listBySpace/listByArtifact` 立即读到。因此 Incremental reindexer、同步 compilation pipeline 和 durable
  worker 在 publication-scoped node storage/read 接入前都对 generation 模式 fail closed；不能用“换 node ID
  + metadata 标记”伪装隔离。三类 projection builder 的 generation 能力保留给 3B2C 的隔离节点编排。
- Semantic postprocessor 返回实际持久化的 graph entity/relation IDs，供后续 publication member 登记；
  Graph writer 的 generation 模式不写共享 `KnowledgeNode.metadata.graphEntityIds`，避免未发布 candidate
  污染当前 Deep read。
- 现有 entity/relation extraction 会覆写共享 KnowledgeNode metadata，因此 generation-scoped semantic
  ingestion 在隔离 node metadata 前明确 fail closed，不能靠“写完再恢复”制造并发可见窗口；对应 Graph
  writer 能力保留给 3B2C 的纯计算/隔离节点编排。
- Semantic community 是跨文档派生物，不能冒充当前 document 的成员；留到全空间 candidate
  graph/community 重建或 member-scoped traversal 批次处理。legacy 同步 ingestion 暂保留原兼容行为。
- 同步 pipeline 先持久化并取得 canonical ParseArtifact，再让 outline、manifest、paths、reindex、semantic 和
  segments 使用同一物理 artifact ID；数据库 upsert 回读缺行、重复或 logical key 不一致时 fail closed，不再
  回退到调用方临时 ID。Durable worker 通过 reindexer 的 canonicalize 能力恢复
  `parsed -> outline -> nodes/projection` 顺序，outline/manifest 失败不会因 canonical 回读而提前暴露 ready
  projection。
- TiDB Graph upsert 按 space + logical identity + generation 的 NULL-safe key 回读实际 entity/relation ID，关系
  端点只使用 canonical entity ID。`0005` 同时在 PostgreSQL/TiDB 排除 zero sentinel；TiDB 额外校验完整 UUID
  格式，migration runner 在应用或检测到该迁移后每次验证 TiDB >= 7.2 且
  `tidb_enable_check_constraint=ON`，否则在 DDL 前失败。

本批验证：

- Workspace typecheck：20/20 tasks 通过。
- Workspace test：20/20 tasks 通过；其中 `@knowledge/api` 177 个文件、1155 项测试通过，Core 46 项、
  Database 31 项、Adapters 104 项通过（1 项环境集成测试跳过）。
- PostgreSQL/TiDB migration drift、目标文件 Biome 与 `git diff --check` 通过。

本批刻意未启用的路径：

- Durable worker、同步 pipeline 和 reindexer 会识别 generation，但在 publication coordinator 与
  publication-scoped KnowledgeNode 接入前明确 fail closed，不会静默丢弃 generation 后写入 legacy 行。
  正式 writer 接线要等 3B2B 的持久化 attempt/production worker wiring 与 3B2C 的隔离编排完成，避免只有
  内存 job 的“伪持久化”。
- 正式 Fast/Research/Deep read 仍读取 legacy published 数据；在 3B3 完成 head/member read scope 与 legacy
  membership bootstrap 前，不把新 generation writer 设为默认。

复审后固定的后续子批次：

1. **3B2B — durable attempt/outbox**：新增数据库 attempt 表，持久化 attemptId、generationId、owner、
   candidate publication/fingerprint、base head revision、queue identity、retry/error/stage；DB 作为 source of
   truth，outbox/dispatcher 消除 enqueue 与 repository create 的双写窗口。修正 retryAt 不得写 terminal、
   redelivery 可从数据库恢复，并完成 PostgreSQL/TiDB repository 与生产 app worker wiring。
2. **3B2C — candidate/member orchestrator**：在 document publish lease 内创建 candidate，继承当前 head 并
   排除 owner document，一次性替换 owner 的完整组件集合；服务器端验证六类实体的 space/generation/owner、
   projection 模型/维度和引用闭包。先为 KnowledgeNode 增加 generation scope 并让所有 node read 默认只读
   published/legacy scope，随后才解除 reindexer 的 generation fail-closed。单文档超过 1000 members 时使用
   staging replace/transaction-local chunking，不能多次调用 replace 覆盖前一批。
3. **3B3 — published read cutover**：先为存量 head 建立可审计的 legacy membership，再让 Fast、Research、
   Deep 从 published head 解析 member IDs。Graph 使用 member-ID scoped traversal 或全空间 candidate graph，
   不能把多个 generation 当成单一 generation 等值查询。
4. **3C — candidate evaluation/publish**：candidate-only smoke/evaluation 通过后才进入 publish CAS；head 冲突
   废弃旧 candidate，并以新 base head 创建新 attempt/rebase。head 成功后才收尾 job/asset/staged commit；
   publish 成功后的状态写失败交给 reconciliation，catch 不得回滚已发布 projection。

### 13.6 迭代 0 批次 3B2B 执行记录（2026-07-13）

本批把 document compilation 的控制面从内存 job 推进为数据库 source of truth，但继续保持正式
generation writer 关闭。3B2C candidate/member coordinator 尚未完成前，生产入口对显式 runtime 开关
fail closed，避免用一个注定失败的占位 processor 批量终止已创建 attempt。

已完成：

- 新增 `document_compilation_attempts` 与 transactional outbox。一次事务原子写入 attempt、独立 non-zero
  generation、base head revision 和 `{attemptId}` outbox event；active scope/version 唯一键阻止同一文档版本
  出现两个并行 attempt。
- 内存与 PostgreSQL/TiDB repository 支持 start、claim、heartbeat、checkpoint CAS、retry、cancel、supersede、
  terminal 收尾、manual retry 和过期历史清理。`rowVersion + leaseToken + queueJobId` 是执行 fence；外部 broker
  ID 只作可选 shadow identity，不替代内部 delivery identity。
- Candidate publication ID 与 fingerprint 首次绑定时验证 tenant、space、ID、fingerprint 和 candidate 状态；
  绑定后不可变。数据库复合外键同时约束 Knowledge Space tenant、Document Asset version 和 candidate
  fingerprint，不只依赖应用层检查。
- Outbox dispatcher 只投递严格 `{attemptId}` payload，复用持久化 idempotency key；enqueue、mark、release 与
  dead-letter 都有锁 token/CAS。`dispatched/leased` visibility 到期可恢复重投，进程在 enqueue 后、mark 前崩溃
  不会永久丢任务。
- Runtime 每次从数据库重新读取完整 attempt，typed dequeue 只租赁 `document.compile`；同批任务并发处理，
  每个 execution 的 heartbeat 与 checkpoint mutation 串行。所有 complete/retry/fail 先提交数据库，再 ack
  queue；未知异常默认不可重试，只有显式 retryable error 才进入有界指数退避。
- Legacy worker 增加 caller-managed failure 模式；durable caller 处理 transient/terminal 状态，避免 retry 后又被
  worker 写成 terminal failed。手动 retry 路由只对 durable state machine 开放，legacy 明确返回冲突。
- Queue adapter 增加 job type filter，并在增加 delivery attempt 前过滤不匹配类型；inline、Cloudflare 与
  pg-boss 适配器保持相同语义。
- `0006` 为调度、lease recovery、tenant cleanup、document/candidate 外键检查分别建立前导索引；outbox 的
  delivery due 与 dispatcher lock recovery 使用两个索引，不让 OR 分支共享一个低选择性复合索引。
- Attempt CHECK 约束把 `retry_at` 与 `retry_wait` 绑定；其他 run state 必须为 NULL，数据库层拒绝“看似
  terminal、实际仍有重试时间”的矛盾行。
- `tenant_id` 统一限制为 255 字符。迁移 runner 在类型收窄前检查历史数据，DDL 再增加长度 CHECK，禁止
  PostgreSQL/TiDB 静默截断；TiDB 同时要求 8.5+、CHECK、全局 foreign-key feature 和 session foreign-key
  checks 开启，并在迁移后通过 `SHOW CREATE TABLE` 拒绝 invalid/missing foreign key。
- API app 数据库 bundle 暴露 durable attempt repository，但不把未消费的 raw repository 塞进 gateway
  options。`KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME` 默认关闭；当前版本若显式开启，会在创建 adapter 前
  明确报告缺少 3B2C coordinator，不再静默忽略配置。

本批验证：

- Repository、dispatcher、runtime 与 durable job 控制面 32 项聚焦测试通过。
- Core tenant boundary、Database schema/migration、Adapters queue/migration、API app wiring 的聚焦测试与
  package typecheck 通过。
- Workspace typecheck：20/20 tasks 通过。
- Workspace test：20/20 tasks 通过；其中 `@knowledge/api` 181 个文件、1191 项测试通过，
  `@knowledge/api-app` 24 个文件、100 项测试通过。
- PostgreSQL/TiDB migration registry drift、38 个本批目标文件的 Biome 与 `git diff --check` 通过。

进入 3B2C 前仍保持的边界：

- Runtime processor 必须协作响应 `AbortSignal`；当前 JavaScript runtime 无法强杀忽略 signal 后继续产生的
  外部副作用。3B2C 的 provider/builder wrapper 必须在每个持久化边界再次检查 fence。
- 当前 pg-boss adapter 仍以内存 lease/status map 为执行权威，只把 send 镜像到 broker；因此本批只支持
  API 与 compilation runtime 同进程部署，不能宣称已支持独立 worker 崩溃恢复。
- Dispatcher/runtime 现有 `stop()` 只停止新 tick。3B2C 正式启用时要增加 async drain，并把 server shutdown
  顺序固定为停止接流量、停止 dispatcher、等待 runtime execution、关闭 platform adapter。
- 正式 generation writer、candidate member replace、candidate-only smoke evaluation 与 published read cutover
  仍分别属于 3B2C、3C 和 3B3；本批没有提前解除既有 fail-closed。

### 13.7 迭代 0 批次 3B2C 执行记录（2026-07-13）

本批完成的是 **generation-scoped document candidate 的 shadow 构造闭环**，不是正式 publication
闭环。它让一次 durable attempt 可以隔离地产生派生数据、校验本次 document replacement 并构造候选成员
快照；生产 runtime、正式查询和 head publish 继续关闭，避免把“candidate 已组成”误当成“可以被检索”。

已完成：

- `KnowledgeNode` 增加 nullable、non-zero `publicationGenerationId`，schema、内存/数据库 repository 与
  PostgreSQL/TiDB `0007` migration 保持一致。未显式传 generation 的 read/update 只作用 legacy `NULL`；
  generation read/write 严格等值并要求 Knowledge Space 以及对应 document/artifact scope；tenant ownership
  由 candidate validator 通过 Space 与 Document Asset 复核，不会让 candidate node 落入旧 Fast/Deep 读取集合。
  物理 node ID 把 generation 纳入 deterministic seed，同一 generation retry 幂等、不同 generation 不碰撞；
  物理删除仍可清理同一 artifact 的全部 generation。
- Incremental reindexer、entity/relation extraction、quality control、graph writer 与 semantic postprocessor 已透传
  同一 generation。candidate 节点 metadata、projection 与 graph 写入只引用本代 node；generation 模式跳过
  跨文档 semantic community，不能把不完整的单文档 community 登记成可发布结果。
- 定义 `schemaVersion: 1` 的固定六类 component receipt：IndexProjection、DocumentOutline、multimodal
  manifest、KnowledgePath、Graph Entity、Graph Relation。六个数组字段全部必填，即使某类合法为空也必须
  显式返回空数组，防止 builder 漏报被解释为“本类没有结果”；同时要求恰好一个 outline、恰好一个 manifest、
  至少一个 knowledge path，并限制总 component 数量。
- Candidate coordinator 校验 attempt execution fence、generation、owner document/version、base head revision、
  fingerprint material 和 attempt 独占 candidate identity；在 candidate 建立后先把 candidate ID/fingerprint
  持久绑定到同一 attempt，再进行 member compose。retry 只能复用完全相同的 candidate，head 已变化或
  candidate 被另一 attempt 占用时 fail closed。
- Member repository 增加单事务 `composeDocumentCandidate`：锁定稳定 space/head/candidate，清空 candidate
  的旧成员，从当前 published head 继承除 owner document 外的成员，再写入本次 owner 的完整六类
  replacement。大集合使用 transaction-local chunking，不通过多次 replace 截断或覆盖前一批；返回的
  replacement 数必须与 receipt 精确一致。事务使用与 attempt start/publish 一致的
  space→attempt→head→candidate 锁顺序；成员变更前后都校验 attempt scope、candidate binding、exact row
  version、running/active lease token 与数据库实时时钟下的 expiry，旧 worker 或处理中途失租会回滚整个
  snapshot，不会晚到覆盖新 worker。compose 通过 runtime 的 lease-snapshot 串行通道执行，自动 heartbeat
  无法在捕获 row version 与事务取锁之间插队造成误判。
- 新增数据库 preflight validator，在 compose 前重新读取 attempt、space、document asset、六类 component 与
  引用到的 KnowledgeNode，验证 tenant/space、generation、document owner/version、projection `building`
  状态、projection→node、graph relation→entity、graph→source-node、outline/manifest path 的本次 replacement
  闭包；同时验证唯一 ParseArtifact、source snapshot/artifact hash、Asset→Node→Graph 权限并集。embedding
  会读取数据库中实际 `dense_vector`/`visual_vector` 维度，并与知识空间持久化的 plugin/model/vector-space、
  profile revision 和 dimension 一致性校验；不信任 projection 自报维度，也不假定固定 1536。
- Durable attempt 在 `projection_built` 及之后 checkpoint 强制要求 candidate ID/fingerprint 已绑定；数据库
  `CHECK` 与内存/数据库 repository 同步 fail closed，避免“已构造投影但没有可追溯候选”的非法恢复状态。
- Durable worker 的 generation shadow 路径将同一 generation 传给 outline、manifest、knowledge path、
  reindex/projection 和 semantic graph，收集六类持久化 canonical ID 后提交完整 receipt。candidate 组成成功后
  只推进到 `projection_built` 并返回；不会执行 legacy smoke、projection publish、asset ready/published 或
  staged publication 收尾。未配置 coordinator 时 generation 路径继续 fail closed，legacy 编译路径保持兼容。

验证：workspace typecheck 20/20、workspace test 20/20 通过（1,735 passed、1 skipped，其中 API
1,222/1,222）；本批 40 个 TypeScript 文件 Biome、`git diff --check` 与 PostgreSQL/TiDB migration registry
drift 校验通过。

本批明确保留的 shadow / fail-closed 边界：

- `KNOWLEDGE_DOCUMENT_COMPILATION_RUNTIME` 仍默认关闭，API app 还没有把 3B2C coordinator/validator 接入
  production processor。`outbox dispatch -> runtime claim -> worker -> advance/complete` 的生产闭环尚未接通；
  显式开启不能退回 legacy writer，也不能把 shadow candidate 自动发布。同步 compilation pipeline 的
  generation 模式同样继续 fail closed。
- `projection_built` 只表示本次 replacement 已写入 candidate member snapshot，不表示 candidate 通过评估，
  更不表示 publication head、document asset 或 parser status 已提交。当前代码没有从该 checkpoint 自动进入
  `smoke_eval_passed`/`published`。
- Fast、Research、Deep 尚未从 publication head/member 解析正式读取范围，仍只读 legacy published 数据。
  新 generation 即使成功构造 candidate，也不会被三条线上检索路径命中；member 缺失时禁止临时回退全表。
- Preflight validator 与 member compose 是两个事务。当前校验只证明 compose 前的本 document replacement，
  不能关闭两事务之间的 TOCTOU 窗口，也没有验证继承自当前 head 的完整 candidate snapshot。因此该 validator
  是提前失败与诊断门禁，不是最终 publication 安全边界。
- Graph 是跨文档聚合索引。单文档 replacement 只能证明 owner 子图内部引用闭合；从历史 head 继承的其他
  文档 graph 可能跨多个 generation，不能用一个 generation 等值条件把它们解释成完整 Deep 图。完成
  member-ID scoped traversal 或全空间 candidate graph/community 重建前，Deep publication 必须保持阻断。

进入 3B3 的阻断与完成条件：

- 对每个存量 published head 建立可审计的 legacy `NULL` membership bootstrap，核对六类实体数量、owner 与
  orphan，禁止空/部分 membership 静默切换后让知识空间检索为空。
- Fast 必须按 published head 的 IndexProjection member IDs 查询；Research 必须按 DocumentOutline 与
  KnowledgePath member IDs 查询；Deep 必须按 Graph Entity/Relation member IDs 遍历，或改为全空间 candidate
  graph。三条路径都要分页/分批处理成员，不能受默认 100/1000 上限截断。
- 正式 read cutover 必须以 head fingerprint 为唯一入口。head、fingerprint、member 或目标实体不一致时
  fail closed 并产生可观测错误；迁移 fallback 只能由显式、可移除的窗口控制，不能永久放宽至全表扫描。
- 跨 generation graph、semantic community 与 graph relation 跨文档端点的读取语义确定并验证前，3B3 只能
  先切 Fast/Research，不能宣称 Deep 已完成 published read cutover。

进入 3C 的阻断与完成条件：

- 在 publication head CAS 的同一个锁定事务内，重新读取并验证 **继承成员 + 本次 replacement 的完整候选
  快照**，关闭 validator/compose 的事务 gap；任何 member 缺失、owner 漂移、generation 不一致或 head revision
  改变都必须废弃 candidate，并以新 base head rebase，不能在旧 candidate 上补丁式续跑。
- 当前 preflight 已验证 observed-time 的 Asset→Node→Graph 权限、唯一 ParseArtifact、source/artifact hash、
  projection lineage，以及数据库实际 vector dimension 与空间当前持久化 embedding profile。3C 仍必须在
  attempt 创建时冻结 parser/profile revision 与 visibility/config snapshot，并在发布锁内重验，防止处理中途
  配置切换造成 TOCTOU；当前六类 receipt 未包含 segments，还需把 segment closure 纳入 publication member，
  或以同事务、版本锁定的 artifact closure 证明其 completeness、enable 与 permission 状态。
- 最终锁内校验必须按 receipt/member 的精确集合验证数量与实体，不能只证明“receipt 中列出的 ID 都存在”；
  embedding route 必须继续以用户在该知识空间选择的 plugin-daemon 模型/vector-space 为准，禁止引入固定 1536。
- Candidate-only Fast/Research/Deep preview 与 smoke/evaluation 必须只读取候选 member snapshot；通过后执行
  `candidate -> validating -> published` 的 head CAS，失败保持旧 head 可查并标记 candidate failed。
- 只有 head CAS 成功后才能提交 staged projection、document asset/parser 状态并把 attempt `complete`；CAS 后
  状态写失败由 reconciliation 收敛，catch 路径不得把已发布 head 回滚成旧 generation。随后才能接通
  outbox/runtime 的 `advance/complete/ack`、async drain 与 production feature flag。

### 13.8 R1、3B3/3C 发布读取切换执行记录（2026-07-14）

本批关闭了 13.7 中关于 publication read、独立 PageIndex、Graph member scope 和正式 head CAS 的
shadow/fail-closed 边界；历史记录保留用于说明迁移过程，当前权威状态以本节和可追踪矩阵为准。

已完成：

- Production query 在入口只解析一次 immutable publication snapshot；Fast、Research、Deep 全链共享同一
  publication id/fingerprint/head revision。缺 snapshot、tenant、权限范围、member 或实体闭包均 fail closed，
  不会回退 legacy 全表读取。
- Fast 从 exact ready IndexProjection member 执行 dense + FTS，RRF 合并后只 rerank 一次。TiDB 使用
  `index_projection_fts_postings` 的 term-hash lookup index；PostgreSQL 保留 GIN `tsvector`。两种 dialect
  均在 publication/member/generation/document/ACL 条件内召回。
- Research 直接查询 flattened published PageIndex，不再先运行 dense/FTS hybrid。exact term posting 在 SQL
  内按 outline node 聚合 normalized `[0,1]` score，完整 closure 与 ACL 在 relevance ordering/final LIMIT
  之前验证；threshold、Top K 后 bounded 打开 leaf evidence。Graph 与普通 reranker调用数为 0。
- Deep 先运行 published dense+FTS/RRF，再从同一 publication 的 Graph entity/relation/source-node closure
  扩展和二次召回，合并后统一 rerank 一次。Graph capability 缺失只阻断 Deep，Fast/Research 不受影响。
- Candidate runtime、candidate-only evaluation、publication processor 与 coordinator 已接入 durable
  compilation runtime。锁内重新验证完整 candidate/member snapshot、lease token、attempt row version 和 base
  head revision后再 CAS；partial receipt、evaluation failure、lease loss 或 head drift 均保留旧 head。
- Legacy space bootstrap 与 PageIndex upgrade backfill 使用 durable ledger、lease/fence、retry/supersede；
  completion 会在同一锁内反向验证整个 legacy corpus，且 lease 过期后任何 complete/fail/release 都不能越过 fence。
  readiness 只有在 frozen corpus/ready PageIndex 完整验证后开放，Research-specific readiness 不阻断 Fast。
- Publication CAS 前除 receipt 正向校验外，还会反向锁定并验证每个 member generation 的 node 所需 FTS、
  active vector-space dense projection 与（TiDB）term posting；孤儿 node、缺 leg 或错误 vector-space 都不能发布。
- TiDB 的 legacy lexical 数据不再在 migration 内全库递归回填：`0011` 只扩表，durable worker 按空间、projection
  cursor、lease token 与 row version 原子修复；Fast/Deep 在 HTTP/SSE 前以稳定 503 fail closed，Research 绕过。
  `0012` 前向修复已记录历史 TiDB schema 的 TEXT key、generated column、匿名旧唯一索引和 CHECK/FK 漂移，
  对冲突/孤儿/过长数据拒绝迁移，不删除或静默合并现有数据。
- 所有 generation-scoped component writer 采用 immutable replay 语义；已发布 generation 不允许被 retry
  overwrite/delete。为保持已发布 migration 历史不可变，PostgreSQL `0001` 仍保留历史 `vector(1536)`；紧随其后的
  `0002` 会在任何正式读写前删除旧 HNSW 并转换为 typmod-free `vector`。最终 PostgreSQL/TiDB schema 的维度均
  来自空间所选 plugin-daemon 模型实际响应，不存在固定 1536 运行时约束。

验证：API 1414、API app 129、Database 35、Adapters 112、Core 49、Embeddings 26 项测试通过；PostgreSQL 16 +
pgvector 与 TiDB 8.5 空库 `0001 → 0012` 均成功（TiDB 38 张表），migration replay 通过。真实 SQL 探针覆盖
candidate/building/stale/cross-publication/ACL 负向、PageIndex/Graph closure、TiDB old-TEXT→0011→0012、
durable FTS cursor/closure、publication member rollback/replay、lookup index、CHECK 与跨空间 FK。

转入后续迭代、不得误报为本批完成：

- 迭代 1：Space ACL/member/API Access、服务端权限快照、异步 Research consumer、SecretStore。
- 迭代 2：durable deletion、generation tombstone、对象/cache/trace/evidence 清理。
- 迭代 3：profile backfill/catalog/preflight、publication 与 embedding profile 联合快照、动态维度 ANN、
  embedding candidate rebuild/evaluation/原子迁移与回滚。

### 13.9 I1/I2 权限与安全删除执行记录（2026-07-14）

I1 与 I2 已完成，历史章节中“待开始/转入后续”的文字仅保留实施轨迹；当前权威状态以本节和可追踪矩阵为准。

I2 已完成：

- `0017_durable_deletion` 为 Space、Source、Document 增加 lifecycle state、永久 tombstone、durable
  job/item/outbox/retry-audit、retrieval execution lease 与 mutation lease fence。请求使用权限快照、expected
  revision、idempotency fingerprint；Space 额外要求 interactive owner 与完整名称 challenge。
- Worker 按 `requested → quiescing → deleting_objects → deleting_derived_data → deleting_primary_data → completed`
  推进，每一步都有 row-version、lease-token、数据库时钟与 checkpoint fence。外部对象/Secret/cache item 独立
  retry/dead-letter；primary residue dirty 会退回可重试阶段，不会把未清干净的资源标记 completed。
- Quiescing 会取消或排空 retrieval、Research、compilation、sync/backfill、KnowledgeFS session/lease 和 staged
  commit；publication exclusion 使用 immutable successor + head CAS，旧 worker 在 tombstone 后不能重发 member、
  Graph、PageIndex 或 projection。
- Space 删除分页枚举整个空间对象前缀；Document 删除枚举 raw、multimodal 与 generation 对象；Source
  `cascade` 枚举全部 owned documents，`keep` 则清除 retained document/asset/source metadata，并发布不含 Source
  identity 的 successor head。trace、evidence、failed query、research partial、cache、path、Graph、Outline、FTS、
  artifact、manifest、ACL 与 primary child rows 均按 FK-on/FK-off 次序显式清理。
- 所有普通对象写入在完整 `putObject` 期间与 deletion request 串行：PostgreSQL 先按 space identity 取得
  `FOR SHARE`，TiDB 8.5 因 shared-lock 语法只是 noop 而使用真实 `FOR UPDATE`。两种 dialect 都在拿到当前行锁后
  才检查 lifecycle 与 active deletion；禁止把 predicate 放进 TiDB locking read 让旧 snapshot 绕过等待。
  Source SecretStore 保留既有 lifecycle `FOR UPDATE` admission，避免嵌套锁自锁。
- 网关只要配置 durable deletion service/repository，就强制要求 lifecycle fence 与 object-write admission；缺一项
  启动即失败。Document single/bulk、Source materializer、同步/异步 PDF/多模态和 KnowledgeFS write/append
  均已接入；竞态拒绝返回稳定 409，并执行 late-write compensation/stale-write scrub。
- Migration 将 `knowledge_space_manifests` 的旧单列 FK 收紧为 tenant + space 复合 FK；发现历史跨租户错配会
  fail closed，不做猜测修复。EvidenceBundle 只回填可唯一证明的 tenant/space，歧义行保持隔离并阻止开放删除。

真实数据库验收：

- PostgreSQL 16 + pgvector 与 TiDB 8.5 均从空库顺序执行 `0001 → 0017`，整份 `0017` 原样 replay 成功；
  manifest 最终只保留复合 FK。人为构造跨租户 manifest 时两种数据库都按预期阻断迁移。
- PostgreSQL 锁序覆盖 writer 先、delete commit 先、delete rollback 先；TiDB pessimistic transaction 覆盖同三种
  顺序，并额外验证 Source/Document 删除只存在 active job、space row 仍 active 时写入仍等待后拒绝。callback 在
  删除胜出时调用数为零。

代码验证：API `1892 passed / 3 skipped`，API app `153 passed`；Database `43 passed`，Adapters
`116 passed / 1 skipped`，Core `49 passed`；migration artifact、Biome、typecheck 与 `git diff --check` 通过。

当时转入 I3 的项目为：模型 catalog/preflight、profile backfill/history、profile/publication 联合快照、embedding 与
reasoning candidate rebuild、动态 ANN capability 和 Retrieval Test/provenance API；这些项目现已在 13.10 闭环。

### 13.10 I3～I6 后端产品能力闭环执行记录（2026-07-14）

本批完成 Figma 产品功能到后端契约的最终对齐。实现范围仍是纯后端；没有新增页面、组件、样式、前端 client 或
BFF。可追踪矩阵中的稳定 ID 是逐项验收入口。

I3 已完成：

- Knowledge Space 创建支持后端生成 tenant-scoped slug；名称、描述与 icon 更新使用 expected revision、active
  deletion lock、fresh durable admin permission 和数据库 CAS。
- 生产创建不调用或等待 plugin-daemon；单个数据库事务写 Space、Manifest/带 digest 与 revision 的 pending model
  configuration、Owner、`only_me` policy、API Access off 与 activity，初始不创建 profile/head。idempotency key 派生
  确定性 ID；v3 lost-ACK replay 精确重验 pending selection/digest/revision 和权限语义，并保留对 legacy v2 完整
  aggregate 的严格重放兼容。
- 每个 Space 在创建/未激活设置阶段独立保存 plugin/provider/model selections，不伪造 dimension 或 vectorSpaceId。
  首个文档的 leased durable compilation attempt 才通过 plugin-daemon catalog、credential validation 和真实 invocation
  preflight，再持久化 immutable embedding/retrieval profile、能力快照、实际 dimension/metric、vectorSpaceId 与 revision；
  任何 embedding dimension 都来自模型响应，运行时不写死 1536。
- 生产装配不再提供 deployment embedding/reasoning/rerank fallback；三类 per-space provider factory 都不携带
  deployment model credential，而由 plugin-daemon 按请求 tenant 解析。static embedding/rerank 仅可用于非生产测试。
- `resolveVectorIndexCapability` 仅在 dimension 超出数据库存储能力时拒绝；只是不满足 ANN 索引限制时使用有界
  exact-search fallback，不篡改向量或 profile dimension。
- 尚无 active profile/head 的未发布空空间在设置修改时，以 space/deletion lock、fresh permission 与 manifest CAS 更新
  pending config 并返回 202，不调 daemon。首文档 activation 使用 pending digest/revision 及 profile-head CAS 防止过时
  preflight 结果，最终用 fenced `bindInitialProfiles` 冻结 exact tuple 后才继续 parser/index。已有 published head 的 Space
  仍使用 durable migration run/outbox/lease：embedding 变化执行 full-vector-space rebuild，reasoning 变化执行 full PageIndex
  Summary/Outline rebuild，其余 retrieval setting 可 clone successor publication；evaluation 通过后联合 CAS profile binding 与
  publication head，失败保留旧 tuple。
- Legacy 只迁移 manifest 中可证明的历史 model/profile selection；profile-less 旧 Space 记录审计并 fail closed，
  要求用户显式选择，不猜测部署默认模型。
- Dedicated Retrieval Test 返回实际 published head/profile、plan、stage/metrics、evidence 与安全 capability 状态；
  不生成答案，不返回 secret、完整 member inventory、不可见 corpus 总量或 SQL 隐藏 ACL 候选计数。

I4 已完成：

- `0021_source_product_workflows` 落地 provider catalog、Source Connection、OAuth PKCE/state、SecretStore ref、refresh/
  revoke/cleanup lifecycle、crawl preview pages、online document/drive imports、sync policy、workflow run/outbox/lease、
  history/cancel/retry 和 bounded bulk sync/disable/remove。
- Provider availability 是部署静态 registry 声明，不冒充实时 plugin health；crawl preview 通过 polling API 返回进度，
  pages 列表不回传完整正文；Online docs cursor 与 Drive continuation token 都作为 opaque value 原样透传。
- Source remote item 通过 sourceId + providerItemId + contentHash/etag 进入 Logical Document revision；unchanged 不重复
  发布，更新 candidate 只有在 compilation publication 成功后联合激活，失败保留旧 active；远端缺失支持 retain 或
  durable tombstone policy。
- 已绑定 compilation attempt 的 Source candidate 失败后，以 durable deletion tombstone/outbox 清理 run-owned residue；
  只有 `failed + never-active + exact run/item/hash ownership + 唯一 asset 引用` 才允许进入清理。active、superseded、
  activated、回滚/其他版本引用全部保留，并覆盖重启、幂等、lost-ACK 与并发 activation。

I5 已完成：

- `0022_logical_document_revisions` 落地 Logical Document、immutable revisions、activeRevision CAS、history/rollback、
  versioned settings/reindex、revision chunks、chunk candidate state、processing task list/get/SSE/cancel/retry 与
  user/system metadata 隔离。
- 单文件默认 15 MB；bulk 默认 50 MB/20 文件，hard ceiling 50 MB/文件与 25 文件；extension/MIME/quota 在对象写前
  校验。批量响应逐文件给出 accepted/excluded/reason，某个文件失败不回滚同批合法文件。
- Rollback、Settings、Chunk、新 Document 与 Source revision 的 candidate admission 都绑定 exact compilation attempt、
  active space/deletion state、asset/source/logical revision、fresh durable permission 与 current candidate scope；撤权、
  partial-member 移除、API key 失效或删除竞态不会留下 candidate residue。
- 最终 publication 事务固定 `space → attempt → permission snapshot/member/policy/API Access/API key → head/candidate/profile`
  锁序，严格解析 attempt provenance；missing/partial provenance fail closed。该 fence 位于 publication/profile/logical
  revision/settings/chunk 的任何副作用之前，并在同一事务联合切换 publication head、profile binding 与产品 candidate。

I6 已完成：

- `0023_knowledge_space_overview` 提供 icon、stats、attention、activity 与 health；`0024_quality_control` 提供 Evidence
  history、missing-evidence state、Golden、bad cases、failed-query triage/clusters、durable replay 和 trends/baseline。
- Query 使用服务端 UUID queryRunId 作为 AnswerTrace/lease/session/activity identity，与客户端 `x-trace-id` correlation
  分离；生成器必须 exactly-one `done`。最终 `query.generate` summary 决定 durable 成败，中间可恢复 stage error 不会
  把 fallback 成功误记为失败；AnswerTrace read model 可在 terminal activity 投影失败后恢复 completed/failed。
- Quality/Overview 的列表与聚合在 SQL LIMIT/GROUP BY 前绑定 tenant、space、exact requester 与 candidate grants；
  mutation/replay 在事务内重验 active deletion 与 fresh durable permission。Replay 冻结 exact published profile/model/
  vector-space tuple，按 Fast、Research、Deep 真正执行并保存 evidence diff 与 metrics。

检索模式最终不变量：

1. Fast：published dense + indexed FTS → node 去重/RRF → 一次最终 rerank → threshold → Top K。
2. Research：published Summary/Outline/PageIndex exact-term + tree navigation → threshold → Top K；普通 hybrid、Graph 和
   普通 reranker 调用均为 0。Reasoning model 用于最终回答和 ingestion-time Summary/Outline enhancer，不是 query-time
   PageIndex planner。
3. Deep：published dense + indexed FTS/RRF → published Graph expansion + second recall → 全部候选合并 → 一次统一
   rerank → threshold → Top K；不是只查 Graph。
4. 三种模式都从同一个 frozen published content/profile tuple 读取，并在入口校验 membership/API Access、在候选层
   使用服务端 grants；Top K、Score Threshold 与模型配置分别在上述正确阶段应用。Async Research 在入队前按
   “显式请求 > 空间 default”冻结 concrete mode/Top K，production worker 不允许 legacy profile fallback。

迁移与验证基线：

- Migration registry/artifact 已扩展到 `0024`。PostgreSQL 16 + pgvector 与 TiDB 8.5 均从空库执行 `0001 → 0024`，
  `0018 → 0024` 全段 replay、`0024` 双 replay、动态 dimension 7/4096、长 Unicode provider/idempotency、tuple/
  cross-space/outbox negative probe 均通过。
- 最终代码验证全部通过：API 为 302 个通过、1 个跳过的测试文件（2513 个通过、3 个跳过的测试）；API app
  为 35 个测试文件、173 个测试；Database 为 9 个测试文件、80 个测试；Core 为 4 个测试文件、49 个测试；
  plugin-daemon-client 为 2 个测试文件、48 个测试；Adapters 为 6 个通过、1 个跳过的测试文件（116 个通过、
  1 个跳过的测试）。Workspace `test` 为 20/20 个 Turbo 任务成功，workspace `typecheck` 为 20/20 个任务成功。
- Migration artifact check、Swagger 5/5、全部本批 TypeScript/JSON 的 Biome 检查与 `git diff --check` 均通过；范围
  审计确认本批只有后端、迁移和文档变更，没有前端实现，敏感信息审计没有发现生产凭据。用户本地
  `.claude/settings.local.json` 与 coverage 产物不纳入提交。

### 13.11 I7 空空间惰性模型验证执行记录（2026-07-15）

本批调整的是模型校验时机，不改变发布后 immutable profile/publication 与三种检索模式的运行时契约。
本节将 13.10 的模型能力闭环进一步细化为“先持久化 pending selection，再由首文档 durable compilation 验证并激活”。

已完成：

- Knowledge Space create 将 embedding selection 与 retrieval input 保存为带 digest/revision/state 的
  `pendingModelConfiguration`；Provisioning 在一个事务中写入 Space/Manifest/Owner/policy/API Access/activity，
  初始 profile heads 为空，全路径 plugin-daemon 调用为 0。v3 idempotency marker 严格重放 pending aggregate，旧 v2
  marker 仍可按原完整 profile aggregate 严格重放。
- 尚无 active profile/head 的未发布空间，Embedding/Retrieval settings PUT 仅做 fresh admin permission + manifest
  revision CAS，更新 pending digest/revision 并返回 202；修改 `validation-failed` 候选会生成新 pending revision，不在
  HTTP 请求内调用 plugin-daemon。
- 首个文档仍通过 durable compilation attempt/outbox/lease 入队与执行。attempt 可在 profile 尚未激活时先持久化；
  candidate runtime 在 parser/index worker 之前执行 initial-profile coordinator，用 tenant-scoped plugin-daemon 并行验证所选
  embedding/reasoning/已启用 rerank 能力。embedding dimension/metric 只从实际 capability response 取值，然后
  派生 immutable embedding profile 与 vectorSpaceId；不存在 1536 默认值。
- 激活路径在数据库锁内重验 pending digest/revision/selection 和 profile head revision。embedding 只允许对应 pending
  config 的首个 revision 穿过初始 freeze；embedding/retrieval immutable revisions、两个 heads、manifest profile tuple 与
  pending clear 在同一事务完成。进程内同一
  digest 使用 single-flight；跨进程即使发生重复 daemon probe，也只能通过 manifest/profile CAS 收敛到同一
  immutable snapshot，过时结果不能激活。
- 激活成功后，fenced `bindInitialProfiles` 在处理开始前将 exact embedding/retrieval id、revision 与 snapshot digest 恰好
  一次绑定到 leased attempt；故障注入验证 profile tuple 只能整体提交或整体回滚，历史版本遗留的 partial head 也只会
  被原子补齐，不会被 query/compilation 当成可用 tuple。
- 非可重试 preflight 失败只将 allow-listed code/failedAt/retryable 写回 pending config；`GET /knowledge-spaces/{id}/status`
  稳定返回 `setup-required | pending-validation | validation-failed | ready`，不回显候选 model identity、provider 原始异常或
  凭据。active profile 总是优先于失败候选，因此发布后更新失败时旧 tuple 仍可用。
- 已发布 Space 不走首文档快速激活；Embedding 变更仍执行 full-vector-space rebuild/evaluation，Reasoning 变更仍
  重建 PageIndex Summary/Outline，其余 retrieval settings 通过 successor publication/migration 联合切换，失败保留旧
  profile/publication tuple。
- 模式边界保持不变：Fast = dense + indexed FTS 混合召回→合并→一次 rerank；Research = Summary/Outline/PageIndex，
  不依赖 Graph 且不调用普通 reranker；Deep = 普通混合召回 + Graph 扩展→合并→一次统一 rerank。

定向验收以 `knowledge-space-provisioning-repository.test.ts`、`gateway-knowledge-space.test.ts`、
`document-compilation-initial-profile-coordinator.test.ts`、`document-compilation-attempt-repository.test.ts`、
`knowledge-space-unpublished-profile-activation-repository.test.ts` 与 `knowledge-space-control-plane-diagnostics.test.ts` 为主；最终全量测试数
以实际提交的 CI/交付记录为准。
