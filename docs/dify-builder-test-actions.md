# Builder 测试 Action 接入（ENG-1293）

前端继续使用已有 Builder `/actions`、会话 GET、`/conversation` 和 SSE。`run_test` / `provide_testdata` 保留普通原生 Test Run 路径；不要另调 `/native-tests` 启动第二次执行。旧 native 路由保留兼容，但不再是推荐接入方式。

基址为 `/console/api/dify-builder/sessions/{session_id}`，沿用 Console 登录与 CSRF client。这里的 Bearer 是 Console JWT，不是应用 API key。权限、归属、工作流版本及执行范围仍由服务端核对。

## 当前状态和输入

先 GET 当前会话，并读取历史。`version` 是提交动作时的 `base_version`；`app_revision.current` 是 `base_app_revision`。按现有表单提交测试输入，保存后的输入 ID 由后端关联，不由浏览器生成。

`test_execution` 为实际存在的 native request 的公开回执。无 native request 的普通 Run 返回 null，继续使用已有 Run / test-result 展示，不能把 null 当成执行失败。

普通 action 响应 SSE 的 `command_finished.data` 和会话 GET 使用同一 `test_execution` 投影。不必传 `native_tests` 参数。已有 `GET /stream` 继续用于运行中订阅；重连后重新 GET 权威状态，不能自动重新发送之前的 action。

## 统一动作

服务端 `actions[]` 给出当前可用动作与其 `payload`。前端原样保留目标字段；使用现有 choice 提交时，将选中项的服务端 payload 合入原有 `option_id`。不要只提交 option_id，也不要从旧历史卡片重新构造目标。

| action ID | payload | 含义 |
| --- | --- | --- |
| `confirm_test_operation` | `request_id`, `pending_operation_id`, `pending_version`, `scope_digest` | 保存当前单项确认，不执行调用 |
| `deny_test_operation` | 同上 | 保存拒绝；按后端真实结果收尾 |
| `resume_test` | `request_id`, `expected_generation` | 继续同一 request，仅当前 actions 提供时可用 |
| `cancel_test` | `request_id` | 请求取消；不能声称外部副作用已撤销 |

示例（字段值都取自最新会话，不使用这里的占位值）：

```json
{
  "action_id": "confirm",
  "payload": {
    "option_id": "confirm_test_operation",
    "request_id": "server-request-id",
    "pending_operation_id": "server-operation-id",
    "pending_version": 1,
    "scope_digest": "server-scope-digest"
  },
  "client_action_id": "stable-client-generated-id",
  "base_version": 8,
  "base_app_revision": "latest-app-revision"
}
```

也可直接将 `action_id` 设为新动作 ID，此时 payload 不需要 `option_id`。同一次逻辑提交的网络重试必须保留完整原请求和 `client_action_id`；改变 payload、版本或目标时使用新 ID。该字段可选以兼容旧客户端，但新接入应发送它。同一 ID 复用不同内容返回 409。去重由持久化命令和执行账本保证，不依赖浏览器内存。

`base_version`、`pending_version`、`expected_generation` 属于三种不同的版本，不能互相代替。`scope_digest` 是后端签发的范围指纹，不能自行计算或当作授权凭证。

## 展示与恢复

- 风险披露使用已有 choice footer，显示账号、动作、目标、参数、风险及调用限制。审批默认不选中。逐项处理多个 pending；已保存决定只读。
- 确认之后依据最新 actions 单独提交 `resume_test`，不要在确认按钮里无条件自动创建新的测试。
- GET、刷新及 SSE 重连只读取状态；后台 worker 处理已存在运行的 ACK 与完成态恢复。
- `outcome=unknown` 表示可能已有副作用，不能自动重试、新建 run 或暗示未执行。显示回执中的阻塞原因。
- 取消成功受理可能仍为 `cancelling`；继续观察真实终态。HTTP 200 不是执行成功证明。
- 409 后刷新当前会话与卡片，说明版本、目标或范围已变化；不要悄悄把旧确认套用到新请求。策略错误响应提供安全的 `reason_code`，用户说明与 Trace 均可保留它。
- configuration / interaction 的完整配置表单续跑不在本次实现范围；`native_resolution_unavailable` 必须如实显示阻塞，不能把引用 ID 当成导航 URL。

## 前端最小适配

复用已有表单、choice、结果与 SSE 组件，补充：合并 action payload；同一提交稳定的 client_action_id；读取 test_execution；展示确认、恢复、unknown 和取消中状态。后端入口统一不代表旧前端无需适配。本次仅交付接口、文案契约与生成类型，不修改页面交互。
