# HITL Phase 2 Decisions

## Decision 1: Email Matching

决策日期：2026-07-09

适用范围：

- `external contact` 创建时的 Dify Account 匹配
- 旧 Email recipient 迁移
- `dynamic Email` 与现有联系人匹配
- `Recipient canonicalization` / Email recipient 去重

决策：

- 本期将 `normalized email` 定义为：对完整 email 字符串执行 `str.lower()` 后得到的结果。
- 比较规则为：两个 email 在分别执行 `str.lower()` 后，结果完全相等，则视为同一个 email identity。

示意：

```text
normalized_email = email.str.lower()
same_email = left.str.lower() == right.str.lower()
```

本期明确不做：

- 不做 `+tag` 消解
- 不做 `.` 折叠
- 不做 provider-specific 规则
- 不做 domain / local-part 分段差异化处理

例子：

- `Alice@Example.com` 和 `alice@example.com`：视为相同
- `alice+ops@example.com` 和 `alice@example.com`：视为不同
- `alice.smith@example.com` 和 `alicesmith@example.com`：视为不同

影响说明：

- 这是一条最小规则，目标是先让 `external contact` 判定、旧数据迁移、recipient 去重和 `dynamic Email` 匹配行为一致。
- 该规则不试图表达邮箱协议或特定 provider 的全部语义，只定义本期产品比较规则。

待回写 PRD 的章节：

- §7.5 外部联系人
- §11.3 旧数据迁移
- §18.6 Recipient canonicalization 与去重
- §18.7 Sync、导入导出与迁移一致性

---

## Decision 2: IM Card Approval vs Web App Approval Auth

决策日期：2026-07-09

适用范围：

- IM 卡片内审批
- IM 通知后跳转到 Web App 独立页面审批
- external contact / one-time Email / dynamic Email 的 Web App 审批入口
- PRD 中 `IM identity`、`IM fallback URL`、`Email OTP` 的关系定义

决策：

- `IM 卡片内审批` 与 `Web App 独立页面审批` 是两条不同的鉴权链路。
- `IM 卡片内审批`：通过 IM 平台身份识别用户，再映射到 Dify contact / IM binding，提交时按 IM 身份链路鉴权。
- `Web App 独立页面审批`：不依赖 IM 平台身份，统一走 OTP 作为验证手段。
- 因此，`Web App 独立页面审批` 不应再被表述为 “IM 身份获取失败后的 fallback 鉴权”，而应被表述为一条独立的审批入口与鉴权规则。

本期明确不做：

- 不把 `Web App 独立页面审批` 建模为 IM 身份 fallback
- 不要求 Web App 打开页复用 IM provider identity
- 不在这条决策里同时保留 `Magic Link 或 OTP` 的双方案表述

影响说明：

- IM provider 能力矩阵中的 “可获取平台身份(鉴权)” 应只描述 IM 卡片内审批或 IM 原生交互场景，不应外溢到 Web App 独立页面审批。
- PRD 中涉及 `IM fallback URL` 的文案需要收敛，避免把 “独立 Web 页面审批” 与 “IM 身份 fallback” 混写。
- external contact / one-time Email / dynamic Email 的 Web 页面审批规则应统一引用 OTP。

待回写 PRD 的章节：

- §17 URL 鉴权与访问控制
- §17.3 不同对象的鉴权方式
- §17.5 不同场景的策略
- §18.5 IM 渠道能力矩阵

---

## Decision 3: Default Dual-Channel Delivery

决策日期：2026-07-09

适用范围：

- §9.1 默认双渠道触达
- §9.2 IM 通知
- §18.5 IM 渠道能力矩阵
- HITL task 运行时通知派发语义

决策：

- 对于具有 IM binding 且 Email 可用的 recipient，本期默认并行发送 IM 与 Email。
- 这里的“并行发送”指两个渠道都被创建为当前 task 的 delivery attempt；不会等待某一侧成功或失败后再决定是否发送另一侧。
- provider 能力只影响 IM 侧的投递形态：
  - 支持卡片内审批：发送 IM 卡片。
  - 不支持卡片内审批但支持 IM 通知：发送 IM 消息 + fallback URL。
