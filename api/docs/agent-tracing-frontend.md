# Agent tracing 前端接入说明

更新日期：2026-10-15。面向 DIFY-2975 / DIFY-2983 / DIFY-2984 / DIFY-2985 的前端实现与联调。

本文依据本开发分支的 Console controller、生成的 OpenAPI / TypeScript 契约和运行服务编写。代码具备某项能力、部署已开启该能力、第三方账号已收到数据是三种不同结论；本文不作为 main 或 dev 已部署的证明。发布前需补全末尾的部署及端到端验收记录。

## 1. 接入位置与配置归属

| 场景 | 配置主体 | 配置入口 | 执行查询 |
| --- | --- | --- | --- |
| 独立 Agent App | Agent 对应的 App，由服务端解析 | Agent「监控」页，使用 `/agent/{agent_id}` | 按本轮 `message_id` 查询 |
| Workflow / Chatflow 中的 inline Agent | 本次调用所属 Workflow App | 复用 Workflow tracing 配置；节点展示继承关系 | 按 workflow run ID 查询，可选节点执行 ID |
| Workflow 引用独立 Agent | 本次调用所属 Workflow App | 同上，不读取被调用 Agent 的独立 tracing 凭据 | 同上 |
| inline Agent 单节点调试 | 调试所属 Workflow App | 同上，不为 hidden backing App 配置凭据 | `source_kind=node`，使用本次节点执行 ID |

配置按应用生效，不属于 Agent soul、workflow DSL 或某个发布版本。一个应用可保存多家 provider 的凭据，但只有一个当前选中的 provider。独立 Agent 自身被直接调用时使用自身配置；经 Workflow 调用时继承调用方配置。

新 managed 导出的范围是 Agent App，以及含 Agent V2 inline/reference 节点的 Workflow/Chatflow。没有 Agent V2 的普通 Workflow 保持原有 tracing 路径；不能因为共享配置接口出现 `capture_content` / `capture_agent` 字段，就声称这两个新策略已对 legacy 路径生效。

跨 Workflow 调用不承诺整条链路在第三方展开为同一棵树。Agent 调用子 Workflow 时仍可看到外层工具调用 span，但子 Workflow 内部节点不保证挂在它下面。外部 parent 或 managed 与 legacy 边界采用关联元数据/独立 linked root，界面和验收说明不要将它描述为已实现完整跨 Workflow 父子挂接。

前端不要用 Agent ID 冒充 App ID，不要暴露或自行寻址 inline Agent 的 hidden backing App。普通 `/apps` tracing 接口保留 `PlainApp` 权限边界，Agent 使用独立 `/agent` 接口。API 前缀是单数 `agent`，页面路由 `/agents/...` 不能用作 API 路径。

## 2. Base URL、鉴权与生成契约

所有下述相对路径均挂在 Console API Base URL 后：

```text
{CONSOLE_API_ORIGIN}/console/api
```

浏览器实际地址以 `@/config` 的 `API_PREFIX` 为准，由 `NEXT_PUBLIC_API_PREFIX` / 运行时配置决定。若 dev 将 Console API 反向代理到页面同源，则例如：

```text
https://agent.dify.dev/console/api/agent/{agent_id}/trace
```

不要把示例域名写死，也不要改用 Service API 的 `/v1`。使用 `@/service/console` 的 `consoleQuery` / `consoleClient`，复用已有 Cookie、CSRF、认证刷新及错误处理。第三方 API key 仅发给配置接口，浏览器不直接调用 tracing 平台。

生成文件位于：

- `packages/contracts/generated/api/console/agent/{types,zod,orpc}.gen.ts`
- `packages/contracts/generated/api/console/apps/{types,zod,orpc}.gen.ts`

稳定的调用树如下；内部自动生成的 `get29`、`post20` 等序号不是业务调用入口。

