"""Compatibility gateway for the legacy tracing provider implementations."""

import logging
from typing import Any, override

from pydantic import ValidationError

from core.ops.entities.config_entity import BaseTracingConfig, TracingProviderEnum
from core.ops.exceptions import TraceProviderNotInstalledError
from core.ops.ops_trace_manager import OpsTraceManager, TracingProviderConfigEntry, provider_config_map
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProcessingError,
    AppTracingConfigProviderUnavailableError,
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
        if tracing_provider not in TracingProviderEnum:
            raise AppTracingConfigInvalidProviderError(tracing_provider)

    def require_provider_available(self, tracing_provider: str) -> None:
        self._provider_config(tracing_provider)

    @override
    def validate_saved_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> None:
        provider_config = self._provider_config(tracing_provider)
        try:
            decrypted = OpsTraceManager.decrypt_tracing_config(workspace_id, tracing_provider, tracing_config)
        except Exception as error:
            raise AppTracingConfigProcessingError from error
        self._validate_config(provider_config, decrypted)

    @override
    def prepare_new_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
    ) -> dict[str, Any]:
        provider_config = self._provider_config(tracing_provider)
        if tracing_provider == "tencent":
            normalized_config = self._normalize_tencent_config(tracing_config)
        elif tracing_provider == "mlflow":
            normalized_config = self._normalize_mlflow_config(tracing_config)
        else:
            normalized_config = self._normalize_config(provider_config, tracing_config)
        self._verify_config(normalized_config, tracing_provider)

        project_url = self._get_project_url(normalized_config, tracing_provider)
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
        if tracing_provider == "tencent":
            # Check the original URL before the legacy model discards its path
            # and query. Masked tokens are restored by encryption below.
            tracing_config = self._normalize_tencent_config(tracing_config)
        elif tracing_provider == "mlflow":
            tracing_config = self._normalize_mlflow_config(tracing_config)
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
        if tracing_provider == "weave":
            # Verification resolves an optional entity and qualified project name.
            # Encryption happened first to restore masked credentials; persist the
            # verified non-secret destination alongside that unchanged ciphertext.
            encrypted_config["entity"] = decrypted_config["entity"]
            encrypted_config["project"] = decrypted_config["project"]
        elif tracing_provider == "databricks":
            encrypted_config["host"] = decrypted_config["host"]
            encrypted_config["experiment_id"] = decrypted_config["experiment_id"]
        elif tracing_provider == "mlflow":
            encrypted_config["tracking_uri"] = decrypted_config["tracking_uri"]
            encrypted_config["experiment_id"] = decrypted_config["experiment_id"]
        elif tracing_provider == "opik":
            for key in ("url", "workspace", "project"):
                encrypted_config[key] = decrypted_config[key]
        # Re-resolve after destination changes; never retain a previous project's link.
        project_url = self._get_project_url(decrypted_config, tracing_provider)
        if project_url:
            encrypted_config["project_url"] = project_url
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
        except TraceProviderNotInstalledError as error:
            raise AppTracingConfigProviderUnavailableError from error
        except Exception as error:
            raise AppTracingConfigProcessingError from error

        if tracing_provider == "tencent":
            from dify_trace_tencent.configuration import console_url

            # Historical names remain readable. GET performs no connection
            # check and never constructs legacy tracing or metrics exporters.
            presented_config["project_url"] = console_url()
        elif tracing_provider == "opik":
            from dify_trace_opik.config import OpikConfig
            from dify_trace_opik.configuration import console_url, project_url

            try:
                config = OpikConfig.model_validate(decrypted_config)
                presented_config["project_url"] = project_url(config) or console_url(config)
            except ValueError:
                presented_config["project_url"] = _PROJECT_URL_FALLBACKS["opik"]
        elif tracing_provider == "mlflow":
            from dify_trace_mlflow.config import MLflowConfig
            from dify_trace_mlflow.oss_configuration import project_url

            try:
                presented_config["project_url"] = project_url(MLflowConfig.model_validate(decrypted_config))
            except ValueError:
                # OSS deployments have no universal project destination. Never
                # initialize an SDK or substitute localhost for an invalid URL.
                presented_config["project_url"] = None
        elif tracing_provider == "databricks":
            from dify_trace_mlflow.config import DatabricksConfig
            from dify_trace_mlflow.configuration import project_url

            try:
                presented_config["project_url"] = project_url(DatabricksConfig.model_validate(decrypted_config))
            except ValueError:
                presented_config["project_url"] = _PROJECT_URL_FALLBACKS["databricks"]
        elif tracing_provider == "weave":
            from dify_trace_weave.config import WeaveConfig
            from dify_trace_weave.configuration import console_url, project_url

            try:
                config = WeaveConfig.model_validate(decrypted_config)
                presented_config["project_url"] = project_url(config) or console_url(config)
            except ValueError:
                presented_config["project_url"] = _PROJECT_URL_FALLBACKS["weave"]
        elif tracing_provider == "langfuse" and not decrypted_config.get("project_key"):
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
        except TraceProviderNotInstalledError as error:
            raise AppTracingConfigProviderUnavailableError from error

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
    def _normalize_tencent_config(tracing_config: dict[str, Any]) -> dict[str, Any]:
        from dify_trace_tencent.configuration import TencentConfigurationError, normalize_configuration

        try:
            return normalize_configuration(tracing_config).model_dump()
        except TencentConfigurationError as error:
            raise AppTracingConfigInvalidConfigurationError from error

    @staticmethod
    def _normalize_mlflow_config(tracing_config: dict[str, Any]) -> dict[str, Any]:
        from dify_trace_mlflow.oss_configuration import normalize_configuration

        try:
            return normalize_configuration(tracing_config).model_dump()
        except ValueError as error:
            raise AppTracingConfigInvalidConfigurationError from error

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
        if tracing_provider == "mlflow":
            from dify_trace_mlflow.config import MLflowConfig
            from dify_trace_mlflow.oss_configuration import MLflowConfigurationError, verify_configuration

            try:
                resolved = verify_configuration(MLflowConfig.model_validate(tracing_config))
            except MLflowConfigurationError as error:
                logger.warning("MLflow configuration verification failed: error_code=%s", error.code)
                raise AppTracingConfigVerificationFailedError from error
            tracing_config["tracking_uri"] = resolved.tracking_uri
            tracing_config["experiment_id"] = resolved.experiment_id
            return
        if tracing_provider == "tencent":
            from dify_trace_tencent.config import TencentConfig
            from dify_trace_tencent.configuration import TencentConfigurationError, verify_configuration

            try:
                verify_configuration(TencentConfig.model_validate(tracing_config))
            except TencentConfigurationError as error:
                logger.warning("Tencent collector connection check failed: error_code=%s", error.code)
                raise AppTracingConfigVerificationFailedError from error
            return
        if tracing_provider == "opik":
            from dify_trace_opik.config import OpikConfig
            from dify_trace_opik.configuration import OpikConfigurationError, verify_configuration

            try:
                resolved = verify_configuration(OpikConfig.model_validate(tracing_config))
            except OpikConfigurationError as error:
                logger.warning("Opik configuration verification failed: error_code=%s", error.code)
                raise AppTracingConfigVerificationFailedError from error
            tracing_config["url"] = resolved.url
            tracing_config["workspace"] = resolved.workspace
            tracing_config["project"] = resolved.project
            return
        if tracing_provider == "databricks":
            from dify_trace_mlflow.config import DatabricksConfig
            from dify_trace_mlflow.configuration import DatabricksConfigurationError, verify_configuration

            try:
                resolved = verify_configuration(DatabricksConfig.model_validate(tracing_config))
            except DatabricksConfigurationError as error:
                logger.warning("Databricks configuration verification failed: error_code=%s", error.code)
                raise AppTracingConfigVerificationFailedError from error
            tracing_config["host"] = resolved.host
            tracing_config["experiment_id"] = resolved.experiment_id
            return
        if tracing_provider == "weave":
            from dify_trace_weave.config import WeaveConfig
            from dify_trace_weave.configuration import WeaveConfigurationError, verify_configuration

            try:
                resolved = verify_configuration(WeaveConfig.model_validate(tracing_config))
            except WeaveConfigurationError as error:
                logger.warning("Weave configuration verification failed: error_code=%s", error.code)
                raise AppTracingConfigVerificationFailedError from error
            tracing_config["entity"] = resolved.entity
            tracing_config["project"] = resolved.project
            return
        try:
            is_effective = OpsTraceManager.check_trace_config_is_effective(tracing_config, tracing_provider)
        except ValueError as error:
            logger.warning("Tracing configuration verification failed for provider %s", tracing_provider, exc_info=True)
            raise AppTracingConfigVerificationFailedError from error
        if not is_effective:
            raise AppTracingConfigVerificationFailedError

    @staticmethod
    def _get_project_url(tracing_config: dict[str, Any], tracing_provider: str) -> str | None:
        try:
            if tracing_provider == "tencent":
                from dify_trace_tencent.configuration import console_url

                return console_url()
            if tracing_provider == "opik":
                from dify_trace_opik.config import OpikConfig
                from dify_trace_opik.configuration import console_url, project_url

                config = OpikConfig.model_validate(tracing_config)
                return project_url(config) or console_url(config)
            if tracing_provider == "databricks":
                from dify_trace_mlflow.config import DatabricksConfig
                from dify_trace_mlflow.configuration import project_url

                return project_url(DatabricksConfig.model_validate(tracing_config))
            if tracing_provider == "mlflow":
                from dify_trace_mlflow.config import MLflowConfig
                from dify_trace_mlflow.oss_configuration import project_url

                return project_url(MLflowConfig.model_validate(tracing_config))
            if tracing_provider == "weave":
                from dify_trace_weave.config import WeaveConfig
                from dify_trace_weave.configuration import project_url

                return project_url(WeaveConfig.model_validate(tracing_config))
            if tracing_provider in ("arize", "phoenix"):
                return OpsTraceManager.get_trace_config_project_url(tracing_config, tracing_provider)
            if tracing_provider == "langfuse":
                project_key = OpsTraceManager.get_trace_config_project_key(tracing_config, tracing_provider)
                return f"{tracing_config.get('host')}/project/{project_key}"
            if tracing_provider in ("langsmith", "opik"):
                return OpsTraceManager.get_trace_config_project_url(tracing_config, tracing_provider)
        except Exception:
            return None
        return None
