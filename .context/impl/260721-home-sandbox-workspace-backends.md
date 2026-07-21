# Home、Workspace、Sandbox 与 Runtime Backend 重构实现报告

## 状态

已完成。实现基于 `.context/proposals/260720-home-sandbox-workspace-backends.md`，并按照讨论中最终确认的边界落地：Dify API 持久化业务状态，Dify Agent 保持无数据库的轻量执行服务；Home Snapshot、Workspace、Sandbox、Shell 分层；Local、Enterprise、E2B 通过统一 Runtime Backend Profile 接入。

E2B 验证栈当前仍在运行，Compose project 为 `dify-e2b-a35c`，使用当前分支构建 API 和 Dify Agent 镜像，禁用了 Local sandbox，并保留独立的新 PostgreSQL volume。

## 1. 最终结果

- `workspace_id == runtime_session_id == AgentRuntimeSession.id`。
- `snapshot_ref` 由 Dify API 保存到 `AgentConfigSnapshot.home_snapshot_ref`；具体后端资源映射由对应 backend driver 解释。
- runtime session 的 backend handle 由 Dify API 随 session snapshot 持久化；Dify Agent 不保存跨请求状态，也不连接数据库。
- Home Snapshot 是不可变资源，在 agent config 发布路径创建；执行请求只消费已经持久化的 `snapshot_ref`。
- Sandbox 是一次 runtime session 的执行容器；Workspace 是该 session 的可变文件视图；Shell 只负责命令执行，不拥有 Home、Workspace 或 Sandbox 生命周期。
- Workspace 文件浏览在请求结束后通过持久化的 session locator 访问当前最新 Workspace，不依赖仍存活的执行请求。
- Local、Enterprise、E2B 都复用 shellctl 数据面，但 shellctl 不再承担 backend 资源身份与生命周期语义。
- 第一阶段不实现 workspace volume 独立后端，不实现 age TTL、reconciler 或复杂资源回收。

## 2. 服务与状态边界

### Dify API

Dify API 是持久状态和产品语义的 owner：

- 保存 agent config 与不可变 Home Snapshot ref。
- 分配 runtime session ID，并将其同时作为 workspace ID。
- 保存 session 与具体 backend handle 的映射。
- 在配置发布、session 执行、Workspace 文件访问和显式 cleanup 时调用 Dify Agent。
- 继续复用已有 Workspace service 和文件上传产品流程。

### Dify Agent

Dify Agent 是无数据库、可水平扩展的资源操作与执行服务：

- 根据 Runtime Backend Profile 选择 Local、Enterprise 或 E2B driver。
- 创建、恢复、暂停、删除 Sandbox。
- 创建、删除 Home Snapshot。
- 从 backend lease 暴露 Shell 和 Workspace 文件 capability。
- 为单次请求组装 Layer graph，结束后释放 lease，不保存业务状态。

这里的“无状态”指没有必须跨请求保留的本地业务记录；真实外部资源仍由 backend 存在，而其可恢复 locator 由 Dify API 持久化。

## 3. Layer 边界

### Home Layer

Home Layer 只接收不可变 `snapshot_ref`，由 backend 将 snapshot 挂载或恢复为 runtime home。Home source 只包含执行所需的 canonical 文件：`.dify/agent-home.json`、配置文件和 skill ZIP，不包含环境变量、模型凭证或完整 Soul。

### Sandbox Layer

Sandbox Layer 管理一次 session 的 sandbox handle 和 lease。新 session 创建 Sandbox；已有 session 恢复 Sandbox；cleanup 直接按持久化 handle 删除资源，不需要先恢复或构建 compositor。

### Workspace Layer

Workspace Layer 暴露 canonical `workspace_dir`，也是 `temp_dir`；没有第三个目录配置。文件 list/read/upload 使用 session 的四层 locator 解析到 backend Workspace capability。

### Shell Layer

Shell Layer 只消费 command、files 和路径布局，只管理 request-local shell job。它不认识 workspace ID、snapshot ref、sandbox handle，不创建、恢复、暂停或删除 Sandbox，也不负责文件上传。

原有 shell provider/factory 中混合的 Enterprise 资源逻辑已迁出；共享的 ShellctlClient 保留为数据面适配器，并修复注入 `httpx.AsyncClient` 时的所有权和 exactly-once close 语义。

## 4. Runtime Backend 设计

新增 `dify_agent.runtime_backend`，核心由以下对象组成：

- `RuntimeBackendProfile`：根据配置组合 HomeSnapshotDriver、SandboxDriver 和数据面 factory。
- `HomeSnapshotDriver`：创建和删除不可变 Home Snapshot。
- `SandboxDriver`：创建、恢复、暂停和删除 Sandbox，并返回稳定、非 secret 的 handle。
- `SandboxLease`：一次请求内持有 Shell 与 Files capability；所有正常、异常和取消路径都会释放。
- typed backend errors：统一区分 resource not found、lost、invalid handle 和 backend failure，HTTP 层不再依赖字符串匹配。

