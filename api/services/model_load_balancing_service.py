import logging
from typing import Optional

from core.model_runtime.entities.model_entities import ModelType
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

        credentials = {}
        for model_setting in provider_configuration.model_settings:
            if model_setting.model == model and model_setting.model_type == model_type:
                load_balancing_configs = model_setting.load_balancing_configs
                for lb_config in load_balancing_configs:
                    if lb_config.id == load_balancing_model_config.id:
                        credentials = lb_config.credentials

                        # Get credential form schemas from model credential schema or provider credential schema
                        if provider_configuration.provider.model_credential_schema:
                            credential_form_schemas = (provider_configuration.provider.model_credential_schema
                                                       .credential_form_schemas)
                        else:
                            credential_form_schemas = (provider_configuration.provider.provider_credential_schema
                                                       .credential_form_schemas)

                        if not credential_form_schemas:
                            credential_form_schemas = []

                        # Obfuscate credentials
                        credentials = provider_configuration.obfuscated_credentials(
                            credentials=credentials,
                            credential_form_schemas=credential_form_schemas
                        )
                        break

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
