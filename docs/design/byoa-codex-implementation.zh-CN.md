# Bring Your Own Agent（BYOA）：Dify 远程调用本地 Codex 的设计与实现

<callout emoji="✅" background-color="light-green" border-color="green">
  <p><b>结论：</b>BYOA 已在本地 Dify 端到端跑通。Dify 只保存并调用公网 HTTPS A2A 地址；当前默认的 Cloudflare Quick Tunnel 路径使用 <code>POST /message:send</code> 与 <code>tasks/get</code> 轮询，请求经 outbound tunnel 到达用户机器上的 Codex Bridge，再由 Bridge 驱动本地 Codex CLI 和指定仓库。Dify 的持久化配置中没有 localhost 地址；关闭 Tunnel 后 Check connection 返回 502。严格的“Tunnel-down Workflow negative E2E”仍列为待补自动化用例。</p>
</callout>

| 文档属性 | 内容 |
| --- | --- |
| 状态 | 开发验证完成；生产化方案待实现 |
| 最后验证 | 2026-08-08 |
| 适用范围 | Dify Agent Roster、Workflow Agent 节点、A2A External Agent、Codex Bridge |
| 当前定位 | 公网分离架构模拟，不是生产可用的多租户 Connector |
| 核心协议 | 面向 A2A 1.0 的 HTTP+JSON 最小互操作 Profile；支持同步 Task、轮询与 SSE 流式结果 |

## 1. 为什么做 BYOA

BYOA（Bring Your Own Agent）的目标，是让用户把已经运行在自己环境中的 Agent 接入 Dify，而不是把 Agent 代码、模型凭据和本地工作目录上传到 Dify。Dify 负责 Agent 的登记、发现、版本固定、Workflow 编排和运行观测；用户环境负责实际执行、文件访问和 Agent 运行策略。

这项能力被建模为 **External Agent Connection**，而不是新的模型供应商、Tool、Plugin 或独立 Workflow 节点。这样可以继续复用 Agent Roster 作为所有 Agent 的统一入口，也可以继续复用已有 Agent 节点作为编排表面。

### 1.1 设计目标

- 用户可以在 Agent Roster 中连接一个符合 A2A 协议的外部 Agent。
- 外部 Agent 可以像原生 Agent 一样被 Workflow Agent 节点选择和调用。
- Dify 不复制、不托管、不直接执行用户的 Agent 代码。
- Endpoint、凭据和 Agent Card 被版本化；已发布 Workflow 不会意外混用新旧配置。
- 远程 Dify 能通过公网安全地驱动用户本地的 Codex，同时保持本地工作目录和执行策略由用户控制。
- 调用链可证明、可观测、失败时不静默回退到同机 localhost。

### 1.2 当前非目标

- 在 Dify 中上传并执行任意第三方 Agent 源码。
- 由 Dify 托管用户机器、Codex 登录态或本地仓库。
- 第一版支持 OAuth、mTLS、私网组网、计费、弹性调度和多租户 Connector 托管。
- 第一版支持 A2A Push Notification、Data/File 输入、Human Input、跨 Agent 共享文件系统。
- 把 External Agent 直接发布成一个独立 Dify Web App/API；当前入口是 Workflow Agent 节点。

| 方向 | Text Part | Data Part | URL/File Part |
| --- | --- | --- | --- |
| Dify → External Agent 输入 | 支持，Instruction 与变量渲染为单个文本 Prompt | 当前不支持 | 当前不支持 |
| External Agent → Workflow 输出 | 支持 | 支持 Mapping；按出现顺序浅合并 | URL Part 映射为 `files`；内联文件上传未实现 |

---

## 2. 产品交互

### 2.1 连接 External Agent

用户从 **Studio → Agents → Create agent → Connect external agent** 进入连接流程：

1. 输入 A2A Endpoint。
2. 选择 `No authentication` 或 `Bearer token`。
3. 点击 **Check connection**；Dify 获取并校验 Agent Card。
4. 预览远端 Agent 的名称、描述、协议版本、Streaming 能力和 Skills。
5. 用户可修改 Dify 内展示的名称、描述、角色和图标。
6. 点击 **Connect agent**；Agent 进入 Roster，并显示 `External` 标识。

