from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest

from core.app.entities.app_invoke_entities import (
    AdvancedChatAppGenerateEntity,
    RagPipelineGenerateEntity,
    WorkflowAppGenerateEntity,
)
from core.app.layers.workflow_handoff_persist_layer import ResumableWorkflowGenerateEntity
from graphon.filters import ResponseStreamFilter
from models.workflow_handoff import WorkflowHandoffResumeRoute
from services import workflow_handoff_runtime_service as runtime_service


@pytest.mark.parametrize(
    ("enabled", "call_depth"),
    [(False, 0), (True, 1)],
    ids=("feature-disabled", "nested-workflow"),
)
def test_build_persistence_layer_skips_unsupported_segments(
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    call_depth: int,
) -> None:
    repository_factory = MagicMock()
    monkeypatch.setattr(runtime_service.dify_config, "WORKFLOW_HANDOFF_ENABLED", enabled)
    monkeypatch.setattr(runtime_service, "SQLAlchemyWorkflowRunHandoffRepository", repository_factory)
    generate_entity = cast(ResumableWorkflowGenerateEntity, SimpleNamespace(call_depth=call_depth))

    result = runtime_service.build_workflow_handoff_persistence_layer(
        generate_entity=generate_entity,
        response_stream_filter=MagicMock(spec=ResponseStreamFilter),
    )

    assert result is None
    repository_factory.assert_not_called()


def test_build_persistence_layer_wires_repository_storage_and_source_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(runtime_service.dify_config, "WORKFLOW_HANDOFF_ENABLED", True)
    engine = MagicMock()
    monkeypatch.setattr(runtime_service, "db", SimpleNamespace(engine=engine))
    monkeypatch.setattr(runtime_service.socket, "gethostname", lambda: "worker-host")
    monkeypatch.setattr(runtime_service.os, "getpid", lambda: 4321)
    session_factory = MagicMock()
    sessionmaker_factory = MagicMock(return_value=session_factory)
    monkeypatch.setattr(runtime_service, "sessionmaker", sessionmaker_factory)
    repository = MagicMock()
    repository_factory = MagicMock(return_value=repository)
    monkeypatch.setattr(runtime_service, "SQLAlchemyWorkflowRunHandoffRepository", repository_factory)
    handoff_service = MagicMock()
    handoff_service_factory = MagicMock(return_value=handoff_service)
    monkeypatch.setattr(runtime_service, "WorkflowHandoffService", handoff_service_factory)
    persistence_layer = MagicMock()
    create_layer = MagicMock(return_value=persistence_layer)
    monkeypatch.setattr(runtime_service, "create_workflow_handoff_persistence_layer", create_layer)
    generate_entity = cast(ResumableWorkflowGenerateEntity, SimpleNamespace(call_depth=0))
    response_stream_filter = MagicMock(spec=ResponseStreamFilter)

    result = runtime_service.build_workflow_handoff_persistence_layer(
        generate_entity=generate_entity,
        response_stream_filter=response_stream_filter,
        resume_route=WorkflowHandoffResumeRoute.ADVANCED_CHAT,
    )

    assert result is persistence_layer
    sessionmaker_factory.assert_called_once_with(bind=engine, expire_on_commit=False)
    repository_factory.assert_called_once_with(session_factory)
    handoff_service_factory.assert_called_once_with(repository=repository, storage=runtime_service.storage)
    create_layer.assert_called_once()
    call = create_layer.call_args
    assert call.kwargs["generate_entity"] is generate_entity
    assert call.kwargs["response_stream_filter"] is response_stream_filter
    assert call.kwargs["config"].handoff_service is handoff_service
    assert call.kwargs["config"].source_worker_id == "worker-host:4321"
    assert call.kwargs["config"].resume_route == WorkflowHandoffResumeRoute.ADVANCED_CHAT


@pytest.mark.parametrize(
    ("generate_entity", "triggered", "expected"),
    [
        (
            RagPipelineGenerateEntity.model_construct(),
            False,
            WorkflowHandoffResumeRoute.RAG_PIPELINE,
        ),
        (
            AdvancedChatAppGenerateEntity.model_construct(),
            False,
            WorkflowHandoffResumeRoute.ADVANCED_CHAT,
        ),
        (
            WorkflowAppGenerateEntity.model_construct(),
            True,
            WorkflowHandoffResumeRoute.TRIGGERED_WORKFLOW,
        ),
        (
            WorkflowAppGenerateEntity.model_construct(),
            False,
            WorkflowHandoffResumeRoute.WORKFLOW,
        ),
    ],
    ids=("rag", "advanced-chat", "triggered-workflow", "workflow"),
)
def test_infer_initial_handoff_resume_route(
    generate_entity: WorkflowAppGenerateEntity | AdvancedChatAppGenerateEntity | RagPipelineGenerateEntity,
    triggered: bool,
    expected: WorkflowHandoffResumeRoute,
) -> None:
    assert runtime_service.infer_initial_handoff_resume_route(generate_entity, triggered=triggered) == expected
