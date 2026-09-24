"""Preview detail contracts through real HTTP, services, and SQLite queries."""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from types import SimpleNamespace
from typing import Literal, cast, override
from uuid import uuid4

import pytest
from flask import Flask, got_request_exception
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, delete, event, select, text, update
from sqlalchemy.engine import ExecutionContext
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from sqlalchemy.pool import QueuePool
from werkzeug.test import TestResponse

import controllers.console.explore.trial as trial_module
import controllers.console.wraps as console_wraps
import libs.login as login_module
import services.app_service as app_module
from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console import api as console_api
from controllers.console.app import preview_admission as admission_module
from core.agent.entities import AgentToolEntity
from core.helper import encrypter
from core.plugin.plugin_service import PluginService
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ToolParameter
from core.tools.tool_manager import ToolManager
from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from enums import DeploymentEdition
from extensions.ext_login import DifyLoginManager, unauthorized_handler
from graphon.variables import SecretVariable, StringVariable
from libs.external_api import ExternalApi
from libs.token import generate_csrf_token
from machinery.errors import ActiveWorkspaceRequiredError
from models import Account, AccountTrialAppRecord, App, AppMode, Tenant, TrialApp
from models.account import AccountStatus
from models.enums import CustomizeTokenStrategy, TagType
from models.model import AppModelConfig, IconType, Site, Tag, TagBinding
from models.provider_ids import GenericProviderID
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from repositories.trial_app_repository import TrialAppRepository
from services.app_preview_details_adapters import AppPreviewDetailsRuntime
from services.app_preview_query_service import AppPreviewQueryService
from services.app_service import AppResponseView, AppService
from services.recommended_app_query_service import (
    RecommendedAppCatalogPage,
    RecommendedAppDetailRecord,
    RecommendedAppQueryService,
)

_Endpoint = Literal["detail", "workflows"]
_CREATED_AT = datetime(2024, 1, 1)
_UPDATED_AT = datetime(2024, 1, 2)


