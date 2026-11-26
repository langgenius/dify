"""Exercise Agent Console routes with real admission and persistence."""

import json
from collections.abc import Iterator
from csv import DictReader
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from functools import partial
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest
from flask import Blueprint, Flask
from flask.testing import FlaskClient
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_ACCESS_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.agent import roster as roster_controller
from controllers.console.agent.api_access import AgentApiAccessApi, AgentApiStatusApi
from controllers.console.agent.build_session import (
    AgentBuildDraftApi,
    AgentBuildDraftApplyApi,
    AgentBuildDraftCheckoutApi,
    AgentDebugConversationRefreshApi,
)
from controllers.console.agent.composer import AgentComposerApi, AgentComposerCandidatesApi, AgentComposerValidateApi
from controllers.console.agent.roster import (
    AgentAppApi,
    AgentAppCopyApi,
    AgentAppListApi,
    AgentInviteOptionsApi,
    AgentLogExportApi,
    AgentLogExportCancelApi,
    AgentLogExportFileApi,
    AgentLogExportLatestApi,
    AgentLogExportPreviewApi,
    AgentLogExportTaskApi,
    AgentLogIdentityOptionsApi,
    AgentLogMessagesApi,
    AgentLogsApi,
    AgentLogSourcesApi,
    AgentPublishApi,
    AgentRosterVersionDetailApi,
    AgentRosterVersionRestoreApi,
    AgentRosterVersionsApi,
    AgentStatisticsSummaryApi,
)
from controllers.console.wraps import _is_setup_completed
from enums import DeploymentEdition
from events.app_event import app_was_updated
from extensions.ext_application_services import application_services, build_application_services
from extensions.ext_login import DifyLoginManager, bind_account_loader, load_user_from_request, unauthorized_handler
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now, utc_now
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import _real_cookie_name, generate_csrf_token
from models import Account, DifySetup, Tenant, TenantAccountJoin
from models.account import AccountStatus, TenantAccountRole
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentScope,
    AgentSource,
    AgentWorkingResourceStatus,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig
from models.engine import db
from models.enums import ApiTokenType, ConversationFromSource
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSAppSpaceJoinStatus,
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
)
from models.knowledge_fs_cutover import (
    KnowledgeFSCutoverRevisionWatermark,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)
from models.model import ApiToken, App, AppMode, AppModelConfig
from models.skill import AgentSkillBinding, AgentSkillBindingSnapshot
from repositories.app.agent_app_repository import AgentAppRepository
from services.agent.app_composer import AgentAppComposer
from services.agent.composer_tools import list_workspace_dify_tools
from services.agent.knowledge_spaces import authorize_composer_knowledge
from services.agent.observability_contracts import AgentLogExportFilters
from services.enterprise.base import EnterpriseRequest
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.app_entities import AppEvent
from services.evaluation_service import EvaluationService
from services.retention.agent.log_export_service import AgentLogExportTask
from services.retention.log_export_task import LogExportStatus
from tasks.log_export_tasks import prepare_log_export_task
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.log_export_fixtures import LogExportRedisIo, LogExportStorageIo
from tests.helpers.unit.model_factories import make_conversation, make_end_user, make_message
from tests.helpers.unit.rbac_fakes import RBACDomain


