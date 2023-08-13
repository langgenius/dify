import datetime
import json
from collections import defaultdict
from typing import Optional

from core.model_providers.model_factory import ModelFactory
from extensions.ext_database import db
from core.model_providers.model_provider_factory import ModelProviderFactory
from core.model_providers.models.entity.model_params import ModelType, ModelKwargsRules
from models.provider import Provider, ProviderModel, TenantPreferredModelProvider, ProviderType, ProviderQuotaType, \
    TenantDefaultModel


class ProviderService:

    def get_provider_list(self, tenant_id: str):
        """
        get provider list of tenant.

        :param tenant_id:
        :return:
        """
        # get rules for all providers
        model_provider_rules = ModelProviderFactory.get_provider_rules()
        model_provider_names = [model_provider_name for model_provider_name, _ in model_provider_rules.items()]

        for model_provider_name, model_provider_rule in model_provider_rules.items():
            if ProviderType.SYSTEM.value in model_provider_rule['support_provider_types'] \
                    and 'system_config' in model_provider_rule and model_provider_rule['system_config'] \
                    and 'supported_quota_types' in model_provider_rule['system_config'] \
                    and 'trial' in model_provider_rule['system_config']['supported_quota_types']:
                ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)

        configurable_model_provider_names = [
            model_provider_name
            for model_provider_name, model_provider_rules in model_provider_rules.items()
            if 'custom' in model_provider_rules['support_provider_types']
               and model_provider_rules['model_flexibility'] == 'configurable'
        ]

        # get all providers for the tenant
        providers = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == tenant_id,
            Provider.provider_name.in_(model_provider_names),
            Provider.is_valid == True
        ).order_by(Provider.created_at.desc()).all()

        provider_name_to_provider_dict = defaultdict(list)
        for provider in providers:
            provider_name_to_provider_dict[provider.provider_name].append(provider)

        # get all configurable provider models for the tenant
        provider_models = db.session.query(ProviderModel) \
            .filter(
            ProviderModel.tenant_id == tenant_id,
            ProviderModel.provider_name.in_(configurable_model_provider_names),
            ProviderModel.is_valid == True
        ).order_by(ProviderModel.created_at.desc()).all()

        provider_name_to_provider_model_dict = defaultdict(list)
        for provider_model in provider_models:
            provider_name_to_provider_model_dict[provider_model.provider_name].append(provider_model)

        # get all preferred provider type for the tenant
        preferred_provider_types = db.session.query(TenantPreferredModelProvider) \
            .filter(
            TenantPreferredModelProvider.tenant_id == tenant_id,
            TenantPreferredModelProvider.provider_name.in_(model_provider_names)
        ).all()

        provider_name_to_preferred_provider_type_dict = {preferred_provider_type.provider_name: preferred_provider_type
                                                         for preferred_provider_type in preferred_provider_types}

        providers_list = {}

        for model_provider_name, model_provider_rule in model_provider_rules.items():
            # get preferred provider type
            preferred_model_provider = provider_name_to_preferred_provider_type_dict.get(model_provider_name)
            preferred_provider_type = ModelProviderFactory.get_preferred_type_by_preferred_model_provider(
                tenant_id,
                model_provider_name,
                preferred_model_provider
            )

            provider_config_dict = {
                "preferred_provider_type": preferred_provider_type,
                "model_flexibility": model_provider_rule['model_flexibility'],
            }

            provider_parameter_dict = {}
            if ProviderType.SYSTEM.value in model_provider_rule['support_provider_types']:
                for quota_type_enum in ProviderQuotaType:
                    quota_type = quota_type_enum.value
                    if quota_type in model_provider_rule['system_config']['supported_quota_types']:
                        key = ProviderType.SYSTEM.value + ':' + quota_type
                        provider_parameter_dict[key] = {
                            "provider_name": model_provider_name,
                            "provider_type": ProviderType.SYSTEM.value,
                            "config": None,
                            "is_valid": False,  # need update
                            "quota_type": quota_type,
                            "quota_unit": model_provider_rule['system_config']['quota_unit'],  # need update
                            "quota_limit": 0 if quota_type != ProviderQuotaType.TRIAL.value else
                            model_provider_rule['system_config']['quota_limit'],  # need update
                            "quota_used": 0,  # need update
                            "last_used": None  # need update
                        }

            if ProviderType.CUSTOM.value in model_provider_rule['support_provider_types']:
                provider_parameter_dict[ProviderType.CUSTOM.value] = {
                    "provider_name": model_provider_name,
                    "provider_type": ProviderType.CUSTOM.value,
                    "config": None,  # need update
                    "models": [],  # need update
                    "is_valid": False,
                    "last_used": None  # need update
                }

            model_provider_class = ModelProviderFactory.get_model_provider_class(model_provider_name)

            current_providers = provider_name_to_provider_dict[model_provider_name]
            for provider in current_providers:
                if provider.provider_type == ProviderType.SYSTEM.value:
                    quota_type = provider.quota_type
                    key = f'{ProviderType.SYSTEM.value}:{quota_type}'

                    if key in provider_parameter_dict:
                        provider_parameter_dict[key]['is_valid'] = provider.is_valid
                        provider_parameter_dict[key]['quota_used'] = provider.quota_used
                        provider_parameter_dict[key]['quota_limit'] = provider.quota_limit
                        provider_parameter_dict[key]['last_used'] = provider.last_used
                elif provider.provider_type == ProviderType.CUSTOM.value \
                        and ProviderType.CUSTOM.value in provider_parameter_dict:
                    # if custom
                    key = ProviderType.CUSTOM.value
                    provider_parameter_dict[key]['last_used'] = provider.last_used
                    provider_parameter_dict[key]['is_valid'] = provider.is_valid

                    if model_provider_rule['model_flexibility'] == 'fixed':
                        provider_parameter_dict[key]['config'] = model_provider_class(provider=provider) \
                            .get_provider_credentials(obfuscated=True)
                    else:
                        models = []
                        provider_models = provider_name_to_provider_model_dict[model_provider_name]
                        for provider_model in provider_models:
                            models.append({
                                "model_name": provider_model.model_name,
                                "model_type": provider_model.model_type,
                                "config": model_provider_class(provider=provider) \
                                    .get_model_credentials(provider_model.model_name,
                                                           ModelType.value_of(provider_model.model_type),
                                                           obfuscated=True),
                                "is_valid": provider_model.is_valid
                            })
                        provider_parameter_dict[key]['models'] = models

            provider_config_dict['providers'] = list(provider_parameter_dict.values())
            providers_list[model_provider_name] = provider_config_dict

        return providers_list

    def custom_provider_config_validate(self, provider_name: str, config: dict) -> None:
        """
        validate custom provider config.

        :param provider_name:
        :param config:
        :return:
        :raises CredentialsValidateFailedError: When the config credential verification fails.
        """
        # get model provider rules
        model_provider_rules = ModelProviderFactory.get_provider_rule(provider_name)

        if model_provider_rules['model_flexibility'] != 'fixed':
            raise ValueError('Only support fixed model provider')

        # only support provider type CUSTOM
        if ProviderType.CUSTOM.value not in model_provider_rules['support_provider_types']:
            raise ValueError('Only support provider type CUSTOM')

        # validate provider config
        model_provider_class = ModelProviderFactory.get_model_provider_class(provider_name)
        model_provider_class.is_provider_credentials_valid_or_raise(config)

    def save_custom_provider_config(self, tenant_id: str, provider_name: str, config: dict) -> None:
        """
        save custom provider config.

        :param tenant_id:
        :param provider_name:
        :param config:
        :return:
        """
        # validate custom provider config
        self.custom_provider_config_validate(provider_name, config)

        # get provider
        provider = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == tenant_id,
            Provider.provider_name == provider_name,
            Provider.provider_type == ProviderType.CUSTOM.value
        ).first()

        model_provider_class = ModelProviderFactory.get_model_provider_class(provider_name)
        encrypted_config = model_provider_class.encrypt_provider_credentials(tenant_id, config)

        # save provider
        if provider:
            provider.encrypted_config = json.dumps(encrypted_config)
            provider.is_valid = True
            provider.updated_at = datetime.datetime.utcnow()
            db.session.commit()
        else:
            provider = Provider(
                tenant_id=tenant_id,
                provider_name=provider_name,
                provider_type=ProviderType.CUSTOM.value,
                encrypted_config=json.dumps(encrypted_config),
                is_valid=True
            )
            db.session.add(provider)
            db.session.commit()

    def delete_custom_provider(self, tenant_id: str, provider_name: str) -> None:
        """
        delete custom provider.

        :param tenant_id:
        :param provider_name:
        :return:
        """
        # get provider
        provider = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == tenant_id,
            Provider.provider_name == provider_name,
            Provider.provider_type == ProviderType.CUSTOM.value
        ).first()

        if provider:
            try:
                self.switch_preferred_provider(tenant_id, provider_name, ProviderType.SYSTEM.value)
            except ValueError:
                pass

            db.session.delete(provider)
            db.session.commit()

    def custom_provider_model_config_validate(self,
                                              provider_name: str,
                                              model_name: str,
                                              model_type: str,
                                              config: dict) -> None:
        """
        validate custom provider model config.

        :param provider_name:
        :param model_name:
        :param model_type:
        :param config:
        :return:
        :raises CredentialsValidateFailedError: When the config credential verification fails.
        """
        # get model provider rules
        model_provider_rules = ModelProviderFactory.get_provider_rule(provider_name)

        if model_provider_rules['model_flexibility'] != 'configurable':
            raise ValueError('Only support configurable model provider')

        # only support provider type CUSTOM
        if ProviderType.CUSTOM.value not in model_provider_rules['support_provider_types']:
            raise ValueError('Only support provider type CUSTOM')

        # validate provider model config
        model_type = ModelType.value_of(model_type)
        model_provider_class = ModelProviderFactory.get_model_provider_class(provider_name)
        model_provider_class.is_model_credentials_valid_or_raise(model_name, model_type, config)

    def add_or_save_custom_provider_model_config(self,
                                                 tenant_id: str,
                                                 provider_name: str,
                                                 model_name: str,
                                                 model_type: str,
                                                 config: dict) -> None:
        """
        Add or save custom provider model config.

        :param tenant_id:
        :param provider_name:
        :param model_name:
        :param model_type:
        :param config:
        :return:
        """
        # validate custom provider model config
        self.custom_provider_model_config_validate(provider_name, model_name, model_type, config)

        # get provider
        provider = db.session.query(Provider) \
            .filter(
            Provider.tenant_id == tenant_id,
            Provider.provider_name == provider_name,
            Provider.provider_type == ProviderType.CUSTOM.value
        ).first()

        if not provider:
            provider = Provider(
                tenant_id=tenant_id,
                provider_name=provider_name,
                provider_type=ProviderType.CUSTOM.value,
                is_valid=True
            )
            db.session.add(provider)
            db.session.commit()
        elif not provider.is_valid:
            provider.is_valid = True
            provider.encrypted_config = None
            db.session.commit()

        model_provider_class = ModelProviderFactory.get_model_provider_class(provider_name)
        encrypted_config = model_provider_class.encrypt_model_credentials(
            tenant_id,
            model_name,
            ModelType.value_of(model_type),
            config
        )

        # get provider model
        provider_model = db.session.query(ProviderModel) \
            .filter(
            ProviderModel.tenant_id == tenant_id,
            ProviderModel.provider_name == provider_name,
            ProviderModel.model_name == model_name,
            ProviderModel.model_type == model_type
        ).first()

        if provider_model:
            provider_model.encrypted_config = json.dumps(encrypted_config)
            provider_model.is_valid = True
            db.session.commit()
        else:
            provider_model = ProviderModel(
                tenant_id=tenant_id,
                provider_name=provider_name,
                model_name=model_name,
                model_type=model_type,
                encrypted_config=json.dumps(encrypted_config),
                is_valid=True
            )
            db.session.add(provider_model)
            db.session.commit()

    def delete_custom_provider_model(self,
                                     tenant_id: str,
                                     provider_name: str,
                                     model_name: str,
                                     model_type: str) -> None:
        """
        delete custom provider model.

        :param tenant_id:
        :param provider_name:
        :param model_name:
        :param model_type:
        :return:
        """
        # get provider model
        provider_model = db.session.query(ProviderModel) \
            .filter(
            ProviderModel.tenant_id == tenant_id,
            ProviderModel.provider_name == provider_name,
            ProviderModel.model_name == model_name,
            ProviderModel.model_type == model_type
        ).first()

        if provider_model:
            db.session.delete(provider_model)
            db.session.commit()

    def switch_preferred_provider(self, tenant_id: str, provider_name: str, preferred_provider_type: str) -> None:
        """
        switch preferred provider.

        :param tenant_id:
        :param provider_name:
        :param preferred_provider_type:
        :return:
        """
        provider_type = ProviderType.value_of(preferred_provider_type)
        if not provider_type:
            raise ValueError(f'Invalid preferred provider type: {preferred_provider_type}')

        model_provider_rules = ModelProviderFactory.get_provider_rule(provider_name)
        if preferred_provider_type not in model_provider_rules['support_provider_types']:
            raise ValueError(f'Not support provider type: {preferred_provider_type}')

        model_provider = ModelProviderFactory.get_model_provider_class(provider_name)
        if not model_provider.is_provider_type_system_supported():
            return

        # get preferred provider
        preferred_model_provider = db.session.query(TenantPreferredModelProvider) \
            .filter(
            TenantPreferredModelProvider.tenant_id == tenant_id,
            TenantPreferredModelProvider.provider_name == provider_name
        ).first()

        if preferred_model_provider:
            preferred_model_provider.preferred_provider_type = preferred_provider_type
        else:
            preferred_model_provider = TenantPreferredModelProvider(
                tenant_id=tenant_id,
                provider_name=provider_name,
                preferred_provider_type=preferred_provider_type
            )
            db.session.add(preferred_model_provider)

        db.session.commit()

    def get_default_model_of_model_type(self, tenant_id: str, model_type: str) -> Optional[TenantDefaultModel]:
        """
        get default model of model type.

        :param tenant_id:
        :param model_type:
        :return:
        """
        return ModelFactory.get_default_model(tenant_id, ModelType.value_of(model_type))

    def update_default_model_of_model_type(self,
                                           tenant_id: str,
                                           model_type: str,
                                           provider_name: str,
                                           model_name: str) -> TenantDefaultModel:
        """
        update default model of model type.

        :param tenant_id:
        :param model_type:
        :param provider_name:
        :param model_name:
        :return:
        """
        return ModelFactory.update_default_model(tenant_id, ModelType.value_of(model_type), provider_name, model_name)

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
                    "model_type": model_type,
                    "model_provider": {
                        "provider_name": provider.provider_name,
                        "provider_type": provider.provider_type
                    },
                    'features': []
                }

                if 'features' in model:
                    valid_model_dict['features'] = model['features']

                if provider.provider_type == ProviderType.SYSTEM.value:
                    valid_model_dict['model_provider']['quota_type'] = provider.quota_type
                    valid_model_dict['model_provider']['quota_unit'] = model_provider_rule['system_config']['quota_unit']
                    valid_model_dict['model_provider']['quota_limit'] = provider.quota_limit
                    valid_model_dict['model_provider']['quota_used'] = provider.quota_used

                valid_model_list.append(valid_model_dict)

        return valid_model_list

    def get_model_parameter_rules(self, tenant_id: str, model_provider_name: str, model_name: str, model_type: str) \
            -> ModelKwargsRules:
        """
        get model parameter rules.
        It depends on preferred provider in use.

        :param tenant_id:
        :param model_provider_name:
        :param model_name:
        :param model_type:
        :return:
        """
        # get model provider
        model_provider = ModelProviderFactory.get_preferred_model_provider(tenant_id, model_provider_name)
        if not model_provider:
            # get empty model provider
            return ModelKwargsRules()

        # get model parameter rules
        return model_provider.get_model_parameter_rules(model_name, ModelType.value_of(model_type))

