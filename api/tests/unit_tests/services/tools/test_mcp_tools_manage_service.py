"""Exercise tenant-scoped MCP provider lookups against persisted rows.

Primary keys and server identifiers are distinct, even when an identifier looks
like a UUID or collides with another provider's primary key.
"""

import json
from typing import Literal

import pytest
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
from core.helper.provider_encryption import encrypter
from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService

PROVIDER_UUID = "0b2bd1e4-3a7d-4a0b-9f2a-9b2d6f3c1e55"
OTHER_PROVIDER_UUID = "00000000-0000-4000-8000-000000000002"
SERVER_IDENTIFIER = "monday_mcp"
TENANT_ID = "3f0a1c4e-1f3d-4a4e-9a1f-2a6f8c5d0b11"
OTHER_TENANT_ID = "00000000-0000-4000-8000-000000000003"


def _provider(
    *, provider_id: str = PROVIDER_UUID, server_identifier: str = SERVER_IDENTIFIER, tenant_id: str = TENANT_ID
) -> MCPToolProvider:
    provider = MCPToolProvider(
        name=f"MCP {provider_id}",
        server_identifier=server_identifier,
        server_url=f"https://example.com/mcp/{provider_id}",
        server_url_hash=provider_id,
        icon="icon",
        tenant_id=tenant_id,
        user_id="user-id",
    )
    provider.id = provider_id
    return provider


def _persist(session: Session, *providers: MCPToolProvider) -> None:
    session.add_all(providers)
    session.commit()
    session.expire_all()


@pytest.fixture
def service(sqlite_session: Session) -> MCPToolManageService:
    return MCPToolManageService(session=sqlite_session)


@pytest.fixture(autouse=True)
def mock_encrypter(monkeypatch: pytest.MonkeyPatch) -> None:
    def _encrypt(_tenant_id: str, token: str) -> str:
        return f"enc_{token}"

    def _decrypt(_tenant_id: str, token: str) -> str:
        return token.removeprefix("enc_")

    monkeypatch.setattr("core.helper.encrypter.encrypt_token", _encrypt)
    monkeypatch.setattr("core.helper.encrypter.decrypt_token", _decrypt)
    monkeypatch.setattr("core.helper.provider_encryption.encrypter.encrypt_token", _encrypt)
    monkeypatch.setattr("core.helper.provider_encryption.encrypter.decrypt_token", _decrypt)
    monkeypatch.setattr("core.entities.mcp_provider.encrypter.encrypt_token", _encrypt)
    monkeypatch.setattr("core.entities.mcp_provider.encrypter.decrypt_token", _decrypt)
    monkeypatch.setattr("services.tools.mcp_tools_manage_service.encrypter.encrypt_token", _encrypt)
    monkeypatch.setattr("services.tools.mcp_tools_manage_service.encrypter.decrypt_token", _decrypt)


def test_get_provider_by_id_queries_primary_key(service: MCPToolManageService, sqlite_session: Session) -> None:
    provider = _provider()
    identifier_collision = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, identifier_collision, provider)

    assert service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID).id == provider.id


def test_get_provider_by_id_rejects_server_identifier(unbound_session: Session) -> None:
    """Invalid UUIDs must be rejected before any database access is attempted."""
    service = MCPToolManageService(session=unbound_session)
    with pytest.raises(ValueError, match="expected a valid UUID"):
        service.get_provider_by_id(provider_id=SERVER_IDENTIFIER, tenant_id=TENANT_ID)


def test_get_provider_by_id_not_found(service: MCPToolManageService) -> None:
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID)


def test_get_provider_by_server_identifier_queries_identifier(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    primary_key_collision = _provider()
    provider = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, primary_key_collision, provider)

    result = service.get_provider_by_server_identifier(server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID)

    assert result.id == provider.id


def test_get_provider_by_server_identifier_not_found(service: MCPToolManageService) -> None:
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)


def test_persisted_reference_non_uuid_queries_identifier_only(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    provider = _provider()
    _persist(sqlite_session, provider)

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID).id
        == provider.id
    )


def test_persisted_reference_uuid_prefers_primary_key(service: MCPToolManageService, sqlite_session: Session) -> None:
    """Legacy graph references prefer the primary key when both meanings resolve."""
    provider = _provider()
    identifier_collision = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, identifier_collision, provider)

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID).id
        == provider.id
    )