@dataclass(frozen=True)
class Harness:
    client: FlaskClient
    sessions: sessionmaker[Session]
    account_id: str
    tenant_id: str
    headers: dict[str, str]
    redis: LogExportRedisIo

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
def harness(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], log_export_redis: LogExportRedisIo
) -> Iterator[Harness]:
    with config_overrides_context(
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        RBAC_ENABLED=False,
        LOGIN_DISABLED=False,
        INIT_PASSWORD="",
        SECRET_KEY="agent-access-test-secret-at-least-32-bytes",
        CONSOLE_API_URL="https://console.example.test",
        SERVICE_API_URL="https://api.example.test/v1",
    ):
        app = Flask(__name__)
        app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
        db.init_app(app)
        services = build_application_services(
            database_client=sqlite_session_factory,
            deployment_edition=DeploymentEdition.COMMUNITY,
            initialization_password="",
            redis=log_export_redis.client,
        )
        app.extensions["application_services"] = services
        bind_account_loader(app, services.accounts.identity.load_user)
        manager = DifyLoginManager()
        manager.request_loader(load_user_from_request)
        manager.unauthorized_handler(unauthorized_handler)
        manager.init_app(app)
        blueprint = Blueprint("console", __name__, url_prefix="/console/api")
        api = ExternalApi(blueprint)
        api.add_resource(AgentComposerApi, "/agent/<uuid:agent_id>/composer")
        api.add_resource(AgentComposerCandidatesApi, "/agent/<uuid:agent_id>/composer/candidates")
        api.add_resource(AgentComposerValidateApi, "/agent/<uuid:agent_id>/composer/validate")
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
        api.add_resource(AgentLogExportCancelApi, "/agent/<uuid:agent_id>/log-exports/<uuid:task_id>/cancel")
        api.add_resource(AgentLogExportFileApi, "/agent/<uuid:agent_id>/log-exports/<uuid:task_id>/file")
        api.add_resource(AgentLogMessagesApi, "/agent/<uuid:agent_id>/logs/<uuid:conversation_id>/messages")
        api.add_resource(AgentLogSourcesApi, "/agent/<uuid:agent_id>/log-sources")
        api.add_resource(AgentStatisticsSummaryApi, "/agent/<uuid:agent_id>/statistics/summary")
        api.add_resource(AgentAppCopyApi, "/agent/<uuid:agent_id>/copy")
        api.add_resource(AgentPublishApi, "/agent/<uuid:agent_id>/publish")
        api.add_resource(AgentAppApi, "/agent/<uuid:agent_id>")
        api.add_resource(AgentBuildDraftApi, "/agent/<uuid:agent_id>/build-draft")
        api.add_resource(AgentBuildDraftCheckoutApi, "/agent/<uuid:agent_id>/build-draft/checkout")
        api.add_resource(AgentBuildDraftApplyApi, "/agent/<uuid:agent_id>/build-draft/apply")
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
            yield Harness(client, sqlite_session_factory, account_id, tenant_id, headers, log_export_redis)
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
    log_export_publish: MagicMock,
    log_export_storage: LogExportStorageIo,
) -> None:
    publish = log_export_publish
    uploaded: dict[str, list[dict[str, str]]] = {}

    def upload(key: str, path: Path) -> None:
        with path.open(encoding="utf-8-sig", newline="") as csv_file:
            uploaded[key] = list(DictReader(csv_file))

    save_from_path = log_export_storage.save_from_path
    save_from_path.side_effect = upload
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
    labels = [{"id": end_user_id, "source": "end-user", "label": "customer-001"}]
    response = harness.client.post(
        base,
        headers=harness.headers,
        json={
            "sources": [f"webapp:{app_id}"],
            "end_user_ids": [end_user_id],
            "account_ids": [harness.account_id],
            "start": "2026-07-23 15:00",
            "end": "2026-07-23 16:00",
            "identity_labels": labels,
            "estimated_rows": 5,
        },
    )
    assert response.status_code == HTTPStatus.ACCEPTED
    task_id = response.get_json()["task_id"]
    assert response.json == {"task_id": task_id, "status": "pending", "estimated_rows": 5}
    task_key = f"agent_log_export:{{{harness.tenant_id}}}:{agent_id}:{task_id}"
    task = AgentLogExportTask.model_validate_json(harness.redis.get(task_key))
    assert task.app_id == agent_id
    assert task.tenant_id == harness.tenant_id
    assert task.requested_by == harness.account_id
    assert task.estimated_rows == 5
    assert task.filters.sources == (f"webapp:{app_id}",)
    assert task.filters.end_user_ids == (end_user_id,)
    assert task.filters.account_ids == (harness.account_id,)
    assert task.filters.start == datetime(2026, 7, 23, 7, tzinfo=UTC)
    assert task.filters.end == datetime(2026, 7, 23, 8, tzinfo=UTC)
    assert task.expires_at is None
    assert (
        harness.redis.get(f"agent_log_export_latest:{{{harness.tenant_id}}}:{agent_id}:{harness.account_id}") == task_id
    )
    arguments = {"tenant_id": harness.tenant_id, "app_id": agent_id, "task_id": task_id, "export_kind": "agent"}
    publish.assert_called_once_with(kwargs=arguments, task_id=task_id)
    pending = harness.client.get(f"{base}/{task_id}", headers=harness.headers)
    assert (pending.status_code, pending.json) == (
        HTTPStatus.OK,
        {"task_id": task_id, "status": "pending", "estimated_rows": 5, "progress": None},
    )

    for source in ("webapp:", "webapp:not-an-app-id", "workflow:"):
        assert (
            harness.client.get(f"{base}/preview", headers=harness.headers, query_string={"sources": source}).status_code
            == HTTPStatus.BAD_REQUEST
        )
        assert (
            harness.client.post(base, headers=harness.headers, json={"sources": [source]}).status_code
            == HTTPStatus.BAD_REQUEST
        )
    for body in ({"sources": ["unknown-source"]}, {"start": "2026-07-23 16:00", "end": "2026-07-23 15:00"}):
        response = harness.client.post(base, headers=harness.headers, json=body)
        assert response.status_code == HTTPStatus.BAD_REQUEST
    response = harness.client.post(f"/console/api/agent/{foreign_id}/log-exports", headers=harness.headers, json={})
    assert response.status_code == HTTPStatus.NOT_FOUND
    harness.redis.reject_submission = True
    blocked = harness.client.post(base, headers=harness.headers, json={})
    assert (blocked.status_code, blocked.get_json()["code"]) == (429, "log_export_limit_reached")
    publish.assert_called_once()

    published_arguments = publish.call_args.kwargs["kwargs"]
    with harness.client.application.app_context():
        prepare_log_export_task.run(**published_arguments)
        prepare_log_export_task.run(**published_arguments)

    ready = AgentLogExportTask.model_validate_json(harness.redis.get(task_key))
    assert ready.status is LogExportStatus.READY
    assert ready.storage_key == f"agent-log-exports/{harness.tenant_id}/{agent_id}/{task_id}/1.csv"
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
    save_from_path.assert_called_once()
    status = harness.client.get(f"{base}/{task_id}", headers=harness.headers)
    assert (status.status_code, status.json) == (
        HTTPStatus.OK,
        {
            "task_id": task_id,
            "status": "ready",
            "estimated_rows": 5,
            "progress": {"stage": "uploading", "rows_written": 2},
        },
    )
    assert status.headers["Cache-Control"] == "no-store"
    latest = harness.client.get(f"{base}/latest", headers=harness.headers)
    assert latest.status_code == HTTPStatus.OK
    assert latest.get_json()["task"]["identity_labels"] == labels
    assert latest.get_json()["task"]["estimated_rows"] == 5
    assert latest.get_json()["task"]["progress"] == status.get_json()["progress"]