@dataclass
class _Catalog:
    engine: Engine
    ids: set[str] = field(default_factory=set)
    calls: list[str] = field(default_factory=list)

    def contains(self, app_id: str) -> bool:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        self.calls.append(app_id)
        return app_id in self.ids

    def list_recommended(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected listing for {language}")

    def list_learn_dify(self, language: str) -> RecommendedAppCatalogPage:
        raise AssertionError(f"Unexpected listing for {language}")

    def get_detail(self, app_id: str) -> RecommendedAppDetailRecord | None:
        raise AssertionError(f"Unexpected catalog detail for {app_id}")


@dataclass
class _ExternalIO:
    engine: Engine
    owner_id: str
    viewer_workspace_id: str
    decryptions: list[tuple[str, str]] = field(default_factory=list)
    tool_calls: list[tuple[str, str, str]] = field(default_factory=list)

    def encrypt(self, tenant_id: str, token: str) -> str:
        assert tenant_id == self.owner_id
        assert token == "workflow-secret"
        return "cipher-workflow"

    def decrypt(self, tenant_id: str, token: str) -> str:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        self.decryptions.append((tenant_id, token))
        if token == "cipher-workflow":
            assert tenant_id == self.owner_id
            return "workflow-secret"
        assert token == "cipher-tool"
        assert tenant_id == self.viewer_workspace_id
        return "tool-secret"

    def tool_runtime(self, *, tenant_id: str, app_id: str, agent_tool: AgentToolEntity, user_id: str) -> Tool:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        assert tenant_id == self.viewer_workspace_id
        assert agent_tool.tool_name == "search"
        self.tool_calls.append((tenant_id, app_id, user_id))
        parameter = ToolParameter.model_validate(
            {"name": "api_key", "label": {"en_US": "Key"}, "type": "secret-input", "form": "form"}
        )
        return cast(
            Tool, _ToolRuntime(SimpleNamespace(parameters=[parameter], identity=SimpleNamespace(name="search")))
        )


@dataclass
class _ToolRuntime:
    entity: SimpleNamespace

    def get_runtime_parameters(self) -> list[ToolParameter]:
        return []


@dataclass(frozen=True)
class _ApplicationServices:
    app_previews: AppPreviewQueryService
    app_preview_details: AppPreviewDetailsRuntime
    recommended_app_queries: RecommendedAppQueryService


@dataclass(frozen=True)
class _Harness:
    app: Flask
    owner: Tenant
    viewer_workspace: Tenant
    viewer: Account
    author: Account
    updater: Account
    target: App
    config: AppModelConfig
    site: Site
    workflow: Workflow
    tag: Tag
    factory: sessionmaker[Session]
    engine: Engine
    catalog: _Catalog
    io: _ExternalIO
    sessions: list[Session]

    def get(
        self,
        endpoint: _Endpoint = "detail",
        *,
        method: str = "GET",
        csrf_token: str | None = None,
    ) -> TestResponse:
        suffix = "" if endpoint == "detail" else "/workflows"
        statements: list[str] = []
        token = generate_csrf_token(self.viewer.id) if csrf_token is None else csrf_token
        client = self.app.test_client()
        client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)

        def record_statement(
            _connection: Connection,
            _cursor: object,
            statement: str,
            _parameters: object,
            _context: ExecutionContext,
            _executemany: bool,
        ) -> None:
            statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", record_statement)
        try:
            response = client.open(
                f"/trial-apps/{self.target.id}{suffix}", method=method, headers={HEADER_NAME_CSRF_TOKEN: token}
            )
        finally:
            event.remove(self.engine, "before_cursor_execute", record_statement)
        assert not [sql for sql in statements if sql.lstrip().upper().startswith(("INSERT ", "UPDATE ", "DELETE "))]
        assert response.headers["Content-Type"] == "application/json"
        if method != "HEAD":
            assert int(response.headers["Content-Length"]) == len(response.data)
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        assert all(not session.in_transaction() and not session.identity_map for session in self.sessions)
        return response

    def assert_app_not_queried(self) -> None:
        assert self.sessions == []
        assert self.catalog.calls == []
        assert self.io.tool_calls == []
        assert self.io.decryptions == []

    def legacy_detail(self) -> dict[str, object]:
        """The unchanged ORM response view is the pre-migration serialization oracle."""
        with self.app.test_request_context(f"/trial-apps/{self.target.id}"), self.factory() as session:
            app = session.get(App, self.target.id)
            assert app is not None
            app = AppService().get_app(app, session=session)
            return trial_module.TrialAppDetailResponse.model_validate(
                AppResponseView(app, session=session), from_attributes=True
            ).model_dump(mode="json")