- Email 在本期仍然是必发渠道；不会因为 IM 已发送、IM 成功、IM 失败或 provider 能力差异而被跳过。
- 多渠道触达不改变审批主体语义：同一个 recipient 仍只对应一个 `allowed approver`，IM 与 Email 只是同一审批对象的多个 delivery channel。

本期明确不做：

- 不做“先 IM，后 Email”的串行降级。
- 不做“只有 IM 失败才发 Email”的条件发送。
- 不做按 provider 能力关闭 Email 双发。
- 不做按用户、workspace 或 provider 配置通知优先级。

影响说明：

- 这条规则消除了“默认双渠道触达”在运行时语义上的歧义，避免实现层把它理解为串行降级或 provider 决定是否发 Email。
- `provider capability` 只负责决定 IM 通知长什么样，不负责决定 Email 是否发送。

待回写 PRD 的章节：

- §9.1 默认双渠道触达
- §9.2 IM 通知
- §18.5 IM 渠道能力矩阵

---

## Decision 4: Dynamic Authorization at Submit Time

决策日期：2026-07-09

适用范围：

- pending HITL task 的最终提交资格判定
- IM 绑定联系人通过 IM 卡片或其他 IM 身份链路提交
- 提交时 `Dify identity -> IM Binding -> valid contact` 的再校验规则
- 联系人、IM binding、contact 记录在 task 创建后发生变化时的提交行为

决策：

- 本期采用 `动态授权`。
- HITL task 是否允许提交，始终以 `提交当时` 的 Dify 身份与 IM Binding 状态为准，而不是只依赖 task 创建时 snapshot。
- 对于需要按 IM 身份提交的链路，系统在提交时必须使用当前的 `im_user_id` 去查找当前有效的 IM Binding。
- 如果提交当时找不到 `im_user_id` 对应的 binding，则不允许提交。
- 如果能找到 binding，但该 binding 已经无法继续提交，例如已经没有有效的 contact 记录，则不允许提交。
- 历史 snapshot 仍然用于审计、展示和问题排查，但不单独构成提交授权。

本期明确不做：

- 不采用 “task 创建时拿到链接就永久可提” 的快照授权模型
- 不允许旧 binding 在提交时绕过当前 binding / contact 状态继续提交
- 不把历史 snapshot 当作提交权限本身

影响说明：

- 这条规则把 pending task 的提交资格收敛为“实时安全状态判定”，会直接影响成员离开 workspace、IM binding 删除/替换、contact 失效后的提交结果。
- PRD 中凡是写到 “pending task 默认建议重新校验” 的地方，都应升级为明确规则，而不是保留为建议。
- 提交校验应区分“审计快照保留”和“实时提交授权”两件事：前者保留历史，后者只看当前有效身份链路。

待回写 PRD 的章节：

- §17.2 基本原则
- §17.3 不同对象的鉴权方式
- §17.4 打开页面与提交表单的校验
- §18.2 联系人生命周期
- §18.9 变更影响矩阵

---

## Decision 5: Import/Export and ID-Email Conversion Out of Scope

决策日期：2026-07-09

适用范围：

- §11.2 导入导出
- §15 Milestone 4 中的 “DSL 导入导出 ID / Email 转换”
- 任何将联系人 ID、external contact、one-time Email、dynamic Email 在环境之间导入、导出、转换的实现范围判断

决策：

- `导入导出 / DSL ID-Email 转换` 不作为本期目标。
- 本期只保留与现网兼容直接相关的：
  - 旧 Email recipient 到新模型的迁移
  - SaaS / CE 初始化迁移
- 不应把跨环境导入、导出、ID 映射恢复、Email 转换恢复视为本期交付范围。

本期明确不做：

