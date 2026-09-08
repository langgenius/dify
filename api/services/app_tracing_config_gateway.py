"""Validate and encrypt provider settings without shared SDK configuration."""

from typing import Any, override

from pydantic import ValidationError

from core.ops.provider_config import (
    decrypt_provider_config,
    encrypt_provider_config,
    get_provider_config_fields,
    mask_provider_config,
)
from services.app_tracing_config_service import (
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigProcessingError,
    AppTracingConfigVerificationFailedError,
    TracingConfigProviderGateway,
)


class TraceProviderConfigChecks(TracingConfigProviderGateway):
    @override
    def validate_provider(self, tracing_provider: str) -> None:
        try:
            get_provider_config_fields(tracing_provider)
        except (ValueError, ImportError) as error:
            raise AppTracingConfigInvalidProviderError(tracing_provider) from error

    @override
    def prepare_new_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any]
    ) -> dict[str, Any]:
        self.validate_provider(tracing_provider)
        try:
            settings = (
                get_provider_config_fields(tracing_provider).config_class.model_validate(tracing_config).model_dump()
            )
        except ValidationError as error:
            raise AppTracingConfigInvalidConfigurationError from error
        self._verify_credentials(tracing_provider, settings)
        try:
            return encrypt_provider_config(workspace_id, tracing_provider, settings)
        except Exception as error:
            raise AppTracingConfigProcessingError from error

    @override
    def prepare_updated_config(
        self,
        *,
        workspace_id: str,
        tracing_provider: str,
        tracing_config: dict[str, Any],
        current_tracing_config: dict[str, Any] | None,
    ) -> dict[str, Any]:
        self.validate_provider(tracing_provider)
        try:
            encrypted = encrypt_provider_config(workspace_id, tracing_provider, tracing_config, current_tracing_config)
            settings = decrypt_provider_config(workspace_id, tracing_provider, encrypted)
        except ValidationError as error:
            raise AppTracingConfigInvalidConfigurationError from error
        except Exception as error:
            raise AppTracingConfigProcessingError from error
        self._verify_credentials(tracing_provider, settings)
        return encrypted

    @override
    def present_config(
        self, *, workspace_id: str, tracing_provider: str, tracing_config: dict[str, Any] | None
    ) -> dict[str, Any]:
        from core.ops.provider_export import create_provider_client

        if tracing_config is None:
            raise AppTracingConfigProcessingError
        try:
            settings = decrypt_provider_config(workspace_id, tracing_provider, tracing_config)
            presented = mask_provider_config(tracing_provider, settings)
            presented["project_url"] = create_provider_client(tracing_provider, settings).get_project_url()
            return presented
        except Exception as error:
            raise AppTracingConfigProcessingError from error

    @staticmethod
    def _verify_credentials(provider_name: str, settings: dict[str, Any]) -> None:
        from core.ops.provider_export import create_provider_client

        try:
            if create_provider_client(provider_name, settings).verify_credentials() is False:
                raise AppTracingConfigVerificationFailedError
        except Exception as error:
            raise AppTracingConfigVerificationFailedError from error
