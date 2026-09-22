"""Real preview detail reads preserve ownership, masking and transaction boundaries."""

import json
from collections.abc import Iterator, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Literal, cast, override
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, ExecutionContext, delete, event, select, text, update
from sqlalchemy.orm import Session, SessionTransaction, UOWTransaction, sessionmaker
from sqlalchemy.pool import QueuePool

import core.agent.tool_configuration as tool_configuration_module
import core.helper.tool_parameter_cache as cache_module
from core.agent.entities import AgentToolEntity
from core.helper import encrypter
from core.plugin.plugin_service import PluginService
from core.tools.__base.tool import Tool
from core.tools.entities.tool_entities import ApiProviderSchemaType, ToolEntity, ToolParameter
from core.tools.tool_manager import ToolManager
from extensions.ext_database import db
from graphon.variables import SecretVariable
from models import Account, App
from models.account import Tenant
from models.enums import CustomizeTokenStrategy
from models.model import AppMode, AppModelConfig, Site
from models.provider_ids import GenericProviderID
from models.tools import ApiToolProvider
from models.workflow import Workflow, WorkflowType
from repositories.app_preview_query_repository import AppPreviewQueryRepository
from services.account_errors import AccountNotFoundError
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.app_preview_details_adapters import AppPreviewDetailsRuntime
from services.app_preview_details_service import AppPreviewDetail
from services.app_preview_query_service import AppPreviewRef, AppPreviewSiteUnavailableError, AppPreviewUnavailableError


@dataclass(frozen=True)
class _Harness:
    flask_app: Flask
    target: App
    decoy: App
    account: Account
    active_workspace: Tenant
    config: AppModelConfig
    decoy_config: AppModelConfig
    workflow: Workflow
    decoy_workflow: Workflow
    factory: sessionmaker[Session]
    engine: Engine
    runtime: AppPreviewDetailsRuntime
    closed: list[Session]
    mutated: list[object]
    commits: list[Session]
    writes: list[str]

    @property
    def reference(self) -> AppPreviewRef:
        return AppPreviewRef(app_id=self.target.id, tenant_id=self.target.tenant_id)

    def detail(self, *, app: AppPreviewRef | None = None, account_id: str | None = None) -> AppPreviewDetail:
        return self.runtime.get_detail(
            app=app or self.reference,
            account_id=account_id or self.account.id,
            active_workspace_id=self.active_workspace.id,
        )

    def assert_closed(self) -> None:
        assert isinstance(self.engine.pool, QueuePool)
        assert self.engine.pool.checkedout() == 0
        assert self.closed
        assert all(not session.in_transaction() and not session.identity_map for session in self.closed)

    def assert_read_only(self) -> None:
        self.assert_closed()
        assert self.mutated == []
        assert self.commits == []
        assert self.writes == []


