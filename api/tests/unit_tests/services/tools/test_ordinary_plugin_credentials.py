"""Ordinary plugin runtime contracts; synthetic values and no provider I/O."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.dify_builder.execution_policy import BuilderExecutionPolicyError
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.entities.tool_entities import ToolEntity, ToolProviderEntityWithPlugin, ToolProviderType
from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager

PROVIDER = "langgenius/search/search"
CREDENTIAL = "00000000-0000-0000-0000-000000000002"
CANARY = "synthetic-owner-canary"


@pytest.fixture
def owner(monkeypatch):
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
    controller = object.__new__(PluginToolProviderController)
    controller.entity = ToolProviderEntityWithPlugin.model_validate(
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
    controller.tenant_id = "tenant-1"
    controller.plugin_id = "langgenius/search"
    controller.plugin_unique_identifier = "langgenius/search:1@hash"
    plugin_lookup = Mock(return_value=controller)
    monkeypatch.setattr(ToolManager, "get_plugin_provider", plugin_lookup)
    builtin_lookup = Mock(return_value=controller)
    monkeypatch.setattr(ToolManager, "get_builtin_provider", builtin_lookup)
    row = SimpleNamespace(
        id=CREDENTIAL,
        tenant_id="tenant-1",
        provider=PROVIDER,
        user_id="user-1",
        credentials={"api_key": "ciphertext"},
        encrypted_credentials='{"api_key":"ciphertext"}',
        credential_type=CredentialType.API_KEY,
        expires_at=-1,
    )
    session = Mock()
    session.scalar.return_value = row
    context = Mock()
    context.__enter__ = Mock(return_value=session)
    context.__exit__ = Mock(return_value=False)
    database = SimpleNamespace(session=session, engine=object())
    monkeypatch.setattr(module, "db", database)
    monkeypatch.setattr(credential_module, "db", database)
    monkeypatch.setattr(credential_module, "Session", lambda *_args, **_kwargs: context)
    encrypter = Mock()
    encrypter.decrypt.return_value = {"api_key": CANARY}
    encrypter.encrypt.return_value = {"api_key": "rotated-ciphertext"}
    cache = Mock()
    monkeypatch.setattr(credential_module, "create_provider_encrypter", lambda **_kwargs: (encrypter, cache))
    policy = Mock()
    monkeypatch.setattr("core.helper.credential_utils.runtime_check_credential_policy_compliance", policy)
    dispatch = Mock(return_value=iter(()))
    monkeypatch.setattr("core.tools.plugin_tool.tool.PluginToolManager.invoke", dispatch)
    return SimpleNamespace(
        controller=controller,
        row=row,
        session=session,
        encrypter=encrypter,
        cache=cache,
        policy=policy,
        dispatch=dispatch,
        module=credential_module,
        plugin_lookup=plugin_lookup,
        builtin_lookup=builtin_lookup,
    )


def runtime(**kwargs):
    return ToolManager.get_tool_runtime(
        provider_type=kwargs.pop("provider_type", ToolProviderType.PLUGIN),
        provider_id=PROVIDER,
        tool_name="search",
        tenant_id="tenant-1",
        user_id="user-1",
        credential_id=kwargs.pop("credential_id", CREDENTIAL),
        **kwargs,
    )


@pytest.mark.parametrize("provider_type", [ToolProviderType.PLUGIN, ToolProviderType.BUILT_IN])
def test_explicit_reference_reaches_actual_plugin_runtime(owner, provider_type):
    tool = runtime(provider_type=provider_type)
    list(tool.invoke(session=None, user_id="user-1", tool_parameters={}))
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
def test_mismatched_stored_identity_refuses_before_decryption(owner, field, value):
    setattr(owner.row, field, value)
    with pytest.raises(ToolProviderCredentialValidationError):
        runtime()
    owner.encrypter.decrypt.assert_not_called()
    owner.dispatch.assert_not_called()


def test_invalid_explicit_reference_never_selects_default(owner):
    with pytest.raises(ToolProviderCredentialValidationError):
        runtime(credential_id="serialized-secret-is-not-an-id")
    owner.encrypter.decrypt.assert_not_called()


def test_default_reference_resolves_credentials(owner):
    assert runtime(credential_id=None).runtime.credentials == {"api_key": CANARY}
    owner.encrypter.decrypt.assert_called_once()


def test_no_auth_uses_empty_credentials_without_read(owner):
    owner.controller.entity.credentials_schema = []
    assert runtime().runtime.credentials == {}
    owner.session.scalar.assert_not_called()
    owner.encrypter.decrypt.assert_not_called()


def test_confirmed_plugin_rejected_before_credential_or_provider_work(owner, monkeypatch):
    lookup = Mock(side_effect=AssertionError("provider lookup"))
    monkeypatch.setattr(ToolManager, "get_plugin_provider", lookup)
    guard = SimpleNamespace(binding=SimpleNamespace(context=SimpleNamespace(tenant_id="tenant-1")))
    with pytest.raises(BuilderExecutionPolicyError):
        runtime(confirmed_guard=guard)
    lookup.assert_not_called()
    owner.encrypter.decrypt.assert_not_called()


def test_native_json_rejection_precedes_credential_work(owner):
    validator = Mock(side_effect=AssertionError("validator should not be reached"))
    with pytest.raises(BuilderExecutionPolicyError):
        runtime(json_provider_validator=validator)
    owner.session.scalar.assert_not_called()
    owner.encrypter.decrypt.assert_not_called()


@pytest.fixture
def persisted_credentials(sqlite_engine):
    from sqlalchemy.orm import Session

    from models.base import TypeBase
    from models.tools import BuiltinToolProvider
    from tests.unit_tests.core.tools.test_tool_manager import _builtin_provider, _CallableSessionProxy

    TypeBase.metadata.create_all(sqlite_engine, tables=[TypeBase.metadata.tables[BuiltinToolProvider.__tablename__]])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        row = _builtin_provider(
            provider_id=CREDENTIAL,
            tenant_id="tenant-1",
            provider=PROVIDER,
            credential_type=CredentialType.OAUTH2,
            expires_at=1,
        )
        session.add(row)
        session.commit()
        yield SimpleNamespace(engine=sqlite_engine, session=_CallableSessionProxy(session))


@pytest.mark.parametrize("provider_type", [ToolProviderType.PLUGIN, ToolProviderType.BUILT_IN])
@pytest.mark.parametrize("credential_id", [None, CREDENTIAL])
def test_refresh_persists_actual_selected_row(owner, persisted_credentials, monkeypatch, provider_type, credential_id):
    from models.tools import BuiltinToolProvider

    monkeypatch.setattr(owner.module, "db", persisted_credentials)
    # Replace the synthetic read context with real in-memory SQL sessions.
    from sqlalchemy.orm import Session

    monkeypatch.setattr(owner.module, "Session", Session)
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = Mock(return_value=SimpleNamespace(credentials={"api_key": "rotated"}, expires_at=9999999999))
    monkeypatch.setattr("core.plugin.impl.oauth.OAuthHandler.refresh_credentials", refresh)
    result = runtime(provider_type=provider_type, credential_id=credential_id)
    assert result.runtime.credentials == {"api_key": "rotated"}
    with Session(persisted_credentials.engine) as session:
        stored = session.get(BuiltinToolProvider, CREDENTIAL)
        assert stored is not None
        assert stored.expires_at == 9999999999
        assert stored.credentials == {"api_key": "rotated-ciphertext"}
    refresh.assert_called_once()
    owner.cache.delete.assert_called_once()


@pytest.mark.parametrize("conflict", ["rotation", "delete", "owner", "expiry"])
def test_refresh_conflict_refuses_runtime_without_cache_invalidation(
    owner, persisted_credentials, monkeypatch, conflict
):
    from sqlalchemy import delete, update
    from sqlalchemy.orm import Session

    from models.tools import BuiltinToolProvider

    monkeypatch.setattr(owner.module, "db", persisted_credentials)
    monkeypatch.setattr(owner.module, "Session", Session)
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )

    def rotate(**_kwargs):
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
        return SimpleNamespace(credentials={"api_key": "rotated"}, expires_at=9999999999)

    refresh = Mock(side_effect=rotate)
    monkeypatch.setattr("core.plugin.impl.oauth.OAuthHandler.refresh_credentials", refresh)
    with pytest.raises(ToolProviderCredentialValidationError):
        runtime(credential_id=None)
    refresh.assert_called_once()
    owner.cache.delete.assert_not_called()
    owner.dispatch.assert_not_called()


def test_workspace_credential_delegation_does_not_compare_runtime_user_to_creator(owner):
    owner.row.user_id = "workspace-credential-creator"
    tool = runtime()
    assert tool.runtime.user_id == "user-1"
    assert tool.runtime.credentials == {"api_key": CANARY}


def test_policy_refusal_precedes_decrypt_refresh_or_dispatch(owner, monkeypatch):
    owner.row.expires_at = 1
    owner.policy.side_effect = ValueError("policy refused")
    refresh = Mock(side_effect=AssertionError("refresh must not run"))
    monkeypatch.setattr("core.plugin.impl.oauth.OAuthHandler.refresh_credentials", refresh)
    with pytest.raises(ValueError, match="policy refused"):
        runtime()
    owner.encrypter.decrypt.assert_not_called()
    refresh.assert_not_called()
    owner.dispatch.assert_not_called()


def test_ordinary_refresh_failure_refuses_without_cache_invalidation(owner, monkeypatch):
    owner.row.expires_at = 1
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = Mock(side_effect=ValueError("synthetic refresh refusal"))
    monkeypatch.setattr("core.plugin.impl.oauth.OAuthHandler.refresh_credentials", refresh)
    with pytest.raises(ToolProviderCredentialValidationError, match="could not be refreshed"):
        runtime()
    refresh.assert_called_once()
    owner.cache.delete.assert_not_called()
    owner.dispatch.assert_not_called()


def test_hardcoded_refresh_retains_original_state_across_session_expiration(owner, persisted_credentials, monkeypatch):
    from sqlalchemy import update
    from sqlalchemy.orm import Session

    from models.tools import BuiltinToolProvider

    with Session(persisted_credentials.engine) as session, session.begin():
        session.execute(update(BuiltinToolProvider).values(provider="time"))
    persisted_credentials.session.expire_all()
    monkeypatch.setattr(owner.module, "db", persisted_credentials)
    monkeypatch.setattr(owner.module, "Session", Session)
    controller = SimpleNamespace(
        get_tool=owner.controller.get_tool,
        need_credentials=True,
        get_credentials_schema_by_type=owner.controller.get_credentials_schema_by_type,
    )
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_args: controller)
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )

    def rotate(**_kwargs):
        with Session(persisted_credentials.engine) as session, session.begin():
            session.execute(update(BuiltinToolProvider).values(encrypted_credentials='{"api_key":"concurrent"}'))
        # A collaborator expiring the ordinary scoped session must not replace
        # the original ciphertext bound before external refresh.
        persisted_credentials.session.expire_all()
        return SimpleNamespace(credentials={"api_key": "rotated"}, expires_at=9999999999)

    refresh = Mock(side_effect=rotate)
    monkeypatch.setattr("core.plugin.impl.oauth.OAuthHandler.refresh_credentials", refresh)
    with pytest.raises(ToolProviderCredentialValidationError, match="changed during refresh"):
        ToolManager.get_tool_runtime(
            provider_type=ToolProviderType.BUILT_IN,
            provider_id="time",
            tool_name="search",
            tenant_id="tenant-1",
            user_id="user-1",
        )
    owner.cache.delete.assert_not_called()

    refresh.assert_called_once()


def test_empty_reference_preserves_default_selection(owner):
    assert runtime(credential_id="").runtime.credentials == {"api_key": CANARY}
    owner.encrypter.decrypt.assert_called_once()


class _RefreshWriteSession:
    """Transaction boundary double; the production writer builds the actual SQL."""

    def __init__(self, rowcount, events, *, commit_fails=False):
        self.rowcount = rowcount
        self.events = events
        self.commit_fails = commit_fails
        self.statement = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def begin(self):
        from contextlib import contextmanager

        @contextmanager
        def transaction():
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

    def scalar(self, statement):
        # Characterize the pre-fix RETURNING path without a real database call.
        self.statement = statement
        self.events.append("update")
        return CREDENTIAL

    def execute(self, statement):
        self.statement = statement
        self.events.append("update")
        return SimpleNamespace(rowcount=self.rowcount)


@pytest.mark.parametrize("backend", ["postgresql", "mysql", "oceanbase", "seekdb"])
def test_refresh_update_compiles_for_supported_database_configuration(owner, monkeypatch, backend):
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
def test_refresh_requires_exactly_one_affected_row_before_cache_and_dispatch(owner, monkeypatch, rowcount):
    from contextlib import contextmanager

    owner.row.expires_at = 1
    events = []
    writer = _RefreshWriteSession(rowcount, events)

    @contextmanager
    def read_session():
        yield owner.session
        events.append("read-closed")

    sessions = iter([read_session(), writer])
    monkeypatch.setattr(owner.module, "Session", lambda *_args: next(sessions))
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = Mock(
        side_effect=lambda **_kwargs: (
            events.append("refresh") or SimpleNamespace(credentials={"api_key": "rotated"}, expires_at=9999999999)
        )
    )
    monkeypatch.setattr("core.plugin.impl.oauth.OAuthHandler.refresh_credentials", refresh)
    owner.cache.delete.side_effect = lambda: events.append("cache-delete")
    owner.dispatch.side_effect = lambda **_kwargs: events.append("dispatch") or iter(())
    if rowcount == 1:
        tool = runtime()
        list(tool.invoke(session=None, user_id="user-1", tool_parameters={}))
        assert events == ["read-closed", "refresh", "begin", "update", "commit", "cache-delete", "dispatch"]
    else:
        with pytest.raises(ToolProviderCredentialValidationError, match="changed during refresh"):
            runtime()
        assert events == ["read-closed", "refresh", "begin", "update", "rollback"]
        owner.cache.delete.assert_not_called()
        owner.dispatch.assert_not_called()
    refresh.assert_called_once()


def test_refresh_commit_uncertainty_refuses_cache_invalidation_and_dispatch(owner, monkeypatch):
    from contextlib import contextmanager

    owner.row.expires_at = 1
    events = []
    writer = _RefreshWriteSession(1, events, commit_fails=True)

    @contextmanager
    def read_session():
        yield owner.session
        events.append("read-closed")

    sessions = iter([read_session(), writer])
    monkeypatch.setattr(owner.module, "Session", lambda *_args: next(sessions))
    monkeypatch.setattr(
        "services.tools.builtin_tools_manage_service.BuiltinToolManageService.get_oauth_client", lambda *_args: {}
    )
    refresh = Mock(
        side_effect=lambda **_kwargs: (
            events.append("refresh") or SimpleNamespace(credentials={"api_key": "rotated"}, expires_at=9999999999)
        )
    )
    monkeypatch.setattr("core.plugin.impl.oauth.OAuthHandler.refresh_credentials", refresh)
    with pytest.raises(ToolProviderCredentialValidationError, match="could not be persisted"):
        runtime()
    assert events == ["read-closed", "refresh", "begin", "update", "rollback"]
    refresh.assert_called_once()
    owner.cache.delete.assert_not_called()
    owner.dispatch.assert_not_called()
