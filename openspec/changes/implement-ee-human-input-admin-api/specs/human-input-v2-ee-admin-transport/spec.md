## ADDED Requirements

### Requirement: EE Dashboard MUST 通过 Kratos HTTP 暴露完整的 Human Input admin API

EE backend MUST 在 `dify.enterprise.api.enterprise` package 中定义 `EnterpriseHumanInputAdmin` Protobuf service，并 MUST 使用 Kratos 的 Protobuf HTTP code generation 和 `google.api.http` annotations 暴露 API summary 中的十二个 `/v1/dashboard/api/human-input/*` endpoint。该 capability MUST NOT 新增 gRPC server registration，也 MUST NOT 引入 gRPC-Gateway。

#### Scenario: Kratos 注册 Human Input admin HTTP service
- **WHEN** enterprise server 完成 API generation 与 HTTP composition
- **THEN** 十二个 service method 对应的 Kratos HTTP handler MUST 全部注册，并 MUST 由现有 Kratos middleware chain处理 validation、authentication 与 error encoding

#### Scenario: 实现者尝试增加 gRPC transport
- **WHEN** Human Input admin service 被接入 enterprise server
- **THEN** implementation MUST NOT 注册对应 gRPC server，也 MUST NOT 增加 grpc-gateway proxy 或 gateway-specific mapping

### Requirement: Transport MUST 在调用 Dify client 前完成强类型校验与默认值处理

Protobuf contract MUST 保留 API summary 中的 provider、status、read-only effective deployment `DISABLED / WEBHOOK / STREAM` event transport mode、result、removal reason、credential、Contact、identity、binding、sync run 与 pagination shape。Channel upsert/test request MUST 使用独立的provider credential update messages，response MUST 使用只包含allow-listed non-secret identifiers的credential messages；两者不得复用。Channel upsert/test request MUST NOT包含event transport mode或tenant-selectable supported modes。Required enum zero value、ID、CAS version、first-create required secret replacement、page 和 limit MUST 在 transport boundary 被拒绝；省略 page/limit 时 MUST 分别使用 `1` 和 `20`。

#### Scenario: 请求包含非法 enum 或 CAS token
- **WHEN** 请求包含 unspecified required enum、空 ID、非正 config version 或越界 pagination
- **THEN** Kratos validation MUST 在调用 Human Input use case 与 Dify internal client 之前拒绝请求

#### Scenario: Latest results 未传 pagination
- **WHEN** 管理员指定真实 result bucket 但省略 page 和 limit
- **THEN** EE service MUST 向 Dify client 传递 page `1` 与 limit `20`

#### Scenario: Request attempts to set event transport mode
- **WHEN** a Channel upsert or test request contains an event transport mode override
- **THEN** Kratos validation MUST reject the request before the Human Input use case or Dify internal client is invoked

### Requirement: Administrator identity MUST 只由EE audit boundary拥有

所有 Human Input admin endpoint MUST 复用 EE Dashboard 的 authentication 与 enterprise-administrator authorization。EE MUST 从可信 request context提取Dashboard User，并把human actor、operation、target、operation ID与outcome持久记录在EE-owned audit boundary。Public request body MUST NOT 接受actor ID或Organization ID；service-to-service request MUST 只向Dify传播operation/correlation metadata，不得传播EE User ID或要求Dify保存external principal。Dify Human Input internal surface MUST 使用能够识别EE caller的service credential、mTLS identity或等价caller-scoped authentication，避免其他internal caller绕过EE audit直接执行同权mutation。

#### Scenario: 未认证调用 admin endpoint
- **WHEN** 请求没有有效 Dashboard session/token 或不具备 enterprise administrator 权限
- **THEN** Kratos middleware/service MUST 返回现有 `401/403` error，且 MUST NOT 调用 Dify internal API

#### Scenario: 已认证管理员执行 mutation
- **WHEN** 管理员 upsert Channel、触发 sync 或修改 binding
- **THEN** EE use case MUST 在调用Dify前记录actor与operation ID，并在结果明确后记录success或rejected outcome；Dify request MUST 不包含human actor，且EE-originated mutation MUST 不填充Dify Account-specific actor字段