@pytest.fixture
def harness(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Harness]:
    target = App(
        id=str(uuid4()), tenant_id=str(uuid4()), name="Preview", mode="chat", enable_site=True, enable_api=True
    )
    decoy = App(id=str(uuid4()), tenant_id=str(uuid4()), name="Decoy", mode="chat", enable_site=True, enable_api=True)
    account = Account(name="Viewer", email="preview@example.com")
    active_workspace = Tenant(name="Active workspace")
    config = AppModelConfig(app_id=target.id, opening_statement="Preview opening", pre_prompt="Visible prompt")
    decoy_config = AppModelConfig(app_id=decoy.id, opening_statement="Other tenant prompt")
    with sqlite_session_factory.begin() as session:
        session.add_all([target, decoy, account, active_workspace, config, decoy_config])
        session.flush()
        target.app_model_config_id = config.id
        decoy.app_model_config_id = decoy_config.id
        workflow = Workflow(
            tenant_id=target.tenant_id,
            app_id=target.id,
            type=WorkflowType.CHAT,
            version="published",
            graph='{"nodes":[],"edges":[]}',
            features='{"opening_statement":"Workflow opening"}',
            created_by=account.id,
            updated_by=account.id,
        )
        decoy_workflow = Workflow(
            tenant_id=decoy.tenant_id,
            app_id=decoy.id,
            type=WorkflowType.CHAT,
            version="published",
            graph='{"nodes":[],"edges":[]}',
            features='{"opening_statement":"Other tenant workflow"}',
            created_by=account.id,
        )
        session.add_all([workflow, decoy_workflow])
        session.flush()
        target.workflow_id = workflow.id
        decoy.workflow_id = decoy_workflow.id
        session.add_all(
            [
                Site(
                    app_id=target.id,
                    title="Preview site",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.UUID,
                ),
                Site(
                    app_id=decoy.id,
                    title="Decoy site",
                    default_language="en-US",
                    customize_token_strategy=CustomizeTokenStrategy.UUID,
                ),
            ]
        )
    closed: list[Session] = []
    mutated: list[object] = []
    commits: list[Session] = []
    writes: list[str] = []

    def record_changes(session: Session) -> None:
        mutated.extend(session.new)
        mutated.extend(session.dirty)
        mutated.extend(session.deleted)

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            record_changes(self)
            super().close()
            closed.append(self)

    factory: sessionmaker[Session] = sessionmaker(bind=sqlite_engine, class_=TrackedSession, expire_on_commit=False)

    @event.listens_for(factory, "before_flush")
    def before_flush(session: Session, _context: UOWTransaction, _instances: Sequence[object] | None) -> None:
        record_changes(session)

    @event.listens_for(factory, "before_commit")
    def before_commit(session: Session) -> None:
        commits.append(session)

    def before_cursor_execute(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().split(maxsplit=1)[0].upper() in {"INSERT", "UPDATE", "DELETE"}:
            writes.append(statement)

    @event.listens_for(factory, "after_begin")
    def after_begin(_session: Session, _transaction: SessionTransaction, connection: Connection) -> None:
        event.listen(connection, "before_cursor_execute", before_cursor_execute)

    flask_app = Flask(__name__)
    flask_app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(flask_app)
    yield _Harness(
        flask_app,
        target,
        decoy,
        account,
        active_workspace,
        config,
        decoy_config,
        workflow,
        decoy_workflow,
        sqlite_session_factory,
        sqlite_engine,
        AppPreviewDetailsRuntime(details=AppPreviewQueryRepository(session_factory=factory)),
        closed,
        mutated,
        commits,
        writes,
    )
    with flask_app.app_context():
        db.session.remove()
        db.engine.dispose()


def _serialize_date(value: object) -> str:
    assert isinstance(value, datetime), f"Non-data value escaped runtime: {type(value)}"
    return value.isoformat()


@pytest.mark.parametrize("endpoint", ["detail", "workflow"])
def test_preview_result_contains_only_detached_data(harness: _Harness, endpoint: Literal["detail", "workflow"]) -> None:
    with harness.flask_app.app_context():
        result = harness.detail() if endpoint == "detail" else harness.runtime.get_workflow(app=harness.reference)
    assert result.id == (harness.target.id if endpoint == "detail" else harness.workflow.id)
    json.dumps(asdict(result), default=_serialize_date)
    if isinstance(result, AppPreviewDetail):
        assert result.site.title == "Preview site"
        assert result.model_config is not None
        assert result.model_config["opening_statement"] == "Preview opening"
        assert result.workflow is not None
        assert result.workflow.id == harness.workflow.id
    else:
        assert result.features["opening_statement"] == "Workflow opening"
        assert result.created_by is not None
        assert result.created_by.id == harness.account.id
        assert result.updated_by == result.created_by
    harness.assert_read_only()


@pytest.mark.parametrize("plugin_failure", [False, True])
def test_deleted_tools_check_owner_scoped_provider_snapshot_after_session_closes(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, plugin_failure: bool
) -> None:
    own_provider = ApiToolProvider(
        name="Owner API",
        icon="icon",
        schema="{}",
        schema_type_str=ApiProviderSchemaType.OPENAPI,
        user_id=harness.account.id,
        tenant_id=harness.target.tenant_id,
        description="Owner provider",
        tools_str="[]",
        credentials_str="{}",
    )
    other_provider = ApiToolProvider(
        name="Viewer API",
        icon="icon",
        schema="{}",
        schema_type_str=ApiProviderSchemaType.OPENAPI,
        user_id=harness.account.id,
        tenant_id=harness.active_workspace.id,
        description="Provider from another tenant",
        tools_str="[]",
        credentials_str="{}",
    )
    missing_api_id = str(uuid4())
    configured_tools = [
        ("builtin", "acme/missing/missing", "missing-plugin"),
        ("builtin", "local", "hardcoded"),
        ("api", other_provider.id, "other-tenant-api"),
        ("builtin", "acme/present/present", "present-plugin"),
        ("api", own_provider.id, "owner-api"),
        ("api", missing_api_id, "missing-api"),
    ]
    with harness.factory.begin() as session:
        session.add_all([own_provider, other_provider])
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(
                agent_mode=json.dumps(
                    {
                        "enabled": False,
                        "tools": [
                            {
                                "provider_type": kind,
                                "provider_id": provider_id,
                                "tool_name": name,
                                "tool_parameters": {},
                            }
                            for kind, provider_id, name in configured_tools
                        ],
                    }
                )
            )
        )
    calls: list[tuple[str, tuple[str, ...]]] = []

    def hardcoded_provider(provider_id: str) -> object:
        harness.assert_closed()
        if provider_id == "local":
            return object()
        raise KeyError(provider_id)

    def check_plugins(tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
        harness.assert_read_only()
        calls.append((tenant_id, tuple(str(provider_id) for provider_id in provider_ids)))
        if plugin_failure:
            raise RuntimeError("Plugin daemon unavailable")
        return [False, True]

    monkeypatch.setattr(ToolManager, "get_hardcoded_provider", hardcoded_provider)
    monkeypatch.setattr(PluginService, "check_tools_existence", check_plugins)
    with harness.flask_app.app_context():
        if plugin_failure:
            with pytest.raises(RuntimeError, match="Plugin daemon unavailable"):
                harness.detail()
        else:
            detail = harness.detail()
            assert [asdict(tool) for tool in detail.deleted_tools] == [
                {"type": "builtin", "tool_name": "missing-plugin", "provider_id": "acme/missing/missing"},
                {"type": "api", "tool_name": "other-tenant-api", "provider_id": other_provider.id},
                {"type": "api", "tool_name": "missing-api", "provider_id": missing_api_id},
            ]
    assert calls == [(harness.target.tenant_id, ("acme/missing/missing", "acme/present/present"))]
    harness.assert_read_only()


@pytest.mark.parametrize(
    "malformed_fields",
    [
        {},
        {"provider_id": None},
        {"provider_id": 1},
        {"provider_id": {}},
        {"provider_id": ""},
        {"provider_id": "invalid/provider-id"},
    ],
    ids=["missing", "null", "number", "object", "empty", "invalid-format"],
)
def test_deleted_tools_ignore_invalid_builtin_config_and_keep_valid_missing_provider(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, malformed_fields: dict[str, JsonValue]
) -> None:
    configured_tools: list[dict[str, JsonValue]] = [
        {
            "provider_type": "builtin",
            "tool_name": "invalid-plugin",
            "tool_parameters": {},
            "enabled": True,
            **malformed_fields,
        },
        {
            "provider_type": "builtin",
            "provider_id": "acme/missing/missing",
            "tool_name": "missing-plugin",
            "tool_parameters": {},
        },
    ]
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(agent_mode=json.dumps({"enabled": False, "tools": configured_tools}))
        )
    calls: list[tuple[str, tuple[str, ...]]] = []

    def hardcoded_provider(provider_id: str) -> object:
        harness.assert_closed()
        raise KeyError(provider_id)

    def check_plugins(tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> Sequence[bool]:
        harness.assert_read_only()
        calls.append((tenant_id, tuple(str(provider_id) for provider_id in provider_ids)))
        return [False]

    monkeypatch.setattr(ToolManager, "get_hardcoded_provider", hardcoded_provider)
    monkeypatch.setattr(PluginService, "check_tools_existence", check_plugins)
    with harness.flask_app.app_context():
        detail = harness.detail()

    assert calls == [(harness.target.tenant_id, ("acme/missing/missing",))]
    assert [asdict(tool) for tool in detail.deleted_tools] == [
        {"type": "builtin", "tool_name": "missing-plugin", "provider_id": "acme/missing/missing"}
    ]
    assert detail.model_config is not None
    agent_mode = detail.model_config["agent_mode"]
    assert isinstance(agent_mode, dict)
    assert agent_mode["tools"] == configured_tools
    harness.assert_read_only()


@pytest.mark.parametrize("endpoint", ["detail", "workflow"])
@pytest.mark.parametrize("change", ["missing", "tenant", "status"])
def test_app_scope_never_falls_back_to_another_valid_app(
    harness: _Harness, endpoint: Literal["detail", "workflow"], change: Literal["missing", "tenant", "status"]
) -> None:
    reference = harness.reference
    if change == "missing":
        reference = AppPreviewRef(app_id=str(uuid4()), tenant_id=reference.tenant_id)
    elif change == "tenant":
        reference = AppPreviewRef(app_id=reference.app_id, tenant_id=harness.decoy.tenant_id)
    else:
        with harness.factory.begin() as session:
            session.execute(
                text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": reference.app_id}
            )
    get = harness.detail if endpoint == "detail" else harness.runtime.get_workflow
    with harness.flask_app.app_context(), pytest.raises(AppPreviewUnavailableError):
        get(app=reference)
    harness.assert_closed()


def test_detail_rejects_missing_account(harness: _Harness) -> None:
    account_id = str(uuid4())
    with harness.flask_app.app_context(), pytest.raises(AccountNotFoundError, match=account_id):
        harness.detail(account_id=account_id)
    harness.assert_closed()


def test_detail_rejects_missing_site(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Site).where(Site.app_id == harness.target.id))
    with harness.flask_app.app_context(), pytest.raises(AppPreviewSiteUnavailableError):
        harness.detail()
    harness.assert_closed()