| 能力 | `consoleQuery` / `consoleClient` 后缀 |
| --- | --- |
| Agent 开关及采集策略 | `agent.byAgentId.trace.get` / `.post` |
| Agent provider 配置 | `agent.byAgentId.traceConfig.get` / `.post` / `.patch` / `.delete` |
| Agent provider 能力 | `agent.byAgentId.traceCapabilities.get` |
| Agent 单次运行状态 | `agent.byAgentId.traceRuns.byMessageId.get` |
| Agent 手动重投 | `agent.byAgentId.traceRuns.byMessageId.retry.post` |
| App 开关及采集策略 | `apps.byAppId.trace.get` / `.post` |
| App provider 配置 | `apps.byAppId.traceConfig.get` / `.post` / `.patch` / `.delete` |
| App provider 能力 | `apps.byAppId.traceCapabilities.get` |
| App 单次运行状态 | `apps.byAppId.traceRuns.bySourceKind.bySourceId.get` |
| App 手动重投 | `apps.byAppId.traceRuns.bySourceKind.bySourceId.retry.post` |

查询示例：

```ts
import { useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

const tracing = useQuery(
  consoleQuery.agent.byAgentId.trace.get.queryOptions({
    input: { params: { agent_id: agentId } },
  }),
)

const execution = useQuery(
  consoleQuery.apps.byAppId.traceRuns.bySourceKind.bySourceId.get.queryOptions({
    input: {
      params: {
        app_id: workflowAppId,
        source_kind: 'workflow',
        source_id: workflowRunId,
      },
      query: { node_execution_id: nodeExecutionId },
    },
  }),
)
```

## 3. 权限

本轮复用已注册的 Agent 权限，没有引入新的 `agent.acl.tracing_config`。

| 操作 | Agent 权限 | 普通 App / Workflow 权限 |
| --- | --- | --- |
| 读取 tracing 开关与策略 | `Agent.Monitor`：`agent.acl.monitor` | `APP_VIEW_LAYOUT` |
| 读取 provider capability | `Agent.Monitor` | `APP_MONITOR` |
| 读取脱敏 provider 配置 | `Agent.Edit`：`agent.acl.edit` | `APP_TRACING_CONFIG` |
| 创建、修改、删除配置；修改开关 | `Agent.Edit` | `APP_TRACING_CONFIG` |
| 读取单次执行状态与链接 | `Agent.LogManage`：`agent.acl.log_manage` | `APP_LOG_AND_ANNOTATION` |
| 手动重投 | `Agent.Edit` | `APP_TRACING_CONFIG` |

RBAC 关闭时，配置写入及重投限定 workspace owner/admin/editor；Agent provider 配置读取也按该编辑角色限制。读取状态与读取凭据分开处理：只有 Monitor 的用户可看配置状态，不应发起会被拒绝的 provider 凭据读取请求。

Agent 自定义角色的 Edit、Monitor、LogManage 可独立授权。界面不能假设“可以编辑”必然等于“可以读取日志”，也不能只用按钮禁用代替后端授权。403 交给统一权限处理；不要因 403 将 tracing 状态显示为“未配置”。

监控页中的策略编辑入口要求同时具备 Monitor 和 Edit，以便先读取完整策略再修改；只有 Edit 时不要用默认值拼出策略提交。日志中的重投入口要求同时具备 LogManage 和 Edit，以便先读取当前运行状态并确定是否需要重复风险确认。仅有 Edit 的 API 调用权限不等同于这两个页面入口可见，不应让这些页面反复发起必定返回 403 的读取。

## 4. HTTP 接口总表

以下用 `{owner}` 表示 `/agent/{agent_id}` 或 `/apps/{app_id}`。ID 参数为 UUID。

| 方法 | 相对路径 | 请求 | 成功响应 |
| --- | --- | --- | --- |
| GET | `{owner}/trace` | 无 body | 200，采集策略 |
| POST | `{owner}/trace` | 完整采集策略 | Agent：200 策略；App：200 `{"result":"success"}` |
| GET | `{owner}/trace-config` | query `tracing_provider` | 200，脱敏配置或 `has_not_configured=true` |
| POST | `{owner}/trace-config` | provider + 配置 | 201，`{"result":"success"}` |
| PATCH | `{owner}/trace-config` | provider + 完整配置对象 | 200，`{"result":"success"}` |
| DELETE | `{owner}/trace-config` | query `tracing_provider` | 204，无响应 body |
| GET | `{owner}/trace-capabilities` | query `tracing_provider` | 200，能力声明 |
| GET | `/agent/{agent_id}/trace-runs/{message_id}` | 可选 query `node_execution_id` | 200，运行状态 |
| POST | `/agent/{agent_id}/trace-runs/{message_id}/retry` | 重投 body；可选同名 query | 200，重投后的状态 |
| GET | `/apps/{app_id}/trace-runs/{source_kind}/{source_id}` | 可选 query `node_execution_id` | 200，运行状态 |
| POST | `/apps/{app_id}/trace-runs/{source_kind}/{source_id}/retry` | 重投 body；可选同名 query | 200，重投后的状态 |

