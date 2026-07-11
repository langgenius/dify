# HITL PRD Review

Verdict: Fail

这份 PRD 还没有达到可直接进入实现的状态。主要问题不是“功能点不够多”，而是几个关键对象和边界还没有收敛：

- 现有实现的核心对象是 `HumanInputForm` / `HumanInputDelivery` / `HumanInputFormRecipient`，而 PRD 讨论的是 `Contact` / `Human Roster` / `Recipient` / `HITL task` / `Delivery Record` / `Recipient Resolution Record`。以下评审按 `HITL task == form` 理解。
- 当前运行时只有 `webapp` 和 `email` 两类 delivery method；PRD 已经把 IM、审计、URL 鉴权、组织级通讯录、跨 workspace 联系人、通知中心一起拉进来了。
- PRD 内部对“谁是 approver、谁能打开链接、哪些变化影响 pending task、dynamic email 要不要反查 member”等规则还存在直接冲突。

以下结论基于我对当前实现的阅读，重点参考：

- `api/models/human_input.py`
- `api/core/repositories/human_input_repository.py`
- `api/core/workflow/human_input_adapter.py`
- `api/services/human_input_service.py`
- `api/controllers/web/human_input_form.py`
- `api/tasks/mail_human_input_delivery_task.py`
- `web/app/components/workflow/nodes/human-input/types.ts`
- `web/app/components/workflow/nodes/human-input/default.ts`
- `web/app/components/workflow/nodes/human-input/components/delivery-method/email-configure-modal.tsx`
- `web/app/components/workflow/nodes/human-input/components/delivery-method/recipient/index.tsx`

## Blocking Issues

### 1. `HITL task == form` 这个前提需要在 PRD 中显式写清，否则研发实现时仍会歧义

- PRD 位置：`10.1`、`11.1`、`16.*`、`17.*`
- 当前实现：运行时实体是 `HumanInputForm`，子实体是 `HumanInputDelivery` 和 `HumanInputFormRecipient`，表单状态是 `WAITING` / `SUBMITTED` / `TIMEOUT` / `EXPIRED`。
- 问题：
  - 按当前约束，我将 `task` 直接理解为 `form`；但 PRD 正文没有把这个等价关系写死。
  - `delivery_records`、`recipient_resolution_records`、`allowed_approvers`、`notified_recipients` 也都被当成 task 字段提出，但没有和现有表、现有 token 模型做映射。
  - 如果这层术语不在 PRD 里显式固定，后面的迁移、API 路由、日志、鉴权仍然容易被不同研发解释成“新增 task 聚合”。
- 需要补齐：
  - 在术语定义处显式写明：`HITL task` 是产品术语，对应实现层的 `HumanInputForm`。
  - 给出一张对象映射表：`task(form)/delivery/recipient/contact` 各自是什么、谁持久化、谁是运行时快照。

### 2. PRD 当前写的是“原地改造旧 Human Input 节点”，但你说明实际方案是“引入新节点”

- PRD 位置：`5.4`、`8.*`、`11.1`
- 当前实现：
  - 节点存储主结构是 `delivery_methods[]`。
  - Email 配置里包含 `recipients / subject / body / debug_mode`。
  - 当前支持 `webapp`、`email`，并且 Email 配置里还有 `whole_workspace`。
- 问题：
  - PRD `5.0` 明确写的是“对现有 Human Input 节点进行原地改造”“旧 Human Input 节点升级为 HITL 2 的配置结构”“旧 workflow DSL 需要保持兼容”。
  - 你现在给出的真实方案是：引入一套新的节点配置模型，只复用表单相关的 `inputs` / `actions` 定义，老代码兼容性不是主要问题。
  - 这意味着当前 PRD 的节点策略、迁移策略、回滚策略和兼容性表述都需要重写；否则研发会按“原地升级旧节点”去做错误拆分。
- 需要补齐：
  - 在 PRD 中显式写明：这是一个新节点，不是旧 `Human Input` 节点的原地升级。
  - 明确新节点的 node type、DSL schema、前端入口、后端 runtime path。
  - 同步清理或重写 `5.0`、`11.3`、`11.4` 里所有建立在“升级旧节点”前提上的描述。

### 3. URL 鉴权设计和当前实现的安全模型正面冲突

