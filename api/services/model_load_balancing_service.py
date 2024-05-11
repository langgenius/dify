import datetime
import json
import logging
from json import JSONDecodeError
from typing import Optional

from core.entities.provider_configuration import ProviderConfiguration
from core.helper import encrypter
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import (
    ModelCredentialSchema,
    ProviderCredentialSchema,
)
from core.model_runtime.model_providers import model_provider_factory
from core.provider_manager import ProviderManager
from extensions.ext_database import db
from models.provider import LoadBalancingModelConfig

logger = logging.getLogger(__name__)


class ModelLoadBalancingService:

    def __init__(self) -> None:
        self.provider_manager = ProviderManager()

    def enable_model_load_balancing(self, tenant_id: str, provider: str, model: str, model_type: str) -> None:
        """
        enable model load balancing.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Enable model load balancing
        provider_configuration.enable_model_load_balancing(
            model=model,
            model_type=ModelType.value_of(model_type)
        )

    def disable_model_load_balancing(self, tenant_id: str, provider: str, model: str, model_type: str) -> None:
        """
        disable model load balancing.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # disable model load balancing
        provider_configuration.disable_model_load_balancing(
            model=model,
            model_type=ModelType.value_of(model_type)
        )

    def get_load_balancing_configs(self, tenant_id: str, provider: str, model: str, model_type: str) \
            -> list[LoadBalancingModelConfig]:
        """
        Get load balancing configurations.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Convert model type to ModelType
        model_type = ModelType.value_of(model_type)

        # Get load balancing configurations
        load_balancing_configs = db.session.query(LoadBalancingModelConfig) \
            .filter(
            LoadBalancingModelConfig.tenant_id == tenant_id,
            LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
            LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
            LoadBalancingModelConfig.model_name == model
        ).order_by(LoadBalancingModelConfig.created_at).all()

        # check if the inherit configuration exists, inherit is represented for the provider or model custom credentials
        inherit_config_exists = False
        for load_balancing_config in load_balancing_configs:
            if load_balancing_config.name == '__inherit__':
                inherit_config_exists = True
                break

        if not inherit_config_exists:
            # Initialize the inherit configuration
            inherit_config = self._init_inherit_config(tenant_id, provider, model, model_type)

            # prepend the inherit configuration
            load_balancing_configs.insert(0, inherit_config)

        return load_balancing_configs

    def get_load_balancing_config(self, tenant_id: str, provider: str, model: str, model_type: str, config_id: str) \
            -> Optional[dict]:
        """
        Get load balancing configuration.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :param config_id: load balancing config id
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Convert model type to ModelType
        model_type = ModelType.value_of(model_type)

        # Get load balancing configurations
        load_balancing_model_config = db.session.query(LoadBalancingModelConfig) \
            .filter(
            LoadBalancingModelConfig.tenant_id == tenant_id,
            LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
            LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
            LoadBalancingModelConfig.model_name == model,
            LoadBalancingModelConfig.id == config_id
        ).first()

        if not load_balancing_model_config:
            return None

        try:
            if load_balancing_model_config.encrypted_config:
                credentials = json.loads(load_balancing_model_config.encrypted_config)
            else:
                credentials = {}
        except JSONDecodeError:
            credentials = {}

        # Get credential form schemas from model credential schema or provider credential schema
        credential_schemas = self._get_credential_schema(provider_configuration)

        # Obfuscate credentials
        credentials = provider_configuration.obfuscated_credentials(
            credentials=credentials,
            credential_form_schemas=credential_schemas.credential_form_schemas
        )

        return {
            'id': load_balancing_model_config.id,
            'name': load_balancing_model_config.name,
            'credentials': credentials,
            'enabled': load_balancing_model_config.enabled
        }

    def _init_inherit_config(self, tenant_id: str, provider: str, model: str, model_type: ModelType) \
            -> LoadBalancingModelConfig:
        """
        Initialize the inherit configuration.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        # Initialize the inherit configuration
        inherit_config = LoadBalancingModelConfig(
            tenant_id=tenant_id,
            provider_name=provider,
            model_type=model_type.to_origin_model_type(),
            model_name=model,
            name='__inherit__'
        )
        db.session.add(inherit_config)
        db.session.commit()

        return inherit_config

    def create_load_balancing_config(self, tenant_id: str,
                                     provider: str,
                                     model: str,
                                     model_type: str,
                                     name: str,
                                     credentials: dict) -> None:
        """
        Create load balancing configuration.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :param name: load balancing config name
        :param credentials: load balancing config credentials
        :raises ValueError: if provider does not exist
        :raises CredentialsValidateFailedError: if credentials validation failed
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Convert model type to ModelType
        model_type = ModelType.value_of(model_type)

        if name == '__inherit__':
            raise ValueError('Invalid load balancing config name')

        # Get load balancing configurations
        load_balancing_model_config = db.session.query(LoadBalancingModelConfig) \
            .filter(
            LoadBalancingModelConfig.tenant_id == tenant_id,
            LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
            LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
            LoadBalancingModelConfig.model_name == model,
            LoadBalancingModelConfig.name == name
        ).first()

        if load_balancing_model_config:
            raise ValueError('Load balancing config name already exists')

        # validate custom provider config
        credentials = self._custom_credentials_validate(
            tenant_id=tenant_id,
            provider_configuration=provider_configuration,
            model_type=model_type,
            model=model,
            credentials=credentials
        )

        # create load balancing config
        load_balancing_model_config = LoadBalancingModelConfig(
            tenant_id=tenant_id,
            provider_name=provider_configuration.provider.provider,
            model_type=model_type.to_origin_model_type(),
            model_name=model,
            name=name,
            encrypted_config=json.dumps(credentials)
        )

        db.session.add(load_balancing_model_config)
        db.session.commit()

    def update_load_balancing_config(self, tenant_id: str,
                                     provider: str,
                                     model: str,
                                     model_type: str,
                                     config_id: str,
                                     name: str,
                                     credentials: dict) -> None:
        """
        Update load balancing configuration.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :param config_id: load balancing config id
        :param name: load balancing config name
        :param credentials: load balancing config credentials
        :raises ValueError: if provider does not exist
        :raises CredentialsValidateFailedError: if credentials validation failed
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Convert model type to ModelType
        model_type = ModelType.value_of(model_type)

        if name == '__inherit__':
            raise ValueError('Invalid load balancing config name')

        # Get load balancing configurations
        load_balancing_model_config = db.session.query(LoadBalancingModelConfig) \
            .filter(
            LoadBalancingModelConfig.tenant_id == tenant_id,
            LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
            LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
            LoadBalancingModelConfig.model_name == model,
            LoadBalancingModelConfig.id == config_id
        ).first()

        if not load_balancing_model_config:
            raise ValueError('Load balancing config does not exist')

        # check duplicate name
        duplicate_name_load_balancing_model_config = db.session.query(LoadBalancingModelConfig) \
            .filter(
            LoadBalancingModelConfig.tenant_id == tenant_id,
            LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
            LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
            LoadBalancingModelConfig.model_name == model,
            LoadBalancingModelConfig.id != config_id,
            LoadBalancingModelConfig.name == name
        ).first()

        if duplicate_name_load_balancing_model_config:
            raise ValueError('Load balancing config name already exists')

        # validate custom provider config
        credentials = self._custom_credentials_validate(
            tenant_id=tenant_id,
            provider_configuration=provider_configuration,
            model_type=model_type,
            model=model,
            credentials=credentials,
            load_balancing_model_config=load_balancing_model_config
        )

        # update load balancing config
        load_balancing_model_config.name = name
        load_balancing_model_config.encrypted_config = json.dumps(credentials)
        load_balancing_model_config.updated_at = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
        db.session.commit()

    def _custom_credentials_validate(self, tenant_id: str,
                                     provider_configuration: ProviderConfiguration,
                                     model_type: ModelType,
                                     model: str,
                                     credentials: dict,
                                     load_balancing_model_config: Optional[LoadBalancingModelConfig] = None) -> dict:
        """
        Validate custom credentials.
        :param tenant_id: workspace id
        :param provider_configuration: provider configuration
        :param model_type: model type
        :param model: model name
        :param credentials: credentials
        :param load_balancing_model_config: load balancing model config
        :return:
        """
        # Get credential form schemas from model credential schema or provider credential schema
        credential_schemas = self._get_credential_schema(provider_configuration)

        # Get provider credential secret variables
        provider_credential_secret_variables = provider_configuration.extract_secret_variables(
            credential_schemas.credential_form_schemas
        )

        if load_balancing_model_config:
            try:
                # fix origin data
                if load_balancing_model_config.encrypted_config:
                    original_credentials = json.loads(load_balancing_model_config.encrypted_config)
                else:
                    original_credentials = {}
            except JSONDecodeError:
                original_credentials = {}

            # encrypt credentials
            for key, value in credentials.items():
                if key in provider_credential_secret_variables:
                    # if send [__HIDDEN__] in secret input, it will be same as original value
                    if value == '[__HIDDEN__]' and key in original_credentials:
                        credentials[key] = encrypter.decrypt_token(tenant_id, original_credentials[key])

        if isinstance(credential_schemas, ModelCredentialSchema):
            credentials = model_provider_factory.model_credentials_validate(
                provider=provider_configuration.provider.provider,
                model_type=model_type,
                model=model,
                credentials=credentials
            )
        else:
            credentials = model_provider_factory.provider_credentials_validate(
                provider=provider_configuration.provider.provider,
                credentials=credentials
            )

        for key, value in credentials.items():
            if key in provider_credential_secret_variables:
                credentials[key] = encrypter.encrypt_token(tenant_id, value)

        return credentials

    def _get_credential_schema(self, provider_configuration: ProviderConfiguration) \
            -> ModelCredentialSchema | ProviderCredentialSchema:
        """
        Get form schemas.
        :param provider_configuration: provider configuration
        :return:
        """
        # Get credential form schemas from model credential schema or provider credential schema
        if provider_configuration.provider.model_credential_schema:
            credential_schema = provider_configuration.provider.model_credential_schema
        else:
            credential_schema = provider_configuration.provider.provider_credential_schema

        return credential_schema
