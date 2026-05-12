# HITL Tracing Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore workflow tracing for resumed HITL workflow and advanced-chat executions by rebuilding `TraceQueueManager` during resume when the serialized generate entity no longer has one.

**Architecture:** Keep tracing initialization in app generators, matching the existing normal generate path. `WorkflowPersistenceLayer` remains a consumer of an injected `trace_manager`; pause events still persist `PAUSED` state without enqueueing workflow trace tasks. The implementation is intentionally inline in the two resume methods, with no shared helper and no Phoenix provider changes.

**Tech Stack:** Python, Pydantic v2 models, pytest, Dify backend app generators, `TraceQueueManager`.

---

## Strong Typing Guidance

- Prefer existing Pydantic generate entities over raw dict payloads.
- Do not introduce ad hoc dicts for test capture state; use typed local variables.
- The implementation should only use a small `model_copy(update=...)` mapping because that is the Pydantic API for replacing an excluded field on an existing model.
- Do not add a new Pydantic model solely for the `trace_manager` update payload; that would add indirection without improving the app-generator contract.

---

## File Structure

- Modify `api/core/app/apps/workflow/app_generator.py`
  - Responsibility: restore `TraceQueueManager` inside `WorkflowAppGenerator.resume()` before delegating to `_generate()`.
- Modify `api/core/app/apps/advanced_chat/app_generator.py`
  - Responsibility: restore `TraceQueueManager` inside `AdvancedChatAppGenerator.resume()` before delegating to `_generate()`.
- Modify `api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py`
  - Responsibility: unit coverage for workflow resume trace-manager restoration and preservation.
- Modify `api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py`
  - Responsibility: unit coverage for advanced-chat resume trace-manager restoration and preservation.

Do not modify `api/core/app/workflow/layers/persistence.py`, Phoenix provider code, HITL event handling, or pause tracing behavior.

---

### Task 1: Add Workflow Resume Tests

**Files:**
- Test: `api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py`

- [ ] **Step 1: Write the failing workflow resume restoration test**

Append this test class after `TestWorkflowAppGeneratorGenerate`:

```python
class TestWorkflowAppGeneratorResume:
    def test_resume_restores_trace_manager_when_missing(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_execution_id="run-id",
            call_depth=0,
        )
        DummyTraceQueueManager = type(
            "_DummyTraceQueueManager",
            (TraceQueueManager,),
            {
                "__init__": lambda self, app_id=None, user_id=None: (
                    setattr(self, "app_id", app_id) or setattr(self, "user_id", user_id)
                )
            },
        )
        monkeypatch.setattr(
            "core.app.apps.workflow.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        captured_entity: WorkflowAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            application_generate_entity=application_generate_entity,
            graph_runtime_state=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        trace_manager = captured_entity.trace_manager
        assert isinstance(trace_manager, DummyTraceQueueManager)
        assert trace_manager.app_id == "app-id"
        assert trace_manager.user_id == "session-id"
```

- [ ] **Step 2: Run the workflow restoration test to verify it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py::TestWorkflowAppGeneratorResume::test_resume_restores_trace_manager_when_missing -q
```

Expected: FAIL because `captured_entity.trace_manager` is still `None`.

- [ ] **Step 3: Write the failing workflow preservation test**

Add this method inside `TestWorkflowAppGeneratorResume`:

```python
    def test_resume_preserves_existing_trace_manager(self, monkeypatch: pytest.MonkeyPatch):
        generator = WorkflowAppGenerator()
        app_config = WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.WORKFLOW,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )
        existing_trace_manager = SimpleNamespace(app_id="existing-app", user_id="existing-user")
        application_generate_entity = WorkflowAppGenerateEntity.model_construct(
            task_id="task",
            app_config=app_config,
            inputs={},
            files=[],
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=existing_trace_manager,
            workflow_execution_id="run-id",
            call_depth=0,
        )
        captured_entity: WorkflowAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            application_generate_entity=application_generate_entity,
            graph_runtime_state=SimpleNamespace(),
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        assert captured_entity.trace_manager is existing_trace_manager
```

- [ ] **Step 4: Run workflow resume tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py::TestWorkflowAppGeneratorResume -q
```

