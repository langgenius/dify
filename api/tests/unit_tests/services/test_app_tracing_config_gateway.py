import builtins
from collections.abc import Callable
from functools import partial
from types import ModuleType
from typing import cast, override
from unittest.mock import Mock, patch

import pytest
from pydantic import field_validator

from core.ops import provider_config
from core.ops.exceptions import TraceProviderNotInstalledError
from core.ops.provider_config import (
    BaseTracingConfig,
    TracingProviderEnum,
    decrypt_provider_config,
    encrypt_provider_config,
    get_provider_config_class,
    mask_provider_config,
)
from core.ops.provider_export import create_provider_client
from services import app_tracing_config_gateway
from services.app_tracing_config_gateway import TraceProviderConfigChecks
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProviderUnavailableError,
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
    def get_config_class(provider_name: str) -> type[BaseTracingConfig]:
        if provider_name != "langfuse":
            raise ValueError("Unknown test provider")
        return GatewayProviderConfig

    monkeypatch.setattr(provider_config, "get_provider_config_class", get_config_class)
    monkeypatch.setattr(app_tracing_config_gateway, "get_provider_config_class", get_config_class)


def test_provider_config_preserves_masked_credentials_without_mutating_inputs() -> None:
    previous = {
        "credential": "encrypted-first",
        "secondary_credential": "encrypted-second",
        "endpoint": "https://old.example",
    }
    submitted = {"credential": "fir***", "secondary_credential": "sec***", "endpoint": "https://new.example"}
    with patch("core.helper.encrypter.encrypt_token") as encrypt:
        encrypted = encrypt_provider_config("tenant-a", "langfuse", submitted, previous)
    encrypt.assert_not_called()
    assert encrypted["credential"] == "encrypted-first"
    assert encrypted["secondary_credential"] == "encrypted-second"
    assert previous["endpoint"] == "https://old.example"
    assert submitted["credential"] == "fir***"
    with patch("core.helper.encrypter.batch_decrypt_token", return_value=["first-value", "second-value"]) as decrypt:
        decrypted = decrypt_provider_config("tenant-a", "langfuse", encrypted)
    decrypt.assert_called_once_with("tenant-a", ["encrypted-first", "encrypted-second"])
    masked = mask_provider_config("langfuse", decrypted)
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
            tracing_provider="langfuse",
            tracing_config={"credential": "one", "project": "A"},
        )
        assert result == {"credential": "cipher"}
        assert create.call_args.args[1]["credential"] == "one"
        assert encrypt.call_args.args[0] == "tenant-a"
        client.verify_credentials.return_value = False
        with pytest.raises(AppTracingConfigVerificationFailedError):
            checks.prepare_new_config(
                workspace_id="tenant-b",
                tracing_provider="langfuse",
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
                tracing_provider="langfuse",
                tracing_config={"credential": "value", "endpoint": "file:///tmp/trace"},
            )
    create.assert_not_called()


@pytest.mark.parametrize("provider", TracingProviderEnum)
def test_validate_provider_does_not_load_optional_dependencies(provider: TracingProviderEnum) -> None:
    with patch("services.app_tracing_config_gateway.get_provider_config_class") as load_provider:
        TraceProviderConfigChecks().validate_provider(provider.value)
    load_provider.assert_not_called()


@pytest.mark.parametrize("update", [False, True])
def test_prepare_config_reports_missing_provider_dependencies(update: bool) -> None:
    missing_dependency = TraceProviderNotInstalledError("weave", "wandb")
    checks = TraceProviderConfigChecks()
    prepare = partial(checks.prepare_updated_config, current_tracing_config={}) if update else checks.prepare_new_config
    with (
        patch("core.ops.provider_config.get_provider_config_class", side_effect=missing_dependency),
        patch("services.app_tracing_config_gateway.get_provider_config_class", side_effect=missing_dependency),
        pytest.raises(AppTracingConfigProviderUnavailableError) as caught,
    ):
        prepare(workspace_id="tenant-a", tracing_provider="weave", tracing_config={})
    assert caught.value.__cause__ is missing_dependency


def test_present_config_reports_missing_provider_dependencies() -> None:
    missing_dependency = TraceProviderNotInstalledError("weave", "wandb")
    with (
        patch("services.app_tracing_config_gateway.decrypt_provider_config", side_effect=missing_dependency),
        pytest.raises(AppTracingConfigProviderUnavailableError) as caught,
    ):
        TraceProviderConfigChecks().present_config(
            workspace_id="tenant-a", tracing_provider="weave", tracing_config={"api_key": "encrypted"}
        )
    assert caught.value.__cause__ is missing_dependency


@pytest.mark.parametrize(
    "load_provider", [get_provider_config_class, partial(create_provider_client, provider_config={})]
)
@pytest.mark.parametrize(
    ("failure", "unavailable"),
    [
        (ModuleNotFoundError("No module named 'missing_trace_dependency'", name="missing_trace_dependency"), True),
        (ImportError("cannot import provider client"), False),
        (ModuleNotFoundError("SDK import failed without identifying a missing module"), False),
        (ModuleNotFoundError("No module named 'json.missing_module'", name="json.missing_module"), False),
    ],
)
def test_provider_loaders_distinguish_missing_dependencies_from_broken_imports(
    load_provider: Callable[[str], object], failure: ImportError, unavailable: bool
) -> None:
    original_import = builtins.__import__

    def broken_import(name: str, *args: object, **kwargs: object) -> ModuleType:
        if name.startswith("dify_trace_weave."):
            raise failure
        return cast(Callable[..., ModuleType], original_import)(name, *args, **kwargs)

    expected = TraceProviderNotInstalledError if unavailable else ImportError
    with patch("builtins.__import__", side_effect=broken_import), pytest.raises(expected) as caught:
        load_provider("weave")
    if unavailable:
        assert caught.value.__cause__ is failure
    else:
        assert caught.value is failure


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
            tracing_provider="langfuse",
            tracing_config=settings,
            current_tracing_config=previous,
        )
    assert result == (previous if previous_decrypts else replacement)
    create.return_value.verify_credentials.assert_called_once()