本功能没有 PUT 接口；provider 修改使用 PATCH，策略修改使用 POST。GET 不发送 JSON body。DELETE 的 204 不应调用 `response.json()`。

`source_kind` 仅允许 `message`、`workflow`、`node`，对应的 `source_id` 分别为 message ID、workflow run ID、node execution ID。`node_execution_id` 是一次执行记录的 UUID，不是画布上的 node ID；不能拿节点名称或配置快照 ID 代替。

## 5. 开关与内容采集

`GET {owner}/trace` 的缺省响应：

```json
{
  "enabled": false,
  "tracing_provider": null,
  "capture_content": false,
  "capture_agent": true
}
```

开启示例，`POST /agent/{agent_id}/trace`：

```json
{
  "enabled": true,
  "tracing_provider": "langfuse",
  "capture_content": true,
  "capture_agent": true
}
```

Agent 成功响应为以上完整策略；普通 App 成功响应为：

```json
{"result":"success"}
```

| 字段 | 默认值 | 语义 |
| --- | --- | --- |
| `enabled` | false | 应用 tracing 总开关；开启时必须指定 provider，并事先保存有效凭据 |
| `tracing_provider` | null | 当前选中的 provider；关闭时可保留，方便恢复 |
| `capture_content` | false | 新采集链路是否包含 prompt、输出、工具参数/结果等内容；关闭时保留状态、结构、时间、usage 等非内容观测信息 |
| `capture_agent` | true | 是否采集 Agent 内部调用；关闭时仍可记录外层业务 trace，不代表关闭应用 tracing |

这不是 PATCH 接口。前端修改一个开关时仍应提交四个字段，并沿用已读策略；遗漏两个 capture 字段会使用默认值，可能覆盖用户之前的选择。

新链路还要求 API/worker 的 `OPS_AGENT_TRACE_ENABLED=true` 及 Agent runtime 的 `DIFY_AGENT_APPLICATION_TRACING_ENABLED=true`，两者部署默认均为 false。`capture_agent=true` 不会越过部署开关，也不会开启基础设施 OTel 或部署级 trajectory 导出。

后台恢复任务由 `ENABLE_APPLICATION_TRACE_RECONCILE_TASK` 控制，默认 true，并且仅在 `OPS_AGENT_TRACE_ENABLED=true` 时注册。部署验收应确认 Celery beat 正常运行、worker 消费 `ops_trace` 队列且该恢复任务未被关闭，否则丢失排队通知后的终态恢复、重试扫描和过期清理不能按设计运行。这个部署任务开关不属于前端应用策略。

已认证的 `/trace-capabilities` 另外返回 `api_collection_enabled`，表示当前 API 的 `OPS_AGENT_TRACE_ENABLED`。false 时可提示“部署尚未开启应用级 Agent 采集”；true 仍不证明 Agent runtime 的开关已经开启。接口没有远程探测 runtime gate，也没有验证第三方已经收数。

前端不能用 `agent_spans=true` 推断部署已经开启，也不能仅凭 `not_collected` 区分应用关闭、旧历史记录或未进入采集。部署联调需确认 runtime 配置，并通过运行状态验证投递。运行记录内的 `capabilities` 是 provider 支持声明，不含当前 API gate；不要把当前 gate 的变化反推为历史运行状态。

`capture_content` 在新应用级 Agent tracing 链路执行。不要据此声称所有旧版 provider 导出路径都已统一支持相同内容策略；旧普通 App / Workflow 路径保留兼容行为。

