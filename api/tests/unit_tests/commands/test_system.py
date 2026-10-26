import sys
import threading
import types
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

import commands
from commands import system as system_commands
from core.tools.entities.tool_entities import ApiProviderSchemaType
from enums import DeploymentEdition
from graphon.model_runtime.entities.model_entities import ModelType
from libs.db_migration_lock import LockNotOwnedError, RedisError
from models import Tenant as _reset_encrypt_key_pair_Tenant
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.account import Tenant as _fix_app_site_missing_Tenant
from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, IconType, Site
from models.provider import Provider, ProviderModel, ProviderType
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.model_factories import make_tenant


def _persist_missing_site_owner(session: Session) -> tuple[Account, App]:
    """Persist an app without a Site and its complete tenant owner chain."""
    tenant = _fix_app_site_missing_Tenant(name="Command workspace")
    account = Account(name="Owner", email=f"owner-{uuid.uuid4()}@example.com")
    membership = TenantAccountJoin(
        tenant_id=tenant.id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    app = App(
        id=str(uuid.uuid4()),
        tenant_id=tenant.id,
        name="Missing Site App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=False,
        created_by=account.id,
    )
    session.add_all([tenant, account, membership, app])
    session.commit()
    return account, app


def _site_for(app: App) -> Site:
    return Site(
        app_id=app.id,
        title=app.name,
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code=f"site-{app.id}",
    )


def _bind_command_database(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> tuple[scoped_session[Session], Session]:
    """Expose a callable real scoped session through the Flask-SQLAlchemy shape."""
    command_sessions = scoped_session(sqlite_session_factory)
    command_session = command_sessions()
    monkeypatch.setattr(
        system_commands,
        "db",
        SimpleNamespace(engine=sqlite_engine, session=command_sessions),
    )
    return command_sessions, command_session


def _run_fix_app_site_missing() -> None:
    """Invoke the command callback through a narrowed, non-optional reference."""
    callback = system_commands.fix_app_site_missing.callback
    assert callback is not None
    callback()


def test_fix_app_site_missing_passes_loaded_session_to_signal(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    account, app = _persist_missing_site_owner(sqlite_session)
    command_sessions, command_session = _bind_command_database(monkeypatch, sqlite_engine, sqlite_session_factory)
    phase_events: list[str] = []
    event.listen(command_session, "after_commit", lambda _session: phase_events.append("commit"))

    def create_site(sender: App, *, account: Account, session: Session) -> None:
        phase_events.append("signal")
        assert sender.id == app.id
        assert account.id == account_id
        assert session is command_session
        session.add(_site_for(sender))

    account_id = account.id
    send = MagicMock(side_effect=create_site)
    monkeypatch.setattr(system_commands.app_was_created, "send", send)

    try:
        _run_fix_app_site_missing()
    finally:
        command_sessions.remove()

    send.assert_called_once()
    assert phase_events == ["signal", "commit"]
    sqlite_session.expire_all()
    persisted_site = sqlite_session.query(Site).filter_by(app_id=app.id).one()
    assert persisted_site.title == app.name


def test_fix_app_site_missing_rolls_back_when_signal_fails(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _account, app = _persist_missing_site_owner(sqlite_session)
    command_sessions, command_session = _bind_command_database(monkeypatch, sqlite_engine, sqlite_session_factory)
    phase_events: list[str] = []
    event.listen(command_session, "after_rollback", lambda _session: phase_events.append("rollback"))

    def fail_signal(sender: App, **_kwargs: object) -> None:
        phase_events.append("signal")
        # Ensure the command's next raw scan terminates while its own transaction
        # still exercises the rollback path.
        with sqlite_session_factory() as observer:
            observer.add(_site_for(sender))
            observer.commit()
        raise RuntimeError("failed")

    monkeypatch.setattr(system_commands.app_was_created, "send", MagicMock(side_effect=fail_signal))

    try:
        _run_fix_app_site_missing()
    finally:
        command_sessions.remove()

    assert phase_events == ["signal", "rollback"]
    sqlite_session.expire_all()
    assert sqlite_session.get(App, app.id) is not None


"""SQLite-backed tests for the reset-encrypt-key-pair CLI command (#35396).

The command must purge every table that stores ciphertext encrypted with the
tenant's asymmetric key, otherwise stale rows cause downstream API failures
such as `/console/api/workspaces/current/tool-providers` returning 500.
Tests bind the command-owned transaction to the fixture engine and assert the
committed state rather than inspecting fabricated ``Session.execute`` calls.
"""


def _invoke_reset() -> int:
    callback = commands.reset_encrypt_key_pair.callback
    assert callback is not None
    try:
        callback()
    except SystemExit as e:
        return int(e.code or 0)
    return 0


TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "11111111-1111-1111-1111-111111111112"
USER_ID = "22222222-2222-2222-2222-222222222222"


def _tenant(tenant_id: str, *, name: str = "Test tenant") -> _reset_encrypt_key_pair_Tenant:
    return make_tenant(tenant_id=tenant_id, name=name, encrypt_public_key="old-key")


def _encrypted_rows(tenant_id: str, *, suffix: str = "1") -> tuple[object, ...]:
    """Build one persisted credential-bearing row for every purge target."""
    return (
        Provider(tenant_id=tenant_id, provider_name=f"provider-{suffix}"),
        ProviderModel(
            tenant_id=tenant_id,
            provider_name=f"provider-{suffix}",
            model_name=f"model-{suffix}",
            model_type=ModelType.LLM,
        ),
        BuiltinToolProvider(
            name=f"builtin-credential-{suffix}",
            tenant_id=tenant_id,
            user_id=USER_ID,
            provider=f"builtin-{suffix}",
            encrypted_credentials="ciphertext",
        ),
        ApiToolProvider(
            name=f"api-{suffix}",
            icon="icon",
            schema="{}",
            schema_type_str=ApiProviderSchemaType.OPENAPI,
            user_id=USER_ID,
            tenant_id=tenant_id,
            description="description",
            tools_str="[]",
            credentials_str="{}",
        ),
        MCPToolProvider(
            name=f"mcp-{suffix}",
            server_identifier=f"server-{suffix}",
            server_url="ciphertext",
            server_url_hash=f"hash-{suffix}",
            icon=None,
            tenant_id=tenant_id,
            user_id=USER_ID,
            encrypted_credentials="ciphertext",
        ),
    )


def _bind_command_to_sqlite(monkeypatch: pytest.MonkeyPatch, session: Session) -> None:
    monkeypatch.setattr(system_commands, "db", SimpleNamespace(engine=session.get_bind()))


def test_reset_aborts_when_not_self_hosted(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)

    exit_code = _invoke_reset()
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "only for SELF_HOSTED" in captured.out


@pytest.mark.parametrize(
    "sqlite_session",
    [(_reset_encrypt_key_pair_Tenant, Provider, ProviderModel, BuiltinToolProvider, ApiToolProvider, MCPToolProvider)],
    indirect=True,
)
def test_reset_purges_provider_and_tool_tables_for_each_tenant(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], sqlite_session: Session
) -> None:
    """The command must purge LLM provider rows AND every tool provider table
    that stores ciphertext encrypted under the tenant key (#35396)."""
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(system_commands, "generate_key_pair", lambda tenant_id: f"new-key-{tenant_id}")
    _bind_command_to_sqlite(monkeypatch, sqlite_session)

    tenant = _tenant(TENANT_ID)
    other_tenant = _tenant(OTHER_TENANT_ID, name="Other tenant")
    system_provider = Provider(
        tenant_id=TENANT_ID,
        provider_name="system-provider",
        provider_type=ProviderType.SYSTEM,
    )
    sqlite_session.add_all((tenant, other_tenant, system_provider, *_encrypted_rows(TENANT_ID)))
    sqlite_session.commit()

    exit_code = _invoke_reset()

    captured = capsys.readouterr()
    assert exit_code == 0
    assert TENANT_ID in captured.out

    sqlite_session.expire_all()
    tenant_after = sqlite_session.get(_reset_encrypt_key_pair_Tenant, TENANT_ID)
    other_tenant_after = sqlite_session.get(_reset_encrypt_key_pair_Tenant, OTHER_TENANT_ID)
    assert tenant_after is not None
    assert other_tenant_after is not None
    assert tenant_after.encrypt_public_key == f"new-key-{TENANT_ID}"
    assert other_tenant_after.encrypt_public_key == f"new-key-{OTHER_TENANT_ID}"
    assert sqlite_session.scalars(select(Provider).where(Provider.provider_type == ProviderType.CUSTOM)).all() == []
    assert sqlite_session.scalars(select(ProviderModel)).all() == []
    assert sqlite_session.scalars(select(BuiltinToolProvider)).all() == []
    assert sqlite_session.scalars(select(ApiToolProvider)).all() == []
    assert sqlite_session.scalars(select(MCPToolProvider)).all() == []
    assert (
        sqlite_session.scalar(select(Provider).where(Provider.provider_type == ProviderType.SYSTEM)) is system_provider
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(_reset_encrypt_key_pair_Tenant, Provider, ProviderModel, BuiltinToolProvider, ApiToolProvider, MCPToolProvider)],
    indirect=True,
)
def test_reset_iterates_all_tenants(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    """Multi-tenant deployments must purge every tenant, not just the first."""
    apply_config_overrides(monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
    monkeypatch.setattr(system_commands, "generate_key_pair", lambda tenant_id: f"new-key-{tenant_id}")

    _bind_command_to_sqlite(monkeypatch, sqlite_session)
    tenant_ids = [f"11111111-1111-1111-1111-{index:012d}" for index in range(3)]
    tenants = [_tenant(tenant_id, name=f"Tenant {index}") for index, tenant_id in enumerate(tenant_ids)]
    for index, tenant in enumerate(tenants):
        sqlite_session.add(tenant)
        sqlite_session.add_all(_encrypted_rows(tenant.id, suffix=str(index)))
    sqlite_session.commit()

    assert _invoke_reset() == 0

    sqlite_session.expire_all()
    persisted_tenants = sqlite_session.scalars(
        select(_reset_encrypt_key_pair_Tenant).order_by(_reset_encrypt_key_pair_Tenant.id)
    ).all()
    assert [tenant.encrypt_public_key for tenant in persisted_tenants] == [
        f"new-key-{tenant_id}" for tenant_id in tenant_ids
    ]
    for model in (Provider, ProviderModel, BuiltinToolProvider, ApiToolProvider, MCPToolProvider):
        assert sqlite_session.scalars(select(model)).all() == []


HEARTBEAT_WAIT_TIMEOUT_SECONDS = 5.0


def _install_fake_flask_migrate(monkeypatch, upgrade_impl) -> None:
    module = types.ModuleType("flask_migrate")
    module.upgrade = upgrade_impl
    monkeypatch.setitem(sys.modules, "flask_migrate", module)


def _invoke_upgrade_db() -> int:
    try:
        commands.upgrade_db.callback()
    except SystemExit as e:
        return int(e.code or 0)
    return 0


def test_upgrade_db_skips_when_lock_not_acquired(monkeypatch, capsys):
    monkeypatch.setattr(system_commands, "DB_UPGRADE_LOCK_TTL_SECONDS", 1234)

    lock = MagicMock()
    lock.acquire.return_value = False
    system_commands.redis_client.lock.return_value = lock

    exit_code = _invoke_upgrade_db()
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Database migration skipped" in captured.out

    system_commands.redis_client.lock.assert_called_once_with(name="db_upgrade_lock", timeout=1234, thread_local=False)
    lock.acquire.assert_called_once_with(blocking=False)
    lock.release.assert_not_called()


def test_upgrade_db_failure_not_masked_by_lock_release(monkeypatch, capsys):
    monkeypatch.setattr(system_commands, "DB_UPGRADE_LOCK_TTL_SECONDS", 321)

    lock = MagicMock()
    lock.acquire.return_value = True
    lock.release.side_effect = LockNotOwnedError("simulated")
    system_commands.redis_client.lock.return_value = lock

    def _upgrade():
        raise RuntimeError("boom")

    _install_fake_flask_migrate(monkeypatch, _upgrade)

    exit_code = _invoke_upgrade_db()
    captured = capsys.readouterr()

    assert exit_code == 1
    assert "Database migration failed: boom" in captured.out

    system_commands.redis_client.lock.assert_called_once_with(name="db_upgrade_lock", timeout=321, thread_local=False)
    lock.acquire.assert_called_once_with(blocking=False)
    lock.release.assert_called_once()


def test_upgrade_db_success_ignores_lock_not_owned_on_release(monkeypatch, capsys):
    monkeypatch.setattr(system_commands, "DB_UPGRADE_LOCK_TTL_SECONDS", 999)

    lock = MagicMock()
    lock.acquire.return_value = True
    lock.release.side_effect = LockNotOwnedError("simulated")
    system_commands.redis_client.lock.return_value = lock

    _install_fake_flask_migrate(monkeypatch, lambda: None)

    exit_code = _invoke_upgrade_db()
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "Database migration successful!" in captured.out

    system_commands.redis_client.lock.assert_called_once_with(name="db_upgrade_lock", timeout=999, thread_local=False)
    lock.acquire.assert_called_once_with(blocking=False)
    lock.release.assert_called_once()


def test_upgrade_db_renews_lock_during_migration(monkeypatch, capsys):
    """
    Ensure the lock is renewed while migrations are running, so the base TTL can stay short.
    """

    # Use a small TTL so the heartbeat interval triggers quickly.
    monkeypatch.setattr(system_commands, "DB_UPGRADE_LOCK_TTL_SECONDS", 0.3)

    lock = MagicMock()
    lock.acquire.return_value = True
    system_commands.redis_client.lock.return_value = lock

    renewed = threading.Event()

    def _reacquire():
        renewed.set()
        return True

    lock.reacquire.side_effect = _reacquire

    def _upgrade():
        assert renewed.wait(HEARTBEAT_WAIT_TIMEOUT_SECONDS)

    _install_fake_flask_migrate(monkeypatch, _upgrade)

    exit_code = _invoke_upgrade_db()
    _ = capsys.readouterr()

    assert exit_code == 0
    assert lock.reacquire.call_count >= 1


def test_upgrade_db_ignores_reacquire_errors(monkeypatch, capsys):
    # Use a small TTL so heartbeat runs during the upgrade call.
    monkeypatch.setattr(system_commands, "DB_UPGRADE_LOCK_TTL_SECONDS", 0.3)

    lock = MagicMock()
    lock.acquire.return_value = True
    system_commands.redis_client.lock.return_value = lock

    attempted = threading.Event()

    def _reacquire():
        attempted.set()
        raise RedisError("simulated")

    lock.reacquire.side_effect = _reacquire

    def _upgrade():
        assert attempted.wait(HEARTBEAT_WAIT_TIMEOUT_SECONDS)

    _install_fake_flask_migrate(monkeypatch, _upgrade)

    exit_code = _invoke_upgrade_db()
    _ = capsys.readouterr()

    assert exit_code == 0
    assert lock.reacquire.call_count >= 1
