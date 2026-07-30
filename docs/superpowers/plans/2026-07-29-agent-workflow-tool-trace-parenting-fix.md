# Workflow-as-Tool Trace Parenting Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Agent tool-call parent trace context active until a lazy Workflow-as-Tool invocation has been fully consumed.

**Architecture:** `AgentToolInnerService` remains the lifecycle owner for the invocation-local workflow runtime. It will set the parent context before invoking the tool, materialize transformed tool messages while that context is active, and clear the context in `finally` on both success and failure.

**Tech Stack:** Python 3.12, pytest, unittest.mock, SQLAlchemy-backed unit-test fixtures, Ruff.

---

### Task 1: Reproduce the lazy invocation lifecycle bug

**Files:**
- Modify: `api/tests/unit_tests/services/test_agent_tool_inner_service.py`

- [ ] **Step 1: Add a workflow request helper and observable runtime**

Add these helpers after `_request()`:

```python
def _workflow_request() -> AgentToolInvokeRequest:
    payload = _request().model_dump(mode="json")
    payload["caller"].update(
        {
            "parent_workflow_run_id": "outer-workflow-run-1",
            "tool_call_span_id": "tool-call-span-1",
        }
    )
    payload["tool"].update(
        {
            "provider_type": "workflow",
            "provider_id": "workflow-provider-1",
            "tool_name": "child_workflow",
        }
    )
    return AgentToolInvokeRequest.model_validate(payload)


class _TraceAwareWorkflowRuntime:
    def __init__(self) -> None:
        self.parent_context: tuple[str, str] | None = None

    def set_parent_trace_context(
        self,
        *,
        parent_workflow_run_id: str,
        parent_node_execution_id: str,
    ) -> None:
        self.parent_context = (parent_workflow_run_id, parent_node_execution_id)

    def clear_parent_trace_context(self) -> None:
        self.parent_context = None
```

- [ ] **Step 2: Add a success-path regression test**

Add a test that returns a lazy generator from `ToolEngine.generic_invoke` and
records the runtime context only when the generator is consumed:

```python
@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_workflow_parent_trace_context_remains_set_while_lazy_messages_are_consumed(
    sqlite_session: Session,
) -> None:
    runtime = _TraceAwareWorkflowRuntime()
    observed_contexts: list[tuple[str, str] | None] = []
    _persist_app(sqlite_session)

    def lazy_messages() -> Generator[ToolInvokeMessage, None, None]:
        observed_contexts.append(runtime.parent_context)
        yield from _messages()

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=runtime),
        patch("services.agent_tool_inner_service.ToolEngine.generic_invoke", return_value=lazy_messages()),
        patch(
            "services.agent_tool_inner_service.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=lambda messages, **_kwargs: messages,
        ),
    ):
        response = AgentToolInnerService().invoke(_workflow_request(), session=sqlite_session)

    assert response.observation == "ok"
    assert observed_contexts == [("outer-workflow-run-1", "tool-call-span-1")]
    assert runtime.parent_context is None
```

- [ ] **Step 3: Add a failure-path cleanup regression test**

Add a second test whose lazy generator raises during consumption:

```python
@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_workflow_parent_trace_context_is_cleared_when_lazy_message_consumption_fails(
    sqlite_session: Session,
) -> None:
    runtime = _TraceAwareWorkflowRuntime()
    observed_contexts: list[tuple[str, str] | None] = []
    _persist_app(sqlite_session)

    def failing_messages() -> Generator[ToolInvokeMessage, None, None]:
        observed_contexts.append(runtime.parent_context)
        raise RuntimeError("lazy workflow failed")
        yield from _messages()

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=runtime),
        patch("services.agent_tool_inner_service.ToolEngine.generic_invoke", return_value=failing_messages()),
        patch(
            "services.agent_tool_inner_service.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=lambda messages, **_kwargs: messages,
        ),
    ):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            AgentToolInnerService().invoke(_workflow_request(), session=sqlite_session)

    assert exc_info.value.error_code == "agent_tool_invoke_unexpected_error"
    assert observed_contexts == [("outer-workflow-run-1", "tool-call-span-1")]
    assert runtime.parent_context is None
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run:

```bash
uv run --project api pytest -q api/tests/unit_tests/services/test_agent_tool_inner_service.py \
  -k "workflow_parent_trace_context"
```

Expected: both tests fail because `observed_contexts` contains `None`; this
proves the service clears the context before lazy iteration begins.

### Task 2: Keep the parent context active through lazy consumption

**Files:**
- Modify: `api/services/agent_tool_inner_service.py`
- Test: `api/tests/unit_tests/services/test_agent_tool_inner_service.py`

- [ ] **Step 1: Move transformed-message materialization inside the lifecycle guard**

Replace the invocation block with:

```python
            try:
                messages = ToolEngine.generic_invoke(
                    session=session,
                    tool=tool_runtime,
                    tool_parameters=dict(request.tool.tool_parameters),
                    user_id=request.caller.user_id,
                    workflow_tool_callback=DifyWorkflowCallbackHandler(),
                    workflow_call_depth=0,
                    conversation_id=request.caller.conversation_id,
                    app_id=request.caller.app_id,
                )
                transformed_messages = list(
                    ToolFileMessageTransformer.transform_tool_invoke_messages(
                        messages=messages,
                        user_id=request.caller.user_id,
                        tenant_id=request.caller.tenant_id,
                        conversation_id=request.caller.conversation_id,
                    )
                )
            finally:
                if set_parent_trace_context:
                    tool_runtime.clear_parent_trace_context()  # type: ignore[attr-defined]
```

- [ ] **Step 2: Run the focused tests and verify GREEN**

Run:

```bash
uv run --project api pytest -q api/tests/unit_tests/services/test_agent_tool_inner_service.py \
  -k "workflow_parent_trace_context"
```

Expected: 2 passed.

- [ ] **Step 3: Run the complete service test file**

Run:

```bash
uv run --project api pytest -q api/tests/unit_tests/services/test_agent_tool_inner_service.py
```

Expected: all tests pass.

### Task 3: Verify regressions and commit

**Files:**
- Modify: `api/services/agent_tool_inner_service.py`
- Modify: `api/tests/unit_tests/services/test_agent_tool_inner_service.py`

- [ ] **Step 1: Run the unified tracing regression suite**

Run:

```bash
uv run --project api pytest -q api/tests/unit_tests/core/ops/unified_trace
```

Expected: all tests pass.

- [ ] **Step 2: Run Ruff on the changed Python files**

Run:

```bash
uv run --project api ruff check \
  api/services/agent_tool_inner_service.py \
  api/tests/unit_tests/services/test_agent_tool_inner_service.py
```

Expected: exit code 0 with no lint errors.

- [ ] **Step 3: Check the final diff and preserve unrelated work**

Run:

```bash
git diff --check
git status --short
git diff -- api/services/agent_tool_inner_service.py \
  api/tests/unit_tests/services/test_agent_tool_inner_service.py
```

Expected: no whitespace errors; only the two intended Python files are part of
the code change. The pre-existing
`docker/ssrf_proxy/squid.conf.template` modification remains unstaged.

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add api/services/agent_tool_inner_service.py \
  api/tests/unit_tests/services/test_agent_tool_inner_service.py
git commit -m "fix(trace): preserve workflow tool parent context"
```

Expected: one commit containing the regression tests and minimal lifecycle fix.
