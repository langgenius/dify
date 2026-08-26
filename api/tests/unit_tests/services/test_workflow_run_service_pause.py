"""Tests for Console workflow pause details."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.enums import WorkflowExecutionStatus
from machinery.context import RequestContext
from services import workflow_run_service as service_module
from services.workflow_run_service import WorkflowRunPauseDetails, WorkflowRunPausedNode, WorkflowRunService


@pytest.fixture
def repository_factory_mocks(monkeypatch: pytest.MonkeyPatch) -> tuple[MagicMock, MagicMock]:
    node_repo = MagicMock()
    workflow_run_repo = MagicMock()
    factory = SimpleNamespace(
        create_api_workflow_node_execution_repository=MagicMock(return_value=node_repo),
        create_api_workflow_run_repository=MagicMock(return_value=workflow_run_repo),
    )
    monkeypatch.setattr(service_module, "DifyAPIRepositoryFactory", factory)
    return node_repo, workflow_run_repo


def _request_context(*, workspace_id: str = "tenant-1") -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id="trace-1",
        account_id="account-1",
        active_workspace_id=workspace_id,
    )


def test_get_pause_details_returns_none_when_run_is_not_found(
    repository_factory_mocks: tuple[MagicMock, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _, workflow_run_repo = repository_factory_mocks
    workflow_run_repo.get_workflow_run_by_id_and_tenant_id.return_value = None
    service = WorkflowRunService(session_factory=sqlite_session_factory)

    result = service.get_pause_details(_request_context(), workflow_run_id="run-1")

    assert result is None
    workflow_run_repo.get_workflow_run_by_id_and_tenant_id.assert_called_once_with(
        tenant_id="tenant-1",
        run_id="run-1",
    )
    workflow_run_repo.get_workflow_pause.assert_not_called()


def test_get_pause_details_returns_empty_details_for_non_paused_run(
    repository_factory_mocks: tuple[MagicMock, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _, workflow_run_repo = repository_factory_mocks
    workflow_run_repo.get_workflow_run_by_id_and_tenant_id.return_value = SimpleNamespace(
        status=WorkflowExecutionStatus.SUCCEEDED
    )
    service = WorkflowRunService(session_factory=sqlite_session_factory)

    result = service.get_pause_details(_request_context(), workflow_run_id="run-1")

    assert result == WorkflowRunPauseDetails(paused_at=None, paused_nodes=())
    workflow_run_repo.get_workflow_pause.assert_not_called()


def test_get_pause_details_maps_human_input_and_loads_token_with_explicit_session(
    monkeypatch: pytest.MonkeyPatch,
    repository_factory_mocks: tuple[MagicMock, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _, workflow_run_repo = repository_factory_mocks
    workflow_run_repo.get_workflow_run_by_id_and_tenant_id.return_value = SimpleNamespace(
        status=WorkflowExecutionStatus.PAUSED
    )
    reason = HumanInputRequired(
        form_id="form-1",
        form_content="Approve?",
        node_id="node-1",
        node_title="Approval",
    )
    paused_at = datetime(2026, 1, 2, 3, 4, 5)
    pause_entity = MagicMock()
    pause_entity.paused_at = paused_at
    pause_entity.get_pause_reasons.return_value = [reason]
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    token_loader_sessions: list[Session] = []

    def load_form_tokens(form_ids: list[str], *, session: Session) -> dict[str, str]:
        assert form_ids == ["form-1"]
        token_loader_sessions.append(session)
        return {"form-1": "form-token"}

    monkeypatch.setattr(service_module, "_load_form_tokens_by_form_id", load_form_tokens)
    service = WorkflowRunService(session_factory=sqlite_session_factory)

    result = service.get_pause_details(
        _request_context(workspace_id="tenant-context"),
        workflow_run_id="run-1",
    )

    assert result == WorkflowRunPauseDetails(
        paused_at=paused_at,
        paused_nodes=(
            WorkflowRunPausedNode(
                node_id="node-1",
                node_title="Approval",
                form_id="form-1",
                form_token="form-token",
            ),
        ),
    )
    workflow_run_repo.get_workflow_run_by_id_and_tenant_id.assert_called_once_with(
        tenant_id="tenant-context",
        run_id="run-1",
    )
    assert len(token_loader_sessions) == 1
    assert token_loader_sessions[0].get_bind() is sqlite_session_factory.kw["bind"]


def test_get_pause_details_rejects_unknown_pause_reason(
    repository_factory_mocks: tuple[MagicMock, MagicMock],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _, workflow_run_repo = repository_factory_mocks
    workflow_run_repo.get_workflow_run_by_id_and_tenant_id.return_value = SimpleNamespace(
        status=WorkflowExecutionStatus.PAUSED
    )
    pause_entity = MagicMock()
    pause_entity.get_pause_reasons.return_value = [object()]
    workflow_run_repo.get_workflow_pause.return_value = pause_entity
    service = WorkflowRunService(session_factory=sqlite_session_factory)

    with pytest.raises(AssertionError, match="unimplemented"):
        service.get_pause_details(_request_context(), workflow_run_id="run-1")
