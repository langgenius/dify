"""Exercise tenant-scoped MCP provider lookups against persisted rows.

Primary keys and server identifiers are distinct, even when an identifier looks
like a UUID or collides with another provider's primary key. Unchanged masked
OAuth client credentials resolve to the stored client information on update.
"""

import json
from typing import Literal

import pytest
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
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


def test_merge_credentials_with_masked_restores_nested_client_information(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    provider = _provider()
    provider.encrypted_credentials = json.dumps(
        {
            "client_information": {
                "client_id": "ba0f3e1c-registered-client-c2",
                "client_secret": "dynamic-client-secret",
                "redirect_uris": ["https://example.com/callback"],
            }
        }
    )
    _persist(sqlite_session, provider)
    masked = provider.to_entity().masked_credentials()

    assert service._merge_credentials_with_masked(masked["client_id"], masked["client_secret"], provider) == (
        "ba0f3e1c-registered-client-c2",
        "dynamic-client-secret",
    )


def test_update_provider_keeps_oauth_state_when_masked_credentials_are_unchanged(
    service: MCPToolManageService, sqlite_session: Session
) -> None:
    provider = _provider()
    credentials = json.dumps(
        {
            "client_information": {
                "client_id": "ba0f3e1c-registered-client-c2",
                "client_secret": "dynamic-client-secret",
                "redirect_uris": ["https://example.com/callback"],
                "is_dynamic_registration": True,
            },
            "access_token": "access-token",
            "refresh_token": "refresh-token",
        }
    )
    provider.encrypted_credentials = credentials
    _persist(sqlite_session, provider)
    masked = provider.to_entity().masked_credentials()

    service.update_provider(
        tenant_id=TENANT_ID,
        provider_id=PROVIDER_UUID,
        name="Renamed MCP",
        server_url=provider.server_url,
        icon="icon",
        icon_type="link",
        icon_background="",
        server_identifier=SERVER_IDENTIFIER,
        configuration=MCPConfiguration(),
        authentication=MCPAuthentication(client_id=masked["client_id"], client_secret=masked["client_secret"]),
    )

    assert provider.encrypted_credentials == credentials
