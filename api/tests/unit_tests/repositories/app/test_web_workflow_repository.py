"""Scope and session boundaries for WebApp workflow dispatch reads."""

from dataclasses import replace

import pytest
from sqlalchemy import inspect
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import WebAppRequestContext
from models.model import App, AppMode, EndUser
from models.workflow import Workflow
from repositories.app.web_workflow_repository import WebWorkflowRepository
from tests.unit_tests.model_factories import make_app, make_end_user, make_workflow

CONTEXT = WebAppRequestContext(
    request_id="request-1", trace_id=None, tenant_id="tenant-1", app_id="app-1", end_user_id="user-1"
)


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> WebWorkflowRepository:
    app = make_app(app_id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
    app.enable_site = True
    app.workflow_id = "workflow-1"
    user = make_end_user(end_user_id="user-1", tenant_id="tenant-1", app_id="app-1")
    workflow = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1", version="1")
    with sqlite_session_factory.begin() as session:
        session.add_all([app, user, workflow])
    return WebWorkflowRepository(session_factory=sqlite_session_factory)


def test_dispatch_models_are_detached_before_leaving_repository(repository: WebWorkflowRepository) -> None:
    target = repository.get_app_and_user(CONTEXT)
    assert target is not None
    app, user = target.app, target.user
    assert (target.mode, target.workflow_id) == ("workflow", "workflow-1")
    workflow = repository.get_workflow(tenant_id=CONTEXT.tenant_id, app_id=app.id, workflow_id=app.workflow_id)
    assert workflow is not None
    assert (app.id, user.id, workflow.id) == ("app-1", "user-1", "workflow-1")
    assert all(inspect(model).detached for model in (app, user, workflow))
    assert workflow.graph_dict == {"nodes": [], "edges": []}


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "end_user_id"])
def test_identity_scope_is_required(repository: WebWorkflowRepository, field: str) -> None:
    assert repository.get_app_and_user(replace(CONTEXT, **{field: "other"})) is None


@pytest.mark.parametrize("field", ["tenant_id", "app_id"])
def test_persisted_actor_must_belong_to_app(
    repository: WebWorkflowRepository, sqlite_session_factory: sessionmaker[Session], field: str
) -> None:
    with sqlite_session_factory.begin() as session:
        user = session.get(EndUser, CONTEXT.end_user_id)
        assert user is not None
        setattr(user, field, "other")
    assert repository.get_app_and_user(CONTEXT) is None


def test_disabled_site_cannot_dispatch(
    repository: WebWorkflowRepository, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, CONTEXT.app_id)
        assert app is not None
        app.enable_site = False
    assert repository.get_app_and_user(CONTEXT) is None


@pytest.mark.parametrize("field", ["tenant_id", "app_id"])
def test_selected_workflow_must_belong_to_app(
    repository: WebWorkflowRepository, sqlite_session_factory: sessionmaker[Session], field: str
) -> None:
    with sqlite_session_factory.begin() as session:
        workflow = session.get(Workflow, "workflow-1")
        assert workflow is not None
        setattr(workflow, field, "other")
    assert repository.get_workflow(tenant_id="tenant-1", app_id="app-1", workflow_id="workflow-1") is None


def test_unpublished_app_has_no_workflow(repository: WebWorkflowRepository) -> None:
    assert repository.get_workflow(tenant_id="tenant-1", app_id="app-1", workflow_id=None) is None
