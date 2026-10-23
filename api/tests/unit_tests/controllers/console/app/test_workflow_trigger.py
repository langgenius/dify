"""Workflow trigger routes use real admission, composition, and SQLite transactions."""

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Blueprint, Flask, Response
from flask.testing import FlaskClient
from flask_restx import Resource
from redis import Redis
from sqlalchemy import Connection, Engine, event, select, text
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import HEADER_NAME_CSRF_TOKEN
from controllers.console.app import workflow_trigger
from controllers.console.wraps import _is_setup_completed
from core.trigger.utils.endpoint import base_url
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_login import DifyLoginManager, bind_account_loader, load_user_from_request, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.agent import Agent, AgentScope, AgentSource
from models.engine import db
from models.enums import AppTriggerStatus, AppTriggerType
from models.model import App, AppMode
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from tests.helpers.unit.config_override import config_overrides_context

_CREATED_AT = datetime(2026, 1, 2, 3, 4, 5)


@dataclass(frozen=True)
class _Endpoint:
    method: str
    path: str
    resource: type[Resource]


_ENDPOINTS = (
    _Endpoint("GET", "workflows/triggers/webhook", workflow_trigger.WebhookTriggerApi),
    _Endpoint("GET", "triggers", workflow_trigger.AppTriggersApi),
    _Endpoint("POST", "trigger-enable", workflow_trigger.AppTriggerEnableApi),
)


