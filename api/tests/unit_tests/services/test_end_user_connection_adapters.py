import json

import httpx
import pytest
from sqlalchemy.orm import Session, sessionmaker

from clients.plugin.auth_entities import CredentialCheckResult
from clients.plugin.errors import PluginNotImplementedError
from core.tools.tool_manager import ToolManager
from services import end_user_connection_adapters as adapters
from services.end_user_connections.errors import (
    ConnectionConfigurationError,
    ConnectionInvalidCredentialsError,
    ConnectionSecretUnavailableError,
)
from tests.helpers.end_user_api_key import PROVIDER, ScriptedAuth, make_harness, plugin_provider


def test_cipher_encrypts_the_entire_payload_with_the_tenant_key(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []

    def encrypt(tenant_id: str, value: str) -> str:
        calls.append((tenant_id, value))
        return "ciphertext"

    monkeypatch.setattr(adapters, "encrypt_token", encrypt)
    monkeypatch.setattr(
        adapters,
        "decrypt_token",
        lambda tenant, value: calls[0][1] if (tenant, value) == ("tenant", "ciphertext") else "null",
    )
    cipher = adapters.TenantConnectionCipher()
    assert cipher.encrypt("tenant", {"api_key": "secret", "endpoint": "https://provider.example"}) == "ciphertext"
    assert calls[0][0] == "tenant"
    assert json.loads(calls[0][1]) == {"api_key": "secret", "endpoint": "https://provider.example"}
    assert cipher.decrypt("tenant", "ciphertext")["api_key"] == "secret"
    with pytest.raises(ConnectionSecretUnavailableError):
        cipher.decrypt("other", "ciphertext")


@pytest.mark.parametrize("operation", ["encrypt_token", "decrypt_token"])
def test_cipher_failure_does_not_echo_provider_secrets(monkeypatch: pytest.MonkeyPatch, operation: str) -> None:
    def fail(*_args: object) -> str:
        raise ValueError("sensitive-secret")

    monkeypatch.setattr(adapters, operation, fail)
    cipher = adapters.TenantConnectionCipher()
    attempt = (
        (lambda: cipher.encrypt("tenant", {"api_key": "sensitive-secret"}))
        if operation == "encrypt_token"
        else (lambda: cipher.decrypt("tenant", "ciphertext"))
    )
    with pytest.raises(ConnectionSecretUnavailableError) as exc:
        attempt()
    assert "sensitive-secret" not in str(exc.value)
    assert exc.value.__suppress_context__


def test_gateway_rejects_cross_tenant_provider_cache_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    controller = plugin_provider("other-tenant")
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_args: controller)
    gateway = adapters.PluginApiKeyCredentialGateway(auth=ScriptedAuth())
    with pytest.raises(ConnectionConfigurationError):
        gateway.provider("tenant", PROVIDER)


@pytest.mark.parametrize("failure", [PluginNotImplementedError("unsupported"), httpx.ReadTimeout("sensitive-secret")])
def test_plugin_failures_remain_unsupported_or_temporary(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, failure: Exception
) -> None:
    harness = make_harness(sqlite_session_factory)
    gateway = adapters.PluginApiKeyCredentialGateway(auth=harness.auth)
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_args: plugin_provider(harness.context.tenant_id))

    def fail(**_kwargs: object) -> CredentialCheckResult:
        raise failure

    monkeypatch.setattr(harness.auth, "check_provider_credentials", fail)
    result = gateway.check(harness.context, PROVIDER, {"api_key": "sensitive-secret"})
    assert result.status == (
        "unsupported" if isinstance(failure, PluginNotImplementedError) else "temporarily_unavailable"
    )
    assert "sensitive-secret" not in result.model_dump_json()


def test_empty_required_key_is_rejected_even_if_checking_is_unsupported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ToolManager, "get_builtin_provider", lambda *_args: plugin_provider("tenant"))
    gateway = adapters.PluginApiKeyCredentialGateway(auth=ScriptedAuth())
    with pytest.raises(ConnectionInvalidCredentialsError):
        gateway.validate_format("tenant", PROVIDER, {"api_key": ""})
