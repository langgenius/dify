import json
from collections.abc import Callable
from dataclasses import dataclass

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    InvokeFrom,
    WorkflowAppGenerateEntity,
)
from core.app.layers.pause_state_persist_layer import (
    WorkflowResumptionContext,
    _AdvancedChatAppGenerateEntityWrapper,
    _WorkflowGenerateEntityWrapper,
)
from core.ops.ops_trace_manager import TraceQueueManager
from models.model import AppMode


class TraceQueueManagerStub(TraceQueueManager):
    """Minimal TraceQueueManager stub that avoids Flask dependencies."""

    def __init__(self):
        # Skip parent initialization to avoid starting timers or accessing Flask globals.
        pass


def _build_workflow_app_config(app_mode: AppMode) -> WorkflowUIBasedAppConfig:
    return WorkflowUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=app_mode,
        workflow_id=f"{app_mode.value}-workflow-id",
    )


def _create_workflow_generate_entity(trace_manager: TraceQueueManager | None = None) -> WorkflowAppGenerateEntity:
    return WorkflowAppGenerateEntity(
        task_id="workflow-task",
        app_config=_build_workflow_app_config(AppMode.WORKFLOW),
        inputs={"topic": "serialization"},
        files=[],
        user_id="user-workflow",
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=1,
        trace_manager=trace_manager,
        workflow_execution_id="workflow-exec-id",
        extras={"external_trace_id": "trace-id"},
    )


def _create_advanced_chat_generate_entity(
    trace_manager: TraceQueueManager | None = None,
) -> AdvancedChatAppGenerateEntity:
    return AdvancedChatAppGenerateEntity(
        task_id="advanced-task",
        app_config=_build_workflow_app_config(AppMode.ADVANCED_CHAT),
        conversation_id="conversation-id",
        inputs={"topic": "roundtrip"},
        files=[],
        user_id="user-advanced",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
        query="Explain serialization",
        extras={"auto_generate_conversation_name": True},
        trace_manager=trace_manager,
        workflow_run_id="workflow-run-id",
    )


def test_workflow_app_generate_entity_roundtrip_excludes_trace_manager():
    entity = _create_workflow_generate_entity(trace_manager=TraceQueueManagerStub())

    serialized = entity.model_dump_json()
    payload = json.loads(serialized)

    assert "trace_manager" not in payload

    restored = WorkflowAppGenerateEntity.model_validate_json(serialized)

    assert restored.model_dump() == entity.model_dump()
    assert restored.trace_manager is None


def test_advanced_chat_generate_entity_roundtrip_excludes_trace_manager():
    entity = _create_advanced_chat_generate_entity(trace_manager=TraceQueueManagerStub())

    serialized = entity.model_dump_json()
    payload = json.loads(serialized)

    assert "trace_manager" not in payload

    restored = AdvancedChatAppGenerateEntity.model_validate_json(serialized)

    assert restored.model_dump() == entity.model_dump()
    assert restored.trace_manager is None


@dataclass(frozen=True)
class ResumptionContextCase:
    name: str
    context_factory: Callable[[], tuple[WorkflowResumptionContext, type]]


def _workflow_resumption_case() -> tuple[WorkflowResumptionContext, type]:
    entity = _create_workflow_generate_entity(trace_manager=TraceQueueManagerStub())
    context = WorkflowResumptionContext(
        serialized_graph_runtime_state=json.dumps({"state": "workflow"}),
        generate_entity=_WorkflowGenerateEntityWrapper(entity=entity),
    )
    return context, WorkflowAppGenerateEntity


def _advanced_chat_resumption_case() -> tuple[WorkflowResumptionContext, type]:
    entity = _create_advanced_chat_generate_entity(trace_manager=TraceQueueManagerStub())
    context = WorkflowResumptionContext(
        serialized_graph_runtime_state=json.dumps({"state": "advanced"}),
        generate_entity=_AdvancedChatAppGenerateEntityWrapper(entity=entity),
    )
    return context, AdvancedChatAppGenerateEntity


@pytest.mark.parametrize(
    "case",
    [
        pytest.param(ResumptionContextCase("workflow", _workflow_resumption_case), id="workflow"),
        pytest.param(ResumptionContextCase("advanced_chat", _advanced_chat_resumption_case), id="advanced_chat"),
    ],
)
def test_workflow_resumption_context_roundtrip(case: ResumptionContextCase):
    context, expected_type = case.context_factory()

    serialized = context.dumps()
    restored = WorkflowResumptionContext.loads(serialized)

    assert restored.serialized_graph_runtime_state == context.serialized_graph_runtime_state
    entity = restored.get_generate_entity()
    assert isinstance(entity, expected_type)
    assert entity.model_dump() == context.get_generate_entity().model_dump()
    assert entity.trace_manager is None
