"""Unit tests for the reset-encrypt-key-pair CLI command (#35396).

The command must purge every table that stores ciphertext encrypted with the
tenant's asymmetric key, otherwise stale rows cause downstream API failures
such as `/console/api/workspaces/current/tool-providers` returning 500.
"""

from unittest.mock import MagicMock, patch

import commands
from commands import system as system_commands
from models.provider import Provider, ProviderModel
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider


def _invoke_reset() -> int:
    try:
        commands.reset_encrypt_key_pair.callback()
    except SystemExit as e:
        return int(e.code or 0)
    return 0


def _delete_targets(session_mock: MagicMock) -> list:
    """Extract the model class targeted by each `delete(...)` call on the session."""
    targets = []
    for call in session_mock.execute.call_args_list:
        stmt = call.args[0]
        # `delete(Foo)` constructs a `Delete` statement whose entity is `Foo`.
        try:
            targets.append(stmt.table.name)
        except AttributeError:
            targets.append(repr(stmt))
    return targets


def test_reset_aborts_when_not_self_hosted(monkeypatch, capsys):
    monkeypatch.setattr(system_commands.dify_config, "EDITION", "CLOUD")

    exit_code = _invoke_reset()
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "only for SELF_HOSTED" in captured.out


def test_reset_purges_provider_and_tool_tables_for_each_tenant(monkeypatch, capsys):
    """The command must purge LLM provider rows AND every tool provider table
    that stores ciphertext encrypted under the tenant key (#35396)."""
    monkeypatch.setattr(system_commands.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(system_commands, "generate_key_pair", lambda tenant_id: f"new-key-{tenant_id}")

    fake_tenant = MagicMock(id="tenant-abc", encrypt_public_key="old-key")
    session = MagicMock()
    session.scalars.return_value.all.return_value = [fake_tenant]

    fake_sessionmaker = MagicMock()
    fake_sessionmaker.begin.return_value.__enter__.return_value = session
    fake_sessionmaker.begin.return_value.__exit__.return_value = False

    with (
        patch.object(system_commands, "db", MagicMock()),
        patch.object(system_commands, "sessionmaker", return_value=fake_sessionmaker),
    ):
        exit_code = _invoke_reset()

    captured = capsys.readouterr()
    assert exit_code == 0
    assert "tenant-abc" in captured.out

    # New key pair generated and assigned.
    assert fake_tenant.encrypt_public_key == "new-key-tenant-abc"

    # Every encrypted-credential table should have been purged for this tenant.
    table_names = _delete_targets(session)
    expected = {
        Provider.__tablename__,
        ProviderModel.__tablename__,
        BuiltinToolProvider.__tablename__,
        ApiToolProvider.__tablename__,
        MCPToolProvider.__tablename__,
    }
    assert expected.issubset(set(table_names)), f"missing purges: expected {expected}, got {table_names}"


def test_reset_iterates_all_tenants(monkeypatch, capsys):
    """Multi-tenant deployments must purge every tenant, not just the first."""
    monkeypatch.setattr(system_commands.dify_config, "EDITION", "SELF_HOSTED")
    monkeypatch.setattr(system_commands, "generate_key_pair", lambda tenant_id: f"new-key-{tenant_id}")

    tenants = [MagicMock(id=f"tenant-{i}", encrypt_public_key="old") for i in range(3)]
    session = MagicMock()
    session.scalars.return_value.all.return_value = tenants

    fake_sessionmaker = MagicMock()
    fake_sessionmaker.begin.return_value.__enter__.return_value = session
    fake_sessionmaker.begin.return_value.__exit__.return_value = False

    with (
        patch.object(system_commands, "db", MagicMock()),
        patch.object(system_commands, "sessionmaker", return_value=fake_sessionmaker),
    ):
        _invoke_reset()

    # Five purges per tenant × 3 tenants = 15 execute calls.
    assert session.execute.call_count == 15
    for tenant in tenants:
        assert tenant.encrypt_public_key == f"new-key-{tenant.id}"