@dataclass(frozen=True)
class _Harness:
    client: FlaskClient
    session_factory: sessionmaker[Session]
    account_id: str
    tenant_id: str
    headers: dict[str, str]
    sessions: list[Session]

    def create_app(self, *, tenant_id: str | None = None, mode: AppMode = AppMode.WORKFLOW) -> str:
        with self.session_factory.begin() as session:
            app = App(
                tenant_id=tenant_id or self.tenant_id,
                name="Trigger app",
                mode=mode,
                created_by=self.account_id,
                maintainer=self.account_id,
                enable_api=True,
                enable_site=True,
            )
            session.add(app)
            session.flush()
            return app.id

    def create_trigger(
        self,
        app_id: str,
        *,
        tenant_id: str | None = None,
        trigger_type: AppTriggerType = AppTriggerType.TRIGGER_PLUGIN,
        status: AppTriggerStatus = AppTriggerStatus.ENABLED,
        created_at: datetime = _CREATED_AT,
    ) -> str:
        with self.session_factory.begin() as session:
            trigger = AppTrigger(
                tenant_id=tenant_id or self.tenant_id,
                app_id=app_id,
                node_id="node-1",
                trigger_type=trigger_type,
                title="Trigger",
                provider_name="langgenius/github/github",
                status=status,
            )
            trigger.created_at = created_at
            trigger.updated_at = created_at
            session.add(trigger)
            session.flush()
            return trigger.id

    def create_webhook(self, app_id: str, *, tenant_id: str | None = None, node_id: str = "node-1") -> str:
        with self.session_factory.begin() as session:
            webhook = WorkflowWebhookTrigger(
                app_id=app_id,
                tenant_id=tenant_id or self.tenant_id,
                node_id=node_id,
                webhook_id=str(uuid4())[:24],
                created_by=self.account_id,
            )
            webhook.created_at = _CREATED_AT
            session.add(webhook)
            session.flush()
            return webhook.id

    def set_role(self, role: TenantAccountRole) -> None:
        with self.session_factory.begin() as session:
            membership = session.scalar(
                select(TenantAccountJoin).where(TenantAccountJoin.account_id == self.account_id)
            )
            assert membership is not None
            membership.role = role

    def call(self, endpoint: _Endpoint, app_id: str) -> TestResponse:
        self.sessions.clear()
        if endpoint.method == "POST":
            return self.client.post(
                f"/console/api/apps/{app_id}/{endpoint.path}",
                headers=self.headers,
                json={"trigger_id": str(uuid4()), "enable_trigger": True},
            )
        return self.client.get(
            f"/console/api/apps/{app_id}/{endpoint.path}", headers=self.headers, query_string={"node_id": "node-1"}
        )

    def enable(self, app_id: str, payload: dict[str, object]) -> TestResponse:
        self.sessions.clear()
        return self.client.post(f"/console/api/apps/{app_id}/trigger-enable", headers=self.headers, json=payload)


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    with (
        Redis() as redis_client,
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            RBAC_ENABLED=False,
            LOGIN_DISABLED=False,
            INIT_PASSWORD="",
            SECRET_KEY="trigger-http-test-secret-at-least-32-bytes",
            CONSOLE_API_URL="https://console.example.test",
        ),
    ):
        app = Flask(__name__)
        app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
        db.init_app(app)
        redis = RedisClientWrapper()
        redis.initialize(redis_client)
        services = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=redis,
        )
        app.extensions["application_services"] = services
        bind_account_loader(app, services.accounts.identity.load_user)
        login_manager = DifyLoginManager()
        login_manager.request_loader(load_user_from_request)
        login_manager.unauthorized_handler(unauthorized_handler)
        login_manager.init_app(app)
        blueprint = Blueprint("console", __name__, url_prefix="/console/api")
        api = ExternalApi(blueprint)
        for endpoint in _ENDPOINTS:
            api.add_resource(endpoint.resource, f"/apps/<uuid:app_id>/{endpoint.path}")
        app.register_blueprint(blueprint)

        now = naive_utc_now()
        with sqlite_session_factory.begin() as session:
            account = Account(
                email="triggers@example.com",
                name="Trigger editor",
                status=AccountStatus.ACTIVE,
                initialized_at=now,
            )
            account.last_active_at = now
            tenant = Tenant(name="Trigger workspace")
            session.add_all([account, tenant, DifySetup(version="test")])
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    role=TenantAccountRole.OWNER,
                    current=True,
                )
            )
            account_id, tenant_id = account.id, tenant.id

        # The legacy setup cache has a separate scoped session. Warm and remove
        # it before observing the transaction boundaries of each actual request.
        with app.app_context():
            _is_setup_completed.reset_success()
            assert _is_setup_completed()
            db.session.remove()

        client = app.test_client()
        csrf_token = generate_csrf_token(account_id)
        client.set_cookie(_real_cookie_name("csrf_token"), csrf_token)
        headers = {
            "Authorization": f"Bearer {PassportService().issue({'user_id': account_id})}",
            HEADER_NAME_CSRF_TOKEN: csrf_token,
        }
        sessions: list[Session] = []

        def observe_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
            sessions.append(session)

        @app.after_request
        def assert_request_sessions_closed(response: Response) -> Response:
            assert all(not session.in_transaction() and not session.identity_map for session in sessions)
            return response

        event.listen(Session, "after_begin", observe_session)
        try:
            yield _Harness(client, sqlite_session_factory, account_id, tenant_id, headers, sessions)
        finally:
            event.remove(Session, "after_begin", observe_session)
            _is_setup_completed.reset_success()
            with app.app_context():
                db.session.remove()
                db.engine.dispose()


@pytest.mark.parametrize("endpoint", _ENDPOINTS, ids=lambda endpoint: endpoint.path)
@pytest.mark.parametrize("visibility", ["missing", "different-workspace", "non-normal", "workflow-only", "wrong-mode"])
def test_triggers_reject_inaccessible_apps(harness: _Harness, endpoint: _Endpoint, visibility: str) -> None:
    app_id = str(uuid4())
    if visibility != "missing":
        app_id = harness.create_app(tenant_id=str(uuid4()) if visibility == "different-workspace" else None)
        with harness.session_factory.begin() as session:
            app = session.get(App, app_id)
            assert app is not None
            if visibility == "non-normal":
                session.execute(text("UPDATE apps SET status = 'archived' WHERE id = :app_id"), {"app_id": app_id})
            elif visibility == "wrong-mode":
                app.mode = AppMode.CHAT
            elif visibility == "workflow-only":
                app.mode = AppMode.AGENT
                session.add(
                    Agent(
                        tenant_id=harness.tenant_id,
                        name="Hidden workflow agent",
                        scope=AgentScope.WORKFLOW_ONLY,
                        source=AgentSource.WORKFLOW,
                        app_id=str(uuid4()),
                        backing_app_id=app_id,
                    )
                )

    response = harness.call(endpoint, app_id)

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_not_found"
    assert response.content_type == "application/json"
    assert harness.sessions


