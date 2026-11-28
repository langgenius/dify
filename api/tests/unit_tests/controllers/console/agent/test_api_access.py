"""Exercise Agent Console routes with real admission and persistence."""

import json
from collections.abc import Iterator, Mapping
from csv import DictReader
from dataclasses import dataclass, field, replace
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
from flask import Blueprint, Flask, request
from flask.testing import FlaskClient
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.serving import make_server
from werkzeug.test import TestResponse
from yarl import URL

from constants import COOKIE_NAME_ACCESS_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.agent import roster as roster_controller
from controllers.console.agent.api_access import AgentApiAccessApi, AgentApiStatusApi
from controllers.console.agent.build_session import (
    AgentBuildDraftApi,
    AgentBuildDraftApplyApi,
    AgentBuildDraftCheckoutApi,
    AgentDebugConversationRefreshApi,
)
from controllers.console.agent.composer import (
    AgentComposerApi,
    AgentComposerCandidatesApi,
    AgentComposerValidateApi,
    SnippetAgentComposerApi,
    SnippetAgentComposerCandidatesApi,
    SnippetAgentComposerCopyFromRosterApi,
    SnippetAgentComposerImpactApi,
    SnippetAgentComposerSaveToRosterApi,
    SnippetAgentComposerValidateApi,
    WorkflowAgentComposerApi,
    WorkflowAgentComposerCandidatesApi,
    WorkflowAgentComposerCopyFromRosterApi,
    WorkflowAgentComposerImpactApi,
    WorkflowAgentComposerSaveToRosterApi,
    WorkflowAgentComposerValidateApi,
)
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
from controllers.console.app.agent_config_inspector import (
    AgentConfigFilesUploadApi,
    AgentConfigFilesUploadByAgentApi,
    AgentConfigManifestApi,
    AgentConfigManifestByAgentApi,
    AgentConfigSkillFileDownloadByAgentApi,
)
from controllers.console.app.audio import AgentChatMessageAudioApi, AgentChatMessageTextApi, AgentTextToSpeechVoicesApi
from controllers.console.app.completion import (
    _BUILD_CHAT_FINALIZATION_QUERY,
    AgentBuildChatFinalizeApi,
    AgentChatMessageApi,
    AgentChatMessageStopApi,
)
from controllers.console.app.message import AgentChatMessageListApi
from controllers.console.wraps import _is_setup_completed
from core.app.entities.app_invoke_entities import InvokeFrom
from core.plugin.impl import base as plugin_http
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
    AgentDebugConversation,
    AgentHomeSnapshot,
    AgentScope,
    AgentSource,
    AgentWorkingResourceStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.agent_config_entities import AgentSoulConfig, AgentSoulModelConfig, WorkflowNodeJobConfig
from models.engine import db
from models.enums import ApiTokenType, ConversationFromSource, CreatorUserRole
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
from models.model import ApiToken, App, AppMode, AppModelConfig, Conversation, UploadFile
from models.skill import AgentSkillBinding, AgentSkillBindingSnapshot
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowType
from repositories.agent.agent_app_repository import AgentAppRepository
from services.agent.app_composer import AgentAppComposer
from services.agent.composer_tools import list_workspace_dify_tools
from services.agent.console_runtime import AgentConsoleRuntime
from services.agent.knowledge_spaces import authorize_composer_knowledge
from services.agent.observability_contracts import AgentLogExportFilters
from services.app_task_service import AppTaskControlService
from services.enterprise.base import EnterpriseRequest
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.app_entities import AppEvent
from services.evaluation_service import EvaluationService
from services.feature_service import FeatureService
from services.retention.agent.log_export_service import AgentLogExportTask
from services.retention.log_export_task import LogExportStatus
from tasks.log_export_tasks import prepare_log_export_task
from tests.helpers.unit.config_override import config_overrides_context
from tests.helpers.unit.log_export_fixtures import LogExportRedisIo, LogExportStorageIo
from tests.helpers.unit.model_factories import (
    make_app,
    make_conversation,
    make_end_user,
    make_message,
    make_upload_file,
    make_workflow,
)
from tests.helpers.unit.rbac_fakes import RBACDomain
from tests.unit_tests.services.test_app_task_service import _AppTaskServiceStopredis as _StopRedis


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
        workflow_composer = "/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer"
        snippet_composer = "/snippets/<uuid:snippet_id>/workflows/draft/nodes/<string:node_id>/agent-composer"
        api.add_resource(WorkflowAgentComposerApi, workflow_composer)
        api.add_resource(WorkflowAgentComposerImpactApi, f"{workflow_composer}/impact")
        api.add_resource(WorkflowAgentComposerCopyFromRosterApi, f"{workflow_composer}/copy-from-roster")
        api.add_resource(WorkflowAgentComposerValidateApi, f"{workflow_composer}/validate")
        api.add_resource(WorkflowAgentComposerCandidatesApi, f"{workflow_composer}/candidates")
        api.add_resource(WorkflowAgentComposerSaveToRosterApi, f"{workflow_composer}/save-to-roster")
        api.add_resource(SnippetAgentComposerApi, snippet_composer)
        api.add_resource(SnippetAgentComposerImpactApi, f"{snippet_composer}/impact")
        api.add_resource(SnippetAgentComposerCopyFromRosterApi, f"{snippet_composer}/copy-from-roster")
        api.add_resource(SnippetAgentComposerValidateApi, f"{snippet_composer}/validate")
        api.add_resource(SnippetAgentComposerCandidatesApi, f"{snippet_composer}/candidates")
        api.add_resource(SnippetAgentComposerSaveToRosterApi, f"{snippet_composer}/save-to-roster")
        api.add_resource(AgentConfigManifestApi, "/apps/<uuid:app_id>/agent/config/manifest")
        api.add_resource(AgentConfigFilesUploadApi, "/apps/<uuid:app_id>/agent/config/files/batch")
        api.add_resource(AgentConfigManifestByAgentApi, "/agent/<uuid:agent_id>/config/manifest")
        api.add_resource(AgentConfigFilesUploadByAgentApi, "/agent/<uuid:agent_id>/config/files/batch")
        api.add_resource(
            AgentConfigSkillFileDownloadByAgentApi, "/agent/<uuid:agent_id>/config/skills/<string:name>/files/download"
        )
        api.add_resource(AgentChatMessageApi, "/agent/<uuid:agent_id>/chat-messages")
        api.add_resource(AgentBuildChatFinalizeApi, "/agent/<uuid:agent_id>/build-chat/finalize")
        api.add_resource(AgentChatMessageStopApi, "/agent/<uuid:agent_id>/chat-messages/<string:task_id>/stop")
        api.add_resource(AgentChatMessageAudioApi, "/agent/<uuid:agent_id>/audio-to-text")
        api.add_resource(AgentChatMessageTextApi, "/agent/<uuid:agent_id>/text-to-audio")
        api.add_resource(AgentTextToSpeechVoicesApi, "/agent/<uuid:agent_id>/text-to-audio/voices")
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
        api.add_resource(AgentChatMessageListApi, "/agent/<uuid:agent_id>/chat-messages")
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


