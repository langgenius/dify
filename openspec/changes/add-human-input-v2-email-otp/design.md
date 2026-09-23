## Context

Public API 已约定 `access-request` 返回 challenge token 和两个剩余时长，提交请求同时携带 OTP、challenge token、inputs 和 action。当前 Form／Recipient／Delivery 已表达表单、收件人和投递入口；OTP 只补充邮箱验证。

本次确认的行为是：同一 Delivery 允许多个有效 challenge；正确 OTP 在表单成功提交前可以重复验证；Form 最多接受一次成功提交。重发不使旧 challenge 失效。

## Goals / Non-Goals

**Goals:**

- 将邮箱验证绑定到具体 Delivery，支持跨 API 节点发码和提交。
- 限制发码频率和猜码次数，保留校验失败后的重试能力。
- 复用部署级邮件和共享 Redis，challenge 状态不落数据库。

**Non-Goals:**

- Runtime、IM consumer、卡片状态回写、通用表单校验、文件上传和 workflow resume。
- 修改 Recipient 身份或 Delivery target，恢复旧 grant／actor 体系。
- 独立验证 HTTP API、已验证浏览器 session、预约状态机、发送互斥、异步发码队列或通用 OTP 框架。

## Decisions

### 1. Challenge 绑定 Delivery

请求中的 form token 按现有规则计算 hash 并查询 Delivery。使用该 Delivery ID 和请求中的 challenge token 定位 Redis 记录，将验证限定于该 Delivery。tenant／form／recipient 通过 Delivery 获取，不另设 Recipient 范围的 challenge 唯一性或共享预算。

同一 Delivery 的每次发码产生独立 challenge token 和 OTP。多个 challenge 可以同时有效，各自过期、计数和删除；不维护“当前 challenge”指针。Challenge token 直接存入 Redis key，不要求只保存 hash。

发码和提交只接受 `auth_type=EMAIL_OTP` 且 target 为 Email 的 Delivery，并检查当前授权：

| Recipient subject | 条件 |
| --- | --- |
| Email（onetime_email／dynamic_email 解析结果） | subject.email 与冻结的 Delivery 邮箱相同；不按邮箱转换成 Contact |
| Contact | 原 contact_id 仍为该 tenant 可用的 External Contact，当前邮箱与 Delivery 邮箱相同 |
| EndUser | 拒绝 OTP |

Contact 删除后同邮箱重建不恢复旧授权。邮箱变化后旧 Delivery 不向新邮箱发码。Form／workflow 必须允许提交；客户端不能指定收件邮箱或 Recipient。

### 2. 共享 Redis 与有效期

每条 challenge 使用 Redis Hash，key 为 `hitl:otp:challenge:<delivery_id>:<challenge_token>`，包含两个字段：

- `payload`：Pydantic 判别联合序列化的 JSON，Email Based 保存 `type=email`、`email`、`otp`；External Contact 保存 `type=external_contact`、`contact_id`、`email`、`otp`。
- `failed_attempts`：初始为 0 的整数，仅在验证码错误时递增。

Email Based 包含 onetime_email 和 dynamic_email 初始化时解析出的邮箱，验证不重新求值变量。External Contact 保存原身份和发码邮箱，验证仍检查当前 Contact 可用性及邮箱。Delivery ID 由 key 绑定，tenant／form／recipient 从 Delivery 获取，不重复保存。Hash 创建与十分钟 TTL 设置原子完成；有效期及剩余时长由 Redis TTL 管理，不保存独立到期时间。所有 API 节点使用同一 Redis，不使用进程内 challenge 缓存或粘性会话。

| 参数 | 规则 |
| --- | --- |
| OTP | 加密安全随机生成的六位 ASCII 数字字符串，保留前导零 |
| challenge token | 每次独立生成的至少 256 bit 随机不透明 token |
| 有效期 | 写入 Redis 起固定十分钟，使用 TTL；到期时不可验证 |
| 重发冷却 | 同一 Delivery 每 60 秒最多允许一次发送请求 |
| 发送预算 | 同一 Delivery 滚动一小时最多允许五次发送请求，窗口为 `(now - 1h, now]` |
| 猜码次数 | 每条 challenge 最多五次错误验证码；第五次后拒绝该 challenge，包括随后输入正确验证码 |

