"""Persisted resume-envelope compatibility remains independent of engine layers."""

import json

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom, WorkflowAppGenerateEntity
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
