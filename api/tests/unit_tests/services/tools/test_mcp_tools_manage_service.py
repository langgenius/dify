import json

import pytest
from sqlalchemy.orm import Session

from core.entities.mcp_provider import MCPConfiguration
from models.tools import MCPToolProvider
from services.tools.mcp_tools_manage_service import MCPToolManageService


@pytest.mark.parametrize("sqlite_session", [(MCPToolProvider,)], indirect=True)
def test_update_provider_switches_manual_registration_to_dynamic(
    sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = "49a99e46-bc2c-4885-91fa-47615f6192b5"
    provider = MCPToolProvider(
        name="Demo MCP",
        server_identifier="demo-mcp",
        server_url="encrypted-url",
        server_url_hash="server-url-hash",
        icon=json.dumps({"content": "🔗", "background": "#000000"}),
        tenant_id=tenant_id,
        user_id="d13f1f2a-5c68-4a2f-8d76-cb59cefe95b8",
        encrypted_credentials=json.dumps(
            {
                "client_information": {
                    "client_id": "manual-client",
                    "is_dynamic_registration": False,
                }
            }
        ),
        authed=True,
        tools='[{"name": "stale-tool"}]',
    )
    sqlite_session.add(provider)
    sqlite_session.commit()

    service = MCPToolManageService(sqlite_session)
    service.update_provider(
        tenant_id=tenant_id,
        provider_id=provider.id,
        name=provider.name,
        server_url="[__HIDDEN__]",
        icon="🔗",
        icon_type="emoji",
        icon_background="#000000",
        server_identifier=provider.server_identifier,
        configuration=MCPConfiguration(),
        is_dynamic_registration=True,
    )
    sqlite_session.commit()
    sqlite_session.refresh(provider)

    assert provider.encrypted_credentials == "{}"
    assert provider.authed is False
    assert provider.tools == "[]"
    monkeypatch.setattr(
        "core.entities.mcp_provider.encrypter.decrypt_token",
        lambda _tenant_id, _token: "https://example.com/mcp",
    )
    response = provider.to_entity().to_api_response()
    assert response["is_dynamic_registration"] is True
    assert "authentication" not in response
