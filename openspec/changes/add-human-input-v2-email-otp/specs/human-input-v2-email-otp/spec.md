## ADDED Requirements

### Requirement: OTP MUST be bound to one persisted Email delivery

系统 MUST 从 form token 解析 Delivery，并将 challenge 绑定到该 `delivery_id` 和验证邮箱。发码和提交 MUST 仅接受 Email target 且 `auth_type=EMAIL_OTP` 的 Delivery。系统 MUST 检查其 Form、workflow、Recipient 和当前邮箱授权。Email subject MUST 与冻结投递邮箱一致；Contact subject MUST 仍为该 tenant 可用且邮箱匹配的原 External Contact。系统 MUST NOT 按邮箱替换 Recipient 身份或重定向旧 Delivery。

#### Scenario: Direct Email overlaps a current Account
- **WHEN** Email subject 的邮箱后来与 Account 相同
- **THEN** public submit MUST 继续要求该 Delivery 的 OTP，不接受 Account session 替代

#### Scenario: External Contact changes or disappears
- **WHEN** 原 External Contact 被删除、不可用或邮箱改变
- **THEN** 系统 MUST 拒绝旧 Delivery 发码和提交，不向新邮箱发码，也不授权同邮箱重建的 Contact

#### Scenario: Challenge belongs to another delivery
- **WHEN** 请求携带的 challenge 属于另一 Delivery，即使两个 Delivery 关联同一 Recipient
- **THEN** 系统 MUST 拒绝验证，且 MUST NOT 增加另一 challenge 的错误次数

### Requirement: Multiple challenges MUST coexist independently in shared Redis

系统 MUST 为每次获准的发码请求生成独立 challenge token 和 OTP，在共享 Redis 中保存对应记录。系统 MUST 允许同一 Delivery 同时拥有多个有效 challenge；创建、失败、验证或删除一个 challenge MUST NOT 替换或删除其他 challenge。系统 MUST NOT 维护唯一当前 challenge、发送预约记录或用于串行等待邮件调用的发送锁。

Challenge token MUST 具有至少 256 bit 随机熵，直接作为 Redis key 的一部分保存。OTP MUST 为六位 ASCII 数字字符串，以明文保存在共享 Redis 的 challenge 记录中。OTP 和 challenge token MUST NOT 进入日志、审计或异常诊断。

Challenge 记录 MUST 区分 Email Based 和 External Contact：前者保存解析后的邮箱和 OTP，后者额外保存原 contact_id。失败次数 MUST 与该 challenge 共用 Redis key 和 TTL。External Contact 的记录 MUST NOT 替代当前 Contact 授权检查；Email Based MUST NOT 重新解析 dynamic_email 变量。

#### Scenario: Resend succeeds
- **WHEN** 同一 Delivery 在限流允许后生成第二个 challenge
- **THEN** 两个 challenge MUST 各自保持有效，直到各自到期、错误次数耗尽或被提交成功后的清理删除

#### Scenario: Access and submission reach different API nodes
- **WHEN** 节点 A 发码，节点 B 接收提交
- **THEN** 节点 B MUST 通过共享 Redis 记录完成验证，不依赖节点 A 内存

#### Scenario: Code starts with zero
- **WHEN** OTP 是 `001234`
- **THEN** 发送和验证 MUST 保留六位字符串，不通过整数转换接受 `1234`

#### Scenario: Redis is unavailable
- **WHEN** API 节点不能读写 Redis
- **THEN** 发码或验证 MUST 返回服务不可用，MUST NOT 降级为本地 challenge 状态

### Requirement: Sending MUST enforce atomic delivery-scoped frequency limits

系统 MUST 按 Delivery 限制每 60 秒最多一次发送请求、每滚动小时最多五次发送请求，窗口 MUST 为 `(now - 1h, now]`。限流检查与计数 MUST 在共享 Redis 原子完成，并在发送邮件前执行。被拒绝的请求 MUST 不计数；获准后的存储失败、邮件失败、超时或进程中断 MUST 不退还计数和冷却。同一 Delivery 的所有页面和 API 节点 MUST 共用限流；不同 Delivery MUST 独立计数。

#### Scenario: Concurrent requests target the same delivery
- **WHEN** 两个 API 节点同时处理同一 Delivery 的发码请求
- **THEN** 在同一冷却窗口内最多一个请求 MUST 获准，另一个 MUST 得到带 Retry-After 的限流错误

#### Scenario: Hourly budget recovers
- **WHEN** 五次发送请求仍在滚动窗口内
- **THEN** 第六次 MUST 被拒绝；最早请求离开窗口且冷却满足后 MUST 允许新请求