发现与创建被拆成两步，是为了避免远端 Endpoint 在用户未确认的情况下，直接决定工作区中展示的身份和能力。

### 2.2 管理连接

External Agent 的详情页不打开原生 Agent Composer，而是展示连接信息：

- Endpoint 和认证方式；Bearer Token 永不回显。
- 最近验证时间和固定的 Agent Card。
- **Test connection** 和 **Edit connection**。
- 编辑时 Token 留空代表保留原 Token；Endpoint origin 改变时必须重新输入 Token。
- 保存使用 active snapshot ID 做 Compare-and-Swap。若其他管理员先发布了更新，旧页面保存会收到 `409`，避免覆盖新配置。

### 2.3 在 Workflow 中使用

原有 Agent 节点选择器会展示带有 `External` 标签的 Roster Agent。用户仍然配置节点 Instruction、输入变量和输出，不需要学习新的节点类型。

运行时，Dify 将 Instruction 和变量渲染为文本 Prompt，调用固定快照中的 A2A Interface，并把 Artifact 映射为节点输出：

| A2A Part | Workflow 输出 |
| --- | --- |
| Text Part | `text` |
| Data Part | 声明的结构化输出，或 `json` |
| URL/File Part | `files` |

输出归并是确定性的：Artifact 按首次出现顺序处理；同一 Artifact 的 `append=true` 追加 Parts，否则以新值替换；Text 按顺序无分隔符拼接；Data Mapping 按顺序浅合并且后值覆盖同名 Key；若最终 Text 本身是 JSON Object，则先解析，再由 Data Part 覆盖；URL Part 保持顺序映射为远程文件。

External Agent 运行不会初始化 Dify Agent 的模型、工具、Memory、Workspace 或 Human Input Session。自动输出校验重试被关闭，因为重放一个远端编码任务可能重复文件写入等副作用；用户仍可在检查结果后显式重试节点。

---

## 3. 当前端到端部署模型

当前测试在同一台开发机上启动 Dify 与 Codex，但 Dify 只使用公网域名访问 Bridge，以模拟两者位于不同机器和网络的真实场景。

**图 1｜UML Deployment Diagram：公网分离验证拓扑**

<whiteboard type="blank"></whiteboard>

### 3.1 真实调用路径

```text
Dify Web
  → Dify API / Celery Worker
  → 公网 HTTPS A2A Endpoint
  → Cloudflare Quick Tunnel TLS 终止与 Outbound Tunnel
  → 127.0.0.1:8765 Codex A2A Bridge
  → codex exec --json / codex exec resume
  → 用户指定的本地 Repository
```

Dify 端保存的 Endpoint、Agent Card `supportedInterfaces[0].url` 和实际 Workflow 请求使用同一个公网 origin。Dify 的 same-origin 校验保证远端卡片不能把 Bearer Credential 引导到另一个域名，也让“没有 localhost fallback”成为可验证的系统不变量。

### 3.2 组件职责

**图 2｜UML Component Diagram：模块边界与依赖**

<whiteboard type="blank"></whiteboard>

| 组件 | 核心职责 | 明确不负责 |
| --- | --- | --- |
| Agent Roster UI | 连接、预览、创建、测试、编辑 External Agent | 执行 Codex |
| External Agent Service | 校验连接、加密存储、快照发布、CAS 更新 | 持有长连接或本地进程 |
| A2A Runtime Gateway | SSRF 控制、认证 Header、协议调用、SSE 解析、输出映射 | 选择本地目录、模型或 Codex Thread |
| Public Tunnel Launcher | 创建公网地址、轮换 Token、启动并监督 Tunnel/Bridge | 提供生产 SLA |
| Codex A2A Bridge | A2A Task 与 Codex Turn 适配、并发/沙箱策略、取消 | 多租户托管和持久化任务 |
| Codex CLI | 执行 Agent 推理与本地仓库操作 | 接受来自 A2A 请求的任意 cwd/可执行文件设置 |

Bridge 而不是 Dify，拥有以下 operator-owned policy：Codex 可执行文件、Workspace Root、模型、Reasoning Effort、Sandbox、最大并发数和 Codex 登录态。A2A 请求不能覆盖这些配置，也不能指定任意 Codex Thread。

---