@pytest.fixture
def harness(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> _Harness:
    config_overrides(
        LOGIN_DISABLED=False,
        DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY,
        INIT_PASSWORD="",
        SECRET_KEY="preview-admission-test-secret-key",
        CONSOLE_WEB_URL="",
        CONSOLE_API_URL="",
        SERVICE_API_URL="",
        APP_WEB_URL="",
    )
    owner = Tenant(name="App owner")
    viewer_workspace = Tenant(name="Viewer workspace")
    viewer = Account(name="Viewer", email="viewer@example.com", status=AccountStatus.ACTIVE)
    viewer._current_tenant = viewer_workspace
    author = Account(name="Author", email="author@example.com")
    updater = Account(name="Updater", email="updater@example.com")
    target = App(
        id=str(uuid4()),
        tenant_id=owner.id,
        name="Preview app",
        description="",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="",
        icon_background=None,
        enable_site=False,
        enable_api=False,
        max_active_requests=0,
        created_at=_CREATED_AT,
        updated_at=_UPDATED_AT,
    )
    config = AppModelConfig(
        app_id=target.id,
        opening_statement="",
        suggested_questions="[]",
        model='{"provider":"example/model","name":"model","mode":"chat","completion_params":{"temperature":0}}',
        agent_mode='{"enabled":false,"strategy":"function_call","tools":[]}',
        user_input_form='[{"number":{"label":"Count","variable":"count","default":0,"required":false}}]',
    )
    config.created_at = _CREATED_AT
    config.updated_at = _UPDATED_AT
    site = Site(
        app_id=target.id,
        title="Preview site",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code="preview-code",
        icon_type=IconType.EMOJI,
        icon="",
        icon_background=None,
        chat_color_theme="",
        description=None,
        custom_disclaimer="",
        show_workflow_steps=False,
    )
    site.created_at = _CREATED_AT
    site.updated_at = _UPDATED_AT
    io = _ExternalIO(sqlite_engine, owner.id, viewer_workspace.id)
    monkeypatch.setattr(encrypter, "encrypt_token", io.encrypt)
    monkeypatch.setattr(encrypter, "decrypt_token", io.decrypt)
    monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", io.tool_runtime)
    monkeypatch.setattr(ToolManager, "get_hardcoded_provider", lambda _provider_id: object())
    with sqlite_session_factory.begin() as session:
        session.add_all([owner, viewer_workspace, viewer, author, updater, target, config, site])
        session.flush()
        target.created_by = author.id
        target.updated_by = updater.id
        target.app_model_config_id = config.id
        workflow = Workflow.new(
            tenant_id=owner.id,
            app_id=target.id,
            type="workflow",
            version="draft",
            graph='{"nodes":[],"edges":[]}',
            features='{"suggested_questions_after_answer":{"enabled":false}}',
            created_by=author.id,
            environment_variables=[
                SecretVariable(id="secret", name="api_key", value="workflow-secret"),
                LLMEnvironmentVariable(
                    id="llm", name="shared_model", value={"provider": "provider", "name": "model", "mode": "chat"}
                ),
            ],
            conversation_variables=[
                StringVariable(id="topic", name="topic", value="sqlite", selector=["conversation", "topic"])
            ],
            rag_pipeline_variables=[],
        )
        workflow.created_at = _CREATED_AT
        workflow.updated_at = _UPDATED_AT
        workflow.updated_by = updater.id
        target.workflow_id = workflow.id
        tag = Tag(tenant_id=owner.id, type=TagType.APP, name="Owner tag", created_by=author.id)
        session.add_all([workflow, tag])
        session.flush()
        session.add_all(
            [
                TrialApp(app_id=target.id, tenant_id=str(uuid4()), trial_limit=0),
                AccountTrialAppRecord(app_id=target.id, account_id=viewer.id, count=100),
                TagBinding(tenant_id=owner.id, tag_id=tag.id, target_id=target.id, created_by=author.id),
                WorkflowToolProvider(
                    name="trial-workflow",
                    label="Trial workflow",
                    icon="icon",
                    app_id=target.id,
                    version="1.0.0",
                    user_id=author.id,
                    tenant_id=owner.id,
                    description="Workflow provider",
                    parameter_configuration="[]",
                ),
            ]
        )
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    sessions: list[Session] = []

    @event.listens_for(factory, "after_begin")
    def track_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert all(previous is session or not previous.in_transaction() for previous in sessions)
        sessions.append(session)

    catalog = _Catalog(sqlite_engine)
    recommendations = RecommendedAppQueryService(
        catalog=catalog, trial_apps=TrialAppRepository(factory), trial_enabled=False
    )
    services = _ApplicationServices(
        app_previews=AppPreviewQueryService(
            apps=AppPreviewQueryRepository(session_factory=factory), is_previewable=recommendations.is_previewable
        ),
        app_preview_details=AppPreviewDetailsRuntime(details=AppPreviewQueryRepository(session_factory=factory)),
        recommended_app_queries=recommendations,
    )
    for module in (trial_module, admission_module):
        monkeypatch.setattr(module, "application_services", lambda: services)
    monkeypatch.setattr(login_module, "current_user", viewer)
    monkeypatch.setattr(app_module, "current_user", viewer)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: True)
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False)
    login_manager = DifyLoginManager()
    login_manager.init_app(app)
    login_manager.unauthorized_handler(unauthorized_handler)
    api = ExternalApi(app)
    api.error_handlers = console_api.error_handlers.copy()
    api.add_resource(trial_module.AppApi, "/trial-apps/<uuid:app_id>")
    api.add_resource(trial_module.AppWorkflowApi, "/trial-apps/<uuid:app_id>/workflows")
    return _Harness(
        app,
        owner,
        viewer_workspace,
        viewer,
        author,
        updater,
        target,
        config,
        site,
        workflow,
        tag,
        sqlite_session_factory,
        sqlite_engine,
        catalog,
        io,
        sessions,
    )