Expected: one FAIL for missing restoration and one PASS for preserving an existing trace manager.

- [ ] **Step 5: Commit the failing workflow tests**

```bash
git add api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py
git commit -m "test: cover workflow resume trace restoration"
```

---

### Task 2: Add Advanced Chat Resume Tests

**Files:**
- Test: `api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py`

- [ ] **Step 1: Write the failing advanced-chat resume restoration test**

Append this class after the existing generator-focused test classes:

```python
class TestAdvancedChatAppGeneratorResume:
    @staticmethod
    def _build_app_config() -> WorkflowUIBasedAppConfig:
        return WorkflowUIBasedAppConfig(
            tenant_id="tenant",
            app_id="app",
            app_mode=AppMode.ADVANCED_CHAT,
            additional_features=AppAdditionalFeatures(),
            variables=[],
            workflow_id="workflow-id",
        )

    def test_resume_restores_trace_manager_when_missing(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            file_upload_config=None,
            conversation_id="conversation-id",
            inputs={},
            query="hello",
            files=[],
            parent_message_id="parent-message-id",
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=None,
            workflow_run_id="run-id",
        )
        DummyTraceQueueManager = type(
            "_DummyTraceQueueManager",
            (TraceQueueManager,),
            {
                "__init__": lambda self, app_id=None, user_id=None: (
                    setattr(self, "app_id", app_id) or setattr(self, "user_id", user_id)
                )
            },
        )
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.app_generator.TraceQueueManager",
            DummyTraceQueueManager,
        )
        captured_entity: AdvancedChatAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            conversation=SimpleNamespace(id="conversation-id"),
            message=SimpleNamespace(id="message-id"),
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        trace_manager = captured_entity.trace_manager
        assert isinstance(trace_manager, DummyTraceQueueManager)
        assert trace_manager.app_id == "app-id"
        assert trace_manager.user_id == "session-id"
```

- [ ] **Step 2: Run the advanced-chat restoration test to verify it fails**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py::TestAdvancedChatAppGeneratorResume::test_resume_restores_trace_manager_when_missing -q
```

Expected: FAIL because `captured_entity.trace_manager` is still `None`.

- [ ] **Step 3: Write the advanced-chat preservation test**

Add this method inside `TestAdvancedChatAppGeneratorResume`:

```python
    def test_resume_preserves_existing_trace_manager(self, monkeypatch: pytest.MonkeyPatch):
        generator = AdvancedChatAppGenerator()
        existing_trace_manager = SimpleNamespace(app_id="existing-app", user_id="existing-user")
        application_generate_entity = AdvancedChatAppGenerateEntity.model_construct(
            task_id="task",
            app_config=self._build_app_config(),
            file_upload_config=None,
            conversation_id="conversation-id",
            inputs={},
            query="hello",
            files=[],
            parent_message_id="parent-message-id",
            user_id="user",
            stream=False,
            invoke_from=InvokeFrom.WEB_APP,
            extras={},
            trace_manager=existing_trace_manager,
            workflow_run_id="run-id",
        )
        captured_entity: AdvancedChatAppGenerateEntity | None = None

        def _fake_generate(**kwargs):
            nonlocal captured_entity
            captured_entity = kwargs["application_generate_entity"]
            return SimpleNamespace(ok=True)

        monkeypatch.setattr(generator, "_generate", _fake_generate)

        result = generator.resume(
            app_model=SimpleNamespace(id="app-id"),
            workflow=SimpleNamespace(),
            user=SimpleNamespace(id="end-user-id", session_id="session-id"),
            conversation=SimpleNamespace(id="conversation-id"),
            message=SimpleNamespace(id="message-id"),
            application_generate_entity=application_generate_entity,
            workflow_execution_repository=SimpleNamespace(),
            workflow_node_execution_repository=SimpleNamespace(),
            graph_runtime_state=SimpleNamespace(),
        )

        assert result.ok is True
        assert captured_entity is not None
        assert captured_entity.trace_manager is existing_trace_manager
```

- [ ] **Step 4: Run advanced-chat resume tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py::TestAdvancedChatAppGeneratorResume -q
```

Expected: one FAIL for missing restoration and one PASS for preserving an existing trace manager.