@dataclass(frozen=True)
class NodeComposerTarget:
    surface: str
    path: str
    app_id: str
    workflow_id: str


@pytest.fixture(params=["workflow", "snippet"])
def node_composer_target(harness: Harness, request: pytest.FixtureRequest) -> NodeComposerTarget:
    """Persist a tenant-owned Workflow or Snippet and its editable draft."""
    surface: str = request.param
    with harness.sessions.begin() as session:
        if surface == "workflow":
            app = App(
                tenant_id=harness.tenant_id,
                name="Workflow",
                mode=AppMode.WORKFLOW,
                created_by=harness.account_id,
                enable_site=False,
                enable_api=False,
            )
            session.add(app)
            session.flush()
            app_id, workflow_type = app.id, WorkflowType.WORKFLOW
        else:
            snippet = CustomizedSnippet(tenant_id=harness.tenant_id, name="Snippet", type=SnippetType.NODE)
            session.add(snippet)
            session.flush()
            app_id, workflow_type = snippet.id, WorkflowType.SNIPPET
        workflow = Workflow.new(
            tenant_id=harness.tenant_id,
            app_id=app_id,
            type=workflow_type,
            version=Workflow.VERSION_DRAFT,
            graph='{"nodes": [], "edges": []}',
            features="{}",
            created_by=harness.account_id,
            environment_variables=[],
            conversation_variables=[],
            rag_pipeline_variables=[],
        )
        session.add(workflow)
        workflow_id = workflow.id
    prefix = "apps" if surface == "workflow" else "snippets"
    path = f"/console/api/{prefix}/{app_id}/workflows/draft/nodes/node-1/agent-composer"
    return NodeComposerTarget(surface, path, app_id, workflow_id)


@dataclass
class ComposerBackends:
    allowed_scenes: set[str] = field(default_factory=set)
    permission_checks: list[dict[str, str]] = field(default_factory=list)
    tool_tenants: list[str] = field(default_factory=list)


@pytest.fixture
def composer_backends() -> Iterator[ComposerBackends]:
    """Serve RBAC decisions and an empty plugin installation over loopback HTTP."""
    backends = ComposerBackends()
    app = Flask(__name__)

    @app.post("/rbac/check-access")
    def check_access() -> dict[str, bool]:
        """Record the authorization request and allow only the configured scenes."""
        payload: dict[str, str] = request.get_json()
        backends.permission_checks.append(payload)
        return {"allowed": payload["scene"] in backends.allowed_scenes}

    @app.get("/plugin/<_tenant_id>/management/models")
    def list_models(_tenant_id: str) -> dict[str, object]:
        """Return an empty model catalog for built-in tool discovery."""
        return {"code": 0, "message": "success", "data": []}

    @app.get("/plugin/<tenant_id>/management/tools")
    def list_tools(tenant_id: str) -> dict[str, object]:
        """Return no installed tool providers and record the requested tenant."""
        backends.tool_tenants.append(tenant_id)
        return {"code": 0, "message": "success", "data": []}

    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    previous_rbac_url = EnterpriseRequest.rbac_base_url
    previous_plugin_url = plugin_http.plugin_daemon_inner_api_baseurl
    EnterpriseRequest.rbac_base_url = base_url
    plugin_http.plugin_daemon_inner_api_baseurl = URL(base_url)
    try:
        yield backends
    finally:
        EnterpriseRequest.rbac_base_url = previous_rbac_url
        plugin_http.plugin_daemon_inner_api_baseurl = previous_plugin_url
        server.shutdown()
        thread.join()
        server.server_close()


def test_node_composer_resolves_only_the_current_workspace(
    harness: Harness, node_composer_target: NodeComposerTarget
) -> None:
    """Read, save and calculate impact through the routes using tenant-scoped draft data."""
    surface, path, app_id = node_composer_target.surface, node_composer_target.path, node_composer_target.app_id
    state = harness.client.get(path, headers=harness.headers)
    assert state.status_code == HTTPStatus.OK, state.get_json()
    assert state.get_json()["variant"] == "workflow"
    assert state.get_json()["binding"] is None
    assert state.get_json()["app_id"] == app_id
    impact = harness.client.post(
        f"{path}/impact",
        headers=harness.headers,
        json={
            "variant": "workflow",
            "save_strategy": "node_job_only",
        },
    )
    assert impact.status_code == HTTPStatus.OK
    assert impact.get_json() == {"current_snapshot_id": None, "workflow_node_count": 0, "bindings": []}
    saved = harness.client.put(
        path,
        headers=harness.headers,
        json={
            "variant": "workflow",
            "save_strategy": "node_job_only",
            "node_job": {"workflow_prompt": "Run this step"},
        },
    )
    assert saved.status_code == HTTPStatus.OK, saved.get_json()
    saved_state = saved.get_json()
    assert saved_state["node_job"]["workflow_prompt"] == "Run this step"
    with harness.sessions.begin() as session:
        binding = session.get_one(WorkflowAgentNodeBinding, saved_state["binding"]["id"])
        assert binding.tenant_id == harness.tenant_id
        assert binding.app_id == app_id
        assert binding.node_id == "node-1"
        snapshot_id = binding.current_snapshot_id
        assert snapshot_id is not None
        expected_impact = {
            "current_snapshot_id": snapshot_id,
            "workflow_node_count": 1,
            "bindings": [{"app_id": app_id, "workflow_id": binding.workflow_id, "node_id": "node-1"}],
        }
        session.add(
            WorkflowAgentNodeBinding(
                tenant_id=str(uuid4()),
                app_id=str(uuid4()),
                workflow_id=str(uuid4()),
                workflow_version=Workflow.VERSION_DRAFT,
                node_id="foreign-node",
                binding_type=binding.binding_type,
                current_snapshot_id=snapshot_id,
                node_job_config=binding.node_job_config,
            )
        )
    assert saved_state["impact_summary"] == expected_impact
    impact = harness.client.post(
        f"{path}/impact",
        headers=harness.headers,
        json={
            "variant": "workflow",
            "save_strategy": "node_job_only",
            "binding": {"binding_type": "inline_agent", "current_snapshot_id": snapshot_id},
        },
    )
    assert impact.status_code == HTTPStatus.OK, impact.get_json()
    assert impact.get_json() == expected_impact

    with harness.sessions.begin() as session:
        if surface == "workflow":
            session.get_one(App, app_id).tenant_id = str(uuid4())
        else:
            session.get_one(CustomizedSnippet, app_id).tenant_id = str(uuid4())
    unavailable = harness.client.get(path, headers=harness.headers)
    assert unavailable.status_code == HTTPStatus.NOT_FOUND
    assert unavailable.get_json()["code"] == ("app_not_found" if surface == "workflow" else "not_found")


