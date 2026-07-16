"""SQLite-backed tests for Service API application controllers.

The authentication decorator resolves the app, tenant, and tenant owner before
the controller runs.  Controller/model code then reads configuration, workflow,
tags, and author information through two additional references to the database
extension.  Tests bind all of those references to one explicit scoped SQLite
session and persist visibility and cross-tenant decoys instead of fabricating ORM
lookup results.
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from unittest.mock import Mock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import Forbidden, Unauthorized

from controllers.service_api.app import app as app_controller
from controllers.service_api.app.app import AppInfoApi, AppMetaApi, AppParameterApi
from controllers.service_api.app.error import AgentNotPublishedError, AppUnavailableError
from core.app.apps.agent_app.errors import AgentAppNotPublishedError
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.base import TypeBase
from models.enums import EndUserType
from models.model import (
    App,
    AppAnnotationSetting,
    AppMode,
    AppModelConfig,
    CustomizeTokenStrategy,
    EndUser,
    Site,
    Tag,
    TagBinding,
    TagType,
)
from models.workflow import Workflow, WorkflowType


@dataclass(frozen=True)
class _DatabaseBinding:
    engine: Engine
    session: scoped_session[Session]


@dataclass(frozen=True)
class _Token:
    app_id: str
    tenant_id: str


@dataclass(frozen=True)
class AppDatabase:
    """Persisted application graph used by the decorated controller methods."""

    session_maker: sessionmaker[Session]
    registry: scoped_session[Session]
    tenant_id: str
    app_id: str
    owner_id: str
    config_id: str
    workflow_id: str

    def update_app(self, **values: object) -> None:
        with self.session_maker.begin() as session:
            app = session.get_one(App, self.app_id)
            for key, value in values.items():
                setattr(app, key, value)

    def update_tenant(self, **values: object) -> None:
        with self.session_maker.begin() as session:
            tenant = session.get_one(Tenant, self.tenant_id)
            for key, value in values.items():
                setattr(tenant, key, value)

    def delete_row(self, model: type[object], object_id: str) -> None:
        table = model.__table__  # type: ignore[attr-defined]
        with self.session_maker.begin() as session:
            session.execute(table.delete().where(table.c.id == object_id))


@pytest.fixture
def flask_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    return app


@pytest.fixture
def app_db(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[AppDatabase]:
    """Create the minimal controller/model schema and bind every DB reference explicitly."""

    tables = [
        Tenant.__table__,
        Account.__table__,
        TenantAccountJoin.__table__,
        App.__table__,
        AppModelConfig.__table__,
        AppAnnotationSetting.__table__,
        Workflow.__table__,
        Tag.__table__,
        TagBinding.__table__,
        Site.__table__,
        EndUser.__table__,
    ]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    registry = scoped_session(maker)
    binding = _DatabaseBinding(engine=sqlite_engine, session=registry)
    monkeypatch.setattr("controllers.service_api.wraps.db", binding)
    monkeypatch.setattr(app_controller, "db", binding)
    monkeypatch.setattr("models.model.db", binding)
    monkeypatch.setattr("models.account.db", binding)

    tenant_id = str(uuid4())
    app_id = str(uuid4())
    owner_id = str(uuid4())
    config_id = str(uuid4())
    workflow_id = str(uuid4())
    other_tenant_id = str(uuid4())
    with maker.begin() as session:
        tenant = Tenant(name="Visible tenant")
        tenant.id = tenant_id
        other_tenant = Tenant(name="Other tenant")
        other_tenant.id = other_tenant_id
        owner = Account(name="Test Author", email="owner@example.com")
        owner.id = owner_id
        app = App(
            id=app_id,
            tenant_id=tenant_id,
            name="Test App",
            description="A test application",
            mode=AppMode.CHAT,
            icon_type=None,
            icon=None,
            icon_background=None,
            app_model_config_id=config_id,
            workflow_id=workflow_id,
            enable_site=True,
            enable_api=True,
            max_active_requests=None,
            created_by=owner_id,
        )
        config = AppModelConfig(
            app_id=app_id,
            opening_statement="Hello",
            suggested_questions=json.dumps(["Question?"]),
            user_input_form=json.dumps([{"text-input": {"label": "Name", "variable": "name", "required": True}}]),
        )
        config.id = config_id
        workflow = Workflow.new(
            tenant_id=tenant_id,
            app_id=app_id,
            type=WorkflowType.WORKFLOW.value,
            version="1",
            graph=json.dumps({"nodes": [{"id": "start", "data": {"type": "start", "variables": []}}]}),
            features=json.dumps({"suggested_questions": []}),
            created_by=owner_id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        workflow.id = workflow_id
        target_tag = Tag(tenant_id=tenant_id, type=TagType.APP, name="test-tag", created_by=owner_id)
        other_tag = Tag(tenant_id=other_tenant_id, type=TagType.APP, name="foreign-tag", created_by=owner_id)
        session.add_all([tenant, other_tenant, owner, app, config, workflow, target_tag, other_tag])
        session.flush()
        session.add_all(
            [
                TenantAccountJoin(
                    tenant_id=tenant_id,
                    account_id=owner_id,
                    current=True,
                    role=TenantAccountRole.OWNER,
                ),
                TagBinding(
                    tenant_id=tenant_id,
                    tag_id=target_tag.id,
                    target_id=app_id,
                    created_by=owner_id,
                ),
                # Same target ID but another tenant: App.tags must exclude it.
                TagBinding(
                    tenant_id=other_tenant_id,
                    tag_id=other_tag.id,
                    target_id=app_id,
                    created_by=owner_id,
                ),
                Site(
                    app_id=app_id,
                    title="Published site",
                    icon_type=None,
                    icon=None,
                    icon_background=None,
                    description="Site decoy",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.MUST,
                    code="visible-site",
                ),
                EndUser(
                    tenant_id=other_tenant_id,
                    app_id=app_id,
                    type=EndUserType.BROWSER,
                    name="Cross-tenant visitor",
                    is_anonymous=False,
                    session_id="visitor-session",
                ),
            ]
        )

    database = AppDatabase(
        session_maker=maker,
        registry=registry,
        tenant_id=tenant_id,
        app_id=app_id,
        owner_id=owner_id,
        config_id=config_id,
        workflow_id=workflow_id,
    )
    try:
        yield database
    finally:
        registry.remove()


@pytest.fixture
def authenticated_controller(app_db: AppDatabase, monkeypatch: pytest.MonkeyPatch) -> Iterator[AppDatabase]:
    """Patch only token validation and Flask login signaling around real ORM auth."""

    monkeypatch.setattr(
        "controllers.service_api.wraps.validate_and_get_api_token",
        Mock(return_value=_Token(app_id=app_db.app_id, tenant_id=app_db.tenant_id)),
    )
    current_app = Mock()
    current_app.login_manager = Mock()
    current_app._get_current_object.return_value = Mock()
    monkeypatch.setattr("controllers.service_api.wraps.current_app", current_app)
    monkeypatch.setattr("controllers.service_api.wraps.user_logged_in", Mock())
    return app_db


def test_get_parameters_for_persisted_chat_config(flask_app: Flask, authenticated_controller: AppDatabase) -> None:
    with flask_app.test_request_context("/parameters", headers={"Authorization": "Bearer token"}):
        response = AppParameterApi().get()

    assert response["opening_statement"] == "Hello"
    assert response["suggested_questions"] == ["Question?"]
    assert response["user_input_form"] == [{"text-input": {"label": "Name", "variable": "name", "required": True}}]


def test_get_parameters_for_persisted_workflow(flask_app: Flask, authenticated_controller: AppDatabase) -> None:
    authenticated_controller.update_app(mode=AppMode.WORKFLOW, app_model_config_id=None)

    with flask_app.test_request_context("/parameters", headers={"Authorization": "Bearer token"}):
        response = AppParameterApi().get()

    assert response["user_input_form"] == []
    assert response["suggested_questions"] == []


def test_get_parameters_for_agent_uses_persisted_app(
    flask_app: Flask, authenticated_controller: AppDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    authenticated_controller.update_app(mode=AppMode.AGENT, app_model_config_id=None, workflow_id=None)
    agent_parameters = Mock(
        return_value=(
            {"opening_statement": "Hi from Agent"},
            [{"text-input": {"label": "Topic", "variable": "topic", "required": True}}],
        )
    )
    monkeypatch.setattr(app_controller, "_get_agent_app_feature_dict_and_user_input_form", agent_parameters)

    with flask_app.test_request_context("/parameters", headers={"Authorization": "Bearer token"}):
        response = AppParameterApi().get()

    assert response["opening_statement"] == "Hi from Agent"
    assert response["user_input_form"][0]["text-input"]["variable"] == "topic"
    assert agent_parameters.call_args.args[0].id == authenticated_controller.app_id


def test_unpublished_agent_raises_friendly_error(
    flask_app: Flask, authenticated_controller: AppDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    authenticated_controller.update_app(mode=AppMode.AGENT)
    monkeypatch.setattr(
        app_controller,
        "get_published_agent_app_feature_dict_and_user_input_form",
        Mock(side_effect=AgentAppNotPublishedError("not published")),
    )

    with flask_app.test_request_context("/parameters", headers={"Authorization": "Bearer token"}):
        with pytest.raises(AgentNotPublishedError):
            AppParameterApi().get()


@pytest.mark.parametrize(
    ("mode", "field"),
    [(AppMode.CHAT, "app_model_config_id"), (AppMode.WORKFLOW, "workflow_id")],
)
def test_parameters_reject_missing_persisted_configuration(
    flask_app: Flask,
    authenticated_controller: AppDatabase,
    mode: AppMode,
    field: str,
) -> None:
    authenticated_controller.update_app(mode=mode, **{field: None})

    with flask_app.test_request_context("/parameters", headers={"Authorization": "Bearer token"}):
        with pytest.raises(AppUnavailableError):
            AppParameterApi().get()


def test_get_meta_passes_real_session_and_app(
    flask_app: Flask, authenticated_controller: AppDatabase, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = Mock()
    service.get_app_meta.return_value = {"tool_icons": {}}
    monkeypatch.setattr(app_controller, "AppService", Mock(return_value=service))

    with flask_app.test_request_context("/meta", headers={"Authorization": "Bearer token"}):
        response = AppMetaApi().get()

    (app_model,) = service.get_app_meta.call_args.args
    assert app_model.id == authenticated_controller.app_id
    assert isinstance(service.get_app_meta.call_args.kwargs["session"], Session)
    assert response == {"tool_icons": {}}


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_get_info_reads_author_and_tenant_scoped_tags(
    flask_app: Flask,
    authenticated_controller: AppDatabase,
    mode: AppMode,
) -> None:
    authenticated_controller.update_app(mode=mode)

    with flask_app.test_request_context("/info", headers={"Authorization": "Bearer token"}):
        response = AppInfoApi().get()

    assert response == {
        "name": "Test App",
        "description": "A test application",
        "tags": ["test-tag"],
        "mode": mode,
        "author_name": "Test Author",
    }


@pytest.mark.parametrize("state", ["missing", "disabled", "archived", "ownerless"])
def test_authentication_rejects_empty_or_invisible_database_state(
    flask_app: Flask,
    authenticated_controller: AppDatabase,
    state: str,
) -> None:
    expected_error: type[Exception] = Forbidden
    if state == "missing":
        authenticated_controller.delete_row(App, authenticated_controller.app_id)
    elif state == "disabled":
        authenticated_controller.update_app(enable_api=False)
    elif state == "archived":
        authenticated_controller.update_tenant(status=TenantStatus.ARCHIVE)
    else:
        with authenticated_controller.session_maker.begin() as session:
            session.execute(TenantAccountJoin.__table__.delete())
        expected_error = Unauthorized

    with flask_app.test_request_context("/info", headers={"Authorization": "Bearer token"}):
        with pytest.raises(expected_error):
            AppInfoApi().get()