## 4. 数据模型与版本固定

External Agent 继续复用现有 app-backed Roster Identity 和 `AgentConfigSnapshot` 指针。两个 sidecar 记录承载外部连接专属状态。

**图 3｜UML Class Diagram：External Agent 持久化关系**

<whiteboard type="blank"></whiteboard>

### 4.1 核心实体

| 实体 | 主要字段 | 语义 |
| --- | --- | --- |
| Agent / App | `agent_id`、tenant owner | Roster 中统一身份 |
| AgentConfigSnapshot | immutable native snapshot | Workflow 固定版本的入口 |
| ExternalAgentConnection | endpoint、auth type、encrypted token、endpoint hash、verified at | 可版本化连接材料 |
| ExternalAgentConfigSnapshot | encrypted Agent Card、card hash、protocol、remote ID、connection ID | 与 native snapshot 一一关联的外部配置 |

### 4.2 发布规则

- Endpoint、Credential 或 Agent Card 变化时，新建 Connection 和 External Snapshot，而不是原地修改旧记录。
- 每次新的 Workflow Run 会先把 Roster Agent 的当前 `active_config_snapshot_id` 解析为执行代次，并在该次执行内固定 native snapshot、Agent Card 和 Credential；重试或恢复同一代次不会中途漂移。
- CAS 更新成功后只原子切换 Agent 的 active pointer：之后启动的 Draft/Published Workflow Run 自动使用新版本，无需重新选择节点或重新发布 Workflow；已经在运行的代次继续使用旧版本。若旧 Tunnel 已失效，旧代次会失败，需在连接更新后重新运行。
- 更新请求携带编辑页面最初加载的 active snapshot ID；服务端只在其仍为当前版本时发布。
- 所有读取都绑定 tenant、agent、native snapshot、external snapshot 和 connection owner chain。
- 远端网络 I/O 在数据库事务之外执行，避免网络延迟占用事务。

<callout emoji="⚠️" background-color="light-yellow" border-color="yellow">
  <p><b>当前数据完整性限制：</b>两张外部表的 owner chain 主要由 Service Join 保证，数据库层尚未建立足够的复合外键和 auth/token CHECK。正常写路径会拒绝错误状态，但生产化前应补数据库约束或明确 application-only invariant，并补 MySQL DDL 中途失败的恢复 Runbook。</p>
</callout>