def test_agent_log_export_status_scopes_tasks_and_restores_the_callers_latest_filters(harness: Harness) -> None:
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
    task_prefix = f"agent_log_export:{{{harness.tenant_id}}}:{agent_id}:"
    latest_prefix = f"agent_log_export_latest:{{{harness.tenant_id}}}:{agent_id}:"
    cache = harness.redis.cache
    cache[task_prefix + other_task.task_id] = other_task.model_dump_json()
    cache[latest_prefix + other_requester] = other_task.task_id
    path = f"/console/api/agent/{agent_id}/log-exports"

    latest = harness.client.get(f"{path}/latest", headers=harness.headers)
    assert (latest.status_code, latest.json) == (HTTPStatus.OK, {"task": None})
    cache[task_prefix + task.task_id] = task.model_dump_json(
        exclude={"filters": {"account_ids"}, "identity_labels": True}
    )
    cache[latest_prefix + harness.account_id] = task.task_id
    latest = harness.client.get(f"{path}/latest", headers=harness.headers)
    assert latest.status_code == HTTPStatus.OK
    assert latest.headers["Cache-Control"] == "no-store"
    assert latest.json == {
        "task": {
            "task_id": task.task_id,
            "status": "processing",
            "estimated_rows": None,
            "progress": None,
            "identity_labels": [],
            "expires_at": None,
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
    other_cancel = harness.client.post(f"{path}/{other_task.task_id}/cancel", headers=harness.headers)
    assert (other_cancel.status_code, other_cancel.get_json()["code"]) == (
        HTTPStatus.NOT_FOUND,
        "agent_log_export_task_not_found",
    )
    processing_cancel = harness.client.post(f"{path}/{task.task_id}/cancel", headers=harness.headers)
    assert (processing_cancel.status_code, processing_cancel.get_json()["code"]) == (
        HTTPStatus.CONFLICT,
        "log_export_task_not_cancelable",
    )

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
    task_key = f"agent_log_export:{{{harness.tenant_id}}}:{agent_id}:{task.task_id}"
    cache = harness.redis.cache
    cache[task_key] = task.model_dump_json()
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


def test_agent_composer_reads_snapshot_and_commits_only_the_shared_draft(harness: Harness) -> None:
    """Read state and candidates without creating a draft, then save only the shared draft."""
    agent_id, _ = harness.create_agent()
    snapshot_id = str(uuid4())
    with harness.sessions.begin() as session:
        agent = session.get_one(Agent, agent_id)
        agent.active_config_snapshot_id = snapshot_id
        session.add(
            AgentConfigSnapshot(
                id=snapshot_id,
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                version=1,
                config_snapshot=AgentSoulConfig.model_validate({"prompt": {"system_prompt": "published"}}),
            )
        )

    path = f"/console/api/agent/{agent_id}/composer"
    initial = harness.client.get(path, headers=harness.headers)
    assert initial.status_code == HTTPStatus.OK
    assert initial.get_json()["draft"] is None
    assert initial.get_json()["agent_soul"]["prompt"]["system_prompt"] == "published"
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)) is None

    candidates = harness.client.get(f"{path}/candidates", headers=harness.headers)
    assert candidates.status_code == HTTPStatus.OK
    assert candidates.get_json()["variant"] == "agent_app"
    assert candidates.get_json()["allowed_soul_candidates"]["knowledge_sets"] == []
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)) is None

    payload = {
        "variant": "agent_app",
        "save_strategy": "save_to_current_version",
        "agent_soul": {"prompt": {"system_prompt": "draft"}},
    }
    saved = harness.client.put(path, headers=harness.headers, json=payload)
    assert saved.status_code == HTTPStatus.OK
    assert saved.get_json()["agent_soul"]["prompt"]["system_prompt"] == "draft"
    assert saved.get_json()["draft"]["account_id"] is None
    assert saved.get_json()["validation"]["warnings"] == []
    with harness.sessions() as session:
        assert (
            session.get_one(AgentConfigDraft, saved.get_json()["draft"]["id"]).config_snapshot_dict["prompt"][
                "system_prompt"
            ]
            == "draft"
        )
        assert (
            session.get_one(AgentConfigSnapshot, snapshot_id).config_snapshot_dict["prompt"]["system_prompt"]
            == "published"
        )

    validated = harness.client.post(f"{path}/validate", headers=harness.headers, json=payload)
    assert validated.status_code == HTTPStatus.OK
    assert validated.get_json() == {
        "result": "success",
        "errors": [],
        "warnings": [],
        "knowledge_retrieval_placeholder": [],
    }