#### Scenario: Recipient has different deliveries
- **WHEN** 两个 Email Delivery 关联同一个 Recipient
- **THEN** 一个 Delivery 的发码 MUST 不消耗另一个 Delivery 的预算

### Requirement: OTP mail MUST use deployment configuration without challenge replacement

系统 MUST 在通过授权和限流检查后保存本次 challenge，再通过部署级 `ext_mail.mail` 发送固定验证模板。系统 MUST NOT 读取租户 Email Channel 或使用 workflow 可编辑模板。邮件 MUST 不包含 form token 或 challenge token，邮件 I/O MUST 不持有数据库 Session／事务。系统 MUST 在邮件调用成功且记录未到期后返回 challenge token 和剩余时长。

邮件调用 MUST 使用有限超时，本流程 MUST 不自动重试。调用失败或超时时 MUST 尝试删除本次记录且不返回新 token；删除失败或进程中断留下的记录 MUST 自然到期，不要求额外状态回收。其他 challenge MUST 保持不变。

#### Scenario: Tenant email channel is removed
- **WHEN** 租户 Email Channel 被删除，但部署级邮件配置可用且当前授权有效
- **THEN** OTP 发码 MUST 仍可使用部署级邮件配置

#### Scenario: Challenge storage fails
- **WHEN** Redis 无法保存本次 challenge
- **THEN** 系统 MUST 不发送邮件，也不改变旧 challenge

#### Scenario: Provider fails or times out
- **WHEN** 重发邮件失败或超时
- **THEN** 系统 MUST 返回安全的发送失败错误，旧 challenge MUST 继续按自己的有效期和错误次数工作

#### Scenario: Earlier request returns after a later request
- **WHEN** 两次发码分别通过限流，较早请求的邮件调用晚于较晚请求返回
- **THEN** 两个请求 MUST 仅操作各自记录，不因先后顺序覆盖或废弃对方 challenge

#### Scenario: Successful access response is lost
- **WHEN** 新邮件已发送，但客户端没有收到新 challenge token
- **THEN** 旧 challenge MUST 保持原有效期和错误次数，新记录 MUST 自然到期，客户端 MAY 在限流允许后再次发码

### Requirement: Each challenge MUST have independent expiry and bounded guesses

每条 challenge MUST 从写入 Redis 起固定有效十分钟，MUST NOT 按 Form／workflow deadline 截断或因验证刷新 TTL。Submission MUST 独立检查 Form／workflow 截止时间。验证码比较和失败次数更新 MUST 原子执行。每个 challenge 最多允许五次错误验证码；第五次错误时 MUST 原子删除该 challenge key 并返回 challenge-stale；后续请求 MUST 按记录不存在返回 challenge-expired。正确验证码 MUST 不增加或重置错误次数。

#### Scenario: Correct code follows four mismatches
- **WHEN** 未过期 challenge 已有四次错误，随后收到正确验证码
- **THEN** 验证 MUST 成功且记录 MUST 仍保持四次错误

#### Scenario: Fifth mismatch affects only one challenge
- **WHEN** 同一 Delivery 的一个 challenge 达到第五次错误
- **THEN** 系统 MUST 原子删除该 challenge key；后续即使携带正确验证码也 MUST 返回 challenge-expired，其他 challenge 的次数和有效性 MUST 不受影响

#### Scenario: Guesses arrive concurrently
- **WHEN** 多个节点并发验证同一 challenge
- **THEN** 错误次数 MUST 不因丢失更新突破五次上限，达到上限后 MUST 不再接受正确验证码

#### Scenario: Form expires before the challenge
- **WHEN** OTP 仍在十分钟有效期内，但 Form 或 workflow 已到截止时间
- **THEN** 提交 MUST 被拒绝，MUST 不以 OTP 有效为由延长 Form／workflow 有效期

### Requirement: Successful verification MUST remain reusable until form submission succeeds

Submission MUST 在基本请求解析、Delivery 定位和当前授权／明显终态检查后，先验证 OTP，再校验 inputs／action／文件。正确 OTP MUST 返回仅用于本次请求的具体内部验证结果，MUST 不立即删除 challenge。每次新的提交请求 MUST 重新验证；系统 MUST NOT 增加独立 access-confirm 或客户端可复用的已验证 session。