def test_list_empty_triggers(harness: _Harness) -> None:
    response = harness.call(_ENDPOINTS[1], harness.create_app())

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"data": []}


def test_list_orders_and_serializes_triggers_without_leaking_other_owners(harness: _Harness) -> None:
    app_id = harness.create_app()
    older = harness.create_trigger(app_id, created_at=datetime(2025, 1, 1))
    same_time = [
        harness.create_trigger(app_id, trigger_type=trigger_type, status=status)
        for trigger_type, status in zip(AppTriggerType, AppTriggerStatus, strict=True)
    ]
    expected_statuses = dict(zip(same_time, AppTriggerStatus, strict=True))
    expected_statuses[older] = AppTriggerStatus.ENABLED
    harness.create_trigger(app_id, tenant_id=str(uuid4()))
    harness.create_trigger(harness.create_app())

    response = harness.call(_ENDPOINTS[1], app_id)

    assert response.status_code == HTTPStatus.OK
    data = response.get_json()["data"]
    assert [item["id"] for item in data] == sorted(same_time, reverse=True) + [older]
    for item in data:
        assert set(item) == {
            "id",
            "trigger_type",
            "title",
            "node_id",
            "provider_name",
            "icon",
            "status",
            "created_at",
            "updated_at",
        }
        assert item["title"] == "Trigger"
        assert item["node_id"] == "node-1"
        assert item["provider_name"] == "langgenius/github/github"
        assert item["status"] == expected_statuses[item["id"]].value
        if item["trigger_type"] == AppTriggerType.TRIGGER_PLUGIN:
            assert item["icon"] == (
                "https://console.example.test/console/api/workspaces/current/tool-provider/builtin/"
                "langgenius/github/github/icon"
            )
        else:
            assert item["icon"] == ""
        if item["id"] in same_time:
            assert item["created_at"] == "2026-01-02T03:04:05"
            assert item["updated_at"] == "2026-01-02T03:04:05"


@pytest.mark.parametrize("role", [TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR])
def test_editor_roles_can_disable_and_enable_with_committed_status(harness: _Harness, role: TenantAccountRole) -> None:
    harness.set_role(role)
    app_id = harness.create_app()
    trigger_id = harness.create_trigger(app_id)

    for enabled, expected in [(False, AppTriggerStatus.DISABLED), (True, AppTriggerStatus.ENABLED)]:
        response = harness.enable(app_id, {"trigger_id": trigger_id, "enable_trigger": enabled})

        assert response.status_code == HTTPStatus.OK
        body = response.get_json()
        assert body["id"] == trigger_id
        assert body["status"] == expected.value
        assert body["icon"].endswith("/langgenius/github/github/icon")
        with harness.session_factory() as session:
            persisted = session.get(AppTrigger, trigger_id)
            assert persisted is not None
            assert persisted.status == expected


@pytest.mark.parametrize("role", [TenantAccountRole.NORMAL, TenantAccountRole.DATASET_OPERATOR])
def test_read_only_roles_cannot_update_trigger(harness: _Harness, role: TenantAccountRole) -> None:
    harness.set_role(role)
    app_id = harness.create_app()
    trigger_id = harness.create_trigger(app_id)

    response = harness.enable(app_id, {"trigger_id": trigger_id, "enable_trigger": False})

    assert response.status_code == HTTPStatus.FORBIDDEN
    with harness.session_factory() as session:
        persisted = session.get(AppTrigger, trigger_id)
        assert persisted is not None
        assert persisted.status == AppTriggerStatus.ENABLED
    assert harness.call(_ENDPOINTS[1], app_id).status_code == HTTPStatus.OK