def _assert_error(response: TestResponse, status: int, code: str) -> None:
    assert response.status_code == status, response.get_json()
    body = response.get_json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["message"]


@pytest.mark.parametrize(
    "mode", [AppMode.CHAT, AppMode.COMPLETION, AppMode.ADVANCED_CHAT, AppMode.WORKFLOW, AppMode.AGENT_CHAT]
)
def test_app_detail_keeps_original_response_fields_and_stored_audit_times(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    expected = harness.legacy_detail()
    if mode == AppMode.AGENT_CHAT:
        expected_config = expected["model_config"]
        assert isinstance(expected_config, dict)
        # Legacy masking could autoflush a response-only config mutation and bump
        # this timestamp. A read-only preview returns the actual stored audit value.
        expected_config["updated_at"] = int(_UPDATED_AT.timestamp())

    response = harness.get()

    assert response.status_code == 200, response.get_json()
    assert response.get_json() == expected
    body = response.get_json()
    assert body["max_active_requests"] == 0
    assert body["enable_site"] is False
    assert body["tags"] == [{"id": harness.tag.id, "name": "Owner tag", "type": "app"}]
    assert body["api_base_url"] == "http://localhost/v1"
    assert body["site"]["app_base_url"] == "http://localhost"
    assert body["site"]["access_token"] == "preview-code"
    with harness.factory() as session:
        assert session.scalar(select(AccountTrialAppRecord.count)) == 100
        assert (
            session.scalar(select(AppModelConfig.updated_at).where(AppModelConfig.id == harness.config.id))
            == _UPDATED_AT
        )


def test_legacy_agent_preview_masks_tools_without_upgrading_mode_or_mutating_config(harness: _Harness) -> None:
    agent_mode = {
        "enabled": True,
        "strategy": "function_call",
        "tools": [
            {
                "provider_type": "builtin",
                "provider_id": "example",
                "tool_name": "search",
                "tool_parameters": {"api_key": "cipher-tool"},
            }
        ],
    }
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(agent_mode=json.dumps(agent_mode))
        )
        app_updated_at = session.scalar(select(App.updated_at).where(App.id == harness.target.id))
        config_updated_at = session.scalar(
            select(AppModelConfig.updated_at).where(AppModelConfig.id == harness.config.id)
        )

    response = harness.get()

    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["mode"] == "agent-chat"
    assert body["model_config"]["agent_mode"]["tools"][0]["tool_parameters"] == {"api_key": "to*******et"}
    assert harness.io.tool_calls == [(harness.viewer_workspace.id, harness.target.id, harness.viewer.id)]
    assert harness.io.decryptions == [(harness.viewer_workspace.id, "cipher-tool")]
    assert harness.viewer_workspace.id != harness.owner.id
    with harness.factory() as session:
        app = session.get(App, harness.target.id)
        config = session.get(AppModelConfig, harness.config.id)
        assert app is not None
        assert config is not None
        assert app.mode == AppMode.CHAT
        assert app.updated_at == app_updated_at
        assert config.agent_mode == json.dumps(agent_mode)
        assert config.updated_at == config_updated_at