### 4.3 Console API

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/console/api/agent/external/discover` | 校验 Endpoint 并预览 Agent Card，不写数据库 |
| `POST` | `/console/api/agent/external` | 创建 app-backed External Roster Agent |
| `GET` | `/console/api/agent/{agent_id}/external` | 读取不含 Secret 的连接详情 |
| `PUT` | `/console/api/agent/{agent_id}/external` | CAS 更新并发布新快照 |
| `POST` | `/console/api/agent/{agent_id}/external/test` | 使用当前连接重新验证 |

---

## 5. A2A 协议契约

第一版实现一个面向 A2A 1.0 HTTP+JSON 的最小互操作 Profile，而不是宣称已经通过完整 Conformance：

- Agent Card：`GET /.well-known/agent-card.json`
- 同步发送：`POST /message:send`
- 流式发送：`POST /message:stream`，响应为 SSE
- Task 查询：`GET /tasks/{task_id}`
- Task 订阅：当前实现为 `GET /tasks/{task_id}:subscribe`
- Task 取消：`POST /tasks/{task_id}:cancel`

Dify 发送 `A2A-Version: 1.0`、`Content-Type: application/a2a+json`，不跟随 Redirect，并限制 Agent Card、JSON、错误响应、单个 SSE Event、SSE 总体积和 Event 数量。SSE 拒绝压缩编码，避免解压后绕过体积上限；Header 等待和流读取均被 wall-clock deadline 与 Workflow Stop 检查控制。

### 5.1 连接发现与发布时序

**图 4｜UML Sequence Diagram：Discover → Review → Publish**

<whiteboard type="blank"></whiteboard>

### 5.2 Workflow 执行时序

**图 5｜UML Sequence Diagram：Workflow → A2A Task → Codex**

<whiteboard type="blank"></whiteboard>

运行时按 Agent Card 能力选择传输：支持 Streaming 时使用 `message:stream`；当前 Cloudflare Quick Tunnel Bridge 声明 `streaming=false`，因此使用 `message:send`，若返回非终态 Task 则通过 `tasks/get` 轮询到终态。

### 5.3 Context、Task 与 Codex Thread

- Dify 以 `tenant_id | workflow_run_id | node_id | node_execution_id` 为 seed 生成 UUIDv5 `contextId`；它只标识一次 Workflow 节点执行，不跨 Workflow Run 或不同节点共享。
- `messageId` 由 `contextId + SHA-256(rendered prompt)` 确定性生成，使同一节点执行的同一 Prompt 可被远端去重。
- Bridge 为每个 A2A Task 启动一次 Codex Turn。
- 同一个 `contextId` 的后续消息，只能 resume 该 Bridge 进程自己观察到的 Codex Thread。
- 不同 Prompt 或不同节点执行使用不同 `messageId`；已经结束的 `taskId` 不是 Thread Selector。
- Context→Thread Mapping 当前仅存在 Bridge 内存中：Bridge 重启即失效；没有 TTL、跨进程恢复或跨 Workflow 长期会话语义。
- Bridge 对外仅返回 Agent Message、Thread ID 和数值 Usage；不会返回 stderr、Shell Command Payload、文件内容或 Credential。

### 5.4 External Agent 连接状态

**图 6｜UML State Diagram：连接与快照生命周期**

<whiteboard type="blank"></whiteboard>

### 5.5 A2A Task 与 Supervisor 状态

**图 7｜UML State Diagram：Task 执行、取消与 Bridge/Tunnel 联动**

<whiteboard type="blank"></whiteboard>

<callout emoji="❗" background-color="light-yellow" border-color="yellow">
  <p><b>互操作说明：</b>当前 Dify Client 与 Codex Bridge 对 Task Subscribe 都使用 GET，因此二者可互通；最新官方 SDK 的严格实现可能要求 POST。生产发布前应统一到最终规范，并补 sub-path Agent Card、明确的 1.0 版本协商和严格 Content Negotiation 兼容测试。</p>
</callout>

| 操作 | 网络行为 | 是否写入/发布 |
| --- | --- | --- |
| Discover | 使用用户输入的 Endpoint/Auth 获取并校验实时 Agent Card | 不写数据库，只返回预览 |
| Connect / Edit + Save | 先在事务外 Discover，再创建 Connection、External Snapshot 和 native snapshot | 发布新 active version |
| Test connection | 用当前 active Connection 重新 Discover，返回实时 Card 与 latency | 只更新 `last_verified_at`，不会替换已固定 Card，也不会自动发布 drift |

Endpoint 当前必须是绝对 HTTP(S) URL，且不能带 Credential、Query 或 Fragment。若输入已经是完整 `/.well-known/agent-card.json` 则直接使用；否则当前实现会把该路径追加到配置 URL 后。标准 origin-root Card 与 sub-path Base URL 的兼容仍是已知缺口；Test 发现 Card 漂移也尚无自动告警。

---

## 6. Public Tunnel Launcher 与 Secret 生命周期

仓库根目录提供一行启动入口：

```bash
export DIFY_BYOA_CODEX_WORKSPACE_ROOT=/absolute/path/to/allowed/repository
./dev/start-byoa-codex-public
```

底层脚本为：

```text
dify-agent/examples/dify_agent/dify_agent_examples/
  codex_a2a_bridge/run_public_tunnel.sh