三个 profile 的映射：

| Backend | Home Snapshot | Sandbox / Workspace | Shell / Files 数据面 |
| --- | --- | --- | --- |
| Local | 本地不可变目录 | 独立 local sandbox session | shellctl |
| Enterprise | Enterprise gateway 管理的资源 | Enterprise sandbox session | shellctl |
| E2B | E2B template snapshot | E2B sandbox，pause 后保留 Workspace | template 内 shellctl |

Local root 已迁移到 `/home/dify/.dify-agent-*`，满足默认 Landlock path isolation。Enterprise resume 会探测 canonical workspace。E2B create/resume/Home builder 的取消路径会回收已经创建但尚未交付的资源。

## 5. Home Snapshot 生命周期

Home Snapshot 创建已从 runtime request 移到 agent config 发布路径：

1. Dify API 生成 canonical Home source。
2. 调用 Dify Agent Home Snapshot service 创建不可变资源。
3. 将返回的 `snapshot_ref` 与 config snapshot 一起持久化。
4. runtime request 只携带该 ref，不重新构建 Home。

新增 `AgentConfigSnapshot.home_snapshot_ref` 及 Alembic revision `bcd96196b7cd`。旧 snapshot cleanup 由 best-effort task 执行一次；按最终范围约束，没有加入 publication rollback compensation、重试状态机、age TTL 或 eventual cleanup 保证。

显式 cleanup 仍覆盖主要正常路径；进程崩溃或外部 backend 故障窗口可能留下资源，需要当前阶段的人工运维处理。

## 6. Runtime Session 与 Workspace 生命周期

- 首次执行创建新的 UUID session row；该 ID 同时是 runtime session ID 与 workspace ID。
- 后续执行使用 Dify API 持久化的 backend handle 恢复同一 Sandbox，并看到同一 Workspace 的最新内容。
- cleanup 后的 session 不复用：再次执行会创建新 UUID 和新资源，旧 cleanup 仍只指向旧 handle。
- 执行结束可以 pause backend，但 Workspace 文件 API 仍可按 session locator 恢复并读取当前最新 Workspace。
- cleanup 请求不构建 Layer graph，不 resume Sandbox，直接调用 driver delete。

没有加入“一个 Workspace 只能有一个 runtime writer”或文件浏览与执行互斥规则；并发语义保持 backend 当前能力，不在此重构中额外序列化。

## 7. Workspace 文件访问与安全

已有 Dify API Workspace service 和对外路由继续作为产品入口。Dify Agent 的 list/read/upload 都通过 Sandbox lease 的 Files capability，不经过 Shell job。

上传采用 control-plane 流程：

1. Dify Agent 通过 Files capability 安全读取 Workspace 中的源文件字节。
2. 复用现有 Agent Stub server-side 上传处理。
3. 不要求修改 sandbox CLI，也不把上传职责塞回 shellctl 或 Shell Layer。

路径访问使用 dirfd 和 `O_NOFOLLOW` 做 containment，拒绝绝对路径、目录逃逸和 symlink 穿透。list/read/read-bytes 都有边界检查。上传大小默认限制为 50 MiB，超限稳定返回 `413 file_too_large`。

Docker 使用 `PLUGIN_MAX_FILE_SIZE` 映射 `DIFY_AGENT_SANDBOX_FILE_UPLOAD_MAX_BYTES`；standalone 部署也可直接设置 bytes 配置。

## 8. 配置与部署

新增 E2B 配置：

- `DIFY_AGENT_RUNTIME_BACKEND=e2b`
- `DIFY_AGENT_E2B_API_KEY`
- `DIFY_AGENT_E2B_TEMPLATE=difys-default-team/dify-agent-local-sandbox`
- `DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS=3600`
- `DIFY_AGENT_E2B_SHELLCTL_PORT=5004`
- 可选 `DIFY_AGENT_E2B_SHELLCTL_AUTH_TOKEN`

`DIFY_AGENT_E2B_ACTIVE_TIMEOUT_SECONDS` 只限制连续 active 时间：runtime Sandbox 超时会 pause，临时 Home builder 超时会 kill；它不是资源保留 TTL。

新增 `docker/docker-compose.e2b.yaml`：

- API 与 Dify Agent 从当前 checkout 构建本地镜像。
- 将 agent backend 切换为 E2B。
- 禁用默认 Local sandbox service。
- 使用独立 `dify_e2b_postgres_data` PostgreSQL volume。
- 保持原有 `docker/.env` 不变，只从 shell 注入 E2B secret。

