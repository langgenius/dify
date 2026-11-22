"""Agent API access uses real admission, persistence and committed update events."""

from collections.abc import Iterator
from csv import DictReader
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Blueprint, Flask
from flask.testing import FlaskClient
from redis import Redis
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_ACCESS_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.agent import roster as roster_controller
from controllers.console.agent.api_access import AgentApiAccessApi, AgentApiStatusApi
from controllers.console.agent.build_session import AgentDebugConversationRefreshApi
from controllers.console.agent.roster import (
    AgentAppApi,
    AgentAppListApi,
    AgentBuildDraftApi,
    AgentInviteOptionsApi,
    AgentLogExportApi,
    AgentLogExportFileApi,
    AgentLogExportLatestApi,
    AgentLogExportPreviewApi,
    AgentLogExportTaskApi,
    AgentLogIdentityOptionsApi,
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
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now, utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.agent import Agent, AgentConfigRevision, AgentConfigRevisionOperation, AgentScope, AgentSource
from models.engine import db
from models.enums import ApiTokenType, ConversationFromSource
from models.model import ApiToken, App, AppMode
from services.agent.observability_contracts import AgentLogExportFilters
from services.entities.app_entities import AppEvent
from services.retention.agent.log_export_service import AgentLogExportTask
from services.retention.log_export_task import LogExportStatus
from tasks.log_export_tasks import prepare_log_export_task
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.log_export_fixtures import LogExportStorageIo
from tests.helpers.unit.model_factories import make_conversation, make_end_user, make_message


@dataclass(frozen=True)
class Harness:
    client: FlaskClient
    sessions: sessionmaker[Session]
    account_id: str
    tenant_id: str
    headers: dict[str, str]

    def create_agent(
        self, *, published: bool = False, tenant_id: str | None = None, name: str = "Agent"
    ) -> tuple[str, str]:
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
                name=name,
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
        api.add_resource(AgentLogIdentityOptionsApi, "/agent/<uuid:agent_id>/logs/identity-options")
        api.add_resource(AgentLogExportPreviewApi, "/agent/<uuid:agent_id>/log-exports/preview")
        api.add_resource(AgentLogExportApi, "/agent/<uuid:agent_id>/log-exports")
        api.add_resource(AgentLogExportLatestApi, "/agent/<uuid:agent_id>/log-exports/latest")
        api.add_resource(AgentLogExportTaskApi, "/agent/<uuid:agent_id>/log-exports/<uuid:task_id>")
        api.add_resource(AgentLogExportFileApi, "/agent/<uuid:agent_id>/log-exports/<uuid:task_id>/file")
        api.add_resource(AgentLogMessagesApi, "/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages")
        api.add_resource(AgentLogSourcesApi, "/agent/<uuid:agent_id>/log-sources")
        api.add_resource(AgentStatisticsSummaryApi, "/agent/<uuid:agent_id>/statistics/summary")
        api.add_resource(AgentAppApi, "/agent/<uuid:agent_id>")
        api.add_resource(AgentBuildDraftApi, "/agent/<uuid:agent_id>/build-draft")
        api.add_resource(AgentDebugConversationRefreshApi, "/agent/<uuid:agent_id>/debug-conversation/refresh")
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


def test_log_identity_search_requires_a_keyword_and_an_owned_agent(harness: Harness) -> None:
    agent_id, _ = harness.create_agent()
    foreign_id, _ = harness.create_agent(tenant_id=str(uuid4()))
    path = f"/console/api/agent/{agent_id}/logs/identity-options"
    response = harness.client.get(path, headers=harness.headers, query_string={"keyword": "001"})
    assert response.status_code == HTTPStatus.OK
    assert response.json == {"data": []}
    response = harness.client.get(path, headers=harness.headers, query_string={"keyword": " "})
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    response = harness.client.get(
        f"/console/api/agent/{foreign_id}/logs/identity-options",
        headers=harness.headers,
        query_string={"keyword": "001"},
    )
    assert response.status_code == HTTPStatus.NOT_FOUND


def test_log_export_preview_is_scoped_and_requires_export_entitlement(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    agent_id, _ = harness.create_agent()
    foreign_id, _ = harness.create_agent(tenant_id=str(uuid4()))
    path = f"/console/api/agent/{agent_id}/log-exports/preview"
    response = harness.client.get(path, headers=harness.headers, query_string={"end_user_ids[0]": str(uuid4())})
    assert response.status_code == HTTPStatus.OK
    assert response.json == {"counts": {"log_count": 0, "row_count": 0}}
    response = harness.client.get(path, headers=harness.headers, query_string={"sources": "workflow:invalid"})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    response = harness.client.get(f"/console/api/agent/{foreign_id}/log-exports/preview", headers=harness.headers)
    assert response.status_code == HTTPStatus.NOT_FOUND

    monkeypatch.setattr(roster_controller, "is_cloud_edition_billing_paid_plan", lambda _tenant_id: False)
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
        response = harness.client.get(path, headers=harness.headers)
        create = harness.client.post(path.removesuffix("/preview"), headers=harness.headers, json={})
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "paid_plan_required"
    assert create.status_code == HTTPStatus.FORBIDDEN
    assert create.get_json()["code"] == "paid_plan_required"

    with harness.sessions.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account_id))
        assert membership is not None
        membership.role = TenantAccountRole.EDITOR
    response = harness.client.get(path, headers=harness.headers)
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == "forbidden"
    create = harness.client.post(path.removesuffix("/preview"), headers=harness.headers, json={})
    assert create.status_code == HTTPStatus.FORBIDDEN
    assert create.get_json()["code"] == "forbidden"