def test_persisted_reference_uuid_falls_back_to_identifier(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    """A foreign primary-key match must not hide the tenant's UUID-shaped identifier."""
    foreign_primary_key = _provider(tenant_id=OTHER_TENANT_ID)
    provider = _provider(provider_id=OTHER_PROVIDER_UUID, server_identifier=PROVIDER_UUID)
    _persist(sqlite_session, foreign_primary_key, provider)

    assert (
        service.get_provider_by_persisted_reference(id_or_server_identifier=PROVIDER_UUID, tenant_id=TENANT_ID).id
        == provider.id
    )


@pytest.mark.parametrize("reference", [SERVER_IDENTIFIER, PROVIDER_UUID])
def test_persisted_reference_not_found(service: MCPToolManageService, reference: str) -> None:
    with pytest.raises(ValueError, match="MCP tool not found"):
        service.get_provider_by_persisted_reference(id_or_server_identifier=reference, tenant_id=TENANT_ID)


@pytest.mark.parametrize("lookup", ["id", "server_identifier", "persisted_id", "persisted_identifier"])
def test_provider_lookups_reject_foreign_tenants(
    service: MCPToolManageService,
    sqlite_session: Session,
    lookup: Literal["id", "server_identifier", "persisted_id", "persisted_identifier"],
) -> None:
    _persist(sqlite_session, _provider(tenant_id=OTHER_TENANT_ID))

    if lookup == "id":
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID)
    elif lookup == "server_identifier":
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID)
    else:
        with pytest.raises(ValueError, match="MCP tool not found"):
            service.get_provider_by_persisted_reference(
                id_or_server_identifier=PROVIDER_UUID if lookup == "persisted_id" else SERVER_IDENTIFIER,
                tenant_id=TENANT_ID,
            )


def test_server_identifier_can_be_reused_across_tenants(service: MCPToolManageService, sqlite_session: Session) -> None:
    foreign = _provider(tenant_id=OTHER_TENANT_ID)
    provider = _provider(provider_id=OTHER_PROVIDER_UUID)
    _persist(sqlite_session, foreign, provider)

    assert (
        service.get_provider_by_server_identifier(server_identifier=SERVER_IDENTIFIER, tenant_id=TENANT_ID).id
        == provider.id
    )


