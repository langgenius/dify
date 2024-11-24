import datetime
import json
import logging
from json import JSONDecodeError
from typing import Optional

from constants import HIDDEN_VALUE
from core.entities.provider_configuration import ProviderConfiguration
from core.helper import encrypter
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.model_manager import LBModelManager
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
        provider_configuration.enable_model_load_balancing(model=model, model_type=ModelType.value_of(model_type))

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
        provider_configuration.disable_model_load_balancing(model=model, model_type=ModelType.value_of(model_type))

    def get_load_balancing_configs(
        self, tenant_id: str, provider: str, model: str, model_type: str
    ) -> tuple[bool, list[dict]]:
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

        # Get provider model setting
        provider_model_setting = provider_configuration.get_provider_model_setting(
            model_type=model_type,
            model=model,
        )

        is_load_balancing_enabled = False
        if provider_model_setting and provider_model_setting.load_balancing_enabled:
            is_load_balancing_enabled = True

        # Get load balancing configurations
        load_balancing_configs = (
            db.session.query(LoadBalancingModelConfig)
            .filter(
                LoadBalancingModelConfig.tenant_id == tenant_id,
                LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
                LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
                LoadBalancingModelConfig.model_name == model,
            )
            .order_by(LoadBalancingModelConfig.created_at)
            .all()
        )

        if provider_configuration.custom_configuration.provider:
            # check if the inherit configuration exists,
            # inherit is represented for the provider or model custom credentials
            inherit_config_exists = False
            for load_balancing_config in load_balancing_configs:
                if load_balancing_config.name == "__inherit__":
                    inherit_config_exists = True
                    break

            if not inherit_config_exists:
                # Initialize the inherit configuration
                inherit_config = self._init_inherit_config(tenant_id, provider, model, model_type)

                # prepend the inherit configuration
                load_balancing_configs.insert(0, inherit_config)
            else:
                # move the inherit configuration to the first
                for i, load_balancing_config in enumerate(load_balancing_configs[:]):
                    if load_balancing_config.name == "__inherit__":
                        inherit_config = load_balancing_configs.pop(i)
                        load_balancing_configs.insert(0, inherit_config)

        # Get credential form schemas from model credential schema or provider credential schema
        credential_schemas = self._get_credential_schema(provider_configuration)

        # Get decoding rsa key and cipher for decrypting credentials
        decoding_rsa_key, decoding_cipher_rsa = encrypter.get_decrypt_decoding(tenant_id)

        # fetch status and ttl for each config
        datas = []
        for load_balancing_config in load_balancing_configs:
            in_cooldown, ttl = LBModelManager.get_config_in_cooldown_and_ttl(
                tenant_id=tenant_id,
                provider=provider,
                model=model,
                model_type=model_type,
                config_id=load_balancing_config.id,
            )

            try:
                if load_balancing_config.encrypted_config:
                    credentials = json.loads(load_balancing_config.encrypted_config)
                else:
                    credentials = {}
            except JSONDecodeError:
                credentials = {}

            # Get provider credential secret variables
            credential_secret_variables = provider_configuration.extract_secret_variables(
                credential_schemas.credential_form_schemas
            )

            # decrypt credentials
            for variable in credential_secret_variables:
                if variable in credentials:
                    try:
                        credentials[variable] = encrypter.decrypt_token_with_decoding(
                            credentials.get(variable), decoding_rsa_key, decoding_cipher_rsa
                        )
                    except ValueError:
                        pass

            # Obfuscate credentials
            credentials = provider_configuration.obfuscated_credentials(
                credentials=credentials, credential_form_schemas=credential_schemas.credential_form_schemas
            )

            datas.append(
                {
                    "id": load_balancing_config.id,
                    "name": load_balancing_config.name,
                    "credentials": credentials,
                    "enabled": load_balancing_config.enabled,
                    "in_cooldown": in_cooldown,
                    "ttl": ttl,
                }
            )

        return is_load_balancing_enabled, datas

    def get_load_balancing_config(
        self, tenant_id: str, provider: str, model: str, model_type: str, config_id: str
    ) -> Optional[dict]:
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
        load_balancing_model_config = (
            db.session.query(LoadBalancingModelConfig)
            .filter(
                LoadBalancingModelConfig.tenant_id == tenant_id,
                LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
                LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
                LoadBalancingModelConfig.model_name == model,
                LoadBalancingModelConfig.id == config_id,
            )
            .first()
        )

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
            credentials=credentials, credential_form_schemas=credential_schemas.credential_form_schemas
        )

        return {
            "id": load_balancing_model_config.id,
            "name": load_balancing_model_config.name,
            "credentials": credentials,
            "enabled": load_balancing_model_config.enabled,
        }

    def _init_inherit_config(
        self, tenant_id: str, provider: str, model: str, model_type: ModelType
    ) -> LoadBalancingModelConfig:
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
            name="__inherit__",
        )
        db.session.add(inherit_config)
        db.session.commit()

        return inherit_config

    def update_load_balancing_configs(
        self, tenant_id: str, provider: str, model: str, model_type: str, configs: list[dict]
    ) -> None:
        """
        Update load balancing configurations.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :param configs: load balancing configs
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

        if not isinstance(configs, list):
            raise ValueError("Invalid load balancing configs")

        current_load_balancing_configs = (
            db.session.query(LoadBalancingModelConfig)
            .filter(
                LoadBalancingModelConfig.tenant_id == tenant_id,
                LoadBalancingModelConfig.provider_name == provider_configuration.provider.provider,
                LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
                LoadBalancingModelConfig.model_name == model,
            )
            .all()
        )

        # id as key, config as value
        current_load_balancing_configs_dict = {config.id: config for config in current_load_balancing_configs}
        updated_config_ids = set()

        for config in configs:
            if not isinstance(config, dict):
                raise ValueError("Invalid load balancing config")

            config_id = config.get("id")
            name = config.get("name")
            credentials = config.get("credentials")
            enabled = config.get("enabled")

            if not name:
                raise ValueError("Invalid load balancing config name")

            if enabled is None:
                raise ValueError("Invalid load balancing config enabled")

            # is config exists
            if config_id:
                config_id = str(config_id)

                if config_id not in current_load_balancing_configs_dict:
                    raise ValueError("Invalid load balancing config id: {}".format(config_id))

                updated_config_ids.add(config_id)

                load_balancing_config = current_load_balancing_configs_dict[config_id]

                # check duplicate name
                for current_load_balancing_config in current_load_balancing_configs:
                    if current_load_balancing_config.id != config_id and current_load_balancing_config.name == name:
                        raise ValueError("Load balancing config name {} already exists".format(name))

                if credentials:
                    if not isinstance(credentials, dict):
                        raise ValueError("Invalid load balancing config credentials")

                    # validate custom provider config
                    credentials = self._custom_credentials_validate(
                        tenant_id=tenant_id,
                        provider_configuration=provider_configuration,
                        model_type=model_type,
                        model=model,
                        credentials=credentials,
                        load_balancing_model_config=load_balancing_config,
                        validate=False,
                    )

                    # update load balancing config
                    load_balancing_config.encrypted_config = json.dumps(credentials)

                load_balancing_config.name = name
                load_balancing_config.enabled = enabled
                load_balancing_config.updated_at = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                db.session.commit()

                self._clear_credentials_cache(tenant_id, config_id)
            else:
                # create load balancing config
                if name == "__inherit__":
                    raise ValueError("Invalid load balancing config name")

                # check duplicate name
                for current_load_balancing_config in current_load_balancing_configs:
                    if current_load_balancing_config.name == name:
                        raise ValueError("Load balancing config name {} already exists".format(name))

                if not credentials:
                    raise ValueError("Invalid load balancing config credentials")

                if not isinstance(credentials, dict):
                    raise ValueError("Invalid load balancing config credentials")

                # validate custom provider config
                credentials = self._custom_credentials_validate(
                    tenant_id=tenant_id,
                    provider_configuration=provider_configuration,
                    model_type=model_type,
                    model=model,
                    credentials=credentials,
                    validate=False,
                )

                # create load balancing config
                load_balancing_model_config = LoadBalancingModelConfig(
                    tenant_id=tenant_id,
                    provider_name=provider_configuration.provider.provider,
                    model_type=model_type.to_origin_model_type(),
                    model_name=model,
                    name=name,
                    encrypted_config=json.dumps(credentials),
                )

                db.session.add(load_balancing_model_config)
                db.session.commit()

        # get deleted config ids
        deleted_config_ids = set(current_load_balancing_configs_dict.keys()) - updated_config_ids
        for config_id in deleted_config_ids:
            db.session.delete(current_load_balancing_configs_dict[config_id])
            db.session.commit()

            self._clear_credentials_cache(tenant_id, config_id)

    def validate_load_balancing_credentials(
        self,
        tenant_id: str,
        provider: str,
        model: str,
        model_type: str,
        credentials: dict,
        config_id: Optional[str] = None,
    ) -> None:
        """
        Validate load balancing credentials.
        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: credentials
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

        load_balancing_model_config = None
        if config_id:
            # Get load balancing config
            load_balancing_model_config = (
                db.session.query(LoadBalancingModelConfig)
                .filter(
                    LoadBalancingModelConfig.tenant_id == tenant_id,
                    LoadBalancingModelConfig.provider_name == provider,
                    LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
                    LoadBalancingModelConfig.model_name == model,
                    LoadBalancingModelConfig.id == config_id,
                )
                .first()
            )

            if not load_balancing_model_config:
                raise ValueError(f"Load balancing config {config_id} does not exist.")

        # Validate custom provider config
        self._custom_credentials_validate(
            tenant_id=tenant_id,
            provider_configuration=provider_configuration,
            model_type=model_type,
            model=model,
            credentials=credentials,
            load_balancing_model_config=load_balancing_model_config,
        )

    def _custom_credentials_validate(
        self,
        tenant_id: str,
        provider_configuration: ProviderConfiguration,
        model_type: ModelType,
        model: str,
        credentials: dict,
        load_balancing_model_config: Optional[LoadBalancingModelConfig] = None,
        validate: bool = True,
    ) -> dict:
        """
        Validate custom credentials.
        :param tenant_id: workspace id
        :param provider_configuration: provider configuration
        :param model_type: model type
        :param model: model name
        :param credentials: credentials
        :param load_balancing_model_config: load balancing model config
        :param validate: validate credentials
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
                    if value == HIDDEN_VALUE and key in original_credentials:
                        credentials[key] = encrypter.decrypt_token(tenant_id, original_credentials[key])

        if validate:
            if isinstance(credential_schemas, ModelCredentialSchema):
                credentials = model_provider_factory.model_credentials_validate(
                    provider=provider_configuration.provider.provider,
                    model_type=model_type,
                    model=model,
                    credentials=credentials,
                )
            else:
                credentials = model_provider_factory.provider_credentials_validate(
                    provider=provider_configuration.provider.provider, credentials=credentials
                )

        for key, value in credentials.items():
            if key in provider_credential_secret_variables:
                credentials[key] = encrypter.encrypt_token(tenant_id, value)

        return credentials

    def _get_credential_schema(
        self, provider_configuration: ProviderConfiguration
    ) -> ModelCredentialSchema | ProviderCredentialSchema:
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

    def _clear_credentials_cache(self, tenant_id: str, config_id: str) -> None:
        """
        Clear credentials cache.
        :param tenant_id: workspace id
        :param config_id: load balancing config id
        :return:
        """
        provider_model_credentials_cache = ProviderCredentialsCache(
            tenant_id=tenant_id, identity_id=config_id, cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL
        )

        provider_model_credentials_cache.delete()