def test_create_agent_log_export_dispatches_utc_filters_and_prepares_the_csv(
    harness: Harness,
    monkeypatch: pytest.MonkeyPatch,
    log_export_publish: MagicMock,
    log_export_storage: LogExportStorageIo,
) -> None:
    saved: dict[str, tuple[int, str]] = {}

    def setex(_redis: RedisClientWrapper, key: str, expires_in: int, value: str) -> bool:
        saved[key] = (expires_in, value)
        return True

    def transition(*, keys: list[str], args: list[str]) -> int:
        (key,) = keys
        ttl, raw = saved[key]
        if AgentLogExportTask.model_validate_json(raw).status != args[0]:
            return 0
        saved[key] = (ttl, args[1])
        return 1

    monkeypatch.setattr(RedisClientWrapper, "setex", setex)
    monkeypatch.setattr(RedisClientWrapper, "get", lambda _redis, key: saved[key][1] if key in saved else None)
    monkeypatch.setattr(RedisClientWrapper, "register_script", lambda _redis, _script: transition)
    publish = log_export_publish
    uploaded: dict[str, list[dict[str, str]]] = {}

    def upload(key: str, path: Path) -> None:
        with path.open(encoding="utf-8-sig", newline="") as csv_file:
            uploaded[key] = list(DictReader(csv_file))

    save_file = log_export_storage.save_file
    save_file.side_effect = upload
    agent_id, app_id = harness.create_agent()
    foreign_id, _ = harness.create_agent(tenant_id=str(uuid4()))
    end_user_id, conversation_id, message_id = (str(uuid4()) for _ in range(3))
    account_conversation_id, account_message_id = (str(uuid4()) for _ in range(2))
    with harness.sessions.begin() as session:
        account = session.get(Account, harness.account_id)
        assert account is not None
        account.timezone = "Asia/Shanghai"
        session.add_all(
            [
                make_end_user(end_user_id=end_user_id, tenant_id=harness.tenant_id, session_id="customer-001"),
                make_conversation(
                    conversation_id=conversation_id,
                    app_id=app_id,
                    mode=AppMode.AGENT,
                    from_source=ConversationFromSource.API,
                    from_end_user_id=end_user_id,
                ),
                make_message(
                    message_id=message_id,
                    app_id=app_id,
                    conversation_id=conversation_id,
                    query="What are the next steps?",
                    answer="Review the report.",
                    message={},
                    from_source=ConversationFromSource.API,
                    from_end_user_id=end_user_id,
                    invoke_from="web-app",
                    created_at=datetime(2026, 7, 23, 7, 30, tzinfo=UTC),
                ),
                make_conversation(
                    conversation_id=account_conversation_id,
                    app_id=app_id,
                    mode=AppMode.AGENT,
                    from_source=ConversationFromSource.CONSOLE,
                    from_account_id=harness.account_id,
                ),
                make_message(
                    message_id=account_message_id,
                    app_id=app_id,
                    conversation_id=account_conversation_id,
                    query="Check status",
                    answer="Ready",
                    message={},
                    from_source=ConversationFromSource.CONSOLE,
                    from_account_id=harness.account_id,
                    invoke_from="explore",
                    created_at=datetime(2026, 7, 23, 7, 40, tzinfo=UTC),
                ),
            ]
        )

    agent_url = f"/console/api/agent/{agent_id}"
    base = f"{agent_url}/log-exports"
    account_logs = harness.client.get(
        f"{agent_url}/logs", headers=harness.headers, query_string={"account_ids[0]": harness.account_id}
    )
    assert account_logs.status_code == HTTPStatus.OK
    assert [row["account_id"] for row in account_logs.get_json()["data"]] == [harness.account_id]
    preview = harness.client.get(
        f"{base}/preview",
        headers=harness.headers,
        query_string={"end_user_ids": end_user_id, "account_ids[0]": harness.account_id},
    )
    assert (preview.status_code, preview.json) == (HTTPStatus.OK, {"counts": {"log_count": 2, "row_count": 2}})
    response = harness.client.post(
        base,
        headers=harness.headers,
        json={
            "sources": [f"webapp:{app_id}"],
            "end_user_ids": [end_user_id],
            "account_ids": [harness.account_id],
            "start": "2026-07-23 15:00",
            "end": "2026-07-23 16:00",
        },
    )
    assert response.status_code == HTTPStatus.ACCEPTED
    task_id = response.get_json()["task_id"]
    assert response.json == {"task_id": task_id, "status": "pending"}
    task_key = f"agent_log_export:{harness.tenant_id}:{agent_id}:{task_id}"
    task_ttl, task_json = saved[task_key]
    task = AgentLogExportTask.model_validate_json(task_json)
    assert task.app_id == agent_id
    assert task.tenant_id == harness.tenant_id
    assert task.requested_by == harness.account_id
    assert task.filters.sources == (f"webapp:{app_id}",)
    assert task.filters.end_user_ids == (end_user_id,)
    assert task.filters.account_ids == (harness.account_id,)
    assert task.filters.start == datetime(2026, 7, 23, 7, tzinfo=UTC)
    assert task.filters.end == datetime(2026, 7, 23, 8, tzinfo=UTC)
    assert task.expires_at - task.created_at == timedelta(days=1)
    assert saved[f"agent_log_export_latest:{harness.tenant_id}:{agent_id}:{harness.account_id}"] == (task_ttl, task_id)
    arguments = {"tenant_id": harness.tenant_id, "app_id": agent_id, "task_id": task_id, "export_kind": "agent"}
    publish.assert_called_once_with(kwargs=arguments, task_id=task_id, expires=task.expires_at)
    pending = harness.client.get(f"{base}/{task_id}", headers=harness.headers)
    assert (pending.status_code, pending.json) == (HTTPStatus.OK, {"task_id": task_id, "status": "pending"})

    for body in ({"sources": ["unknown-source"]}, {"start": "2026-07-23 16:00", "end": "2026-07-23 15:00"}):
        response = harness.client.post(base, headers=harness.headers, json=body)
        assert response.status_code == HTTPStatus.BAD_REQUEST
    response = harness.client.post(f"/console/api/agent/{foreign_id}/log-exports", headers=harness.headers, json={})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert len(saved) == 2

    published_arguments = publish.call_args.kwargs["kwargs"]
    with harness.client.application.app_context():
        prepare_log_export_task.run(**published_arguments)
        prepare_log_export_task.run(**published_arguments)

    ready = AgentLogExportTask.model_validate_json(saved[task_key][1])
    assert ready.status is LogExportStatus.READY
    assert ready.storage_key == f"agent-log-exports/{harness.tenant_id}/{agent_id}/{task_id}.csv"
    rows = {row["message_id"]: row for row in uploaded[ready.storage_key]}
    assert rows.keys() == {message_id, account_message_id}
    row = rows[message_id]
    assert (row["agent_id"], row["message_id"], row["end_user_id"], row["app_response"]) == (
        agent_id,
        message_id,
        "customer-001",
        "Review the report.",
    )
    assert row["account_id"] == ""
    assert rows[account_message_id]["account_id"] == harness.account_id
    assert rows[account_message_id]["end_user_id"] == ""
    save_file.assert_called_once()
    status = harness.client.get(f"{base}/{task_id}", headers=harness.headers)
    assert (status.status_code, status.json) == (HTTPStatus.OK, {"task_id": task_id, "status": "ready"})
    assert status.headers["Cache-Control"] == "no-store"