def test_merge_credentials_with_masked_restores_nested_client_id_and_secret(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    raw_secret = "secret-token-xyz-123456"
    encrypted_secret = encrypter.encrypt_token(TENANT_ID, raw_secret)
    client_id = "ba729837-1234-5678-abcd-0000000000c2"

    provider = _provider()
    provider.encrypted_credentials = json.dumps(
        {
            "client_information": {
                "client_id": client_id,
                "encrypted_client_secret": encrypted_secret,
                "is_dynamic_registration": True,
            },
            "access_token": "token-123",
        }
    )
    _persist(sqlite_session, provider)

    entity = provider.to_entity()
    masked = entity.masked_credentials()
    assert "*" in masked["client_id"]
    assert "*" in masked["client_secret"]

    final_client_id, final_client_secret = service._merge_credentials_with_masked(
        client_id=masked["client_id"],
        client_secret=masked["client_secret"],
        mcp_provider=provider,
    )

    assert final_client_id == client_id
    assert final_client_secret == raw_secret


def test_merge_credentials_accepts_new_unmasked_credentials(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    provider = _provider()
    provider.encrypted_credentials = json.dumps(
        {
            "client_information": {
                "client_id": "old-client-id",
                "client_secret": "old-secret",
            }
        }
    )
    _persist(sqlite_session, provider)

    final_client_id, final_client_secret = service._merge_credentials_with_masked(
        client_id="new-client-id",
        client_secret="new-secret",
        mcp_provider=provider,
    )

    assert final_client_id == "new-client-id"
    assert final_client_secret == "new-secret"


def test_process_credentials_preserves_tokens_and_dcr_metadata_when_credentials_unchanged(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    raw_secret = "secret-token-xyz-123456"
    encrypted_secret = encrypter.encrypt_token(TENANT_ID, raw_secret)
    client_id = "ba729837-1234-5678-abcd-0000000000c2"

    orig_creds = {
        "client_information": {
            "client_id": client_id,
            "encrypted_client_secret": encrypted_secret,
            "is_dynamic_registration": True,
            "redirect_uris": ["https://console.example.com/callback"],
            "grant_types": ["authorization_code", "refresh_token"],
        },
        "access_token": "active-access-token",
        "refresh_token": "active-refresh-token",
        "expires_in": 3600,
    }
    orig_json = json.dumps(orig_creds)

    provider = _provider()
    provider.encrypted_credentials = orig_json
    provider.authed = True
    _persist(sqlite_session, provider)

    entity = provider.to_entity()
    masked = entity.masked_credentials()

    auth_payload = MCPAuthentication(
        client_id=masked["client_id"],
        client_secret=masked["client_secret"],
    )

    new_encrypted, credentials_changed = service._process_credentials(
        authentication=auth_payload,
        mcp_provider=provider,
        tenant_id=TENANT_ID,
    )

    assert credentials_changed is False
    assert new_encrypted == orig_json
    assert json.loads(new_encrypted)["access_token"] == "active-access-token"
    assert json.loads(new_encrypted)["client_information"]["is_dynamic_registration"] is True


def test_update_provider_preserves_authed_tools_and_tokens_on_parameter_change(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    raw_secret = "secret-token-xyz-123456"
    encrypted_secret = encrypter.encrypt_token(TENANT_ID, raw_secret)
    client_id = "ba729837-1234-5678-abcd-0000000000c2"

    orig_creds = {
        "client_information": {
            "client_id": client_id,
            "encrypted_client_secret": encrypted_secret,
            "is_dynamic_registration": True,
        },
        "access_token": "active-token",
    }
    orig_json = json.dumps(orig_creds)
    tools_json = '[{"name": "fetch_data", "description": "Fetches data"}]'

    provider = _provider()
    provider.encrypted_credentials = orig_json
    provider.authed = True
    provider.tools = tools_json
    _persist(sqlite_session, provider)

    masked = provider.to_entity().masked_credentials()

    # Update only the name and identifier
    service.update_provider(
        tenant_id=TENANT_ID,
        provider_id=PROVIDER_UUID,
        name="Updated MCP Name",
        server_url=provider.server_url,
        icon=provider.icon or "",
        icon_type="image",
        icon_background="#ffffff",
        server_identifier="new_identifier",
        headers={},
        configuration=MCPConfiguration(timeout=45, sse_read_timeout=400),
        authentication=MCPAuthentication(client_id=masked["client_id"], client_secret=masked["client_secret"]),
    )

    updated_provider = service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID)
    assert updated_provider.name == "Updated MCP Name"
    assert updated_provider.server_identifier == "new_identifier"
    assert updated_provider.authed is True
    assert updated_provider.tools == tools_json
    assert updated_provider.encrypted_credentials == orig_json


def test_update_provider_resets_authed_and_tools_when_credentials_change(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    provider = _provider()
    provider.encrypted_credentials = json.dumps(
        {
            "client_information": {
                "client_id": "old-client-id",
                "encrypted_client_secret": encrypter.encrypt_token(TENANT_ID, "old-secret"),
                "is_dynamic_registration": False,
            },
            "access_token": "old-token",
        }
    )
    provider.authed = True
    provider.tools = '[{"name": "tool1"}]'
    _persist(sqlite_session, provider)

    service.update_provider(
        tenant_id=TENANT_ID,
        provider_id=PROVIDER_UUID,
        name=provider.name,
        server_url=provider.server_url,
        icon=provider.icon or "",
        icon_type="image",
        icon_background="",
        server_identifier=provider.server_identifier,
        headers={},
        configuration=MCPConfiguration(),
        authentication=MCPAuthentication(client_id="brand-new-client-id", client_secret="brand-new-secret"),
    )

    updated_provider = service.get_provider_by_id(provider_id=PROVIDER_UUID, tenant_id=TENANT_ID)
    assert updated_provider.authed is False
    assert updated_provider.tools == "[]"

    entity = updated_provider.to_entity()
    client_info = entity.retrieve_client_information()
    assert client_info is not None
    assert client_info.client_id == "brand-new-client-id"
    assert client_info.client_secret == "brand-new-secret"
