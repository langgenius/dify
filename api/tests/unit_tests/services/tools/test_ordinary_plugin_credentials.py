"""Ordinary plugin runtime contracts; synthetic values and no provider I/O."""

from collections.abc import Callable, Generator
from contextlib import _GeneratorContextManager
from dataclasses import dataclass
from types import ModuleType
from typing import Never, Self
from unittest.mock import Mock

import pytest
import pytest_mock
import sqlalchemy.orm
from sqlalchemy import Engine, Update
from sqlalchemy.orm import Session, sessionmaker

from core.dify_builder.real_call_consent import ConfirmedToolBinding, ConfirmedToolGuard
from core.helper.provider_cache import NoOpProviderCredentialCache
from core.helper.provider_encryption import ProviderConfigEncrypter
from core.plugin.entities.plugin_daemon import CredentialType, PluginOAuthCredentialsResponse
from core.plugin.impl.oauth import OAuthHandler
from core.plugin.impl.tool import PluginToolManager
from core.tools.entities.tool_entities import ToolEntity, ToolProviderEntityWithPlugin, ToolProviderType
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.plugin_tool.tool import PluginTool
from core.tools.tool_manager import ToolManager
from models.tools import BuiltinToolProvider
from runtime_contracts.builder.execution import ConfirmedToolExecutionContext, context_digest
from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError
from services.dify_builder.real_call_consent_service import BuilderRealCallConsentService, ServiceConfirmedToolGuard
from tests.unit_tests.core.tools.test_tool_manager import _CallableSessionProxy
from tests.unit_tests.installed_spies import installed_mock

PROVIDER = "langgenius/search/search"
CREDENTIAL = "00000000-0000-0000-0000-000000000002"
CANARY = "synthetic-owner-canary"


@dataclass
class _CredentialDatabase:
    engine: Engine
    session: Session | _CallableSessionProxy


@dataclass
class _CredentialOwner:
    controller: PluginToolProviderController
    row: BuiltinToolProvider
    session: Session
    credential_reads: list[str]
    encrypter: ProviderConfigEncrypter
    cache: NoOpProviderCredentialCache
    policy: Mock
    dispatch: Mock
    module: ModuleType
    plugin_lookup: Mock
    builtin_lookup: Mock


@dataclass
class _RefreshUpdateResult:
    rowcount: int | None


@pytest.fixture
def owner(
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: sqlalchemy.orm.Session,
    sqlite_engine: sqlalchemy.Engine,
) -> _CredentialOwner:
    from core.tools import tool_manager as module

    try:
        from services.tools import ordinary_tool_credentials as credential_module
    except ImportError:
        credential_module = module
    entity = ToolEntity.model_validate(
        {
            "identity": {"author": "test", "name": "search", "label": {"en_US": "Search"}, "provider": PROVIDER},
            "description": {"human": {"en_US": "Search"}, "llm": "Search"},
            "parameters": [],
        }
    )
    provider_entity = ToolProviderEntityWithPlugin.model_validate(
        {
            "identity": {
                "icon": "",
                "name": PROVIDER,
                "author": "test",
                "label": {"en_US": "Search"},
                "description": {"en_US": "Search"},
            },
            "tools": [entity],
            "credentials_schema": [{"name": "api_key", "type": "secret-input"}],
        }
    )
    controller = PluginToolProviderController(
        entity=provider_entity,
        tenant_id="tenant-1",
        plugin_id="langgenius/search",
        plugin_unique_identifier="langgenius/search:1@hash",
    )
    plugin_lookup = mocker.patch.object(ToolManager, "get_plugin_provider", return_value=controller)
    builtin_lookup = mocker.patch.object(ToolManager, "get_builtin_provider", return_value=controller)
    from sqlalchemy import event

    from models.tools import BuiltinToolProvider

    row = BuiltinToolProvider(
        tenant_id="tenant-1",
        provider=PROVIDER,
        user_id="user-1",
        name="Search credentials",
        encrypted_credentials='{"api_key":"ciphertext"}',
        credential_type=CredentialType.API_KEY,
        expires_at=-1,
    )
    row.id = CREDENTIAL
    session = sqlite_session
    session.add(row)
    session.commit()
    credential_reads = []

    def record_credential_read(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT") and "tool_builtin_providers" in statement:
            credential_reads.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_credential_read)
    database = _CredentialDatabase(session=session, engine=sqlite_engine)
    monkeypatch.setattr(module, "db", database)
    monkeypatch.setattr(credential_module, "db", database)
    cache = NoOpProviderCredentialCache()
    mocker.patch.object(cache, "delete")
    encrypter = ProviderConfigEncrypter(tenant_id="tenant-1", config=[], provider_config_cache=cache)
    mocker.patch.object(encrypter, "decrypt", return_value={"api_key": CANARY})
    mocker.patch.object(encrypter, "encrypt", return_value={"api_key": "rotated-ciphertext"})
    monkeypatch.setattr(credential_module, "create_provider_encrypter", lambda **_kwargs: (encrypter, cache))
    policy = mocker.patch("core.helper.credential_utils.runtime_check_credential_policy_compliance")
    dispatch = mocker.patch.object(PluginToolManager, "invoke", return_value=iter(()))
    return _CredentialOwner(
        controller=controller,
        row=row,
        session=session,
        credential_reads=credential_reads,
        encrypter=encrypter,
        cache=cache,
        policy=policy,
        dispatch=dispatch,
        module=credential_module,
        plugin_lookup=plugin_lookup,
        builtin_lookup=builtin_lookup,
    )