```

### 6.1 启动顺序

1. 校验 Workspace、端口、`uv`、`curl`、`codex`，以及 `cloudflared` 或 Docker。
2. 预检 `127.0.0.1:8765` 未被占用，避免发布错误的本地服务。
3. 生成 32-byte 随机 Bearer Token，并替换 macOS Keychain 当前项。
4. 启动 Cloudflare Quick Tunnel，取得临时 `trycloudflare.com` HTTPS URL；也可显式切换到兼容旧版的 `localhost.run` provider。
5. 将 Token 通过匿名 FD 9 交给 Bridge；Bridge 读取一次后立即关闭 FD。
6. Bridge 只绑定 loopback，并把公网 HTTPS origin 写入 Agent Card；Quick Tunnel 模式声明 `streaming=false`，让 Dify 使用 `message:send` 与 `tasks/get` 轮询。
7. Launcher 检查本地 Agent Card 后，打印 Endpoint 和 Sandbox。
8. Supervisor 同时监视 Bridge 和 Tunnel；任一退出时终止并回收另一方。

### 6.2 Token 不进入长生命周期进程环境

**图 8｜UML Sequence Diagram：Token 轮换与匿名 FD 传递**

<whiteboard type="blank"></whiteboard>

Launcher 只在短时局部变量中持有 Token；启动 Bridge 前从自己的 Environment 中删除。Bridge 从 `DIFY_BYOA_CODEX_API_TOKEN_FD` 指定的匿名管道读取一次，关闭 Descriptor，并在创建 Codex 子进程时显式剥离 Token 相关变量。实测 Launcher、Bridge 和 Codex 的初始 Process Environment 都不包含 Token。

Keychain Item 默认不预授权任何 Reader。操作者将当前 Token 填入 Dify 时，macOS 可能弹出访问确认；不应给无人值守进程授予永久读取权限。

### 6.3 Sandbox

- 公开 Launcher 默认 `read-only`。
- 只有在可信 Dify Account 和可信 Repository 上，才显式设置 `DIFY_BYOA_CODEX_SANDBOX=workspace-write`。
- Bridge 只接受 `read-only` 和 `workspace-write`，并固定 `approval_policy=never`。
- Workspace Root 启动时被解析和固定，A2A Payload 不能修改 cwd。

---

## 7. 安全模型与信任边界

**图 9｜Security Trust Boundary：Credential、Prompt 与 Repository**

<whiteboard type="blank"></whiteboard>

### 7.1 已实现控制

| 风险 | 当前控制 |
| --- | --- |
| SSRF / 私网探测 | BYOA 校验 URL 语法并关闭 Redirect；所有请求走 Dify SSRF Client，目标地址策略由部署时配置的 SSRF Proxy 执行 |
| Credential 被 Agent Card 转发 | Interface URL 必须与配置 Endpoint 同 origin |
| URL 注入 | 拒绝嵌入 Credential、Query、Fragment 和非法 Port |
| Token 泄漏 | Tenant Key 加密；Console API 只返回 `has_bearer_token`；错误 Body 不进入 Workflow Log |
| 响应放大 | Card/JSON/Error/SSE 单事件、总字节、事件数上限；SSE 只接受 identity encoding |
| 无响应导致不可取消 | Header 打开和 Stream Read 放入受控线程，按 deadline/stop 每 250ms 检查 |
| 任意本地执行 | 固定 binary、cwd、model、sandbox、concurrency；Prompt 走 stdin，不经 Shell |
| Tunnel/Bridge 半存活 | 双进程 Supervisor，任一退出即收敛为整体失败 |

### 7.2 不能被技术实现消除的边界

- 免费 Tunnel Provider 终止 TLS，因此在本次开发模拟中属于受信任中继；其运营方理论上可以看到 Bearer Header、Prompt 和 Result。不得通过免费 Relay 发送敏感仓库或 Prompt。
- Bridge 与 Codex 使用当前 macOS User 权限运行。同一 OS User 下的其他进程仍是根本信任边界；生产 Connector 应运行在隔离 User、Container 或 VM 中。
- Cancel 会终止活动 Process Group，但无法回滚取消前已经完成的文件修改或外部副作用。
- Generic Dify External Agent 配置当前仍能接受 HTTP Endpoint。远程 Bearer Endpoint 在生产化前必须强制 HTTPS；只允许显式、受控的 loopback/本地开发例外。
- BYOA Client 自身不独立实现 DNS Rebinding、解析后 IP Pinning、IPv6 和代理绕过策略；生产部署必须强制配置 SSRF Proxy，并用这些攻击面做回归测试。

---

## 8. 本地操作 Runbook

### 8.1 启动依赖

确认 Codex 已登录，并启动 Dify Web、API、Worker。Workflow 调试任务必须由监听 `workflow_based_app_execution` 的 Celery Worker 消费；仅监听 `workflow` 会导致 SSE 只有 ping、没有任何节点事件。

```bash
cd /absolute/path/to/dify
export DIFY_BYOA_CODEX_WORKSPACE_ROOT=/absolute/path/to/allowed/repository
./dev/start-byoa-codex-public
```

Launcher 输出类似：

```text
Public A2A endpoint: https://<ephemeral-host>.trycloudflare.com
Bridge origin: http://127.0.0.1:8765
Authentication: Bearer token from environment or Keychain
Tunnel provider: cloudflare-quick
A2A execution mode: blocking message:send (Quick Tunnel buffers SSE)
Codex sandbox: read-only
```

### 8.2 在 Dify 中更新 External Agent

每次重连都会轮换 Endpoint 和 Token，因此两者必须一起更新：

1. 打开 Agent Roster 中的 External Agent。
2. 进入 **Connection → Edit connection**。
3. Endpoint 填入 Launcher 打印的公网 HTTPS Origin。
4. Authentication 选择 Bearer。默认 Keychain Item 为 service `dify-byoa-public-bridge`、account `api-token`；可用下面命令把本次 Token 直接放入剪贴板，避免打印到终端：

   ```bash
   security find-generic-password \
     -s dify-byoa-public-bridge \
     -a api-token -w | pbcopy
   ```

   若设置过 `DIFY_BYOA_CODEX_KEYCHAIN_SERVICE` / `DIFY_BYOA_CODEX_KEYCHAIN_ACCOUNT`，改用对应值。
5. 点击 **Save and verify**。
6. 新启动的 Draft/Published Workflow Run 会自动解析新 active snapshot，无需重新选择节点或重新发布；旧的在途 Run 仍固定旧连接，应停止后重新运行。
7. 粘贴完成后用 `pbcopy </dev/null` 清空剪贴板。

<callout emoji="⚠️" background-color="light-red" border-color="red">
  <p>不要把 Token 粘贴到命令历史、文档、Issue 或聊天中。当前临时 Host 和 Token 只用于本次开发会话；重启 Launcher 后旧连接应自然失效。</p>
</callout>

### 8.3 停止

在 Launcher Terminal 按 `Ctrl-C`。Supervisor 会关闭 Bridge 与 Tunnel。若 Tunnel 异常退出，Bridge 也会自动停止，避免端口仍健康但公网路径已失效的误导状态。

### 8.4 常见故障

| 现象 | 最可能原因 | 检查/处理 |
| --- | --- | --- |
| Dify 页面打不开 | Web/API 服务停止 | 检查本地端口和服务 Terminal |
| Workflow SSE 一直只有 ping | Worker 未监听正确队列 | 监听 `workflow_based_app_execution` |
| Check connection 返回 401 | Token 未更新或 Auth 选错 | 同时更新当前 Endpoint 与 Token |
| Check connection 返回 502 | Tunnel 已断 | 重启 Launcher，再更新 Dify |
| Agent Card same-origin 校验失败 | Bridge 广告的 Public URL 与 Endpoint 不同 | 通过 Launcher 启动，不要手动混配 URL |
| 保存返回 409 | 页面加载后已有其他人发布新快照 | 刷新页面，基于新 active snapshot 重新编辑 |
| 公网 Endpoint 200，但运行失败 | Codex 登录、模型、Workspace 或 Worker 问题 | 看 Bridge 和 Worker Log，确认本地 Codex 能独立执行 |

---

## 9. 端到端验证证据

以下为 2026-08-08 验证快照；临时公网 URL 已脱敏且可能失效，不应作为长期配置。

| 证据 | 值 / 结果 |
| --- | --- |
| External Agent | `Local Codex Agent` |
| Agent ID | 本地数据库 UUID（未写入文档） |
| 验证时公网 Endpoint | `https://temporary-endpoint.example.com`（示意，实际临时地址未提交） |
| Dify 调用路径 | 持久化、加密的 External Agent Connection → `WorkflowExternalAgentRunner` |
| 最终输出 | `DIFY_RUNTIME_E2E_OK` |
| 公网网络证据 | `POST https://temporary-endpoint.example.com/message:send` → 200，随后 `tasks/get` 取得终态 |
| Codex Session | 本地 Codex rollout JSONL 已验证（具体用户路径未写入文档） |
| 执行耗时 | 约 17.4 秒 |

