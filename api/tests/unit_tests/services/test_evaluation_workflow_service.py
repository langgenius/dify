"""Tests for evaluation-specific workflow service behavior."""

import json
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import BuiltinNodeTypes
from models.enums import AppStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.workflow_service import WorkflowService


def _workflow(
    *,
    workflow_id: str,
    tenant_id: str,
    app_id: str,
    kind: WorkflowKind,
    version: str,
    workflow_type: WorkflowType = WorkflowType.WORKFLOW,
    nodes: list[dict[str, object]] | None = None,
) -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        type=workflow_type,
        kind=kind,
        version=version,
        graph=json.dumps({"nodes": nodes or [], "edges": []}),
        features="{}",
        created_by=str(uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


@pytest.mark.parametrize("node_type", [BuiltinNodeTypes.HUMAN_INPUT, "trigger-webhook"])
def test_evaluation_workflow_rejects_nodes_that_can_pause_or_trigger(node_type: str) -> None:
    workflow = _workflow(
        workflow_id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        kind=WorkflowKind.EVALUATION,
        version="1",
        nodes=[{"id": "blocked-node", "data": {"type": node_type, "title": "Blocked"}}],
    )

    with pytest.raises(ValueError, match="cannot contain trigger or human-input nodes"):
        WorkflowService._validate_evaluation_workflow_nodes(workflow)


def test_evaluation_workflow_requires_workflow_app_type() -> None:
    workflow = _workflow(
        workflow_id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        kind=WorkflowKind.EVALUATION,
        version="1",
        workflow_type=WorkflowType.CHAT,
    )

    with pytest.raises(ValueError, match="must use the workflow app type"):
        WorkflowService._validate_evaluation_workflow_nodes(workflow)


def test_evaluation_workflow_requires_declared_end_output() -> None:
    workflow = _workflow(
        workflow_id=str(uuid4()),
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        kind=WorkflowKind.EVALUATION,
        version="1",
        nodes=[{"id": "end", "data": {"type": BuiltinNodeTypes.END, "outputs": []}}],
    )

    with pytest.raises(ValueError, match="at least one End node output"):
        WorkflowService._validate_evaluation_workflow_nodes(workflow)


def test_ordinary_publish_preserves_active_evaluation_kind() -> None:
    active_workflow_id = str(uuid4())
    app = App(
        id=str(uuid4()),
        tenant_id=str(uuid4()),
        name="Evaluator",
        description="",
        mode=AppMode.WORKFLOW,
        workflow_id=active_workflow_id,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    session = MagicMock()
    session.scalar.return_value = WorkflowKind.EVALUATION

    kind = WorkflowService._resolve_publish_workflow_kind(
        session=session,
        app_model=app,
        requested_kind=None,
    )

    assert kind == WorkflowKind.EVALUATION


def test_list_evaluation_workflows_returns_only_each_apps_active_version(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    active_workflow_id = str(uuid4())
    app = App(
        id=app_id,
        tenant_id=tenant_id,
        name="Evaluator",
        description="",
        mode=AppMode.WORKFLOW,
        workflow_id=active_workflow_id,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    active_workflow = _workflow(
        workflow_id=active_workflow_id,
        tenant_id=tenant_id,
        app_id=app_id,
        kind=WorkflowKind.EVALUATION,
        version="2",
    )
    historical_workflow = _workflow(
        workflow_id=str(uuid4()),
        tenant_id=tenant_id,
        app_id=app_id,
        kind=WorkflowKind.EVALUATION,
        version="1",
    )
    chat_app_id = str(uuid4())
    chat_workflow_id = str(uuid4())
    chat_app = App(
        id=chat_app_id,
        tenant_id=tenant_id,
        name="Chat evaluator",
        description="",
        mode=AppMode.ADVANCED_CHAT,
        workflow_id=chat_workflow_id,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    chat_workflow = _workflow(
        workflow_id=chat_workflow_id,
        tenant_id=tenant_id,
        app_id=chat_app_id,
        kind=WorkflowKind.EVALUATION,
        version="1",
        workflow_type=WorkflowType.CHAT,
    )
    sqlite_session.add_all([app, active_workflow, historical_workflow, chat_app, chat_workflow])
    sqlite_session.commit()

    workflow_service = WorkflowService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))
    workflows, has_more = workflow_service.list_published_evaluation_workflows(
        session=sqlite_session,
        tenant_id=tenant_id,
        page=1,
        limit=10,
    )

    assert [workflow.id for workflow in workflows] == [active_workflow_id]
    assert has_more is False