- PRD 位置：`17.*`
- 当前实现：
  - `api/controllers/web/human_input_form.py` 里 Web 表单接口当前是未鉴权的 token access。
  - 注释直接写了 `this endpoint is unauthenticated on purpose for now`。
  - GET/POST 只要拿到 `form_token` 就能访问或提交。
- 问题：
  - PRD 明确说 URL 不能代表审批权限，打开和提交都要校验访问者身份。
  - 这不只是“小改鉴权逻辑”，而是现有 Web form 交互范式的根本变化。
  - PRD 没说明哪些 recipient type 还能继续 token-only，哪些必须登录、OTP、Magic Link 或 IM identity。
- 需要补齐：
  - 按 recipient type 给出访问校验矩阵。
  - 明确“打开页”和“提交表单”两次校验各自依赖什么证据。
  - 明确历史旧 token 的兼容策略和失效策略。

### 4. `dynamic email` 的 canonicalization 规则前后冲突

- PRD 位置：`8.3`、`7.5`、`18.6`
- 当前实现：
  - Email recipient 当前只分 `member` 和 `external`，并按 workspace member / external email 构造 recipient。
- 问题：
  - `8.3` 写的是：动态 Email 不反查 member，只按 Email recipient 处理。
  - `18.6` 又写：如果 dynamic Email 和已有 workspace member email 相同，应优先匹配已有联系人，以获得更强身份校验。
  - `7.5` 又强调：如果 Email 能匹配 Dify Account，不允许创建 external contact。
  - 这三条组合起来，dynamic email 到底是“永远按裸 email”还是“尽可能升级成 account/contact”，现在是冲突的。
- 需要补齐：
  - 为 `dynamic email` 单独定义 resolution pipeline。
  - 明确它的 canonical key、审计身份、通知行为、鉴权行为是否允许升级成 account/contact。

### 5. `Current Initiator` 的身份模型没有闭环

- PRD 位置：`8.5`、`17.3`、`18.6`
- 当前实现：
  - 现有 recipient type 里有 `STANDALONE_WEB_APP`、`CONSOLE`、`BACKSTAGE`、`EMAIL_MEMBER`、`EMAIL_EXTERNAL`。
  - `HumanInputService` 提交时只记录 `submission_user_id` 或 `submission_end_user_id`。
- 问题：
  - PRD 同时提到 WebApp 发起者、CLI/API 调用方、匿名 WebApp session、明确 caller identity。
  - 但没有定义 initiator 到底是 `account`、`end_user`、`session`、`API key owner` 还是一个新的 identity union。
  - 也没有定义它在 allowed approver 去重、审计、URL 鉴权、重复提交判定里用哪个 key。
- 需要补齐：
  - 先定义 initiator identity schema。
  - 再定义它如何参与 recipient canonicalization 和 submit authorization。

### 6. 部署形态实际上是两套模型，但 PRD 还没有把这两套模型写清

- PRD 位置：`4.*`、`6.2`、`6.5`、`14.2`、`18.4`
- 问题：
  - 按你最新给出的前提，部署并不是三套完全独立模型，而是两套：
    - `CE / EE` 共用一套模型。
    - `SaaS` 使用另一套模型。
  - 但当前 PRD 还是把 `CE`、`EE`、`SaaS` 混在同一层叙述，导致阅读者很难判断哪些规则是共模，哪些是 SaaS 特有规则。
  - 例如：
    - `4.1` 的 SaaS 凭据作用域是 tenant/workspace 级。
    - `6.2` 和 `18.4` 的企业版描述更接近 deployment-level / workspace-override 模型。
    - `6.5` 虽然标注本期不做，但它实际上属于 `CE / EE` 这一套模型的扩展能力，而不应和 SaaS 放在同一层讨论。
- 为什么是阻塞：
  - 这决定了 IM integration 配在哪里、表怎么分 tenant/workspace/deployment、回调 URL 怎么生成、权限由谁持有。
  - 如果 PRD 不先把“哪条规则属于 `CE/EE`，哪条属于 `SaaS`”标出来，研发实现时仍然会把本来应该分叉的规则揉在一起。