@pytest.mark.parametrize(
    "provider_fields",
    [{}, {"provider_id": None}, {"provider_id": 42}, {"provider_id": ""}, {"provider_id": "invalid/provider"}],
    ids=["missing", "null", "non-string", "empty", "invalid-format"],
)
def test_invalid_builtin_config_does_not_break_detail_or_valid_tool_masking(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, provider_fields: dict[str, JsonValue]
) -> None:
    agent_mode: dict[str, JsonValue] = {
        "enabled": True,
        "strategy": "function_call",
        "tools": [
            {
                "provider_type": "builtin",
                "tool_name": "broken",
                "tool_parameters": {"api_key": "cipher-secret"},
                "credential_id": None,
                **provider_fields,
            },
            {
                "provider_type": "builtin",
                "provider_id": "example",
                "tool_name": "search",
                "tool_parameters": {"api_key": "cipher-tool"},
            },
        ],
    }
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(agent_mode=json.dumps(agent_mode))
        )

    def hardcoded_provider(provider_id: str) -> object:
        if provider_id == "example":
            return object()
        raise KeyError(provider_id)

    def tool_runtime(*, tenant_id: str, app_id: str, agent_tool: AgentToolEntity, user_id: str) -> Tool:
        if agent_tool.provider_id != "example":
            raise ValueError("Invalid historical provider ID")
        return harness.io.tool_runtime(tenant_id=tenant_id, app_id=app_id, agent_tool=agent_tool, user_id=user_id)

    plugin_queries: list[str] = []

    def check_plugins(tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
        assert tenant_id == harness.owner.id
        plugin_queries.extend(str(provider_id) for provider_id in provider_ids)
        return [False] * len(provider_ids)

    monkeypatch.setattr(ToolManager, "get_hardcoded_provider", hardcoded_provider)
    monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", tool_runtime)
    monkeypatch.setattr(PluginService, "check_tools_existence", check_plugins)

    response = harness.get()

    assert response.status_code == 200, response.get_json()
    body = response.get_json()
    assert body["deleted_tools"] == []
    assert body["model_config"]["agent_mode"]["tools"][0]["tool_parameters"] == {}
    assert body["model_config"]["agent_mode"]["tools"][1]["tool_parameters"] == {"api_key": "to*******et"}
    assert b"cipher-secret" not in response.data
    assert plugin_queries == []
    assert harness.io.tool_calls == [(harness.viewer_workspace.id, harness.target.id, harness.viewer.id)]
    with harness.factory() as session:
        assert session.scalar(
            select(AppModelConfig.agent_mode).where(AppModelConfig.id == harness.config.id)
        ) == json.dumps(agent_mode)


@pytest.mark.parametrize("failure", ["short-config", "runtime", "masking"])
def test_unmaskable_tool_parameters_are_removed_from_detail_without_changing_storage(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    broken_tool: dict[str, JsonValue] = {
        "provider_type": "builtin",
        "tool_parameters": {"api_key": "cipher-secret"},
    }
    if failure != "short-config":
        broken_tool.update(provider_id="broken", tool_name="broken")
    agent_mode: dict[str, JsonValue] = {
        "enabled": True,
        "strategy": "function_call",
        "tools": [
            broken_tool,
            {
                "provider_type": "builtin",
                "provider_id": "example",
                "tool_name": "search",
                "tool_parameters": {"api_key": "cipher-tool"},
            },
        ],
    }
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(agent_mode=json.dumps(agent_mode))
        )

    class MaskingFailureRuntime(_ToolRuntime):
        parameter_queries: int = 0

        @override
        def get_runtime_parameters(self) -> list[ToolParameter]:
            self.parameter_queries += 1
            if self.parameter_queries == 2:
                raise RuntimeError("Tool metadata became unavailable during masking")
            return []

    parameter = ToolParameter.model_validate(
        {"name": "api_key", "label": {"en_US": "Key"}, "type": "secret-input", "form": "form"}
    )
    broken_runtime = MaskingFailureRuntime(
        SimpleNamespace(parameters=[parameter], identity=SimpleNamespace(name="broken"))
    )

    def tool_runtime(*, tenant_id: str, app_id: str, agent_tool: AgentToolEntity, user_id: str) -> Tool:
        if agent_tool.provider_id == "example":
            return harness.io.tool_runtime(tenant_id=tenant_id, app_id=app_id, agent_tool=agent_tool, user_id=user_id)
        if failure == "runtime":
            raise RuntimeError("Tool provider is unavailable")
        return cast(Tool, broken_runtime)

    def decrypt(tenant_id: str, token: str) -> str:
        if token == "cipher-secret":
            assert tenant_id == harness.viewer_workspace.id
            return "plain-secret"
        return harness.io.decrypt(tenant_id, token)

    monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", tool_runtime)
    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)

    response = harness.get()

    assert response.status_code == 200, response.get_json()
    tools = response.get_json()["model_config"]["agent_mode"]["tools"]
    assert tools[0]["tool_parameters"] == {}
    assert tools[1]["tool_parameters"] == {"api_key": "to*******et"}
    assert b"cipher-secret" not in response.data
    assert b"plain-secret" not in response.data
    assert broken_runtime.parameter_queries == (2 if failure == "masking" else 0)
    with harness.factory() as session:
        assert session.scalar(
            select(AppModelConfig.agent_mode).where(AppModelConfig.id == harness.config.id)
        ) == json.dumps(agent_mode)


