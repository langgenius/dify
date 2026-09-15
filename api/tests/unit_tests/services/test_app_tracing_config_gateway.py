from typing import override
from unittest.mock import Mock, patch

import pytest
from pydantic import field_validator

from core.ops import provider_config
from core.ops.provider_config import (
    BaseTracingConfig,
    ProviderConfigFields,
    decrypt_provider_config,
    encrypt_provider_config,
    mask_provider_config,
)
from services import app_tracing_config_gateway
from services.app_tracing_config_gateway import TraceProviderConfigChecks
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigVerificationFailedError,
)


class GatewayProviderConfig(BaseTracingConfig):
    credential: str
    secondary_credential: str | None = None
    endpoint: str = "https://collector.example"
    project: str = "default-project"

    @classmethod
    @override
    def secret_fields(cls) -> tuple[str, ...]:
        return ("credential", "secondary_credential")

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        return cls.validate_endpoint_url(value, "https://collector.example")


@pytest.fixture(autouse=True)
def use_generic_provider_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    def get_fields(provider_name: str) -> ProviderConfigFields:
        if provider_name != "test-provider":
            raise ValueError("Unknown test provider")
        return ProviderConfigFields(GatewayProviderConfig)

    monkeypatch.setattr(provider_config, "get_provider_config_fields", get_fields)
    monkeypatch.setattr(app_tracing_config_gateway, "get_provider_config_fields", get_fields)


def test_provider_config_preserves_masked_credentials_without_mutating_inputs() -> None:
    previous = {
        "credential": "encrypted-first",
        "secondary_credential": "encrypted-second",
        "endpoint": "https://old.example",
    }
    submitted = {"credential": "fir***", "secondary_credential": "sec***", "endpoint": "https://new.example"}
    with patch("core.helper.encrypter.encrypt_token") as encrypt:
        encrypted = encrypt_provider_config("tenant-a", "test-provider", submitted, previous)
    encrypt.assert_not_called()
    assert encrypted["credential"] == "encrypted-first"
    assert encrypted["secondary_credential"] == "encrypted-second"
    assert previous["endpoint"] == "https://old.example"
    assert submitted["credential"] == "fir***"
    with patch("core.helper.encrypter.batch_decrypt_token", return_value=["first-value", "second-value"]) as decrypt:
        decrypted = decrypt_provider_config("tenant-a", "test-provider", encrypted)
    decrypt.assert_called_once_with("tenant-a", ["encrypted-first", "encrypted-second"])
    masked = mask_provider_config("test-provider", decrypted)
    assert masked["secondary_credential"] != "second-value"
    assert decrypted["secondary_credential"] == "second-value"
    assert encrypted["secondary_credential"] == "encrypted-second"


def test_config_checks_verify_before_encrypt_and_use_only_request_settings() -> None:
    checks = TraceProviderConfigChecks()
    client = Mock()
    client.verify_credentials.return_value = True
    with (
        patch("core.ops.provider_export.create_provider_client", return_value=client) as create,
        patch(
            "services.app_tracing_config_gateway.encrypt_provider_config", return_value={"credential": "cipher"}
        ) as encrypt,
    ):
        result = checks.prepare_new_config(
            workspace_id="tenant-a",
            tracing_provider="test-provider",
            tracing_config={"credential": "one", "project": "A"},
        )
        assert result == {"credential": "cipher"}
        assert create.call_args.args[1]["credential"] == "one"
        assert encrypt.call_args.args[0] == "tenant-a"
        client.verify_credentials.return_value = False
        with pytest.raises(AppTracingConfigVerificationFailedError):
            checks.prepare_new_config(
                workspace_id="tenant-b",
                tracing_provider="test-provider",
                tracing_config={"credential": "two", "project": "B"},
            )
        assert create.call_args.args[1]["credential"] == "two"
        assert encrypt.call_count == 1


def test_invalid_configuration_never_contacts_provider() -> None:
    checks = TraceProviderConfigChecks()
    with pytest.raises(AppTracingConfigInvalidProviderError):
        checks.validate_provider("unknown")
    with patch("core.ops.provider_export.create_provider_client") as create:
        with pytest.raises(AppTracingConfigInvalidConfigurationError):
            checks.prepare_new_config(
                workspace_id="tenant-a",
                tracing_provider="test-provider",
                tracing_config={"credential": "value", "endpoint": "file:///tmp/trace"},
            )
    create.assert_not_called()


@pytest.mark.parametrize("previous_decrypts", [True, False])
def test_config_save_preserves_ciphertext_for_noop_and_can_repair_old_credentials(previous_decrypts: bool) -> None:
    previous = {"credential": "old-cipher"}
    replacement = {"credential": "new-cipher"}
    settings = {"credential": "same-plaintext", "project": "same-project"}
    with (
        patch("services.app_tracing_config_gateway.encrypt_provider_config", return_value=replacement),
        patch(
            "services.app_tracing_config_gateway.decrypt_provider_config",
            side_effect=[settings, settings if previous_decrypts else ValueError("invalid old ciphertext")],
        ),
        patch("core.ops.provider_export.create_provider_client") as create,
    ):
        result = TraceProviderConfigChecks().prepare_updated_config(
            workspace_id="tenant-a",
            tracing_provider="test-provider",
            tracing_config=settings,
            current_tracing_config=previous,
        )
    assert result == (previous if previous_decrypts else replacement)
    create.return_value.verify_credentials.assert_called_once()
