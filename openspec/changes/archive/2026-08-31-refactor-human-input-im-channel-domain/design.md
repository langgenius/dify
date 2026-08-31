## Context

当前 `IMControlPlaneRepository` 同时包含 IM configuration、Identity、Binding、Sync 与 Reconciliation persistence。Channel configuration 的 owner predicate、singleton constraint、CAS、mapping 与 transaction contract 因此不能作为一个独立 module实现和测试。

本 change 只设计 Repository及其 persistence values和schema。它不定义谁调用 Repository、调用前执行哪些 Provider操作、何时选择 update或replacement，以及 mutation完成后其他领域如何响应。

同目录 `domain.py` 与 `schema.py` 是不可导入的 reference artifacts。它们固定 Repository参数/返回值、Protocol 与 ORM shape。

## Goals / Non-Goals

**Goals:**

- 用 owner-free immutable `IMChannel` 表达一条当前持久化配置。
- 用一张 Channel table和一个 non-null owner slot表达 workspace/deployment singleton。
- 让 Workspace与Deployment readers满足同一个 `IMChannelReader` Protocol，让对应writers满足同一个 `IMChannelWriter` Protocol。
- 让 Repository拥有 Channel mapping、owner predicate、singleton conflict、scalar CAS、conditional DML、error translation与flush。
- 让 Repository只读写 Channel row并使用 caller-owned SQLAlchemy `Session`。

**Non-Goals:**

- 不定义 candidate test、create/update/replacement/delete application use case或management service。
- 不定义 Provider authentication、permission checks、Provider tenant resolution、safe metadata extraction、credential protection或其执行顺序。
- 不决定业务上何时允许 update、何时要求 replacement，或如何生成 Channel ID、`webhook_id`、version、timestamps与status。
- 不修改 Console/EE controllers、public APIs、transport DTOs、opaque `ConfigVersion` codec或composition wiring。
- 不定义按 `webhook_id` 反向查询、owner recovery、Webhook ingress、cipher selection或runtime adapter composition。
- 不修改 Identity、Binding、Sync/Reconciliation、Contact、Inbox、delivery或其他领域的schema、Repository、service和retention policy。
- 不引入 Unit of Work、Redis lock、`DifySetup` lock、Repository registry或background task。

## Decisions

### 1. `IMChannel` is the Repository value

`IMChannel` 包含 Channel ID、timestamps、Provider、opaque Provider tenant ID、canonical encrypted credential envelope、safe app identifier、server-generated `webhook_id`、numeric configuration version与credential-safe status snapshot。

`IMChannel` 不包含 Dify owner、raw `owner_key`、configuring actor、callback URL、ORM record或其他领域对象。Repository constructor已经绑定owner；把owner再次放进Channel value会产生两个ownership authorities。

Repository把`IMEncryptedCredentials`视为opaque value。SQLAlchemy implementation中的private mapping helpers传递该value而不parse、copy、decrypt或根据其内容选择Provider。

### 2. `owner_key` is the persistence slot

`HumanInputIMChannel.owner_key` 是non-null string：

- workspace：`workspace:<tenant_id>`；
- deployment：`deployment`。

`UNIQUE(owner_key)`为所有supported database dialects提供相同singleton semantics。`owner_key`不是foreign key，不进入`IMChannel`，也不由operation methods或external payload提供。

`WorkspaceIMChannelReader`与`WorkspaceIMChannelWriter`从constructor-bound `TenantId`生成workspace key。`DeploymentIMChannelReader`与`DeploymentIMChannelWriter`固定使用deployment key。所有implementations都不得解析由caller提供的raw key。

Nullable `tenant_id`不能通过ordinary unique constraint限制deployment row；用Redis或`DifySetup` lock又会把Repository correctness扩展到额外infrastructure lifecycle，因此不采用。

### 3. Read and write capabilities are separate

`IMChannelReader`只暴露`get()`。它的concrete constructors绑定caller-owned `Session`与owner，不接受configuring actor。

`IMChannelWriter`只暴露：

- `create(channel)`；
- `update(channel, expected_config_version)`；
- `replace(current_channel_id, expected_config_version, replacement)`；
- `delete(channel_id, expected_config_version)`。

Reader与Writer methods不接收owner、scope、edition、actor、raw credentials、candidate、Provider client或transport version。

Writer接收已经构造完成的`IMChannel`。Channel是否合法、由哪个业务command产生以及operation应当选择哪个method，属于caller而不是本change。

### 4. Constructors bind persistence context

`WorkspaceIMChannelReader` constructor接收caller-owned `Session`与`TenantId`。`WorkspaceIMChannelWriter` constructor额外接收configuring `AccountId`。Create/update/replacement把该Account ID写入persistence metadata。