def runtime(
    *,
    provider_type: ToolProviderType = ToolProviderType.PLUGIN,
    credential_id: str | None = CREDENTIAL,
    confirmed_guard: ConfirmedToolGuard | None = None,
    json_provider_validator: Callable[[object, object], None] | None = None,
) -> PluginTool:
    tool = ToolManager.get_tool_runtime(
        provider_type=provider_type,
        provider_id=PROVIDER,
        tool_name="search",
        tenant_id="tenant-1",
        user_id="user-1",
        credential_id=credential_id,
        confirmed_guard=confirmed_guard,
        json_provider_validator=json_provider_validator,
    )
    assert isinstance(tool, PluginTool)
    return tool


@pytest.mark.parametrize("provider_type", [ToolProviderType.PLUGIN, ToolProviderType.BUILT_IN])
def test_explicit_reference_reaches_actual_plugin_runtime(
    owner: _CredentialOwner, provider_type: ToolProviderType
) -> None:
    tool = runtime(provider_type=provider_type)
    list(tool.invoke(session=owner.session, user_id="user-1", tool_parameters={}))
    assert owner.dispatch.call_args.kwargs["credentials"] == {"api_key": CANARY}
    assert tool.plugin_unique_identifier == owner.controller.plugin_unique_identifier
    assert tool.tool_provider_type() == ToolProviderType.PLUGIN
    assert tool.runtime.user_id == "user-1"
    lookup = owner.plugin_lookup if provider_type == ToolProviderType.PLUGIN else owner.builtin_lookup
    other = owner.builtin_lookup if provider_type == ToolProviderType.PLUGIN else owner.plugin_lookup
    lookup.assert_called_once_with(PROVIDER, "tenant-1")
    other.assert_not_called()
    assert CANARY not in tool.entity.model_dump_json()
    owner.policy.assert_called_once()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tenant_id", "other-tenant"),
        ("provider", "other/search/search"),
        ("id", "00000000-0000-0000-0000-000000000003"),
    ],
)
def test_mismatched_stored_identity_refuses_before_decryption(owner: _CredentialOwner, field: str, value: str) -> None:
    setattr(owner.row, field, value)
    owner.session.commit()
    with pytest.raises(ToolProviderCredentialValidationError):
        runtime()
    _installed_spy_1 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_1.assert_not_called()
    owner.dispatch.assert_not_called()


def test_invalid_explicit_reference_never_selects_default(owner: _CredentialOwner) -> None:
    with pytest.raises(ToolProviderCredentialValidationError):
        runtime(credential_id="serialized-secret-is-not-an-id")
    _installed_spy_2 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_2.assert_not_called()