- 不做 DSL 导出时的联系人快照映射规则
- 不做 DSL 导入时的联系人恢复、ID 匹配、Email 回填
- 不做 external contact / one-time Email / dynamic Email 的跨环境转换策略
- 不把 `Milestone 4` 中的 `DSL 导入导出 ID / Email 转换` 视为当前版本目标

影响说明：

- 当前缺的不是范围决策，而是 PRD 回写一致性。
- §11.2 已经整体划掉，因此 Milestone 4 中对应条目应删除、后移，或显式标注为后续阶段。
- 评审文档里不应再把这个问题列为“待产品回答的 blocker”，而应标记为“已决策但 PRD 未回写一致”。

待回写 PRD 的章节：

- §11.2 导入导出
- §15 Milestone 4

---

## Decision 6: Allowed Approver Is Contact-Centric and Fixed at Delivery Time

决策日期：2026-07-09

适用范围：

- `allowed approver` 的产品语义
- 通知发送 / Email 发送时的审批主体确定与记录
- `Contact`、`Dify Account`、`External Contact` 在审批时的关系
- Member Contact / External Contact 的提交鉴权方式

决策：

- `allowed approver` 在发送通知 / Email 时确定，并作为 task 运行时记录的一部分保留下来。
- 从产品语义上，审批主体以 `Contact` 为中心，而不是以单纯的 `email`、`session` 或裸 `account_id` 为中心。
- 系统向每个 `Contact` 发送通知；该 `Contact` 在运行时对应一个被记录的 `allowed approver`。
- 如果 `Contact` 关联了 `Dify Account`，则它属于 `Workspace Member Contact` 或 `Org-wide Member Contact`：
  - 审批时需要登录 Dify；
  - 或者在 IM 链路中，先用 IM user identity resolve 到对应的 `Dify Account`，再按该账号完成审批。
- 如果 `Contact` 没有关联 `Dify Account`，则它属于 `External Contact`：
  - 审批时只能通过独立表单页提交；
  - 提交表单时必须使用 `Email OTP` 证明对该邮箱的控制权。
- `IM` 与 `Email` 是 delivery channel，不改变审批主体本身；同一个 `Contact` 即使双渠道触达，也仍然只对应一个审批主体。
- `Current initiator` 仍然是单独的 allowlist 来源；本决策只澄清“由通知发送产生的 allowed approver”的主体语义。

本期明确不做：

- 不把 `allowed approver` 建模为“谁拿到链接谁都能批”
- 不把 `allowed approver` 简化为裸 `email` identity
- 不把 `IM` 与 `Email` 视为两个独立审批主体

影响说明：

- 这条决策收敛了 `allowed approver` 的主体粒度：通知目标先落到 `Contact`，审批时再根据该 `Contact` 是否关联 `Dify Account` 决定鉴权链路。
- 它会直接影响 recipient resolution、allowed approver 持久化、审计、去重以及提交鉴权。
- PRD 中如果继续只写“任意一个 allowed approver 成功提交”而不解释 allowed approver 的记录时机和主体粒度，读者仍会误解成账号级或邮箱级概念。

待回写 PRD 的章节：

- §8.5 Allow Current Initiator to Approve
- §9.4 提交规则
- §10.1 HITL Task
- §16.2 需要记录的信息
- §17.3 不同对象的鉴权方式
- §18.6 Recipient canonicalization 与去重

---

## Decision 7: Task Accessibility Follows Existing HumanInputFormStatus

决策日期：2026-07-09

适用范围：

- `task 是否可访问`
- `task 是否可提交`
- Web App 独立页面打开与提交
- §10.1 HITL Task
- §17.4 打开页面与提交表单的校验

决策：

- 本期 `task 可访问状态` 直接复用现有 `HumanInputFormStatus` 语义，不再额外发明一套页面状态。
- 只有 `WAITING` 状态的 form/task 允许继续打开和提交。
- `SUBMITTED`、`TIMEOUT`、`EXPIRED` 均视为不可访问 / 不可提交状态。
- 即使 form.status 仍为 `WAITING`，只要已经超过节点级 `expiration_time`，也应视为不可访问 / 不可提交。
- 即使 form.status 仍为 `WAITING`，只要已经超过全局超时 deadline，也应视为不可访问 / 不可提交。
- `task 不存在` 与 `task 不可访问` 是两类不同结果：
  - 不存在：`not found`
  - 已提交 / 已超时 / 已过期 / 已过 deadline：`expired/submitted`

