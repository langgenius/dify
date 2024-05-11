import logging

from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager

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