`DeploymentIMChannelReader`与`DeploymentIMChannelWriter` constructors只接收caller-owned `Session`。Deployment create/update/replacement把`configured_by_account_id`写为`NULL`。

四个implementations共享同一module内的private owner-key、mapping与statement helpers。Workspace/Deployment readers使用一套parity tests；Workspace/Deployment repositories使用另一套parity tests。它们的public behavior不得因owner kind产生差异。

### 5. The database owns singleton serialization

Create执行insert/flush。`human_input_im_channels_owner_key_uq`冲突转换为`IMChannelAlreadyConfiguredError`。

Repository不得把`webhook_id` collision或其他integrity failure误分类为already configured。除owner-key unique violation外，Repository让SQLAlchemy、mapping、validation与integrity exceptions原样传播。External error sanitization不属于Repository。

Repository不执行pre-read来声称authoritative singleton decision；concurrent create最终由database unique constraint收敛。

### 6. Existing-resource writes use scalar CAS

Update的conditional statement必须比较constructor-bound `owner_key`、`channel.id`与`expected_config_version`。Next Channel必须保留相同ID，并使用`expected_config_version + 1`。

Replacement必须在同一caller transaction中：

1. 按`owner_key + current_channel_id + expected_config_version` conditional-delete current row；
2. 要求replacement使用different Channel ID与initial version；
3. 以相同owner key插入replacement row。

Delete必须按`owner_key + channel_id + expected_config_version` conditional-delete。

Conditional DML影响零行时，Repository返回`StaleIMChannelWriteError`。ID参与predicate，因此old/new rows即使numeric version相同也不会产生ABA。

### 7. Caller owns the transaction

Reader与Writer接收caller-provided SQLAlchemy `Session`。Reader可以query；Writer methods可以执行conditional DML与flush。它们不得创建Session、commit、rollback、begin nested transaction或把method return解释为transaction commit。

Repository不执行Provider I/O、credential transformation、lock acquisition、task dispatch或其他external side effect。Caller transaction回滚必须撤销完整Channel mutation。

### 8. Repository persists only Channel data

Repository只query、insert、update或delete `HumanInputIMChannel`。它不import、query、mutate或deleteIdentity、Binding、Sync/Reconciliation、Contact、Inbox或Provider models。

Replacement和delete只改变Channel table。其他领域如何解释旧Channel ID、是否保留或清理关联records，不属于本Repository contract。

### 9. `webhook_id` is data, not a lookup capability

每条Channel row持久化globally unique `webhook_id`。Repository mapping和write methods保存该字段；unique collision保留原始integrity exception。

本change不定义`IMWebhookChannelRepository`、owner parsing或reverse lookup。需要按`webhook_id`定位runtime context的change必须在自己的scope内定义对应port和result value。

### 10. Package placement follows persistence ownership

Existing shared `IMProvider`、`TenantId`、`AccountId`继续位于`core/human_input_v2/`。

Channel-owned `IMChannelStatus`、`IMChannelId`、`WebhookId`、`IMChannel`、stable write conflicts、`IMChannelReader`与`IMChannelWriter`位于`repositories/human_input_v2/im_channel_repository.py`。Workspace/Deployment concrete readers、writers及其private mapping helpers位于`repositories/human_input_v2/sqlalchemy_im_channel_repository.py`；mapping不形成独立module。

Controller与service不得定义compatibility copies。Core不得import concrete Repository adapter。

## Risks / Trade-offs

- [Logical owner key没有database foreign key] → 只有concrete Repository constructors生成key；operation methods不接受raw key；unique constraint和owner-isolation tests固定语义。
- [Workspace/Deployment readers或writers发生行为漂移] → 共享private SQLAlchemy helpers，并分别运行reader与writer parity suites。
- [Replacement包含delete与insert] → 两步必须使用同一caller Session/transaction；任何insert failure由caller rollback恢复old row。
- [`webhook_id`存在但没有reverse lookup port] → 本change只固定持久化字段和uniqueness；lookup contract由实际需要它的change定义。

## Migration Plan

1. 添加Repository entity、Protocol、schema与error contract tests。
2. 定义`HumanInputIMChannel` / `human_input_im_channels`与non-null unique `owner_key`、unique `webhook_id`和positive-version check。
3. 在`sqlalchemy_im_channel_repository.py`中实现private mapping/SQLAlchemy helpers与Workspace/Deployment readers和writers。
4. 验证owner isolation、concurrent create、constraint classification、scalar CAS、replacement ABA与rollback。
5. 由后续application change迁移management、controller、Webhook/runtime和其他callers；本change不预定义其ports或orchestration。
