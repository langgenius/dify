from core.model_providers.model_provider_factory import ModelProviderFactory
from core.model_providers.models.entity.model_params import ModelType
from models.provider import ProviderType


class ProviderService:

    def get_valid_model_list(self, tenant_id: str, model_type: str) -> list:
        """
        get valid model list.

        :param tenant_id:
        :param model_type:
        :return:
        """
        valid_model_list = []

        # get model provider rules
        model_provider_rules = ModelProviderFactory.get_provider_rules()
        for model_provider_name, model_provider_rule in model_provider_rules.items():
            model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)
            if not model_provider:
                continue

            model_list = model_provider.get_supported_model_list(ModelType.value_of(model_type))
            provider = model_provider.provider
            for model in model_list:
                valid_model_dict = {
                    "model_name": model['id'],
                    "model_display_name": model['name'],
                    "model_type": model_type,
                    "model_provider": {
                        "provider_name": provider.provider_name,
                        "provider_type": provider.provider_type
                    },
                    'features': []
                }

                if 'mode' in model:
                    valid_model_dict['model_mode'] = model['mode']

                if 'features' in model:
                    valid_model_dict['features'] = model['features']

                if provider.provider_type == ProviderType.SYSTEM.value:
                    valid_model_dict['model_provider']['quota_type'] = provider.quota_type
                    valid_model_dict['model_provider']['quota_unit'] = model_provider_rule['system_config']['quota_unit']
                    valid_model_dict['model_provider']['quota_limit'] = provider.quota_limit
                    valid_model_dict['model_provider']['quota_used'] = provider.quota_used

                valid_model_list.append(valid_model_dict)

        return valid_model_list