#### Scenario: Mutation发生ambiguous timeout
- **WHEN** EE无法判断Dify是否已接受mutation
- **THEN** EE audit MUST 将outcome记录为`unknown`并关联correlation ID，MUST NOT blind retry；后续MAY通过current-state read解析或补充该outcome

#### Scenario: 非EE caller尝试调用Human Input internal mutation
- **WHEN** caller不能证明EE-specific service identity，即使其持有其他generic internal credential
- **THEN** Dify MUST 拒绝该mutation，使所有EE admin human-actor audit保持完整

### Requirement: Secret-bearing transport MUST 通过optional replacement表达replace-or-preserve且不得泄露secret

EE public Protobuf中的provider credential update message MUST 使用optional plaintext string表达secret replacement：字段present时MUST为非空replacement；更新已有integration时字段omitted MUST表示preserve。首次创建integration时，所有provider-required secret MUST present，缺失时EE transport/service MUST在调用Dify前拒绝请求。EE MUST把public omission语义映射为EE→Dify internal typed contract中的显式preserve command，且MUST NOT尝试读取现有secret。Public response credential message MUST只包含allow-listed non-secret identifiers，并且public Protobuf、OpenAPI与TypeScript生成物MUST NOT定义或引用`SecretUpdate`、`PreserveOriginalValue`或`preserve_original_value`。EE不缓存、持久化、解密或回显secret；response、Kratos error、structured log、trace attribute与generated API documentation MUST NOT包含plaintext、masked value、ciphertext或hash-derived secret。

#### Scenario: 管理员保留已存在 secret
- **WHEN** update request 对已有integration省略一个secret字段
- **THEN** EE MUST 将省略映射为Dify internal preserve operation，并 MUST NOT 尝试读取现有secret

#### Scenario: 首次创建缺少必需 secret
- **WHEN** first-create request省略provider-required secret或提供空replacement
- **THEN** EE MUST在调用Dify前返回稳定的sanitized invalid-request error，且 MUST NOT 将credential内容写入日志

#### Scenario: Channel response返回credential projection
- **WHEN** Dify返回configured Channel及其provider credential projection
- **THEN** EE response MUST只包含provider的non-secret identifier字段，并 MUST NOT包含任何secret、masked value、ciphertext或hash-derived value

### Requirement: EE transport MUST 稳定映射 Dify internal errors

EE MUST 把 Dify typed internal error映射为既有 enterprise error：invalid input 为 `400`，unauthenticated/unauthorized 为 `401/403`，not configured/not found 为 `404`，stale revision或 binding conflict 为 `409`，provider diagnostic按 service contract 返回 safe typed response，unexpected upstream failure 为 sanitized `502/500`。EE MUST NOT 根据 error message string重新推断业务语义。

#### Scenario: Dify 返回 stale revision
- **WHEN** internal client 收到稳定的 stale-revision error code
- **THEN** Kratos transport MUST 返回 conflict error并保留 correlation context，但 MUST NOT 自动重试 mutation

#### Scenario: Dify internal API 不可用
- **WHEN** upstream timeout、connection failure 或 malformed response发生
- **THEN** EE MUST 返回 sanitized upstream failure并记录 endpoint operation、latency 与 correlation ID，不得记录 request secret或完整 response body

### Requirement: EE Human Input admin surface MUST 保持 Organization-scoped 与 narrow

该 service MUST NOT 增加 member/workspace CRUD、Platform/External Contact lifecycle、workspace override、Email provider、node migration、notification center、task list 或 CLI todo endpoint。Organization scope MUST 由 EE deployment和 trusted Dify internal contract确定，而不是来自任意 client-supplied Organization ID。

#### Scenario: 客户端请求 workspace-owned operation
- **WHEN** EE admin client需要 Platform/External Contact、workspace override 或 Email provider mutation
- **THEN** `EnterpriseHumanInputAdmin` MUST 不提供相应 service method，并 MUST 保持这些能力由 workspace-owned surface管理