Submission MUST 在数据库事务中检查当前授权及 Form／workflow 状态，并使用现有原子提交能力。commit 后 MUST 尝试删除本次使用的 challenge；删除失败 MUST 不撤销提交或阻塞 workflow resume。其他 challenge MUST 自然到期，MUST 不要求跨 Redis／数据库事务或整批清理。

#### Scenario: Form data validation fails after correct OTP
- **WHEN** OTP 验证成功，但 inputs、action 或文件校验失败
- **THEN** challenge MUST 保留，用户 MUST 能在其仍有效时修正表单并重新提交

#### Scenario: Submission persistence rolls back
- **WHEN** OTP 验证成功，但数据库提交失败
- **THEN** challenge MUST 不因该次失败而被消费，后续请求 MUST 可以重新验证

#### Scenario: Wrong OTP accompanies invalid form inputs
- **WHEN** 请求通过基本解析，但 OTP 和表单业务数据均不正确
- **THEN** 系统 MUST 先拒绝 OTP 并更新该 challenge 的错误次数，不进入后续表单业务校验

#### Scenario: Several challenges authorize concurrent submissions
- **WHEN** 同一 Form 的多个请求使用相同或不同有效 challenge 并发提交
- **THEN** OTP MAY 分别验证成功，但最多一份 FormSubmission MUST 成功

#### Scenario: Cleanup fails after commit
- **WHEN** Form 已提交，但 Redis 删除失败或进程在清理前中断
- **THEN** 表单结果 MUST 保持已提交，后续请求使用残留 challenge MUST 不能重复提交

### Requirement: OTP HTTP responses MUST preserve the public form contract

Access success MUST 返回 `challenge_token`、`resend_after_seconds`、`expires_in_seconds`；时长 MUST 为该 challenge 剩余 TTL 和 Delivery 实际限流等待时间。Public submit MUST 同时携带 inputs、action、otp_code 和 challenge_token。错误 MUST 使用现有 UI 类别，错误响应 MUST 不含秘密、邮箱或原始 provider 错误。

#### Scenario: Missing proof with a Dify session
- **WHEN** public submit 带有 Dify session，但缺少完整 OTP proof
- **THEN** 系统 MUST 返回 invalid-otp，不接受 session 代替邮箱验证

#### Scenario: Cooldown or sending failure
- **WHEN** access 被限流或邮件调用失败
- **THEN** 系统 MUST 返回相应错误及 Retry-After，MUST 不使旧 challenge 失效

#### Scenario: Challenge no longer exists
- **WHEN** Redis 中找不到指定 challenge，或其已经到期
- **THEN** 系统 MUST 返回 challenge-expired；已知 Form 终态 MUST 优先返回 submitted／expired

### Requirement: OTP audit MUST retain verification failures and successful submissions

系统 MUST 使用现有持久化审计模型记录 OTP 验证失败及原因。OTP 验证成功且表单提交成功时，系统 MUST 在 FormSubmission 的同一数据库事务内写入成功审计。OTP 验证成功但表单提交失败时，系统 MAY 记录审计；若记录，MUST 区分验证码已匹配与表单未提交，MUST NOT 将其记为 OTP 验证失败或表单提交成功。

审计 MUST 保存当时的 Form、Recipient、验证邮箱、请求 IP 和结果，MUST NOT 依赖 Redis challenge 记录进行历史查询。系统 MUST NOT 为此新增独立 challenge 审计 ID，MUST NOT 在审计中保存 form token、challenge token 或 OTP。失败次数 MUST 以 Redis 为准，审计写入失败 MUST NOT 恢复猜码预算。

#### Scenario: OTP verification fails
- **WHEN** 请求已定位有效 Delivery，但 OTP 验证因验证码错误、proof 缺失、challenge 不存在、到期或不可用而失败
- **THEN** 系统 MUST 持久化失败审计及原因，MUST NOT 创建成功的 FormSubmission

#### Scenario: Verified OTP leads to an accepted submission
- **WHEN** OTP 验证成功且表单通过提交校验
- **THEN** 成功审计与 FormSubmission MUST 在同一事务内提交；任一写入失败时两者 MUST 一起回滚

#### Scenario: Submission fails after OTP verification
- **WHEN** OTP 验证成功，但表单校验失败或提交事务回滚
- **THEN** 系统 MAY 不保存此次审计；若保存，MUST 表达验证成功但未成功提交，MUST NOT 将其记为 OTP 验证失败或表单提交成功

#### Scenario: Challenge is removed after an audited request
- **WHEN** 已审计请求对应的 Redis challenge 到期或被删除
- **THEN** 已持久化的审计 MUST 仍可读取，不要求恢复 challenge 或重新验证 OTP