def test_agent_composer_rejects_a_foreign_agent(harness: Harness) -> None:
    """Check the existing not-found response for a real foreign-workspace Agent."""
    agent_id, _ = harness.create_agent(tenant_id=str(uuid4()))
    response = harness.client.get(f"/console/api/agent/{agent_id}/composer", headers=harness.headers)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "agent_not_found_error"


@pytest.mark.parametrize("foreign_agent", [False, True], ids=["unknown", "foreign"])
def test_agent_composer_candidates_have_no_soul_data_for_an_unavailable_agent(
    harness: Harness, foreign_agent: bool
) -> None:
    """Keep the candidate response usable without exposing an unavailable Agent's configuration."""
    agent_id = str(uuid4())
    if foreign_agent:
        tenant_id = str(uuid4())
        agent_id, _ = harness.create_agent(tenant_id=tenant_id)
        with harness.sessions.begin() as session:
            snapshot = AgentConfigSnapshot(
                tenant_id=tenant_id,
                agent_id=agent_id,
                version=1,
                config_snapshot=AgentSoulConfig.model_validate(
                    {"tools": {"cli_tools": [{"id": "foreign-tool", "name": "private"}]}}
                ),
            )
            session.add(snapshot)
            session.flush()
            session.get_one(Agent, agent_id).active_config_snapshot_id = snapshot.id

    response = harness.client.get(f"/console/api/agent/{agent_id}/composer/candidates", headers=harness.headers)

    assert response.status_code == HTTPStatus.OK
    candidates = response.get_json()["allowed_soul_candidates"]
    assert candidates["cli_tools"] == []
    assert candidates["knowledge_sets"] == []
    assert candidates["human_contacts"] == []


def test_agent_composer_can_save_incomplete_knowledge_configuration(harness: Harness) -> None:
    """Draft saves accept incomplete retrieval settings that fail Composer validation."""
    agent_id, _ = harness.create_agent()
    with harness.sessions.begin() as session:
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id, agent_id=agent_id, version=1, config_snapshot=AgentSoulConfig()
        )
        session.add(snapshot)
        session.flush()
        session.get_one(Agent, agent_id).active_config_snapshot_id = snapshot.id

    path = f"/console/api/agent/{agent_id}/composer"
    knowledge_set = {
        "id": "support",
        "name": "Support KB",
        "datasets": [{"id": "not-a-uuid"}],
        "query": {"mode": "generated_query"},
        "retrieval": {"mode": "single"},
        "metadata_filtering": {"mode": "automatic"},
    }
    payload = {
        "variant": "agent_app",
        "save_strategy": "save_to_current_version",
        "agent_soul": {"knowledge": {"sets": [knowledge_set]}},
    }

    saved = harness.client.put(path, headers=harness.headers, json=payload)
    assert saved.status_code == HTTPStatus.OK
    with harness.sessions() as session:
        draft = session.get_one(AgentConfigDraft, saved.get_json()["draft"]["id"])
        [saved_set] = draft.config_snapshot.knowledge.sets
        assert saved_set.id == "support"
        assert saved_set.retrieval.mode == "single"
        assert saved_set.retrieval.model is None
        assert saved_set.metadata_filtering.mode == "automatic"
        assert saved_set.metadata_filtering.metadata_model_config is None

    validated = harness.client.post(f"{path}/validate", headers=harness.headers, json=payload)
    assert validated.status_code == HTTPStatus.BAD_REQUEST
    assert validated.get_json()["code"] == "invalid_composer_config_error"


@pytest.mark.parametrize("operation", ["publish", "copy"])
@pytest.mark.parametrize(
    ("source_exists", "error_code"),
    [
        pytest.param(False, "agent_not_found_error", id="missing-agent"),
        pytest.param(True, "agent_version_not_found_error", id="missing-snapshot"),
    ],
)
def test_publish_and_copy_distinguish_missing_agent_and_snapshot(
    harness: Harness, operation: str, source_exists: bool, error_code: str
) -> None:
    """Return the error code for the missing resource through the admitted Console route."""
    agent_id = harness.create_agent()[0] if source_exists else str(uuid4())

    response = harness.client.post(f"/console/api/agent/{agent_id}/{operation}", headers=harness.headers, json={})

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == error_code