## 6. Provider 配置流程与示例

### 6.1 创建、读取、修改、删除

创建 Langfuse 示例：

```http
POST /agent/{agent_id}/trace-config
Content-Type: application/json
```

```json
{
  "tracing_provider": "langfuse",
  "tracing_config": {
    "public_key": "pk-lf-example",
    "secret_key": "sk-lf-example",
    "host": "https://us.cloud.langfuse.com"
  }
}
```

成功响应：HTTP 201，`{"result":"success"}`。示例 key 不是真实凭据。

读取使用 query：

```http
GET /agent/{agent_id}/trace-config?tracing_provider=langfuse
```

未配置响应：

```json
{"has_not_configured":true}
```

已配置响应形状如下；脱敏字符串以服务端实际返回值为准：

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "app_id": "22222222-2222-4222-8222-222222222222",
  "tracing_provider": "langfuse",
  "tracing_config": {
    "public_key": "pk-lf-example",
    "secret_key": "******",
    "host": "https://us.cloud.langfuse.com",
    "project_url": "https://us.cloud.langfuse.com/project/example"
  },
  "is_active": true,
  "created_at": "2026-10-15 01:00:00",
  "updated_at": "2026-10-15 01:00:00"
}
```

`is_active` 不是应用 tracing 总开关；当前 provider 与 `enabled` 由 `/trace` 决定。配置响应中的 `app_id` 只用于展示或排查，不切换后续 Agent 请求到 `/apps`。

修改使用 `PATCH {owner}/trace-config`，body 结构与创建相同。保留未编辑密钥的实际脱敏回显值，复用现有表单逻辑；不要自行生成 `******`、将未改密钥清空，或把配置对象写到 URL、埋点及控制台日志。

删除示例：

```http
DELETE /agent/{agent_id}/trace-config?tracing_provider=langfuse
```

返回 HTTP 204。删除当前选中的 provider 前，先将 `/trace` 设置为关闭；删除配置本身不自动完成前端的当前选择/总开关更新。关闭后仍可保留凭据，删除不是关闭的必要操作。

### 6.2 保存并启用是两个步骤

1. POST 新配置或 PATCH 已有配置，等待连接验证成功。
2. POST `/trace` 设置 `enabled=true`、选定 provider，并提交 capture 策略。
3. 重新读取配置以获得脱敏值，刷新策略和 capability 查询。

两个请求不是一个事务。第二步失败时应呈现“配置已保存，启用失败”，不能显示“使用中”。只有配置写入权限的用户才请求脱敏凭据。

```ts
import { consoleClient } from '@/service/console'

