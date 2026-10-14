"""Unit tests for the inner_api enterprise app list and detail endpoints.

Auth/setup decorators are tested in test_auth_wraps.py; handler tests use inspect.unwrap() to bypass them.
"""

import inspect
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Protocol, cast
from uuid import UUID, uuid4

import pytest
from flask import Flask
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import BadRequest

from controllers.inner_api.app.app import EnterpriseAppDetail, EnterpriseAppList
from graphon.enums import WorkflowExecutionStatus
from models import Account, App, Tenant
from models.account import AccountStatus
from models.agent import (
    Agent,
    AgentConfigRevision,
    AgentConfigRevisionOperation,
    AgentConfigSnapshot,
    AgentScope,
    AgentSource,
    AgentStatus,
)
from models.enums import (
    ApiTokenType,
    AppTriggerStatus,
    AppTriggerType,
    ConversationFromSource,
    CreatorUserRole,
    CustomizeTokenStrategy,
    InvokeFrom,
    MessageStatus,
    WorkflowRunTriggeredFrom,
)
from models.model import ApiToken, AppMCPServer, AppMode, Message, Site
from models.trigger import AppTrigger, WorkflowWebhookTrigger
from models.workflow import Workflow, WorkflowRun, WorkflowType
from repositories.app.enterprise_app_repository import EnterpriseAppRepository
from services.app.enterprise_app_service import EnterpriseAppService

WS_A = "11111111-1111-1111-1111-111111111111"
WS_B = "22222222-2222-2222-2222-222222222222"
NOW = datetime(2026, 10, 14, 12)


class DocumentedView(Protocol):
    __apidoc__: dict[str, dict[str, dict[str, object]]]


@dataclass(frozen=True)
class _Apps:
    enterprise: EnterpriseAppService


@dataclass(frozen=True)
class _Services:
    apps: _Apps


