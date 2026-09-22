"""Compatibility gateway for the legacy tracing provider implementations."""

import logging
from typing import Any, override

from pydantic import ValidationError

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.ops_trace_manager import OpsTraceManager, TracingProviderConfigEntry, provider_config_map
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProcessingError,
    AppTracingConfigVerificationFailedError,
    TracingConfigProviderGateway,
)

logger = logging.getLogger(__name__)

_PROJECT_URL_FALLBACKS = {
    "arize": "https://app.arize.com/",
    "phoenix": "https://app.phoenix.arize.com/projects/",
    "langsmith": "https://smith.langchain.com/",
    "opik": "https://www.comet.com/opik/",
    "weave": "https://wandb.ai/",
    "aliyun": "https://arms.console.aliyun.com/",
    "tencent": "https://console.cloud.tencent.com/apm",
    "mlflow": "http://localhost:5000/",
    "databricks": "https://www.databricks.com/",
}


class OpsTraceManagerGateway(TracingConfigProviderGateway):
    @override
    def validate_provider(self, tracing_provider: str) -> None:
        self._provider_config(tracing_provider)

    @override
    def prepare_new_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> dict[str, Any]:
        provider_config = self._provider_config(tracing_provider)
        normalized_config = self._normalize_config(provider_config, tracing_config)
        self._verify_config(normalized_config, tracing_provider)

        project_url = self._get_project_url_for_create(normalized_config, tracing_provider)
        try:
            encrypted_config = OpsTraceManager.encrypt_tracing_config(
                workspace_id,
                tracing_provider,
                normalized_config,
            )
        except Exception as error:
            raise AppTracingConfigProcessingError from error
        if project_url:
            encrypted_config["project_url"] = project_url
        return encrypted_config

    @override
    def prepare_updated_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        current_tracing_config: dict[str, Any] | None,
    ) -> dict[str, Any]:
        provider_config = self._provider_config(tracing_provider)
        self._validate_config(provider_config, tracing_config)
        try:
            encrypted_config = OpsTraceManager.encrypt_tracing_config(
                workspace_id,
                tracing_provider,
                dict(tracing_config),
                current_tracing_config,
            )
            decrypted_config = OpsTraceManager.decrypt_tracing_config(
                workspace_id,
                tracing_provider,
                encrypted_config,
            )
        except Exception as error:
            raise AppTracingConfigProcessingError from error

        self._verify_config(decrypted_config, tracing_provider)
        return encrypted_config

    @override
    def present_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if tracing_config is None:
            raise AppTracingConfigProcessingError

        try:
            decrypted_config = OpsTraceManager.decrypt_tracing_config(
                workspace_id,
                tracing_provider,
                tracing_config,
            )
            presented_config = OpsTraceManager.obfuscated_decrypt_token(tracing_provider, decrypted_config)
        except Exception as error:
            raise AppTracingConfigProcessingError from error

        if tracing_provider == "langfuse" and not decrypted_config.get("project_key"):
            try:
                project_key = OpsTraceManager.get_trace_config_project_key(decrypted_config, tracing_provider)
                presented_config["project_url"] = f"{decrypted_config.get('host')}/project/{project_key}"
            except Exception:
                presented_config["project_url"] = f"{decrypted_config.get('host')}/"
        elif tracing_provider in _PROJECT_URL_FALLBACKS and not decrypted_config.get("project_url"):
            try:
                presented_config["project_url"] = OpsTraceManager.get_trace_config_project_url(
                    decrypted_config,
                    tracing_provider,
                )
            except Exception:
                presented_config["project_url"] = _PROJECT_URL_FALLBACKS[tracing_provider]

        return presented_config

    @staticmethod
    def _provider_config(tracing_provider: str) -> TracingProviderConfigEntry:
        try:
            return provider_config_map[tracing_provider]
        except KeyError as error:
            raise AppTracingConfigInvalidProviderError(tracing_provider) from error

    @staticmethod
    def _normalize_config(
        provider_config: TracingProviderConfigEntry,
        tracing_config: dict[str, Any],
    ) -> dict[str, Any]:
        normalized_config = dict(tracing_config)
        default_config = OpsTraceManagerGateway._validate_config(provider_config, normalized_config)

        default_values = default_config.model_dump()
        for key in provider_config["other_keys"]:
            if normalized_config.get(key) == "":
                normalized_config[key] = default_values.get(key)
        return normalized_config

    @staticmethod
    def _validate_config(
        provider_config: TracingProviderConfigEntry,
        tracing_config: dict[str, Any],
    ) -> BaseTracingConfig:
        config_class: type[BaseTracingConfig] = provider_config["config_class"]
        try:
            return config_class.model_validate(tracing_config)
        except ValidationError as error:
            raise AppTracingConfigInvalidConfigurationError from error

    @staticmethod
    def _verify_config(tracing_config: dict[str, Any], tracing_provider: str) -> None:
        try:
            is_effective = OpsTraceManager.check_trace_config_is_effective(tracing_config, tracing_provider)
        except ValueError as error:
            logger.warning("Tracing configuration verification failed for provider %s", tracing_provider, exc_info=True)
            raise AppTracingConfigVerificationFailedError from error
        if not is_effective:
            raise AppTracingConfigVerificationFailedError

    @staticmethod
    def _get_project_url_for_create(tracing_config: dict[str, Any], tracing_provider: str) -> str | None:
        try:
            if tracing_provider in ("arize", "phoenix"):
                return OpsTraceManager.get_trace_config_project_url(tracing_config, tracing_provider)
            if tracing_provider == "langfuse":
                project_key = OpsTraceManager.get_trace_config_project_key(tracing_config, tracing_provider)
                return f"{tracing_config.get('host')}/project/{project_key}"
            if tracing_provider in ("langsmith", "opik", "mlflow", "databricks", "tencent"):
                return OpsTraceManager.get_trace_config_project_url(tracing_config, tracing_provider)
        except Exception:
            return None
        return None
