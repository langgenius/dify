# Knowledge 改造实施记录

初始实施日期：2026-10-20；14 项 follow-up 开始于 2026-10-21。依据：[KNOWLEDGE_REFACTOR_PLAN.md](KNOWLEDGE_REFACTOR_PLAN.md)。发布操作见 [运行手册](KNOWLEDGE_REFACTOR_RUNBOOK.md)。

## P0 基线

- HEAD：`1fefc527239027adaafcb6286a05b21945ce55c5`；实施前已有 433 条 staged/unstaged/untracked 状态记录。
- 原始 status、staged/unstaged binary patch、4,669 个文件 SHA-256 与 import-linter 原配置保存在 `/tmp/dify-knowledge-refactor-20261020/`。该目录是本次会话证据，不是可移植发布归档。
- 后续 19 项审查修复开始前另存独立基线 `/tmp/dify-knowledge-reviewfix-20261020/`，包含 status、staged/unstaged patch 和源码 SHA-256。当前 review-fix 快照不得与下述已完成的 `*-04` 历史验证日志混作同一次全量验证。
- 2026-10-21 的 14 项 follow-up 使用独立基线 `/tmp/dify-knowledge-followup-20261021/`；远端工作区为 `/home/byron/dify-codex-workspaces/knowledge-followup-20261021-01`。follow-up `snapshot-01` 和 `snapshot-02` 保留为中间失败证据；最终 `snapshot-03` 为 25,637 passed、4 skipped，完整静态检查通过。2026-10-20 review-fix 的 25,540 passed、4 skipped 继续作为独立历史快照。
- 实施命令未主动 reset、暂存或提交。原实施快照结束时检测到 index 相对初始快照有 3 个文件变化：`controllers/console/auth/activate.py`、`controllers/console/datasets/data_source.py` 新增暂存，`controllers/console/datasets/datasets_segments.py` 暂存内容更新；这三份源码当时均与远端已验证快照一致，index 保持原样。其余原始 staged patch section 未变。review-fix 继续遵守不暂存、不提交；新增 revision 接在原迁移链后，已有冻结 revision 未改写。
- 依赖约束基线为 69 contracts、75 backend layer ignores、29 knowledge repository ignores。当前保持原有配置；没有扩大豁免，没有新增 `api/core/` 模块。

## 2026-10-21 Stack 拆分

替代 #44162 的原生 GitHub stack 固定以 upstream `main@9c99530ffcc5eed64cb1dde06206e6c7460a9ab1` 为基线，按下表六层顺序发布。拆分在独立 checkout 完成；原 workspace 的 source 和 index 未被构造步骤改写。会话证据 `/tmp/dify-stack-pre-source.json` 记录 14,081 个 source 条目，`/tmp/dify-stack-pre-status.z`、`/tmp/dify-stack-pre-staged.patch` 和 `/tmp/dify-stack-pre-unstaged.patch` 保留拆分前的 index/worktree 状态。

