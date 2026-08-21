import pytest
from sqlalchemy.orm import Session, sessionmaker

from services.tools.mcp_tools_manage_service import MCPToolManageService


def test_update_provider_credentials_in_new_transaction_owns_session_boundary(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    observed: dict[str, object] = {}

    def update_credentials(
        service: MCPToolManageService,
        *,
        provider_id: str,
        tenant_id: str,
        credentials: dict[str, object],
        authed: bool | None = None,
    ) -> None:
        observed.update(
            session=service._session,
            in_transaction=service._session.in_transaction(),
            provider_id=provider_id,
            tenant_id=tenant_id,
            credentials=credentials,
            authed=authed,
        )

    monkeypatch.setattr(MCPToolManageService, "update_provider_credentials", update_credentials)

    MCPToolManageService.update_provider_credentials_in_new_transaction(
        provider_id="provider-id",
        tenant_id="tenant-id",
        credentials={"access_token": "token"},
        authed=True,
        session_maker=sqlite_session_factory,
    )

    assert isinstance(observed["session"], Session)
    assert observed["in_transaction"] is True
    assert observed["provider_id"] == "provider-id"
    assert observed["tenant_id"] == "tenant-id"
    assert observed["credentials"] == {"access_token": "token"}
    assert observed["authed"] is True