def test_default_reference_resolves_credentials(owner: _CredentialOwner) -> None:
    assert runtime(credential_id=None).runtime.credentials == {"api_key": CANARY}
    _installed_spy_3 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_3.assert_called_once()


def test_no_auth_uses_empty_credentials_without_read(owner: _CredentialOwner) -> None:
    owner.controller.entity.credentials_schema = []
    assert runtime().runtime.credentials == {}
    assert owner.credential_reads == []
    _installed_spy_4 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_4.assert_not_called()


def test_confirmed_plugin_rejected_before_credential_or_provider_work(
    owner: _CredentialOwner, mocker: pytest_mock.MockerFixture
) -> None:
    lookup = mocker.patch.object(ToolManager, "get_plugin_provider", side_effect=AssertionError("provider lookup"))
    context = ConfirmedToolExecutionContext(
        policy_version="builder-confirmed-gmail-read-v1",
        request_id="request",
        tenant_id="tenant-1",
        app_id="app",
        workflow_id="workflow",
        actor_id="actor",
        session_id="session",
        test_input_id="input",
        execution_revision="a" * 64,
        graph_revision="b" * 64,
        submitted_inputs_digest="c" * 64,
        effective_inputs_digest="d" * 64,
        context_digest="e" * 64,
        mode="confirmed_tool",
        sandbox_profile="disabled",
        admitted_nodes=(),
        consent_id="consent",
        scope_digest="f" * 64,
        command_id="command",
    )
    context = context.model_copy(update={"context_digest": context_digest(context)})
    guard = ServiceConfirmedToolGuard(
        BuilderRealCallConsentService(sessionmaker(bind=owner.session.get_bind())),
        ConfirmedToolBinding(
            context=context,
            node_id="tool",
            native_run_id="run",
            native_node_execution_id="execution",
        ),
    )
    with pytest.raises(BuilderExecutionPolicyError):
        runtime(confirmed_guard=guard)
    lookup.assert_not_called()
    _installed_spy_5 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_5.assert_not_called()


def test_native_json_rejection_precedes_credential_work(owner: _CredentialOwner) -> None:
    def validator(_provider: object, _tool: object) -> Never:
        raise AssertionError("validator should not be reached")

    with pytest.raises(BuilderExecutionPolicyError):
        runtime(json_provider_validator=validator)
    assert owner.credential_reads == []
    _installed_spy_6 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_6.assert_not_called()


@pytest.fixture
def persisted_credentials(sqlite_engine: sqlalchemy.Engine, owner: _CredentialOwner) -> Generator[_CredentialDatabase]:
    from sqlalchemy.orm import Session

    from models.base import TypeBase
    from models.tools import BuiltinToolProvider
    from tests.unit_tests.core.tools.test_tool_manager import _builtin_provider, _CallableSessionProxy

    TypeBase.metadata.create_all(sqlite_engine, tables=[TypeBase.metadata.tables[BuiltinToolProvider.__tablename__]])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        row = _builtin_provider(
            provider_id=owner.row.id,
            tenant_id="tenant-1",
            provider=PROVIDER,
            credential_type=CredentialType.OAUTH2,
            expires_at=1,
        )
        session.merge(row)
        session.commit()
        yield _CredentialDatabase(engine=sqlite_engine, session=_CallableSessionProxy(session))