def test_copy_with_duplicate_agent_name_rolls_back_target_app(harness: Harness) -> None:
    """Copying under an occupied roster name returns a conflict and rolls back the new App."""
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        agent = session.get_one(Agent, agent_id)
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id,
            agent_id=agent_id,
            version=1,
            config_snapshot=AgentSoulConfig(),
        )
        session.add(snapshot)
        agent.active_config_snapshot_id = snapshot.id
        occupied_name = agent.name

    response = harness.client.post(
        f"/console/api/agent/{agent_id}/copy", headers=harness.headers, json={"name": occupied_name}
    )

    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "agent_name_conflict_error"
    with harness.sessions() as session:
        assert session.scalars(select(App.id).where(App.tenant_id == harness.tenant_id)).all() == [app_id]
        assert session.scalars(select(Agent.id).where(Agent.tenant_id == harness.tenant_id)).all() == [agent_id]


def test_publish_and_copy_keep_the_source_and_target_publication_histories_separate(harness: Harness) -> None:
    """Exercise real publishing, republishing, and copying through the production resources."""
    agent_id, app_id = harness.create_agent()
    model = AgentSoulModelConfig(
        plugin_id="langgenius/openai", model_provider="langgenius/openai/openai", model="gpt-4o"
    )
    file_upload = {"image": {"enabled": True, "number_limits": 2, "transfer_methods": ["local_file"]}}
    tracing = json.dumps({"enabled": True, "tracing_provider": "langfuse"})
    with harness.sessions.begin() as session:
        agent = session.get_one(Agent, agent_id)
        source_app = session.get_one(App, app_id)
        source_config = AppModelConfig(
            app_id=app_id,
            opening_statement="Welcome to the source Agent",
            file_upload=json.dumps(file_upload),
        )
        session.add(source_config)
        source_config_id = source_config.id
        source_app.app_model_config_id = source_config_id
        source_app.use_icon_as_answer_icon = True
        source_app.tracing = tracing
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id, agent_id=agent_id, version=1, config_snapshot=AgentSoulConfig(model=model)
        )
        skill_id = str(uuid4())
        session.add(AgentSkillBinding(tenant_id=harness.tenant_id, agent_id=agent_id, skill_id=skill_id, priority=0))
        session.add(snapshot)
        agent.active_config_snapshot_id = snapshot.id

    path = f"/console/api/agent/{agent_id}"
    first = harness.client.post(f"{path}/publish", json={"version_note": "initial release"}, headers=harness.headers)
    assert first.status_code == HTTPStatus.OK, first.get_json()
    first_body = first.get_json()
    assert first_body["publication_kind"] == "first"
    assert first_body["draft"]["base_snapshot_id"] == first_body["active_config_snapshot_id"]
    with harness.sessions.begin() as session:
        source_app = session.get_one(App, app_id)
        assert source_app.enable_site
        assert source_app.enable_api
        source_app.enable_site = False

    second = harness.client.post(f"{path}/publish", json={"version_note": "follow-up"}, headers=harness.headers)
    assert second.status_code == HTTPStatus.OK, second.get_json()
    assert second.get_json()["publication_kind"] == "update"

    copied = harness.client.post(f"{path}/copy", json={}, headers=harness.headers)
    assert copied.status_code == HTTPStatus.CREATED, copied.get_json()
    result = copied.get_json()
    assert result["name"] == "Agent App copy"
    assert result["debug_conversation_id"]
    assert result["access_ready"] is False
    with harness.sessions() as session:
        assert session.get_one(App, app_id).enable_site is False
        target = session.get_one(Agent, result["id"])
        target_app = session.get_one(App, result["app_id"])
        assert target.app_id == target_app.id
        assert not target_app.enable_api
        assert not target_app.enable_site
        assert target_app.use_icon_as_answer_icon is True
        assert target_app.tracing == tracing
        assert target_app.app_model_config_id is not None
        assert target_app.app_model_config_id != source_config_id
        target_config = session.get_one(AppModelConfig, target_app.app_model_config_id)
        assert target_config.app_id == target_app.id
        assert target_config.opening_statement == "Welcome to the source Agent"
        assert target_config.file_upload_dict == file_upload
        assert not target.active_config_is_published
        assert target.active_config_snapshot_id is not None
        target_snapshot = session.get_one(AgentConfigSnapshot, target.active_config_snapshot_id)
        assert target_snapshot.version == 1
        assert target_snapshot.config_snapshot_dict["model"]["model"] == model.model
        assert target_snapshot.version_note == "follow-up"
        bindings = session.scalars(select(AgentSkillBinding).where(AgentSkillBinding.agent_id == target.id))
        assert [binding.skill_id for binding in bindings] == [skill_id]
        snapshot_bindings = session.scalars(
            select(AgentSkillBindingSnapshot).where(
                AgentSkillBindingSnapshot.config_snapshot_id == second.get_json()["active_config_snapshot_id"]
            )
        )
        assert [binding.skill_id for binding in snapshot_bindings] == [skill_id]


def test_publish_with_no_model_does_not_create_a_draft_or_enable_access(harness: Harness) -> None:
    """Reject an unpublishable Soul before making any publication writes."""
    agent_id, app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id, agent_id=agent_id, version=1, config_snapshot=AgentSoulConfig()
        )
        session.add(snapshot)
        session.get_one(Agent, agent_id).active_config_snapshot_id = snapshot.id

    response = harness.client.post(f"/console/api/agent/{agent_id}/publish", json={}, headers=harness.headers)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "agent_model_not_configured"
    with harness.sessions() as session:
        app = session.get_one(App, app_id)
        assert not app.enable_site
        assert not app.enable_api
        assert session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)) is None


