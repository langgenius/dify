# EE Human Input inner API：box 集成测试

日期：2026-11-11（Asia/Shanghai）。本次按用户明确要求在 box 执行数据库集成测试。

## 环境与代码

- 主机：`box`；独立目录：`/home/qg/workspace/hitl-ee-inner-api-20261111`。
- Python 3.13.5、uv 0.8.9；PostgreSQL 15、MySQL 8.0、Redis 6 使用本次创建的隔离容器，端口仅绑定 loopback。
- 代码为 `d2b2871eee0c28ecb22bc3527743cf0b12486671` 加当前未提交修改。5226 个源文件的 SHA-256 与当前工作区一致；没有使用旧 API 镜像中的 Python 3.12 执行本次代码。
- Manifest SHA-256：`db7826e09dd73dfed75f45bab0e49510c41b70d75278abb822518a9c207921c9`。
- 在全新 PostgreSQL 数据库执行全部 Alembic upgrade，实际到达 `a84d72e9c61f`，包括新增的 nullable 部署密钥 reference。

环境使用当前 lockfile 的 core、kms、storage、tools、dev groups。为完整应用和默认 Celery task imports 补充了 lockfile 中的 `cachetools==6.2.6`、`pymysql==1.1.2`、`pyarrow==23.0.1`；未修改项目依赖或 lockfile。未启用本次不使用、需要额外编译工具的 Chroma backend。

## 结果

| 测试 | 结果 | 覆盖 |
| --- | --- | --- |
| Portable delivery/binding + stale sync | 26 passed，0 failed/error/skipped | PostgreSQL/MySQL 的实际持久化、调用方回滚、绑定 ID 保留与替换、并发冲突、stale revision 和 worker 终止语义 |
| Inner HTTP + deployment key + concurrency | 7 passed，0 failed/error/skipped | 17 个操作、真实 loopback HTTP、认证、CAS、默认绑定、Redis lease、Celery dispatch/worker、数据库读写及密钥恢复 |

HTTP 场景使用真实 Flask 应用、Service、Repository、文件 Storage、PostgreSQL 和 Redis/Celery。仅 Feishu adapter 的外部 credential-test 与 directory 响应使用受控数据；没有发送真实 IM 消息，也不将本结果表述为 live Feishu 平台联调。

部署密钥测试使用真实 Redis 分布式锁并发初始化，验证同一 key 的复用、外部 material 已创建但 reference 未提交时的恢复，以及 material 丢失后拒绝重新生成。同步通过真实 Redis 队列执行既有 Celery task，再通过 HTTP latest/results 读取结果，并验证复用 run 保留原 EE 发起人。

集成运行发现已有 stale-sync fixture 未创建 Account 查询所需的 `accounts` 表；已在 fixture 的 schema 列表补齐，并在两种数据库上重新通过全部用例。

## box 到 Azure Key Vault

另使用 box 的真实 Azure SDK、PostgreSQL reference 和 Redis lease 执行部署级 Service 初始化/构造。验证 reference 持久化、重复初始化不增加 version、随机化加密、加解密往返、轮换后旧版本解密和篡改拒绝，全部通过。该项为独立 live 验证，不计入上述 33 个 pytest case。

Azure 认证边界注入了短期、限定 Vault audience 的 TokenCredential，token 只通过 SSH stdin 传入进程，没有写入 box 文件。本项不验证部署平台的 managed identity 自动发现。临时 key 已软删除、临时 Vault Crypto Officer assignment 已撤回，未创建持久应用密码。证据为 `azure-live.json` 和本机 `azure-role-cleanup.json`。

## 命令与证据

在独立测试环境变量已设置、隔离数据库已准备后，从源码根目录执行：

```bash
uv run --project api --active --no-sync flask db upgrade --directory api/migrations
uv run --project api --active --no-sync pytest --no-cov -q \
  api/tests/integration_tests/repositories/human_input_v2/test_portable_delivery_binding_writes.py \
  api/tests/integration_tests/repositories/human_input_v2/test_stale_im_sync_runs.py
uv run --project api --active --no-sync pytest \
  -p tests.e2e_tests.middleware.conftest --no-cov -q \
  api/tests/integration_tests/controllers/inner_api/test_human_input_v2.py \
  api/tests/integration_tests/repositories/human_input_v2/test_im_control_plane_concurrency.py
```

