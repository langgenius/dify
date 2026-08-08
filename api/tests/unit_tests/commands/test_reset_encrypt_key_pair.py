"""SQLite-backed tests for the reset-encrypt-key-pair CLI command (#35396).

The command must purge every table that stores ciphertext encrypted with the
tenant's asymmetric key, otherwise stale rows cause downstream API failures
such as `/console/api/workspaces/current/tool-providers` returning 500.
Tests bind the command-owned transaction to the fixture engine and assert the
committed state rather than inspecting fabricated ``Session.execute`` calls.
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import commands
from commands import system as system_commands
from core.tools.entities.tool_entities import ApiProviderSchemaType
from graphon.model_runtime.entities.model_entities import ModelType
from models import Tenant
from models.provider import Provider, ProviderModel, ProviderType
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider


def _invoke_reset() -> int:
    try:
        commands.reset_encrypt_key_pair.callback()
    except SystemExit as e:
        return int(e.code or 0)
    return 0


TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "11111111-1111-1111-1111-111111111112"
USER_ID = "22222222-2222-2222-2222-222222222222"


def _tenant(tenant_id: str, *, name: str = "Test tenant") -> Tenant:
    tenant = Tenant(name=name, encrypt_public_key="old-key")
    tenant.id = tenant_id
    return tenant


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


def test_reset_aborts_when_not_self_hosted(monkeypatch, capsys):
    monkeypatch.setattr(system_commands.dify_config, "EDITION", "CLOUD")

    exit_code = _invoke_reset()
    captured = capsys.readouterr()

    assert exit_code == 0
    assert "only for SELF_HOSTED" in captured.out


@pytest.mark.parametrize(
    "sqlite_session",
    [(Tenant, Provider, ProviderModel, BuiltinToolProvider, ApiToolProvider, MCPToolProvider)],
    indirect=True,
)
def test_reset_purges_provider_and_tool_tables_for_each_tenant(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], sqlite_session: Session
) -> None:
    """The command must purge LLM provider rows AND every tool provider table
    that stores ciphertext encrypted under the tenant key (#35396)."""
    monkeypatch.setattr(system_commands.dify_config, "EDITION", "SELF_HOSTED")
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
    assert sqlite_session.get(Tenant, TENANT_ID).encrypt_public_key == f"new-key-{TENANT_ID}"
    assert sqlite_session.get(Tenant, OTHER_TENANT_ID).encrypt_public_key == f"new-key-{OTHER_TENANT_ID}"
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
    [(Tenant, Provider, ProviderModel, BuiltinToolProvider, ApiToolProvider, MCPToolProvider)],
    indirect=True,
)
def test_reset_iterates_all_tenants(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    """Multi-tenant deployments must purge every tenant, not just the first."""
    monkeypatch.setattr(system_commands.dify_config, "EDITION", "SELF_HOSTED")
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
    persisted_tenants = sqlite_session.scalars(select(Tenant).order_by(Tenant.id)).all()
    assert [tenant.encrypt_public_key for tenant in persisted_tenants] == [
        f"new-key-{tenant_id}" for tenant_id in tenant_ids
    ]
    for model in (Provider, ProviderModel, BuiltinToolProvider, ApiToolProvider, MCPToolProvider):
        assert sqlite_session.scalars(select(model)).all() == []