def test_agent_log_export_status_scopes_tasks_and_restores_the_callers_latest_filters(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    agent_id, _ = harness.create_agent()
    other_agent_id, _ = harness.create_agent(name="Other agent")
    foreign_agent_id, _ = harness.create_agent(tenant_id=str(uuid4()))
    other_requester = str(uuid4())
    end_user_id = str(uuid4())
    task = AgentLogExportTask.pending(
        tenant_id=harness.tenant_id,
        app_id=agent_id,
        requested_by=harness.account_id,
        filters=AgentLogExportFilters(
            sources=("webapp",), end_user_ids=(end_user_id,), start=datetime(2026, 7, 23, 7, tzinfo=UTC), end=None
        ),
    ).model_copy(update={"status": LogExportStatus.PROCESSING})
    other_task = task.model_copy(update={"task_id": str(uuid4()), "requested_by": other_requester})
    task_prefix = f"agent_log_export:{harness.tenant_id}:{agent_id}:"
    latest_prefix = f"agent_log_export_latest:{harness.tenant_id}:{agent_id}:"
    cache = {
        task_prefix + other_task.task_id: other_task.model_dump_json(),
        latest_prefix + other_requester: other_task.task_id,
    }
    monkeypatch.setattr(RedisClientWrapper, "get", lambda _redis, key: cache.get(key))
    path = f"/console/api/agent/{agent_id}/log-exports"

    latest = harness.client.get(f"{path}/latest", headers=harness.headers)
    assert (latest.status_code, latest.json) == (HTTPStatus.OK, {"task": None})
    cache[task_prefix + task.task_id] = task.model_dump_json(exclude={"filters": {"account_ids"}})
    cache[latest_prefix + harness.account_id] = task.task_id
    latest = harness.client.get(f"{path}/latest", headers=harness.headers)
    assert latest.status_code == HTTPStatus.OK
    assert latest.headers["Cache-Control"] == "no-store"
    assert latest.json == {
        "task": {
            "task_id": task.task_id,
            "status": "processing",
            "filters": {
                "sources": ["webapp"],
                "end_user_ids": [end_user_id],
                "account_ids": [],
                "start": "2026-07-23T07:00:00Z",
                "end": None,
            },
        }
    }

    wrong_agent = harness.client.get(
        f"/console/api/agent/{other_agent_id}/log-exports/{task.task_id}", headers=harness.headers
    )
    assert wrong_agent.status_code == HTTPStatus.NOT_FOUND
    assert wrong_agent.get_json()["code"] == "agent_log_export_task_not_found"
    foreign = harness.client.get(f"/console/api/agent/{foreign_agent_id}/log-exports/latest", headers=harness.headers)
    assert foreign.status_code == HTTPStatus.NOT_FOUND

    cache[task_prefix + task.task_id] = task.model_copy(
        update={"expires_at": task.created_at - timedelta(seconds=1)}
    ).model_dump_json()
    expired = harness.client.get(f"{path}/{task.task_id}", headers=harness.headers)
    assert expired.status_code == HTTPStatus.NOT_FOUND
    assert expired.get_json()["code"] == "agent_log_export_task_not_found"
    assert harness.client.get(f"{path}/latest", headers=harness.headers).json == {"task": None}


@pytest.mark.parametrize("edition", [DeploymentEdition.CLOUD, DeploymentEdition.COMMUNITY])
def test_agent_log_export_file_downloads_from_a_browser_session(
    harness: Harness,
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
    log_export_storage: LogExportStorageIo,
) -> None:
    agent_id, _ = harness.create_agent()
    task = AgentLogExportTask.pending(
        tenant_id=harness.tenant_id,
        app_id=agent_id,
        requested_by=harness.account_id,
        filters=AgentLogExportFilters(sources=(), end_user_ids=(), start=None, end=None),
    )
    task_key = f"agent_log_export:{harness.tenant_id}:{agent_id}:{task.task_id}"
    cache = {task_key: task.model_dump_json()}
    monkeypatch.setattr(RedisClientWrapper, "get", lambda _redis, key: cache.get(key))
    monkeypatch.setattr(roster_controller, "is_cloud_edition_billing_paid_plan", lambda _tenant_id: True)
    storage = log_export_storage
    storage.exists.return_value = True
    url = "https://storage.example.test/agent-logs.csv?signature=signed"
    storage.generate_presigned_url.return_value = url
    payload = b"\xef\xbb\xbfagent_id,message_id\r\nagent,message\r\n"
    storage.load.return_value = (chunk for chunk in (payload[:16], payload[16:]))
    path = f"/console/api/agent/{agent_id}/log-exports/{task.task_id}/file"
    browser = harness.client.application.test_client()

    with config_overrides_context(DEPLOYMENT_EDITION=edition, STORAGE_TYPE=StorageType.S3):
        assert browser.get(path).status_code == HTTPStatus.UNAUTHORIZED
        browser.set_cookie(
            _real_cookie_name(COOKIE_NAME_ACCESS_TOKEN), harness.headers["Authorization"].removeprefix("Bearer ")
        )
        assert browser.get(path.removesuffix("/file")).status_code == HTTPStatus.UNAUTHORIZED
        pending = browser.get(path)
        assert (pending.status_code, pending.get_json()["code"]) == (
            HTTPStatus.CONFLICT,
            "agent_log_export_task_not_ready",
        )
        storage.exists.assert_not_called()
        storage.load.assert_not_called()

        storage_key = f"agent-log-exports/{harness.tenant_id}/{agent_id}/{task.task_id}.csv"
        cache[task_key] = task.model_copy(
            update={
                "status": LogExportStatus.READY,
                "storage_key": storage_key,
                "expires_at": utc_now() + timedelta(minutes=2),
            }
        ).model_dump_json()
        filename = f"agent-logs-{task.task_id}.csv"
        with browser.get(path) as response:
            assert response.headers["Cache-Control"] == "no-store"
            if edition == DeploymentEdition.CLOUD:
                assert response.status_code == HTTPStatus.FOUND
                assert response.headers["Location"] == url
                expires_in = storage.generate_presigned_url.call_args.kwargs["expires_in"]
                assert 0 < expires_in <= 120
                storage.generate_presigned_url.assert_called_once_with(
                    storage_key,
                    expires_in=expires_in,
                    content_type="text/csv; charset=utf-8",
                    download_filename=filename,
                )
                storage.load.assert_not_called()
            else:
                assert response.status_code == HTTPStatus.OK
                assert response.mimetype == "text/csv"
                assert response.headers["Content-Disposition"] == f"attachment; filename={filename}"
                assert response.data == payload
                storage.load.assert_called_once_with(storage_key, stream=True)
                storage.generate_presigned_url.assert_not_called()

        storage.exists.return_value = False
        storage.load.side_effect = FileNotFoundError
        missing = browser.get(path)
        assert (missing.status_code, missing.get_json()["code"]) == (
            HTTPStatus.NOT_FOUND,
            "agent_log_export_file_not_found",
        )


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
