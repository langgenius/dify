# Agent tracing 前端接入说明

更新日期：2026-10-19。面向 DIFY-2975 / DIFY-2983 / DIFY-2984 / DIFY-2985 的前端实现与联调。

后端应用级 Agent tracing、Console API 与生成契约已实现。各 provider 的平台证据及边界记录于第 12 节。Weave 在 10 月 16 日的验收受账号试用状态限制；10 月 19 日切换 Free 后，项目、trace 树及调用链接已能实际打开，后续专项按独立证据记录。后续 Databricks、Opik、腾讯云、OSS MLflow 和 Phoenix 均通过 Dify UI 配置并发起业务，再独立查询平台。本文定义后端契约；dev 前端的具体联调范围单独记录。

Langfuse、LangSmith 已有独立 Agent、内容策略与终态、mixed inline/reference Workflow、单节点 preview 和普通 Workflow legacy 兼容证据。腾讯云已有云端查询证据；OSS MLflow 与 Phoenix 的本轮证据来自私有匿名实例，不代表真实账号鉴权通过。Arize 尚无平台端到端证据，阿里云暂缓验收。Databricks 的 PAT / experiment storage 结果不代表 OAuth M2M 或 Unity Catalog；OSS MLflow 已作为独立 provider 单独验收。支持声明、供应商接收 ACK、独立查询和浏览器 UI 验收分别记载，跨 Workflow 内部节点不保证同树。

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
- `packages/contracts/generated/api/console/system-features/{types,zod,orpc}.gen.ts`

稳定的调用树如下；内部自动生成的 `get29`、`post20` 等序号不是业务调用入口。

| 能力 | `consoleQuery` / `consoleClient` 后缀 |
| --- | --- |
| 全局 API 采集 gate（公开部署配置） | `systemFeatures.get` |
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
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'

const apiCollection = useQuery({
  ...systemFeaturesQueryOptions(),
  select: (features) => features.agent_tracing_api_collection_enabled,
})

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

全局 `GET /system-features` 是无需登录的部署配置接口，不依赖 workspace、Agent/App ID、provider 或其 Monitor/Edit 权限。Console 与 Web 的对应接口返回同一非敏感 boolean；它不返回凭据，也不放宽下表中的应用权限。`GET /features` 保留 workspace 功能和权益，不再返回此部署开关。

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
| GET | `/system-features` | 无 workspace/app/provider 参数、无 body；无需登录 | 200，已有 system-features 响应增加必填 `agent_tracing_api_collection_enabled: boolean` |
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

main/生产配置的默认 false 保持不变。dev 的显式启用应写入常规部署实际加载的持久 override 或环境配置，覆盖 API、相关 workers/beat 与 Agent runtime；一次性镜像 overlay 或临时容器环境不能保证 CI 重部署后仍生效。部署后核对实际运行配置和公开 system-features 响应，不能仅凭旧验收镜像或本地分支判断开关。

升级时先保持两个 gate 关闭，完成数据库迁移、新 Agent runtime、API 与 workers 的部署，再开启两个 gate 并执行验证。旧 runtime 的 execution context 使用 `extra=forbid`，即使 `tracing:null` 也会被拒绝；本次 API 已在没有 tracing context 时完全省略该字段，因此关闭 gate 的普通请求可兼容旧 runtime。不能在新 runtime 部署完成前向它发送非空 tracing context。回滚先关闭两个 gate，停止新增采集，再按发布步骤回滚服务；应用配置中的 `enabled=false` 不能代替部署 gate。

后台恢复任务由 `ENABLE_APPLICATION_TRACE_RECONCILE_TASK` 控制，默认 true，并且仅在 `OPS_AGENT_TRACE_ENABLED=true` 时注册。部署验收应确认 Celery beat 正常运行、worker 消费 `ops_trace` 队列且该恢复任务未被关闭，否则丢失排队通知后的终态恢复、重试扫描和过期清理不能按设计运行。这个部署任务开关不属于前端应用策略。

现有 `GET /console/api/system-features` 与 `GET /api/system-features` 均返回顶层必填 boolean `agent_tracing_api_collection_enabled`，表示当前 API 的 `OPS_AGENT_TRACE_ENABLED`，无需登录、选择 workspace 或先配置 provider。它是部署级值，各 workspace 相同；`GET /features` 不再返回此字段，没有新增接口。以下仅展示完整 system-features 响应中的相关字段：

```json
{"agent_tracing_api_collection_enabled": false}
```

前端复用根布局已有的 `systemFeaturesQueryOptions()` / `consoleQuery.systemFeatures.get`，独立读取部署状态。保留现有 system-features 缓存语义：客户端 `staleTime: Infinity`，SSR 查询缓存仅在当前请求内复用；部署变化后刷新页面获取新快照。首次加载或失败且没有成功数据时是未知状态，不等同于明确的 false；刷新失败但已有成功数据时保留上次成功值。新字段无 schema 默认值，旧响应缺字段不能被补成 false。false 时提示“部署尚未开启应用级 Agent 采集”；true 仍不证明 Agent runtime gate/健康、provider 凭据有效、已投递或平台可查询。

原 `{owner}/trace-capabilities` 的 `api_collection_enabled` 保留兼容，但新前端不应依赖选中 provider、应用 enabled 或 app Monitor 权限来探测全局 gate，也不要填默认 provider 发起能力查询。provider 能力、应用持久化策略和部署状态分别展示；部署关闭不自动改写应用策略或关闭普通 App legacy tracing。

