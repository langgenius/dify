"""OAuth adapter boundary: retained grants, failure classification and deployment admission."""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth.auth_flow import refresh_authorization
from core.mcp.entities import AuthAction, AuthActionType, AuthResult
from core.mcp.error import MCPRefreshTokenError
from core.mcp.types import OAuthClientInformation
from services.credentials.mcp_runtime import MCPCredentialRecord, MCPCredentialUnavailableError
from services.credentials.mcp_runtime_adapters import MCPProviderCredentialRuntime
from services.credentials.refresh import CredentialRefreshUnavailableError
from tests.helpers.unit.core.mcp.fixtures import make_provider


@pytest.fixture
def record(monkeypatch: pytest.MonkeyPatch) -> MCPCredentialRecord:
    monkeypatch.setattr(MCPProviderEntity, "_decrypt_dict", lambda _self, data: data.copy())
    monkeypatch.setattr(MCPProviderEntity, "decrypt_server_url", lambda self: self.server_url)
    entity = make_provider(
        {
            "access_token": "old",
            "refresh_token": "retained",
            "scope": "original",
            "client_information": {"client_id": "client"},
        }
    )
    entity.authed = True
    return MCPCredentialRecord(
        entity.id, entity.tenant_id, entity.server_identifier, "encrypted", entity.model_dump(), True
    )


def test_refresh_retains_client_and_omitted_token_fields(record: MCPCredentialRecord) -> None:
    record.data["credentials"]["client_information"]["encrypted_client_secret"] = "encrypted-secret"
    result = AuthResult(
        actions=[
            AuthAction(
                action_type=AuthActionType.SAVE_TOKENS,
                data={"access_token": "new", "refresh_token": None, "scope": None},
            )
        ],
        response={"result": "success"},
    )
    with (
        patch("services.credentials.mcp_runtime_adapters.auth", return_value=result) as auth,
        patch("services.credentials.mcp_runtime_adapters.create_provider_encrypter") as factory,
        patch("core.entities.mcp_provider.encrypter.decrypt_token", return_value="plaintext-secret"),
    ):
        encrypter = MagicMock()
        encrypter.encrypt.side_effect = lambda values: values
        factory.return_value = (encrypter, None)
        encrypted = MCPProviderCredentialRuntime().refresh(
            record, resource_metadata_url="https://metadata", scope_hint="read"
        )
    values = json.loads(encrypted)
    assert values == {**record.data["credentials"], "access_token": "new"}
    assert "plaintext-secret" not in encrypted
    assert "client_secret" not in record.data["credentials"]["client_information"]
    assert auth.call_args.kwargs["scope_hint"] == "read"
    assert auth.call_args.kwargs["resource_metadata_url"] == "https://metadata"


@pytest.mark.parametrize("permanent", [True, False])
def test_oauth_failure_mapping(record: MCPCredentialRecord, permanent: bool) -> None:
    expected = MCPCredentialUnavailableError if permanent else CredentialRefreshUnavailableError
    with (
        patch(
            "services.credentials.mcp_runtime_adapters.auth",
            side_effect=MCPRefreshTokenError("rejected", permanent=permanent),
        ),
        pytest.raises(expected),
    ):
        MCPProviderCredentialRuntime().refresh(record)


@pytest.mark.parametrize(
    ("status", "error", "permanent"),
    [
        (400, "invalid_grant", True),
        (401, "invalid_client", True),
        (503, "invalid_grant", False),
        (429, "slow_down", False),
    ],
)
def test_token_endpoint_rejections(status: int, error: str, permanent: bool) -> None:
    with (
        patch("core.helper.ssrf_proxy.post", return_value=httpx.Response(status, json={"error": error})),
        pytest.raises(MCPRefreshTokenError) as raised,
    ):
        refresh_authorization("https://mcp.example", None, OAuthClientInformation(client_id="client"), "refresh")
    assert raised.value.permanent is permanent


@pytest.mark.parametrize(
    ("identity", "headers"), [("idp_token", {}), ("off", {"X-Token": "{{request.headers.token}}"})]
)
def test_deployed_restrictions_preserve_debug(
    record: MCPCredentialRecord, identity: str, headers: dict[str, str]
) -> None:
    record.data.update(identity_mode=identity, headers=headers)
    runtime = MCPProviderCredentialRuntime()
    with pytest.raises(MCPCredentialUnavailableError):
        runtime.resolve(record)
    assert runtime.resolve(record, deployed=False)["server_url"] == "https://api.example.com"


@pytest.mark.parametrize("headers", [{"X-Token": "static"}, {"X-Token": "{{request.headers.token}}"}])
def test_header_credentials_cannot_refresh_or_start_oauth(record: MCPCredentialRecord, headers: dict[str, str]) -> None:
    record.data["headers"] = headers
    with (
        patch("services.credentials.mcp_runtime_adapters.auth") as auth,
        pytest.raises(CredentialRefreshUnavailableError),
    ):
        MCPProviderCredentialRuntime().refresh(record)
    auth.assert_not_called()
