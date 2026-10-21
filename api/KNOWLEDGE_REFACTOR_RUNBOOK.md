# Knowledge 改造发布与恢复记录

本文承接 [改造方案](KNOWLEDGE_REFACTOR_PLAN.md) 第 11 节。它是发布操作手册；2026-10-20 初始改造和 2026-10-21 follow-up 都没有连接部署数据库、执行迁移或发布服务。真实环境的版本、排空记录、备份恢复演练和 CI 链接应由发布执行者填写。Stack 状态更新于 2026-10-21。

## 2026-10-21 Stack 拆分边界

替代 #44162 的六层 stack 以 upstream `main@9c99530ffcc5eed64cb1dde06206e6c7460a9ab1` 为唯一基线，顺序为 retrieval application boundaries（[PR #44483](https://github.com/langgenius/dify/pull/44483)）、durability schema/pure outbox kernel（[PR #44485](https://github.com/langgenius/dify/pull/44485)）、typed knowledge policies/query boundaries（[PR #44488](https://github.com/langgenius/dify/pull/44488)）、workspace lifecycle（[PR #44489](https://github.com/langgenius/dify/pull/44489)）、完整 file lifecycle 与 Document/Segment/Summary/Pipeline runtime（[PR #44490](https://github.com/langgenius/dify/pull/44490)）、Web recovery UI/docs（[PR #44494](https://github.com/langgenius/dify/pull/44494)）。Layer 1–4 CI 已通过；Layer 2 只落文件引用空 schema；Layer 5 的最终 exact-prefix 后端 full unit/static 正在远端并行验证，CI 仍在进行。Layer 3–6 只能以各自最终父层构造并独立验证，不得复用拆分前的全量计数，也不得将当前状态表述为整个 stack 的 CI 已全部通过。Layer 1/2 的分层基线是 72 条 import-linter contracts、0 broken；每层仍需在 exact prefix 上重跑。

原 workspace 的 source/index 保持不变。`/tmp/dify-stack-pre-source.json` 保存 14,081 个 source 条目，拆分前的 status、staged patch 和 unstaged patch 分别保存在 `/tmp/dify-stack-pre-status.z`、`/tmp/dify-stack-pre-staged.patch` 和 `/tmp/dify-stack-pre-unstaged.patch`。这些是本次会话的本地完整性证据，不是可移植的发布归档。

当前 Alembic sole head 为 `c2e6fab0d795`，合并 upstream `a8c3e7f4b912` 和 feature `b1d5e9fac684`。目标环境尚未执行该 migration，不得根据源码 head 推断环境已升级。

`.github/workflows/db-migration-test.yml` 的 offline 步骤只打印 `flask db upgrade base:head --sql` 与 downgrade SQL，不执行输出产物。`e2a8b0d3f715` 的 tag row-driven 处理不能由 offline SQL 执行，SQL 注释明示这只是 DDL review；它仍须在正常 online upgrade 中完成 normalization 和 uniqueness。Layer 2 中的 `f3b9c1e4a826`、`d7f1a5b8c240` 和 `f9b3c7dae462` 只创建空 file-owner schema，无论 offline 还是 online 都不激活 owner 回填。不得把 offline 输出当作可部署的完整数据迁移；必须在 CI 的新 PostgreSQL/MySQL 上正常执行 `flask upgrade-db`。容器集成用例同样是 CI-only，collect-only 不等于已执行。

文件 owner 回填只能由 Layer 5 的 `d3f7a9c1e584`（`down_revision = c2e6fab0d795`）执行。在此之前，必须同时具备新 writer、legacy writer fence 和全部 deleter/orphan fence；否则旧 cleaner 可以先删 blob，Document/Segment 旧 writer 也会越过 owner fence。因此单独部署 Layer 2–4 时，不得手工回填 file-owner 表，不得启用物理清理 gate。

本文中 25,637 passed、4 skipped 仅代表拆分前 follow-up `snapshot-03` 的 dirty-tree 历史快照，不能作为任何 stack PR 前缀的 green 证据。对每个 layer 只记录从其最终 exact prefix 产生的 CI/验证结果。

