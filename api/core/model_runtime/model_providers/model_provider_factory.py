import hashlib
import logging
from collections.abc import Sequence
from threading import Lock

import contexts
from core.model_runtime.entities.model_entities import AIModelEntity, ModelType
from core.model_runtime.entities.provider_entities import ProviderConfig, ProviderEntity, SimpleProviderEntity
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.model_runtime.model_providers.__base.moderation_model import ModerationModel
from core.model_runtime.model_providers.__base.rerank_model import RerankModel
from core.model_runtime.model_providers.__base.speech2text_model import Speech2TextModel
from core.model_runtime.model_providers.__base.text_embedding_model import TextEmbeddingModel
from core.model_runtime.model_providers.__base.tts_model import TTSModel
from core.model_runtime.schema_validators.model_credential_schema_validator import ModelCredentialSchemaValidator
from core.model_runtime.schema_validators.provider_credential_schema_validator import ProviderCredentialSchemaValidator
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity
from models.provider_ids import ModelProviderID

logger = logging.getLogger(__name__)


class ModelProviderFactory:
    def __init__(self, tenant_id: str):
        from core.plugin.impl.model import PluginModelClient

        self.tenant_id = tenant_id
        self.plugin_model_manager = PluginModelClient()

    def get_providers(self) -> Sequence[ProviderEntity]:
        """
        Get all providers
        :return: list of providers
        """
        # FIXME(-LAN-): Removed position map sorting since providers are fetched from plugin server
        # The plugin server should return providers in the desired order
        plugin_providers = self.get_plugin_model_providers()
        return [provider.declaration for provider in plugin_providers]

    def get_plugin_model_providers(self) -> Sequence["PluginModelProviderEntity"]:
        """
        Get all plugin model providers
        :return: list of plugin model providers
        """
        # check if context is set
        try:
            contexts.plugin_model_providers.get()
        except LookupError:
            contexts.plugin_model_providers.set(None)
            contexts.plugin_model_providers_lock.set(Lock())

        with contexts.plugin_model_providers_lock.get():
            plugin_model_providers = contexts.plugin_model_providers.get()
            if plugin_model_providers is not None:
                return plugin_model_providers

            plugin_model_providers = []
            contexts.plugin_model_providers.set(plugin_model_providers)

            # Fetch plugin model providers
            plugin_providers = self.plugin_model_manager.fetch_model_providers(self.tenant_id)

            for provider in plugin_providers:
                provider.declaration.provider = provider.plugin_id + "/" + provider.declaration.provider
                plugin_model_providers.append(provider)

            return plugin_model_providers

    def get_provider_schema(self, provider: str) -> ProviderEntity:
        """
        Get provider schema
        :param provider: provider name
        :return: provider schema
        """
        plugin_model_provider_entity = self.get_plugin_model_provider(provider=provider)
        return plugin_model_provider_entity.declaration

    def get_plugin_model_provider(self, provider: str) -> "PluginModelProviderEntity":
        """
        Get plugin model provider
        :param provider: provider name
        :return: provider schema
        """
        if "/" not in provider:
            provider = str(ModelProviderID(provider))

        # fetch plugin model providers
        plugin_model_provider_entities = self.get_plugin_model_providers()

        # get the provider
        plugin_model_provider_entity = next(
            (p for p in plugin_model_provider_entities if p.declaration.provider == provider),
            None,
        )

        if not plugin_model_provider_entity:
            raise ValueError(f"Invalid provider: {provider}")

        return plugin_model_provider_entity

    def provider_credentials_validate(self, *, provider: str, credentials: dict):
        """
        Validate provider credentials

        :param provider: provider name
        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        :return:
        """
        # fetch plugin model provider
        plugin_model_provider_entity = self.get_plugin_model_provider(provider=provider)

        # get provider_credential_schema and validate credentials according to the rules
        provider_credential_schema = plugin_model_provider_entity.declaration.provider_credential_schema
        if not provider_credential_schema:
            raise ValueError(f"Provider {provider} does not have provider_credential_schema")

        # validate provider credential schema
        validator = ProviderCredentialSchemaValidator(provider_credential_schema)
        filtered_credentials = validator.validate_and_filter(credentials)

        # validate the credentials, raise exception if validation failed
        self.plugin_model_manager.validate_provider_credentials(
            tenant_id=self.tenant_id,
            user_id="unknown",
            plugin_id=plugin_model_provider_entity.plugin_id,
            provider=plugin_model_provider_entity.provider,
            credentials=filtered_credentials,
        )

        return filtered_credentials

    def model_credentials_validate(self, *, provider: str, model_type: ModelType, model: str, credentials: dict):
        """
        Validate model credentials

        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials, credentials form defined in `model_credential_schema`.
        :return:
        """
        # fetch plugin model provider
        plugin_model_provider_entity = self.get_plugin_model_provider(provider=provider)

        # get model_credential_schema and validate credentials according to the rules
        model_credential_schema = plugin_model_provider_entity.declaration.model_credential_schema
        if not model_credential_schema:
            raise ValueError(f"Provider {provider} does not have model_credential_schema")

        # validate model credential schema
        validator = ModelCredentialSchemaValidator(model_type, model_credential_schema)
        filtered_credentials = validator.validate_and_filter(credentials)

        # call validate_credentials method of model type to validate credentials, raise exception if validation failed
        self.plugin_model_manager.validate_model_credentials(
            tenant_id=self.tenant_id,
            user_id="unknown",
            plugin_id=plugin_model_provider_entity.plugin_id,
            provider=plugin_model_provider_entity.provider,
            model_type=model_type.value,
            model=model,
            credentials=filtered_credentials,
        )

        return filtered_credentials

    def get_model_schema(
        self, *, provider: str, model_type: ModelType, model: str, credentials: dict | None
    ) -> AIModelEntity | None:
        """
        Get model schema
        """
        plugin_id, provider_name = self.get_plugin_id_and_provider_name_from_provider(provider)
        cache_key = f"{self.tenant_id}:{plugin_id}:{provider_name}:{model_type.value}:{model}"
        # sort credentials
        sorted_credentials = sorted(credentials.items()) if credentials else []
        cache_key += ":".join([hashlib.md5(f"{k}:{v}".encode()).hexdigest() for k, v in sorted_credentials])

        try:
            contexts.plugin_model_schemas.get()
        except LookupError:
            contexts.plugin_model_schemas.set({})
            contexts.plugin_model_schema_lock.set(Lock())

        with contexts.plugin_model_schema_lock.get():
            if cache_key in contexts.plugin_model_schemas.get():
                return contexts.plugin_model_schemas.get()[cache_key]

            schema = self.plugin_model_manager.get_model_schema(
                tenant_id=self.tenant_id,
                user_id="unknown",
                plugin_id=plugin_id,
                provider=provider_name,
                model_type=model_type.value,
                model=model,
                credentials=credentials or {},
            )

            if schema:
                contexts.plugin_model_schemas.get()[cache_key] = schema

            return schema

    def get_models(
        self,
        *,
        provider: str | None = None,
        model_type: ModelType | None = None,
        provider_configs: list[ProviderConfig] | None = None,
    ) -> list[SimpleProviderEntity]:
        """
        Get all models for given model type

        :param provider: provider name
        :param model_type: model type
        :param provider_configs: list of provider configs
        :return: list of models
        """
        provider_configs = provider_configs or []

        # scan all providers
        plugin_model_provider_entities = self.get_plugin_model_providers()

        # traverse all model_provider_extensions
        providers = []
        for plugin_model_provider_entity in plugin_model_provider_entities:
            # filter by provider if provider is present
            if provider and plugin_model_provider_entity.declaration.provider != provider:
                continue

            # get provider schema
            provider_schema = plugin_model_provider_entity.declaration

            model_types = provider_schema.supported_model_types
            if model_type:
                if model_type not in model_types:
                    continue

                model_types = [model_type]

            all_model_type_models = []
            for model_schema in provider_schema.models:
                if model_schema.model_type != model_type:
                    continue

                all_model_type_models.append(model_schema)

            simple_provider_schema = provider_schema.to_simple_provider()
            simple_provider_schema.models.extend(all_model_type_models)

            providers.append(simple_provider_schema)

        return providers

    def get_model_type_instance(self, provider: str, model_type: ModelType) -> AIModel:
        """
        Get model type instance by provider name and model type
        :param provider: provider name
        :param model_type: model type
        :return: model type instance
        """
        plugin_id, provider_name = self.get_plugin_id_and_provider_name_from_provider(provider)
        init_params = {
            "tenant_id": self.tenant_id,
            "plugin_id": plugin_id,
            "provider_name": provider_name,
            "plugin_model_provider": self.get_plugin_model_provider(provider),
        }

        if model_type == ModelType.LLM:
            return LargeLanguageModel.model_validate(init_params)
        elif model_type == ModelType.TEXT_EMBEDDING:
            return TextEmbeddingModel.model_validate(init_params)
        elif model_type == ModelType.RERANK:
            return RerankModel.model_validate(init_params)
        elif model_type == ModelType.SPEECH2TEXT:
            return Speech2TextModel.model_validate(init_params)
        elif model_type == ModelType.MODERATION:
            return ModerationModel.model_validate(init_params)
        elif model_type == ModelType.TTS:
            return TTSModel.model_validate(init_params)

    def get_provider_icon(self, provider: str, icon_type: str, lang: str) -> tuple[bytes, str]:
        """
        Get provider icon
        :param provider: provider name
        :param icon_type: icon type (icon_small or icon_large)
        :param lang: language (zh_Hans or en_US)
        :return: provider icon
        """
        # get the provider schema
        provider_schema = self.get_provider_schema(provider)

        if icon_type.lower() == "icon_small":
            if not provider_schema.icon_small:
                raise ValueError(f"Provider {provider} does not have small icon.")

            if lang.lower() == "zh_hans":
                file_name = provider_schema.icon_small.zh_Hans
            else:
                file_name = provider_schema.icon_small.en_US
        elif icon_type.lower() == "icon_small_dark":
            if not provider_schema.icon_small_dark:
                raise ValueError(f"Provider {provider} does not have small dark icon.")

            if lang.lower() == "zh_hans":
                file_name = provider_schema.icon_small_dark.zh_Hans
            else:
                file_name = provider_schema.icon_small_dark.en_US
        else:
            if not provider_schema.icon_large:
                raise ValueError(f"Provider {provider} does not have large icon.")

            if lang.lower() == "zh_hans":
                file_name = provider_schema.icon_large.zh_Hans
            else:
                file_name = provider_schema.icon_large.en_US

        if not file_name:
            raise ValueError(f"Provider {provider} does not have icon.")

        image_mime_types = {
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "png": "image/png",
            "gif": "image/gif",
            "bmp": "image/bmp",
            "tiff": "image/tiff",
            "tif": "image/tiff",
            "webp": "image/webp",
            "svg": "image/svg+xml",
            "ico": "image/vnd.microsoft.icon",
            "heif": "image/heif",
            "heic": "image/heic",
        }

        extension = file_name.split(".")[-1]
        mime_type = image_mime_types.get(extension, "image/png")

        # get icon bytes from plugin asset manager
        from core.plugin.impl.asset import PluginAssetManager

        plugin_asset_manager = PluginAssetManager()
        return plugin_asset_manager.fetch_asset(tenant_id=self.tenant_id, id=file_name), mime_type

    def get_plugin_id_and_provider_name_from_provider(self, provider: str) -> tuple[str, str]:
        """
        Get plugin id and provider name from provider name
        :param provider: provider name
        :return: plugin id and provider name
        """

        provider_id = ModelProviderID(provider)
        return provider_id.plugin_id, provider_id.provider_name
