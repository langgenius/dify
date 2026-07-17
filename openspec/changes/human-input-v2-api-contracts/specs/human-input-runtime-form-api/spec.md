## ADDED Requirements

### Requirement: Public web form definition MAY be read by form token, but reading MUST NOT grant submit authority
系统 MUST 在 `/api/form/human-input/<form_token>` 上暴露 public web form definition API。该接口 MAY 直接基于 `form_token` 返回完整 form definition，但读取表单 MUST NOT 直接授予审批提交权限；提交权限 MUST 在 `POST /api/form/human-input/<form_token>` 时单独校验。

#### Scenario: Dify 登录 contact 直接读取 form
- **WHEN** a logged-in `organization contact` opens `GET /api/form/human-input/<form_token>`
- **THEN** 系统 MUST 直接返回完整 form definition

#### Scenario: External contact 也可以读取 form
- **WHEN** an `External contact` or one-time email recipient opens `GET /api/form/human-input/<form_token>`
- **THEN** 系统 MAY 直接返回完整 form definition, but MUST NOT treat that read as submit authorization

### Requirement: Public web MUST support OTP request and submit-time OTP verification
对于需要 Email proof 的 recipient，系统 MUST 提供 `access-request` API 用于获取提交使用的 OTP。系统 MUST 在 `POST /api/form/human-input/<form_token>` 时校验 `otp_code`；系统 MUST NOT 再要求单独的 `access-confirm` API。

#### Scenario: 请求 OTP challenge
- **WHEN** an email-based approver calls `POST /api/form/human-input/<form_token>/access-request`
- **THEN** 系统 MUST 发送 OTP 到 token 绑定的 email recipient，并返回 resend cooldown / challenge metadata

#### Scenario: 同一请求内完成 OTP 与 submit
- **WHEN** an email-based approver submits the form payload together with a valid OTP in `POST /api/form/human-input/<form_token>`
- **THEN** 系统 MUST 允许在同一请求中完成 OTP 验证与 submit，但 MUST 继续执行完整的 task / approver / state 校验

#### Scenario: 缺少 OTP 的 email recipient 不能提交
- **WHEN** an email-based approver submits `POST /api/form/human-input/<form_token>` without a valid `otp_code`
- **THEN** 系统 MUST 拒绝该提交

### Requirement: Upload token MAY rely on form token, but submit MUST revalidate current task state and submit proof
系统 MAY 继续允许 `upload-token` 仅凭 `form_token` 工作，以支持“先填写 / 上传，后审批提交”的交互。系统 MUST 在 `submit` API 中重新校验当前 task 状态、当前身份状态、当前 contact / email / binding 状态，以及提交时提供的 OTP / 登录态。`form_token` 本身 MUST NOT 单独充当 submit 权限。

#### Scenario: 未验证 OTP 也可以申请 upload token
- **WHEN** an email-based approver calls `POST /api/form/human-input/<form_token>/upload-token` before completing OTP verification
- **THEN** 系统 MAY 允许该请求，只要 form token 和当前 task 状态仍然有效

#### Scenario: contact email 变更后旧 OTP 失效
- **WHEN** a recipient's contact email changes after one OTP was issued
- **THEN** 系统 MUST 拒绝继续使用旧 OTP 完成 submit

#### Scenario: task 已完成后再次 submit
- **WHEN** a second caller submits `POST /api/form/human-input/<form_token>` after the task is already `SUBMITTED`
- **THEN** 系统 MUST 返回 task 已完成类错误，而 MUST NOT 覆盖首个成功提交结果

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

### Requirement: Runtime form contracts MUST keep `form` noun and `human-input` path segment
本期 runtime 相关 API MUST 继续使用 `form` 作为资源 noun，并 MUST 使用 `human-input` 作为 URL path segment，而不是引入新的 `task` 或 `hitl` path。

#### Scenario: public web runtime path 使用 `form/human-input`
- **WHEN** the public runtime API paths are reviewed
- **THEN** form retrieval, access, upload, and submit paths MUST all be rooted at `/api/form/human-input/...`

#### Scenario: service runtime path 使用 `form/human-input`
- **WHEN** the service runtime API paths are reviewed
- **THEN** GET / POST service form paths MUST be rooted at `/v1/form/human-input/...`