def test_detail_rejects_config_link_to_another_app(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(App).where(App.id == harness.target.id).values({App.app_model_config_id: harness.decoy_config.id})
        )
    with harness.flask_app.app_context(), pytest.raises(AppDefinitionUnavailableError):
        harness.detail()
    harness.assert_closed()


def test_detail_missing_model_config_is_optional(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(AppModelConfig).where(AppModelConfig.id == harness.config.id))
    with harness.flask_app.app_context():
        result = harness.detail()
    assert result.model_config is None
    harness.assert_closed()


def test_detail_closes_session_if_model_config_cannot_be_decoded(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(AppModelConfig).where(AppModelConfig.id == harness.config.id).values(model="{"))
    with harness.flask_app.app_context(), pytest.raises(json.JSONDecodeError):
        harness.detail()
    harness.assert_closed()


@pytest.mark.parametrize("endpoint", ["detail", "workflow"])
@pytest.mark.parametrize("wrong_owner", ["app", "tenant"])
def test_workflow_link_checks_both_app_and_tenant(
    harness: _Harness, endpoint: Literal["detail", "workflow"], wrong_owner: Literal["app", "tenant"]
) -> None:
    values = {"app_id": harness.decoy.id} if wrong_owner == "app" else {"tenant_id": harness.decoy.tenant_id}
    with harness.factory.begin() as session:
        session.execute(update(Workflow).where(Workflow.id == harness.workflow.id).values(values))
    get = harness.detail if endpoint == "detail" else harness.runtime.get_workflow
    with harness.flask_app.app_context(), pytest.raises(AppDefinitionUnavailableError):
        get(app=harness.reference)
    harness.assert_closed()


