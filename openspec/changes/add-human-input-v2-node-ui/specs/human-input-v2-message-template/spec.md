## ADDED Requirements

### Requirement: Message Template 弹窗必须以局部草稿编辑 subject 与 body

Message Template MUST 按 Figma node `25170:22597` 在 overlay 中编辑 `message_template.subject` 与 `message_template.body`。打开 overlay 时 MUST 从 node data 建立局部 draft；未确认的修改 MUST NOT 立即写入 node data。

#### Scenario: 打开 Message Template

- **WHEN** 用户从 Human Input v2 panel 打开 Message Template
- **THEN** overlay MUST 以当前 subject 和 body 初始化 draft，并按 Figma 展示字段与辅助内容

#### Scenario: 编辑 draft

- **WHEN** 用户修改 subject 或 body 但尚未确认
- **THEN** node data MUST 保持不变

#### Scenario: 确认有效 draft

- **WHEN** subject 与 body 通过前端校验且用户确认
- **THEN** 前端 MUST 一次性写回完整 `message_template`，并关闭 overlay

### Requirement: 取消或关闭 Message Template 不得提交草稿

Cancel、Escape 或设计允许的 close 操作 MUST 丢弃未确认 draft。存在未保存修改时，overlay MUST 按 Figma 定义的关闭或二次确认行为处理。

#### Scenario: 取消未保存修改

- **WHEN** 用户修改 template 后选择取消
- **THEN** overlay MUST 关闭或按设计确认丢弃，node data MUST 保持打开前的 subject 与 body

#### Scenario: 使用 Escape 关闭

- **WHEN** overlay 允许 Escape 关闭且用户按下 Escape
- **THEN** 前端 MUST 使用与其他 close action 相同的未保存修改语义

#### Scenario: 关闭后恢复焦点

- **WHEN** overlay 因取消或确认而关闭
- **THEN** 前端 MUST 将焦点恢复到打开 Message Template 的触发控件

### Requirement: Message Template 必须使用 v2 校验而非 v1 delivery 校验

subject、body 的 required、空白、字符限制和设计错误状态 MUST 以 v2 Figma acceptance matrix 为准。前端 MUST NOT 因 v1 Email delivery 的规则而隐式要求 `{{#url#}}` token，除非后续 v2 contract 明确增加该要求。

#### Scenario: v2 required field 缺失

- **WHEN** 用户确认一个不满足 Figma-required subject 或 body 的 draft
- **THEN** overlay MUST 阻止提交并将错误关联到对应字段

#### Scenario: Template 不包含 v1 URL token

- **WHEN** subject 与 body 满足 v2 规则但不包含 `{{#url#}}`
- **THEN** 前端 MUST NOT 仅因缺少该 v1 token 而拒绝提交

#### Scenario: 重复确认

- **WHEN** confirm 正在处理本地提交
- **THEN** overlay MUST 防止同一 draft 被重复提交

### Requirement: Message Template 变量必须接入 workflow dependency 维护

当 Figma 允许在 subject 或 body 中插入 workflow variables 时，前端 MUST 使用现有 variable picker 与 template token primitives，并 MUST 将这些引用纳入依赖提取、重命名、删除、复制和粘贴流程。

#### Scenario: 插入 workflow variable

- **WHEN** 用户从支持的 variable picker 向 subject 或 body 插入变量
- **THEN** draft MUST 写入现有 workflow 可解析的 token，并在重新打开 overlay 后保持可编辑

#### Scenario: 重命名被引用变量

- **WHEN** message template 引用的变量或上游节点发生受支持的重命名
- **THEN** 前端 MUST 更新对应 token，MUST NOT 改变普通文本

#### Scenario: 删除被引用变量

- **WHEN** template 引用的变量被删除或不可用
- **THEN** 前端 MUST 保留 template 文本并展示可修复的 invalid reference，MUST NOT 静默删除整段内容

#### Scenario: 复制粘贴 v2 节点

- **WHEN** 用户复制并粘贴包含 template variable 的 v2 节点
- **THEN** 前端 MUST 使用 workflow copy/paste mapping 重写适用引用，并保持 subject/body 其他内容不变

### Requirement: Message Template 必须支持 read-only、本地化与可访问操作

overlay 的标题、字段 label、帮助文本、错误和 action MUST 使用 i18n 文案与 dify-ui overlay primitives。read-only workflow MUST 允许查看 template，但 MUST 禁止提交修改。

#### Scenario: 只读查看 template

- **WHEN** workflow editor 处于只读状态且用户打开 Message Template
- **THEN** overlay MUST 展示当前 subject 与 body，并禁用修改和确认写入

#### Scenario: 键盘编辑 template

- **WHEN** 用户只使用键盘打开、编辑、校验并确认 template
- **THEN** overlay MUST 提供焦点约束、合理 tab 顺序、可见焦点和明确 button name

#### Scenario: 辅助技术读取字段错误

- **WHEN** subject 或 body 校验失败
- **THEN** error MUST 与对应输入控件建立可感知关联，并在适当时获得焦点