def test_workflow_is_anonymous_and_masks_secrets_after_query_session_closes(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(login_module, "current_user", None)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: False)
    response = harness.get("workflows", csrf_token="")
    assert response.status_code == 200, response.get_json()
    assert response.get_json() == {
        "id": harness.workflow.id,
        "graph": {"nodes": [], "edges": []},
        "features": {"suggested_questions_after_answer": {"enabled": False}},
        "hash": harness.workflow.unique_hash,
        "version": "draft",
        "marked_name": "",
        "marked_comment": "",
        "created_by": {"id": harness.author.id, "name": "Author", "email": "author@example.com"},
        "created_at": int(_CREATED_AT.timestamp()),
        "updated_by": {"id": harness.updater.id, "name": "Updater", "email": "updater@example.com"},
        "updated_at": int(_UPDATED_AT.timestamp()),
        "tool_published": True,
        "environment_variables": [
            {
                "value_type": "secret",
                "value": encrypter.full_mask_token(),
                "id": "secret",
                "name": "api_key",
                "description": "",
                "selector": ["env", "api_key"],
            },
            {
                "value_type": "llm",
                "value": {"provider": "provider", "name": "model", "mode": "chat"},
                "id": "llm",
                "name": "shared_model",
                "description": "",
                "selector": ["env", "shared_model"],
            },
        ],
        "conversation_variables": [
            {"id": "topic", "name": "topic", "value_type": "string", "value": "sqlite", "description": ""}
        ],
        "rag_pipeline_variables": [],
    }
    assert harness.io.decryptions == [(harness.owner.id, "cipher-workflow")]
    assert b"workflow-secret" not in response.data
    assert b"cipher-workflow" not in response.data


@pytest.mark.parametrize("endpoint", ["detail", "workflows"])
def test_catalog_only_admission_keeps_preview_available(harness: _Harness, endpoint: _Endpoint) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
    harness.catalog.ids.add(harness.target.id)
    response = harness.get(endpoint)
    assert response.status_code == 200, response.get_json()
    assert harness.catalog.calls == [harness.target.id]


@pytest.mark.parametrize("endpoint", ["detail", "workflows"])
@pytest.mark.parametrize("unavailable", ["unlisted", "disabled", "missing"])
def test_unavailable_apps_fail_admission(harness: _Harness, endpoint: _Endpoint, unavailable: str) -> None:
    with harness.factory.begin() as session:
        if unavailable == "unlisted":
            session.execute(delete(TrialApp).where(TrialApp.app_id == harness.target.id))
        elif unavailable == "disabled":
            session.execute(text("UPDATE apps SET status='disabled' WHERE id=:app_id"), {"app_id": harness.target.id})
        else:
            session.execute(delete(App).where(App.id == harness.target.id))
    _assert_error(harness.get(endpoint), 404, "app_not_found")
    assert harness.io.decryptions == []