### 9.1 关键反证测试

- **认证：** 未携带 Token 的公网 `message:send` 返回 401。
- **Workflow 公网路径：** 成功 Run 明确通过临时公网 Endpoint 执行 `POST /message:send` 与 `tasks/get`；Dify snapshot 只包含公网 origin，本地 `127.0.0.1:8765` 只存在于 Launcher/Tunnel 配置中。
- **Tunnel-down 反证范围：** 保持本地 Bridge 200、只停止 Tunnel时，Dify Check connection 返回 502，恢复 Tunnel 后成功；严格的 Tunnel-down Workflow negative E2E 尚未自动化，不能把本项单独当作运行面反证。
- **Supervisor：** 主动停止 Tunnel，Launcher 会关闭 Bridge，本地端口随之关闭。
- **Secret Environment：** 检查 Launcher 与 Bridge 进程初始环境，均无 `DIFY_BYOA_CODEX_API_TOKEN`；Codex Child Environment 也显式剥离。
- **Agent Card：** 本地和公网 Card 都返回 200，Interface URL 与 Dify Endpoint 同 origin。

### 9.2 自动化验证

```bash
cd dify-agent
uv run pytest tests/local/examples/test_codex_a2a_bridge.py -q
uv run ruff check examples/dify_agent/dify_agent_examples/codex_a2a_bridge \
  tests/local/examples/test_codex_a2a_bridge.py
uv run basedpyright --level error \
  examples/dify_agent/dify_agent_examples/codex_a2a_bridge \
  tests/local/examples/test_codex_a2a_bridge.py
```

