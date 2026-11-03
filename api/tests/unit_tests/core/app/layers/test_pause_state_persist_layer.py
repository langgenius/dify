"""Persisted resume-envelope compatibility remains independent of engine layers."""

import json

import pytest
from pydantic import ValidationError

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    UserFrom,
    WorkflowAppGenerateEntity,
)
from core.app.layers.pause_state_persist_layer import (
    WorkflowResumptionContext,
    _AdvancedChatAppGenerateEntityWrapper,
    _WorkflowGenerateEntityWrapper,
)
from models.model import AppMode


def _build_workflow_generate_entity_for_roundtrip() -> WorkflowResumptionContext:
    """Create a WorkflowAppGenerateEntity with realistic data for WorkflowResumptionContext tests."""
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-roundtrip",
        app_id="app-roundtrip",
        app_mode=AppMode.WORKFLOW,
        workflow_id="workflow-roundtrip",
    )
    serialized_state = json.dumps({"state": "workflow"})

    return WorkflowResumptionContext(
        serialized_graph_runtime_state=serialized_state,
        generate_entity=_WorkflowGenerateEntityWrapper(
            entity=WorkflowAppGenerateEntity(
                user_from=UserFrom.ACCOUNT,
                task_id="workflow-task",
                app_config=app_config,
                inputs={"input_key": "input_value"},
                files=[],
                user_id="user-roundtrip",
                stream=False,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_execution_id="workflow-exec-roundtrip",
                extras={"trace_session_id": "session-1"},
            )
        ),
    )


def _build_advanced_chat_generate_entity_for_roundtrip() -> WorkflowResumptionContext:
    """Create an AdvancedChatAppGenerateEntity with realistic data for WorkflowResumptionContext tests."""
    app_config = WorkflowUIBasedAppConfig(
        tenant_id="tenant-advanced",
        app_id="app-advanced",
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-advanced",
    )
    serialized_state = json.dumps({"state": "workflow"})

    return WorkflowResumptionContext(
        serialized_graph_runtime_state=serialized_state,
        generate_entity=_AdvancedChatAppGenerateEntityWrapper(
            entity=AdvancedChatAppGenerateEntity(
                task_id="advanced-task",
                app_config=app_config,
                inputs={"topic": "roundtrip"},
                files=[],
                user_id="advanced-user",
                stream=False,
                invoke_from=InvokeFrom.DEBUGGER,
                workflow_run_id="advanced-run-id",
                query="Explain serialization behavior",
                extras={"trace_session_id": "session-1"},
            )
        ),
    )


@pytest.mark.parametrize(
    "state",
    [
        pytest.param(
            _build_advanced_chat_generate_entity_for_roundtrip(),
            id="advanced_chat",
        ),
        pytest.param(
            _build_workflow_generate_entity_for_roundtrip(),
            id="workflow",
        ),
    ],
)
def test_workflow_resumption_context_dumps_loads_roundtrip(state: WorkflowResumptionContext) -> None:
    """WorkflowResumptionContext roundtrip preserves workflow generate entity metadata."""
    dumped = state.dumps()
    loaded = WorkflowResumptionContext.loads(dumped)

    assert loaded == state
    assert loaded.serialized_graph_runtime_state == state.serialized_graph_runtime_state
    restored_entity = loaded.get_generate_entity()
    assert isinstance(restored_entity, type(state.generate_entity.entity))
    assert restored_entity.extras["trace_session_id"] == "session-1"


def test_resumption_context_defaults_elapsed_time_for_legacy_snapshots() -> None:
    context = _build_workflow_generate_entity_for_roundtrip()
    payload = context.model_dump()
    payload.pop("elapsed_time")

    restored = WorkflowResumptionContext.loads(json.dumps(payload))

    assert restored.elapsed_time == 0.0
    assert restored.get_generate_entity().workflow_execution_timing.elapsed_time == 0.0


@pytest.mark.parametrize("user_from", [UserFrom.ACCOUNT, UserFrom.END_USER])
def test_resumption_context_preserves_explicit_workflow_user_from(user_from: UserFrom) -> None:
    context = _build_workflow_generate_entity_for_roundtrip()
    entity = context.get_generate_entity()
    assert isinstance(entity, WorkflowAppGenerateEntity)
    entity.invoke_from = InvokeFrom.SERVICE_API
    entity.user_from = user_from

    restored = WorkflowResumptionContext.loads(context.dumps()).get_generate_entity()

    assert isinstance(restored, WorkflowAppGenerateEntity)
    assert restored.user_from == user_from
    assert restored.invoke_from == InvokeFrom.SERVICE_API


@pytest.mark.parametrize("invoke_from", list(InvokeFrom))
def test_legacy_workflow_snapshot_uses_previous_runner_role(invoke_from: InvokeFrom) -> None:
    payload = _build_workflow_generate_entity_for_roundtrip().model_dump(mode="json")
    entity = payload["generate_entity"]["entity"]
    entity.pop("user_from")
    entity["invoke_from"] = invoke_from.value

    restored = WorkflowResumptionContext.loads(json.dumps(payload)).get_generate_entity()

    expected = UserFrom.ACCOUNT if invoke_from in (InvokeFrom.DEBUGGER, InvokeFrom.EXPLORE) else UserFrom.END_USER
    assert restored.user_from == expected
    # Normalization must not rewrite the source payload.
    assert "user_from" not in entity


@pytest.mark.parametrize("field", ["single_iteration_run", "single_loop_run"])
def test_legacy_single_node_snapshot_preserves_debugger_role(field: str) -> None:
    payload = _build_workflow_generate_entity_for_roundtrip().model_dump(mode="json")
    entity = payload["generate_entity"]["entity"]
    entity.pop("user_from")
    entity["invoke_from"] = InvokeFrom.SERVICE_API.value
    entity[field] = {"node_id": "node", "inputs": {}}

    restored = WorkflowResumptionContext.loads(json.dumps(payload)).get_generate_entity()

    assert restored.user_from == UserFrom.ACCOUNT


@pytest.mark.parametrize("role", [None, "invalid-role"])
def test_snapshot_does_not_replace_invalid_explicit_identity(role: str | None) -> None:
    payload = _build_workflow_generate_entity_for_roundtrip().model_dump(mode="json")
    payload["generate_entity"]["entity"]["user_from"] = role

    with pytest.raises(ValidationError):
        WorkflowResumptionContext.loads(json.dumps(payload))


def test_new_execution_requires_explicit_identity() -> None:
    payload = _build_workflow_generate_entity_for_roundtrip().get_generate_entity().model_dump(mode="json")
    payload.pop("user_from")

    with pytest.raises(ValidationError, match="user_from"):
        WorkflowAppGenerateEntity.model_validate(payload)
