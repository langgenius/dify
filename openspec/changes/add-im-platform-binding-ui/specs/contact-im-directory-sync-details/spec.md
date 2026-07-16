## ADDED Requirements

### Requirement: Contacts 通讯录同步必须由管理员手动触发

前端 MUST 只允许 mock context 中具备管理权限的用户手动触发 Contacts IM directory sync。同步入口 MUST 仅在当前 IM platform 为 `Connected` 且 provider definition 声明支持通讯录读取时可用；本 capability MUST NOT 引入定时或自动同步。

#### Scenario: 已连接且支持通讯录同步

- **WHEN** 当前 provider 状态为 `Connected`、支持 directory sync，且 `can_manage` 为 true
- **THEN** 前端 MUST 启用手动同步操作

#### Scenario: Provider 尚未连接

- **WHEN** 当前 provider 未配置、仅为 `Configured` 或处于任一错误状态
- **THEN** 前端 MUST 禁用同步操作并提示先完成或修复连接

#### Scenario: Provider 不支持通讯录同步

- **WHEN** mock provider capability 声明不支持 directory sync
- **THEN** 前端 MUST 禁止触发同步并展示能力限制说明

#### Scenario: 普通用户尝试同步

- **WHEN** mock context 中无管理权限的用户进入同步区域
- **THEN** 前端 MUST 隐藏或禁用同步操作并展示权限说明

### Requirement: 同步 UI 必须只通过 typed mock repository 访问数据

本 change 中的同步 mutation、状态 query、摘要和详情 MUST 通过 Contacts-owned repository interface 访问 typed mock data。组件 MUST NOT 调用真实同步 API、真实 provider 或生成式 client。

#### Scenario: 启动 mock 同步

- **WHEN** 管理员点击同步
- **THEN** 前端 MUST 调用 repository mutation 并取得稳定的 mock `sync_run_id`

#### Scenario: 读取 mock 同步状态

- **WHEN** 页面展示 active run、最新摘要或指定 run 详情
- **THEN** 前端 MUST 通过 repository view model 读取数据，MUST NOT 直接 import 详情 fixture

#### Scenario: 确定性状态推进

- **WHEN** queued 或 running scenario 需要进入终态
- **THEN** repository MUST 使用 fake timers 或显式推进机制控制状态，MUST NOT 使用随机结果或不可控的真实延迟

#### Scenario: 前端同步不访问真实服务

- **WHEN** 任一同步交互运行
- **THEN** 当前 change MUST NOT 新增后端 endpoint、OpenAPI schema、任务队列或网络请求

### Requirement: 同一 Organization 不得重复启动并行 mock 同步

当前 Organization 已存在 queued 或 running 的 mock sync run 时，前端 MUST 连接到该任务的状态，MUST NOT 再创建重复任务。

#### Scenario: 启动新的同步

- **WHEN** 当前没有进行中的 run 且管理员点击同步
- **THEN** repository MUST 创建一次 mock run、返回其 identifier，并使 UI 进入进行中状态

#### Scenario: 重复点击同步

- **WHEN** 同步 mutation 或当前 run 仍在进行中
- **THEN** 前端 MUST 禁用重复触发并继续展示当前 run 状态

#### Scenario: 页面重新打开时已有同步

- **WHEN** 管理员重新打开 Contacts，而当前 scenario 已有 queued 或 running run
- **THEN** 前端 MUST 恢复该 run 的进度展示，MUST NOT 将其视为新的同步

### Requirement: UI 必须展示同步生命周期与最新摘要

前端 MUST 区分 queued、running、success、partial success 和 failure，并 MUST 展示 mock view model 提供的发起时间、发起人、完成时间或耗时、结果计数和安全错误摘要。同步状态 MUST 与 IM connection status 分开表达。

#### Scenario: 同步进行中

- **WHEN** mock run 为 queued 或 running
- **THEN** 前端 MUST 展示进行中状态，并按受控间隔读取该 run

#### Scenario: 同步全部成功

- **WHEN** mock run 完成且没有 unmatched、skipped 或 failed 结果
- **THEN** 前端 MUST 展示 success、完成时间和结果汇总

#### Scenario: 同步部分成功

- **WHEN** mock run 完成且同时包含成功结果与 unmatched、skipped 或 failed 结果
- **THEN** 前端 MUST 展示 partial success，并引导管理员查看同步详情

#### Scenario: 同步失败

- **WHEN** scenario 将 run 推进为 failure
- **THEN** 前端 MUST 展示安全错误原因和重试入口，同时保留上一次已完成 run 的可查看结果

#### Scenario: 同步到达终态

- **WHEN** queued 或 running run 进入任一终态
- **THEN** 前端 MUST 停止 polling，并刷新 integration summary 和当前 run 详情

### Requirement: 同步摘要必须区分联系人匹配结果

前端 MUST 使用同一个 mock sync run 的计数展示 matched、created binding、updated binding、unmatched、skipped 和 failed。前端 MUST NOT 将不同 run 的结果拼接为同一次摘要。