当前结果：Bridge 目标测试 `10 passed`，Ruff 通过，basedpyright `0 errors / 0 warnings`。上述命令只覆盖 Bridge 单元/集成测试；Roster UI、Console API、真实 Tunnel 和 Tunnel-down Workflow negative E2E 目前依赖手工验证，尚未纳入同一自动化套件。

---

## 10. 从开发 Tunnel 到生产 Connector/Relay

免费临时 Tunnel 适合证明网络边界和协议闭环，但不具备稳定域名、SLA、端到端保密、重连恢复和多租户控制。生产目标应改为 **Outbound Connector + Operator-controlled Relay**：本地 Connector 主动向 Relay 建立长连接，Dify 永远不需要直接入站访问用户机器。

**图 10｜UML Deployment Diagram：生产目标架构**

<whiteboard type="blank"></whiteboard>

### 10.1 推荐拓扑

```text
Remote Dify
  → Operator-controlled Relay（稳定域名、路由、限流、审计）
  ↔ Outbound Connector（用户机器主动连接、自动重连）
  → Local A2A Bridge / Agent Runtime
  → Codex CLI / Repository
```

### 10.2 生产必须补齐

| 优先级 | 能力 | 说明 |
| --- | --- | --- |
| P0 | 稳定身份与 mTLS | Connector 实例证书、Workspace/Agent Binding、双向认证、吊销与轮换 |
| P0 | Durable Task | Task、Event、Context、Process Ownership 持久化；进程重启后可恢复/判定 |
| P0 | 断线重连与幂等 | Relay Queue、Ack、Idempotency Key、重放保护、Cancel 语义 |
| P0 | OS/Runtime 隔离 | 独立 User/Container/VM、最小文件权限、Repository Allowlist |
| P1 | 多租户控制面 | Connector 注册、Agent 绑定、在线状态、版本、升级和撤销 |
| P1 | 安全与合规 | E2E Payload Encryption、Secret Rotation、Audit、Retention、Rate Limit |
| P1 | 可观测性 | Trace ID、Task Timeline、连接健康、队列积压、延迟和失败分类 |
| P1 | 协议兼容 | A2A Conformance Suite、POST Subscribe、版本协商、File/Data Part |
| P2 | 产品增强 | Rich Progress、Human Input、共享文件、长期 Session、Connector 自动更新 |

### 10.3 Relay 的最小信任原则

理想情况下，Relay 只看见路由 Metadata，不看见 Prompt、Result 和 Repository Content。Dify 与 Connector 之间使用端到端加密，Relay 只负责连接复用、排队、Backpressure 和交付确认。即使暂时由 Relay 终止 TLS，也必须是组织可控基础设施，并有明确的 Data Retention、Access Log 和 Incident Response 约束。