def test_node_composer_checks_edit_and_roster_create_permissions(
    harness: Harness, node_composer_target: NodeComposerTarget, composer_backends: ComposerBackends
) -> None:
    """Reject denied writes on both surfaces before creating any Agent or node binding."""
    target = node_composer_target
    workspace_check = {"tenant_id": harness.tenant_id, "account_id": harness.account_id}
    if target.surface == "workflow":
        edit_scene = "app_edit"
        edit_check = {**workspace_check, "scene": edit_scene, "resource_type": "app", "resource_id": target.app_id}
    else:
        edit_scene = "snippets_create_and_modify"
        edit_check = {**workspace_check, "scene": edit_scene}
    create_check = {**workspace_check, "scene": "agent_create"}
    save_payload = {"variant": "workflow", "save_strategy": "node_job_only", "node_job": {"workflow_prompt": "Run"}}
    roster_payload = {"variant": "workflow", "save_strategy": "save_to_roster", "new_agent_name": "New roster Agent"}
    roster_path = f"{target.path}/save-to-roster"

    with config_overrides_context(RBAC_ENABLED=True):
        composer_backends.allowed_scenes = {"agent_create"}
        no_edit = harness.client.put(target.path, json=save_payload, headers=harness.headers)
        copy_no_edit = harness.client.post(
            f"{target.path}/copy-from-roster", json={"source_agent_id": str(uuid4())}, headers=harness.headers
        )
        roster_no_edit = harness.client.post(roster_path, json=roster_payload, headers=harness.headers)
        composer_backends.allowed_scenes = {edit_scene}
        roster_no_create = harness.client.post(roster_path, json=roster_payload, headers=harness.headers)

    for denied in (no_edit, copy_no_edit, roster_no_edit, roster_no_create):
        assert denied.status_code == HTTPStatus.FORBIDDEN, denied.get_json()
        assert denied.get_json()["code"] == "forbidden"
    assert composer_backends.permission_checks == [edit_check, edit_check, edit_check, edit_check, create_check]
    with harness.sessions() as session:
        assert session.scalar(select(WorkflowAgentNodeBinding.id)) is None
        assert session.scalar(select(AgentConfigSnapshot.id)) is None
        assert session.scalar(select(Agent.id)) is None


def test_node_composer_get_commits_and_reuses_inline_debug_conversation(
    harness: Harness, node_composer_target: NodeComposerTarget
) -> None:
    """Persist the current editor's Build conversation on first GET and reuse it on repeated GET."""
    target = node_composer_target
    with harness.sessions.begin() as session:
        backing_app = App(
            tenant_id=harness.tenant_id,
            name="Inline Agent runtime",
            mode=AppMode.AGENT,
            enable_api=False,
            enable_site=False,
        )
        agent = Agent(
            tenant_id=harness.tenant_id,
            name="Inline Agent",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            app_id=target.app_id,
            backing_app_id=backing_app.id,
            workflow_id=target.workflow_id,
            workflow_node_id="node-1",
        )
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id, agent_id=agent.id, version=1, config_snapshot=AgentSoulConfig()
        )
        agent.active_config_snapshot_id = snapshot.id
        session.add_all(
            [
                backing_app,
                agent,
                snapshot,
                WorkflowAgentNodeBinding(
                    tenant_id=harness.tenant_id,
                    app_id=target.app_id,
                    workflow_id=target.workflow_id,
                    workflow_version=Workflow.VERSION_DRAFT,
                    node_id="node-1",
                    binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                    agent_id=agent.id,
                    current_snapshot_id=snapshot.id,
                    node_job_config=WorkflowNodeJobConfig(),
                ),
            ]
        )
        agent_id, backing_app_id = agent.id, backing_app.id

    mapping_query = select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent_id)
    with harness.sessions() as session:
        assert session.scalar(mapping_query) is None
    first = harness.client.get(target.path, headers=harness.headers)
    assert first.status_code == HTTPStatus.OK, first.get_json()
    conversation_id = first.get_json()["debug_conversation_id"]
    assert conversation_id
    with harness.sessions() as session:
        mapping = session.scalars(mapping_query).one()
        assert mapping.conversation_id == conversation_id
        assert mapping.tenant_id == harness.tenant_id
        assert mapping.account_id == harness.account_id
        assert mapping.draft_type == AgentConfigDraftType.DEBUG_BUILD
        conversation = session.get_one(Conversation, conversation_id)
        assert conversation.app_id == backing_app_id
        assert conversation.from_account_id == harness.account_id

    second = harness.client.get(target.path, headers=harness.headers)
    assert second.status_code == HTTPStatus.OK, second.get_json()
    assert second.get_json()["debug_conversation_id"] == conversation_id
    with harness.sessions() as session:
        assert list(session.scalars(select(Conversation.id).where(Conversation.app_id == backing_app_id))) == [
            conversation_id
        ]


def test_node_composer_copy_validate_and_candidates(
    harness: Harness, node_composer_target: NodeComposerTarget, composer_backends: ComposerBackends
) -> None:
    """Copy a published roster snapshot, validate the node and load candidates through the mounted routes."""
    target = node_composer_target
    source_agent_id, _ = harness.create_agent(published=True)
    with harness.sessions.begin() as session:
        source = session.get_one(Agent, source_agent_id)
        snapshot_id = source.active_config_snapshot_id
        assert snapshot_id is not None
        session.add(
            AgentConfigSnapshot(
                id=snapshot_id,
                tenant_id=harness.tenant_id,
                agent_id=source_agent_id,
                version=1,
                config_snapshot=AgentSoulConfig(),
            )
        )
        binding = WorkflowAgentNodeBinding(
            tenant_id=harness.tenant_id,
            app_id=target.app_id,
            workflow_id=target.workflow_id,
            workflow_version=Workflow.VERSION_DRAFT,
            node_id="node-1",
            binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
            agent_id=source_agent_id,
            current_snapshot_id=snapshot_id,
            node_job_config=WorkflowNodeJobConfig(workflow_prompt="Run"),
        )
        session.add(binding)
        binding_id = binding.id

    copied = harness.client.post(
        f"{target.path}/copy-from-roster", json={"source_agent_id": source_agent_id}, headers=harness.headers
    )
    assert copied.status_code == HTTPStatus.OK, copied.get_json()
    copied_state = copied.get_json()
    copied_agent_id = copied_state["agent"]["id"]
    assert copied_agent_id != source_agent_id
    assert copied_state["binding"]["binding_type"] == "inline_agent"
    with harness.sessions() as session:
        persisted_binding = session.get_one(WorkflowAgentNodeBinding, binding_id)
        assert persisted_binding.agent_id == copied_agent_id
        assert persisted_binding.binding_type == WorkflowAgentBindingType.INLINE_AGENT
        assert session.get_one(Agent, source_agent_id).active_config_snapshot_id == snapshot_id

    validated = harness.client.post(
        f"{target.path}/validate",
        json={"variant": "workflow", "save_strategy": "node_job_only", "node_job": copied_state["node_job"]},
        headers=harness.headers,
    )
    assert validated.status_code == HTTPStatus.OK, validated.get_json()
    assert validated.get_json()["result"] == "success"
    assert validated.get_json()["errors"] == []

    # SQLite can run the default-provider lookup's window query.
    with config_overrides_context(DB_TYPE="mysql", POSITION_TOOL_INCLUDES="time", POSITION_TOOL_EXCLUDES=""):
        candidates = harness.client.get(f"{target.path}/candidates", headers=harness.headers)
    assert candidates.status_code == HTTPStatus.OK, candidates.get_json()
    candidate_state = candidates.get_json()
    assert candidate_state["variant"] == "workflow"
    assert candidate_state["allowed_node_job_candidates"]["previous_node_outputs"] == []
    assert "time/*" in {tool["id"] for tool in candidate_state["allowed_soul_candidates"]["dify_tools"]}
    assert composer_backends.tool_tenants == [harness.tenant_id]