- [ ] **Step 5: Commit the failing advanced-chat tests**

```bash
git add api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py
git commit -m "test: cover advanced chat resume trace restoration"
```

---

### Task 3: Restore Trace Managers Inline in Resume Methods

**Files:**
- Modify: `api/core/app/apps/workflow/app_generator.py`
- Modify: `api/core/app/apps/advanced_chat/app_generator.py`

- [ ] **Step 1: Update workflow resume inline**

In `WorkflowAppGenerator.resume()`, insert this block immediately after the docstring and before `return self._generate(...)`:

```python
        if application_generate_entity.trace_manager is None:
            application_generate_entity = application_generate_entity.model_copy(
                update={
                    "trace_manager": TraceQueueManager(
                        app_id=app_model.id,
                        user_id=user.id if isinstance(user, Account) else user.session_id,
                    )
                }
            )
```

- [ ] **Step 2: Run workflow resume tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py::TestWorkflowAppGeneratorResume -q
```

Expected: PASS.

- [ ] **Step 3: Update advanced-chat resume inline**

In `AdvancedChatAppGenerator.resume()`, insert this block immediately after the docstring and before `return self._generate(...)`:

```python
        if application_generate_entity.trace_manager is None:
            application_generate_entity = application_generate_entity.model_copy(
                update={
                    "trace_manager": TraceQueueManager(
                        app_id=app_model.id,
                        user_id=user.id if isinstance(user, Account) else user.session_id,
                    )
                }
            )
```

- [ ] **Step 4: Run advanced-chat resume tests**

Run:

```bash
uv run --project api pytest api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py::TestAdvancedChatAppGeneratorResume -q
```

Expected: PASS.

- [ ] **Step 5: Run both targeted test files**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py \
  -q
```

Expected: PASS.

- [ ] **Step 6: Commit the implementation**

```bash
git add api/core/app/apps/workflow/app_generator.py api/core/app/apps/advanced_chat/app_generator.py
git commit -m "fix: restore trace manager on workflow resume"
```

---

### Task 4: Final Verification

**Files:**
- Verify: `api/core/app/apps/workflow/app_generator.py`
- Verify: `api/core/app/apps/advanced_chat/app_generator.py`
- Verify: `api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py`
- Verify: `api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py`

- [ ] **Step 1: Confirm pause tracing remains unchanged**

Run:

```bash
git diff HEAD~3..HEAD -- api/core/app/workflow/layers/persistence.py
```

Expected: no output. This confirms `GraphRunPausedEvent` behavior was not changed in this implementation.

- [ ] **Step 2: Run focused test suite**

Run:

```bash
uv run --project api pytest \
  api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py::TestWorkflowAppGeneratorResume \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py::TestAdvancedChatAppGeneratorResume \
  -q
```

Expected: PASS.

- [ ] **Step 3: Run lint for touched backend files**

Run:

```bash
uv run --project api ruff check \
  api/core/app/apps/workflow/app_generator.py \
  api/core/app/apps/advanced_chat/app_generator.py \
  api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py \
  api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py
```

Expected: PASS.

- [ ] **Step 4: Commit verification notes only if files changed**

If lint or formatting changes files, commit them:

```bash
git add api/core/app/apps/workflow/app_generator.py api/core/app/apps/advanced_chat/app_generator.py api/tests/unit_tests/core/app/apps/workflow/test_app_generator_extra.py api/tests/unit_tests/core/app/apps/advanced_chat/test_app_generator.py
git commit -m "chore: format resume tracing changes"
```

If no files changed, do not create an empty commit.

---

## Self-Review

- Spec coverage: Task 3 restores `TraceQueueManager` in both resume methods. Tasks 1 and 2 cover missing-manager restoration and existing-manager preservation. Task 4 checks that pause tracing and persistence-layer behavior remain untouched.
- Scope check: The plan excludes pause checkpoint traces, Phoenix provider changes, persistence-layer initialization, task-level resume changes, and `NodeRunHumanInputFormFilledEvent` handling.
- Type consistency: The code uses existing `application_generate_entity.trace_manager`, `model_copy(update=...)`, `TraceQueueManager(app_id=..., user_id=...)`, and existing `Account` imports in both generator modules.
