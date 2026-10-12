## 1. 接口与授权

- [x] 1.1 复核实施时最新 Form／Recipient／Delivery、OTP 验证审计模型及 Submission 接口，沿用现有所有权和原子提交能力。
- [x] 1.2 定义发码、验证结果和提交后单条清理接口；验证不消费 OTP、不接管 Submission 的 Session／事务。
- [x] 1.3 添加 Email／External Contact 授权测试，覆盖错误 auth_type、跨 Delivery、同邮箱 Account、Contact 删除重建和邮箱改变。

- [x] 1.4 纳入既有 Delivery migration 前置依赖，补齐现有审计模型的表迁移，并通过迁移后数据库上的业务测试验证。

## 2. 共享 Redis 存储与限流

- [x] 2.1 实现按 Delivery 和随机 token 定位的独立 challenge 记录，使用两个 String key 分别保存 Email Based／External Contact 判别联合 payload（后者额外含 contact_id）和标量 counter，通过事务创建并设置十分钟 TTL；不新增 SQL challenge 表或 challenge migration。
- [x] 2.2 实现六位随机 OTP 和独立随机 token；覆盖前导零和秘密日志排除。
- [x] 2.3 沿用现有 RateLimiter 的 ZSET 方式补充原子检查并计入发送的能力，实现 Delivery 级冷却、滚动小时发送预算和 Retry-After，失败不退还已扣次数；不同 Delivery 独立计数。
- [x] 2.4 覆盖两个 API 实例共享 challenge／限流、并发请求不突破预算、窗口边界、Redis 不可用及记录丢失。
- [x] 2.5 覆盖同一 Delivery 多个 challenge 同时有效，重发不替换旧记录，各自 TTL 和错误次数独立。

## 3. 部署级邮件与 Access API

- [x] 3.1 实现授权检查、限流、写入 challenge、调用部署级 ext_mail.mail、返回剩余时长的发码流程。
- [x] 3.2 添加固定 OTP 模板，不读取租户 Email Channel，不含 form token／challenge token，邮件 I/O 不持有数据库 Session／事务。
- [x] 3.3 沿用部署级邮件组件现有的日志与超时策略，不自动重试；发送失败只尽力删除本次记录，中断遗留记录自然到期。
- [x] 3.4 覆盖租户通道删除、部署级邮件未配置、Redis 写入失败、邮件失败／超时、响应丢失和较早请求较晚返回，验证旧 challenge 不受影响。
- [x] 3.5 接入现有 public access-request stub，保持 DTO；核对前端错误分类、剩余时长及 Retry-After 映射，必要时按仓库流程生成 contracts。

## 4. OTP 验证与 Submission 接入契约

- [x] 4.1 在 Python 验证指定 challenge，使用 Redis helper 原子递增标量 counter、保留 TTL 并拒绝创建缺失 key，在 Python 判断上限并删除 payload／counter，不刷新 TTL、不在正确验证后立即删除记录。
- [x] 4.2 覆盖第五次错误删除 payload／counter 并返回 stale、后续返回 expired、并发猜码、四次错误后正确验证、正确验证不重置计数、错误 token／Delivery 不影响其他 challenge。
- [x] 4.3 通过测试侧编排覆盖先验证 OTP 再校验表单数据；正确 OTP 遇到字段错误或数据库回滚仍能重试。
- [x] 4.4 使用真实 Form Repository 的针对性行为测试验证多个有效 challenge 并发提交最多一个成功，Form／workflow 过期独立于 OTP TTL。
- [x] 4.5 实现提交成功后的单条尽力清理；覆盖清理失败、清理前中断、其他 challenge 未清理时仍不能重复提交。
- [x] 4.6 记录后续 Submission change 的验证、同事务成功审计及清理调用契约，不实现 Runtime、通用字段验证、完整 public submit 或 workflow resume。

## 5. 审计与验证

- [x] 5.1 覆盖 OTP 服务自身的日志和异常诊断不记录 token、OTP 或 provider 响应正文。
- [x] 5.2 通过 uv run --project api 运行针对性 unit tests、lint 和 type check；若修改前端则运行对应测试和静态检查。
- [x] 5.3 在 CI 验证真实 Redis 并发限流／猜码与真实数据库并发提交；不在本地启动集成服务。
- [x] 5.4 核对多个 challenge 共存、Delivery 级限流、跨节点验证、部署级邮件及非原子清理在各文档中一致，执行 openspec validate add-human-input-v2-email-otp --strict。
- [x] 5.5 沿用现有 OTP 验证审计模型持久化验证失败及原因，提供与 FormSubmission 同事务写入成功审计的能力；不新增独立 challenge 审计 ID，不保存 token 或 OTP。
- [x] 5.6 覆盖验证失败审计、提交成功审计与 FormSubmission 同事务提交或回滚、审计写入失败不恢复猜码预算，以及 Redis 记录删除后审计仍可读取。
- [x] 5.7 验证 OTP 成功但提交失败时允许不写审计；若实现可选审计，覆盖其不会被记为 OTP 验证失败或表单提交成功。

验证完成：本地 140 项针对性测试通过，修改范围内 Ruff／格式／Pyrefly 检查通过。提交 `589a0ccb15292594c24fef86a2b36917df440d4d` 的源码快照通过 [CI 验证](https://github.com/QuantumGhost/dify-private/actions/runs/35828213388)：OTP 单元测试及 11 项真实 Redis／迁移后 PostgreSQL 集成测试全部成功。本地未启动集成服务。