@pytest.mark.parametrize("target_failure", ["missing", "foreign", "unsupported-mode"])
def test_workflow_composer_validates_payload_before_resolving_unavailable_app(
    harness: Harness, target_failure: str
) -> None:
    """After Console admission, payload errors precede target errors when both conditions fail."""
    app_id = str(uuid4())
    if target_failure != "missing":
        with harness.sessions.begin() as session:
            session.add(
                App(
                    id=app_id,
                    name="Unavailable Workflow",
                    tenant_id=str(uuid4()) if target_failure == "foreign" else harness.tenant_id,
                    mode=AppMode.WORKFLOW if target_failure == "foreign" else AppMode.COMPLETION,
                    enable_api=False,
                    enable_site=False,
                )
            )
    path = f"/console/api/apps/{app_id}/workflows/draft/nodes/node-1/agent-composer"
    invalid = harness.client.put(path, json={}, headers=harness.headers)
    assert invalid.status_code == HTTPStatus.UNPROCESSABLE_ENTITY, invalid.get_json()
    assert invalid.get_json()["code"] == "unprocessable_entity"

    valid = harness.client.put(
        path, json={"variant": "workflow", "save_strategy": "node_job_only"}, headers=harness.headers
    )
    assert valid.status_code == HTTPStatus.NOT_FOUND, valid.get_json()
    assert valid.get_json()["code"] == "app_not_found"


def test_agent_config_selects_personal_build_draft_and_persists_shared_file_upload(harness: Harness) -> None:
    """Exercise the real Agent asset routes with distinct shared and owner-scoped Build drafts."""
    agent_id, _ = harness.create_agent()
    with harness.sessions.begin() as session:
        shared = AgentConfigDraft(
            tenant_id=harness.tenant_id,
            agent_id=agent_id,
            draft_type=AgentConfigDraftType.DRAFT,
            config_snapshot=AgentSoulConfig(),
        )
        build = AgentConfigDraft(
            tenant_id=harness.tenant_id,
            agent_id=agent_id,
            draft_type=AgentConfigDraftType.DEBUG_BUILD,
            account_id=harness.account_id,
            draft_owner_key=harness.account_id,
            config_snapshot=AgentSoulConfig(),
        )
        upload = UploadFile(
            tenant_id=harness.tenant_id,
            storage_type=StorageType.LOCAL,
            key="uploads/review.txt",
            name="review.txt",
            size=5,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=harness.account_id,
            created_at=naive_utc_now(),
            used=False,
        )
        session.add_all([shared, build, upload])
        session.flush()
        shared_id, build_id, upload_id = shared.id, build.id, upload.id
    path = f"/console/api/agent/{agent_id}/config"
    manifest = harness.client.get(f"{path}/manifest?draft_type=debug_build", headers=harness.headers)
    assert manifest.status_code == HTTPStatus.OK, manifest.get_json()
    assert manifest.get_json()["config_version"]["id"] == build_id
    missing = harness.client.get(f"{path}/skills/missing/files/download?path=README.md", headers=harness.headers)
    assert missing.status_code == HTTPStatus.NOT_FOUND, missing.get_json()
    response = harness.client.post(
        f"{path}/files/batch", headers=harness.headers, json={"upload_file_ids": [upload_id]}
    )
    assert response.status_code == HTTPStatus.CREATED, response.get_json()
    assert response.get_json()["config_version"]["id"] == shared_id
    with harness.sessions() as session:
        draft = session.get_one(AgentConfigDraft, shared_id)
        assert [ref.file_id for ref in AgentSoulConfig.model_validate(draft.config_snapshot_dict).config_files] == [
            upload_id
        ]
        assert not AgentSoulConfig.model_validate(
            session.get_one(AgentConfigDraft, build_id).config_snapshot_dict
        ).config_files


@pytest.mark.parametrize("foreign", [False, True], ids=["missing", "foreign"])
def test_agent_config_rejects_unavailable_agent(harness: Harness, foreign: bool) -> None:
    """Return the same Agent error for missing and foreign IDs on reads and uploads."""
    agent_id = harness.create_agent(tenant_id=str(uuid4()))[0] if foreign else str(uuid4())
    path = f"/console/api/agent/{agent_id}/config"
    manifest = harness.client.get(f"{path}/manifest", headers=harness.headers)
    upload = harness.client.post(
        f"{path}/files/batch", headers=harness.headers, json={"upload_file_ids": [str(uuid4())]}
    )
    for response in (manifest, upload):
        assert response.status_code == HTTPStatus.NOT_FOUND, response.get_json()
        assert response.get_json()["code"] == "agent_not_found_error"
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft.id)) is None


@pytest.mark.parametrize("failure", ["missing", "foreign", "unsupported-mode"])
def test_workflow_config_rejects_unavailable_app(harness: Harness, failure: str) -> None:
    """Require a tenant-owned Workflow or Chatflow App before reaching node config."""
    app_id = str(uuid4())
    if failure != "missing":
        with harness.sessions.begin() as session:
            session.add(
                make_app(
                    app_id=app_id,
                    tenant_id=str(uuid4()) if failure == "foreign" else harness.tenant_id,
                    mode=AppMode.COMPLETION if failure == "unsupported-mode" else AppMode.WORKFLOW,
                )
            )
    path = f"/console/api/apps/{app_id}/agent/config"
    manifest = harness.client.get(f"{path}/manifest?node_id=node-1", headers=harness.headers)
    upload = harness.client.post(
        f"{path}/files/batch?node_id=node-1", headers=harness.headers, json={"upload_file_ids": [str(uuid4())]}
    )
    for response in (manifest, upload):
        assert response.status_code == HTTPStatus.NOT_FOUND, response.get_json()
        assert response.get_json()["code"] == "app_not_found"
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft.id)) is None