dev 曾复现：没有 provider、未运行模型的新 Agent 没有部署关闭提示，已配置 provider 的面板才显示不可用提示。此次契约调整将该部署开关从 workspace features 迁到公开 system-features；前后端应配套发布，已加载旧前端的标签页需要刷新。历史回归及未覆盖条件见 [DIFY-2995](https://linear.app/dify/issue/DIFY-2995)，不能以成功配置某个 provider 代替权限与部署关闭等验证。

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

返回 HTTP 204。删除当前 provider 自动关闭 tracing 并清空选择；关闭 tracing 本身仍可保留凭据，删除不是关闭的必要操作。

### 6.2 原子保存并启用

1. POST 新配置或 PATCH 已有配置时显式提交 `activate: true`。后端先完成供应商配置校验，再在单一事务内保存凭据、选择 provider 并开启 tracing；保留数据库中最新的 `capture_content` 和 `capture_agent`。
2. 成功后刷新该 provider 的配置和 `/trace` 查询。无需第二个启用请求。省略 `activate` 或传 `false` 只保存配置，不改变当前策略。

保存并启用是一个原子业务操作，校验失败或数据库提交失败均不产生部分保存。只有配置写入权限的用户才请求脱敏凭据。

删除当前选定 provider 时，同一事务关闭 tracing、清空 `tracing_provider` 并删除配置；capture 策略不变。删除非当前 provider 不改变当前策略。已采集运行的加密目的地快照和 `project_url` 不受删除影响；不需要迁移。

直接 POST `/trace` 启用已有 provider 时，后端要求该应用存在 active、非空、可解密且符合 provider schema 的已保存配置，并确认适配器已安装。此操作不向供应商发起网络健康探测，不承诺已保存凭据没有被第三方撤销。

所有配置和策略写入共享应用行锁。PATCH 凭据在事务外验证后，事务内检查配置身份、内容和 active 状态；若校验期间被其他写入替换，返回 HTTP 409、`code: "tracing_config_conflict"`、`message: "Tracing configuration changed. Refresh and try again."`。启用期间配置被替换或删除也返回该冲突；调用方刷新配置和策略后允许用户重试，不自动重发旧表单。缺少可用已保存配置返回既有 HTTP 404 `trace_config_not_found`。客户端不需要保存版本号或时间戳。

```ts
import { consoleClient } from '@/service/console'

await consoleClient.agent.byAgentId.traceConfig.post({
  params: { agent_id: agentId },
  body: { tracing_provider: 'langfuse', tracing_config: formValues, activate: true },
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

阿里云表单的 `endpoint` 填 HTTP(S) 接入基址，可保留部署的路径前缀；不能直接填含 `adapt_.../api/otlp/traces` 或 `adapt_.../api/v1/traces` 的完整接入点。控制台的 Trace 接入点需拆成基址和 `license_key`，不要使用 Metric 接入点。LicenseKey 是原始不透明字符串，不提前 URL 解码；后端保留路径段中的 `@`，并编码其余需要转义的字符。`app_name` 用作 `service.name`，空值使用 `dify_app`。

阿里云 POST/PATCH 使用请求级凭据，经既有 SSRF 边界发送仅含资源和服务名的 OTLP 请求，严格不含 span 或业务 trace；配置校验仅认可已实测的 HTTP 200、正文精确为 `"success"` 的响应，空 200 不作为凭据有效的证明。GET 与 exporter 构造器只在本地处理配置。正式投递使用相同 HTTP 出口，兼容该精确响应及标准 OTLP ACK；未知 ACK 与部分接收按结果不确定处理，不自动重送整棵 trace。凭据位于请求路径，HTTP 请求期间的动态日志与异常细节会被隐藏。保存成功只证明本次接入校验成功，平台索引和业务 span 仍需按运行记录验收；不提供原生费用或项目、trace、span 深链。当前账号验证针对 ARMS 公网 HTTP 接入点；`*.log.aliyuncs.com` 的 SLS 路径分支仅有离线覆盖，尚未完成真实账号端到端验收。

Weave Cloud 的 `host` 为 `https://api.wandb.ai`，`endpoint` 为 `https://trace.wandb.ai`。先在供应商创建项目，再填写明确的 `entity` 与项目裸名称；若不填写 `entity`，可填写 `entity/project`，或由当前凭据解析默认 entity，验证成功后服务端会保存解析结果。不能同时提供 `entity` 和带 entity 前缀的 `project`。

Weave 的 POST/PATCH 只读校验账户、项目可写权限和 trace 查询端点，不隐式创建项目、不调用全局 SDK login/init。GET 不访问供应商。保存成功后持久化规范化的 entity/project 与项目链接；PATCH 保留未编辑密钥的实际脱敏回显值。校验通过不等于后续 ingestion 一定成功，继续按运行状态判断。

Weave 的 managed 与 legacy 导出共用实例独立的 typed HTTP transport，通过既有 SSRF 请求边界发送显式凭据和目标。legacy 构造器不再调用 `wandb.login` / `weave.init`、写入 `.netrc` 或创建 SDK 后台队列；未配置 entity 的历史记录仅在实际发送时按本实例凭据解析。Celery 仍负责异步投递。legacy 保留旧 call ID、父子关系、状态与 raw usage 映射，不因 managed 的 thread/turn 改进而新增原生 session、费用或用量聚合能力。

legacy 接收结果未知时，任务沿既有终态路径记录导出失败计数及安全日志、清理本次载荷，不自动整树重送；业务执行结果保持原状。任务函数不重新抛异常，这不表示新增 Celery FAILURE 状态。Weave 首个请求被明确 429/503 拒绝、尚无已接收前缀时仍可按既有 Celery 策略重试；一旦已有 call start 被确认接收，后续可重试错误升级为接收不确定，避免旧 mapper 的随机 call ID 在重送时重复生成。该状态按单次 dispatch 隔离。协议故障注入覆盖真实 SDK HTTP 序列化与任务 owner，不代表真实供应商账号的 429/5xx 或凭据撤销已完成验收。legacy 没有 managed 的持久化 uncertain 状态或显式重投界面。

Databricks 的 `host` 必须是 HTTPS workspace origin，`experiment_id` 是已存在的数字 ID。POST/PATCH 使用请求级 PAT 或 OAuth M2M 认证，只读核对 exact experiment ID 与 active 状态；它证明认证和实验可读，不证明写权限、trace API 可用或 artifact 投递成功。GET 在本地生成项目链接，不构造 legacy MLflow exporter，也不修改进程级认证环境、tracking URI 或当前 experiment。可空凭据保留 null / 清空语义，masked-key 原样保存保留原密钥；M2M 与 PAT 的双向切换有真实 RSA/持久化测试，账号级验收目前只有 PAT。

Opik 的 `url` 为以 `/api/` 结尾的 API 基址，可保留自托管路径前缀。POST/PATCH 使用请求级凭据调用官方 auth 接口，验证认证与 workspace 访问；空 workspace 或 `default` 在保存时解析为实际名称并持久化。该校验不证明项目写权限或 ingestion 可用，也不要求项目必须预先存在，不创建项目或测试 trace。配置路径不构造高层 Opik SDK 客户端或启动其后台线程，不使用 SDK 的全局认证回退。

Opik GET 仅在本地解密、脱敏和计算项目链接，不访问供应商。链接使用配置中的 host / path，沿用 `/{workspace}/redirect/projects?name=...`，分别编码 workspace 路径和项目 query；历史配置仍为未解析 default workspace 时回退到该配置的控制台。masked-key PATCH 保留原密钥并更新规范化目的地。错误 Key 或不可访问 workspace 的保存失败不会留下新配置，也不会切换当前 provider。

Phoenix 后端的 `api_key` 可省略、为 null 或空字符串；匿名部署无需真实 Key，前端不应强制填写占位值。`endpoint` 是 HTTP(S) base URL，可带端口和反向代理路径前缀，不能填完整 `/v1/traces` ingestion 地址。新配置保存时去除地址首尾空格及尾部 `/`，规范化主机名；项目名称去除首尾空白，空值使用 `default`。项目名中的空格、`&` 和 Unicode 可以保留。

Phoenix POST/PATCH 通过请求级只读 `GET {endpoint}/v1/projects?limit=1` 校验响应；有 Key 时使用 Bearer，无 Key 时不发送认证头。空项目列表有效，不要求指定项目预先存在。该校验只证明项目列表可读，不证明指定项目的写权限、Key 在匿名服务上有效或 ingestion 成功；不创建项目、tracer 或测试 span，不初始化 legacy SDK。配置 GET 仅本地解密、脱敏并生成 `{endpoint}/redirects/projects/{encoded_project_name}`，不探测供应商；项目名按一个路径段完整编码。masked-key PATCH 保留原密钥，保存失败不改变配置或当前策略。

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

除兼容字段 `api_collection_enabled` 为当前 API 部署状态外，其余字段是 adapter 的实现声明，不是该账号实测结果、实际安装状态或成功投递证明。页面从 `/features` 独立读取部署 gate；provider 能力不等于部署状态，也不保证每个运行都有 token/cost 数值或深链。

| 字段 | 前端解读 |
| --- | --- |
| `agent_spans` | 可映射 Agent 内部父子调用树 |
| `session` | 可向平台传递 session 关联信息 |
| `native_usage` | 声明可映射一组平台原生 token usage 字段；不表示所有缓存细分、时延或其他 usage 子字段均有原生映射或已做账号验收 |
| `native_cost` | 可映射原生费用字段；没有支持时仍可能在 metadata 中保留 Dify 费用 |
| `trace_url` / `span_url` | adapter 能提供相应深链；显示前还需检查本次响应 URL 非空 |
| `export_ack` | 仅能确认 ingestion 接受；不承诺平台已经可以查询 |
| `api_collection_enabled` | 能力接口保留的兼容 API gate；新前端使用 `GET /system-features` 的 `agent_tracing_api_collection_enabled` 独立读取，不证明 runtime gate 或投递成功 |

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
| Opik | `opik~=1.11.2`，本轮 dev 为 1.11.2 | 同步 typed trace/span API；稳定 UUIDv7、原生 thread / usage / USD cost。仅接受对象、对象列表或字符串的 SDK I/O 字段使用下述 JSON 兼容映射 |
| W&B Weave | `weave==0.52.36` | typed call start/end API；保留 endpoint/host 配置 |
| Arize / Phoenix | `arize-phoenix-otel==0.15.0` | Arize 使用 OTLP gRPC，Phoenix 使用 OTLP HTTP；不假设两个 endpoint 可互换 |
| MLflow | `mlflow-skinny >=3.11.1,<4` | 新 Agent 导出要求 **MLflow server ≥3.4** 的 `/v1/traces`；普通 App 仍走独立 legacy 路径，本轮私有匿名 server 3.17.1 已验收 |
| Databricks | 同 MLflow SDK；本轮 dev 为 3.11.1 | experiment V3 metadata + SDK V2 上传凭据兼容接口 + signed artifact；本轮 PAT / experiment storage 已实际收数和完整回读。不会把 experiment ID 当成 UC table；未实现自动 UC 目标发现，不声明 UC 存储已通过 |
| 阿里云 / 腾讯云 | 仓库 OpenTelemetry 依赖 | 按 provider 的 OTLP 端点/认证协议；没有验证的服务版本不列最低版本保证 |

Weave managed 导出将业务会话映射到原生 `thread_id`；同一棵 trace 的 `turn_id` 使用外层 root 的稳定 call ID，所有内部 Agent、LLM 和工具调用继承该值。因此一棵 trace 只计一轮，同一会话的新 trace 形成新轮次；空 session 不构造 thread/turn。此映射不改 call ID、parent 或重试规则，也不回填历史已接收数据或改变 legacy 路径。原生 Threads 聚合、页面聊天展示和 I/O 是否符合平台识别格式仍分别验收。LLM 原生 usage 映射为 prompt/completion/total tokens；`native_cost=false`，供应商按自己的定价计算出的成本不是 Dify 原生成本导出。cache token 细分与首 token 时间也不因 `native_usage=true` 自动获得支持。

Opik 保留 canonical I/O 中的 `None`、字符串、对象和对象列表；数字、布尔及其他 JSON 数组转换为 JSON 字符串，trace 与 span 使用相同映射。平台字符串需按该语义与 canonical 原值比较，不能把合法的工具整数结果误判为采集失败。`capture_content=false` 的 `None` 保持为空。顶层原生 Trace 的 `error_info` 仅跟随 canonical root ERROR；已处理的工具错误不把成功 root 升级为错误。关闭内容时使用隐私处理后的通用错误信息，不恢复原始异常正文。

## 8. 运行状态、深链与轮询

独立 Agent 使用本轮消息 ID：

```http
GET /agent/{agent_id}/trace-runs/{message_id}
```

Workflow 中定位某次 Agent 节点执行：

```http
GET /apps/{app_id}/trace-runs/workflow/{workflow_run_id}?node_execution_id={node_execution_id}
```

仅持有节点执行 ID 时（单节点调试或 Workflow 中的 Agent 执行）：

```http
GET /apps/{app_id}/trace-runs/node/{node_execution_id}
```

执行记录中的 Agent V2 仍使用 `node_type: "agent"`；`agent-v2` 是前端画布类型，不能用于判断执行接口的返回值。节点级 tracing 入口使用 `node_type === "agent"` 且 `process_data.workflow_agent_binding_id` 为非空字符串识别已绑定的 V2 执行。该标识属于本次执行，inline/reference 均适用；不要读取当前画布或当前 Agent 绑定来判断历史记录，也不要把绑定 ID 当作 trace 查询参数。

Workflow Agent session 在构建 runtime 请求及 tracing invocation 前持久化该绑定标识，执行终态更新、失败/取消及 process data 截断会保留它。绑定前失败或缺少该标识的旧记录不提供 V2 节点 tracing 入口。`extras.agent_node` 只属于开始事件，历史执行接口不保证返回；不能将它作为历史记录的判别依据。展示资格与 trace 归属分开：前端识别执行后，仍由下面的运行查询解析归属、状态和冻结链接。

reference Agent 日志的 `conversation_id` / `message_id` 是节点执行 ID 投影；使用日志 `source.app_id` 指向的调用方 Workflow app 和上述 `node` 路由，不能把该 ID 当作独立 Agent message ID 或 workflow run ID。后端先使用该节点自己的独立运行记录；没有独立记录时，才解析并校验同 tenant / app / workflow 的父运行。独立 preview 和已有 `not_collected` 记录优先，不会被父 trace 覆盖。

父运行别名仍返回请求的 `source_kind=node` / `source_id`，状态、内容策略和目的地来自父运行的冻结快照，`span_url` 自动选择该节点最新 invocation。没有对应 invocation 或 provider 不支持节点链接时，返回 null 并回退父 `trace_url`，不拼造节点 URL。不要额外传入另一个节点的过滤器。该路由要求调用方 Workflow 的日志权限；只有被引用 Agent 的日志权限不保证有权读取父 Workflow trace。

同一 `node` 路由的 `/retry` 重投所属的完整冻结 trace，不重新运行业务节点；preview 重投自己的独立 trace。`accepted` 禁止重投、`uncertain` 需要明确重复风险确认等规则不变。

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
  "project_url": "https://example.com/project/demo",
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

先使用非空 `span_url` 定位 Agent 调用；没有 span 深链时使用非空 `trace_url`；两者都为空时，可使用运行响应中的非空 `project_url` 展示“查看项目”。三个 URL 都为空时隐藏跳转操作。项目链接不证明本次运行已上报或可查询。

运行 `project_url` 只读取运行开始时冻结的目的地元数据，不查询当前应用配置、不解密凭据、不调用第三方。配置创建和更新时会尝试保存项目链接；Langfuse、LangSmith、Arize、Phoenix、Opik、Weave、MLflow、Databricks 可提供，解析失败返回 null。Weave 自配置验证修复后保存项目链接；Aliyun、Tencent 仅有平台控制台地址，运行接口不将其作为项目链接，均返回 null。旧运行快照缺少项目链接时也返回 null，不追溯补填。仅返回有效且不含 URL 用户名/密码的 HTTP(S) 链接。

配置面板中的 `project_url` 对应当前配置，不能替代历史运行的回退链接，也不能要求仅有日志权限的用户读取配置凭据。运行详情只使用运行响应的 URL，不用 Dify message/workflow ID 自行拼供应商 URL。

运行中的查询建议有限退避轮询，例如 2 秒起、上限 10 秒；页面不可见或进入终态时停止。该节奏是 UI 建议，不是后端保证的投递时延。

Agent worker 在观察到成功、失败或处理完显式停止后直接提交 tracing 终态，不依赖浏览器继续消费 SSE。调用 stop 后关闭 SSE 也可继续完成投递；关闭 SSE 本身不等同于发送 stop。取消执行的外层 root 标记为 error，并带 `message_execution_state=cancelled`；已完成的底层 Agent / LLM / tool span 保留它们实际的状态，不能要求整棵树所有 span 都变成 error。这些执行细节不在 Console 运行 DTO 中展开，前端业务状态仍沿用现有执行接口。

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

1. 记录 API/Web/Agent runtime/worker 的实际版本、迁移状态和两个部署开关；核对当前 dev 与待合入 main，不用本地旧 main 推断部署版本。未选择 provider 时也应从 `/features` 读到 API gate，并分别核对未知、false、true 的界面状态。
2. 使用 owner/editor 验证 Agent 与 Workflow 的 provider CRUD、脱敏回显及四字段策略；再验证 Monitor-only、LogManage-only 和无权限角色。
3. 验证保存成功但启用失败、删除当前 provider、刷新页面、切换 Agent/App 的状态；十家现有 provider 配置均做回归。
4. 用可触发至少两轮 LLM 和一次工具调用的 Agent 验证内部树；再验证 inline Workflow、多节点/重复调用、单节点调试、取消或失败运行。
5. 使用运行接口核对状态、冻结目的地及深链，再到实际第三方平台核对父子层级、session、usage/cost；运行接口不返回这些明细。配置验证 200 不能替代实际上报与平台查询。
6. 运行中修改 provider/capture 策略，确认旧 run 保持冻结目的地、新 run 使用新配置；历史链接仍正确。
7. 模拟明确失败、超时/部分接收、采集不完整；确认 failed/uncertain 的不同处理，accepted 不重发，uncertain 必须确认。
8. 覆盖 SDK 型与 OTLP 型导出；逐 provider 记录已验证、未验证及差异。没有账号或平台证据的项目保留“未验证”，不得用 mock SDK 测试代替平台验收。

## 12. 部署与分级验收记录

以下保留 2026-10-15 的 Langfuse、2026-10-16 的 LangSmith、Weave、Databricks、Opik 历史记录，并补充后续验收范围。真实供应商查询、部署内故障注入和代码测试分别记载；未验证项目不计入通过。仓库文档不包含 workspace/account UUID、私人项目链接或凭据。

2026-10-17 腾讯云已完成 Dify UI 业务与官方查询回读，涵盖 managed 和普通 Workflow legacy；查询投影存在 metadata 截断、字段省略或错误描述移位等边界，不声明 raw OTLP 全等。2026-10-18 OSS MLflow 在私有匿名 server 3.17.1 完成 managed 与修复后 legacy 回读；真实 Basic 认证未验收。两者结果均独立于 Databricks，本文不追加其完整逐条记录。

### 12.1 实现版本与 dev 差异

| 项目 | 当前记录 |
| --- | --- |
| 原功能基线与 10/15 同步 | 原功能基线 `69629bd7b719ab958be2b8a83d6cf13a1dcdbc0c`；10/15 同步 main `36f9bb69e6c2ff629586d93ab463bd4da3d89af6` |
| 10/16 合并基线 | 保留外部 `81b61d39762c3c1955c41ac737a0acbadacc4275` 及其 main `10285432d2259cc1c1ebf1512d9fbc09810976c9`；合并提交 `498309fe0f6eaae683ae073d8f11dba3c852182f`，包含冻结项目链接状态字段 |
| 10/15 生产代码提交 | `5da59a08959823bd46296ff86e21bb019fa2d472` |
| 10/15 测试类型补充提交 | `dba2ff735a62b30e52afef4b6b1e05aded29c2d4` |
| 10/15 dev API 镜像 ID | `50b6dbbc82f135d4937714111e8e8616eda154095580535537856a449df239d1` |
| Agent runtime 镜像 ID | `f0c70c043f71bf58f112eaf2a65f8dab1e2bc39072da8bc942a9e8815e111087` |
| 10/15 验收期间的部署更新 | 早期 mixed Workflow / Agent 策略使用 API `ca15a0a0…`；终态 handoff 验收使用中间 API `9205…`；最终 API 已包含 preview 两项修复及 app-scoped tracing port 注册；在最终镜像上又完成 Agent 与 inline Workflow 回归，Agent runtime 未变更 |
| 10/16 LangSmith 修复提交 | 配置 PATCH 深链：`d85211e60179b0887fb4ba75de6f0654fe24138b`；早期 Agent 错误输入：`1c5303486eafc284b5ff1235f340b4cb2f654238` |
| 10/16 dev r2 API 镜像 ID | `3d0569c5d2c07aa85cc78d6f4d4f378d295603caff7cc0374704e024fe533050`；Agent runtime 沿用上表镜像 |
| 10/16 最终 dev r3 API / workers 镜像 ID | `bd4b2e1daab6fb633fce4c9548df10e07c76b8a9cb06175da5c9fe9a2468e689`；dev 提交 `cb24a11091`，仅回移必要生产路径并保留 dev 自身差异，Agent runtime 未变 |
| 数据库迁移链 | main：`a17c2980f3e6`；dev：`a17c2980d3e6`。两条链不同，不把 revision 字符串不同误判为缺少本功能 |
| dev 保留修改 | 保留 Tokener / node ID 补丁；没有以 main 覆盖 dev |
| OpenAPI 适配差异 | dev 的 `libs.external_api` 缺少 `error_responses`，仅移除两个新 Console controller 的该纯文档注解；业务运行逻辑相同，前端类型以 main 生成契约为准 |
| Web | 未修改；新增配置与运行状态 UI 仍由前端接入 |
| 运行条件 | dev 验收时 API / Agent 双 gate 与恢复任务开关均开启，beat 正常投递恢复任务；实际运行由 worker 接受上报。发布其他环境时仍需核对其独立开关 |

### 12.2 Langfuse 真实 API / 平台验收（2026-10-15）

| 场景 | API / 业务结果 | 第三方证据 |
| --- | --- | --- |
| Agent provider 配置 | 脱敏回显断言通过 | 不将配置校验成功等同于投递成功 |
| Agent `capture_content=false` | 业务成功，投递 `accepted`；4 个 runtime span 条目 | Langfuse 查询到 6 个 observation，内容关闭矩阵检查通过 |
| Agent `enabled=false` | 业务仍成功；新链路 `not_collected`、0 span 条目 | Langfuse 对应查询为 0 observation |
| Agent `capture_agent=false` | 业务成功、`accepted`；0 个内部 runtime span 条目 | Langfuse 仅 1 个外层 observation |
| accepted 重投保护 | Console 返回 HTTP 409 | 已接受的运行未通过该操作再次发送 |
| 普通无 Agent Workflow legacy | 单次业务运行成功；0 条 managed trace run；graph / tracing 配置未变 | 旧 trace 查询 HTTP 200、输出匹配业务，v2 查询确认已索引；未将该证据外推到 Chatflow |
| 普通 LLM + inline Agent | 首轮业务运行成功；调用方冻结配置匹配；`accepted` | 10 个 observation、1 个 root；普通 LLM 1 次 + Agent LLM 2 次 + 工具 1 次；ID、父子映射、session、token 和费用一致；4768 tokens / USD 0.0009929 |
| 普通 LLM + reference Agent | 首轮业务运行成功；调用方冻结配置匹配；`accepted` | 10 个 observation、1 个 root；普通 LLM 1 次 + Agent LLM 2 次 + 工具 1 次；ID、父子映射、session、token 和费用一致；4766 tokens / USD 0.0009925 |
| inline Agent 单节点 preview | `source_kind=node`，业务成功、`accepted`；graph / tracing 配置未变 | 6 个 observation，其中 GENERATION 2、TOOL 1、AGENT 3；仅 1 个 root；canonical ID 一致、所有 parent 存在、节点深链 observation 存在 |

Langfuse v4 的明确入队 ACK 已按 `accepted` 处理；这仍不是平台可查询的保证。上述可查询结论来自另行执行的 v2 observations GET，运行接口的 `queryable` 仍为 null。查询 usage、费用和内容存在性需指定 `fields=core,basic,model,usage,io,time,metrics`；如检查 metadata，追加合法的 `metadata` group。默认只返回 core/basic，不能把缺省未请求的字段当作内容丢失。验收输出仅包含结构、数值和存在性布尔，不附输入输出正文或 ACK 认证信息。

preview 的前两轮失败暴露了旧 caller 落库顺序及 runtime scope 合成 workflow run ID 的问题，均未生成 trace。修复部署后的最终复验已通过上表业务、投递、平台树和节点深链检查；失败记录保留作为问题定位证据。

以下终态和冻结策略场景也已完成真实 Console API、持久化状态及独立 Langfuse GET 验证：

| 场景 | 操作边界与 API / 持久化结果 | 独立平台查询 |
| --- | --- | --- |
| 运行中变更采集策略 | invocation 尚未 finalized 后关闭 `enabled` 和 `capture_content`；旧 run 保持原 revision 与 `capture_content=true`，最终 accepted；canonical root 为 ok、`message_execution_state=succeeded` | HTTP 200，6 observations / 1 root / 2 generations；所有 parent 存在 |
| 运行中取消并关闭 SSE | invocation 尚未 finalized 时真实 POST stop，随后立即关闭 SSE；worker 持久化终态，accepted；canonical root 为 error、`message_execution_state=cancelled`；底层已完成 span 可仍为 ok | HTTP 200，6 observations / 1 root / 2 generations；root level=ERROR，所有 parent 存在 |
| 模型执行失败 | Console 返回 HTTP 400 / `completion_request_error`，Message 已创建；tracing 最终 accepted；canonical root 与 LLM span 为 error、`message_execution_state=failed` | HTTP 200，4 observations / 1 root / 1 generation；root 与 generation 为 ERROR，所有 parent 存在 |

10/15 最终 API 镜像部署后重新执行独立 Agent 与 mixed inline Workflow：Agent 业务成功并 accepted；inline 业务成功并 accepted，独立 Langfuse 查询得到 10 observations / 1 root，包含 3 GENERATION、1 TOOL、3 AGENT 和 3 CHAIN，native tokens 与 canonical 均为 4768，ID、父关系和节点深链匹配，graph / tracing 配置未变。上述 Agent 最终镜像回归单独确认业务与投递 ACK，未新增该条 trace 的独立平台查询声明。

### 12.3 部署内故障注入：真实数据库，模拟导出传输

| 检查 | 结果与边界 |
| --- | --- |
| 慢导出续租 | PostgreSQL + gevent monkey patch 隔离进程内，租约 2 秒、模拟导出耗时 7 秒；观察到心跳，并发 claim 被阻止，最终 accepted / 1 attempt |
| broker 调度失败恢复 | 真实数据库保存 1 个批次后模拟 broker 失败，reconciler 能发现并恢复；供应商导出使用模拟 transport |
| uncertain 与重投确认 | 自动重投被阻止；无显式确认返回 HTTP 409；确认后的状态变更经过真实 repository 事务 |
| 旧 attempt token | 旧 completion 和旧 heartbeat 均不能覆盖新尝试 |
| 同 attempt 迟到 ACK | 确认成功的 late ACK 能把 lease-expired uncertain 修复为 accepted |

这 5 类检查执行的是隔离进程中的实际 Celery task body，使用真实 PostgreSQL 与 gevent 调度，但不是共享 broker consumer 的完整故障演练；`platform_verified=false`，不能写成真实供应商失败/恢复已验收。

### 12.4 本地检查与 CI 的时间边界

| 检查范围 | 结果 |
| --- | --- |
| 10/15 API 基线回归 | 963 passed（包含完整 Agent App / core ops 回归） |
| 10/16 合并前 API 组合回归 | 在 `1c5303486e` 上 1052 passed；当时本地完整 lint/type 通过，属于合并前历史记录 |
| 10/16 合并后 API 组合回归 | 在 `498309fe0f` 上 1070 passed；完整 `make lint`、`make type-check` 与 5 项 guards 均通过；source、lockfile、formatter 无额外改动 |
| 10/15 Agent 完整本地测试集 | 932 passed / 5 skipped；本轮 runtime 代码未改，未声称 10/16 重跑该完整测试集 |
| 10/15 preview scope 修复相关回归 | 143 passed；随后真实部署复验通过，见上表 |
| 10/15 完整类型检查 | `make type-check` 通过；新增 strict unit tests 为 0 diagnostics |
| 10/15 架构导入规则 | 68 contracts kept / 0 broken |
| 10/15 后端完整 lint | `make lint` 通过；响应契约、禁止 spec mock、新模型基类及 dotenv 检查通过 |

10/15 head `7c08debe42d55c6b3fe305e7105cd7fd97225049` 的 CI 为 61 项成功、5 项跳过、0 失败，Codecov patch 90.90%（目标 88.98%）。这是该历史 head 的结果；10/16 新增修复的最终 CI 结果尚待发布负责人确认，不能沿用上轮全绿结论。

这些结果分别对应表中列出的本地代码版本；最终 CI 以 PR 最新 head 为准。本地测试与类型检查通过不替代真实部署和供应商查询验收。

### 12.5 LangSmith 账号级验收（2026-10-16）

本轮使用已配置的独立测试项目，通过真实 Console API、持久化数据、LangSmith SDK 独立查询及部分实际浏览器操作核对。capability 中 `agent_spans/session/native_usage/native_cost/trace_url/span_url` 为支持声明；不因本次账号验证通过而推断其他账号、区域或部署已经收数。运行接口仍返回 `queryable=null`，`accepted` 仍只是 ingestion ACK。

#### ID、会话与平台类型

| 项目 | LangSmith 语义 | 接入要求 |
| --- | --- | --- |
| Run ID | `uuid5(NAMESPACE_URL, f"dify:{canonical_trace_id}:{span_id}")` | 第三方 UUID 不直接等于 Dify 的 OTel hex span ID；Console accepted 状态可返回该 provider ID |
| Trace ID / parent | 全树 `trace_id` 为映射后的 root run ID；父子通过 `parent_run_id` 和 `dotted_order` 表达 | 比较完整 ID、parent 和层级，不只数节点；跳转使用后端保存 URL |
| 会话 | Dify 会话写入每个 run 的 `extra.metadata.session_id` | LangSmith 顶层 `Run.session_id` 是项目 ID，不能误当聊天会话 |
| Agent 类型 | `run_type=chain`，原类型仍在 metadata 的 `dify.span.kind` | mixed Workflow 的 10 runs 为 6 chain、3 llm、1 tool；不能要求平台原生类型叫 agent |
| 原生指标 | LLM runs 的 prompt/completion/total tokens 与 USD total_cost | 只按 LLM 比较和累加，避免把祖先汇总再加一次；缺失值不等于零成本 |
| 缓存与首 token 时延 | normalization 可在有值时保留 `cache_read_tokens`、`time_to_first_token` metadata | 当前 LangSmith adapter 未写原生 cache token breakdown 或 `first_token_time` 列；本轮没有真实 cache 用量样本，不宣称原生专项已验证 |

#### 已通过范围

下表中的 managed 业务运行均达到 accepted 并通过独立平台查询；disabled、重投保护和历史项目链接读回按各行单独列明证据。有树的业务场景核对 mapped IDs、parents、dotted_order、session metadata、project ID、类型和错误状态。本轮原生 usage 验证限定 input/output/total tokens 和 USD cost，只比较实际存在的 LLM 指标；“深链校验通过”表示 URL 与 SDK 路径匹配且对应 run 存在，实际浏览器验证另列。

| 场景 | 平台结构与指标 | 策略 / 体验证据 |
| --- | --- | --- |
| 独立 Agent UI 第一轮 | 6 runs / 1 root；3 chain、2 llm、1 tool；4671 tokens / USD 0.0009752 | 实际打开 root 深链并展开完整树，进入 Thread 页面 |
| 同会话第二轮 | 6 runs / 1 root；4859 tokens / USD 0.0010128 | 浏览器 Thread 页面显示两轮 root；所有子 run 的会话 metadata 一致 |
| mixed inline Workflow | 10 runs / 1 root；3 次 LLM、1 次工具；4768 tokens / USD 0.0009929 | 继承调用方冻结配置，包含普通 LLM 与两次 Agent LLM；浏览器实际打开节点深链并选中对应 attempt，展示 10 节点树 |
| mixed reference Workflow | 10 runs / 1 root；3 次 LLM、1 次工具；4766 tokens / USD 0.0009925 | 使用调用方配置，节点深链校验通过 |
| 单节点 preview | 6 runs / 1 root；4742 tokens / USD 0.0009854 | `source_kind=node`；节点深链有效，graph、policy 与 provider config 未变 |
| `capture_content=false` | 6 runs / 1 root；4689 tokens / USD 0.0009788 | 没有实际 input/output payload，也没有 synthetic canary；结构和原生 usage/cost 保留 |
| `enabled=false` | `not_collected`；45 秒观察窗口内 0 runs | 业务仍完成，不将未采集误显示为投递失败 |
| `capture_agent=false` | 仅 1 个外层 chain run | 内部 Agent / LLM / tool 未导出；不代表业务没有消耗 tokens 或费用 |
| 运行中冻结策略 | 6 runs / 1 root；4670 tokens / USD 0.0009760 | 动作发生于 invocation 未 finalized 时；关闭策略后旧 run 保持原 revision 与内容策略继续完成 |
| 运行中取消后关闭 SSE | 6 runs / 1 root；4667 tokens / USD 0.0009744 | 外层 root 为 error / cancelled；已完成底层 spans 保留实际状态，终态交接不依赖继续消费 SSE |
| PATCH 修复后新 run | 6 runs / 1 root；4671 tokens / USD 0.0009752 | 新冻结配置含 project_url，trace 与 span 深链均对应平台实际 runs |
| 模型错误 r2，内容开启 | 4 runs / 1 root；3 chain、1 llm，错误状态与 canonical 一致 | root 保留真实已知 query、canary 存在，未制造 output；浏览器实际显示 query 与 Agent message failed |
| 模型错误 r2，内容关闭 | 4 runs / 1 root；错误状态与结构保留 | input/output payload 与 canary 均不存在，错误输入回退没有绕过内容开关 |
| accepted 重投保护 | Console 返回 409 / `tracing_already_accepted` | attempts 未增加；验收结束后三个测试 owner 的策略均恢复 |
| r3 历史 `project_url` 读回 | 三条历史记录的真实 Console GET 全部通过 | 旧项目 A run 返回冻结 A 链接；reference 当前已恢复 A，但历史项目 B run 仍返回 B；旧快照缺 URL 的记录返回 `project_url=null` 且 `trace_url=null`，不取当前配置回填 |

r3 项目链接验证只读取现有运行，没有重新执行业务或补发 trace；前端可按第 8 节使用 span → trace → frozen project 的回退顺序，三个字段均空时隐藏跳转。

内容关闭时，inputs/outputs 仍可能包含 null 包装或 usage_metadata；检查实际业务 payload 和 canary，不能仅因对象非空就认定泄漏。表中的 token/cost 是这几次运行的事实，不要求未来运行固定返回相同数值。

#### 普通 Workflow 兼容与不同项目并发

普通无 Agent Workflow 已通过 LangSmith 旧路径真实验收：同一次业务执行成功，0 条 managed trace run，平台 4 runs / 1 LLM、32 tokens；比对时区分 usage_metadata/file_list 两个旧附加字段后，业务输出匹配，附加元数据仍按旧规则保留。该旧路径继续使用原 ID 和布局，不套用新 managed tree 的 UUID 映射与类型计数。

同 tenant 两个测试 Workflow 使用相同凭据、不同项目，实际执行时间重叠 7.298783 秒，两者均 accepted 且冻结目的地正确。运行结束后 reference 的原项目、凭据密文、graph 和 policy 已恢复，inline 配置未变。两个项目均已独立查到各自的完整 10 runs，mapped IDs、parents、dotted_order、会话、原生 input/output/total tokens 和 USD cost 均匹配；使用各自 native trace ID 反向查询另一项目均为 0，双向隔离验证通过。reference 配置恢复后，浏览器仍能从历史深链打开其原冻结项目中的正确 10 节点树。

首次查询曾因 LangSmith 读取 API 的 HTTP 429 中断，当时两次 ingestion 均已 accepted。随后仅恢复读取同一 run 并完成验证，没有重跑业务或重投 trace；读取 helper 支持在预算内按安全解析的 Retry-After 退避。这不等于已验证 ingestion 写入 429 的重试机制。

#### 两处真实缺陷与修复状态

| 问题 | 修复前证据 | 修复与验收 |
| --- | --- | --- |
| PATCH 后深链丢失 | 已有配置执行 PATCH 后，持久化 project_url 消失；后续 run accepted，但冻结项目 URL 和 trace_url 为空 | `d85211e601` 在验证更新配置后重新解析并持久化当前目的地 URL。真实 PATCH 后新 run 和独立平台深链验证已通过；不回填或改写历史 run 目的地 |
| 早期模型错误没有 root 输入 | 格式化 Message.message 尚为空，但真实 Message.query 已存在；4 runs 的树和 error 状态正确，capture_content=true 却全部 I/O 为空，因此旧 run 整项未通过 | `1c5303486e` 仅在 Agent worker 终态交接、格式化输入确为空时，将已知 query 保留为 root inputs；不伪造 LLM prompt、不写回 Message、不改 legacy TraceTask。真实 SQLite red→green 验证包括空字符串/JSON空对象或数组/null、非空输入保留、空query不造数据和content-off剥离。r2 已在内容开启/关闭两种策略下完成真实平台查询；开启时有已知query且不伪造output，关闭时仍无payload/canary；浏览器另确认开启场景的query与failed状态 |

最初 probe 的读取失败来自验收脚本使用了不适合该查询 API 的 limit=10000；将小型 fixture 查询上限改为 100 后，复用同一条运行完成核对。该脚本问题不计为产品采集失败，也不替代上表两项实际产品缺陷。

### 12.6 Weave 账号 API 验收（2026-10-16）

使用独立的两个合成数据项目，通过真实 Console API、dev Agent 预览页面、持久化 canonical trace 和供应商 `/calls/stream_query` 独立查询核对。一次专门的连通性探针与实际业务运行分别记录，不将探针算作 Agent 端到端验收。

| 场景 | 真实结果 |
| --- | --- |
| Agent UI 两轮 | 同一会话，每轮 6 calls：1 chain、2 agent、2 llm、1 tool；UI 工具计算返回 323，平台原生 tokens 分别为 4694、4894 |
| 内容关闭 | 6 calls、4691 tokens；结构、状态和用量保留，输入输出与实际 canary 均不存在 |
| tracing 关闭 | 业务成功、`not_collected`；45.178 秒内 4 次供应商查询均为 0 calls |
| Agent 内部采集关闭 | 仅 1 个外层 call，0 内部 LLM/tool |
| mixed inline / reference Workflow | 各 10 calls，包含普通 LLM、2 次 Agent LLM、1 次工具调用；分别 4768、4766 tokens，调用方冻结配置与节点归属一致 |
| 单节点 preview | 6 calls、4742 tokens；独立 node source，trace/node 链接对应实际 call |
| 真实模型错误，内容开启 / 关闭 | 各 4 calls / 1 LLM，错误状态一致；开启时 root 保留已知 query，关闭时无输入输出/canary；缺失用量不伪造为原生零用量 |
| 取消并关闭 SSE | 6 calls，root 为 error/cancelled；底层调用的实际终态与 canonical 一致，已报告用量合计 2340 tokens |
| 运行中关闭策略 | 6 calls、4737 tokens；仍按运行开始时冻结的内容开启策略导出，之后恢复原策略 |
| 同 tenant、不同项目并发 | 两个 Workflow 实际重叠 6.422258 秒，各自项目 10 calls；双向查询另一项目均为 0；配置、凭据密文、策略和 graph 全部恢复/保持 |
| 历史目的地 | 当前 reference 恢复原项目后，历史第二项目运行仍返回冻结的 project/trace/node 链接 |
| 脱敏编辑与重投保护 | dev 页面保存现有脱敏 Key 后密文与项目 URL 不变，API 容器未生成 `.netrc`；accepted 重投返回 409，attempts 仍为 1 |

每条通过的查询均核对稳定 call ID、parent、单 root、trace/project/thread 归属、开始结束时间、节点类型、错误状态、canonical 内容及 LLM 原生 token 用量。Weave trace ID 是 canonical UUID 的带连字符形式；call ID 为 `uuid5(trace_uuid, span_id)`。该批次业务会话写入 `thread_id`，未写 `turn_id`；后续 managed 映射已补齐轮次，历史样本不追溯改写。`native_cost=false`；保留的 Dify USD metadata 和供应商自行定价的费用不作为原生成本导出验收。

配置修复 `836ede2984` 移除了 POST/PATCH/GET 中对 legacy exporter 构造的依赖，改用隔离认证的只读验证，并保存规范化 entity/project/project_url。该提交目标测试 109 项、更广单测 1784 项、完整 lint/type/guards 均通过；CI 结果按对应 PR head 核对。普通应用 legacy exporter 的 SDK 登录生命周期未在这次修复中重构，其既有单元测试通过，但没有本轮 Weave 账号的普通 Chat/Workflow 平台回归证据。

后续审核修复 `58d236199e` 让 Workflow/preview 源记录、恢复及相关归属判断使用配置的存储 repository，支持 LogStore 关闭 SQL 双写；完整 tenant/app/source 校验保留，远端读取不占 SQL 事务，已存在的冻结快照重入不依赖 LogStore。163 项定向测试和 1829 项组合单测、lint/type/guards 通过，使用真实 LogStore repository/SDK 解码及传输边界替身验证无 SQL 源行场景。dev r2 对既有 Agent、Workflow、preview 状态与链接读回通过，跨应用/错误节点返回 404，accepted 重投仍为 409；dev 保持原 SQL 存储配置，没有声称真实 SLS 平台验收。

查询验收脚本最初请求 `Accept: application/json`：非空结果是 JSON 数组，空结果在此平台返回了非法的单个 `]`。脚本改用供应商支持的 `application/jsonl`，严格区分合法空流与错误响应，并只读复验同一批运行；没有为消除查询错误重跑业务或重投 trace。这属于查询脚本/平台响应格式兼容记录，不是 Dify ingestion 失败。

dev 的 Agent 监控页已实际显示 Weave 使用中、内容/Agent 开关开启、原生费用不支持及正确项目链接；配置表单回显脱敏 Key、entity/project 和两个端点，实际保存成功。Weave 的项目页和 trace 页仍需账号方案/访问权限处理；平台 UI 的树展示、Threads turns 和网页跳转未通过验收。跨 tenant、真实 ingestion 429/5xx、凭据撤销、普通 legacy 应用仍为后续专项。

### 12.7 Databricks UI 与平台验收（2026-10-16）

配置和业务执行均通过真实 Dify UI 发起，使用隔离的 Agent、inline Workflow 和 reference Workflow；没有修改原始用户 Workflow。三个 owner 的 PAT 创建、保存并启用、masked GET 与原样 PATCH 均通过，密钥保持加密存储，项目链接正确。独立校验只读查询 Dify 状态、frozen config 与平台 metadata / 完整 artifact，不以 `accepted` 代替平台数据验证。

| 场景 | 平台核对 |
| --- | --- |
| Agent 同会话两轮 | 各 6 spans、2 LLM / 1 tool；tokens 分别 4701、4911，原生 Session 分组实际显示两条 trace、合计 9612 tokens |
| mixed inline Workflow | 10 spans、3 LLM / 1 tool，4768 tokens；包含普通 LLM 与 Agent 内部过程 |
| mixed reference Workflow | 10 spans、3 LLM / 1 tool，4766 tokens；冻结调用方 Workflow 的采集策略，不继承被引用 Agent 当时关闭的内容采集策略 |
| Agent 内容关闭 | 6 spans、4703 tokens；所有输入输出和合成标记均不存在，用量仍保留 |
| inline Agent 单节点预览 | 6 spans、2 LLM / 1 tool，4742 tokens；独立 node source 与调用方快照一致 |
| Agent 内部采集关闭 | 仅 1 个外层 CHAIN，无内部 LLM / tool |
| tracing 总开关关闭 | Dify 返回 `not_collected`；限定 experiment / session / 时间范围连续 45 秒、4 次查询均无 trace |
| 真实模型错误，内容开启 / 关闭 | 各 4 spans，root 与 LLM 均 ERROR；开启时保留真实 query，关闭时无 I/O / 合成标记，缺失 usage / cost 不补造 |
| 运行中改变内容策略 | 受控长请求的策略更新时间早于终态约 17.5 秒；仍按开始时冻结的 `capture_content=true` 导出 14 spans、14972 tokens，保留合成标记 |

平台逐项核对 canonical span ID、parent、单 root、OTel trace context、返回的 provider trace ID、experiment/session、时间、模型、内容与终态；LLM 原生 input/output/total tokens 和有效 USD 成本及 trace 聚合均匹配。未补造缺失值，不将 cache token 细分、首 token 时延或非 USD 成本算作本轮原生验收。

在 Databricks UI 中明确选择 **In the Experiment**。SDK 3.11.1 的 V3 metadata、V2 上传凭据兼容路径和 signed artifact 上传实际贯通；独立回读使用 V3 metadata、V2 下载凭据和完整 artifact。此证据只覆盖该 workspace 的 experiment storage，不外推到 UC 绑定、UC OTLP、私有网络或所有部署版本。配置可读校验不是存储模式兼容证明。

本轮 UI 发现 `selectedTraceId` 只打开 Databricks trace 列表，已将新导出的 `trace_url` 修为 `traces?selectedEvaluationId=<returned_trace_id>`，并实际验证直接打开详情。`span_url=false` 保持，不伪造节点深链；该次修复未修改 OSS MLflow 链接，后续独立验收不复用 Databricks 路由。历史已冻结的运行链接不追溯改写。

前端缺陷单独跟踪：[DIFY-2996](https://linear.app/dify/issue/DIFY-2996) 记录真实模型错误后预览只保留空助手占位；[DIFY-2997](https://linear.app/dify/issue/DIFY-2997) 记录工具执行阶段点击停止仅结束 UI、没有发出 stop 请求。两次停止尝试的后端业务实际成功，平台状态与 canonical 一致，但不计为取消语义通过。短冻结尝试的配置提交晚于终态也不计在途变更通过；上表使用单独长请求的服务端时间证据。

已知的 core tool 调用异常现在会标记对应的原生工具 span 为 ERROR，同时保留 Agent 收到错误后继续处理的行为。真实 UI 工具超时复验中，工具 ERROR、业务 root OK；内容开启与关闭分别为 6 spans / 4755、4758 tokens。关闭内容时仍有错误状态，但无 I/O / 合成标记，诊断会被隐私策略概括，不承诺保留原始错误类型或正文。成功返回文本即使包含“error / timeout”也不会据此误判为工具错误。

配置隔离 / 可空密钥、深链与节点父运行解析修复通过 2023 项相关 API 测试，其中新增 40 项节点解析 SQL / LogStore 边界用例；工具错误修复通过完整 Agent runtime 950 项测试 / 5 项跳过。对应 lint / 类型检查及新增代码门禁通过。真实账号中的 OAuth M2M、UC、不同目的地并发、凭据撤销、ingestion 429/5xx、普通 legacy Chat/Workflow 仍未验收；Databricks 通过范围不能替代 OSS MLflow 验收。

### 12.8 Opik UI 与平台验收（2026-10-16）

配置创建、负向保存、masked-key PATCH 和业务运行均从真实 Dify UI 发起，使用隔离的 Agent、inline Workflow 和 reference Workflow；独立读取 Dify 冻结配置、canonical trace，以及 Opik exact trace / 全部分页 span。Opik SDK 为 1.11.2；平台查询使用独立、无 Console cookie 的认证会话。`accepted` 本身不作为平台树、内容或费用验证的依据。

| 场景 | 独立平台核对 |
| --- | --- |
| Agent 同会话两轮 | 各 6 spans、2 LLM / 1 tool；4894 / 5094 tokens，USD 0.0010198 / 0.0010598；稳定 ID、parent、session 与 canonical 一致，整数工具输出按 JSON 字符串语义核对 |
| mixed inline Workflow | 10 spans、3 LLM / 1 tool；4768 tokens、USD 0.0009929，包含普通 LLM 与 Agent 内部过程 |
| mixed reference Workflow | 10 spans、3 LLM / 1 tool；4766 tokens、USD 0.0009925，按调用方冻结配置投递至独立项目 |
| Agent 内容关闭 | 6 spans、4698 tokens、USD 0.0009826；全部 I/O 与合成标记不存在，用量和费用仍匹配 |
| Agent 内部采集关闭 | 仅 1 个外层 CHAIN，无内部 LLM / tool，不把汇总值伪装为原生 LLM usage / cost |
| tracing 总开关关闭 | Dify 为 `not_collected`；限定项目与时间范围连续 46.988 秒、4 次成功完整分页读取均无 trace |
| inline Agent 单节点 preview | 6 spans、2 LLM / 1 tool；4742 tokens、USD 0.0009854，独立 node source 与完整树一致 |
| 真实模型错误，内容开启 / 关闭 | r3 各 4 spans；顶层 Trace、root span 与 LLM 的原生错误一致。开启时保留已知 query，不伪造 output；关闭时无 I/O / 合成标记。无有效用量时不补造 token / cost |
| 已处理的工具超时，内容开启 / 关闭 | 各 6 spans；4949 / 5362 tokens、USD 0.0010398 / 0.0011254。工具 ERROR，root span 与顶层 Trace 保持成功；关闭内容时无 I/O / 合成标记 |
| 运行中改变内容策略 | 14 spans、6 LLM / 5 tool；14960 tokens、USD 0.003189。服务端策略更新时间早于终态 5.550323 秒，仍按开始时冻结的内容开启策略导出，保留 I/O 与合成标记 |
| 普通 Workflow legacy 兼容 | 修复后新 UI 运行完整读取 4 spans、1 LLM、32 tokens；没有 managed run，原 graph / config 不变 |

三处配置的创建、启用、加密存储、masked GET、项目链接与规范化 workspace 均已只读核对。Agent 将 workspace 改为 `default` 并原样提交脱敏 Key 的 PATCH，仍解析到实际 workspace、保留可解密密钥与正确项目 URL。错误 Key、有效 Key 加不可访问 workspace 两个 UI 负向保存均显示安全错误，未创建 Opik 配置、未改变当前 provider。每个测试应用此前四家 provider 的配置哈希保持不变。

inline 与 reference 使用同一 workspace 的两个独立项目，真实执行重叠 7.797223 秒。两者调用方冻结 revision、采集策略和被调用 Agent ID 均匹配；分别完整读取两个项目，均只找到自身运行 1 条，另一运行的 mapped ID 均为 0。该双向隔离证据不外推到跨 tenant 或不同凭据场景。

另一个长请求从开始就冻结了内容关闭策略，完整读取 14 spans / 14946 tokens、USD 0.0031842，全部 I/O / 合成标记不存在；它只计为长请求隐私样本，不计为在途策略改变成功。上表在途场景使用后续独立长请求的服务端时间和冻结策略证据。

模型错误测试临时修改 normal draft；恢复后已通过语义比较确认真正发布快照版本与草稿内容回到基线。`active_config_is_published` 表示草稿是否与 active snapshot 一致，不应把该标记变化等同于发布版本内容被 tracing 修改；恢复检查排除 revision UUID 和该标记，只输出版本、内容哈希与布尔值。

本轮发现并修复两处真实导出缺陷：首条运行的整数工具输出不符合 SDK I/O schema，在 HTTP 前被拒绝；JSON 兼容映射修复后，新 UI 运行已通过完整查询。另一次模型错误的 root / LLM spans 已含错误，但顶层 Trace 缺少 `error_info`；r3 仅按 canonical root 补齐，内容开启 / 关闭的新运行均通过。最初失败运行与旧已接受的错误 trace 保留，不重投、不回填，也不将其记作修复后通过。

普通无 Agent Workflow 的 legacy 兼容性已在修复后取得独立平台证据。最初一次业务成功、32 tokens、0 条 managed run，但完整限定时间窗口内未发现平台 trace，旧容器日志已不可取，不能将其直接归为同一失败原因。第二次新 UI 运行在正常部署的 worker 中留下明确异常：优先使用的 external trace ID 可被 UUID 解析但不是 UUIDv4，旧 Opik 转换函数在 HTTP 前拒绝。`2654ecdeca` 保留有效 UUIDv4 的原映射，对其他 UUID 或外部标识复用确定性 seed 转换后生成 UUIDv7；缺失 ID 保留原随机行为。修复经正常部署后，第三次实际 UI 运行成功；独立读取 4 spans、1 LLM、32 tokens，完整核对 ID / 父链、输入输出、模型、metadata、用量与时间，且没有产生 managed run、没有改变原 graph / config。原生 UI 也显示同一条 4 spans / 32 tokens 的 trace。两条旧记录保留，不重投、不回填。

四项修复分别为配置隔离 `d486b2d837`、I/O 兼容 `9ef5e35d59`、root 错误映射 `89a1e2572c`、legacy external ID 兼容 `2654ecdeca`；dev 仅 cherry-pick 对应提交，保留自身差异。共通过 2156 项相关 API 测试，其中新增 14 项 ID 回归覆盖真实 SQLite owner / 节点 repository 与 Opik producer / typed batch；70 项 legacy ID / 兼容定向测试及完整 lint / 类型检查和变更门禁通过。没有改动 Console DTO、provider capability 字段、runtime、迁移或依赖锁。实现提交 `2654ecdeca` 的 64 项有效 CI 检查全部结束：59 项通过、5 项跳过，patch coverage 91.99%、project coverage 89.17%。dev `705305ae45` 已经正常构建、部署，API、全部 worker 与 runtime 的实际版本和持久采集开关核对通过；已安装 legacy Opik 文件与提交内容一致。

Opik 的 `trace_url=false`、`span_url=false` 保持，UI 使用 frozen `project_url` 回退。供应商项目 by-name 跳转已实际打开正确项目；这不等于后端返回了 trace 或节点深链。原生 usage / USD cost 核对不涵盖 cache token 细分或首 token 时延。自托管环境、跨 tenant、真实 ingestion 429/5xx、凭据撤销和取消语义仍未实测；其他场景只有取得独立证据后才计入通过。

reference Agent 日志弹窗仍未显示 tracing 面板，沿用 [DIFY-2985](https://linear.app/dify/issue/DIFY-2985) 跟进；平台收数和后端 node alias 可用不替代该前端入口验收。取消仍受 [DIFY-2997](https://linear.app/dify/issue/DIFY-2997) 的停止请求问题限制，本轮没有将 UI 停止展示当作后端取消成功。

### 12.9 Phoenix 私有匿名实例验收（2026-10-18）

本轮使用 Phoenix 20.23.0 私有匿名实例，配置和业务均从 Dify UI 发起；独立按真实业务 source 与冻结目的地，读取 Phoenix 完整分页 trace / spans 并核对 canonical。共 21 条业务记录：19 条 managed trace / 139 spans，1 条普通 Workflow legacy trace / 5 spans，另 1 条 disabled 业务没有原生 trace，合计 20 条业务原生 trace / 144 spans。旧配置校验产生的 1 条 `api_check` span 单独保留，不计业务；修复后的保存与配置 GET 没有新增测试 span 或项目。

覆盖 Agent 同会话两轮、mixed inline/reference Workflow 并发与双向项目隔离、reference 继承调用方策略、独立节点 preview、Agent 与 Workflow 内容关闭、仅外层采集、模型错误及已处理工具错误的内容开关组合。普通 Workflow legacy 独立读取 5 spans / 32 tokens，不计为 managed；关闭总开关的独立会话在 45.024 秒内完成 4 次完整原生查询，均为 0。ID、父子树、session、kind、状态、时间、模型、内容及 LLM token usage 按实际导出范围核对；未报告的用量保持缺失，不用外层汇总伪造 LLM usage。

运行中变更目的地和内容策略分别取得服务端时间证据：旧运行保持原项目，且内容从关闭改为开启后，运行开始时冻结的关闭策略仍阻止 I/O、工具参数及合成标记外发。特殊项目名的编码跳转、保存规范化、错误 base URL / ingestion URL 的 POST/PATCH 拒绝和 masked-key 保留均已验证。项目与策略并发修改曾使策略请求返回 409，UI 回滚，策略未被该请求改写；修改晚于业务终态的样本也保留，不算在途验证通过。恢复后的最终正常请求为 6 spans / 4703 tokens；四个应用的旧 provider 配置、模型、绑定与发布语义保持。inline 草稿仅节点选中状态及画布位置有差异，raw graph 不声明完全相同。

这些结果是 Phoenix 解码后的 REST 表示核对，不是 raw OTLP 字节全等；metadata / tool parameters 的展开及空值省略按实际查询表示比较。`native_cost=false`，Dify USD metadata 不作为平台原生成本；`trace_url=false`、`span_url=false`，只回退冻结的项目链接。私有 UI 经明确的本地 origin 映射验证项目跳转，不代表内部容器域名可由任意浏览器直达。受前端 Key 必填缺陷 [DIFY-3000](https://linear.app/dify/issue/DIFY-3000) 限制，本轮 UI 使用合成占位 Key；空 Key 的 UI 保存尚未验收，合成值也不构成真实鉴权测试。Phoenix Cloud、真实 Key 权限与撤销、ingestion 429/5xx、跨 tenant 和取消仍未验收，也不外推到独立的 Arize provider。

### 12.10 未验证范围与后续前端验收

- 普通无 Agent Workflow legacy 已分别取得 Langfuse、LangSmith、Opik、腾讯云、OSS MLflow 与 Phoenix 平台证据；普通 Chatflow 未补独立真实平台证据。LangSmith 的同 tenant 两应用不同项目并发、双向零串数和恢复配置后的历史深链已验证；Opik 的独立项目并发证据见 12.8，只有项目链接回退，不据此声明 trace 深链。
- Arize 仍没有平台端到端收数 / 查询验收，阿里云暂缓。Weave 平台 UI 的后续专项、OSS MLflow / Phoenix 的真实账号鉴权及各供应商列明的专项仍待完成；匿名实例、实现或协议测试不等于账号已验证。
- LangSmith 的原生 cache token breakdown 和 first-token-time 专项未验证，当前相关值仅在存在时保留 metadata；`native_usage=true` 不代表所有 usage 细项全支持。
- 跨 tenant 隔离、ingestion 写入 429 和凭据撤销没有在本轮 LangSmith 账号上执行；本次遇到的查询 429 不替代投递限流验收。公共层 / 合约测试不能写成 LangSmith 平台全部验收完成。
- Agent 调用子 Workflow：只保证外层工具 span；内部节点仅关联，不承诺跨 Workflow 完整同树。
- dev 新增 Web 页面中已核对上一节列出的 Agent 配置展示和保存；其他权限、状态轮询、Workflow 继承展示及供应商网页跳转需继续按前端任务验收，不将局部页面操作视为全部前端功能通过。
- 全局 feature 已通过真实 Console HTTPS 回读：不传 app/provider 参数，在隔离 Agent 未选 provider 的情况下分别返回 false、true，dev 的 `model_billing_source` / `model_billing_migration_status` 字段保持。常规 base + override 两文件配置已核对 9 个相关开关持久为 true，无需临时 gate overlay；main 默认 false 未改。此轮结果不替代后续 CI 部署完成后的版本核对。
- UI 验收中，原已配置 Agent 的不可用提示在开启后消失；通过页面发起的一次真实工具调用成功，Weave 独立查询得到 6 calls、2 LLM / 1 tool、4691 tokens，canonical ID、parent、session、内容及深链检查通过。DIFY-2995 对应的全局字段消费已出现在最新 dev 前端代码中；任务完整验收和状态另行跟踪，不能以 Databricks 成功主流程替代全部空配置 / 权限场景。

## 13. 定稿检查与代码定位

发布前重新核对以下源文件；运行服务、schema 和本文如有差异，应先修正契约再更新文档：

- 配置/能力 controller：`api/controllers/console/agent/tracing.py`
- 运行/重投 controller：`api/controllers/console/agent/tracing_runs.py`
- 普通 App 策略与凭据：`api/controllers/console/app/app.py`、`api/controllers/console/app/ops_trace.py`
- 运行状态/重投：`api/services/tracing/service.py`
- 冻结配置及投递状态：`api/repositories/application_trace_repository.py`
- Provider 能力：`api/services/tracing/provider_dispatch.py`
- 全局部署 gate：`api/controllers/console/feature.py`、`api/services/feature_service.py`
- 生成契约：`packages/contracts/generated/api/console/{agent,apps,features}/`

运行服务已提供 `retry` 和 `status.capture_agent`，登录后的 features 已提供不依赖 app/provider 的 API gate，原能力接口字段保留兼容；最新 dev 前端已消费全局字段，DIFY-2995 的完整矩阵另行验收。已完成的实测、部署标识与未验证范围按第 12 节分别记录。runtime gate 目前仍无远程探测，不能把 API gate=true 写成完整链路已启用。