示意：

```text
accessible = (
  status == WAITING
  and now < expiration_time
  and now < global_deadline
  and not submitted
)
```

本期明确不做：

- 不新增独立于 `HumanInputFormStatus` 之外的“可访问状态枚举”
- 不把 `canceled`、`delivery_failed` 直接当作现有页面访问状态使用
- 不允许 `WAITING` 但已过节点/全局 deadline 的 form 继续打开或提交

影响说明：

- 这条决策解决的是 `§17.4` 中“task 是否仍处于可访问状态”的落地语义。
- 它不解决 `§10.1` 中更大的状态机冲突；`canceled`、`delivery_failed` 是否进入本期、以及如何映射到现有实现，仍然需要单独收敛。
- 在现有代码里，这条规则已经存在于 `HumanInputService.ensure_form_active()` 和 `HumanInputFileUploadService._ensure_form_model_active()` 中，PRD 只需要回写一致。

待回写 PRD 的章节：

- §10.1 HITL Task
- §17.4 打开页面与提交表单的校验

---

## Decision 8: Task State Machine Follows Existing HumanInputFormStatus

决策日期：2026-07-09

适用范围：

- HITL form/task 状态机
- §10.1 HITL Task
- 节点级 timeout 与全局 expired 的分层
- `canceled` / `delivery_failed` 在本期中的归属

决策：

- 本期 form/task 状态机直接复用现有 `HumanInputFormStatus`，状态集合固定为：
  - `WAITING`
  - `SUBMITTED`
  - `TIMEOUT`
  - `EXPIRED`
- 允许的核心转移为：
  - `WAITING -> SUBMITTED`
  - `WAITING -> TIMEOUT`
  - `WAITING -> EXPIRED`
- `TIMEOUT` 表示节点级超时：
  - human input 节点沿 timeout 语义恢复；
  - 在 agent ask-human 语义中映射为 `timeout` 结果。
- `EXPIRED` 表示全局超时：
  - workflow run 视为全局截止；
  - 该 form 不允许继续 resume。
- `SUBMITTED` 表示已有 recipient 成功提交；进入终态。
- 本期不把 `canceled` 纳入现有 form 状态机。
- 本期不把 `delivery_failed` 纳入现有 form 状态机。
- 如果产品仍需要 `canceled` 或 `delivery_failed`，它们只能作为：
  - workflow run / node outcome
  - 或 delivery / error reason
 进行建模，而不是新增为当前 `HumanInputFormStatus`。

示意：

```text
WAITING -> SUBMITTED
WAITING -> TIMEOUT
WAITING -> EXPIRED
```

本期明确不做：

- 不新增 `CANCELED` form 状态
- 不新增 `DELIVERY_FAILED` form 状态
- 不保留一套与 `HumanInputFormStatus` 平行的 task/form 状态枚举

影响说明：

- 这条决策把“form/task 的状态机”和“workflow run 的失败结果”拆开了。
- 它解决的是 `§10.1` 中 form 状态与转移的落地语义。
- 它不替产品决定是否需要 `canceled`、`delivery_failed` 这两个概念；只限定它们不应直接进入当前 form 状态机。
- 现有代码已经体现这条规则：
  - `mark_submitted()` 只会把 form 置为 `SUBMITTED`
  - `mark_timeout()` 只允许 `TIMEOUT / EXPIRED`
  - `ask_human_resume` 中 `WAITING` 重新 pause，`TIMEOUT` 映射 `timeout`，`EXPIRED` 不可 resume

待回写 PRD 的章节：

- §10.1 HITL Task
- §10.4 节点报错规则
- §18.9 变更影响矩阵
