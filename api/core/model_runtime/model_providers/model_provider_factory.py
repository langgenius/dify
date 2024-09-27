import logging
import os
from collections.abc import Sequence
from typing import Optional

from pydantic import BaseModel, ConfigDict

from core.helper.module_import_helper import load_single_subclass_from_source
from core.helper.position_helper import get_provider_position_map, sort_to_dict_by_position_map
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ProviderConfig, ProviderEntity, SimpleProviderEntity
from core.model_runtime.model_providers.__base.model_provider import ModelProvider
from core.model_runtime.schema_validators.model_credential_schema_validator import ModelCredentialSchemaValidator
from core.model_runtime.schema_validators.provider_credential_schema_validator import ProviderCredentialSchemaValidator

logger = logging.getLogger(__name__)


class ModelProviderExtension(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    provider_instance: ModelProvider
    name: str
    position: Optional[int] = None


class ModelProviderFactory:
    model_provider_extensions: Optional[dict[str, ModelProviderExtension]] = None

    def __init__(self) -> None:
        # for cache in memory
        self.get_providers()

    def get_providers(self) -> Sequence[ProviderEntity]:
        """
        Get all providers
        :return: list of providers
        """
        # scan all providers
        model_provider_extensions = self._get_model_provider_map()

        # traverse all model_provider_extensions
        providers = []
        for model_provider_extension in model_provider_extensions.values():
            # get model_provider instance
            model_provider_instance = model_provider_extension.provider_instance

            # get provider schema
            provider_schema = model_provider_instance.get_provider_schema()

            for model_type in provider_schema.supported_model_types:
                # get predefined models for given model type
                models = model_provider_instance.models(model_type)
                if models:
                    provider_schema.models.extend(models)

            providers.append(provider_schema)

        # return providers
        return providers

    def provider_credentials_validate(self, *, provider: str, credentials: dict) -> dict:
        """
        Validate provider credentials

        :param provider: provider name
        :param credentials: provider credentials, credentials form defined in `provider_credential_schema`.
        :return:
        """
        # get the provider instance
        model_provider_instance = self.get_provider_instance(provider)

        # get provider schema
        provider_schema = model_provider_instance.get_provider_schema()

        # get provider_credential_schema and validate credentials according to the rules
        provider_credential_schema = provider_schema.provider_credential_schema

        if not provider_credential_schema:
            raise ValueError(f"Provider {provider} does not have provider_credential_schema")

        # validate provider credential schema
        validator = ProviderCredentialSchemaValidator(provider_credential_schema)
        filtered_credentials = validator.validate_and_filter(credentials)

        # validate the credentials, raise exception if validation failed
        model_provider_instance.validate_provider_credentials(filtered_credentials)

        return filtered_credentials

    def model_credentials_validate(
        self, *, provider: str, model_type: ModelType, model: str, credentials: dict
    ) -> dict:
        """
        Validate model credentials

        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials, credentials form defined in `model_credential_schema`.
        :return:
        """
        # get the provider instance
        model_provider_instance = self.get_provider_instance(provider)

        # get provider schema
        provider_schema = model_provider_instance.get_provider_schema()

        # get model_credential_schema and validate credentials according to the rules
        model_credential_schema = provider_schema.model_credential_schema

        if not model_credential_schema:
            raise ValueError(f"Provider {provider} does not have model_credential_schema")

        # validate model credential schema
        validator = ModelCredentialSchemaValidator(model_type, model_credential_schema)
        filtered_credentials = validator.validate_and_filter(credentials)

        # get model instance of the model type
        model_instance = model_provider_instance.get_model_instance(model_type)

        # call validate_credentials method of model type to validate credentials, raise exception if validation failed
        model_instance.validate_credentials(model, filtered_credentials)

        return filtered_credentials

    def get_models(
        self,
        *,
        provider: Optional[str] = None,
        model_type: Optional[ModelType] = None,
        provider_configs: Optional[list[ProviderConfig]] = None,
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
        model_provider_extensions = self._get_model_provider_map()

        # convert provider_configs to dict
        provider_credentials_dict = {}
        for provider_config in provider_configs:
            provider_credentials_dict[provider_config.provider] = provider_config.credentials

        # traverse all model_provider_extensions
        providers = []
        for name, model_provider_extension in model_provider_extensions.items():
            # filter by provider if provider is present
            if provider and name != provider:
                continue

            # get model_provider instance
            model_provider_instance = model_provider_extension.provider_instance

            # get provider schema
            provider_schema = model_provider_instance.get_provider_schema()

            model_types = provider_schema.supported_model_types
            if model_type:
                if model_type not in model_types:
                    continue

                model_types = [model_type]

            all_model_type_models = []
            for model_type in model_types:
                # get predefined models for given model type
                models = model_provider_instance.models(
                    model_type=model_type,
                )

                all_model_type_models.extend(models)

            simple_provider_schema = provider_schema.to_simple_provider()
            simple_provider_schema.models.extend(all_model_type_models)

            providers.append(simple_provider_schema)

        return providers

    def get_provider_instance(self, provider: str) -> ModelProvider:
        """
        Get provider instance by provider name
        :param provider: provider name
        :return: provider instance
        """
        # scan all providers
        model_provider_extensions = self._get_model_provider_map()

        # get the provider extension
        model_provider_extension = model_provider_extensions.get(provider)
        if not model_provider_extension:
            raise Exception(f"Invalid provider: {provider}")

        # get the provider instance
        model_provider_instance = model_provider_extension.provider_instance

        return model_provider_instance

    def _get_model_provider_map(self) -> dict[str, ModelProviderExtension]:
        """
        Retrieves the model provider map.

        This method retrieves the model provider map, which is a dictionary containing the model provider names as keys
        and instances of `ModelProviderExtension` as values. The model provider map is used to store information about
        available model providers.

        Returns:
            A dictionary containing the model provider map.

        Raises:
            None.
        """
        if self.model_provider_extensions:
            return self.model_provider_extensions

        # get the path of current classes
        current_path = os.path.abspath(__file__)
        model_providers_path = os.path.dirname(current_path)

        # get all folders path under model_providers_path that do not start with __
        model_provider_dir_paths = [
            os.path.join(model_providers_path, model_provider_dir)
            for model_provider_dir in os.listdir(model_providers_path)
            if not model_provider_dir.startswith("__")
            and os.path.isdir(os.path.join(model_providers_path, model_provider_dir))
        ]

        # get _position.yaml file path
        position_map = get_provider_position_map(model_providers_path)

        # traverse all model_provider_dir_paths
        model_providers: list[ModelProviderExtension] = []
        for model_provider_dir_path in model_provider_dir_paths:
            # get model_provider dir name
            model_provider_name = os.path.basename(model_provider_dir_path)

            file_names = os.listdir(model_provider_dir_path)

            if (model_provider_name + ".py") not in file_names:
                logger.warning(f"Missing {model_provider_name}.py file in {model_provider_dir_path}, Skip.")
                continue

            # Dynamic loading {model_provider_name}.py file and find the subclass of ModelProvider
            py_path = os.path.join(model_provider_dir_path, model_provider_name + ".py")
            model_provider_class = load_single_subclass_from_source(
                module_name=f"core.model_runtime.model_providers.{model_provider_name}.{model_provider_name}",
                script_path=py_path,
                parent_type=ModelProvider,
            )

            if not model_provider_class:
                logger.warning(f"Missing Model Provider Class that extends ModelProvider in {py_path}, Skip.")
                continue

            if f"{model_provider_name}.yaml" not in file_names:
                logger.warning(f"Missing {model_provider_name}.yaml file in {model_provider_dir_path}, Skip.")
                continue

            model_providers.append(
                ModelProviderExtension(
                    name=model_provider_name,
                    provider_instance=model_provider_class(),
                    position=position_map.get(model_provider_name),
                )
            )

        sorted_extensions = sort_to_dict_by_position_map(position_map, model_providers, lambda x: x.name)

        self.model_provider_extensions = sorted_extensions

        return sorted_extensions