@pytest.mark.parametrize("provider_type", [ToolProviderType.PLUGIN, ToolProviderType.BUILT_IN])
@pytest.mark.parametrize("credential_id", [None, CREDENTIAL])
def test_refresh_persists_actual_selected_row(
    owner: _CredentialOwner,
    persisted_credentials: _CredentialDatabase,
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    provider_type: ToolProviderType,
    credential_id: str | None,
) -> None:
    from models.tools import BuiltinToolProvider

    monkeypatch.setattr(owner.module, "db", persisted_credentials)
    # Replace the synthetic read context with real in-memory SQL sessions.
    from sqlalchemy.orm import Session

    monkeypatch.setattr(owner.module, "Session", Session)
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = mocker.patch.object(
        OAuthHandler,
        "refresh_credentials",
        return_value=PluginOAuthCredentialsResponse(credentials={"api_key": "rotated"}, expires_at=9999999999),
    )
    result = runtime(provider_type=provider_type, credential_id=credential_id)
    assert result.runtime.credentials == {"api_key": "rotated"}
    with Session(persisted_credentials.engine) as session:
        stored = session.get(BuiltinToolProvider, CREDENTIAL)
        assert stored is not None
        assert stored.expires_at == 9999999999
        assert stored.credentials == {"api_key": "rotated-ciphertext"}
    refresh.assert_called_once()
    _installed_spy_7 = installed_mock(owner.cache.delete)
    _installed_spy_7.assert_called_once()


@pytest.mark.parametrize("conflict", ["rotation", "delete", "owner", "expiry"])
def test_refresh_conflict_refuses_runtime_without_cache_invalidation(
    owner: _CredentialOwner,
    persisted_credentials: _CredentialDatabase,
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
    conflict: str,
) -> None:
    from sqlalchemy import delete, update
    from sqlalchemy.orm import Session

    from models.tools import BuiltinToolProvider

    monkeypatch.setattr(owner.module, "db", persisted_credentials)
    monkeypatch.setattr(owner.module, "Session", Session)
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )

    def rotate(**_kwargs: object) -> PluginOAuthCredentialsResponse:
        with Session(persisted_credentials.engine) as session, session.begin():
            if conflict == "delete":
                session.execute(delete(BuiltinToolProvider).where(BuiltinToolProvider.id == CREDENTIAL))
            else:
                values = {
                    "rotation": {"encrypted_credentials": '{"api_key":"concurrent"}'},
                    "owner": {"user_id": "new-owner"},
                    "expiry": {"expires_at": 2000},
                }[conflict]
                session.execute(
                    update(BuiltinToolProvider).where(BuiltinToolProvider.id == CREDENTIAL).values(**values)
                )
        return PluginOAuthCredentialsResponse(credentials={"api_key": "rotated"}, expires_at=9999999999)

    refresh = mocker.patch.object(OAuthHandler, "refresh_credentials", side_effect=rotate)
    with pytest.raises(ToolProviderCredentialValidationError):
        runtime(credential_id=None)
    refresh.assert_called_once()
    _installed_spy_8 = installed_mock(owner.cache.delete)
    _installed_spy_8.assert_not_called()
    owner.dispatch.assert_not_called()


def test_workspace_credential_delegation_does_not_compare_runtime_user_to_creator(owner: _CredentialOwner) -> None:
    owner.row.user_id = "workspace-credential-creator"
    owner.session.commit()
    tool = runtime()
    assert tool.runtime.user_id == "user-1"
    assert tool.runtime.credentials == {"api_key": CANARY}


def test_policy_refusal_precedes_decrypt_refresh_or_dispatch(
    owner: _CredentialOwner, mocker: pytest_mock.MockerFixture
) -> None:
    owner.row.expires_at = 1
    owner.session.commit()
    owner.policy.side_effect = ValueError("policy refused")
    refresh = mocker.patch.object(
        OAuthHandler, "refresh_credentials", side_effect=AssertionError("refresh must not run")
    )
    with pytest.raises(ValueError, match="policy refused"):
        runtime()
    _installed_spy_9 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_9.assert_not_called()
    refresh.assert_not_called()
    owner.dispatch.assert_not_called()