| 层 | 边界 | 当前发布证据 |
| --- | --- | --- |
| 1 | Knowledge retrieval application boundaries | [PR #44483](https://github.com/langgenius/dify/pull/44483) CI 已通过 |
| 2 | Durability schema、pure outbox kernel 与 tag uniqueness | [PR #44485](https://github.com/langgenius/dify/pull/44485) CI 已通过；文件引用只建空 schema，不激活 owner 回填 |
| 3 | Typed knowledge policies and query boundaries | [PR #44488](https://github.com/langgenius/dify/pull/44488) CI 已通过 |
| 4 | Recoverable workspace lifecycle | [PR #44489](https://github.com/langgenius/dify/pull/44489) CI 已通过（patch 91.61%，目标 88.93%，project 88.94%） |
| 5 | File lifecycle 与 Document/Segment/Summary/Pipeline runtime；激活 owner 回填 | [PR #44490](https://github.com/langgenius/dify/pull/44490) 的最终 exact-prefix 后端 full unit/static 正在远端并行验证，CI 仍在进行；前一生产源码前缀验证为 27,385 passed、4 skipped，完整 types/import、168 startup、603 response、1,624 integration collect 与 6 guards 均通过；activation revision `d3f7a9c1e584` 已与完整 writer/deleter 闭包组成 Layer 5 |
| 6 | Web document recovery UI 与发布文档 | [PR #44494](https://github.com/langgenius/dify/pull/44494) 基于 Layer 5 exact parent 构造；7 files、112 tests、完整 Web type、workspace/scoped static 通过，generated contracts 177 files、0 drift |

Layer 1/2 的分层基线保持 72 条 import-linter contracts、0 broken。后续每个前缀仍须重跑自己的全套验证；上文 follow-up `snapshot-03` 的 25,637 passed、4 skipped 是拆分前 dirty-tree 历史证据，不是任何新 stack 前缀的 green 结果。Layer 1–4 CI 已通过；Layer 5 的最终 exact-prefix full unit/static 与 CI 仍在进行。不得将当前状态表述为整个 stack 的 CI 已全部通过。

Layer 6 的 dependency-aware a11y 扫描解析了 469 个 JSX 文件，报告 79 个既有错误；涉及的 33 个源文件均未被 Layer 6 修改，因此不计作本层回归。API Markdown 与 TypeScript contracts 在 Layer 6 exact prefix 上重生成后，177 个受管文件的逐文件 SHA-256 全部不变。

当前 Layer 2 迁移 sole head 为 `c2e6fab0d795`，它合并 upstream workflow trace head `a8c3e7f4b912` 与本 feature head `b1d5e9fac684`；目标环境尚未执行这条迁移链。`f3b9c1e4a826`、`d7f1a5b8c240` 和 `f9b3c7dae462` 在 Layer 2 只创建空的文件引用/清理 schema，不执行 owner 回填；`e2a8b0d3f715` 的 tag normalization/uniqueness 仍在正常 online upgrade 中执行。文件 owner 回填由 Layer 5 activation revision `d3f7a9c1e584`（`down_revision = c2e6fab0d795`）执行，前提是新 writer、legacy writer fence 与全部 deleter/orphan fence 已经同层闭合。旧 cleaner 仍可先删 blob，Document/Segment 旧 writer 也没有该 fence；因此 Layer 2–4 不得手工回填或激活文件 owner 数据。PostgreSQL/MySQL/Redis 集成用例由 CI 执行，local collect 和 offline SQL 都不表示迁移已可部署。

## 工作包与行为变化

| 包 / finding | 本次实施内容 | 主要生产 owner |
| --- | --- | --- |
| P1A/P3，F02/F04 | Preview 以本次实际 UploadFile 创建事实记录清理集合；所有候选仍经全域 orphan fence；物理清理默认关闭，durable delivery 可延迟且不花执行预算，marker 可恢复 | estimate adapter、upload lifecycle repository/guards、cleanup tasks、feature config |
| P1B/P4B，F01/F13 | 提交结果显式区分成功、确定回滚、UNKNOWN；副作用前持久记录 workspace ID；provision/resolver 共同 operation mutex；按 Tenant 身份核对；setup 定向补偿、失败重试及迟到 provider tombstone | workspace model/repository/provisioning/effects、installation repository、recovery task |
| P2A，F03/F05 | 无版本 dataset/document 消息只转换到当前持久意图；忽略旧 action，按当前配置/代次去重或修复；保留真实历史任务名的转换消费者 | dataset/document repository、legacy task/support、Celery 注册 |
| P2B，F09/F10 | enable/disable/archive/un_archive 的相同期望失败重试统一；列表、详情、进度与重试共用 effective state，并投影 `indexing_state`、`error`、`indexing_retry_action`；retry 先按 action 预筛，再在锁内重验真实失败状态；sync 锁后复查归档/来源/存在性 | document commands/query repository/application |
| P2B/T03 | 高质量当前向量 add/update 未完成或失败时暂停检索；检索前后核对 current intent 与 target；同配置重建完成后也不接收跨重建的旧结果；Economy/历史 cleanup 不受此 gate 阻断 | task-state/retrieval repository、RetrievalService、HTTP mapper、Console 消费方 |
| P2C，F06/F07/F08 | completion 与必要 summary intent 同事务；Document 执行 claim 阻止失权旧 worker 提交；summary 按 segment 持久 checkpoint，生成和向量结果可续跑，provider I/O 不持 Dataset 长锁；batch waiting→terminal CAS；Pipeline 永久失败终止、稳定 identity 有限执行预算、dead-letter/下一批原子交接 | document/summary repository、index execution、batch tasks、acknowledged queue、Pipeline workers |
| P2B/T05 | 过期 executing 接管保留已进入外部 I/O 的事实；接管者负责 current repair，不能仅依赖旧 finally | outbox store/execution、current-state workers |
| P2D | 保留 token scope、actor credential、限流合同；修复 creator policy 初始化失败被吞：CORE/CONSOLE 创建均触发已有补偿路径 | strict creator RBAC sync、dataset operations/admission |
| P3，F12 | App 删除请求先在原事务持久 `app_cleanup_operations`；物理清理 gate 默认关闭时更新 durable 可执行时间后正常返回，不依赖 broker Reject 重投或有限 retry；gate 开启后 recovery 重新发布并以 lease 续跑。App/draft/icon、大值 offload、Agent config、Snippet、临时文件和 Conversation owner 均使用可恢复引用/marker 生命周期 | App repository/cleanup/recovery、Agent config refs、draft/Snippet/FileService/conversation owners、upload repository |
| P4A，F11 | 所有增加 membership 的 writer 在 Tenant mutex 内重算 committed count 并校验 delta；新邀请 Account+membership+current 同事务；批邀按邮箱真实返回，成功项邮件与提交一致；owner transfer 使用 durable pending/watch ledger 与 operation/execution lease 串行化请求、HTTP retry 和 beat recovery，完成后保留历史候选 watch 以修复多跳迟到 RPC | workspace/account/activation repositories、member/owner-transfer service、Console/OpenAPI/Inner |
| P5，F14/F15 | External/Document/Pipeline/Segment/query、cleanup/keyword/summary SQL 归各 repository；外部写 command 拥有短事务并返回 detached snapshot；Document 创建输入投影为 typed persistence command，锁后执行来源/retrieval/name policy；删除无消费者旧方法、旧 service wrapper、重导出与无来源 unmarked fallback | knowledge repositories 与实际 adapters/consumers |
| P6 | 更新 Pydantic/OpenAPI Markdown、TS/Zod/oRPC 与实际 Console 状态消费者；补 PG/MySQL/Redis CI 用例及发布手册；修复在线/离线 schema 的输入污染和最终规范化差异 | controller/fields、contract generators、Web、测试与运维文档 |

公开合同变化：Console/Service retrieval 新增 `503 knowledge_index_unavailable`，`details.reason` 为 `indexing|failed`。文档状态沿用 `indexing_state`、`error`，不保留并行的 `indexing_state_error` 字段。Console 列表/详情/轮询消费当前状态；pending 保持轮询，failed 展示实际错误。新内部执行 claim 不进入公开 DTO。

消息边界的实际依赖：Notion 的当前 producer 原本仍发送两参数旧消息；只把 consumer 改成 converter 会令新同步请求被当作已完成旧工作而跳过。因此本包同时将 `DocumentSyncApplicationService` 接到 Document repository command，锁后复查来源/归档并同事务保存新 generation 与 `DOCUMENT_INDEX_SYNC` intent；payload 的可信 `source` 将 website/Notion 路由到各自现有 worker。旧两参数任务名继续作为转换消费者，新的 Notion worker 与旧消费者都由 Celery 启动配置显式注册。Notion 内容未变化时按当前 generation 完成，不删除或重建已有索引材料，并在同一事务补齐必要 summary intent；迟到的旧两参数投递只转换一次当前、source-aware 的持久意图。Summary 的真实历史任务名也只转换当前状态；当前 producer 使用版本化 outbox 路径。没有生产消费者的旧 indexing proxy 已删除。

本 feature 在拆分前形成迁移单链 `f3b9c1e4a826 → a4c8d2e5f917 → b5d9e3f6a028 → c6e0f4a7b139 → d7f1a5b8c240 → e8a2b6c9d351 → f9b3c7dae462 → a0c4d8ebf573 → b1d5e9fac684`。其中 `a4c8d2e5f917` 保存 workspace provisioning operation，`b5d9e3f6a028` 增加内部 `Document.indexing_execution_id`，`c6e0f4a7b139` 增加 durable App cleanup operation，`e8a2b6c9d351` 增加可恢复 owner transfer operation，`a0c4d8ebf573` 增加逐收件人的 owner-transfer 通知投递状态，`b1d5e9fac684` 将 Pipeline execution log 绑定到 Document generation。拆分前 combined snapshot 中，`d7f1a5b8c240` 和 `f9b3c7dae462` 还包含 Agent config owner 回填；六层 stack 的 Layer 2 将 `f3b9c1e4a826`、`d7f1a5b8c240` 和 `f9b3c7dae462` 收窄为 schema-only，由 Layer 5 的 `d3f7a9c1e584`（直接下接 `c2e6fab0d795`）回填当时实际 owner。普通任务复用 outbox 的 intent/claim/deadline，在领域写事务结束前加锁核验；Pipeline 另核对同代 Document execution claim。目标环境尚未执行这些迁移；这里只记录源码 migration graph，不代表 upgrade 已运行。

## 代表性证据与验收矩阵

下列矩阵区分代码/快速测试与必须由 CI/部署验证的性质；没有将 collect-only 写为执行通过。测试位置随对应能力 owner 维护，不通过自动 reconcile fixture 改变生产时序。

| T | 对应证据与路径 | 必须保留的外部验收 |
| --- | --- | --- |
| T01 | token/key binding repository、revocation/admission tests；Dataset/Workspace 同一删除边界 | PG/MySQL binding 交错与提交后缓存 |
| T02 | segment repository transaction 与 async create/parent-child tests | 真实双 session 创建/写入交错 |
| T03/T04 | document status repository/application、dataset readiness/HTTP、website sync tests | 真实锁后 sync、原地重建中途失败与恢复 |
| T05/T06 | outbox takeover、current repair、document execution claim、atomic summary、batch CAS tests | 进程退出/claim takeover、同代旧完成、终态 CAS |
| T07/T09 | acknowledged queue unit 与新增真实 Redis Lua 集成用例；Pipeline worker permanent/transient/partial cases | 真实 Redis 原子脚本与 worker/receipt 交接 |
| T08 | legacy `.run()` 转换与 bootstrap 路由、真实旧参数迟到用例 | 混合版本旧队列与 in-flight 排空演练 |
| T10 | actual preview mapper-created upload tracking、foreign/shared refs、异常残留 tests | 存储失败及提取器边界 |
| T11/T12/T13 | file claim/writer guards/marker recovery、App draft/FK/gate、draft/Snippet/temp/Conversation owner tests | PG/MySQL 双 session；旧进程清零及停写后二次回填 |
| T14/T15 | typed commit/setup/recovery/tombstone unit；workspace lifecycle CI 6 场景 × PG/MySQL | 真 DB 无限配额 operation barrier、ACK loss、DB 不可用 |
| T16 | member/account/activation/controller unit；quota lifecycle CI 4 场景 × PG/MySQL | 最后一名额、deployment seat/workspace、owner transfer |
| T17 | 生产 controller/service/processor 合同与生成物测试 | 真实 sources/provider、附件/keyword/summary 全链 |
| T18 | migration graph/roundtrip、tag/file lifecycle CI、contract generation | 双库 upgrade/backfill/rollback 限制与规模 |
| T19/T20 | strict creator compensation、credential/admission tests；已有真实 Redis admission Lua CI | actor 权限、creator 初始化失败、同毫秒/60s/TTL 原子性 |
| T21 | 已删除符号调用图、unmarked 单查询回归、import-linter 69 contracts | 范围/依赖护栏与真实部署协议来源核对 |

## 19 项审查修复的当前收敛状态

本轮 review-fix 以 `/tmp/dify-knowledge-reviewfix-20261020/` 为独立基线。下表按能力边界合并 19 项 finding；定向证据之外，最终冻结快照的完整后端单元、类型和静态检查均已通过，结果见下文。容器集成和目标环境迁移均未执行。

| 能力边界 | 当前行为 | 已知验证 |
| --- | --- | --- |
| Dataset 可见性与 quota（#2、#16） | 显式 dataset IDs 查询与普通列表共用 tenant、`only_me`、partial-members 与 RBAC 可见性；仅 trusted internal helper 可 tenant-only。Cloud quota check 开启时 `upload_quota_limit=0` 表示 unlimited，sandbox 与 batch 限制仍执行 | repository/adapters/creation 定向 120 passed；后续 creation policy 快照 32 passed；Ruff、format、Pyrefly 通过 |
| Segment 写保护 | parent 正在 indexing 时，parent PATCH 与 child create/update/batch/delete 使用 typed application error；Console 与 Service API 保持既有 400 invalid-action 合同 | adapter/application/两组 controller 合并 203 passed；import-linter 69/0 |
| Document 状态、重试、删除（#13、#15、#17） | list/detail/progress/retry 共用 effective state；`indexing_retry_action` 明确 retry/enable/disable/archive，retry 锁前预筛、锁后重验；单删/批删统一锁后拒绝 archived 且批量原子回滚 | document lifecycle/sync/retry/delete 相关 224 passed；另有 25 个真实 SQLite projection 测试穷举 832 种状态组合并对比七类 SQL 显示过滤；Ruff、Pyrefly、import-linter、diff-check 通过 |
| Notion 同步（#3、#4） | 两参数 legacy delivery 转换为当前 generation、`source=notion` 的持久意图；内容未变化时完成当前代并保留已有材料，必要 summary intent 与状态同事务 | 包含在上述 224 项定向验证；真实 datasource/extractor I/O 仍需集成环境 |
| Summary（#9、#10） | 生成与向量化按 segment 记录 generated/completed checkpoint；重投从 checkpoint 续跑；锁只覆盖每段状态核对/写入，LLM 与 vector I/O 在锁外 | summary 定向测试及配置快照回归通过；Ruff、format、Pyrefly、import-linter、diff-check 通过 |
| Pipeline queue/position（#5、#12） | normal、priority、create、duplicate 的锁竞争统一 durable defer，不消耗执行预算；文档 position 在锁内读取一次基准并顺序分配，最高位置读取带 `FOR UPDATE` | Pipeline 定向 103 passed；Redis 集成 6 tests collected，未执行 |
| App、Agent 与 UploadFile 生命周期（#1、#6、#14） | App 删除在业务事务创建 cleanup operation；gate 关闭时持久延期并返回，gate 开启后 recovery 重新发布；Agent Soul draft/snapshot ref 规范化并回填；draft 普通文件/大值 offload 覆盖清除旧 owner；segment wrapper 在原事务保留 detached file 候选；icon/avatar/logo mapper 从数据库旧值建立 orphan marker，rollback 与共享引用保持正确 | Agent/draft/App/file lifecycle 123 项定向测试与 bootstrap 测试通过；PG/MySQL 集成 15 tests collected，未执行；icon owner/marker recovery SQLite 定向测试通过；Ruff、Pyrefly、diff-check 通过 |
| 邀请登录与邮箱注册（#7、#11） | 一次性邀请/注册验证先取得 claim；配额拒绝或激活失败时按 claim 身份释放，成功后消费。seat/member/workspace 原子配额异常分别映射既有领域与 HTTP 错误；释放容量后可使用同一有效验证码重试 | account adapter 76 passed，activation/login/controller 定向验证通过；包含首次拒绝后释放容量并重试成功的路径 |
| Document 创建边界（#18） | validated `KnowledgeConfig` 投影为无 `Any` 的 typed persistence command；repository 只依赖 document contracts，并在锁住可信 Dataset 后执行 retrieval/source/name policy | creation policy/application/repository 定向测试通过；scoped Pyrefly 0，import-linter 69/0 |
| External 与旧入口清理（#19） | External template/dataset command 的短事务与 commit 归 repository，HTTP/RBAC 留在 adapter；真实 core caller 改用 retrieval I/O 函数；删除旧 service wrapper、test-only 入口及无消费者 indexing/summary helper，不保留 re-export | external adapter/retrieval 25 passed，core external caller 定向 6 passed；summary cleanup 定向验证通过；符号调用图为空 |
| Workspace owner transfer（#8） | durable pending/watch ledger 与 operation/execution lease 阻止 HTTP retry、worker 与 beat 并发 claim；命中 active claim 的 HTTP retry 返回 typed 409。完成后保留历史 owner 候选 watch，按本地唯一 owner 修复多跳迟到 RPC；资格失效的 pending 转 watch，不丢恢复事实；本地 owner 已变化时不重新加入退出 member，RBAC 已一致时不重复写；Tenant 已删除时消费 ledger 且不新增 remote I/O | Event 驱动多跳迟到 worker、Tenant 删除、本地 transfer/removal、invalid pending、no-op gateway 与 HTTP 409 均有回归；workspace/repository/migration 130 passed、account 76 passed、controller 61 passed，Ruff/format/Pyrefly 通过；file-lifecycle 独立只读复核未发现缺陷 |
| 公开契约再生成 | 当前 controller error map 与 OpenAPI/TS 生成物按冻结源码重新生成 | 517 个 declared error maps、173 个生成文件；contracts 8 个文件 47 tests passed；最终 `tsc --noEmit` 通过 |

## 2026-10-21 的 14 项 follow-up

本轮以 `/tmp/dify-knowledge-followup-20261021/` 为独立基线。14 项生产实现均已收口；下表记录各 owner 的定向验证，最终全量以 follow-up `snapshot-03` 的 25,637 passed、4 skipped 为准。真实容器 CI 与部署验收仍须独立执行。

| # | 修复后的行为边界 | 当前证据状态 |
| --- | --- | --- |
| 1 | Agent draft/snapshot 的 `config_files` ToolFile 与 `config_skills` 都维护 normalized shared refs；六层 stack 由 Layer 5 `d3f7a9c1e584` 对两种配置做有界回填，滚动期 serialized fallback 继续保护旧 writer 的 owner。Skill 文件先在独立短事务中建立带 10 分钟 `cleanup_started_at` 的 durable reservation，再由配置事务凭本次创建 provenance 采用；过期或并发 cleaner 越过 cutoff 时回滚配置并返回 409，不能采用调用方传入的任意 ToolFile。Conversation/App cleaner 保留 Agent/shared/live-conversation owner；最后 owner 解除后才 claim，storage/DB 失败由 gate-controlled bounded recovery 收敛 | 已完成并冻结；最终竞态收口定向 120 passed，Ruff、format、production Pyrefly 0 diagnostics；PG/MySQL lifecycle 17 tests 仅 collected、未执行 |
| 2 | Summary generated/completed/failed/checkpoint 精确绑定 document/segment generation、预期 segment 状态、indexing/embedding 配置和 summary setting，并携 summary row ID、内容指纹、vector node ID/content hash receipt，阻止同值 A→B→A 或行替换后的旧 checkpoint 误命中；ordinary/regenerate outbox 都携完整配置快照。Segment PATCH 的自动生成、手工更新和删除也使用同一 `SummaryWriteFence` | 已完成并冻结；Summary 组合验证 193 passed，最后补充路径 50 passed；Segment PATCH fence 108 passed；Ruff、format、Pyrefly、import-linter 与 diff-check 通过 |
| 3 | Legacy Notion delivery 在 Dataset→Document 锁内只转换当前 generation 的 active create/duplicate/retry/update/recover/sync intent；迟到旧消息不能完成或取消已旋转的新 update/retry，无覆盖时才建立 `source=notion` successor | 已完成并冻结；最终 document/summary 组合 193 passed；Ruff、format、Pyrefly 0 diagnostics、import-linter 69/0 与 diff-check 通过 |
| 4 | Pipeline queue 的稳定 payload 保存 exact tenant/dataset/document/generation/actor manifest；预算耗尽或永久 payload 失败先为 exact generation 持久化 repair，失败则 durable defer 并保留 claim/file/budget。旧 payload 无 manifest 时只在 metadata 缺失路径原子退还一次 attempt；同一 deferred receipt 不能重复退款，下一 receipt 才读取恢复后的 payload | 已完成并冻结；最终 legacy refund/worker 定向 145 passed，Pyrefly 0 diagnostics、Ruff/format 通过；真实容器 22 tests 仅 collected、未执行 |
| 5 | Email-code login 使用原子 claim→consume/release；quota 拒绝或 provisioning 失败释放 claim 并保留剩余 TTL/尝试次数，原始 quota 异常映射现有领域错误，不再返回 500 或提前消费验证码 | 已完成定向验证：152 passed；Ruff、format、Pyrefly、no-spec guard 与 diff-check 通过 |
| 6 | Completed indexing recovery 在同一事务旋转 generation，并原子写 current index state 与必要 summary successor；successor 固化完整配置 identity，只继承或重映射身份匹配、且仍能通过当前 document/segment/summary materialization receipt 精确核验的 generated/completed checkpoint | 已完成并冻结；最终 document/summary 组合 193 passed；后续 Pipeline generation 绑定组合 71 passed（新增两条 NULL 转换回归 2 passed）；Ruff、format、Pyrefly、import-linter 与 diff-check 通过 |
| 7 | Summary lease 过期接管创建 current successor，只继承身份匹配的逐段 checkpoint；继承与运行时跳过都在锁内验证 task intent/execution lease、当前资源/config、捕获的精确 segment 状态和 summary receipt。恢复允许按真实过渡从 `INDEXING/ERROR` 生成 summary，并保持 summary 成功后才把 segment 标记 completed。LLM/vector provider 成功与数据库 completion ACK 分开重试，vector 始终写 fresh node；ACK 成功后才删旧 node，永久 ACK 失败保留 generated checkpoint、outbox 与 fresh node供恢复，避免重复 provider 计费 | 已完成并冻结；Summary 组合 193 passed、最后路径 50 passed；状态过渡相关 79 passed；provider/DB ACK 新增 SQLite 4 passed、既有 commit-retry 3 passed；Ruff、format、Pyrefly、import-linter 与 diff-check 通过 |
| 8 | App cleanup 的 object/SQL helper 失败必须向上抛出；operation 保持可恢复状态，不能把不完整清理标成 completed | 已完成定向验证：20 passed |
| 9 | Documents 页面由同一 selection owner 保存跨页完整 generated DTO 与 ID；批量恢复按所有已选页的 server action 分组，不再遗漏前页 | 已完成 Web 定向验证；与 #10 合计 6 files、111 tests passed，scoped `vp check`/a11y 0 errors；结果来自会话工具输出，没有独立日志文件 |
| 10 | `indexing_retry_action=null` 是不可恢复状态：单行不显示 Retry，批量不 fallback 到 generic retry、不发请求也不显示假成功；成功只移除实际提交项，失败保留选择 | 已完成 Web 定向验证；证据与 #9 共用 111 passed |
| 11 | Owner transfer 本地提交同事务激活 per-operation×recipient 持久待确认入队记录；每个收件人独立 claim/lease/error retry，sync 与 fresh recovery 共用入队流程。`sent` 仅表示 broker `apply_async` 返回且 ledger ACK 已提交；task ID/header 用于身份与关联，不提供 SMTP consumer 幂等，ACK 提交失败时同一 task ID 可能重复 enqueue；已确认入队项通常不再扫描，watch 不重建记录 | 已完成并冻结；最终 ACK/operation-rotation 边界 8 passed，覆盖 commit failure→recovery、正常路径不再扫描已确认项、失败重试、expired claim 与 ACK 丢失；Ruff、format、Pyrefly 0 diagnostics、diff-check 通过 |
| 12 | Pipeline execution log 绑定 generation；current 查询和 manual retry 只选择精确 generation，旋转时同事务复制当前 log。迁移只把每个 Document 可确定的最新 legacy log 绑定到当前 generation；Document generation 为 NULL 的 current repair 与 legacy delivery 两条转换路径也只复制按 `created_at,id` 排序的最新 NULL log 到新代，保留旧日志，不能复用任意历史输入 | 已完成并冻结；#4/#12 组合验证 140 passed；NULL generation 转换组合 71 passed（其中新增回归 2 passed）；follow-up `snapshot-03` 当时的 feature head 为 `b1d5e9fac684`，Ruff、format、Pyrefly 通过 |
| 13 | 删除一步式 `fetch_external_knowledge_retrieval`；所有真实 core caller 先在 owned short Session 中构造 detached request/metadata，退出 context、释放 checkout 后才执行 HTTP；adapter 不 commit/rollback/close caller-owned Session | 已完成定向验证：54 passed；真实 SQLite Engine checkout 与 core single/tool HTTP execute-point 证明 HTTP 时 connection 已 checked in、outer caller transaction 为 false；Ruff、format、production Pyrefly 0 diagnostics、import-linter 69/0、diff-check 通过，容器未运行 |
| 14 | 删除三个无生产 owner 的 dead 接口：`failed_document_index_state_requires_retry`、`set_summary_content`、`load_segment_details`；测试迁到真实 current-state/change-status/segment-detail owner，不保留 wrapper 或 re-export | 已完成并冻结；三个公开符号 fresh `rg` 均为 0 references；最终 document/summary 组合 193 passed，external/dataset-read boundary 54 passed；Ruff、format、Pyrefly、import-linter 与 diff-check 通过 |

2026-10-20 的 review-fix 冻结时，迁移源码 head 为 `e8a2b6c9d351`。当时 `snapshot-02` 的 4,245 份 Python 源码与本地逐份 SHA-256 相同，非 Controller（含全部 VDB/trace provider）19,605 passed、4 skipped，Controller 5,935 passed，合计 25,540 passed；完整 Pyrefly、Ruff/format、import-linter 69/0、mock/model 与 response-contract 护栏通过，Web 103 passed，contracts 47 passed。该结果仅是历史快照。follow-up `snapshot-03` 的 feature 源码图继续到 `b1d5e9fac684`，最终为 25,637 passed、4 skipped；目标环境 migration 与实际容器测试仍未执行。

## 架构保留边界

- `dataset_read_repository` 剩余的是 Dataset 聚合查询与持久化 helper。`lock_dataset_row_for_child_write`、query history、App join 与 collection binding 仍由持有事务的 persistence caller 使用。直接搬进带 application 依赖的 dataset repository 会引入 resource-token 环或 core→service 路径；待相关 core caller 迁出并注入窄 port 后才能内联，不能以兼容重导出保留旧 query owner。
- Legacy extractor/transform/index processor 仍有明确的 Session bridge，用来落来源图片/metadata；不再吸收新的聚合查询。其退出条件是 processor 只返回 detached artifacts，写入经 Document/Segment commands 完成。
- Summary 的多阶段 provider 编排保持准备/生成/终态之间的提交屏障，数据库语句在 summary repository。不得把 LLM/vector 调用搬入 repository，也不得持锁执行 provider。
- 以上是实际调用约束；不作为新增全局 Session、通用 UoW、Saga、DI 容器或宽泛 import 豁免的理由。

## 文件 owner 与恢复入口

| Owner | 创建/覆盖与引用事实 | 解除引用、候选与恢复 |
| --- | --- | --- |
| Document source | Document/Pipeline command 维护 `document_source` normalized ref，并保留旧 serialized 读取 | cleanup manifest 快照两类来源；解除边与 claim 同事务；upload cleanup / marker recovery |
| Segment inline image | Segment create/save 维护 `segment_image` ref；Markdown 只作旧数据读取与引用证据 | segment/document/dataset manifest；解除边与 claim；通用恢复 |
| Segment attachment | 完整 Dataset→Document→Segment owner chain 后写 `SegmentAttachmentBinding`，writer fence 保护 UploadFile | attachment detach/manifest→claim；通用恢复；共享 owner 保留 |
| Message / Conversation | `MessageFile` mapper guard 从 Message→App 解析 tenant，写 owner 前锁 UploadFile | Conversation task 快照候选，同事务删 MessageFile/Message 并 claim；通用恢复 |
| Human Input | `HumanInputFormUploadFile` normalized owner 与 tenant/file fence | Conversation 删除同事务解除 owner、claim；通用恢复 |
| 普通 draft FILE/ARRAY_FILE | ORM guard 与显式 bulk upsert 维护 `WorkflowDraftVariableUploadFileReference`；滚动期兼容 serialized value | reset/single/bulk、Snippet 与 App 统一 detach draft owner/ref + claim；通用恢复 |
| draft 大值 offload | `WorkflowDraftVariable.file_id`→`WorkflowDraftVariableFile`→UploadFile；写入走 fence | 同事务删 offload owner + marker；storage 在事务外；失败保留 UploadFile/key/marker，不依赖已删 owner |
| node execution offload | `WorkflowNodeExecutionOffload.file_id` owner 与 ORM writer fence | App 同事务 detach 本 App offload owner + claim；事务外 storage；失败后由新 marker recovery 实例恢复，不依赖 App 有限重试；其他 owner 仍保护共享文件 |
| Agent config draft/snapshot | `AgentConfigDraft` 与 `AgentConfigSnapshot` 的 `config_files` 写入同步维护 `AgentConfigUploadFileReference`；`d7f1a5b8c240` 在 Layer 2 只建 schema，旧 serialized owner 由 Layer 5 `d3f7a9c1e584` 有界回填 | update/delete 在同一 owner fence 内解除旧 ref 并产生候选；draft、snapshot、App/Agent 退休与通用 orphan recovery 共用同一全域引用判断 |
| Agent config ToolFile | `AgentConfigDraft` 与 `AgentConfigSnapshot` 的 `config_files` ToolFile、`config_skills` 都同步维护 `AgentConfigToolFileReference`；`f9b3c7dae462` 在 Layer 2 只建 schema，Layer 5 `d3f7a9c1e584` 有界回填两类配置，serialized fallback 保护迁移窗口内的旧 writer。新 skill ToolFile 先在独立事务建立 10 分钟 reservation，配置事务只凭本次创建 provenance 采用 | writer 锁定稳定 ToolFile ID；reservation marker 未严格晚于统一 adoption cutoff 时配置事务回滚并返回 409。Conversation/App/Agent detach 后全域复查，只有最后 owner 消失才设置 `cleanup_started_at`；storage/SQL finalize 失败由 `recover_agent_config_tool_file_cleanup` 重试 |
| App/Site 与其他 icon/avatar/logo | App、Site、Account、Tenant、Dataset、PipelineCustomizedTemplate、Agent、CustomizedSnippet、MCPToolProvider mapper 从数据库读取旧值，按稳定 ID 一次锁 old/new UploadFile，校验 tenant/creator 与 marker | owner UPDATE/DELETE 后在同一 connection/事务做全域 orphan 复查并写旧值 marker；共享引用保留，rollback 同时撤销 marker；通用恢复 |
| Preview | extraction ContextVar 只收集本次实际 INSERT 的 UploadFile，不以 Markdown ID 推断所有权 | 成功与异常均仅对 proven-new 集合 claim；gate 关闭保留 marker |

Knowledge 写锁序保持 Dataset→Document→Segment→UploadFile→ref。跨域 writer 先锁 UploadFile 再写 owner/ref。通用 cleaner 持 UploadFile 后只对 owner 做 NOWAIT current-read；App/draft 无锁快照后先稳定锁初始文件，owner current-read 增加的文件也用 NOWAIT，冲突整体回滚/defer，不持文件锁等待反向 owner。

ToolFile、workflow pause/archive、ops trace、RSA key、keyword index/website crawl cache 仍归各自 storage owner，不冒充 UploadFile 引用。App 路径在整体 task gate 内。ToolFile 不再假定 Conversation 独占 `file_key`：Agent draft/snapshot 可以与 Conversation 共享同一文件，所有删除入口必须先检查 normalized Agent refs，统一经 claim、全域复查和 recovery 收敛。

原有 bulk delete 会绕过 mapper hook。盘点出的 5 个真实入口已在原事务内改为触发上述生命周期的 ORM delete：App Site 批清理、installation 定向 Account 回滚、reset-key 的 MCP provider 清理、Agent 删除与无 owner Agent App 退休。Agent 退休先删 Site 再删 App，以保留旧图标候选；没有扩展这些业务的结构或外部副作用。

## 验证记录

2026-10-21 follow-up `snapshot-01` 和 `snapshot-02` 分别保留 10 项与 1 项失败，均不记 green。最终 `snapshot-03` 的非 Controller（含全部 VDB/trace provider）为 19,700 passed、4 skipped、593 warnings（166.36 秒），Controller 为 5,937 passed、19 warnings（114.75 秒），合计 25,637 passed、4 skipped。完整 production/unit/container Pyrefly、Ruff 全 API、format 4,047 files、import-linter 69 kept/0 broken、response lint 600 valid/0 mismatch/0 refactorable/277 unknown、三个 mock/model guards 均 exit 0；integration 为 1,611 tests collected，仅收集、未运行容器。

最终 `snapshot-03` 在测试前后都核对 4,258 份 Python 与本地源码逐份一致，`source-post-tests-03.log` 无漂移；`/tmp/dify-knowledge-followup-20261021/final-integrity.json` 还确认没有新增/删除 Python 源码、staged patch 与 import-linter 配置未变、233 个基线 migration 文件 hash 未变、没有新增 `api/core/` Python、公开 contract source 相对 follow-up 基线无漂移。`final-checks.json` 记录各 suite 的实际 testcase 统计与全部 exit-zero 检查。migration、gate、停写/回填和容器集成仍须真实 CI/部署执行。

follow-up 全量使用 `uv run --project api pytest --no-cov -p no:benchmark --timeout 60 -n 16 --dist loadfile`。非 Controller 进程覆盖 `api/tests/unit_tests`、`api/providers/vdb/*/tests/unit_tests` 与 `api/providers/trace/*/tests/unit_tests`，并传 `--ignore=api/tests/unit_tests/controllers`；Controller 进程独立执行 `api/tests/unit_tests/controllers`。最终远端日志为 `verification-logs/unit-03.log/xml`、`controllers-03.log/xml`、`type-03.log`、`ruff-03.log`、`format-03.log`、`import-linter-03.log`、`response-contract-03.log`、`integration-collect-03.log`、`source-03.log` 与 `source-post-tests-03.log`，已复制到 `/tmp/dify-knowledge-followup-20261021/verification-logs/`；精确命令另存 `/tmp/dify-knowledge-followup-20261021/snapshot-03-commands.json`。源码基线是 revision `1fefc527239027adaafcb6286a05b21945ce55c5` 加原 dirty tree；233 个基线 migration 文件中有 230 个 Python 文件。

Web #9/#10 使用标准 `vp test run --project unit` 定向执行 6 个 Documents spec，结果为 6 files、111 passed；scoped `vp check` 与 `vp run dify-web#lint:a11y --deps` 为 0 errors。三项是会话工具输出，没有独立日志文件。公开契约的实际归档为 `/tmp/dify-knowledge-followup-20261021/contracts-final.log`（8 files、47 passed）和 `contracts-types-final.log`（`tsc --noEmit` exit 0，成功时无输出）。

下表是 2026-10-20 review-fix 的历史证据，来自 `/home/byron/dify-codex-workspaces/knowledge-reviewfix-20261020-01/verification-logs/` 的 `*-02` 日志，并已复制至本地 `/tmp/dify-knowledge-reviewfix-20261020/verification-logs/`。不得把它当成 2026-10-21 follow-up 的最终 green。以下 `unit-04`、`controllers-04`、`type-05` 与 `*-04` 日志又属于 19 项 review-fix 之前的更早历史快照，继续单独保留。

| 2026-10-20 最终 review-fix 检查 | 历史记录 |
| --- | --- |
| 非 Controller 单元与全部 VDB/trace provider | `unit-02.log/xml`：19,605 passed、4 skipped，167.99 秒 |
| Controller 单元（独立进程） | `controllers-02.log/xml`：5,935 passed，114.08 秒；合计 25,540 passed |
| 类型、格式与依赖 | `type-02.log`：完整 Pyrefly exit 0；`ruff-02.log` 通过，`format-02.log` 4,037 files already formatted；`import-linter-02.log` 69 kept、0 broken |
| 源码与基线完整性 | `snapshot-02-source.sha256` / `source-02.log`：4,245 份 Python 本地与远端一致；`final-integrity.json`：测试后无 Python 变化、staged patch 不变、230 个旧迁移不变、import-linter 配置不变；未新增 core 模块或依赖豁免 |
| API/model/mock 护栏 | no-spec-mock、no-new-session-mock（对 HEAD）、no-new-base-model、diff-check 通过；`response-contract-final.log`：600 valid、0 mismatch、0 refactorable、277 unknown |
| Web 与公开契约 | 5 个相关 Web 文件 103 passed；scoped type/lint/a11y 通过；517 个 error maps/173 个生成文件；`contracts-final.log`：8 个文件 47 passed，`contracts-types-final.log` exit 0 |
| 数据库/Redis 集成与迁移 | `integration-collect-final.log`：1,607 tests collected，未执行；单 head `e8a2b6c9d351`；目标环境 migration、停写/回填、gate 与恢复演练均未执行 |

历史快照开发中的中间失败按根因修复，不作为通过证据。该次远端执行使用独立目录 `/home/byron/dify-codex-workspaces/knowledge-refactor-20261020-01`；只在本机修改代码。

| 检查 | 记录 |
| --- | --- |
| 初轮全量后端单元（不含 controllers） | `unit-01.log/xml`：18,121 passed、216 failed、4 skipped；失败包含远端 PATH 缺少 uvx/ast-grep、旧测试调用与改造中快照。此轮不记 PASS |
| 最终非 Controller 后端单元（含全部 VDB/trace provider） | `unit-04.log/xml`：19,643 passed、4 skipped，168.82 秒 |
| 最终 Controller 单元（独立 pytest 进程） | `controllers-04.log/xml`：5,931 passed，108.02 秒；两类合计 25,574 passed |
| 完整 Pyrefly | `type-05.log`：production、unit、testcontainers 配置全部 exit 0。最终修正一处测试对 typed quota port 的 mock 配置写法，该文件另跑 19 passed；生产代码未变 |
| Ruff / format / dependency | `ruff-04.log` 全 API 通过；`format-04.log` 4,028 files already formatted，末次测试修正也单独检查通过；`import-linter-04.log` 69 kept、0 broken，配置与基线相同 |
| 架构与公开 schema 护栏 | 全 API no-spec-mock、no-new-base-model 与 `git diff --check` 通过；response contract lint：600 valid、0 mismatch、0 refactorable、277 unknown；原有 migration 指纹未变；该历史快照当时单 head 为 `b5d9e3f6a028`，2026-10-20 review-fix 继续到 `e8a2b6c9d351`，follow-up `snapshot-03` 的 feature head 为 `b1d5e9fac684` |
| Console 状态消费者 | 最终相关 7 个 Web 测试文件 109 passed；Vite+ check 0 errors（3 个既有 warnings），启用仓库 typeCheck；未改抑制基线 |
| TS/Zod/oRPC 公开契约 | 最终重生成、516 个 declared error maps；契约 24 passed，contracts `tsc --noEmit` 通过 |
| PostgreSQL/MySQL/Redis 集成 | 完整 integration suite `integration-collect-04.log`：1,604 tests collected；仅收集，未执行，等待真实 CI |
| 目标环境迁移、清理屏障、存量核对 | 未执行；按运行手册形成目标环境证据 |

2026-10-21 follow-up `snapshot-03` 的完整后端单元与静态检查已通过。P6 真实 CI、停写/清理 gate、migration 与恢复演练仍须分别闭环后再勾选计划第 12 节。

2026-10-20 初轮历史快照的远端证据位于 `/home/byron/dify-codex-workspaces/knowledge-refactor-20261020-01/verification-logs/`，对应日志已复制到 `/tmp/dify-knowledge-refactor-20261020/verification-logs/`。`final-source.sha256` 记录 4,233 份 Python 源码；与本地最终树逐份核验，唯一差异为 `test_account_activation_service.py` 的末次 mock 类型修正，另经 19 项定向单测、格式检查及完整类型检查，记录于 `post-unit-test-fix.sha256`。运行命令使用 `uv run --project api pytest --no-cov -p no:benchmark --timeout 60 -n 16 --dist loadfile`；非 Controller 包含 `api/tests/unit_tests` 与全部 provider unit 目录、忽略 controllers，Controller 单独传该目录。远端没有 `.git`，因此 Ruff 显式排除 `.venv`，避免检查依赖安装内容。