生成的 `docker/docker-compose.yaml` 已通过仓库生成工具从 template 更新，没有手工修改生成文件。

## 9. 失败与资源释放语义

- backend missing/lost 使用结构化错误，HTTP 层返回稳定 404，而不是解析异常文本。
- live Sandbox lease 在成功、driver error、hook error 和 cancellation 路径都会释放。
- Local/E2B 在 create/resume 取消时清理未交付资源。
- Shell control job 删除是 best-effort；失败记录 warning，不覆盖主请求结果。
- Home build 未完成而请求取消时，临时 builder 会被终止。
- 显式 session cleanup 与 Home Snapshot cleanup 是当前主要回收机制。

按照最终范围，没有实现后台持久进程、Dify Agent 数据库、资源回收 reconciler、Celery retry/state machine 或基于年龄的 TTL。

## 10. 测试与验证结果

### 自动化

- Dify Agent 完整测试：`734 passed, 26 skipped`。
- Dify Agent Ruff：通过。
- 变更范围 basedpyright：0 errors。
- Dify API 相关较宽单测集：`174 passed`。
- Dify API lifecycle/session 聚焦测试：最高覆盖集 `255 passed`。
- MkDocs strict build：通过。
- 文档示例测试：`2 passed, 23 skipped`。
- `git diff --check`：通过。

### Backend integration

- Local 真实 sandbox/Landlock integration：`1 passed, 2 deselected`。
- Enterprise driver 通过真实 `EnterpriseGatewayClient`、`ShellctlClient` 与 HTTP transport contract integration。
- E2B 真实 integration：`1 passed, 2 deselected`。

### E2B 真实端到端验证

使用更新后的 `difys-default-team/dify-agent-local-sandbox` template 验证了：

- shellctl 在 5004 启动并能执行真实 job。
- Home Snapshot create/delete。
- Sandbox create/pause/resume/delete。
- Workspace list/read/write 与 pause/resume 后持久化。
- control-plane upload 与下载内容逐字节一致。
- cleanup 直接 DELETE，不触发 resume。
- missing/lost resource 返回 typed 404。
- 验证过程中创建的 E2B 临时资源全部清理。

### Compose 部署验证

project `dify-e2b-a35c` 当前状态：

- `api` healthy。
- `db_postgres` healthy，使用独立新 volume。
- `redis` healthy。
- `plugin_daemon` running。
- `agent_backend` running，镜像来自当前 worktree。
- `local_sandbox` 未运行。

## 11. 已知基线问题

- 仓库默认 `make test` 存在已有的重复 test module basename collection mismatch；使用 importlib collection 的完整 Dify Agent suite 已通过。
- 全仓 `make typecheck` 仍有 72 个已有或本范围外错误，主要来自生成的 gRPC、可选 `grpclib` 和 examples；本次触及文件的 targeted basedpyright 已通过。
- 第一阶段接受 backend 资源在进程崩溃等故障窗口内泄漏的可能性；暂不承诺自动最终回收。

## 12. 关键实现位置

- Runtime backend：`dify-agent/src/dify_agent/runtime_backend/`
- Home Layer：`dify-agent/src/dify_agent/layers/home/`
- Workspace Layer：`dify-agent/src/dify_agent/layers/workspace/`
- Sandbox Layer：`dify-agent/src/dify_agent/layers/sandbox/`
- Home Snapshot API：`dify-agent/src/dify_agent/server/home_snapshots.py`
- Workspace 文件 API：`dify-agent/src/dify_agent/server/sandbox_files.py`
- Dify API Home orchestration：`api/services/agent/home_snapshot_service.py`
- Session/file product service：`api/services/agent_app_sandbox_service.py`
- 数据迁移：`api/migrations/versions/2026_07_20_1448-bcd96196b7cd_add_home_snapshot_ref_to_agent_config_.py`
- E2B Compose overlay：`docker/docker-compose.e2b.yaml`
- 运行资源文档：`dify-agent/docs/dify-agent/concepts/runtime-resources/index.md`
- E2B 部署操作文档：`dify-agent/docs/dify-agent/guide/index.md`

## 13. 最终验收判断

proposal 的核心目标已经达成：Home Snapshot、Workspace、Sandbox 不再混入 Shell Layer；backend-specific coupling 被收敛到 Runtime Backend Profile/driver；Dify Agent 保持轻量无数据库；Dify API 保存可恢复映射；Local、Enterprise、E2B 均有实现与测试；E2B 已用更新后的真实 template 和当前分支 Compose 部署跑通。

刻意未做的范围只有讨论中明确推迟的独立 Workspace backend、age TTL 和复杂资源回收机制。
