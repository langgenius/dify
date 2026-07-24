## ADDED Requirements

### Requirement: Public Email form page MUST be isolated from authenticated Contact approval
系统 MUST 将 Email proof approver 与 Dify 登录 Contact 的审批页面、API namespace、controller、request DTO 和提交鉴权拆开。`/api/form/human-input/<form_token>` MUST 只服务 `External contact`、one-time Email 和未命中 Contact 的 dynamic Email 等 Email proof approver；该 public Email form API MAY 直接基于有效 `form_token` 返回完整 form definition，但读取 MUST NOT 授予 submit authority。`workspace contact` 与 `Platform contact` MUST 使用独立的登录页面，并 MUST 通过 `/console/api/form/human-input/<form_token>` 提交，MUST NOT 通过 public Email endpoint 完成审批。

#### Scenario: Dify 登录 Contact 使用独立页面
- **WHEN** a `workspace contact` or `Platform contact` opens an approval task
- **THEN** 系统 MUST 使用独立的 authenticated page and console API surface，并 MUST 使用 Dify account session 验证提交；该页面 MUST NOT 调用 public `access-request`

#### Scenario: Authenticated Contact 通过 console endpoint 提交
- **WHEN** a `workspace contact` or `Platform contact` submits an approval
- **THEN** the client MUST call `POST /console/api/form/human-input/<form_token>`，the handler MUST validate the Dify session and current Contact-backed approver grant，并 MUST reject `otp_code` or `challenge_token`

#### Scenario: Email approver 读取 public form
- **WHEN** an `External contact` or one-time email recipient opens `GET /api/form/human-input/<form_token>`
- **THEN** 系统 MAY 直接返回完整 form definition, but MUST NOT treat that read as submit authorization

#### Scenario: Authenticated Contact token 不能用于 public Email page
- **WHEN** a token or grant issued for a `workspace contact` or `Platform contact` is presented to `/api/form/human-input/<form_token>`
- **THEN** the public Email form handler MUST reject it without falling back to Dify session approval logic

#### Scenario: Email proof token 不能用于 authenticated Contact page
- **WHEN** a public Email form token is presented to the authenticated Contact approval surface
- **THEN** the console handler MUST reject it without invoking OTP submission logic or forwarding the request to the public web handler

### Requirement: Public Email page MUST support OTP request and submit-time OTP verification
对于 public Email page 服务的每个 approver，系统 MUST 提供 `access-request` API 用于获取提交使用的 OTP。系统 MUST 在 `POST /api/form/human-input/<form_token>` 时校验同一请求携带的 `otp_code + challenge_token`；public submit MUST NOT 接受 Dify session 作为该 Email grant 的替代 proof，系统 MUST NOT 再要求单独的 `access-confirm` API。

#### Scenario: 请求 OTP challenge
- **WHEN** an email-based approver calls `POST /api/form/human-input/<form_token>/access-request`
- **THEN** 系统 MUST 发送 OTP 到 token 绑定的 email recipient，并返回 `challenge_token`、`resend_after_seconds` 与 `expires_in_seconds`

#### Scenario: 同一请求内完成 OTP 与 submit
- **WHEN** an email-based approver submits the form payload together with a valid OTP and current Challenge Token in `POST /api/form/human-input/<form_token>`
- **THEN** 系统 MUST 允许在同一请求中完成 OTP 验证与 submit，但 MUST 继续执行完整的 task / approver / state 校验

#### Scenario: 缺少 OTP 的 email recipient 不能提交
- **WHEN** an email-based approver submits `POST /api/form/human-input/<form_token>` without a valid `otp_code`
- **THEN** 系统 MUST 拒绝该提交

### Requirement: Public Email upload token MAY rely on form token, but submit MUST revalidate Email proof
系统 MAY 继续允许 public Email page 的 `upload-token` 仅凭 `form_token` 工作，以支持“先填写 / 上传，后审批提交”的交互。系统 MUST 在 public `submit` API 中重新校验当前 task 状态、当前 Email grant / contact 状态，以及提交时提供的 OTP Challenge。`form_token` 本身 MUST NOT 单独充当 submit 权限；authenticated Contact page 的 upload and submit flow MUST 由其独立 surface 定义。

#### Scenario: 未验证 OTP 也可以申请 upload token
- **WHEN** an email-based approver calls `POST /api/form/human-input/<form_token>/upload-token` before completing OTP verification
- **THEN** 系统 MAY 允许该请求，只要 form token 和当前 task 状态仍然有效

#### Scenario: contact email 变更后旧 OTP 失效
- **WHEN** a recipient's contact email changes after one OTP was issued
- **THEN** 系统 MUST 拒绝继续使用旧 OTP 完成 submit

#### Scenario: task 已完成后再次 submit
- **WHEN** a second caller submits `POST /api/form/human-input/<form_token>` after the task is already `SUBMITTED`
- **THEN** 系统 MUST 返回 task 已完成类错误，而 MUST NOT 覆盖首个成功提交结果

### Requirement: Runtime approval persistence MUST separate approver grant, submission actor, endpoint, and proof audit
系统 MUST 使用 form-scoped Approver Grant 表达“该 form 授权给谁”，并 MUST 将 Grant subject 限定为 `Contact / EndUser / EmailAddress`。系统 MUST 使用 Submission actor 表达“实际谁完成了提交”，并 MUST 将 actor 限定为 `Account / EndUser / EmailAddress`。Delivery Endpoint MUST 独立表达实际投递或交互入口。成功提交使用的 verified authorization proof MUST 归属于 append-only `submission_authorized` AuditEvent，Submission MUST 引用该 AuditEvent，而 MUST NOT 复制 proof payload。

