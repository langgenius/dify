"""Agent API access uses real admission, persistence and committed update events."""

from collections.abc import Iterator
from dataclasses import dataclass
from http import HTTPStatus
from uuid import uuid4

import pytest
from flask import Blueprint, Flask
from flask.testing import FlaskClient
from redis import Redis
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants import HEADER_NAME_CSRF_TOKEN
from controllers.console.agent.api_access import AgentApiAccessApi, AgentApiStatusApi
from controllers.console.agent.roster import (
    AgentAppApi,
    AgentAppListApi,
    AgentInviteOptionsApi,
    AgentLogMessagesApi,
    AgentLogsApi,
    AgentLogSourcesApi,
    AgentRosterVersionDetailApi,
    AgentRosterVersionRestoreApi,
    AgentRosterVersionsApi,
    AgentStatisticsSummaryApi,
)
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from events.app_event import app_was_updated
from extensions.ext_application_services import build_application_services
from extensions.ext_login import DifyLoginManager, bind_account_loader, load_user_from_request, unauthorized_handler
from extensions.ext_redis import RedisClientWrapper
from libs.datetime_utils import naive_utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.agent import Agent, AgentConfigRevision, AgentConfigRevisionOperation, AgentScope, AgentSource
from models.engine import db
from models.enums import ApiTokenType
from models.model import ApiToken, App, AppMode
from services.entities.app_entities import AppEvent
from tests.helpers.unit.config_override import config_overrides_context


@dataclass(frozen=True)
class Harness:
    client: FlaskClient
    sessions: sessionmaker[Session]
    account_id: str
    tenant_id: str
    headers: dict[str, str]

    def create_agent(self, *, published: bool = False, tenant_id: str | None = None) -> tuple[str, str]:
        tenant_id = tenant_id or self.tenant_id
        with self.sessions.begin() as session:
            app = App(
                tenant_id=tenant_id,
                name="Agent App",
                mode=AppMode.AGENT,
                created_by=self.account_id,
                maintainer=self.account_id,
                enable_api=False,
                enable_site=False,
                api_rpm=60,
                api_rph=600,
            )
            session.add(app)
            session.flush()
            agent = Agent(
                tenant_id=tenant_id,
                name="Agent",
                app_id=app.id,
                created_by=self.account_id,
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                active_config_snapshot_id=str(uuid4()) if published else None,
            )
            session.add(agent)
            session.flush()
            if published:
                session.add(
                    AgentConfigRevision(
                        tenant_id=tenant_id,
                        agent_id=agent.id,
                        current_snapshot_id=agent.active_config_snapshot_id,
                        revision=1,
                        operation=AgentConfigRevisionOperation.PUBLISH_DRAFT,
                    )
                )
            return agent.id, app.id

    def get(self, agent_id: str) -> TestResponse:
        return self.client.get(f"/console/api/agent/{agent_id}/api-access", headers=self.headers)

    def set(self, agent_id: str, enabled: bool) -> TestResponse:
        return self.client.post(
            f"/console/api/agent/{agent_id}/api-enable", headers=self.headers, json={"enable_api": enabled}
        )


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[Harness]:
    with (
        Redis() as redis_client,
        config_overrides_context(
            DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
            RBAC_ENABLED=False,
            LOGIN_DISABLED=False,
            INIT_PASSWORD="",
            SECRET_KEY="agent-access-test-secret-at-least-32-bytes",
            CONSOLE_API_URL="https://console.example.test",
            SERVICE_API_URL="https://api.example.test/v1",
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
        manager = DifyLoginManager()
        manager.request_loader(load_user_from_request)
        manager.unauthorized_handler(unauthorized_handler)
        manager.init_app(app)
        blueprint = Blueprint("console", __name__, url_prefix="/console/api")
        api = ExternalApi(blueprint)
        api.add_resource(AgentApiAccessApi, "/agent/<uuid:agent_id>/api-access")
        api.add_resource(AgentApiStatusApi, "/agent/<uuid:agent_id>/api-enable")
        api.add_resource(AgentAppListApi, "/agent")
        api.add_resource(AgentInviteOptionsApi, "/agent/invite-options")
        api.add_resource(AgentLogsApi, "/agent/<uuid:agent_id>/logs")
        api.add_resource(AgentLogMessagesApi, "/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages")
        api.add_resource(AgentLogSourcesApi, "/agent/<uuid:agent_id>/log-sources")
        api.add_resource(AgentStatisticsSummaryApi, "/agent/<uuid:agent_id>/statistics/summary")
        api.add_resource(AgentAppApi, "/agent/<uuid:agent_id>")
        api.add_resource(AgentRosterVersionsApi, "/agent/<uuid:agent_id>/versions")
        api.add_resource(AgentRosterVersionDetailApi, "/agent/<uuid:agent_id>/versions/<uuid:version_id>")
        api.add_resource(AgentRosterVersionRestoreApi, "/agent/<uuid:agent_id>/versions/<uuid:version_id>/restore")
        app.register_blueprint(blueprint)
        now = naive_utc_now()
        with sqlite_session_factory.begin() as session:
            account = Account(
                email="agent-access@example.com", name="Owner", status=AccountStatus.ACTIVE, initialized_at=now
            )
            account.last_active_at = now
            tenant = Tenant(name="Workspace")
            session.add_all([account, tenant, DifySetup(version="test")])
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True
                )
            )
            account_id, tenant_id = account.id, tenant.id
        with app.app_context():
            _is_setup_completed.reset_success()
            assert _is_setup_completed()
            db.session.remove()
        client = app.test_client()
        csrf = generate_csrf_token(account_id)
        client.set_cookie(_real_cookie_name("csrf_token"), csrf)
        headers = {
            "Authorization": f"Bearer {PassportService().issue({'user_id': account_id})}",
            HEADER_NAME_CSRF_TOKEN: csrf,
        }
        try:
            yield Harness(client, sqlite_session_factory, account_id, tenant_id, headers)
        finally:
            _is_setup_completed.reset_success()
            with app.app_context():
                db.session.remove()
                db.engine.dispose()