@pytest.mark.parametrize("endpoint", ["detail", "workflow"])
def test_missing_workflow_is_optional_only_in_app_detail(
    harness: _Harness, endpoint: Literal["detail", "workflow"]
) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Workflow).where(Workflow.id == harness.workflow.id))
    with harness.flask_app.app_context():
        if endpoint == "detail":
            assert harness.detail().workflow is None
        else:
            with pytest.raises(AppDefinitionUnavailableError):
                harness.runtime.get_workflow(app=harness.reference)
    harness.assert_closed()


@pytest.mark.parametrize("legacy_agent", [False, True])
def test_detail_computes_legacy_mode_without_writes_or_committing_callers_session(
    harness: _Harness, legacy_agent: bool
) -> None:
    if legacy_agent:
        with harness.factory.begin() as session:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.config.id)
                .values(agent_mode=json.dumps({"enabled": True, "strategy": "react", "tools": []}))
            )
    with harness.flask_app.app_context():
        caller = db.session()
        account = caller.get(Account, harness.account.id)
        assert account is not None
        account.name = "Uncommitted caller edit"
        result = harness.detail()
        assert db.session() is caller
        assert account in caller.dirty
        assert result.mode == (AppMode.AGENT_CHAT if legacy_agent else AppMode.CHAT)
        harness.assert_read_only()
        with harness.factory() as session:
            assert session.scalar(select(Account.name).where(Account.id == account.id)) == "Viewer"
            assert session.scalar(select(App.mode).where(App.id == harness.target.id)) == AppMode.CHAT


@pytest.mark.parametrize("failure", [False, True])
def test_workflow_secret_decryption_happens_after_query_session_closes(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, failure: bool
) -> None:
    secret = SecretVariable(id=str(uuid4()), name="api_key", value="encrypted", selector=["env", "api_key"])
    with harness.factory.begin() as session:
        session.execute(
            update(Workflow)
            .where(Workflow.id == harness.workflow.id)
            .values({Workflow._environment_variables: json.dumps({secret.name: secret.model_dump(mode="json")})})
        )
    calls: list[str] = []

    def decrypt(tenant_id: str, token: str) -> str:
        harness.assert_closed()
        assert token == "encrypted"
        calls.append(tenant_id)
        if failure:
            raise RuntimeError("Key service unavailable")
        return "decrypted-secret"

    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)
    with harness.flask_app.app_context():
        if failure:
            with pytest.raises(RuntimeError, match="Key service unavailable"):
                harness.runtime.get_workflow(app=harness.reference)
        else:
            result = harness.runtime.get_workflow(app=harness.reference)
            assert result.environment_variables[0]["value"] == "decrypted-secret"
            assert result.environment_variables[0]["value_type"] == "secret"
    assert calls == [harness.target.tenant_id]
    harness.assert_closed()


