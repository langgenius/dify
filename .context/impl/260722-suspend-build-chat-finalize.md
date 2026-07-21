# Build Chat Finalize 保留 Sandbox

## 目标

Build Draft Apply 会先执行 Build Chat Finalize，再从同一个 retained Build Sandbox 创建不可变 Home Snapshot。Finalize 不应在 Apply 读取 Sandbox 之前删除它。

## 实现

- 将 Build Chat Finalize 注入的 Agent runtime 退出意图从 `delete` 改为 `suspend`。
- 保留已有 runtime lifecycle API 和后续 Apply 清理流程，不引入新的 Sandbox 所有权或资源回收设计。
- 更新 `AgentAppGenerateEntity` 中直接过期的生命周期说明。
- 更新现有 controller 单元测试，明确断言 Finalize 使用 `suspend`。

## 相对原行为的差异

原行为在 Finalize 成功退出时删除物理 Sandbox，并将 runtime session 退休，导致随后 Build Draft Apply 无法找到 ACTIVE session，也无法从 Sandbox 创建 Home Snapshot。

新行为在 Finalize 后暂停并保留 Sandbox。Build Draft Apply 可以继续解析 retained Sandbox、创建 Home Snapshot，并沿用现有 Apply 成功后的 runtime session 清理路径。

## 验证

- `uv run --project api pytest api/tests/unit_tests/controllers/console/agent/test_agent_controllers.py::test_build_chat_finalization_helper_forces_debug_build_and_push_prompt`
  - 结果：`1 passed`，另有 2 个既有 deprecation warnings。
- `git diff --check`
  - 结果：通过。