- 需要补齐：
  - 先在 PRD 中显式声明：部署策略只有两套模型，`CE/EE` 一套，`SaaS` 一套。
  - 给出两张矩阵，或者一张带 `model_family` 列的矩阵：
    - `CE/EE`：渠道、配置入口、凭据作用域、是否支持 override。
    - `SaaS`：渠道、安装方式、tenant/workspace 作用域、ISV/自建边界。
  - 明确本期是否允许“同一部署启用多个 IM 渠道”，并分别说明该结论是否对 `CE/EE` 与 `SaaS` 同时成立。

### 7. IM 能力矩阵是空表，但大量规则依赖它

- PRD 位置：`9.2`、`17.3`、`18.5`
- 问题：
  - PRD 频繁依赖“可在 IM 内取身份”“可卡片内审批”“可通讯录同步”“否则 fallback URL”。
  - 但 `18.5` 的能力矩阵几乎是空的。
  - 在没有矩阵的情况下，`IM binding`、`callback`、`identity proof`、`fallback auth` 都无从落地。
- 需要补齐：
  - 至少先填完本期声称支持的渠道：Slack、钉钉、飞书/Lark、Teams、企业微信。
  - 每个渠道要明确：是否能取用户身份、是否能卡片提交、是否只支持链接跳转、是否能拉通讯录。

### 8. `pending task` 在联系人变化后的行为没有统一规则

- PRD 位置：`17.2`、`17.4`、`18.2`、`18.9`
- 问题：
  - 一处说提交时要重新校验成员仍在 workspace、IM binding 仍有效。
  - 一处说历史 task 保留 snapshot，pending task 默认重新校验。
  - 另一处又提“转为 external contact”“保留旧 IM snapshot”“是否允许旧链接继续审批，需要确认”。
  - 这会直接影响 submit 判定、通知补发、审计解释。
- 需要补齐：
  - 给出一张变更影响真值表，至少覆盖：
    - member 离开 workspace
    - account disabled
    - external contact 删除
    - IM binding 修改/删除
    - recipient email 修改
    - credential rotation
  - 每种变化要分别说明：历史 task、pending task、新 task 的行为。

### 9. Debug 行为定义和现有实现不一致

- PRD 位置：`8.6`、`10.5`
- 当前实现：
  - Email config 里已经有 `debug_mode`，且是 channel-level 配置。
  - Debug preview / single-run 路径已经存在。
- 问题：
  - PRD 把它提成 node-level `Only notify me during debug`，但没说明：
    - 是否覆盖 webapp / email / IM 全部渠道；
    - 是否仍创建真实 form/task；
    - audit 和 delivery record 是否记录“原计划对象”与“debug 替换对象”。
- 需要补齐：
  - 明确 debug recipient rewrite 的作用域、日志规则和 snapshot 行为。

### 10. 审计日志与运行日志边界不清晰

- PRD 位置：`10.*`、`16.*`
- 问题：
  - `10.*` 关注 Last Run / Debug 可见性。
  - `16.*` 又要求能回答“谁、什么时候、通过什么身份验证、填了什么、为什么被允许或拒绝”。
  - 但 `16.2` 的“访问与身份校验信息”又写了“可能不需要审计日志记录”。
  - 这和审计目标本身冲突。
- 需要补齐：
  - 明确哪些字段属于用户可见运行日志，哪些属于审计日志，哪些只保留数据库不可在 UI 暴露。
  - 明确敏感字段脱敏规则，否则“记录原始 dynamic email 值”和“最小化暴露”也会冲突。

### 11. 后台权限矩阵完全缺失

- PRD 位置：`5.1`、`5.2`、`5.3`、`6.*`、`7.*`、`18.10`
- 问题：
  - 谁能看 Contact Directory。
  - 谁能看完整 Human Roster。
  - 谁能添加其他 workspace member。
  - 谁能添加 external contact。
  - 谁能配 IM credential。
  - 谁能改 IM binding / override。
  - 这些都没有定。
- 为什么是阻塞：
  - 没有权限矩阵，就没法设计 controller、service 和数据查询范围。

## Non-blocking Issues

### 1. `8.7 节点预览(不确定)` 仍是占位

- 这是 UI 细节，不阻塞后端对象建模。
- 但它现在混在正式章节里，容易让评审误以为已定稿。

### 2. `12.3 通知中心` 只给了方向，没有边界

- 说“可优先考虑提供接口”，但没有明确是否本期内要有 API contract。
- 建议要么移到后续专题，要么明确只预留领域对象，不出用户接口。