OTP 到期时间不按 Form／workflow 截断；Submission 独立检查表单和 workflow 的截止时间。上述数值沿用提案默认值。

OTP 以六位字符串明文保存在共享 Redis 的 challenge 记录中，随记录到期删除。Redis 作为可信的短期凭证存储，拥有读取权限即可读取有效期内的验证码。Delivery／邮箱绑定由存储记录及当前授权检查保证。

Challenge token 可直接存 Redis，但 token、OTP 不进入日志、审计或异常诊断。API 边界通过 Pydantic 解析输入，OTP 不转换为整数。

Redis 不可用时发码和验证返回服务不可用，不降级到本地状态。记录丢失时用户重新发码。不存在独立的 OTP SQL 表或 SENDING／ACTIVE／SUPERSEDED／CONSUMED 状态机；失败次数和 TTL 足以判断 challenge 是否还能使用。

### 3. 发码与频率限制

沿用 `libs.helper.RateLimiter` 的 ZSET 滚动窗口方式，补充原子检查并计入发送的能力；现有 `is_rate_limited` 和 `increment_rate_limit` 分离调用不能满足并发约束。每个 Delivery 使用一个 ZSET，以独立发送请求 ID 为 member、获准时间为 score。同一 Lua 脚本移除窗口外记录，检查最近发送的 60 秒冷却和一小时五次预算，仅在全部允许时插入新记录并更新限流 key TTL。拒绝时返回两个限制共同决定的等待时间，不增加记录，也不建立独立冷却 key。

`request_access(form_token)` 按以下顺序执行：

1. 解析 Delivery，读取 Form／Recipient 并检查当前授权、表单状态和部署级邮件是否配置。
2. 在 Redis 原子检查该 Delivery 的冷却和滚动发送次数；允许时立即计入一次发送请求。并发请求不能分别通过同一冷却窗口。被拒绝的请求不计数。
3. 生成独立 token／OTP 并写入带十分钟 TTL 的 challenge；写入失败不发送邮件。
4. 不持有数据库 Session／事务地调用 `ext_mail.mail`，使用固定验证模板；邮件只包含 OTP 和用途说明，不包含 form token 或 challenge token，不使用 workflow 通知模板或租户 Email Channel。
5. 邮件调用成功且该 challenge 仍未到期时，返回 token 及当前剩余时长。邮件调用使用有限超时，本流程不自动重试。

后续 Redis 写入失败、邮件失败、超时或进程中断不退还已扣的发送次数和冷却。邮件调用明确失败或超时时，尽力删除本次 challenge；删除失败由 TTL 清理，错误响应不返回新 token。邮件服务接收不代表最终送达。

所有操作只写本次 challenge，不覆盖或删除其他 challenge。A 请求慢于 B 返回也无需判断谁是“当前请求”；只要各自记录未过期，两者均可使用。没有发送锁、预约有效期或请求接替逻辑。

进程中断留下的记录自然到期，不需要回收任务。若邮件已发送或新 challenge 已保存但响应丢失，客户端可能无法使用新验证码；旧 challenge 仍按自己的有效期和失败次数工作。客户端可在限流允许后重新请求。

### 4. 先验证 OTP，再提交表单

提交编排按以下顺序处理：

1. 完成基本请求解析，定位 Delivery，检查鉴权入口、明显终态和当前邮箱授权。
2. 在共享 Redis 验证指定 challenge 的 Delivery、邮箱、有效期、失败次数和 OTP。验证及错误次数更新必须原子执行，避免并发猜码突破上限；不刷新 TTL。验证失败时持久化失败审计并拒绝提交。
3. 正确 OTP 返回本次调用内的具体验证结果，包含 Delivery 和邮箱，不含秘密；不删除 challenge，也不重置错误次数。不把该结果作为客户端可复用的凭证。
4. 校验 inputs／action／文件，再在 Submission 拥有的数据库事务内检查当前授权及 Form／workflow 状态，调用现有原子提交能力，并在同一事务内写入 OTP 验证成功且表单提交成功的审计。当前授权必须仍对应本次验证的 Delivery 和邮箱。
5. commit 后尽力删除本次使用的 challenge。清理失败不撤销成功提交，也不阻塞 workflow resume；其他 challenge 自然到期，不扫描并删除整个 Delivery 的记录。