HTTP 测试要求显式设置 `HITL_INNER_TEST_ENVIRONMENT`，确认使用可清理的独立数据库。Portable suites 通过 `HITL_WRITE_TEST_{POSTGRESQL,MYSQL}_URL` 和 `HITL_SYNC_TEST_{POSTGRESQL,MYSQL}_URL` 选择各自隔离数据库。

box 的 `reports/` 保留 `portable.xml`、`inner-postgres.xml`、`migration.log`、`summary.json` 和 `source-verification.json`。对应证据已取回本机 `/tmp/hitl-ee-inner-api-box-20261111-reports/`。

## 清理

测试完成后，已按任务 label 核对并移除本次创建的三个数据库/Redis 容器及其匿名数据卷。loopback HTTP server 和测试 Celery worker 已结束。保留独立源码、Python 环境和报告，便于核对与复现；复现时需重新准备隔离中间件并更新连接配置。

## Contact Directory 重构后的验证状态（2026-11-12）

Organization Directory 查询与默认绑定命令已合入 `ContactManagementService`，与 Workspace Directory 查询共用绑定及详情组装。此次本地回归共 2510 项通过，覆盖 Human Input V2 core、repositories、services、Inner HTTP、Console Contact 与 Console sync；Ruff、Pyrefly 与 89 条 import contracts 通过。

SSH 恢复后，已在新的独立目录 `/home/qg/workspace/hitl-ee-inner-api-20261112` 完成本次重构的 box 回归。源码为同一 Git HEAD 加当前未提交修改；5226 个文件的 SHA-256 与本地工作区完全一致，manifest SHA-256 为 `da627b534eb86ceefd5c9e019d69cebb0c6216ade0e2f735544af0a361559a01`。运行时确认 `ContactManagementService` 加载自新目录。

复用 Python 3.13.5 / uv 0.8.9 环境，重新创建本次专用、仅绑定 loopback 的 PostgreSQL 15、MySQL 8.0 与 Redis 6 容器。全新 PostgreSQL 数据库完成全部 migration，实际 revision 为 `a84d72e9c61f`。执行命令与上节相同，并分别生成 JUnit 报告。

| 测试 | 结果 | 耗时 |
| --- | --- | --- |
| PostgreSQL/MySQL portable delivery/binding + stale sync | 26 passed，0 failed/error/skipped | 42.558 秒 |
| Inner HTTP + deployment key + concurrency | 7 passed，0 failed/error/skipped | 21.372 秒 |

本次 33 项测试验证当前统一 Contact Service 的部署级 Contact 读写、并发默认绑定替换，以及真实 HTTP → Redis → Celery → PostgreSQL 同步链路；同时覆盖 PostgreSQL/MySQL 的绑定替换、调用方回滚与 stale-run 行为。外部 IM provider 仍使用受控响应。本次使用 local deployment key backend；Azure live 验证记录仍对应 2026-11-11。

本次三个容器及其匿名数据卷已按任务 label 核对并删除，无残留。保留独立源码、配置、Python 环境引用及报告；再次运行需要重新准备中间件。box 的 `reports/` 和本机 `/tmp/hitl-ee-inner-api-box-20261112-reports/` 均保留 JUnit、日志、`summary.json`、`source-verification.json` 与 `cleanup.json`。

## 后续统一 ContactRepository 的验证

同日后续修改将 Organization / Workspace Directory 查询和 Platform entry 操作统一到 `ContactRepository`，并移除拆分的 Contact ports、可选 Organization 查询注入及重复 candidate persistence 类型/查询。Organization Directory 保持 CE / EE / SaaS 通用语义。

此后 237 项定向测试和 2502 项 HITLv2 本地回归通过，Ruff、Pyrefly、89 条 import contracts 与两份相关 OpenSpec change 的严格校验通过。本轮未重跑 box；上文的 manifest 和 33 项集成结果只对应统一 Repository 之前的源码快照。
