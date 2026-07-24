"""Console workflow pause-detail tests backed by persisted workflow execution state."""

from __future__ import annotations

import inspect
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from controllers.common.errors import NotFoundError
from controllers.console.app import workflow_run as workflow_run_module
from core.workflow.nodes.human_input.entities import ParagraphInputConfig, UserActionConfig
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.enums import WorkflowExecutionStatus
from models.base import TypeBase
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from models.workflow import WorkflowPause, WorkflowRun, WorkflowType


@dataclass(frozen=True)
class _Database:
    engine: Engine
    session: Session


@pytest.fixture
def pause_session(sqlite_engine: Engine) -> Iterator[Session]:
    """Yield isolated workflow-run and pause tables for controller lookups."""

    tables = [TypeBase.metadata.tables[model.__tablename__] for model in (WorkflowRun, WorkflowPause)]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


def _persist_run(
    session: Session,
    *,
    run_id: str,
    tenant_id: str,
    status: WorkflowExecutionStatus,
    paused: bool = False,
) -> WorkflowRun:
    workflow_id = str(uuid4())
    workflow_run = WorkflowRun(
        id=run_id,
        tenant_id=tenant_id,
        app_id=str(uuid4()),
        workflow_id=workflow_id,
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="draft",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=datetime(2024, 1, 1, 12, 0, 0),
    )
    session.add(workflow_run)
    if paused:
        session.add(
            WorkflowPause(
                workflow_id=workflow_id,
                workflow_run_id=run_id,
                state_object_key="workflow-pauses/state.json",
            )
        )
    session.commit()
    return workflow_run


class _PauseEntity:
    def __init__(self, paused_at: datetime, reasons: list[HumanInputRequired]):
        self.paused_at = paused_at
        self._reasons = reasons

    def get_pause_reasons(self):
        return self._reasons


def test_pause_details_returns_backstage_input_url(
    app: Flask, monkeypatch: pytest.MonkeyPatch, pause_session: Session
) -> None:
    monkeypatch.setattr(workflow_run_module.dify_config, "APP_WEB_URL", "https://web.example.com")

    tenant_id = str(uuid4())
    run_id = str(uuid4())
    _persist_run(
        pause_session,
        run_id=run_id,
        tenant_id=tenant_id,
        status=WorkflowExecutionStatus.PAUSED,
        paused=True,
    )
    monkeypatch.setattr(
        workflow_run_module,
        "db",
        _Database(engine=pause_session.get_bind(), session=pause_session),
    )

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="content",
        inputs=[ParagraphInputConfig(output_variable_name="name")],
        actions=[UserActionConfig(id="approve", title="Approve")],
        node_id="node-1",
        node_title="Ask Name",
    )
    pause_entity = _PauseEntity(paused_at=datetime(2024, 1, 1, 12, 0, 0), reasons=[reason])

    repo = Mock()
    repo.get_workflow_pause.return_value = pause_entity
    monkeypatch.setattr(
        workflow_run_module.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_, **__: repo,
    )
    monkeypatch.setattr(
        workflow_run_module,
        "_load_form_tokens_by_form_id",
        lambda _form_ids: {"form-1": "backstage-token"},
    )

    with app.test_request_context(f"/console/api/workflow/{run_id}/pause-details", method="GET"):
        handler = inspect.unwrap(workflow_run_module.ConsoleWorkflowPauseDetailsApi.get)
        response, status = handler(
            workflow_run_module.ConsoleWorkflowPauseDetailsApi(),
            tenant_id,
            workflow_run_id=run_id,
        )

    assert status == 200
    assert response["paused_at"] == "2024-01-01T12:00:00Z"
    assert response["paused_nodes"][0]["node_id"] == "node-1"
    assert response["paused_nodes"][0]["pause_type"]["type"] == "human_input"
    assert (
        response["paused_nodes"][0]["pause_type"]["backstage_input_url"]
        == "https://web.example.com/form/backstage-token"
    )
    assert "pending_human_inputs" not in response


def test_pause_details_tenant_isolation(app: Flask, monkeypatch: pytest.MonkeyPatch, pause_session: Session) -> None:
    monkeypatch.setattr(workflow_run_module.dify_config, "APP_WEB_URL", "https://web.example.com")

    run_id = str(uuid4())
    _persist_run(
        pause_session,
        run_id=run_id,
        tenant_id=str(uuid4()),
        status=WorkflowExecutionStatus.PAUSED,
        paused=True,
    )
    monkeypatch.setattr(
        workflow_run_module,
        "db",
        _Database(engine=pause_session.get_bind(), session=pause_session),
    )

    handler = inspect.unwrap(workflow_run_module.ConsoleWorkflowPauseDetailsApi.get)
    with app.test_request_context(f"/console/api/workflow/{run_id}/pause-details", method="GET"):
        with pytest.raises(NotFoundError):
            handler(
                workflow_run_module.ConsoleWorkflowPauseDetailsApi(),
                str(uuid4()),
                workflow_run_id=run_id,
            )


def test_pause_details_returns_empty_response_for_non_paused_run(
    app: Flask, monkeypatch: pytest.MonkeyPatch, pause_session: Session
) -> None:
    tenant_id = str(uuid4())
    run_id = str(uuid4())
    _persist_run(
        pause_session,
        run_id=run_id,
        tenant_id=tenant_id,
        status=WorkflowExecutionStatus.RUNNING,
    )
    monkeypatch.setattr(
        workflow_run_module,
        "db",
        _Database(engine=pause_session.get_bind(), session=pause_session),
    )

    with app.test_request_context(f"/console/api/workflow/{run_id}/pause-details", method="GET"):
        handler = inspect.unwrap(workflow_run_module.ConsoleWorkflowPauseDetailsApi.get)
        response, status = handler(
            workflow_run_module.ConsoleWorkflowPauseDetailsApi(),
            tenant_id,
            workflow_run_id=run_id,
        )

    assert status == 200
    assert response == {"paused_at": None, "paused_nodes": []}


def test_pause_details_response_schema_is_registered() -> None:
    assert workflow_run_module.WorkflowPauseDetailsResponse.__name__ in workflow_run_module.console_ns.models