正确 OTP 在字段校验失败或数据库回滚后仍可重试，前提是其尚未过期或耗尽错误次数。验证时刻有效的结果可用于完成本次请求；每个新的提交请求重新验证。重发和另一个请求的清理不撤销已经完成的请求内验证，最终由 Form 原子提交决定唯一成功结果。

错误 OTP 只原子增加该条记录的失败次数，与数据库事务无关；前四次可纠正，第五次在同一 Lua 脚本中删除该 challenge key 并返回 stale；后续请求按记录不存在返回 expired。不保存耗尽标记或独立错误次数 key。检查绑定、比较 OTP、递增次数及必要的删除必须在同一脚本中完成，不能仅依赖 HINCRBY 的原子性。错误 token、错误 Delivery 或缺少 proof 不增加其他 challenge 的计数。正确 OTP 不增加失败次数，也不使其他 challenge 失效。

任何 challenge 都不能绕过已提交或过期的 Form。两个请求即使都通过 OTP 验证，最多一个成功提交。Redis 清理与数据库 commit 不组成分布式事务，OTP 不接管 workflow。

### 5. API 与审计

保持现有 access-request 和 public submit payload，不增加 access-confirm。Access response 的 `expires_in_seconds` 为该记录剩余 TTL；`resend_after_seconds` 为 Delivery 冷却和发送预算共同决定的等待时间。

| 结果 | HTTP / code |
| --- | --- |
| 无效 form token、owner 或不支持的鉴权入口 | 404 / `human_input_form_not_found` |
| Form 已提交或已达 deadline | 现有 submitted／expired 错误 |
| 发码冷却或预算用尽 | 429 / `human_input_access_rate_limit_exceeded`，附 Retry-After |
| 邮件发送失败 | 503 / `human_input_access_delivery_failed`，附当前 Retry-After |
| Redis 不可用 | 503 / `human_input_v2_unavailable` |
| 前四次错误验证码或缺少完整 OTP proof | 400 / `human_input_invalid_otp` |
| 第五次错误、身份绑定不匹配或当前邮箱改变 | 400 / `human_input_challenge_stale` |
| challenge 到期或记录不存在 | 400 / `human_input_challenge_expired` |

重发本身不会产生 stale。发码时 Contact 已删除／邮箱不符返回 form-not-found；提交时邮箱改变返回 stale，Contact 不存在返回 form-not-found。已知 Form 终态优先返回，客户端不将错误切换到其他鉴权入口。

沿用 `HumanInputAuditEvent` 和 `OtpVerificationEvent`，持久化以下结果：

| 结果 | 审计要求 |
| --- | --- |
| OTP 验证失败 | 必须记录失败及原因，不依赖后续表单提交事务 |
| OTP 验证成功且表单提交成功 | 必须记录成功，与 FormSubmission 在同一数据库事务内提交 |
| OTP 验证成功但表单提交失败 | 可选；若记录，必须区分验证码已匹配与表单未提交，不得记为 OTP 验证失败或提交成功 |

审计保存当时的 Form、Recipient、验证邮箱、请求 IP 和结果，沿用现有事件字段，不新增独立 challenge 审计 ID，不持久化 form token、challenge token 或 OTP。审计读取不依赖 Redis 记录，challenge 到期或删除不影响已保存的审计。失败次数仍以 Redis 为准，审计写入失败不恢复猜码预算。日志和异常诊断不记录 provider 响应正文。

## Risks / Trade-offs

- 多个 challenge 各有猜码次数，因此发码限流必须在所有 API 节点间原子共享；不得因重发或页面切换绕过 Delivery 预算。
- Redis 与数据库独立；允许正确 OTP 重复验证，依靠 Form 的原子状态转换防止重复提交。
- 邮件发送、Redis 和 HTTP 响应无法原子完成；新请求失败不改变任何旧 challenge，未使用记录由 TTL 回收。

## Migration Plan

1. 增加 Redis OTP 存储、部署级邮件模板和 access-request 实现，不新增 challenge 数据库 migration。
2. 接入 OTP 验证失败审计，提供成功提交事务使用的审计写入能力；后续 Submission change 接入验证、成功审计和提交后清理。本 change 不把尚未接通的 public submit 声称为可用。
3. 停用入口即可回滚 OTP 功能，Redis 临时数据自然过期。