def test_ordinary_refresh_failure_refuses_without_cache_invalidation(
    owner: _CredentialOwner, mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner.row.expires_at = 1
    owner.session.commit()
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = mocker.patch.object(
        OAuthHandler, "refresh_credentials", side_effect=ValueError("synthetic refresh refusal")
    )
    with pytest.raises(ToolProviderCredentialValidationError, match="could not be refreshed"):
        runtime()
    refresh.assert_called_once()
    _installed_spy_10 = installed_mock(owner.cache.delete)
    _installed_spy_10.assert_not_called()
    owner.dispatch.assert_not_called()


def test_hardcoded_refresh_retains_original_state_across_session_expiration(
    owner: _CredentialOwner,
    persisted_credentials: _CredentialDatabase,
    mocker: pytest_mock.MockerFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sqlalchemy import update
    from sqlalchemy.orm import Session

    from models.tools import BuiltinToolProvider

    with Session(persisted_credentials.engine) as session, session.begin():
        session.execute(update(BuiltinToolProvider).values(provider="time"))
    persisted_credentials.session.expire_all()
    monkeypatch.setattr(owner.module, "db", persisted_credentials)
    monkeypatch.setattr(owner.module, "Session", Session)
    controller = owner.controller
    owner.builtin_lookup.return_value = controller
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )

    def rotate(**_kwargs: object) -> PluginOAuthCredentialsResponse:
        with Session(persisted_credentials.engine) as session, session.begin():
            session.execute(update(BuiltinToolProvider).values(encrypted_credentials='{"api_key":"concurrent"}'))
        # A collaborator expiring the ordinary scoped session must not replace
        # the original ciphertext bound before external refresh.
        persisted_credentials.session.expire_all()
        return PluginOAuthCredentialsResponse(credentials={"api_key": "rotated"}, expires_at=9999999999)

    refresh = mocker.patch.object(OAuthHandler, "refresh_credentials", side_effect=rotate)
    with pytest.raises(ToolProviderCredentialValidationError, match="changed during refresh"):
        ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id="time",
            tool_name="search",
            tenant_id="tenant-1",
            user_id="user-1",
        )
    _installed_spy_11 = installed_mock(owner.cache.delete)
    _installed_spy_11.assert_not_called()

    refresh.assert_called_once()


def test_empty_reference_preserves_default_selection(owner: _CredentialOwner) -> None:
    assert runtime(credential_id="").runtime.credentials == {"api_key": CANARY}
    _installed_spy_12 = installed_mock(owner.encrypter.decrypt)
    _installed_spy_12.assert_called_once()


class _RefreshWriteSession:
    """Transaction boundary double; the production writer builds the actual SQL."""

    def __init__(self, rowcount: int | None, events: list[str], *, commit_fails: bool = False) -> None:
        self.rowcount = rowcount
        self.events = events
        self.commit_fails = commit_fails
        self.statement: Update | None = None

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_args: object) -> bool:
        return False

    def begin(self) -> _GeneratorContextManager[None]:
        from contextlib import contextmanager

        @contextmanager
        def transaction() -> Generator[None]:
            self.events.append("begin")
            try:
                yield
                if self.commit_fails:
                    raise RuntimeError("synthetic uncertain commit")
            except Exception:
                self.events.append("rollback")
                raise
            else:
                self.events.append("commit")

        return transaction()

    def scalar(self, statement: Update) -> str:
        # Characterize the pre-fix RETURNING path without a real database call.
        self.statement = statement
        self.events.append("update")
        return CREDENTIAL

    def execute(self, statement: Update) -> _RefreshUpdateResult:
        self.statement = statement
        self.events.append("update")
        return _RefreshUpdateResult(rowcount=self.rowcount)


