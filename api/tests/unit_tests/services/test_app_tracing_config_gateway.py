from unittest.mock import Mock, patch

import pytest

from core.ops.provider_config import decrypt_provider_config, encrypt_provider_config, mask_provider_config
from services.app_tracing_config_gateway import TraceProviderConfigChecks
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigVerificationFailedError,
)


def test_provider_config_preserves_masked_credentials_without_mutating_inputs() -> None:
    previous = {"public_key": "encrypted-public", "secret_key": "encrypted-secret", "host": "https://old.example"}
    submitted = {"public_key": "pub***", "secret_key": "sec***", "host": "https://new.example"}
    with patch("core.helper.encrypter.encrypt_token") as encrypt:
        encrypted = encrypt_provider_config("tenant-a", "langfuse", submitted, previous)
    encrypt.assert_not_called()
    assert encrypted["public_key"] == "encrypted-public"
    assert encrypted["secret_key"] == "encrypted-secret"
    assert previous["host"] == "https://old.example"
    assert submitted["public_key"] == "pub***"
    with patch("core.helper.encrypter.batch_decrypt_token", return_value=["public-value", "secret-value"]) as decrypt:
        decrypted = decrypt_provider_config("tenant-a", "langfuse", encrypted)
    decrypt.assert_called_once_with("tenant-a", ["encrypted-public", "encrypted-secret"])
    masked = mask_provider_config("langfuse", decrypted)
    assert masked["secret_key"] != "secret-value"
    assert decrypted["secret_key"] == "secret-value"
    assert encrypted["secret_key"] == "encrypted-secret"


def test_config_checks_verify_before_encrypt_and_use_only_request_settings() -> None:
    checks = TraceProviderConfigChecks()
    client = Mock()
    client.verify_credentials.return_value = True
    with (
        patch("core.ops.provider_export.create_provider_client", return_value=client) as create,
        patch(
            "services.app_tracing_config_gateway.encrypt_provider_config", return_value={"api_key": "cipher"}
        ) as encrypt,
    ):
        result = checks.prepare_new_config(
            workspace_id="tenant-a", tracing_provider="langsmith", tracing_config={"api_key": "one", "project": "A"}
        )
        assert result == {"api_key": "cipher"}
        assert create.call_args.args[1]["api_key"] == "one"
        assert encrypt.call_args.args[0] == "tenant-a"
        client.verify_credentials.return_value = False
        with pytest.raises(AppTracingConfigVerificationFailedError):
            checks.prepare_new_config(
                workspace_id="tenant-b", tracing_provider="langsmith", tracing_config={"api_key": "two", "project": "B"}
            )
        assert create.call_args.args[1]["api_key"] == "two"
        assert encrypt.call_count == 1


def test_invalid_configuration_never_contacts_provider() -> None:
    checks = TraceProviderConfigChecks()
    with pytest.raises(AppTracingConfigInvalidProviderError):
        checks.validate_provider("unknown")
    with patch("core.ops.provider_export.create_provider_client") as create:
        with pytest.raises(AppTracingConfigInvalidConfigurationError):
            checks.prepare_new_config(
                workspace_id="tenant-a", tracing_provider="langsmith", tracing_config={"endpoint": "file:///tmp/trace"}
            )
    create.assert_not_called()
