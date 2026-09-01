from unittest.mock import patch

import pytest
from pydantic import ValidationInfo, field_validator

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.ops_trace_manager import TracingProviderConfigEntry
from services import app_tracing_config_gateway as gateway_module
from services.app_tracing_config_gateway import OpsTraceManagerGateway
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProcessingError,
    AppTracingConfigVerificationFailedError,
)


class _ProviderConfig(BaseTracingConfig):
    endpoint: str = "https://default.example.com"
    project: str = "default-project"

    @field_validator("endpoint", "project", mode="before")
    @classmethod
    def replace_empty_with_default(cls, value: object, info: ValidationInfo) -> object:
        if value != "":
            return value
        if info.field_name == "endpoint":
            return "https://default.example.com"
        return "default-project"


def _provider_entry(*, other_keys: list[str] | None = None) -> TracingProviderConfigEntry:
    return {
        "config_class": _ProviderConfig,
        "secret_keys": ["api_key"],
        "other_keys": other_keys or [],
        "trace_instance": object,
    }


def test_validate_provider_rejects_unknown_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {})

    with pytest.raises(AppTracingConfigInvalidProviderError, match="Invalid tracing provider: unknown"):
        OpsTraceManagerGateway().validate_provider("unknown")


def test_prepare_new_config_applies_defaults_validates_and_encrypts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        gateway_module,
        "provider_config_map",
        {"arize": _provider_entry(other_keys=["endpoint", "project"])},
    )
    submitted = {"api_key": "plain", "endpoint": "", "project": ""}

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.check_trace_config_is_effective.return_value = True
        manager.get_trace_config_project_url.return_value = "https://project.example.com"
        manager.encrypt_tracing_config.return_value = {"api_key": "encrypted"}

        result = OpsTraceManagerGateway().prepare_new_config(
            workspace_id="workspace-1",
            tracing_provider="arize",
            tracing_config=submitted,
        )

    normalized = {
        "api_key": "plain",
        "endpoint": "https://default.example.com",
        "project": "default-project",
    }
    assert submitted == {"api_key": "plain", "endpoint": "", "project": ""}
    assert result == {"api_key": "encrypted", "project_url": "https://project.example.com"}
    manager.check_trace_config_is_effective.assert_called_once_with(normalized, "arize")
    manager.encrypt_tracing_config.assert_called_once_with("workspace-1", "arize", normalized)


def test_prepare_new_config_reports_failed_verification_before_encryption(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.check_trace_config_is_effective.return_value = False

        with pytest.raises(AppTracingConfigVerificationFailedError):
            OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={"api_key": "plain"},
            )

    manager.encrypt_tracing_config.assert_not_called()


def test_prepare_new_config_keeps_success_when_project_url_lookup_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.check_trace_config_is_effective.return_value = True
        manager.get_trace_config_project_url.side_effect = RuntimeError("provider unavailable")
        manager.encrypt_tracing_config.return_value = {"api_key": "encrypted"}

        result = OpsTraceManagerGateway().prepare_new_config(
            workspace_id="workspace-1",
            tracing_provider="arize",
            tracing_config={"api_key": "plain"},
        )

    assert result == {"api_key": "encrypted"}


def test_prepare_new_langfuse_config_builds_project_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"langfuse": _provider_entry()})

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.check_trace_config_is_effective.return_value = True
        manager.get_trace_config_project_key.return_value = "project-key"
        manager.encrypt_tracing_config.return_value = {"secret_key": "encrypted"}

        result = OpsTraceManagerGateway().prepare_new_config(
            workspace_id="workspace-1",
            tracing_provider="langfuse",
            tracing_config={"host": "https://langfuse.example.com"},
        )

    assert result["project_url"] == "https://langfuse.example.com/project/project-key"


def test_prepare_new_config_reports_provider_check_exception_as_failed_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.check_trace_config_is_effective.side_effect = ValueError("verification failed")

        with pytest.raises(AppTracingConfigVerificationFailedError) as caught:
            OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={},
            )

    assert isinstance(caught.value.__cause__, ValueError)


def test_prepare_new_config_propagates_unexpected_verification_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})
    failure = RuntimeError("unexpected provider bug")

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.check_trace_config_is_effective.side_effect = failure

        with pytest.raises(RuntimeError) as caught:
            OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={},
            )

    assert caught.value is failure
    manager.encrypt_tracing_config.assert_not_called()


def test_prepare_new_config_rejects_invalid_schema_before_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        with pytest.raises(AppTracingConfigInvalidConfigurationError):
            OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={"endpoint": {"invalid": "value"}},
            )

    manager.check_trace_config_is_effective.assert_not_called()
    manager.encrypt_tracing_config.assert_not_called()


def test_prepare_new_config_reports_encryption_failure_as_processing_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})
    failure = RuntimeError("key provider unavailable")

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.check_trace_config_is_effective.return_value = True
        manager.get_trace_config_project_url.return_value = None
        manager.encrypt_tracing_config.side_effect = failure

        with pytest.raises(AppTracingConfigProcessingError) as caught:
            OpsTraceManagerGateway().prepare_new_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={},
            )

    assert caught.value.__cause__ is failure


