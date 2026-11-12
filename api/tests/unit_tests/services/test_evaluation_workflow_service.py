"""Tests for evaluation-specific workflow service behavior."""

import json
from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.enums import BuiltinNodeTypes
from models.enums import AppStatus
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.errors.app import WorkflowNotFoundError
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account


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
        _features="{}",
        created_by=str(uuid4()),
        _environment_variables="{}",
        _conversation_variables="{}",
        _rag_pipeline_variables="{}",
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


def test_ordinary_publish_preserves_active_evaluation_kind(sqlite_session: Session) -> None:
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
    active_workflow = _workflow(
        workflow_id=active_workflow_id,
        tenant_id=app.tenant_id,
        app_id=app.id,
        kind=WorkflowKind.EVALUATION,
        version="1",
    )
    sqlite_session.add_all([app, active_workflow])
    sqlite_session.flush()

    kind = WorkflowService._resolve_publish_workflow_kind(
        session=sqlite_session,
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


def test_list_evaluation_workflows_filters_owner_name_and_escaped_keyword(sqlite_session: Session) -> None:
    tenant_id = str(uuid4())
    owner_id = str(uuid4())
    workflows: list[Workflow] = []
    apps: list[App] = []
    for app_name, marked_name, creator in (
        ("Per%cent evaluator", "Named evaluator", owner_id),
        ("Percent other", "Other evaluator", str(uuid4())),
        ("Unnamed", "", owner_id),
    ):
        app_id = str(uuid4())
        workflow_id = str(uuid4())
        apps.append(
            App(
                id=app_id,
                tenant_id=tenant_id,
                name=app_name,
                description="",
                mode=AppMode.WORKFLOW,
                workflow_id=workflow_id,
                status=AppStatus.NORMAL,
                enable_site=True,
                enable_api=True,
                max_active_requests=0,
            )
        )
        workflow = _workflow(
            workflow_id=workflow_id,
            tenant_id=tenant_id,
            app_id=app_id,
            kind=WorkflowKind.EVALUATION,
            version="1",
        )
        workflow.marked_name = marked_name
        workflow.created_by = creator
        workflows.append(workflow)
    sqlite_session.add_all([*apps, *workflows])
    sqlite_session.commit()

    service = WorkflowService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))
    first_page, has_more = service.list_published_evaluation_workflows(
        session=sqlite_session, tenant_id=tenant_id, page=1, limit=1
    )
    assert len(first_page) == 1
    assert has_more is True

    filtered, has_more = service.list_published_evaluation_workflows(
        session=sqlite_session,
        tenant_id=tenant_id,
        page=1,
        limit=10,
        user_id=owner_id,
        named_only=True,
        keyword="  per%cent  ",
    )
    assert [workflow.id for workflow in filtered] == [workflows[0].id]
    assert has_more is False


def test_convert_published_workflow_kind_updates_only_active_version(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    active_id = str(uuid4())
    account_id = str(uuid4())
    app = App(
        id=app_id,
        tenant_id=tenant_id,
        name="Evaluator",
        description="",
        mode=AppMode.WORKFLOW,
        workflow_id=active_id,
        status=AppStatus.NORMAL,
        enable_site=True,
        enable_api=True,
        max_active_requests=0,
    )
    active = _workflow(
        workflow_id=active_id,
        tenant_id=tenant_id,
        app_id=app_id,
        kind=WorkflowKind.STANDARD,
        version="2",
        nodes=[{"id": "end", "data": {"type": BuiltinNodeTypes.END, "outputs": [{"variable": "score"}]}}],
    )
    historical = _workflow(
        workflow_id=str(uuid4()), tenant_id=tenant_id, app_id=app_id, kind=WorkflowKind.STANDARD, version="1"
    )
    sqlite_session.add_all([app, active, historical])
    sqlite_session.commit()
    published_updates: list[str] = []
    monkeypatch.setattr(
        "services.workflow_service.app_published_workflow_was_updated.send",
        lambda _app, *, published_workflow: published_updates.append(published_workflow.id),
    )
    service = WorkflowService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))
    account = make_account(account_id=account_id)
    converted = service.convert_published_workflow_kind(
        session=sqlite_session, app_model=app, target_kind=WorkflowKind.EVALUATION, account=account
    )
    sqlite_session.flush()

    assert converted is active
    assert converted.resolved_kind == WorkflowKind.EVALUATION
    assert converted.updated_by == account_id
    assert historical.resolved_kind == WorkflowKind.STANDARD
    assert published_updates == [active_id]
    assert (
        service.convert_published_workflow_kind(
            session=sqlite_session, app_model=app, target_kind=WorkflowKind.EVALUATION, account=account
        )
        is active
    )
    assert published_updates == [active_id]


def test_convert_published_workflow_kind_rejects_missing_active_version(sqlite_session: Session) -> None:
    app = App(id=str(uuid4()), tenant_id=str(uuid4()), workflow_id=str(uuid4()), mode=AppMode.WORKFLOW)
    service = WorkflowService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))

    with pytest.raises(WorkflowNotFoundError, match="Published workflow not found"):
        service.convert_published_workflow_kind(
            session=sqlite_session,
            app_model=app,
            target_kind=WorkflowKind.EVALUATION,
            account=make_account(account_id=str(uuid4())),
        )