@pytest.mark.parametrize(
    ("failure", "status", "code"),
    [
        ("unbound", HTTPStatus.BAD_REQUEST, "agent_not_bound"),
        ("foreign-binding", HTTPStatus.BAD_REQUEST, "agent_not_bound"),
        ("foreign-agent", HTTPStatus.NOT_FOUND, "agent_not_found_error"),
    ],
)
def test_workflow_config_requires_owned_node_binding_and_agent(
    harness: Harness, failure: str, status: HTTPStatus, code: str
) -> None:
    """Reject a different node, a foreign binding, or a binding to a foreign Agent."""
    tenant_id = str(uuid4()) if failure == "foreign-agent" else harness.tenant_id
    agent_id, _ = harness.create_agent(tenant_id=tenant_id)
    app_id = str(uuid4())
    with harness.sessions.begin() as session:
        workflow = make_workflow(app_id=app_id, tenant_id=harness.tenant_id, created_by=harness.account_id)
        session.add_all(
            [
                make_app(app_id=app_id, tenant_id=harness.tenant_id, mode=AppMode.WORKFLOW),
                workflow,
                WorkflowAgentNodeBinding(
                    tenant_id=str(uuid4()) if failure == "foreign-binding" else harness.tenant_id,
                    app_id=app_id,
                    workflow_id=workflow.id,
                    workflow_version=Workflow.VERSION_DRAFT,
                    node_id="other-node" if failure == "unbound" else "node-1",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id=agent_id,
                    node_job_config=WorkflowNodeJobConfig(),
                ),
            ]
        )
    response = harness.client.post(
        f"/console/api/apps/{app_id}/agent/config/files/batch?node_id=node-1",
        headers=harness.headers,
        json={"upload_file_ids": [str(uuid4())]},
    )
    assert response.status_code == status, response.get_json()
    assert response.get_json()["code"] == code
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft.id)) is None


@pytest.mark.parametrize(
    ("workflow_version", "binding_version"),
    [
        ("2026-01-01 00:00:00", "2026-01-01 00:00:00"),
        ("2026-01-01 00:00:00", Workflow.VERSION_DRAFT),
        (Workflow.VERSION_DRAFT, "2026-01-01 00:00:00"),
    ],
    ids=["published-only", "published-workflow", "published-binding"],
)
def test_workflow_config_rejects_non_draft_node_binding(
    harness: Harness, workflow_version: str, binding_version: str
) -> None:
    """Require a draft workflow and binding before reading config or preparing an asset write."""
    agent_id, _ = harness.create_agent()
    app_id = str(uuid4())
    with harness.sessions.begin() as session:
        workflow = make_workflow(
            app_id=app_id, tenant_id=harness.tenant_id, created_by=harness.account_id, version=workflow_version
        )
        soul = AgentSoulConfig(config_note="Existing config")
        snapshot = AgentConfigSnapshot(tenant_id=harness.tenant_id, agent_id=agent_id, version=1, config_snapshot=soul)
        session.get_one(Agent, agent_id).active_config_snapshot_id = snapshot.id
        upload_file = make_upload_file(tenant_id=harness.tenant_id, created_by=harness.account_id)
        snapshot_id, upload_file_id = snapshot.id, upload_file.id
        session.add_all(
            [
                make_app(app_id=app_id, tenant_id=harness.tenant_id, mode=AppMode.WORKFLOW),
                workflow,
                snapshot,
                upload_file,
                WorkflowAgentNodeBinding(
                    tenant_id=harness.tenant_id,
                    app_id=app_id,
                    workflow_id=workflow.id,
                    workflow_version=binding_version,
                    node_id="node-1",
                    binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                    agent_id=agent_id,
                    current_snapshot_id=snapshot_id,
                    node_job_config=WorkflowNodeJobConfig(),
                ),
            ]
        )

    path = f"/console/api/apps/{app_id}/agent/config"
    manifest = harness.client.get(f"{path}/manifest?node_id=node-1", headers=harness.headers)
    uploaded = harness.client.post(
        f"{path}/files/batch?node_id=node-1", headers=harness.headers, json={"upload_file_ids": [upload_file_id]}
    )
    for response in (manifest, uploaded):
        assert response.status_code == HTTPStatus.BAD_REQUEST, response.get_json()
        assert response.get_json()["code"] == "agent_not_bound"
    with harness.sessions() as session:
        assert session.scalars(select(AgentConfigDraft)).all() == []
        stored_snapshot = session.get_one(AgentConfigSnapshot, snapshot_id)
        assert AgentSoulConfig.model_validate(stored_snapshot.config_snapshot_dict) == soul


def test_workflow_config_selects_only_draft_agent_when_published_binding_exists(harness: Harness) -> None:
    """Read the draft binding's Agent and limit asset writes to that Agent's shared draft."""
    app_id = str(uuid4())
    with harness.sessions.begin() as session:
        app = make_app(app_id=app_id, tenant_id=harness.tenant_id, mode=AppMode.WORKFLOW)
        published_workflow = make_workflow(
            app_id=app_id, tenant_id=harness.tenant_id, created_by=harness.account_id, version="2026-01-01 00:00:00"
        )
        draft_workflow = make_workflow(app_id=app_id, tenant_id=harness.tenant_id, created_by=harness.account_id)
        app.workflow_id = published_workflow.id
        upload_file = make_upload_file(tenant_id=harness.tenant_id, created_by=harness.account_id)
        session.add_all([app, published_workflow, draft_workflow, upload_file])
        upload_file_id = upload_file.id
        targets: dict[str, tuple[str, str]] = {}
        for workflow, name in ((published_workflow, "Published Agent"), (draft_workflow, "Draft Agent")):
            agent = Agent(tenant_id=harness.tenant_id, name=name, scope=AgentScope.ROSTER, source=AgentSource.ROSTER)
            snapshot = AgentConfigSnapshot(
                tenant_id=harness.tenant_id,
                agent_id=agent.id,
                version=1,
                config_snapshot=AgentSoulConfig(config_note=name),
            )
            agent.active_config_snapshot_id = snapshot.id
            session.add_all(
                [
                    agent,
                    snapshot,
                    WorkflowAgentNodeBinding(
                        tenant_id=harness.tenant_id,
                        app_id=app_id,
                        workflow_id=workflow.id,
                        workflow_version=workflow.version,
                        node_id="node-1",
                        binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                        agent_id=agent.id,
                        current_snapshot_id=snapshot.id,
                        node_job_config=WorkflowNodeJobConfig(),
                    ),
                ]
            )
            targets[workflow.version] = (agent.id, snapshot.id)
        draft_agent_id, draft_snapshot_id = targets[Workflow.VERSION_DRAFT]

    path = f"/console/api/apps/{app_id}/agent/config"
    manifest = harness.client.get(f"{path}/manifest?node_id=node-1", headers=harness.headers)
    assert manifest.status_code == HTTPStatus.OK, manifest.get_json()
    assert manifest.get_json()["agent_id"] == draft_agent_id
    assert manifest.get_json()["config_version"]["id"] == draft_snapshot_id

    uploaded = harness.client.post(
        f"{path}/files/batch?node_id=node-1", headers=harness.headers, json={"upload_file_ids": [upload_file_id]}
    )
    assert uploaded.status_code == HTTPStatus.CREATED, uploaded.get_json()
    with harness.sessions() as session:
        draft = session.scalars(select(AgentConfigDraft)).one()
        assert uploaded.get_json()["config_version"]["id"] == draft.id
        assert draft.agent_id == draft_agent_id
        assert draft.base_snapshot_id == draft_snapshot_id
        soul = AgentSoulConfig.model_validate(draft.config_snapshot_dict)
        assert [file.file_id for file in soul.config_files] == [upload_file_id]


