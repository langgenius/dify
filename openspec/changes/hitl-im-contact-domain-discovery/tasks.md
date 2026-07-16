## 1. 收敛仍未确认的业务规则

- [x] 1.1 与产品 / 设计确认 IM、Email、Web 三个入口必须展示的最小任务上下文与展示面规则（见 `design.md` §2 事实 `#48-#50`、`§4`、`§12` `R-1`）
- [x] 1.2 与安全确认 raw dynamic Email、form snapshot、submission content 在日志、Last Run 和审计中的可见范围与脱敏规则（见 `design.md` §12 `R-2` 与 repo-local review materials）
- [x] 1.3 与产品 / RBAC 确认 `Platform contact` 搜索与 `Organization` 边界的完整权限矩阵（见 `design.md` §2 事实 `#21a`、`§7.1` `CDG-5`、`§12` `R-3`）
- [ ] 1.4 与 SaaS 团队确认 abuse guardrails，包括 dynamic Email、OTP、收件人数和发送量阈值

## 2. 冻结安全与风控边界

> 进展：repo-local review materials 已同步到最新口径；上游 Feishu PRD 不自动回写，任何冲突或回写动作都需要先由用户决策。

- [x] 2.1 将已确认的手动 IM sync、IM identity 选择、Contact 编辑权限与 `Human Input` 命名规则同步回本地评审材料（见 `design.md` §11-§12 与 repo-local review materials）
- [x] 2.2 将 `WAITING / SUBMITTED / TIMEOUT / EXPIRED` 的最终术语映射同步到本地评审材料（见 `design.md` §7、§10、§12 与 repo-local review materials）
- [x] 2.3 将“external contact 不转为 removed member 的 external contact”与“通知中心不进本期”的口径同步到范围说明（见 `design.md` §11-§12 与 repo-local review materials）
- [x] 2.4 将 `Service API` / `CLI` 只是调用来源、审批主体仍只有 `workspace user` 与 `end_user` 两类的口径同步到本地评审材料（见 `design.md` §11-§12 与 repo-local review materials）

## 3. 将确认后的规则转成实现 backlog

- [x] 3.1 将 `contact-directory-governance` 中的联系人分类、成员生命周期、IM scope 与 override 规则拆成实现任务（见 `design.md` §7.1）
- [x] 3.2 将 `hitl-recipient-resolution` 中的静态 recipient、dynamic Email、canonicalization、双渠道通知规则拆成实现任务（见 `design.md` §7.2）
- [x] 3.3 将 `hitl-approval-access-control` 中的审批鉴权、动态授权、并发提交和审计规则拆成实现任务（见 `design.md` §7.3）
- [x] 3.4 为三份 capability spec 中的失败场景和权限变化场景补齐验收标准与 owner（见三份 `spec.md` 的 `Acceptance Coverage`）
- [x] 3.5 单独整理 `RecipientSpecification / ApprovalPrincipal / DeliveryEndpoint / IdentityProof` 的术语边界，避免后续实现把它们混成同一个对象（见 `design.md` §8）
- [x] 3.6 单独整理联系人变化对 pending task 的影响真值表，至少覆盖成员退出、账号禁用、external contact 删除、删除后重建、contact email 变更和 IM Binding 修改（见 `design.md` §9）

## 4. 以场景驱动进入实现

- [x] 4.1 用 `design.md` 中的业务场景与产品、架构、安全逐条走查，标记已确认和待决项（见 `design.md` §12 走查清单与状态）
- [x] 4.2 将 manual sync、Contact 权限、Service API request-scoped `end_user`、CLI initiator unavailable、OTP 同步提交、external contact 删除 / 重建 / email 变更，以及并发提交场景纳入首批验收用例（见 `design.md` §10）
- [ ] 4.3 在所有 blocker 关闭后，基于已确认场景执行 `/opsx:apply`