Layer 6（[PR #44494](https://github.com/langgenius/dify/pull/44494)）已基于 Layer 5 exact parent 验证：7 个 Web 文件共 112 个测试通过，完整 Web type、workspace/scoped static 通过；API Markdown 与 TypeScript contracts 重生成后的 177 个受管文件为 0 drift。Dependency-aware a11y 的 79 个错误来自 33 个未被 Layer 6 修改的既有文件。

## 发布前证据

- 基线为 `1fefc527239027adaafcb6286a05b21945ce55c5` 加实施前全部工作树改动；原 staged/unstaged 状态保持独立，没有 reset 或重写历史。
- 先记录各环境 `alembic_version` 和镜像 digest。已有 outbox/tag/file lifecycle revision 若已执行，不修改历史 revision。本 feature 迁移链为 `f3b9c1e4a826 → a4c8d2e5f917 → b5d9e3f6a028 → c6e0f4a7b139 → d7f1a5b8c240 → e8a2b6c9d351 → f9b3c7dae462 → a0c4d8ebf573 → b1d5e9fac684`，依次覆盖 workspace preparation、document execution claim、App cleanup operation、Agent config UploadFile refs、workspace owner transfer operation、Agent config ToolFile refs/claim、owner-transfer per-recipient notification 和 Pipeline execution-log generation；`c2e6fab0d795` 再将它与 upstream head 合并。目标环境必须核对实际起点，不能因源码显示 head 就推断已经执行。
- PostgreSQL、MySQL、Redis 的容器测试由 `.github/workflows/api-tests.yml` 的 `api-integration` 执行；迁移双库验证由 `db-migration-test.yml` 执行。collect-only、SQLite 和单元测试不能替代这些证据。
- 对象存储版本/备份与原 workspace 私钥的恢复能力必须实际验证。新生成私钥不能解开旧密文。

## 停写和清理屏障

1. 在 API、worker、beat 和运维进程的有效环境中设置 `ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=false`。可选配置位于 `docker/envs/core-services/shared.env.example`；`docker/.env` 可覆盖服务专用 env 文件。
2. 停止旧 cleaner 取新任务，停止旧 API、workflow/draft、retention、Snippet、文件上传引用等 writer。旧进程不认识新 gate，必须排空或受控终止；仅停止 beat 不够。
3. 在原部署的 `api/` 工作目录中记录以下检查输出，并核对部署平台上的旧进程、pod 和镜像。命令会导入配置，只在目标环境的受控运维会话执行：

   ```sh
   uv run --project . celery -A app.celery inspect active
   uv run --project . celery -A app.celery inspect reserved
   uv run --project . celery -A app.celery inspect scheduled
   uv run --project . celery -A app.celery inspect active_queues
   ```

4. `active` 中不能残留旧 physical deleter 或在途 provider writer。数据库中相关 executing lease、工作流运行和存储删除请求也须对账。队列长度为零不能证明执行已结束。
5. gate 关闭时保留 durable pending 意图、文件 claim marker 和 App owner/candidate；App 删除任务把 operation 延期到数据库后正常返回，由 gate 开启后的 recovery 重新发布，不依赖 `Reject(requeue=True)` 或有限 retry 等待发布窗口。legacy 消息保留在 broker，相关消费队列保持暂停。

## 升级与恢复写入

下列文件 owner 激活步骤只适用于完整 Layer 5 前缀。单独发布 Layer 2–4 时，可执行该前缀自带的 schema/kernel/workspace 迁移，但 file-owner 表必须保持未回填，物理清理 gate 必须保持关闭。

1. 下发认识新 payload 且遵守文件 fence 的所有 consumer/writer 镜像。保持清理关闭、API 不接写流量、任务消费暂停；新模型不能在旧 schema 上执行任务。
2. 复核 `api/docker/entrypoint.sh` 与 `dev/start-worker` 队列配置。新 worker 同时消费旧队列和 `dataset_v2`、`dataset_summary_v2`、`priority_dataset_v2`、`pipeline_v2`、`priority_pipeline_v2`；旧 worker 不能消费 v2。
3. 核对 fresh worker 的配置包含 outbox dispatcher、租户队列恢复、legacy converter、UploadFile marker recovery、`recover_agent_config_tool_file_cleanup`、durable App cleanup recovery、workspace provisioning recovery 与 workspace owner-transfer recovery。owner-transfer recovery 同时负责 per-recipient notification enqueue/ACK；两个 workspace recovery 都需要 `schedule_executor` consumer，App cleanup recovery 使用 `app_deletion`，ToolFile recovery 使用 `conversation`。此时仍不恢复消费。
4. 在目标环境确认 migration head 和已执行版本，再运行该环境原有的 `flask upgrade-db` 发布步骤（见 `api/docker/entrypoint.sh`）。Layer 5 的最终 head 必须包含直接下接 `c2e6fab0d795` 的 owner-backfill activation revision `d3f7a9c1e584`。开发时没有替目标环境执行此操作。
5. 迁移完成后启动新 consumer，以 `celery -A app.celery inspect registered` 核对上述任务名。仍保持 writer 停止，在停写边界后核对 `d3f7a9c1e584` 已回填的引用边：Document source、segment inline/attachment、Message/Conversation、Human Input、普通 draft FILE/ARRAY_FILE、draft/node 大值 offload、Agent Soul draft/snapshot `config_files` 的 UploadFile refs，以及 `config_files` ToolFile 与 `config_skills` refs；滚动期 serialized fallback 的计数也必须核对，包含缺少 `file_kind` 的 legacy 配置。再核对 App/Site/Account/Tenant/Dataset/Pipeline/template/Agent/MCP/Snippet 图标、owner-transfer notification ledger 和 Pipeline log generation 回填；不能跳过 `d3f7a9c1e584`、`a0c4d8ebf573` 或 `b1d5e9fac684` 后直接恢复 writer。
6. 恢复正常写入，保持清理关闭。检查新引用都经过 UploadFile 锁与 marker 校验；确认没有旧 writer、旧在途任务或绕过 fence 的运维清理入口。
7. 观察索引状态、转换任务、补偿和候选积压后，才将 `ENABLE_UPLOAD_FILE_PHYSICAL_CLEANUP=true`，并重载相关进程配置。beat 的 claimed-marker recovery 只在 gate 启用时注册，需要重启/重载 beat；App cleanup recovery 固定注册，但 gate 关闭时只保留/延期 operation，启用后才重新发布实际删除。已排队 durable cleanup 会继续恢复。

存储目录的历史孤儿 sweep 不是上述发布步骤的自动动作。确需执行时，在 writer 仍停止且旧在途执行已排空的独立窗口内，临时启用 gate，运行 `flask remove-orphaned-files-on-storage --writers-stopped`，完成后关闭 gate，再恢复正常写入。该命令逐对象刷新数据库引用并检查 gate；`--writers-stopped` 是执行者对已完成停写屏障的声明，不能替代排空证据。本轮未运行该命令。

## 运行核对

以下只读 SQL 不输出 token、私钥或用户输入。按部署工具执行并保留计数与最老时间；不要直接修改状态列绕过业务重试。

```sql
SELECT task_kind, status, COUNT(*) AS total, MIN(created_at) AS oldest
FROM knowledge_task_outbox
GROUP BY task_kind, status;

SELECT COUNT(*) AS claimed_files, MIN(knowledge_cleanup_started_at) AS oldest
FROM upload_files
WHERE knowledge_cleanup_started_at IS NOT NULL;

SELECT COUNT(*) AS claimed_tool_files, MIN(cleanup_started_at) AS oldest
FROM tool_files
WHERE cleanup_started_at IS NOT NULL;

SELECT status, COUNT(*) AS total, MIN(updated_at) AS oldest
FROM workspace_provisioning_operations
GROUP BY status;

SELECT status, COUNT(*) AS total, MIN(available_at) AS oldest_available
FROM app_cleanup_operations
GROUP BY status;

SELECT status, COUNT(*) AS total, MIN(next_reconcile_at) AS oldest_reconcile
FROM workspace_owner_transfer_operations
GROUP BY status;

SELECT status, COUNT(*) AS total, MIN(next_attempt_at) AS oldest_attempt
FROM workspace_owner_transfer_notifications
GROUP BY status;

SELECT COUNT(*) AS documents_missing_current_pipeline_log_binding
FROM documents
WHERE documents.indexing_generation IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM document_pipeline_execution_logs AS legacy_logs
    WHERE legacy_logs.document_id = documents.id
      AND legacy_logs.indexing_generation IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM document_pipeline_execution_logs AS current_logs
    WHERE current_logs.document_id = documents.id
      AND current_logs.indexing_generation = documents.indexing_generation
  );
```

应同时核对：publish 与 execution 尝试、expired/lease loss、current repair、legacy converted/skipped、pipeline dead-letter 与 early-budget repair、summary config identity/segment checkpoint、UploadFile/ToolFile claim age、App cleanup pending/running、owner-transfer reconcile 与逐收件人 enqueue/ACK、Pipeline log generation、compensation pending/unknown/watch。日志关联 tenant/resource/generation/intent/operation/notification ID；不导出 payload、凭据或密钥。

`compensation_watch` 是防迟到 provider 调用的持久 tombstone。成功补偿后仍定期核对；Tenant 存在时保留 key/RBAC。不要将它批量删掉或直接改成已完成，以免进程退出前的迟到外部调用留下资源。

## 定向修复与回滚

| 发现 | 使用的恢复边界 |
| --- | --- |
| 当前目标 pending/failed | Console/Service 检索返回 `503 knowledge_index_unavailable`；修复 provider 后通过相同配置或状态命令重试，不改配置值绕过失败状态 |
| completed 文档缺少必要 summary intent | 通过当前 generation 的 document recovery/completion 在同一事务补建 successor；携带当前四项 summary config identity，只继承或重映射身份匹配 checkpoint，不重跑无关正文 |
| summary 在部分 segment 后中断 | 保留 outbox payload 中与 document/segment generation、预期 segment 状态、indexing/embedding 配置和 summary setting 精确绑定的 generated/completed checkpoint；checkpoint 还必须命中当前 summary row ID、内容指纹、vector node ID/content hash receipt。接管 successor 和运行时跳过都在锁内核验 task intent/execution lease、当前资源/config、捕获的精确 segment 状态与 receipt；恢复可从 `INDEXING/ERROR` 生成 summary，但必须在 summary 成功后才把 segment 标为 completed。Segment PATCH 使用同一 fence，A→B→A 或行替换不能复活旧结果 |
| summary provider 已成功但 completion ACK 失败 | LLM/vector provider 调用与数据库 ACK 分开重试；vector 每次写 fresh node，ACK 成功后才删旧 node。永久 ACK 失败时保留 generated checkpoint、outbox 与 fresh node供恢复，ACK 重试不得再次调用 provider；明确 fence 拒绝只清理本次 fresh node |
| 迟到 Notion legacy delivery | converter 只核对并转换当前 generation 的 active intent；不得完成、取消或覆盖已旋转的新 update/retry |
| Pipeline 在稳定任务进入 worker 前耗尽预算 | 使用 payload 中 exact tenant/dataset/document/generation/actor manifest 持久化 current repair；repair 失败时 durable defer 并保留 claim/file/budget。旧 payload 无 manifest 只在 metadata 缺失分支原子退还一次 attempt，让下一 receipt 读取恢复后的 payload；同一 deferred receipt 不得重复退款，数据库恢复失败也不得退还耗尽预算 |
| 旧 executing 已过期 | 由有效接管者持久安排 current repair；不依赖已退出旧 worker 的 finally |
| 永久无效 pipeline batch | 终止稳定 identity、保留有界 dead-letter 诊断；只更新仍匹配 generation 的文档 |
| 文件 object 已删、SQL finalize 未完成 | 保留行/key/marker，claimed-marker recovery 幂等 finalize；存储权限或服务故障继续保留候选 |
| App cleanup pending/running 过期 | 保留 `app_cleanup_operations`，由 recovery 重新发布或接管 lease；gate 关闭时继续延期，不手工改 completed、不靠 broker Reject 重投 |
| App cleanup helper 失败 | object 删除、存在性核对或 SQL finalize 任一步失败都必须向上抛出并保留 recoverable operation；不得吞错后标 completed |
| App/draft owner 已删而 marker 仍在 | 由全域 orphan fence 和 marker recovery 处理，其他 App/Knowledge 引用继续保护文件 |
| Conversation/App 要删除仍被 Agent config 引用的 ToolFile | 同时核对 draft/snapshot 的 `config_files` ToolFile、`config_skills` normalized refs 与滚动期 serialized fallback；共享 owner 存在时保留。新 skill 文件先在独立短事务建立 10 分钟 reservation，再由配置事务凭本次创建 provenance 采用；cleaner 越过统一 cutoff 后采用必须回滚并返回 409。最后 owner detach 后才 claim，storage/DB finalize 失败保留 `cleanup_started_at` 并由 `recover_agent_config_tool_file_cleanup` 收敛 |
| owner transfer pending 或 worker 失联 | 保留 durable pending/watch ledger；operation/execution lease 只允许一个 HTTP retry、worker 或 beat recovery claim，匹配 active claim 的 HTTP retry 返回 409。资格失效的 pending 转 watch；按本地唯一 owner 收敛，不重新加入已退出 member，RBAC 已一致时不重复写 |
| owner transfer 完成后出现多跳迟到 RPC | 保留历史候选 watch，并按当前本地唯一 owner 定向修复 drift；Tenant 已删除时消费 ledger，不新增 remote I/O；不要手工删除 watch 来隐藏未收敛的外部状态 |
| owner transfer 已提交但通知尚未确认入队 | 保留逐 operation/recipient ledger 行；只 claim/retry 未确认入队或 lease 过期的收件人。`sent` 表示 `apply_async` 返回且 ledger ACK 已提交，已确认项通常不再扫描；若 broker 已接收但 ACK 提交失败，同一 task ID 可以再次 enqueue。task ID 只用于身份/关联，不保证 SMTP consumer 幂等或 exactly-once，watch reconciliation 不重建 ledger |
| Pipeline manual retry 命中历史 log | 只选择与 current Document generation 精确匹配的 execution log；generation 旋转时同事务复制 current log。迁移只绑定每个 Document 可确定的最新 legacy log；Document generation 为 NULL 的 current repair 与 legacy delivery 两条转换也只把按 `created_at,id` 排序的最新 NULL log 复制到新代，旧日志保留，禁止任取历史记录 |
| External retrieval HTTP 卡住或失败 | 先在 owned short Session 中完成 detached request/metadata prepare，退出 context 并归还 checkout 后才执行 HTTP；caller-owned Session 的 commit/rollback/close 仍归 caller，不把远程等待放进事务 |
| Tenant 存在但 key 缺失 | 停止相关补偿，恢复原 key 或 Key Vault 原资源；禁止覆盖公钥冒充恢复 |
| UNKNOWN 提交或 DB 不可用 | 保留 key/RBAC，由同一 operation 行事务屏障核对；不能通过 membership 推断提交失败 |
| 活跃文件引用存在但 object 缺失 | 关闭清理，按已验证备份恢复；记录受影响 owner，不伪造恢复成功 |

回滚始终先关闭 gate。新任务未排空、新 schema/约束不兼容旧 writer 时，不能重启旧 consumer 或执行破坏性 downgrade。代码回滚不能恢复已删对象或私钥。

legacy converter 的移除条件：旧 producer/worker 为零，旧队列与在途执行为零，超过实际消息保留及重投窗口，且已完成数据核对。没有生产来源的 unmarked fallback 已直接删除，不随真实旧协议保留。

## 发布执行记录

2026-10-21 的 14 项 follow-up 使用本地基线 `/tmp/dify-knowledge-followup-20261021/`；生产实现已全部收口。远端工作区 `/home/byron/dify-codex-workspaces/knowledge-followup-20261021-01` 的 follow-up `snapshot-01` 与 `snapshot-02` 保留为中间失败证据。最终 `snapshot-03` 的非 Controller 为 19,700 passed、4 skipped、593 warnings，Controller 为 5,937 passed、19 warnings，合计 25,637 passed、4 skipped；完整 Pyrefly、Ruff、format 4,047 files、import-linter 69/0、response 600/0/0/277 与三个 mock/model guards 均 exit 0，integration 1,611 tests 仅 collected。测试后 4,258 份 Python 与最终 source snapshot 完全一致；233 个基线 migration 文件、staged patch、import-linter 配置与公开 contract source 均无漂移，没有新增 `api/core/` Python。已冻结 scoped 证据包括 Agent ToolFile 120 passed（PG/MySQL 17 tests 仅 collected）、Summary 193、Segment fence 108、Pipeline legacy refund 145（容器 22 collected）、email-code/quota 152、App cleanup fail-propagation 20、Web 跨页/null action 6 files/111、external boundary 54；这些定向数字不应相加。migration、gate、容器测试、停写与回填都尚未执行。

| 2026-10-21 follow-up 证据 | 本轮状态 |
| --- | --- |
| 最终后端单元、Controller 与 skipped 计数 | follow-up `snapshot-03`：非 Controller 19,700 passed、4 skipped、593 warnings（166.36 秒）；Controller 5,937 passed、19 warnings（114.75 秒）；合计 25,637 passed、4 skipped |
| 完整类型、Ruff/format、依赖、mock/model/response 与源码一致性护栏 | follow-up `snapshot-03`：Pyrefly、Ruff、import-linter 69/0、response 600/0/0/277、三个 guards 均 exit 0；format 4,047 files；测试后 4,258 份 Python 一致，`final-integrity.json` 无源码/基线漂移 |
| Web 与公开契约最终结果 | Web #9/#10：6 files、111 passed，scoped `vp check`/a11y 0 errors；三项为会话工具输出、无独立日志。contracts：`/tmp/dify-knowledge-followup-20261021/contracts-final.log` 为 8 files/47 passed，`contracts-types-final.log` 为 `tsc --noEmit` exit 0；公开 contract source 与 follow-up baseline 无漂移 |
| integration collect | follow-up `snapshot-03`：1,611 tests collected；仅代表收集，不能当作容器执行 |
| 实际 PG/MySQL/Redis CI | 未执行，待填写 run URL 与结果 |
| 目标环境 migration/gate/停写/回填 | 未执行 |

以下是 2026-10-20 的 19 项审查修复历史快照。独立本地基线与最终日志位于 `/tmp/dify-knowledge-reviewfix-20261020/`。冻结后的远端 `snapshot-02`：非 Controller（含全部 VDB/trace provider）19,605 passed、4 skipped，Controller 5,935 passed，合计 25,540 passed；完整 Pyrefly、Ruff/format、69 条依赖规则和 API/model/mock 护栏通过。Web 相关 5 文件 103 passed；公开契约重生成 517 个 error maps、173 个文件，contracts 8 文件 47 passed，`tsc --noEmit` 通过。4,245 份 Python 源码与远端 `snapshot-02-source.sha256` 一致，测试后没有 Python 漂移；既有 staged patch、230 个旧迁移与 import-linter 配置均未改动。Event 多跳迟到 owner worker、删除、local transfer/removal、invalid pending、no-op gateway 与 HTTP 409 已有回归。集成测试 1,607 项仅收集，未运行容器。该历史结果不能作为 2026-10-21 follow-up green；单元和静态证据也不能填作真实 CI 或发布完成项。

| 证据 | 本轮状态 |
| --- | --- |
| 2026-10-20 review-fix `snapshot-02` 历史验证 | 25,540 后端单元通过、4 skipped；完整类型/格式/依赖规则通过；Web 103、contracts 47 通过；完整记录见实施文档 |
| 实际部署环境与当前 revision | 未连接目标环境；当前源码 migration head 为 `c2e6fab0d795`，待发布执行者填写环境实际 revision |
| PG/MySQL/Redis CI run URL 与结果 | 待真实 CI 执行，不能填单元/collect 结果 |
| 停写、旧 active deleter 清零、二次回填 | 待部署演练 |
| 原对象/私钥恢复演练 | 待目标环境验证 |
| gate 开启时间与发布负责人 | 尚未开启/发布 |