@pytest.mark.parametrize("failure", ["missing-build", "other-editor-build", "missing-snapshot", "other-agent-snapshot"])
def test_agent_config_rejects_missing_or_unowned_config_version(harness: Harness, failure: str) -> None:
    """Failed reads and uploads never fall back to, or prepare, a shared draft."""
    agent_id, _ = harness.create_agent()
    snapshot_id = str(uuid4()) if failure.endswith("snapshot") else None
    with harness.sessions.begin() as session:
        upload_file = make_upload_file(tenant_id=harness.tenant_id, created_by=harness.account_id)
        owned_snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id, agent_id=agent_id, version=1, config_snapshot=AgentSoulConfig()
        )
        session.get_one(Agent, agent_id).active_config_snapshot_id = owned_snapshot.id
        session.add_all([upload_file, owned_snapshot])
        upload_file_id = upload_file.id
        before_draft_ids: list[str] = []
        if failure == "other-editor-build":
            other_editor_id = str(uuid4())
            draft = AgentConfigDraft(
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id=other_editor_id,
                draft_owner_key=other_editor_id,
                config_snapshot=AgentSoulConfig(),
            )
            session.add(draft)
            before_draft_ids.append(draft.id)
        if snapshot_id is not None and failure == "other-agent-snapshot":
            other_agent = Agent(
                tenant_id=harness.tenant_id,
                name="Other roster Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.ROSTER,
            )
            session.add_all(
                [
                    other_agent,
                    AgentConfigSnapshot(
                        id=snapshot_id,
                        tenant_id=harness.tenant_id,
                        agent_id=other_agent.id,
                        version=1,
                        config_snapshot=AgentSoulConfig(),
                    ),
                ]
            )

    query = {"version_id": snapshot_id} if snapshot_id is not None else {"draft_type": "debug_build"}
    path = f"/console/api/agent/{agent_id}/config"
    manifest = harness.client.get(f"{path}/manifest", headers=harness.headers, query_string=query)
    upload = harness.client.post(
        f"{path}/files/batch", headers=harness.headers, query_string=query, json={"upload_file_ids": [upload_file_id]}
    )
    for response in (manifest, upload):
        assert response.status_code == HTTPStatus.NOT_FOUND, response.get_json()
        assert response.get_json()["code"] == "config_version_not_found"
    with harness.sessions() as session:
        assert list(session.scalars(select(AgentConfigDraft.id))) == before_draft_ids


def test_workflow_config_validates_request_before_resolving_missing_app(harness: Harness) -> None:
    """An invalid query or body precedes target resolution after Console admission."""
    path = f"/console/api/apps/{uuid4()}/agent/config"
    manifest = harness.client.get(f"{path}/manifest?draft_type=invalid", headers=harness.headers)
    assert manifest.status_code == HTTPStatus.BAD_REQUEST, manifest.get_json()
    assert manifest.get_json()["code"] == "invalid_param"
    upload = harness.client.post(f"{path}/files/batch", headers=harness.headers, json={"upload_file_ids": []})
    assert upload.status_code == HTTPStatus.UNPROCESSABLE_ENTITY, upload.get_json()
    assert upload.get_json()["code"] == "unprocessable_entity"


@dataclass(frozen=True)
class _AgentGenerationCall:
    app_id: str
    account_id: str
    args: dict[str, object]
    invoke_from: InvokeFrom
    streaming: bool


@dataclass
class _AgentGenerator:
    calls: list[_AgentGenerationCall] = field(default_factory=list)
    events: list[str] = field(default_factory=list)
    closed_streams: int = 0

    def __call__(
        self,
        *,
        app_model: App,
        user: Account,
        args: Mapping[str, object],
        invoke_from: InvokeFrom,
        session: Session,
        streaming: bool,
    ) -> Iterator[str]:
        """Record the call and stage a write that requires the runtime's final commit."""
        conversation_id = args["conversation_id"]
        assert isinstance(conversation_id, str)
        self.calls.append(_AgentGenerationCall(app_model.id, user.id, dict(args), invoke_from, streaming))
        session.get_one(Conversation, conversation_id).name = f"Generation {len(self.calls)}"
        return self._stream(conversation_id)

    def _stream(self, conversation_id: str) -> Iterator[str]:
        """Emit a complete SSE reply and distinguish draining through the terminal event from exhaustion."""
        try:
            self.events.append("ping")
            yield "event: ping\n\n"
            for event_name in ("message", "message_end"):
                self.events.append(event_name)
                payload = {"event": event_name, "conversation_id": conversation_id}
                yield f"data: {json.dumps(payload)}\n\n"
            self.events.append("exhausted")
        finally:
            self.closed_streams += 1


@pytest.fixture
def agent_generator(harness: Harness) -> _AgentGenerator:
    """Keep the admitted runtime and database real while substituting its generation engine."""
    app = harness.client.application
    with app.app_context():
        services = application_services()
    generator = _AgentGenerator()
    runtime = AgentConsoleRuntime(
        session_factory=harness.sessions,
        preview_enabled=FeatureService.is_agent_preview_enabled,
        generate=generator,
    )
    app.extensions["application_services"] = replace(services, agent_apps=replace(services.agent_apps, runtime=runtime))
    return generator


def test_agent_preview_chat_creates_and_reuses_conversation(harness: Harness, agent_generator: _AgentGenerator) -> None:
    """Start and resume Preview over SSE, committing generation work in the selected conversation."""
    agent_id, app_id = harness.create_agent()
    path = f"/console/api/agent/{agent_id}/chat-messages"
    headers = {**harness.headers, "X-Trace-Id": "preview-trace"}
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
        started = harness.client.post(path, headers=headers, json={"inputs": {}, "query": "Start"}, buffered=True)
        assert started.status_code == HTTPStatus.OK, started.get_data(as_text=True)
        with harness.sessions() as session:
            preview = session.scalars(
                select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent_id)
            ).one()
            assert preview.draft_type == AgentConfigDraftType.DRAFT
            assert preview.tenant_id == harness.tenant_id
            assert (preview.account_id, preview.app_id) == (harness.account_id, app_id)
            conversation_id = preview.conversation_id
            assert session.get_one(Conversation, conversation_id).name == "Generation 1"
        resumed = harness.client.post(
            path,
            headers=headers,
            json={"inputs": {}, "query": "Resume", "conversation_id": conversation_id},
            buffered=True,
        )

    for response in (started, resumed):
        assert response.status_code == HTTPStatus.OK, response.get_data(as_text=True)
        assert response.mimetype == "text/event-stream"
        ping, message, end, trailing = response.get_data(as_text=True).split("\n\n")
        assert (ping, trailing) == ("event: ping", "")
        assert json.loads(message.removeprefix("data: ")) == {"event": "message", "conversation_id": conversation_id}
        assert json.loads(end.removeprefix("data: ")) == {"event": "message_end", "conversation_id": conversation_id}

    assert len(agent_generator.calls) == 2
    for call, query in zip(agent_generator.calls, ("Start", "Resume"), strict=True):
        assert (call.app_id, call.account_id, call.invoke_from, call.streaming) == (
            app_id,
            harness.account_id,
            InvokeFrom.DEBUGGER,
            True,
        )
        assert call.args["draft_type"] == "draft"
        assert call.args["conversation_id"] == conversation_id
        assert call.args["query"] == query
        assert call.args["external_trace_id"] == "preview-trace"
    with harness.sessions() as session:
        assert session.get_one(Conversation, conversation_id).name == "Generation 2"