#### Scenario: 展示同步结果计数

- **WHEN** 一次 mock run 已返回结果摘要
- **THEN** 前端 MUST 展示该 run 各结果分类的计数与总量

#### Scenario: 结果计数为零

- **WHEN** 某个结果分类的计数为零
- **THEN** 前端 MUST 以明确零值或设计指定的省略规则展示，MUST NOT 将其显示为未知错误

#### Scenario: 计数与详情不一致

- **WHEN** 开发 fixture 中的摘要计数与当前 run 详情不一致
- **THEN** mock scenario validation SHOULD 使测试失败，避免把自相矛盾的数据交给 UI

### Requirement: 同步详情必须提供逐项、可排查的匹配信息

前端 MUST 允许管理员打开指定 `sync_run_id` 的详情。每条 mock 结果 MUST 在数据可用时展示 IM platform identity 的显示名、Email、platform user ID、匹配到的 Contact、结果分类和安全原因；缺失字段 MUST 使用明确空值表达，不得伪造数据。

#### Scenario: 已匹配 Contact

- **WHEN** mock platform member 已匹配到 Contact
- **THEN** 详情 MUST 展示 platform identity、目标 Contact 以及 matched、created binding 或 updated binding 结果

#### Scenario: 未匹配 platform member

- **WHEN** mock platform member 未命中 binding 或 Contact
- **THEN** 详情 MUST 将其标记为 unmatched，MUST NOT 表示系统已自动创建 External contact

#### Scenario: 跳过条目

- **WHEN** mock item 因缺少必要字段、重复或规则明确忽略而被跳过
- **THEN** 详情 MUST 展示 skipped 状态和安全原因

#### Scenario: 单条处理失败

- **WHEN** mock item 的 result 为 failed
- **THEN** 详情 MUST 展示 failed 状态和可排查原因，同时保留其他成功条目

#### Scenario: 通过 URL 恢复详情

- **WHEN** URL query 中包含有效 `sync_run_id`
- **THEN** 前端 MUST 恢复该 run 的详情上下文

### Requirement: 同步详情必须支持结果筛选与 mock 分页

前端 MUST 支持按结果分类查看同步条目，并 MUST 使用 repository 提供的分页或等价增量加载方式展示详情。筛选、分页和重试 MUST 始终绑定到当前 `sync_run_id`。

#### Scenario: 按 unmatched 筛选

- **WHEN** 管理员选择 unmatched 分类
- **THEN** 前端 MUST 只读取或展示当前 run 中的 unmatched 条目

#### Scenario: 加载更多同步条目

- **WHEN** 当前分类还有下一页 mock 结果
- **THEN** 前端 MUST 允许增量加载且不得重复已有条目

#### Scenario: 详情分页失败

- **WHEN** scenario 使后续页读取失败
- **THEN** 前端 MUST 保留已加载条目并提供针对当前页的重试操作

#### Scenario: 切换筛选项

- **WHEN** 管理员从一个结果分类切换到另一个分类
- **THEN** 前端 MUST 重置该分类的分页游标，且 MUST NOT 混入上一分类的条目

### Requirement: Unmatched 结果必须保持 Contacts 领域语义

前端 MUST 将 unmatched 结果作为待后续人工处理的同步事实展示。同步详情 MUST NOT 自动创建 External contact，也 MUST NOT 在没有明确后续 capability 的情况下修改 Contact 或 IM Binding。

#### Scenario: 查看 unmatched 详情

- **WHEN** 管理员打开 unmatched 条目
- **THEN** 前端 MUST 展示 platform identity 和未匹配原因，MUST NOT 自动改变任何 Contacts 数据

#### Scenario: 后续处理能力尚未提供

- **WHEN** 当前版本没有手动映射或忽略 unmatched 的 capability
- **THEN** 前端 MUST 将详情保持为只读，MUST NOT 展示无法完成的伪操作

### Requirement: 同步 UI 必须安全、可访问且可恢复

前端和 mock fixture MUST 避免在同步摘要、详情、日志、错误反馈或测试快照中暴露 provider credential。用户可见文案 MUST 国际化，关键状态与操作 MUST 能被辅助技术识别。

#### Scenario: Mock 错误包含敏感诊断文本

- **WHEN** scenario 构造的原始错误包含 credential 或敏感 request detail
- **THEN** repository MUST 只向 view model 暴露经过安全处理的错误摘要

#### Scenario: 同步详情加载失败

- **WHEN** 指定 mock run 的详情读取失败
- **THEN** 前端 MUST 展示错误与重试操作，并 MUST 保留可用的同步摘要

#### Scenario: 辅助技术读取状态变化

- **WHEN** run 从 queued 进入 running 或终态
- **THEN** 前端 MUST 以不会造成重复噪声的可访问方式通知关键状态变化

#### Scenario: 关闭同步详情后恢复焦点

- **WHEN** 管理员关闭同步详情 drawer 或 dialog
- **THEN** 前端 MUST 将焦点恢复到打开详情的触发控件