@pytest.mark.parametrize("retired_home", [False, True], ids=["committed", "rolled-back"])
def test_publication_commits_knowledge_binding_with_the_snapshot(harness: Harness, retired_home: bool) -> None:
    """Publish through Console and roll back the flushed KnowledgeFS binding when the Home is retired."""
    agent_id, app_id = harness.create_agent()
    skill_id = str(uuid4())
    watermark: KnowledgeFSCutoverRevisionWatermark = {
        "membership_epoch": 1,
        "space_acl_epoch": 1,
        "external_access_epoch": 1,
        "content_policy_revision": 1,
    }
    now = naive_utc_now()
    with harness.sessions.begin() as session:
        session.add(
            KnowledgeFSWorkspaceCutoverLedger(
                tenant_id=harness.tenant_id,
                source_revision_watermark=watermark,
                applied_revision_watermark=watermark,
                phase=KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
                freeze_at=now,
                cutover_at=now,
                product_routes_enabled=True,
                capability_v2_enabled=True,
                integrated_mode_enabled=True,
                legacy_acl_read_only=True,
            )
        )
        space = KnowledgeFSControlSpace(
            tenant_id=harness.tenant_id,
            owner_account_id=harness.account_id,
            provisioning_key=str(uuid4()),
            knowledge_space_id=str(uuid4()),
            state=KnowledgeFSControlSpaceState.ACTIVE,
        )
        home = AgentHomeSnapshot(
            tenant_id=harness.tenant_id,
            agent_id=agent_id,
            snapshot_ref="home",
            status=AgentWorkingResourceStatus.RETIRED if retired_home else AgentWorkingResourceStatus.ACTIVE,
        )
        session.add_all([space, home])
        session.flush()
        space_id = space.id
        soul = AgentSoulConfig.model_validate(
            {
                "model": {
                    "plugin_id": "langgenius/openai",
                    "model_provider": "langgenius/openai/openai",
                    "model": "gpt-4o",
                },
                "knowledge": {"spaces": [{"id": "docs", "name": "Docs", "control_space_id": space_id}]},
            }
        )
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id,
            agent_id=agent_id,
            version=1,
            home_snapshot_id=home.id,
            config_snapshot=soul,
        )
        session.add_all(
            [
                snapshot,
                KnowledgeFSAuthorizationRevision(tenant_id=harness.tenant_id, control_space_id=space_id),
                AgentSkillBinding(tenant_id=harness.tenant_id, agent_id=agent_id, skill_id=skill_id, priority=0),
            ]
        )
        snapshot_id = snapshot.id
        session.get_one(Agent, agent_id).active_config_snapshot_id = snapshot_id

    staged_space_ids: list[str] = []

    def record_binding_insert(_mapper: object, _connection: object, binding: AppKnowledgeFSSpaceJoin) -> None:
        """Observe the SQL flush so a rollback assertion cannot pass if binding staging was skipped."""
        staged_space_ids.append(binding.control_space_id)

    event.listen(AppKnowledgeFSSpaceJoin, "after_insert", record_binding_insert)
    try:
        with config_overrides_context(
            KNOWLEDGE_FS_BASE_URL="https://knowledge-fs.example.test", KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=False
        ):
            response = harness.client.post(f"/console/api/agent/{agent_id}/publish", json={}, headers=harness.headers)
    finally:
        event.remove(AppKnowledgeFSSpaceJoin, "after_insert", record_binding_insert)

    assert staged_space_ids == [space_id]
    if retired_home:
        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert response.get_json() == {
            "code": "invalid_composer_config_error",
            "status": HTTPStatus.BAD_REQUEST,
            "message": "The Agent draft Home snapshot is unavailable.",
        }
    else:
        assert response.status_code == HTTPStatus.OK, response.get_json()
        assert response.get_json()["publication_kind"] == "first"
    with harness.sessions() as session:
        agent = session.get_one(Agent, agent_id)
        app = session.get_one(App, app_id)
        expected_published = not retired_home
        assert agent.active_config_is_published is expected_published
        assert agent.active_config_has_model is expected_published
        assert app.enable_site is expected_published
        assert app.enable_api is expected_published
        bindings = session.scalars(
            select(AppKnowledgeFSSpaceJoin).where(AppKnowledgeFSSpaceJoin.app_id == app_id)
        ).all()
        snapshots = session.scalars(
            select(AgentConfigSnapshot)
            .where(AgentConfigSnapshot.agent_id == agent_id)
            .order_by(AgentConfigSnapshot.version)
        ).all()
        revisions = session.scalars(select(AgentConfigRevision).where(AgentConfigRevision.agent_id == agent_id)).all()
        skill_snapshots = session.scalars(
            select(AgentSkillBindingSnapshot).where(AgentSkillBindingSnapshot.agent_id == agent_id)
        ).all()
        draft = session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id))
        if retired_home:
            assert agent.active_config_snapshot_id == snapshot_id
            assert [snapshot.id for snapshot in snapshots] == [snapshot_id]
            assert bindings == []
            assert revisions == []
            assert skill_snapshots == []
            assert draft is None
        else:
            [binding] = bindings
            assert binding.control_space_id == space_id
            assert binding.join_type == KnowledgeFSAppSpaceJoinType.AGENT
            [_, published_snapshot] = snapshots
            assert agent.active_config_snapshot_id == published_snapshot.id
            assert published_snapshot.config_snapshot_dict["knowledge"]["spaces"][0]["control_space_id"] == space_id
            [revision] = revisions
            assert revision.current_snapshot_id == published_snapshot.id
            [skill_snapshot] = skill_snapshots
            assert skill_snapshot.skill_id == skill_id
            assert skill_snapshot.config_snapshot_id == published_snapshot.id
            assert draft is not None
            assert draft.base_snapshot_id == published_snapshot.id