await consoleClient.agent.byAgentId.traceConfig.post({
  params: { agent_id: agentId },
  body: { tracing_provider: 'langfuse', tracing_config: formValues },
})
await consoleClient.agent.byAgentId.trace.post({
  params: { agent_id: agentId },
  body: {
    enabled: true,
    tracing_provider: 'langfuse',
    capture_content: captureContent,
    capture_agent: captureAgent,
  },
})
```

已有配置调用 `.patch`。如果使用 TanStack mutation，则从对应 `consoleQuery.*.mutationOptions()` 创建 mutation；成功后使策略、配置及 capability query 失效。

### 6.3 复用现有十家表单

以下是配置字段清单，不表示每个字段都必填。必填项、默认值、互斥凭据及地址校验继续复用各 provider 的现有表单与服务端校验。

| provider 值 | 配置字段 |
| --- | --- |
| `langfuse` | `public_key`, `secret_key`, `host` |
| `langsmith` | `api_key`, `project`, `endpoint` |
| `opik` | `api_key`, `project`, `workspace`, `url` |
| `weave` | `api_key`, `project`, `entity`, `endpoint`, `host` |
| `arize` | `api_key`, `space_id`, `project`, `endpoint` |
| `phoenix` | `api_key`, `project`, `endpoint` |
| `mlflow` | `tracking_uri`, `experiment_id`, `username`, `password` |
| `databricks` | `host`, `experiment_id`，以及 `personal_access_token` 或 `client_id` + `client_secret` |
| `aliyun` | `app_name`, `license_key`, `endpoint` |
| `tencent` | `token`, `endpoint`, `service_name` |

## 7. Capability 声明及版本边界

```http
GET /agent/{agent_id}/trace-capabilities?tracing_provider=langfuse
```

```json
{
  "provider": "langfuse",
  "agent_spans": true,
  "session": true,
  "native_usage": true,
  "native_cost": true,
  "trace_url": true,
  "span_url": true,
  "export_ack": "accepted",
  "api_collection_enabled": true
}
```

除 `api_collection_enabled` 为当前 API 部署状态外，其余字段是 adapter 的实现声明，不是该账号实测结果、实际安装状态或成功投递证明。它们也不保证每个运行都有 token/cost 数值或深链。

| 字段 | 前端解读 |
| --- | --- |
| `agent_spans` | 可映射 Agent 内部父子调用树 |
| `session` | 可向平台传递 session 关联信息 |
| `native_usage` | 可映射平台使用的 token usage 字段；不是只写自定义 metadata |
| `native_cost` | 可映射原生费用字段；没有支持时仍可能在 metadata 中保留 Dify 费用 |
| `trace_url` / `span_url` | adapter 能提供相应深链；显示前还需检查本次响应 URL 非空 |
| `export_ack` | 仅能确认 ingestion 接受；不承诺平台已经可以查询 |
| `api_collection_enabled` | 当前 API 采集 gate；仅在能力查询响应中提供，不证明 runtime gate 或投递成功 |

当前代码中的能力表如下，界面运行时仍以接口返回为准：

| Provider | Agent 树 / session / usage | 原生 cost | Trace 深链 | Span 深链 |
| --- | --- | --- | --- | --- |
| Langfuse | 是 | 是 | 是 | 是 |
| LangSmith | 是 | 是 | 是 | 是 |
| Opik | 是 | 是 | 否 | 否 |
| W&B Weave | 是 | 否 | 是 | 是 |
| Arize | 是 | 否 | 否 | 否 |
| Phoenix | 是 | 否 | 否 | 否 |
| MLflow | 是 | 是 | 是 | 否 |
| Databricks | 是 | 是 | 是 | 否 |
| 阿里云 | 是 | 否 | 否 | 否 |
| 腾讯云 | 是 | 否 | 否 | 否 |

费用映射限定有有效费用数据的 LLM span，原生 USD 字段只写 USD；不要把其他币种或缺失值显示为 `0 USD`。外层 Agent / Workflow 汇总费用不能与内部 LLM 费用重复累加。运行状态接口不返回完整 span 内容或 usage/cost 明细；Dify 自身统计继续使用既有日志/统计数据接口。

SDK 依赖版本与第三方服务最低版本是不同概念：

| Provider | 本分支后端 SDK 依赖 | 新导出路径 / 服务端要求 |
| --- | --- | --- |
| Langfuse | `langfuse >=4.2.0,<5` | OTLP HTTP；平台需要提供相应 ingestion 端点，未额外承诺最低自托管版本 |
| LangSmith | `langsmith==0.8.18` | typed runs API；按当前 adapter 联调 |
| Opik | `opik~=1.11.2` | typed trace/span API；按当前 adapter 联调 |
| W&B Weave | `weave==0.52.36` | typed call start/end API；保留 endpoint/host 配置 |
| Arize / Phoenix | `arize-phoenix-otel==0.15.0` | Arize 使用 OTLP gRPC，Phoenix 使用 OTLP HTTP；不假设两个 endpoint 可互换 |
| MLflow | `mlflow-skinny >=3.11.1,<4` | 新 Agent 导出要求 **MLflow server ≥3.4** 的 `/v1/traces`；现有普通 App 旧路径未被替换 |
| Databricks | 同 MLflow SDK | 使用 experiment V3 metadata + signed artifact 上传，保留 `experiment_id` 与 PAT/OAuth；不会把 experiment ID 当成 UC table 传给 UC-only OTLP |
| 阿里云 / 腾讯云 | 仓库 OpenTelemetry 依赖 | 按 provider 的 OTLP 端点/认证协议；没有验证的服务版本不列最低版本保证 |

## 8. 运行状态、深链与轮询

独立 Agent 使用本轮消息 ID：

```http
GET /agent/{agent_id}/trace-runs/{message_id}
```

Workflow 中定位某次 Agent 节点执行：

```http
GET /apps/{app_id}/trace-runs/workflow/{workflow_run_id}?node_execution_id={node_execution_id}
```

单节点调试：

```http
GET /apps/{app_id}/trace-runs/node/{node_execution_id}
```

已接受的示例响应；示例值不是平台验收证据：

```json
{
  "status": "accepted",
  "source_kind": "workflow",
  "source_id": "33333333-3333-4333-8333-333333333333",
  "provider": "langfuse",
  "trace_id": "1234567890abcdef1234567890abcdef",
  "trace_url": "https://example.com/project/demo/traces/1234567890abcdef1234567890abcdef",
  "span_url": null,
  "config_revision": "opaque-frozen-configuration-revision",
  "capture_content": true,
  "capture_agent": true,
  "span_count": 8,
  "attempts": 1,
  "error_code": null,
  "accepted_at": "2026-10-15T01:00:00Z",
  "queryable": null,
  "capabilities": {
    "provider": "langfuse",
    "agent_spans": true,
    "session": true,
    "native_usage": true,
    "native_cost": true,
    "trace_url": true,
    "span_url": true,
    "export_ack": "accepted"
  }
}
```

没有新链路记录但业务源存在时，`status=not_collected`，DTO 的其他可选字段为 null。404 `tracing_source_not_found` 与“没有采集”不同，不能统一当作正常空状态。

`span_count` 统计收到的 Agent span 条目，不包含后续重建的外层 Workflow/Message 及 attempt wrapper，不能当作第三方最终树的节点总数；`attempts` 统计上报领取次数，不是 Agent 的模型推理轮数。`accepted_at` 是 UTC 的 ingestion ACK 时间，接口统一输出带 `Z` 的 ISO 8601 时间，前端按该时区解析后再转换为用户本地时间。

| `status` | UI 建议 | 自动轮询 / 重投 |
| --- | --- | --- |
| `not_collected` | 未采集；可能是旧记录或部署/应用未进入新链路 | 不提供重投；不要据此断定凭据无效 |
| `collecting` | 正在采集，等待业务执行结束或 Agent 最终批次 | 可轮询；不可手动重投 |
| `ready` | 待上报 | 可轮询；不可手动重投 |
| `exporting` | 正在上报 | 可轮询；不可手动重投 |
| `retrying` | 等待后台重试 | 可轮询；不要再触发手动重投 |
| `accepted` | 平台已接受上报 | 停止投递状态轮询；禁止重投；仍可能暂时无法查询 |
| `failed` | 上报失败，展示 `error_code` | 完整且有效的 payload 才允许手动重投，最终由后端判断 |
| `uncertain` | 接收结果不确定，可能已部分或全部写入 | 停止自动重投；仅在用户确认可能重复后手动重投 |

API 没有 `pending` 和 `incomplete` 状态。若 UI 使用“处理中/pending”，应汇总 `collecting/ready/exporting/retrying`。采集不完整表示 `failed` + `error_code=agent_trace_collection_incomplete`，不可当作普通网络失败反复重投。

`accepted` 不是 `queryable=true`。当前服务没有平台回查验证，`queryable` 返回 null。不要将“配置已启用”“投递已接受”“网页可查询”合并为一个绿色成功状态，也不要对 accepted 的运行提供“再试一次”。

长时间导出通过后台心跳续租。若心跳中断导致 `uncertain/export_lease_expired`，同一次投递稍后返回明确成功 ACK 时可恢复为 accepted；人工重投已撤销旧 token 时，旧 ACK 不能覆盖新尝试。前端在用户确认重投前刷新状态，并处理同时到达的 `tracing_already_accepted`。DB 不可用或进程暂停也可能导致租约过期，不能将它直接文案化为“worker 已死亡”。

先使用非空 `span_url` 定位 Agent 调用；没有 span 深链时使用非空 `trace_url`。两者都为空时，当前运行详情隐藏跳转操作：运行 DTO 尚未提供冻结目的地的 `project_url`，当前配置中的项目链接可能与历史 run 不同，也可能需要用户没有的 Edit 权限。

配置面板可使用脱敏配置响应中的 `project_url` 展示“查看项目”，明确它对应当前配置，不把它当作历史运行的回退深链。运行详情只使用后端保存的执行 URL，不用 Dify message/workflow ID 自行拼供应商 URL。以后若运行接口补充冻结的项目 URL，再启用可信的项目级回退。

运行中的查询建议有限退避轮询，例如 2 秒起、上限 10 秒；页面不可见或进入终态时停止。该节奏是 UI 建议，不是后端保证的投递时延。

## 9. 手动重投与冻结目的地

普通失败重投：

```http
POST /agent/{agent_id}/trace-runs/{message_id}/retry
Content-Type: application/json
```

```json
{"acknowledge_possible_duplicates":false}
```

`uncertain` 必须在 UI 明确确认“第三方可能已收到部分或全部数据，再次发送可能产生重复”后发送：

```json
{"acknowledge_possible_duplicates":true}
```

空 body `{}` 等同于 false；字符串 `"true"` 不合法。接口禁止额外字段，不接收 provider、endpoint、密钥或新的 `config_revision`。成功响应与 GET 状态接口相同，不表示后台发送已经完成。

重投的单位是整个 `source_kind/source_id` 对应的 run，不是某一个 Agent 节点。retry 的 `node_execution_id` 仅用于归属校验及选择响应中的 span 链接；带上它仍会重投整条 run。确认文案应说明这一范围。对于采集不完整或无效的记录，应重新执行业务获得新 trace，不能靠重投补齐缺失 span。

```ts
await consoleClient.agent.byAgentId.traceRuns.byMessageId.retry.post({
  params: { agent_id: agentId, message_id: messageId },
  body: { acknowledge_possible_duplicates: userAcknowledgedPossibleDuplicates },
})
```

每个新链路 run 冻结 provider、加密凭据快照和 capture 策略。`config_revision` 是不透明的配置版本标识，前端不解析、不当作时间戳。运行开始后切 provider、编辑凭据或关闭应用开关，只影响后续新 run；既有 run 及允许的重投继续使用冻结目的地。关闭开关不能用来推断既有排队任务已被取消。

因此，历史 trace 链接和状态必须取运行接口，不能根据当前配置推导。重投不会把旧数据发送到刚选的新项目。删除第三方项目、撤销旧密钥或过期清理可能使旧目的地不可用；前端显示实际错误，不自动换成当前凭据重发。

## 10. 前端错误处理

通用错误仍走 Console 统一处理：认证/CSRF、403、`invalid_param`、限流和未知 5xx。业务错误可通过生成的 oRPC defined error 分支处理。

| HTTP / `code` | 建议处理 |
| --- | --- |
| 400 `invalid_tracing_config` | 高亮配置错误，不改变开启状态 |
| 400 `tracing_config_verification_failed` | 提示检查凭据、host/project/权限，允许修改后保存 |
| 400 `tracing_provider_unavailable` | 当前部署缺少所需 provider 能力/依赖；不要显示成密钥输入错误 |
| 400 `unsupported_tracing_provider` | provider 不在当前版本范围，刷新能力/版本状态 |
| 409 `trace_config_already_exists` | 刷新配置并转为编辑，避免重复创建 |
| 404 `trace_config_not_found` | 刷新配置状态；编辑时可切换为创建 |
| 404 `app_not_found` 或通用 Agent not-found | 资源已不存在或不可寻址，退出配置态 |
| 500 `tracing_config_processing_failed` | 保存失败，保留用户输入并允许重试，不展示内部异常 |
| 404 `tracing_source_not_found` | 当前应用内没有该执行；检查 ID/所属应用，不跨应用查找 |
| 404 `tracing_node_not_found` | 节点执行不属于该 trace；清理选中的节点或重新获取日志数据 |
| 404 `tracing_run_not_found` | 没有可重投的采集记录；移除重投操作 |
| 409 `tracing_already_accepted` | 刷新状态，禁用重投 |
| 409 `tracing_retry_not_allowed` | 当前执行仍在处理中，或采集数据不完整/无效；刷新状态 |
| 409 `tracing_duplicate_acknowledgement_required` | 展示重复风险确认，只有用户确认后才以 true 再提交 |

`TraceRunStatusResponse.error_code` 是一次投递的状态字段，不是当前 GET 请求失败。常见值有 `provider_temporarily_unavailable`、`provider_retry_exhausted`、`provider_export_rejected`、`provider_acceptance_unknown`、`export_lease_expired`、`agent_trace_collection_incomplete`、`tracing_payload_invalid`。最后一项表示本地采集树无效，重投不能修复，应重新执行业务。保留未知值的通用失败文案，不能把所有 `failed` 都视为可安全重投。

## 11. 联调顺序

1. 记录 API/Web/Agent runtime/worker 的实际版本、迁移状态和两个部署开关；核对当前 dev 与待合入 main，不用本地旧 main 推断部署版本。
2. 使用 owner/editor 验证 Agent 与 Workflow 的 provider CRUD、脱敏回显及四字段策略；再验证 Monitor-only、LogManage-only 和无权限角色。
3. 验证保存成功但启用失败、删除当前 provider、刷新页面、切换 Agent/App 的状态；十家现有 provider 配置均做回归。
4. 用可触发至少两轮 LLM 和一次工具调用的 Agent 验证内部树；再验证 inline Workflow、多节点/重复调用、单节点调试、取消或失败运行。
5. 使用运行接口核对状态、冻结目的地及深链，再到实际第三方平台核对父子层级、session、usage/cost；运行接口不返回这些明细。配置验证 200 不能替代实际上报与平台查询。
6. 运行中修改 provider/capture 策略，确认旧 run 保持冻结目的地、新 run 使用新配置；历史链接仍正确。
7. 模拟明确失败、超时/部分接收、采集不完整；确认 failed/uncertain 的不同处理，accepted 不重发，uncertain 必须确认。
8. 覆盖 SDK 型与 OTLP 型导出；逐 provider 记录已验证、未验证及差异。没有账号或平台证据的项目保留“未验证”，不得用 mock SDK 测试代替平台验收。

## 12. 待补部署与 E2E 证据

本节由实际 dev 验收负责人填写。代码测试、SDK/HTTP 边界测试、真实平台查询分开记录。

| 项目 | 证据 |
| --- | --- |
| main 基线 / PR commit | 待填写精确 SHA 与 PR |
| dev API / Web / Agent / worker 镜像及挂载差异 | 待填写 |
| 数据库迁移版本、两个部署开关 | 待填写；不要附密钥 |
| 新 Agent App：应用 / message ID / trace 链接 | 待填写本次新链路证据 |
| inline Workflow：app / workflow run / node execution ID / trace 链接 | 待填写本次新链路证据 |
| 单节点调试与失败/取消 | 待填写 |
| 冻结目的地、手动重投及 uncertain 确认 | 待填写 |
| Langfuse 实际可查询结果 | 待填写；此前普通 LLM Workflow 的 legacy trace 不代表新 Agent 内部树已验收 |
| 其他九家 provider 平台验收 | 当前不宣称已实测，逐家填写证据与差异 |

## 13. 定稿检查与代码定位

发布前重新核对以下源文件；运行服务、schema 和本文如有差异，应先修正契约再更新文档：

- 配置/能力 controller：`api/controllers/console/agent/tracing.py`
- 运行/重投 controller：`api/controllers/console/agent/tracing_runs.py`
- 普通 App 策略与凭据：`api/controllers/console/app/app.py`、`api/controllers/console/app/ops_trace.py`
- 运行状态/重投：`api/services/tracing/service.py`
- 冻结配置及投递状态：`api/repositories/application_trace_repository.py`
- Provider 能力：`api/services/tracing/provider_dispatch.py`
- 生成契约：`packages/contracts/generated/api/console/{agent,apps}/`

运行服务已提供 `retry` 和 `status.capture_agent`，配置能力接口已增加当前 API gate。发布前剩余核对项为部署/迁移版本及第 12 节的真实平台证据；runtime gate 目前仍无远程探测，不能把 API gate=true 写成完整链路已启用。
