from __future__ import annotations

from collections.abc import Sequence

from graphon.model_runtime.entities.model_entities import AIModelEntity, ModelType
from graphon.model_runtime.entities.provider_entities import (
    ProviderEntity,
    SimpleProviderEntity,
)
from graphon.model_runtime.protocols.provider_runtime import ModelProviderRuntime
from graphon.model_runtime.schema_validators.model_credential_schema_validator import (
    ModelCredentialSchemaValidator,
)

from ..schema_validators.provider_credential_schema_validator import (
    ProviderCredentialSchemaValidator,
)


class ModelProviderFactory:
    """Factory for provider schemas and credential flows backed by a runtime."""

    def __init__(self, runtime: ModelProviderRuntime) -> None:
        if runtime is None:
            msg = "runtime is required."
            raise ValueError(msg)
        self.runtime = runtime

    def get_providers(self) -> Sequence[ProviderEntity]:
        """Get all providers."""
        return list(self.get_model_providers())

    def get_model_providers(self) -> Sequence[ProviderEntity]:
        """Get all model providers exposed by the runtime adapter."""
        return self.runtime.fetch_model_providers()

    def get_provider_schema(self, provider: str) -> ProviderEntity:
        """Get provider schema."""
        return self.get_model_provider(provider=provider)

    def get_model_provider(self, provider: str) -> ProviderEntity:
        """Get provider schema."""
        provider_entity = self._resolve_provider(provider)
        if provider_entity is None:
            msg = f"Invalid provider: {provider}"
            raise ValueError(msg)

        return provider_entity

    def provider_credentials_validate(
        self,
        *,
        provider: str,
        credentials: dict,
    ) -> dict[str, str | bool]:
        """Validate provider credentials."""
        provider_entity = self.get_model_provider(provider=provider)

        provider_credential_schema = provider_entity.provider_credential_schema
        if not provider_credential_schema:
            msg = f"Provider {provider} does not have provider_credential_schema"
            raise ValueError(msg)

        validator = ProviderCredentialSchemaValidator(provider_credential_schema)
        filtered_credentials = validator.validate_and_filter(credentials)

        self.runtime.validate_provider_credentials(
            provider=provider_entity.provider,
            credentials=filtered_credentials,
        )

        return filtered_credentials

    def model_credentials_validate(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict,
    ) -> dict[str, str | bool]:
        """Validate model credentials."""
        provider_entity = self.get_model_provider(provider=provider)

        model_credential_schema = provider_entity.model_credential_schema
        if not model_credential_schema:
            msg = f"Provider {provider} does not have model_credential_schema"
            raise ValueError(msg)

        validator = ModelCredentialSchemaValidator(model_type, model_credential_schema)
        filtered_credentials = validator.validate_and_filter(credentials)

        self.runtime.validate_model_credentials(
            provider=provider_entity.provider,
            model_type=model_type,
            model=model,
            credentials=filtered_credentials,
        )

        return filtered_credentials

    def get_model_schema(
        self,
        *,
        provider: str,
        model_type: ModelType,
        model: str,
        credentials: dict | None,
    ) -> AIModelEntity | None:
        """Get model schema."""
        provider_entity = self.get_model_provider(provider)
        return self.runtime.get_model_schema(
            provider=provider_entity.provider,
            model_type=model_type,
            model=model,
            credentials=credentials or {},
        )

    def get_models(
        self,
        *,
        provider: str | None = None,
        model_type: ModelType | None = None,
    ) -> list[SimpleProviderEntity]:
        """Get all models for given model type."""
        providers = []
        for provider_entity in self.get_model_providers():
            if provider and not self._matches_provider(provider_entity, provider):
                continue

            if model_type and model_type not in provider_entity.supported_model_types:
                continue

            simple_provider_schema = provider_entity.to_simple_provider()
            if model_type is not None:
                simple_provider_schema.models = [
                    model_schema
                    for model_schema in provider_entity.models
                    if model_schema.model_type == model_type
                ]
            providers.append(simple_provider_schema)

        return providers

    def get_provider_icon(
        self,
        provider: str,
        icon_type: str,
        lang: str,
    ) -> tuple[bytes, str]:
        """Get provider icon."""
        provider_entity = self.get_model_provider(provider)
        return self.runtime.get_provider_icon(
            provider=provider_entity.provider,
            icon_type=icon_type,
            lang=lang,
        )

    def _resolve_provider(self, provider: str) -> ProviderEntity | None:
        return next(
            (
                item
                for item in self.get_model_providers()
                if self._matches_provider(item, provider)
            ),
            None,
        )

    @staticmethod
    def _matches_provider(provider_entity: ProviderEntity, provider: str) -> bool:
        return provider in {provider_entity.provider, provider_entity.provider_name}