@pytest.mark.parametrize(
    ("join_type", "base_url", "expected_status"),
    [
        (KnowledgeFSAppSpaceJoinType.AGENT, "https://knowledge-fs.example.test", KnowledgeFSAppSpaceJoinStatus.REVOKED),
        (KnowledgeFSAppSpaceJoinType.WORKFLOW, None, KnowledgeFSAppSpaceJoinStatus.ACTIVE),
    ],
    ids=["revoke-agent-binding", "skip-unconfigured-knowledge-fs"],
)
def test_publication_with_no_spaces_only_clears_agent_bindings(
    harness: Harness,
    join_type: KnowledgeFSAppSpaceJoinType,
    base_url: str | None,
    expected_status: KnowledgeFSAppSpaceJoinStatus,
) -> None:
    """Publish an empty space list and reconcile existing bindings for the Agent channel only."""
    agent_id, app_id = harness.create_agent()
    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai", model_provider="langgenius/openai/openai", model="gpt-4o"
        )
    )
    with harness.sessions.begin() as session:
        space = KnowledgeFSControlSpace(
            tenant_id=harness.tenant_id,
            owner_account_id=harness.account_id,
            provisioning_key=str(uuid4()),
            knowledge_space_id=str(uuid4()),
            state=KnowledgeFSControlSpaceState.ACTIVE,
        )
        session.add(space)
        session.flush()
        binding = AppKnowledgeFSSpaceJoin(
            tenant_id=harness.tenant_id, app_id=app_id, control_space_id=space.id, join_type=join_type
        )
        session.add_all(
            [
                binding,
                KnowledgeFSAuthorizationRevision(tenant_id=harness.tenant_id, control_space_id=space.id),
                AgentConfigDraft(
                    tenant_id=harness.tenant_id,
                    agent_id=agent_id,
                    draft_type=AgentConfigDraftType.DRAFT,
                    config_snapshot=soul,
                ),
            ]
        )
        binding_id = binding.id

    with config_overrides_context(KNOWLEDGE_FS_BASE_URL=base_url, KNOWLEDGE_FS_CAPABILITY_V2_ENABLED=False):
        response = harness.client.post(f"/console/api/agent/{agent_id}/publish", json={}, headers=harness.headers)
    assert response.status_code == HTTPStatus.OK, response.get_json()
    with harness.sessions() as session:
        assert session.get_one(AppKnowledgeFSSpaceJoin, binding_id).status is expected_status
        snapshot = session.get_one(AgentConfigSnapshot, response.get_json()["active_config_snapshot_id"])
        assert snapshot.config_snapshot_dict["knowledge"]["spaces"] == []


def test_publication_rejects_a_draft_changed_after_preparation(harness: Harness) -> None:
    """Return the public conflict error when a save completes during publication authorization."""
    agent_id, _ = harness.create_agent()
    soul = AgentSoulConfig(
        model=AgentSoulModelConfig(
            plugin_id="langgenius/openai", model_provider="langgenius/openai/openai", model="gpt-4o"
        )
    )
    with harness.sessions.begin() as session:
        draft = AgentConfigDraft(
            tenant_id=harness.tenant_id,
            agent_id=agent_id,
            draft_type=AgentConfigDraftType.DRAFT,
            config_snapshot=soul,
        )
        session.add(draft)
        session.flush()
        draft_id = draft.id

    def authorize_with_concurrent_save(*, tenant_id: str, account_id: str, soul: AgentSoulConfig) -> None:
        """Commit another writer's change after the publication read and before writeback."""
        authorize_composer_knowledge(
            session_factory=harness.sessions, tenant_id=tenant_id, account_id=account_id, soul=soul
        )
        with harness.sessions.begin() as session:
            latest = session.get_one(AgentConfigDraft, draft_id)
            updated_soul = soul.model_copy(deep=True)
            updated_soul.prompt.system_prompt = "newer edit"
            latest.config_snapshot = updated_soul

    app = harness.client.application
    with app.app_context():
        services = application_services()
    composer = AgentAppComposer(
        store=AgentAppRepository(
            session_factory=harness.sessions, stage_evaluation_cleanup=EvaluationService.stage_target_evaluation_cleanup
        ),
        authorize_knowledge=partial(authorize_composer_knowledge, session_factory=harness.sessions),
        workspace_tools=list_workspace_dify_tools,
        authorize_publication_bindings=authorize_with_concurrent_save,
    )
    app.extensions["application_services"] = replace(
        services, agent_apps=replace(services.agent_apps, composer=composer)
    )
    try:
        response = harness.client.post(f"/console/api/agent/{agent_id}/publish", json={}, headers=harness.headers)
    finally:
        app.extensions["application_services"] = services
    assert response.status_code == HTTPStatus.CONFLICT
    assert response.get_json()["code"] == "agent_version_conflict_error"
    with harness.sessions() as session:
        assert session.get_one(Agent, agent_id).active_config_snapshot_id is None
        assert (
            session.get_one(AgentConfigDraft, draft_id).config_snapshot_dict["prompt"]["system_prompt"] == "newer edit"
        )