def test_anonymous_app_detail_requires_account(harness: _Harness, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(login_module, "current_user", None)
    response = harness.get()
    assert response.status_code == 401
    assert response.get_json() == {"code": "unauthorized", "message": "Unauthorized."}
    harness.assert_app_not_queried()


@pytest.mark.parametrize(("init_password", "error_code"), [("", "not_setup"), ("setup-password", "not_init_validated")])
def test_app_detail_requires_setup_before_account_or_app_queries(
    harness: _Harness,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    init_password: str,
    error_code: str,
) -> None:
    config_overrides(INIT_PASSWORD=init_password)
    monkeypatch.setattr(console_wraps, "_is_setup_completed", lambda: False)
    monkeypatch.setattr(login_module, "current_user", None)
    _assert_error(harness.get(csrf_token=""), 401, error_code)
    harness.assert_app_not_queried()


@pytest.mark.parametrize("csrf_token", ["", "invalid-signed-token"], ids=["missing", "invalid"])
def test_app_detail_rejects_invalid_csrf_before_app_queries(harness: _Harness, csrf_token: str) -> None:
    response = harness.get(csrf_token=csrf_token)
    _assert_error(response, 401, "unauthorized")
    assert response.get_json()["message"] == "CSRF token is missing or invalid."
    harness.assert_app_not_queried()


def test_app_detail_rejects_csrf_token_for_another_account(harness: _Harness) -> None:
    response = harness.get(csrf_token=generate_csrf_token(harness.author.id))
    _assert_error(response, 401, "unauthorized")
    assert response.get_json()["message"] == "CSRF token is missing or invalid."
    harness.assert_app_not_queried()


def test_app_detail_rejects_uninitialized_account_before_app_queries(harness: _Harness) -> None:
    harness.viewer.status = AccountStatus.UNINITIALIZED
    _assert_error(harness.get(), 400, "account_not_initialized")
    harness.assert_app_not_queried()


def test_missing_active_workspace_uses_shared_console_error_and_monitoring(harness: _Harness) -> None:
    harness.viewer._current_tenant = None
    errors: list[BaseException] = []

    def record_error(_sender: object, *, exception: BaseException) -> None:
        errors.append(exception)

    with got_request_exception.connected_to(record_error):
        response = harness.get()

    _assert_error(response, 500, "active_workspace_required")
    assert response.get_json()["message"] == "Internal Server Error"
    assert len(errors) == 1
    assert isinstance(errors[0], ActiveWorkspaceRequiredError)
    harness.assert_app_not_queried()


def test_deleted_admitted_account_is_unauthorized(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Account).where(Account.id == harness.viewer.id))
    _assert_error(harness.get(), 401, "unauthorized")


def test_missing_site_is_specific_error(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Site).where(Site.app_id == harness.target.id))
    _assert_error(harness.get(), 403, "app_site_unavailable")


def test_missing_model_config_retains_nullable_detail(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(AppModelConfig).where(AppModelConfig.id == harness.config.id))
    response = harness.get()
    assert response.status_code == 200, response.get_json()
    assert response.get_json()["model_config"] is None


@pytest.mark.parametrize("missing", ["reference", "workflow"])
def test_missing_workflow_is_app_unavailable(harness: _Harness, missing: str) -> None:
    with harness.factory.begin() as session:
        if missing == "reference":
            session.execute(update(App).where(App.id == harness.target.id).values({App.workflow_id: None}))
        else:
            session.execute(delete(Workflow).where(Workflow.id == harness.workflow.id))
    _assert_error(harness.get("workflows"), 400, "app_unavailable")


@pytest.mark.parametrize("endpoint", ["detail", "workflows"])
def test_head_keeps_get_status_and_headers_without_response_body(harness: _Harness, endpoint: _Endpoint) -> None:
    response = harness.get(endpoint)
    head = harness.get(endpoint, method="HEAD")
    assert response.status_code == head.status_code == 200
    assert head.data == b""
    assert head.headers == response.headers


@pytest.mark.parametrize(
    ("endpoint", "relation"), [("detail", "config"), ("detail", "workflow"), ("workflows", "workflow")]
)
def test_cross_owner_configuration_is_not_exposed(harness: _Harness, endpoint: _Endpoint, relation: str) -> None:
    with harness.factory.begin() as session:
        if relation == "config":
            session.execute(
                update(AppModelConfig).where(AppModelConfig.id == harness.config.id).values(app_id=str(uuid4()))
            )
        else:
            session.execute(update(Workflow).where(Workflow.id == harness.workflow.id).values(tenant_id=str(uuid4())))
    _assert_error(harness.get(endpoint), 400, "app_unavailable")
    assert harness.io.decryptions == []