def test_prepare_updated_config_preserves_masked_secret_from_current_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})
    submitted = {"api_key": "******", "project": "new-project"}
    current = {"api_key": "old-encrypted", "project": "old-project"}
    encrypted = {"api_key": "old-encrypted", "project": "new-project"}
    decrypted = {"api_key": "old-plain", "project": "new-project"}

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.encrypt_tracing_config.return_value = encrypted
        manager.decrypt_tracing_config.return_value = decrypted
        manager.check_trace_config_is_effective.return_value = True

        result = OpsTraceManagerGateway().prepare_updated_config(
            workspace_id="workspace-1",
            tracing_provider="arize",
            tracing_config=submitted,
            current_tracing_config=current,
        )

    assert result == encrypted
    assert submitted == {"api_key": "******", "project": "new-project"}
    manager.encrypt_tracing_config.assert_called_once_with("workspace-1", "arize", submitted, current)
    manager.decrypt_tracing_config.assert_called_once_with("workspace-1", "arize", encrypted)
    manager.check_trace_config_is_effective.assert_called_once_with(decrypted, "arize")


def test_prepare_updated_config_validates_schema_before_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        with pytest.raises(AppTracingConfigInvalidConfigurationError):
            OpsTraceManagerGateway().prepare_updated_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={"endpoint": {"invalid": "value"}},
                current_tracing_config={"api_key": "old-encrypted"},
            )

    manager.encrypt_tracing_config.assert_not_called()
    manager.decrypt_tracing_config.assert_not_called()
    manager.check_trace_config_is_effective.assert_not_called()


def test_prepare_updated_config_reports_decryption_failure_as_processing_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gateway_module, "provider_config_map", {"arize": _provider_entry()})
    failure = RuntimeError("stored credential cannot be decrypted")

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.encrypt_tracing_config.return_value = {"api_key": "encrypted"}
        manager.decrypt_tracing_config.side_effect = failure

        with pytest.raises(AppTracingConfigProcessingError) as caught:
            OpsTraceManagerGateway().prepare_updated_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={"project": "new-project"},
                current_tracing_config={"api_key": "old-encrypted"},
            )

    assert caught.value.__cause__ is failure
    manager.check_trace_config_is_effective.assert_not_called()


@pytest.mark.parametrize(
    ("provider", "fallback_url"),
    [
        ("arize", "https://app.arize.com/"),
        ("phoenix", "https://app.phoenix.arize.com/projects/"),
        ("langsmith", "https://smith.langchain.com/"),
        ("opik", "https://www.comet.com/opik/"),
        ("weave", "https://wandb.ai/"),
        ("aliyun", "https://arms.console.aliyun.com/"),
        ("tencent", "https://console.cloud.tencent.com/apm"),
        ("mlflow", "http://localhost:5000/"),
        ("databricks", "https://www.databricks.com/"),
    ],
)
def test_present_config_uses_provider_fallback_when_project_lookup_fails(
    provider: str,
    fallback_url: str,
) -> None:
    with patch.object(gateway_module, "OpsTraceManager") as manager:
        decrypted_config: dict[str, object] = {}
        presented_config: dict[str, object] = {}
        manager.decrypt_tracing_config.return_value = decrypted_config
        manager.obfuscated_decrypt_token.return_value = presented_config
        manager.get_trace_config_project_url.side_effect = RuntimeError("provider unavailable")

        result = OpsTraceManagerGateway().present_config(
            workspace_id="workspace-1",
            tracing_provider=provider,
            tracing_config={"encrypted": "config"},
        )

    assert result == {"project_url": fallback_url}


def test_present_langfuse_config_builds_project_url() -> None:
    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.decrypt_tracing_config.return_value = {"host": "https://langfuse.example.com"}
        manager.obfuscated_decrypt_token.return_value = {"host": "https://langfuse.example.com"}
        manager.get_trace_config_project_key.return_value = "project-key"

        result = OpsTraceManagerGateway().present_config(
            workspace_id="workspace-1",
            tracing_provider="langfuse",
            tracing_config={"encrypted": "config"},
        )

    assert result["project_url"] == "https://langfuse.example.com/project/project-key"


def test_present_langfuse_config_falls_back_to_host() -> None:
    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.decrypt_tracing_config.return_value = {"host": "https://langfuse.example.com"}
        manager.obfuscated_decrypt_token.return_value = {"host": "https://langfuse.example.com"}
        manager.get_trace_config_project_key.side_effect = RuntimeError("provider unavailable")

        result = OpsTraceManagerGateway().present_config(
            workspace_id="workspace-1",
            tracing_provider="langfuse",
            tracing_config={"encrypted": "config"},
        )

    assert result["project_url"] == "https://langfuse.example.com/"


def test_present_config_rejects_missing_stored_config() -> None:
    with pytest.raises(AppTracingConfigProcessingError, match="processing failed"):
        OpsTraceManagerGateway().present_config(
            workspace_id="workspace-1",
            tracing_provider="arize",
            tracing_config=None,
        )


def test_present_config_reports_decryption_failure_as_processing_error() -> None:
    failure = RuntimeError("stored credential cannot be decrypted")

    with patch.object(gateway_module, "OpsTraceManager") as manager:
        manager.decrypt_tracing_config.side_effect = failure

        with pytest.raises(AppTracingConfigProcessingError) as caught:
            OpsTraceManagerGateway().present_config(
                workspace_id="workspace-1",
                tracing_provider="arize",
                tracing_config={"encrypted": "config"},
            )

    assert caught.value.__cause__ is failure
    manager.obfuscated_decrypt_token.assert_not_called()