def test_agent_copy_requires_workspace_create_even_for_source_owner(harness: Harness, rbac_domain: RBACDomain) -> None:
    """Owning the source Agent does not grant workspace permission to create an Agent."""
    agent_id, _ = harness.create_agent()
    rbac_domain.transport.response = {"allowed": False}
    with config_overrides_context(RBAC_ENABLED=True):
        result = harness.client.post(f"/console/api/agent/{agent_id}/copy", headers=harness.headers, json={})
    assert result.status_code == HTTPStatus.FORBIDDEN
    request_data = rbac_domain.transport.only_request.json
    assert request_data is not None
    assert request_data["scene"] == "agent_create"


@pytest.mark.parametrize(
    ("read_status", "expected_mode"),
    [(HTTPStatus.OK, "private"), (HTTPStatus.NOT_FOUND, "public")],
    ids=["inherit-private", "fallback-public"],
)
def test_agent_copy_inherits_enterprise_webapp_access(
    harness: Harness, read_status: HTTPStatus, expected_mode: str
) -> None:
    """Inherit a readable source mode, or use public when Enterprise cannot read the source."""
    agent_id, source_app_id = harness.create_agent()
    with harness.sessions.begin() as session:
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id, agent_id=agent_id, version=1, config_snapshot=AgentSoulConfig()
        )
        session.add(snapshot)
        session.get_one(Agent, agent_id).active_config_snapshot_id = snapshot.id

    reads: list[str] = []
    updates: list[dict[str, str]] = []
    modes: dict[str, str] = {}
    source_settings: dict[str, object] = (
        {"accessMode": "private"} if read_status == HTTPStatus.OK else {"message": "Missing app settings"}
    )

    class EnterpriseHandler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            """Serve the active license and the source or copied App's access mode."""
            request = urlsplit(self.path)
            if request.path == "/info":
                self._respond(HTTPStatus.OK, {"License": {"status": "active"}})
                return
            if request.path != "/webapp/access-mode/id":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            [app_id] = parse_qs(request.query)["appId"]
            reads.append(app_id)
            if app_id == source_app_id:
                self._respond(read_status, source_settings)
            else:
                self._respond(HTTPStatus.OK, {"accessMode": modes[app_id]})

        def do_POST(self) -> None:
            """Record the requested Web App mode and acknowledge the write."""
            if self.path != "/webapp/access-mode":
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            data: dict[str, str] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            updates.append(data)
            modes[data["appId"]] = data["accessMode"]
            self._respond(HTTPStatus.OK, {"result": True})

        def _respond(self, status: HTTPStatus, payload: dict[str, object]) -> None:
            """Send an Enterprise JSON response over the test connection."""
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    with ThreadingHTTPServer(("127.0.0.1", 0), EnterpriseHandler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        previous_url = EnterpriseRequest.base_url
        EnterpriseRequest.base_url = f"http://127.0.0.1:{server.server_port}"
        EnterpriseService.get_info.cache_clear()
        try:
            with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE):
                response = harness.client.post(f"/console/api/agent/{agent_id}/copy", headers=harness.headers, json={})
                assert response.status_code == HTTPStatus.CREATED, response.get_json()
                copied = response.get_json()
                detail = harness.client.get(f"/console/api/agent/{copied['id']}", headers=harness.headers)
        finally:
            EnterpriseService.get_info.cache_clear()
            EnterpriseRequest.base_url = previous_url
            server.shutdown()
            thread.join()

    assert detail.status_code == HTTPStatus.OK, detail.get_json()
    assert copied["access_mode"] == detail.get_json()["access_mode"] == expected_mode
    assert copied["permission_keys"]
    assert copied["permission_keys"] == detail.get_json()["permission_keys"]
    target_id = copied["app_id"]
    assert reads == [source_app_id, target_id, target_id]
    assert updates == [
        {"appId": target_id, "accessMode": "private"},
        {"appId": target_id, "accessMode": expected_mode},
    ]