def test_get_access_preserves_response_and_counts_only_owned_or_legacy_app_keys(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        session.add_all(
            [
                ApiToken(type=ApiTokenType.APP, token="own", app_id=app_id, tenant_id=harness.tenant_id),
                ApiToken(type=ApiTokenType.APP, token="legacy", app_id=app_id, tenant_id=None),
                ApiToken(type=ApiTokenType.APP, token="foreign", app_id=app_id, tenant_id=str(uuid4())),
                ApiToken(type=ApiTokenType.APP, token="other", app_id=str(uuid4()), tenant_id=harness.tenant_id),
            ]
        )
    response = harness.get(agent_id)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {
        "access_ready": True,
        "enabled": False,
        "service_api_base_url": "https://api.example.test/v1",
        "streaming_only": True,
        "chat_endpoint": "https://api.example.test/v1/chat-messages",
        "stop_endpoint": "https://api.example.test/v1/chat-messages/{task_id}/stop",
        "conversations_endpoint": "https://api.example.test/v1/conversations",
        "messages_endpoint": "https://api.example.test/v1/messages",
        "files_upload_endpoint": "https://api.example.test/v1/files/upload",
        "parameters_endpoint": "https://api.example.test/v1/parameters",
        "info_endpoint": "https://api.example.test/v1/info",
        "meta_endpoint": "https://api.example.test/v1/meta",
        "api_rpm": 60,
        "api_rph": 600,
        "api_key_count": 2,
    }


def test_setting_access_is_committed_before_event_and_notifies_only_on_change(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent(published=True)
    events: list[tuple[str, bool]] = []

    def on_update(sender: object) -> None:
        assert isinstance(sender, AppEvent)
        with harness.sessions() as session:
            app = session.get(App, sender.id)
            assert app is not None
            events.append((sender.tenant_id, app.enable_api))

    app_was_updated.connect(on_update, weak=False)
    try:
        assert harness.set(agent_id, True).get_json()["enabled"] is True
        assert harness.set(agent_id, True).get_json()["enabled"] is True
        assert harness.set(agent_id, False).get_json()["enabled"] is False
    finally:
        app_was_updated.disconnect(on_update)
    assert events == [(harness.tenant_id, True), (harness.tenant_id, False)]
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert app.updated_by == harness.account_id
        assert not app.enable_api


def test_unpublished_cannot_enable_and_foreign_agents_are_not_found(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    assert harness.get(agent_id).get_json()["access_ready"] is False
    response = harness.set(agent_id, True)
    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "agent_not_published"
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert not app.enable_api
    foreign_id, _ = harness.create_agent(published=True, tenant_id=str(uuid4()))
    assert harness.get(foreign_id).status_code == HTTPStatus.NOT_FOUND
    assert harness.set(foreign_id, True).status_code == HTTPStatus.NOT_FOUND


def test_unpublished_stored_enabled_state_is_hidden_and_can_be_disabled(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        app = session.get(App, app_id)
        assert app is not None
        app.enable_api = True
        app.api_rpm = 0
        app.api_rph = 0
    result = harness.get(agent_id).get_json()
    assert result["access_ready"] is False
    assert result["enabled"] is False
    assert result["api_rpm"] == result["api_rph"] == 0
    assert harness.set(agent_id, False).get_json()["enabled"] is False
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert not app.enable_api


def test_failed_write_rolls_back_and_does_not_emit_update(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent(published=True)
    updates: list[object] = []

    def on_update(sender: object) -> None:
        updates.append(sender)

    def reject_write(_mapper: object, _connection: object, _target: object) -> None:
        raise RuntimeError("write failed")

    app_was_updated.connect(on_update, weak=False)
    event.listen(App, "before_update", reject_write)
    try:
        assert harness.set(agent_id, True).status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    finally:
        event.remove(App, "before_update", reject_write)
        app_was_updated.disconnect(on_update)
    assert updates == []
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert not app.enable_api


def test_member_can_read_but_cannot_change_api_access(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
    assert harness.get(agent_id).status_code == HTTPStatus.OK
    assert harness.set(agent_id, True).status_code == HTTPStatus.FORBIDDEN
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert not app.enable_api


def test_rbac_agent_owner_can_change_access_as_a_member(harness: Harness) -> None:
    agent_id, app_id = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))
        assert membership is not None
        membership.role = TenantAccountRole.NORMAL
    with config_overrides_context(RBAC_ENABLED=True):
        assert harness.get(agent_id).status_code == HTTPStatus.OK
        assert harness.set(agent_id, True).status_code == HTTPStatus.OK
    with harness.sessions() as session:
        app = session.get(App, app_id)
        assert app is not None
        assert app.enable_api