生产 Connector/Relay 至少需要下列 Wire Contract；当前代码尚未实现：

| 契约面 | 最小字段 / 规则 |
| --- | --- |
| 注册与路由 | `connector_id`、`tenant_id`、`agent_id`、Card hash/version；证书与 owner chain 绑定 |
| Task Envelope | `task_id`、`idempotency_key`、absolute deadline、encrypted payload、cancel generation |
| 交付语义 | Relay 持久化后 ACK；至少一次投递；Connector 去重；Event cursor 可断点续传；Terminal 仅一次 |
| 连接恢复 | Outbound mTLS、指数退避、session resume、租户级并发与 backpressure |
| 密钥生命周期 | Connector 长期身份密钥 + 会话密钥；轮换、吊销、丢机处置；Relay 不持有 Payload 解密钥 |
| Card 发布 | Connector 报告 live Card；Dify 显式 review/publish；drift 只告警，不静默改变运行版本 |

---

## 11. 当前限制与发布判断

<callout emoji="❗" background-color="light-yellow" border-color="yellow">
  <p><b>发布判断：</b>当前实现已经足以证明 BYOA 产品交互、Roster/Workflow 集成、A2A 协议闭环和“远程 Dify 驱动本地 Codex”的技术可行性；不应直接作为 SaaS 多租户生产能力发布。</p>
</callout>

- Bridge 的 Task、Event、Context→Thread Mapping 和 Process Handle 全部在内存中，重启即丢失。
- 公网 Host 和 Token 每次启动都会变化，Dify 必须人工更新。
- Tunnel Provider 位于数据明文信任边界内。
- Streaming 基于 Codex JSONL Item Event，不是 Token Delta。
- 只完整支持文本输入；File/Data Input、Push Notification 和 Durable Subscription 未实现。
- Cancel 是 best effort，不能回滚已经完成的外部副作用。
- External Agent Human Input、跨 Agent Workspace、计费和配额不在 MVP 中。
- Generic Dify Endpoint 对远程 Bearer HTTPS 的强制、数据库完整性约束和若干严格 A2A 互操作细节仍需收口。
- Test connection 能返回实时 Card，但不会把 Card drift 写入快照或告警。
- SSRF 地址策略依赖部署侧 Proxy；DNS Rebinding、IPv6 与代理绕过需要生产回归矩阵。
- Tunnel-down Workflow negative E2E、Roster/Console API E2E 和正式 A2A Conformance 尚未自动化。

---

## 12. 代码索引

| 领域 | 关键路径 |
| --- | --- |
| 产品设计 | `docs/design/byoa-codex-mvp.md` |
| Console API | `api/controllers/console/agent/external.py` |
| 连接/快照 Service | `api/services/agent/external_agent_service.py` |
| A2A Client | `api/clients/a2a/` |
| Workflow Runtime | `api/core/workflow/nodes/agent_v2/external_runtime.py` |
| Workflow Binding | `api/core/workflow/nodes/agent_v2/binding_resolver.py` |
| DB Migration | `api/migrations/versions/2026_08_06_1800-9b8c7d6e5f40_add_external_agent_connections.py` |
| Roster 连接 UI | `web/features/agent-v2/roster/components/connect-external-agent-dialog.tsx` |
| External Agent 详情 | `web/features/agent-v2/agent-detail/external-agent/` |
| Workflow Agent UI | `web/app/components/workflow/nodes/agent-v2/` |
| Codex Bridge | `dify-agent/examples/dify_agent/dify_agent_examples/codex_a2a_bridge/` |
| 一行 Launcher | `dev/start-byoa-codex-public` |
| Bridge Test | `dify-agent/tests/local/examples/test_codex_a2a_bridge.py` |

## 13. 外部参考

- [A2A Protocol Specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
- [A2A 官方 Python SDK](https://github.com/a2aproject/a2a-python)
- [Dify BYOA MVP 本地设计文档](https://github.com/langgenius/dify)（对应当前工作区未提交实现）
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)（免费临时域名仅用于开发网络分离模拟）
- [localhost.run Security](https://localhost.run/docs/security/)（可选兼容 provider；HTTP Tunnel 的 TLS 在 Provider 终止）
