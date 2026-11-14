"""OAuth adapter boundary: retained grants, failure classification and deployment admission."""

import json
from dataclasses import replace
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core.entities.mcp_provider import MCPProviderEntity
from core.mcp.auth.auth_flow import refresh_authorization
from core.mcp.entities import AuthAction, AuthActionType, AuthResult
from core.mcp.error import MCPRefreshTokenError
from core.mcp.types import OAuthClientInformation
from services.credentials.mcp_runtime import (
    MCPCredentialRecord,
    MCPCredentialService,
    MCPCredentialUnavailableError,
    mcp_credential_digest,
)
from services.credentials.mcp_runtime_adapters import MCPProviderCredentialRuntime
from services.credentials.refresh import CredentialRefreshUnavailableError
from tests.helpers.unit.core.mcp.fixtures import make_provider
from tests.helpers.unit.credential_refresh import ThreadCredentialRefreshLock


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
    assert values == {**record.data["credentials"], "access_token": "new", "expires_at": 0}
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
    ("identity", "headers"),
    [
        ("off", {}),
        ("idp_token", {}),
        ("off", {"X-Token": "{{request.headers.token}}"}),
        ("idp_token", {"X-Token": "{{request.headers.token}}"}),
    ],
)
def test_deployed_returns_raw_connection_and_identity_without_issuing_tokens(
    record: MCPCredentialRecord, identity: str, headers: dict[str, str]
) -> None:
    from flask import Flask

    record.data.update(identity_mode=identity, headers=headers)
    runtime = MCPProviderCredentialRuntime()
    with (
        Flask(__name__).test_request_context(headers={"token": "internal-request-must-not-leak"}),
        patch("services.enterprise.enterprise_service.EnterpriseService.issue_mcp_token") as issue,
        patch("services.credentials.mcp_runtime_adapters.auth") as auth,
    ):
        deployed = runtime.resolve(record)
        debug = runtime.resolve(record, deployed=False)
    assert deployed == {**debug, "identity_mode": identity}
    assert debug == {
        "server_url": "https://api.example.com",
        "headers": headers or {"Authorization": "Bearer old"},
    }
    assert mcp_credential_digest(deployed) == mcp_credential_digest(debug)
    issue.assert_not_called()
    auth.assert_not_called()


def test_unknown_identity_mode_is_rejected_before_refresh(record: MCPCredentialRecord) -> None:
    record.data["identity_mode"] = "unknown"
    runtime = MCPProviderCredentialRuntime()
    with pytest.raises(MCPCredentialUnavailableError):
        runtime.needs_refresh(record, now=1000)
    with pytest.raises(MCPCredentialUnavailableError):
        runtime.resolve(record)


@pytest.mark.parametrize("headers", [{"X-Token": "static"}, {"X-Token": "{{request.headers.token}}"}])
def test_header_credentials_cannot_refresh_or_start_oauth(record: MCPCredentialRecord, headers: dict[str, str]) -> None:
    record.data["headers"] = headers
    with (
        patch("services.credentials.mcp_runtime_adapters.auth") as auth,
        pytest.raises(CredentialRefreshUnavailableError),
    ):
        MCPProviderCredentialRuntime().refresh(record)
    auth.assert_not_called()


@pytest.mark.parametrize(
    ("lifetime", "remaining", "expected"),
    [
        (3600, 301, False),
        (3600, 300, False),
        (3600, 299, True),
        (120, 120, False),
        (120, 60, False),
        (120, 59, True),
        (120, 0, True),
        (120, -1, True),
    ],
)
def test_proactive_expiry_boundaries(
    record: MCPCredentialRecord, lifetime: int, remaining: int, expected: bool
) -> None:
    record.data["credentials"].update(expires_in=lifetime, expires_at=1000 + remaining)
    assert MCPProviderCredentialRuntime().needs_refresh(record, now=1000) is expected


def test_legacy_and_header_credentials_do_not_proactively_refresh(record: MCPCredentialRecord) -> None:
    runtime = MCPProviderCredentialRuntime()
    assert not runtime.needs_refresh(record, now=1000)
    record.data["credentials"].update(expires_in=120, expires_at=900)
    record.data["headers"] = {"Authorization": "static"}
    assert not runtime.needs_refresh(record, now=1000)


@pytest.mark.parametrize("lifetime", [120, None, 0])
def test_refresh_replaces_old_expiry(record: MCPCredentialRecord, lifetime: int | None) -> None:
    record.data["credentials"]["expires_at"] = 900
    result = AuthResult(
        actions=[
            AuthAction(action_type=AuthActionType.SAVE_TOKENS, data={"access_token": "new", "expires_in": lifetime})
        ],
        response={},
    )
    with (
        patch("services.credentials.mcp_runtime_adapters.auth", return_value=result),
        patch("services.credentials.mcp_runtime_adapters.time.time", return_value=1000),
        patch("services.credentials.mcp_runtime_adapters.create_provider_encrypter") as factory,
    ):
        encrypter = MagicMock()
        encrypter.encrypt.side_effect = lambda values: values
        factory.return_value = (encrypter, None)
        values = json.loads(MCPProviderCredentialRuntime().refresh(record))
    assert values["expires_at"] == (1120 if lifetime == 120 else 0)
    assert all(field.name not in ("expires_at", "expires_in") for field in factory.call_args.kwargs["config"])


def test_short_token_resolve_refreshes_before_expiry_then_reuses_new_token(record: MCPCredentialRecord) -> None:
    record.data["credentials"].update(expires_in=120, expires_at=1059)
    snapshots = [record]
    store = MagicMock()
    store.get_mcp_credential.side_effect = lambda **_kwargs: snapshots[0]

    def save(*, record: MCPCredentialRecord, encrypted_credentials: str, authed: bool) -> bool:
        snapshots[0] = replace(
            record,
            encrypted_credentials=encrypted_credentials,
            authed=authed,
            data={**record.data, "credentials": json.loads(encrypted_credentials)},
        )
        return True

    store.update_mcp_credential_if_unchanged.side_effect = save
    result = AuthResult(
        actions=[AuthAction(action_type=AuthActionType.SAVE_TOKENS, data={"access_token": "new", "expires_in": 120})],
        response={},
    )
    service = MCPCredentialService(
        credentials=store, runtime=MCPProviderCredentialRuntime(), refresh_lock=ThreadCredentialRefreshLock()
    )
    with (
        patch("services.credentials.mcp_runtime.time.time", return_value=1000),
        patch("services.credentials.mcp_runtime_adapters.auth", return_value=result) as auth,
        patch("services.credentials.mcp_runtime_adapters.create_provider_encrypter") as factory,
    ):
        encrypter = MagicMock()
        encrypter.encrypt.side_effect = lambda values: values
        factory.return_value = (encrypter, None)
        first = service.resolve(workspace_id=record.workspace_id, provider=record.provider, credential_id=record.id)
        second = service.resolve(workspace_id=record.workspace_id, provider=record.provider, credential_id=record.id)
    assert (
        first
        == second
        == {
            "server_url": "https://api.example.com",
            "headers": {"Authorization": "Bearer new"},
            "identity_mode": "off",
        }
    )
    assert snapshots[0].data["credentials"]["expires_at"] == 1120
    auth.assert_called_once()