def test_agent_build_finalize_reuses_build_conversation_and_drains_message(
    harness: Harness, agent_generator: _AgentGenerator
) -> None:
    """Finalize with the fixed Build inputs and close the stream immediately after message_end."""
    agent_id, app_id = harness.create_agent()
    path = f"/console/api/agent/{agent_id}"
    started = harness.client.post(
        f"{path}/chat-messages",
        headers=harness.headers,
        json={"inputs": {}, "query": "Build", "draft_type": "debug_build"},
        buffered=True,
    )
    assert started.status_code == HTTPStatus.OK, started.get_data(as_text=True)
    with harness.sessions() as session:
        build = session.scalars(select(AgentDebugConversation).where(AgentDebugConversation.agent_id == agent_id)).one()
        assert build.draft_type == AgentConfigDraftType.DEBUG_BUILD
        assert (build.tenant_id, build.account_id, build.app_id) == (harness.tenant_id, harness.account_id, app_id)
        conversation_id = build.conversation_id
    agent_generator.events.clear()
    closed_streams = agent_generator.closed_streams

    response = harness.client.post(
        f"{path}/build-chat/finalize",
        headers={**harness.headers, "X-Trace-Id": "finalize-trace"},
        json={"query": "Client-supplied query", "draft_type": "draft"},
    )

    assert response.status_code == HTTPStatus.OK, response.get_json()
    assert response.get_json() == {"result": "success"}
    assert len(agent_generator.calls) == 2
    assert agent_generator.calls[-1] == _AgentGenerationCall(
        app_id=app_id,
        account_id=harness.account_id,
        args={
            "query": _BUILD_CHAT_FINALIZATION_QUERY,
            "inputs": {},
            "response_mode": "streaming",
            "draft_type": "debug_build",
            "auto_generate_name": False,
            "external_trace_id": "finalize-trace",
            "conversation_id": conversation_id,
        },
        invoke_from=InvokeFrom.DEBUGGER,
        streaming=True,
    )
    assert agent_generator.events == ["ping", "message", "message_end"]
    assert agent_generator.closed_streams == closed_streams + 1
    with harness.sessions() as session:
        assert session.get_one(Conversation, conversation_id).name == "Generation 2"


@pytest.mark.parametrize("foreign_agent", [False, True], ids=["missing-agent", "foreign-workspace"])
def test_agent_chat_validates_payload_before_resolving_unavailable_agent(harness: Harness, foreign_agent: bool) -> None:
    """After Console admission, reject invalid chat input before resolving an unavailable Agent."""
    agent_id = harness.create_agent(tenant_id=str(uuid4()))[0] if foreign_agent else str(uuid4())
    url = f"/console/api/agent/{agent_id}/chat-messages"
    inputs: dict[str, object] = {}
    for payload, status, code in (
        ({"inputs": inputs}, HTTPStatus.BAD_REQUEST, "invalid_param"),
        ({"inputs": inputs, "query": "Hello", "response_mode": "blocking"}, HTTPStatus.BAD_REQUEST, "bad_request"),
        (
            {"inputs": inputs, "query": "Hello", "response_mode": "streaming"},
            HTTPStatus.NOT_FOUND,
            "agent_not_found_error",
        ),
    ):
        response = harness.client.post(url, headers=harness.headers, json=payload)

        assert response.status_code == status, response.get_json()
        assert response.get_json()["code"] == code


def test_agent_chat_checks_conversation_ownership_before_invoking_generation(harness: Harness) -> None:
    """Send an unowned conversation through real admission and runtime selection."""
    agent_id, _ = harness.create_agent()
    with config_overrides_context(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD):
        response = harness.client.post(
            f"/console/api/agent/{agent_id}/chat-messages",
            headers=harness.headers,
            json={"inputs": {}, "query": "Hello", "conversation_id": str(uuid4())},
        )
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["message"].startswith("Conversation Not Exists.")


def test_agent_chat_rejects_preview_without_preparing_a_conversation(harness: Harness) -> None:
    """Community preview attempts return the public policy error before creating a conversation."""
    agent_id, _ = harness.create_agent()
    response = harness.client.post(
        f"/console/api/agent/{agent_id}/chat-messages",
        headers=harness.headers,
        json={"inputs": {}, "query": "Hello"},
    )
    assert response.status_code == HTTPStatus.FORBIDDEN, response.get_json()
    assert response.get_json()["code"] == "agent_preview_unavailable"
    with harness.sessions() as session:
        conversation = session.scalar(
            select(AgentDebugConversation.id).where(AgentDebugConversation.agent_id == agent_id)
        )
        assert conversation is None


@pytest.mark.parametrize(
    ("agent_exists", "task_owned"),
    [(True, True), (True, False), (False, True)],
    ids=["owned-task", "another-accounts-task", "missing-agent"],
)
def test_agent_chat_stop_requires_an_agent_before_setting_the_accounts_stop_flag(
    harness: Harness, agent_exists: bool, task_owned: bool
) -> None:
    """Resolve the Agent before checking task ownership and set the stop flag only for its owner."""
    agent_id = harness.create_agent()[0] if agent_exists else str(uuid4())
    task_id = "task-with-non-uuid-id"
    owner_key = f"generate_task_belong:{task_id}"
    flag_key = f"generate_task_stopped:{task_id}"
    owner_id = harness.account_id if task_owned else str(uuid4())
    redis = _StopRedis(values={owner_key: f"account-{owner_id}".encode()})
    app = harness.client.application
    with app.app_context():
        services = application_services()
    app.extensions["application_services"] = replace(services, app_tasks=AppTaskControlService(redis_client=redis))
    try:
        response = harness.client.post(
            f"/console/api/agent/{agent_id}/chat-messages/{task_id}/stop", headers=harness.headers
        )
    finally:
        app.extensions["application_services"] = services

    if agent_exists:
        assert response.status_code == HTTPStatus.OK
        assert response.get_json() == {"result": "success"}
    else:
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["code"] == "agent_not_found_error"
    assert redis.reads == ([owner_key] if agent_exists else [])
    if agent_exists and task_owned:
        assert redis.values[flag_key] == b"1"
        assert redis.expirations[flag_key] == 600
    else:
        assert flag_key not in redis.values