### 3. `16` 和 `18.11` 对指标/guardrail 基本没有落地定义

- 已经意识到 abuse 风险，但没有最小阈值、限流对象、失败告警口径。
- 这会让 SaaS 风控落在实现阶段临时补洞。

### 4. `6.3 IM identity` 章节信息量过低

- “具体参数待确定”基本等于还没设计。
- 如果本期真的要支持多个 IM provider，这一节至少需要一个最小 schema。

### 5. `10.4` 的节点失败规则没有和 pause/resume 状态机对齐

- “全部 recipient 都无法通知时节点报错”是产品结论。
- 但没有定义它发生在 form/task 创建前、创建后、部分渠道失败但仍有 webapp token 时的处理顺序。

### 6. `11.3` / `11.4` 迁移章节和“新节点方案”不一致

- 如果采用新节点方案，现有迁移章节就不能再默认按“旧节点升级到新节点”来写。
- 这部分不一定需要复杂迁移设计，但至少要明确：
  - 旧节点继续存在还是隐藏；
  - 新旧节点能否并存；
  - 是否需要任何自动迁移；
  - 发布后旧 workflow 的编辑与运行策略。

## Vague Language

以下表述需要收紧，否则实现时会被不同团队各自解释：

- `支持为联系人绑定一个 IM 身份`
  - 问题：是手动输入、搜索选择、同步导入，还是都支持？

- `默认通过 IM + Email 双渠道触达`
  - 问题：是所有 recipient 都双发，还是仅“可映射到 contact 且具备两种渠道”的人双发？

- `若调用方有明确身份，可作为 allowed approver`
  - 问题：什么叫“明确身份”？API key owner、end_user、session、SSO subject 都算吗？

- `需要记录额外的审计信息`
  - 问题：额外到什么程度？字段范围、查询权限、保留周期都没定义。

- `如果 IM 支持在应用内获取当前用户身份`
  - 问题：哪些 IM 支持、支持到什么粒度、是否可作为强身份凭据，都没定。

- `帮助排错`
  - 问题：需要对谁可见、保留多久、是否脱敏，没有约束。

## Missing Scenarios

当前 PRD 对以下场景缺少明确规则：

- 同一个人同时以 `workspace member`、`dynamic email`、`current initiator` 三种来源命中时如何去重。
- 一个 `dynamic email` 同时命中多个联系人，或命中一个 disabled account 时如何处理。
- IM 已送达、Email 发送失败，但 Web form 仍可打开时，task/form 是否继续等待。
- 用户在打开表单后离开 workspace，再提交时的报错文案和状态变化。
- `external contact` 被删除后，已经打开过页面但尚未提交的浏览器会话如何处理。
- 文件上传表单在 external recipient 场景下如何鉴权，上传 token 是否绑定 recipient identity。
- Email OTP / Magic Link 的重放、防爆破、重试次数、锁定策略。
- 部分 recipient 解析成功、部分解析失败时，通知对象列表和 allowed approver 列表谁是审计真相来源。
- Debug run 替换通知对象后，是否允许被替换掉的原 recipient 仍通过历史链接提交。
- CLI/API 发起但无 end_user identity 时，`Allow Current Initiator to Approve` 是否应自动失效。

## Recommended Next Step

建议不要继续往 UI 文案和页面草图细化。先在 PRD 开头补一段“节点策略声明”：这是一个新节点，只复用表单 `inputs` / `actions` 定义，不做旧 `Human Input` 节点的原地升级。然后再冻结下面 5 份规则表：

1. 对象模型表
   - `Contact / Roster / Recipient / Task(form) / DeliveryRecord / ResolutionRecord` 的边界和映射。

2. Recipient resolution + canonicalization 表
   - 每种来源如何解析、如何去重、最终产生什么 approver identity。

3. 状态机表
   - `pending / submitted / timeout / expired / canceled / delivery_failed` 与现有 `HumanInputFormStatus` 的对应关系。

4. 访问控制矩阵
   - 打开页与提交时，按 recipient type 和 channel 列出必须满足的身份校验条件。

5. 部署/渠道能力矩阵
   - 每个部署形态、每个 IM 渠道的配置入口、凭据作用域、身份能力、卡片能力、fallback 策略。

在这 5 张表定下来之前，直接开始改节点 UI 或设计数据库，很容易做出一版内部自相矛盾的实现。