@dataclass
class _ExternalTool:
    entity: ToolEntity

    def get_runtime_parameters(self) -> list[ToolParameter]:
        return []


class _EmptyCache:
    def get(self, key: str) -> None:
        assert key

    def setex(self, key: str, expiry: int, value: str) -> None:
        assert key
        assert expiry > 0
        assert value


@pytest.mark.parametrize("failure", ["none", "runtime", "decrypt"])
def test_agent_tool_masking_returns_a_copy_without_dirtying_or_flushing_models(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, failure: Literal["none", "runtime", "decrypt"]
) -> None:
    provider_id = str(uuid4())
    agent_mode = {
        "enabled": True,
        "strategy": "react",
        "tools": [
            {
                "provider_type": "workflow",
                "provider_id": provider_id,
                "tool_name": "search",
                "tool_parameters": {"api_key": "encrypted"},
            }
        ],
    }
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.AGENT_CHAT))
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.config.id)
            .values(agent_mode=json.dumps(agent_mode))
        )
    tool = _ExternalTool(
        ToolEntity.model_validate(
            {
                "identity": {"author": "test", "name": "search", "label": {"en_US": "Search"}, "provider": provider_id},
                "parameters": [{"name": "api_key", "label": {"en_US": "Key"}, "type": "secret-input", "form": "form"}],
            }
        )
    )
    calls: list[str] = []
    checkedout_during_io: list[int] = []

    def runtime(*, tenant_id: str, app_id: str, agent_tool: AgentToolEntity, user_id: str) -> Tool:
        assert isinstance(harness.engine.pool, QueuePool)
        checkedout_during_io.append(harness.engine.pool.checkedout())
        harness.assert_closed()
        assert tenant_id == harness.active_workspace.id
        assert tenant_id != harness.target.tenant_id
        assert app_id == harness.target.id
        assert user_id == harness.account.id
        assert agent_tool.tool_name == "search"
        calls.append(tenant_id)
        if failure == "runtime":
            raise RuntimeError("Tool provider unavailable")
        return cast(Tool, tool)

    def decrypt(tenant_id: str, token: str) -> str:
        assert isinstance(harness.engine.pool, QueuePool)
        checkedout_during_io.append(harness.engine.pool.checkedout())
        harness.assert_closed()
        assert tenant_id == harness.active_workspace.id
        assert token == "encrypted"
        if failure == "decrypt":
            raise RuntimeError("Credential provider unavailable")
        return "secret-value"

    monkeypatch.setattr(tool_configuration_module.ToolManager, "get_agent_tool_runtime", runtime)
    monkeypatch.setattr(cache_module, "redis_client", _EmptyCache())
    monkeypatch.setattr(encrypter, "decrypt_token", decrypt)
    original_agent_mode = json.dumps(agent_mode)
    with harness.flask_app.app_context():
        result = harness.detail()
        masked_copy = tool_configuration_module.mask_agent_tool_parameters(
            agent_mode=cast(dict[str, JsonValue], agent_mode),
            app_id=harness.target.id,
            tenant_id=harness.active_workspace.id,
            user_id=harness.account.id,
        )
    assert result.model_config is not None
    masked_agent_mode = result.model_config["agent_mode"]
    assert isinstance(masked_agent_mode, dict)
    tools = masked_agent_mode["tools"]
    assert isinstance(tools, list)
    masked_tool = tools[0]
    assert isinstance(masked_tool, dict)
    # The credential helper can fall back to ciphertext, which is still masked.
    # Without a tool runtime, the response must omit unverified parameter values.
    expected_parameters: dict[str, dict[str, str]] = {
        "none": {"api_key": "se********ue"},
        "runtime": {},
        "decrypt": {"api_key": "en*****ed"},
    }
    assert masked_tool["tool_parameters"] == expected_parameters[failure]
    assert masked_copy == masked_agent_mode
    assert masked_copy is not agent_mode
    assert json.dumps(agent_mode) == original_agent_mode
    assert calls == [harness.active_workspace.id, harness.active_workspace.id]
    assert checkedout_during_io == ([0, 0] if failure == "runtime" else [0, 0, 0, 0])
    with harness.factory() as session:
        persisted = session.get(AppModelConfig, harness.config.id)
        assert persisted is not None
        assert persisted.agent_mode_dict == agent_mode
    harness.assert_read_only()