def test_agent_asr_uses_account_owned_build_configuration(harness: Harness) -> None:
    """Reject a missing Build draft and enforce that draft's ASR feature before upload handling."""
    agent_id, _ = harness.create_agent()
    path = f"/console/api/agent/{agent_id}/audio-to-text"
    missing = harness.client.post(path, headers=harness.headers, data={"draft_type": "debug_build"})
    assert missing.status_code == HTTPStatus.NOT_FOUND
    assert missing.get_json()["code"] == "agent_version_not_found_error"
    with harness.sessions.begin() as session:
        session.add(
            AgentConfigDraft(
                tenant_id=harness.tenant_id,
                agent_id=agent_id,
                draft_type=AgentConfigDraftType.DEBUG_BUILD,
                account_id=harness.account_id,
                draft_owner_key=harness.account_id,
                config_snapshot=AgentSoulConfig(),
            )
        )
    disabled = harness.client.post(path, headers=harness.headers, data={"draft_type": "debug_build"})
    assert disabled.status_code == HTTPStatus.BAD_REQUEST
    assert disabled.get_json()["code"] == "speech_to_text_disabled"


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


def test_workflow_inspector_reads_snapshot_and_prepares_draft_only_for_asset_write(harness: Harness) -> None:
    """Exercise the real workflow binding lookup, snapshot fallback, and commit before file mutation."""
    with harness.sessions.begin() as session:
        app = App(
            tenant_id=harness.tenant_id,
            name="Workflow",
            mode=AppMode.WORKFLOW,
            created_by=harness.account_id,
            enable_site=False,
            enable_api=False,
        )
        session.add(app)
        session.flush()
        app_id = app.id
        session.add(
            Workflow.new(
                tenant_id=harness.tenant_id,
                app_id=app_id,
                type=WorkflowType.WORKFLOW,
                version=Workflow.VERSION_DRAFT,
                graph='{"nodes": [], "edges": []}',
                features="{}",
                created_by=harness.account_id,
                environment_variables=[],
                conversation_variables=[],
                rag_pipeline_variables=[],
            )
        )
        upload = UploadFile(
            tenant_id=harness.tenant_id,
            storage_type=StorageType.LOCAL,
            key="uploads/asset.txt",
            name="asset.txt",
            size=5,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=harness.account_id,
            created_at=naive_utc_now(),
            used=False,
        )
        session.add(upload)
        session.flush()
        upload_id = upload.id
    node_path = f"/console/api/apps/{app_id}/workflows/draft/nodes/node-1/agent-composer"
    node = harness.client.put(
        node_path, headers=harness.headers, json={"variant": "workflow", "save_strategy": "node_job_only"}
    )
    assert node.status_code == HTTPStatus.OK, node.get_json()
    agent_id = node.get_json()["agent"]["id"]

    path = f"/console/api/apps/{app_id}/agent/config"
    manifest = harness.client.get(f"{path}/manifest?node_id=node-1", headers=harness.headers)
    assert manifest.status_code == HTTPStatus.OK, manifest.get_json()
    assert manifest.get_json()["config_version"]["kind"] == "snapshot"
    with harness.sessions() as session:
        assert session.scalar(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)) is None

    uploaded = harness.client.post(
        f"{path}/files/batch?node_id=node-1", headers=harness.headers, json={"upload_file_ids": [upload_id]}
    )
    assert uploaded.status_code == HTTPStatus.CREATED, uploaded.get_json()
    assert uploaded.get_json()["config_version"]["kind"] == "draft"
    assert uploaded.get_json()["files"][0]["file_id"] == upload_id


@pytest.mark.parametrize("stale", [False, True], ids=["current-shared-draft", "stale-inline-draft"])
def test_workflow_inspector_selects_effective_config_without_committing(harness: Harness, stale: bool) -> None:
    """GET reads the current shared draft or active snapshot and leaves the stored draft intact."""
    app_id = str(uuid4())
    with harness.sessions.begin() as session:
        workflow = make_workflow(app_id=app_id, tenant_id=harness.tenant_id, created_by=harness.account_id)
        agent = Agent(
            tenant_id=harness.tenant_id,
            name="Inline Agent",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
        )
        snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id,
            agent_id=agent.id,
            version=2,
            config_snapshot=AgentSoulConfig(config_note="Active snapshot"),
        )
        previous_snapshot = AgentConfigSnapshot(
            tenant_id=harness.tenant_id, agent_id=agent.id, version=1, config_snapshot=AgentSoulConfig()
        )
        agent.active_config_snapshot_id = snapshot.id
        draft = AgentConfigDraft(
            tenant_id=harness.tenant_id,
            agent_id=agent.id,
            draft_type=AgentConfigDraftType.DRAFT,
            base_snapshot_id=previous_snapshot.id if stale else snapshot.id,
            config_snapshot=AgentSoulConfig(config_note="Shared draft"),
        )
        session.add_all(
            [
                make_app(app_id=app_id, tenant_id=harness.tenant_id, mode=AppMode.WORKFLOW),
                workflow,
                agent,
                previous_snapshot,
                snapshot,
                draft,
                WorkflowAgentNodeBinding(
                    tenant_id=harness.tenant_id,
                    app_id=app_id,
                    workflow_id=workflow.id,
                    workflow_version=Workflow.VERSION_DRAFT,
                    node_id="node-1",
                    binding_type=WorkflowAgentBindingType.INLINE_AGENT,
                    agent_id=agent.id,
                    current_snapshot_id=snapshot.id,
                    node_job_config=WorkflowNodeJobConfig(),
                ),
            ]
        )
        session.flush()
        agent_id, draft_id, snapshot_id = agent.id, draft.id, snapshot.id
        draft_before = (draft.base_snapshot_id, draft.config_snapshot_dict, draft.updated_at)

    commits: list[Session] = []
    observe_commit = commits.append
    event.listen(harness.sessions, "after_commit", observe_commit)
    try:
        manifest = harness.client.get(
            f"/console/api/apps/{app_id}/agent/config/manifest?node_id=node-1", headers=harness.headers
        )
    finally:
        event.remove(harness.sessions, "after_commit", observe_commit)

    assert manifest.status_code == HTTPStatus.OK, manifest.get_json()
    body = manifest.get_json()
    assert body["agent_id"] == agent_id
    assert body["config_version"]["id"] == (snapshot_id if stale else draft_id)
    assert body["config_version"]["kind"] == ("snapshot" if stale else "draft")
    assert body["note"] == ("Active snapshot" if stale else "Shared draft")
    assert not commits
    with harness.sessions() as session:
        stored_draft = session.scalars(select(AgentConfigDraft).where(AgentConfigDraft.agent_id == agent_id)).one()
        assert stored_draft.id == draft_id
        draft_after = (stored_draft.base_snapshot_id, stored_draft.config_snapshot_dict, stored_draft.updated_at)
        assert draft_after == draft_before


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