@pytest.mark.parametrize("missing_field", ["trigger_id", "enable_trigger"])
def test_invalid_update_payload_does_not_write(harness: _Harness, missing_field: str) -> None:
    app_id = harness.create_app()
    trigger_id = harness.create_trigger(app_id)
    payload: dict[str, object] = {"trigger_id": trigger_id, "enable_trigger": False}
    del payload[missing_field]

    response = harness.enable(app_id, payload)

    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    with harness.session_factory() as session:
        persisted = session.get(AppTrigger, trigger_id)
        assert persisted is not None
        assert persisted.status == AppTriggerStatus.ENABLED


@pytest.mark.parametrize("target", ["missing", "other-app", "other-tenant"])
def test_update_rejects_trigger_outside_requested_owner_chain(harness: _Harness, target: str) -> None:
    app_id = harness.create_app()
    trigger_id = str(uuid4())
    if target == "other-app":
        trigger_id = harness.create_trigger(harness.create_app())
    elif target == "other-tenant":
        trigger_id = harness.create_trigger(app_id, tenant_id=str(uuid4()))

    response = harness.enable(app_id, {"trigger_id": trigger_id, "enable_trigger": False})

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_trigger_not_found"
    if target != "missing":
        with harness.session_factory() as session:
            persisted = session.get(AppTrigger, trigger_id)
            assert persisted is not None
            assert persisted.status == AppTriggerStatus.ENABLED


def test_webhook_returns_detached_configuration_and_urls(harness: _Harness) -> None:
    app_id = harness.create_app()
    webhook_id = harness.create_webhook(app_id)
    with harness.session_factory() as session:
        webhook = session.get(WorkflowWebhookTrigger, webhook_id)
        assert webhook is not None
        external_id = webhook.webhook_id

    response = harness.call(_ENDPOINTS[0], app_id)

    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "id": webhook_id,
        "webhook_id": external_id,
        "node_id": "node-1",
        "webhook_url": f"{str(base_url).rstrip('/')}/triggers/webhook/{external_id}",
        "webhook_debug_url": f"{str(base_url).rstrip('/')}/triggers/webhook-debug/{external_id}",
        "created_at": "2026-01-02T03:04:05",
    }


@pytest.mark.parametrize("target", ["missing", "other-app", "other-tenant", "other-node"])
def test_webhook_rejects_references_outside_requested_owner_chain(harness: _Harness, target: str) -> None:
    app_id = harness.create_app()
    if target == "other-app":
        harness.create_webhook(harness.create_app())
    elif target == "other-tenant":
        harness.create_webhook(app_id, tenant_id=str(uuid4()))
    elif target == "other-node":
        harness.create_webhook(app_id, node_id="node-2")

    response = harness.call(_ENDPOINTS[0], app_id)

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "webhook_trigger_not_found"


def test_app_owner_with_rbac_enabled_uses_real_owner_admission(harness: _Harness) -> None:
    harness.set_role(TenantAccountRole.NORMAL)
    app_id = harness.create_app()
    trigger_id = harness.create_trigger(app_id)

    with config_overrides_context(RBAC_ENABLED=True):
        response = harness.enable(app_id, {"trigger_id": trigger_id, "enable_trigger": False})

    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["status"] == AppTriggerStatus.DISABLED


def test_update_requires_csrf_before_persistence(harness: _Harness) -> None:
    app_id = harness.create_app()
    trigger_id = harness.create_trigger(app_id)
    harness.sessions.clear()

    response = harness.client.post(
        f"/console/api/apps/{app_id}/trigger-enable",
        headers={"Authorization": harness.headers["Authorization"]},
        json={"trigger_id": trigger_id, "enable_trigger": False},
    )

    assert response.status_code == HTTPStatus.UNAUTHORIZED
    with harness.session_factory() as session:
        persisted = session.get(AppTrigger, trigger_id)
        assert persisted is not None
        assert persisted.status == AppTriggerStatus.ENABLED