`ApproverGrant.subject_key` MUST 只作为 form-scoped canonicalization key，格式 MUST 是 `contact:<contact_id>`、`end_user:<end_user_id>` 或 `email_address:<sha256(normalized_email)>`。系统 MUST NOT 把该 key 当成独立 identity；授权判断 MUST 继续读取 Grant 的 discriminated subject 字段和 current identity state。

#### Scenario: Contact-backed grant 通过 Account session 提交
- **WHEN** a logged-in workspace or Platform contact submits a form successfully
- **THEN** the Approver Grant MUST remain Contact-backed, the Submission actor MUST be the resolved Account, and the referenced AuditEvent MUST record account-session proof

#### Scenario: IM identity 提交解析为 Account actor
- **WHEN** an approver submits from an IM interaction
- **THEN** 系统 MUST 通过 current IM identity、binding 和 Contact 解析 Account actor，MUST NOT 把 IM identity 作为 Submission actor；the referenced AuditEvent MUST retain the IM proof snapshot

#### Scenario: IM current rows 删除后 proof 仍可审计
- **WHEN** an IM identity or binding used by a successful submission is later deleted or replaced
- **THEN** the authorization AuditEvent MUST retain `provider + platform_tenant_id + platform_user_id` as the external identity key, the historical integration / identity / binding identifiers as internal trace, and the authorization-time display name and email for display; name and email MUST NOT participate in authorization

#### Scenario: Email OTP 提交
- **WHEN** an External Contact or one-time email approver submits with a valid OTP
- **THEN** the Submission actor MUST be the verified EmailAddress actor and the referenced AuditEvent MUST retain the OTP challenge reference and verified email hash without storing the plaintext OTP

#### Scenario: Raw proof secrets 不得持久化
- **WHEN** the system persists a successful or rejected authorization audit event
- **THEN** it MUST NOT persist plaintext OTP codes、session cookies、IM callback signatures or API tokens

### Requirement: Service API MUST require explicit `user` on both GET and POST
系统 MUST 在 `/v1/form/human-input/<form_token>` 上提供 trusted app-token form API。GET 与 POST 两条路径都 MUST 显式提供 `user`，并且 MUST 以该 `user` 物化出的 request-scoped `end_user` 作为 access decision 的唯一 end-user context。

#### Scenario: GET 携带 query user 读取 form
- **WHEN** a caller invokes `GET /v1/form/human-input/<form_token>?user=<string>` with a valid app token
- **THEN** 系统 MUST 以该 `user` 对应的 request-scoped `end_user` 校验访问权限，并在允许时返回 form definition

#### Scenario: GET 不带 user 被拒绝
- **WHEN** a caller invokes `GET /v1/form/human-input/<form_token>` without `user`
- **THEN** 系统 MUST 拒绝该请求，而 MUST NOT 回退到 API token holder identity

#### Scenario: POST 继续以 JSON user 提交
- **WHEN** a caller invokes `POST /v1/form/human-input/<form_token>` with JSON body carrying `user`
- **THEN** 系统 MUST 继续以该 `user` 物化的 request-scoped `end_user` 完成 submit 校验和处理

#### Scenario: Service API submit 不接受 public OTP proof
- **WHEN** a trusted Service API caller submits a v2 form
- **THEN** the request MUST contain `user`, `inputs`, and `action`, and MUST reject public-web-only `otp_code` or `challenge_token` fields

### Requirement: Runtime form contracts MUST keep v1 and v2 paths and submission logic independent
本期 v1 runtime MUST 保留现有 `form/human_input` 下划线路径、完整 v1 node model、request DTO 与提交行为。v2 runtime MUST 使用 `form/human-input` 连字符路径和独立 controller / DTO / token owner lookup。v1 token MUST 只从 legacy recipient token 记录解析，v2 token MUST 只从 delivery endpoint token hash 解析。两套路径 MUST NOT 互为 alias，也 MUST NOT 接受另一版本的 form token；除 suspension 等不携带版本业务语义的基础设施外，v1 与 v2 提交逻辑 MUST 独立。

#### Scenario: v1 runtime path 与 payload 保持不变
- **WHEN** a legacy client reads or submits a v1 form
- **THEN** it MUST continue using `/api/form/human_input/...` or `/v1/form/human_input/...` with the legacy non-OTP payload and v1 node model

#### Scenario: public web runtime path 使用 `form/human-input`
- **WHEN** the public runtime API paths are reviewed
- **THEN** Email form retrieval, access, upload, and submit paths MUST all be rooted at `/api/form/human-input/...`，并 MUST NOT 被 authenticated Contact page 复用

#### Scenario: authenticated Contact submit 使用 console namespace
- **WHEN** the authenticated Contact runtime API paths are reviewed
- **THEN** Contact submit MUST be rooted at `/console/api/form/human-input/...`，并 MUST NOT share its controller、request DTO or auth guard with `/api/form/human-input/...`

#### Scenario: service runtime path 使用 `form/human-input`
- **WHEN** the service runtime API paths are reviewed
- **THEN** GET / POST service form paths MUST be rooted at `/v1/form/human-input/...`

#### Scenario: v1 token 不能提交到 v2 route
- **WHEN** a caller submits a v1 form token to a hyphenated v2 public or Service API route
- **THEN** the v2 handler MUST reject the token without invoking v1 submission logic

#### Scenario: v2 token 不能提交到 v1 route
- **WHEN** a caller submits a v2 form token to an underscored v1 public or Service API route
- **THEN** the v1 handler MUST reject the token without invoking v2 submission logic