@pytest.mark.parametrize("backend", ["postgresql", "mysql", "oceanbase", "seekdb"])
def test_refresh_update_compiles_for_supported_database_configuration(
    owner: _CredentialOwner, monkeypatch: pytest.MonkeyPatch, backend: str
) -> None:
    from sqlalchemy.dialects import registry

    from configs.middleware import DatabaseConfig

    config = DatabaseConfig.model_validate({"DB_TYPE": backend})
    dialect = registry.load(config.SQLALCHEMY_DATABASE_URI_SCHEME.replace("+", "."))()
    writer = _RefreshWriteSession(1, [])
    monkeypatch.setattr(owner.module, "Session", lambda *_args: writer)
    owner.module._persist_ordinary_refresh(
        tenant_id="tenant-1",
        selected=owner.row,
        refreshed_encrypted_credentials='{"api_key":"rotated-ciphertext"}',
        refreshed_expires_at=9999999999,
    )
    assert writer.statement is not None
    compiled = writer.statement.compile(dialect=dialect)
    if not dialect.update_returning:
        assert " RETURNING " not in str(compiled).upper(), "supported backend rejects UPDATE RETURNING"
    assert compiled.params == {
        "encrypted_credentials": '{"api_key":"rotated-ciphertext"}',
        "expires_at": 9999999999,
        "tenant_id_1": "tenant-1",
        "id_1": CREDENTIAL,
        "provider_1": PROVIDER,
        "user_id_1": "user-1",
        "credential_type_1": CredentialType.API_KEY,
        "encrypted_credentials_1": '{"api_key":"ciphertext"}',
        "expires_at_1": -1,
    }
    assert writer.events == ["begin", "update", "commit"]


@pytest.mark.parametrize("rowcount", [1, 0, -1, None, 2])
def test_refresh_requires_exactly_one_affected_row_before_cache_and_dispatch(
    owner: _CredentialOwner, mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch, rowcount: int | None
) -> None:
    from contextlib import contextmanager

    owner.row.expires_at = 1
    owner.session.commit()
    events: list[str] = []
    writer = _RefreshWriteSession(rowcount, events)

    @contextmanager
    def read_session() -> Generator[Session]:
        yield owner.session
        owner.session.close()
        events.append("read-closed")

    sessions = iter([read_session(), writer])
    monkeypatch.setattr(owner.module, "Session", lambda *_args: next(sessions))
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = mocker.patch.object(
        OAuthHandler,
        "refresh_credentials",
        side_effect=lambda **_kwargs: (
            events.append("refresh")
            or PluginOAuthCredentialsResponse(credentials={"api_key": "rotated"}, expires_at=9999999999)
        ),
    )
    _installed_spy_13 = installed_mock(owner.cache.delete)
    _installed_spy_13.side_effect = lambda: events.append("cache-delete")
    owner.dispatch.side_effect = lambda **_kwargs: events.append("dispatch") or iter(())
    if rowcount == 1:
        tool = runtime()
        list(tool.invoke(session=owner.session, user_id="user-1", tool_parameters={}))
        assert events == ["read-closed", "refresh", "begin", "update", "commit", "cache-delete", "dispatch"]
    else:
        with pytest.raises(ToolProviderCredentialValidationError, match="changed during refresh"):
            runtime()
        assert events == ["read-closed", "refresh", "begin", "update", "rollback"]
        _installed_spy_15 = installed_mock(owner.cache.delete)
        _installed_spy_15.assert_not_called()
        owner.dispatch.assert_not_called()
    refresh.assert_called_once()


def test_refresh_commit_uncertainty_refuses_cache_invalidation_and_dispatch(
    owner: _CredentialOwner, mocker: pytest_mock.MockerFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from contextlib import contextmanager

    owner.row.expires_at = 1
    owner.session.commit()
    events: list[str] = []
    writer = _RefreshWriteSession(1, events, commit_fails=True)

    @contextmanager
    def read_session() -> Generator[Session]:
        yield owner.session
        owner.session.close()
        events.append("read-closed")

    sessions = iter([read_session(), writer])
    monkeypatch.setattr(owner.module, "Session", lambda *_args: next(sessions))
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = mocker.patch.object(
        OAuthHandler,
        "refresh_credentials",
        side_effect=lambda **_kwargs: (
            events.append("refresh")
            or PluginOAuthCredentialsResponse(credentials={"api_key": "rotated"}, expires_at=9999999999)
        ),
    )
    with pytest.raises(ToolProviderCredentialValidationError, match="could not be persisted"):
        runtime()
    assert events == ["read-closed", "refresh", "begin", "update", "rollback"]
    refresh.assert_called_once()
    _installed_spy_14 = installed_mock(owner.cache.delete)
    _installed_spy_14.assert_not_called()
    owner.dispatch.assert_not_called()