@pytest.fixture
def enterprise_apps(app: Flask, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> None:
    service = EnterpriseAppService(
        apps=EnterpriseAppRepository(
            session_factory=sqlite_session_factory,
            app_web_url="https://apps.example.com/",
            service_api_url="https://api.example.com",
        ),
        now=lambda: NOW,
    )
    monkeypatch.setitem(app.extensions, "application_services", _Services(apps=_Apps(service)))


def _app(tenant_id: str, name: str, *, mode: AppMode = AppMode.WORKFLOW, created_at: datetime, **kwargs: object) -> App:
    app = App(
        tenant_id=tenant_id,
        name=name,
        mode=mode,
        enable_site=False,
        enable_api=False,
        created_at=created_at,
        updated_at=created_at,
        **kwargs,
    )
    app.id = str(uuid4())
    return app


def _agent(tenant_id: str, *, scope: AgentScope, status: AgentStatus = AgentStatus.ACTIVE, **kwargs: object) -> Agent:
    return Agent(
        tenant_id=tenant_id,
        name=f"agent-{uuid4()}",
        scope=scope,
        source=AgentSource.AGENT_APP if scope == AgentScope.ROSTER else AgentSource.WORKFLOW,
        status=status,
        **kwargs,
    )


@pytest.fixture
def seeded(sqlite_session: Session) -> dict[str, str]:
    creator = Account(name="Creator", email="creator@example.com", status=AccountStatus.ACTIVE)
    ws_a, ws_b = Tenant(name="Support"), Tenant(name="Sales")
    ws_a.id, ws_b.id = WS_A, WS_B
    sqlite_session.add_all([creator, ws_a, ws_b])
    sqlite_session.flush()

    alpha = _app(WS_A, "Alpha 100%", created_at=datetime(2026, 1, 1), created_by=creator.id, description="d")
    beta = _app(WS_A, "beta", mode=AppMode.ADVANCED_CHAT, created_at=datetime(2026, 1, 3))
    gamma = _app(WS_B, "Gamma", mode=AppMode.CHAT, created_at=datetime(2026, 1, 2), created_by=str(uuid4()))
    roster = _app(WS_B, "Roster Agent", mode=AppMode.AGENT, created_at=datetime(2026, 1, 4))
    archived = _app(WS_B, "Archived Agent", mode=AppMode.AGENT, created_at=datetime(2026, 1, 5))
    backing = _app(WS_B, "Backing", mode=AppMode.AGENT, created_at=datetime(2026, 1, 6))
    hidden = [
        archived,
        backing,
        _app(WS_A, "Pipeline", mode=AppMode.RAG_PIPELINE, created_at=datetime(2026, 1, 7)),
        _app(WS_A, "Channel", mode=AppMode.CHANNEL, created_at=datetime(2026, 1, 8)),
        _app(WS_A, "Universal", created_at=datetime(2026, 1, 9), is_universal=True),
    ]
    sqlite_session.add_all([alpha, beta, gamma, roster, *hidden])
    sqlite_session.add_all(
        [
            _agent(WS_B, scope=AgentScope.ROSTER, app_id=roster.id),
            _agent(WS_B, scope=AgentScope.ROSTER, status=AgentStatus.ARCHIVED, app_id=archived.id),
            _agent(WS_B, scope=AgentScope.WORKFLOW_ONLY, backing_app_id=backing.id),
        ]
    )
    sqlite_session.commit()
    return {"alpha": alpha.id, "beta": beta.id, "gamma": gamma.id, "roster": roster.id, "creator": creator.id}


def _list(app: Flask, query: str = "") -> dict:
    with app.test_request_context(f"/enterprise/apps{query}"):
        return inspect.unwrap(EnterpriseAppList.get)(EnterpriseAppList())


@pytest.mark.usefixtures("enterprise_apps")
class TestEnterpriseAppList:
    @pytest.mark.usefixtures("seeded")
    def test_lists_studio_visible_apps_newest_first(self, app: Flask) -> None:
        body = _list(app)

        assert [item["name"] for item in body["data"]] == ["Roster Agent", "beta", "Gamma", "Alpha 100%"]
        assert (body["page"], body["limit"], body["total"], body["has_more"]) == (1, 20, 4, False)

    def test_item_shape(self, app: Flask, seeded: dict[str, str]) -> None:
        items = {item["name"]: item for item in _list(app)["data"]}

        assert items["Alpha 100%"] == {
            "id": seeded["alpha"],
            "name": "Alpha 100%",
            "description": "d",
            "mode": "workflow",
            "icon_type": None,
            "icon": None,
            "icon_background": None,
            "workspace_id": WS_A,
            "workspace_name": "Support",
            "created_by": {"id": seeded["creator"], "name": "Creator", "email": "creator@example.com"},
            "created_at": int(datetime(2026, 1, 1).timestamp()),
            "updated_at": int(datetime(2026, 1, 1).timestamp()),
        }
        # A creator whose account no longer exists is reported as missing.
        assert items["Gamma"]["created_by"] is None

    @pytest.mark.parametrize(
        ("query", "expected"),
        [
            (f"?workspace_ids={WS_B}", ["Roster Agent", "Gamma"]),
            (f"?workspace_ids={WS_A}&workspace_ids={WS_B}", ["Roster Agent", "beta", "Gamma", "Alpha 100%"]),
            ("?modes=workflow&modes=chat", ["Gamma", "Alpha 100%"]),
            ("?modes=agent", ["Roster Agent"]),
            ("?name=A", ["Roster Agent", "beta", "Gamma", "Alpha 100%"]),
            ("?name=100%25", ["Alpha 100%"]),
            ("?name=%25", ["Alpha 100%"]),
            ("?name=%20%20", ["Roster Agent", "beta", "Gamma", "Alpha 100%"]),
            ("?sort_by=name&sort_order=asc", ["Alpha 100%", "beta", "Gamma", "Roster Agent"]),
            ("?sort_by=created_at&sort_order=asc", ["Alpha 100%", "Gamma", "beta", "Roster Agent"]),
        ],
    )
    @pytest.mark.usefixtures("seeded")
    def test_filters_and_sorting(self, app: Flask, query: str, expected: list[str]) -> None:
        assert [item["name"] for item in _list(app, query)["data"]] == expected

    @pytest.mark.usefixtures("seeded")
    def test_pagination(self, app: Flask) -> None:
        first = _list(app, "?limit=3")
        second = _list(app, "?limit=3&page=2")

        assert (first["total"], first["has_more"], len(first["data"])) == (4, True, 3)
        assert (second["total"], second["has_more"], [item["name"] for item in second["data"]]) == (
            4,
            False,
            ["Alpha 100%"],
        )

    @pytest.mark.parametrize(
        "query", ["?workspace_ids=not-a-uuid", "?modes=rag-pipeline", "?limit=0", "?limit=101", "?sort_by=calls"]
    )
    def test_invalid_query_is_rejected(self, app: Flask, query: str) -> None:
        with pytest.raises(BadRequest):
            _list(app, query)

    def test_documents_query_parameters(self) -> None:
        params = cast(DocumentedView, EnterpriseAppList.get).__apidoc__["params"]
        for name in ("page", "limit", "workspace_ids", "modes", "name", "sort_by", "sort_order"):
            assert params[name]["in"] == "query"


def _detail(app: Flask, app_id: str) -> dict | tuple[dict, int]:
    with app.test_request_context(f"/enterprise/apps/{app_id}"):
        return inspect.unwrap(EnterpriseAppDetail.get)(EnterpriseAppDetail(), app_id=UUID(app_id))


def _run(app: App, status: WorkflowExecutionStatus, created_at: datetime, **kwargs: object) -> WorkflowRun:
    return WorkflowRun(
        tenant_id=app.tenant_id,
        app_id=app.id,
        workflow_id=app.workflow_id or str(uuid4()),
        type=WorkflowType.WORKFLOW,
        triggered_from=kwargs.pop("triggered_from", WorkflowRunTriggeredFrom.APP_RUN),
        version="v",
        graph="{}",
        inputs="{}",
        status=status,
        created_by_role=CreatorUserRole.END_USER,
        created_by=str(uuid4()),
        created_at=created_at,
    )


def _message(app_id: str, status: MessageStatus, created_at: datetime, invoke_from: InvokeFrom) -> Message:
    message = Message(
        app_id=app_id,
        conversation_id=str(uuid4()),
        inputs={},
        query="q",
        message={},
        message_unit_price=Decimal(0),
        answer="a",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        status=status,
        invoke_from=invoke_from,
    )
    message.created_at = created_at
    return message


@pytest.mark.usefixtures("enterprise_apps")
class TestEnterpriseAppDetail:
    def test_workflow_app_built_in_state(self, app: Flask, sqlite_session: Session, seeded: dict[str, str]) -> None:
        workflow_app = sqlite_session.get(App, seeded["alpha"])
        assert workflow_app is not None
        published = Workflow(
            tenant_id=WS_A,
            app_id=workflow_app.id,
            type=WorkflowType.WORKFLOW,
            version="2026-01-02 00:00:00",
            version_number=3,
            graph="{}",
            features="{}",
            environment_variables=[],
            conversation_variables=[],
            created_by=seeded["creator"],
            created_at=datetime(2026, 1, 2),
        )
        sqlite_session.add(published)
        sqlite_session.flush()
        workflow_app.workflow_id = published.id
        workflow_app.enable_site = True
        webhook = AppTrigger(
            tenant_id=WS_A,
            app_id=workflow_app.id,
            node_id="hook",
            trigger_type=AppTriggerType.TRIGGER_WEBHOOK,
            title="Hook",
        )
        schedule = AppTrigger(
            tenant_id=WS_A,
            app_id=workflow_app.id,
            node_id="cron",
            trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
            title="Cron",
            status=AppTriggerStatus.DISABLED,
        )
        sqlite_session.add_all(
            [
                Site(
                    app_id=workflow_app.id,
                    title="t",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                    code="site-code",
                ),
                ApiToken(app_id=workflow_app.id, tenant_id=WS_A, type=ApiTokenType.APP, token="app-1"),
                ApiToken(app_id=workflow_app.id, tenant_id=WS_A, type=ApiTokenType.APP, token="app-2"),
                AppMCPServer(
                    tenant_id=WS_A,
                    app_id=workflow_app.id,
                    name="n",
                    description="d",
                    server_code="mcp-code",
                    status="active",
                    parameters="{}",
                ),
                webhook,
                schedule,
                WorkflowWebhookTrigger(
                    app_id=workflow_app.id,
                    node_id="hook",
                    tenant_id=WS_A,
                    webhook_id="whk",
                    created_by=seeded["creator"],
                ),
                _run(workflow_app, WorkflowExecutionStatus.SUCCEEDED, NOW - timedelta(hours=1)),
                _run(workflow_app, WorkflowExecutionStatus.FAILED, NOW - timedelta(hours=2)),
                _run(workflow_app, WorkflowExecutionStatus.PARTIAL_SUCCEEDED, NOW - timedelta(hours=3)),
                _run(workflow_app, WorkflowExecutionStatus.STOPPED, NOW - timedelta(hours=4)),
                # Outside the 24h window.
                _run(workflow_app, WorkflowExecutionStatus.FAILED, NOW - timedelta(hours=25)),
                # Debugger runs are not invocations, even when newest.
                _run(
                    workflow_app,
                    WorkflowExecutionStatus.FAILED,
                    NOW - timedelta(minutes=1),
                    triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
                ),
            ]
        )
        sqlite_session.commit()

        body = _detail(app, seeded["alpha"])

        assert isinstance(body, dict)
        assert body["id"] == seeded["alpha"]
        assert body["workspace_name"] == "Support"
        built_in = body["built_in"]
        assert built_in["published_version"] == {
            "id": published.id,
            "version_number": 3,
            "published_at": int(datetime(2026, 1, 2).timestamp()),
        }
        assert built_in["site"] == {"enabled": True, "code": "site-code", "app_base_url": "https://apps.example.com"}
        assert built_in["api"] == {"enabled": False, "base_url": "https://api.example.com/v1", "api_key_count": 2}
        assert built_in["mcp_server"] == {"status": "active", "server_code": "mcp-code"}
        triggers = {trigger["node_id"]: trigger for trigger in built_in["triggers"]}
        assert triggers["hook"]["webhook_url"].endswith("/triggers/webhook/whk")
        assert triggers["cron"] | {"id": None} == {
            "id": None,
            "node_id": "cron",
            "title": "Cron",
            "trigger_type": "trigger-schedule",
            "provider_name": "",
            "status": "disabled",
            "webhook_url": None,
        }
        assert built_in["last_invoked_at"] == int((NOW - timedelta(hours=1)).timestamp())
        assert (built_in["invocation_count_24h"], built_in["failed_invocation_count_24h"]) == (4, 2)

    def test_chat_app_counts_messages_and_has_no_version(
        self, app: Flask, sqlite_session: Session, seeded: dict[str, str]
    ) -> None:
        sqlite_session.add_all(
            [
                _message(seeded["gamma"], MessageStatus.NORMAL, NOW - timedelta(hours=1), InvokeFrom.WEB_APP),
                _message(seeded["gamma"], MessageStatus.ERROR, NOW - timedelta(hours=2), InvokeFrom.SERVICE_API),
                _message(seeded["gamma"], MessageStatus.ERROR, NOW - timedelta(minutes=1), InvokeFrom.DEBUGGER),
                _message(seeded["gamma"], MessageStatus.NORMAL, NOW - timedelta(hours=30), InvokeFrom.WEB_APP),
            ]
        )
        sqlite_session.commit()

        built_in = cast(dict, _detail(app, seeded["gamma"]))["built_in"]

        assert built_in["published_version"] is None
        assert built_in["site"] == {"enabled": False, "code": None, "app_base_url": "https://apps.example.com"}
        assert built_in["mcp_server"] is None
        assert built_in["triggers"] == []
        assert built_in["last_invoked_at"] == int((NOW - timedelta(hours=1)).timestamp())
        assert (built_in["invocation_count_24h"], built_in["failed_invocation_count_24h"]) == (2, 1)

    @pytest.mark.usefixtures("seeded")
    def test_app_without_invocations(self, app: Flask, seeded: dict[str, str]) -> None:
        built_in = cast(dict, _detail(app, seeded["beta"]))["built_in"]

        assert built_in["published_version"] is None
        assert (built_in["last_invoked_at"], built_in["invocation_count_24h"]) == (None, 0)

    def test_agent_app_published_version_uses_latest_revision(
        self, app: Flask, sqlite_session: Session, seeded: dict[str, str]
    ) -> None:
        agent = sqlite_session.scalar(select(Agent).where(Agent.app_id == seeded["roster"]))
        assert agent is not None
        snapshot = AgentConfigSnapshot(tenant_id=WS_B, agent_id=agent.id, version=2, config_snapshot={})
        snapshot.created_at = datetime(2026, 2, 1)
        sqlite_session.add(snapshot)
        sqlite_session.flush()
        agent.active_config_snapshot_id = snapshot.id
        agent.active_config_is_published = True
        sqlite_session.add_all(
            [
                AgentConfigRevision(
                    tenant_id=WS_B,
                    agent_id=agent.id,
                    current_snapshot_id=snapshot.id,
                    revision=revision,
                    operation=operation,
                    created_at=created_at,
                )
                for revision, operation, created_at in (
                    (1, AgentConfigRevisionOperation.PUBLISH_DRAFT, datetime(2026, 2, 1)),
                    (2, AgentConfigRevisionOperation.RESTORE_VERSION, datetime(2026, 3, 1)),
                )
            ]
        )
        sqlite_session.commit()

        built_in = cast(dict, _detail(app, seeded["roster"]))["built_in"]

        assert built_in["published_version"] == {
            "id": snapshot.id,
            "version_number": 2,
            "published_at": int(datetime(2026, 3, 1).timestamp()),
        }

    @pytest.mark.usefixtures("seeded")
    def test_missing_or_hidden_app_returns_404(self, app: Flask, sqlite_session: Session) -> None:
        hidden_id = sqlite_session.scalar(select(App.id).where(App.name == "Archived Agent"))
        assert hidden_id is not None
        for app_id in (str(uuid4()), hidden_id):
            assert _detail(app, app_id) == ({"message": "app not found"}, 404)

    def test_base_urls_are_null_when_not_configured(
        self,
        app: Flask,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
        seeded: dict[str, str],
    ) -> None:
        service = EnterpriseAppService(
            apps=EnterpriseAppRepository(session_factory=sqlite_session_factory, app_web_url="", service_api_url=""),
            now=lambda: NOW,
        )
        monkeypatch.setitem(app.extensions, "application_services", _Services(apps=_Apps(service)))

        built_in = cast(dict, _detail(app, seeded["alpha"]))["built_in"]

        assert built_in["site"]["app_base_url"] is None
        assert built_in["api"]["base_url"] is None
