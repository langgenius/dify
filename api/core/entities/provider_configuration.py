import json
import logging
import re
from collections import defaultdict
from collections.abc import Iterator, Sequence
from json import JSONDecodeError

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from constants import HIDDEN_VALUE
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_entities import (
    CustomConfiguration,
    ModelSettings,
    SystemConfiguration,
    SystemConfigurationStatus,
)
from core.helper import encrypter
from core.helper.model_provider_cache import ProviderCredentialsCache, ProviderCredentialsCacheType
from core.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelType
from core.model_runtime.entities.provider_entities import (
    ConfigurateMethod,
    CredentialFormSchema,
    FormType,
    ProviderEntity,
)
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from models.provider import (
    LoadBalancingModelConfig,
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    ProviderModelSetting,
    ProviderType,
    TenantPreferredModelProvider,
)
from models.provider_ids import ModelProviderID
from services.enterprise.plugin_manager_service import PluginCredentialType

logger = logging.getLogger(__name__)

original_provider_configurate_methods: dict[str, list[ConfigurateMethod]] = {}


class ProviderConfiguration(BaseModel):
    """
    Provider configuration entity for managing model provider settings.

    This class handles:
    - Provider credentials CRUD and switch
    - Custom Model credentials CRUD and switch
    - System vs custom provider switching
    - Load balancing configurations
    - Model enablement/disablement

    TODO: lots of logic in a BaseModel entity should be separated, the exceptions should be classified
    """

    tenant_id: str
    provider: ProviderEntity
    preferred_provider_type: ProviderType
    using_provider_type: ProviderType
    system_configuration: SystemConfiguration
    custom_configuration: CustomConfiguration
    model_settings: list[ModelSettings]

    # pydantic configs
    model_config = ConfigDict(protected_namespaces=())

    @model_validator(mode="after")
    def _(self):
        if self.provider.provider not in original_provider_configurate_methods:
            original_provider_configurate_methods[self.provider.provider] = []
            for configurate_method in self.provider.configurate_methods:
                original_provider_configurate_methods[self.provider.provider].append(configurate_method)

        if original_provider_configurate_methods[self.provider.provider] == [ConfigurateMethod.CUSTOMIZABLE_MODEL]:
            if (
                any(
                    len(quota_configuration.restrict_models) > 0
                    for quota_configuration in self.system_configuration.quota_configurations
                )
                and ConfigurateMethod.PREDEFINED_MODEL not in self.provider.configurate_methods
            ):
                self.provider.configurate_methods.append(ConfigurateMethod.PREDEFINED_MODEL)
        return self

    def get_current_credentials(self, model_type: ModelType, model: str) -> dict | None:
        """
        Get current credentials.

        :param model_type: model type
        :param model: model name
        :return:
        """
        if self.model_settings:
            # check if model is disabled by admin
            for model_setting in self.model_settings:
                if model_setting.model_type == model_type and model_setting.model == model:
                    if not model_setting.enabled:
                        raise ValueError(f"Model {model} is disabled.")

        if self.using_provider_type == ProviderType.SYSTEM:
            restrict_models = []
            for quota_configuration in self.system_configuration.quota_configurations:
                if self.system_configuration.current_quota_type != quota_configuration.quota_type:
                    continue

                restrict_models = quota_configuration.restrict_models

            copy_credentials = (
                self.system_configuration.credentials.copy() if self.system_configuration.credentials else {}
            )
            if restrict_models:
                for restrict_model in restrict_models:
                    if (
                        restrict_model.model_type == model_type
                        and restrict_model.model == model
                        and restrict_model.base_model_name
                    ):
                        copy_credentials["base_model_name"] = restrict_model.base_model_name

            return copy_credentials
        else:
            credentials = None
            current_credential_id = None

            if self.custom_configuration.models:
                for model_configuration in self.custom_configuration.models:
                    if model_configuration.model_type == model_type and model_configuration.model == model:
                        credentials = model_configuration.credentials
                        current_credential_id = model_configuration.current_credential_id
                        break

            if not credentials and self.custom_configuration.provider:
                credentials = self.custom_configuration.provider.credentials
                current_credential_id = self.custom_configuration.provider.current_credential_id

            if current_credential_id:
                from core.helper.credential_utils import check_credential_policy_compliance

                check_credential_policy_compliance(
                    credential_id=current_credential_id,
                    provider=self.provider.provider,
                    credential_type=PluginCredentialType.MODEL,
                )
            else:
                # no current credential id, check all available credentials
                if self.custom_configuration.provider:
                    for credential_configuration in self.custom_configuration.provider.available_credentials:
                        from core.helper.credential_utils import check_credential_policy_compliance

                        check_credential_policy_compliance(
                            credential_id=credential_configuration.credential_id,
                            provider=self.provider.provider,
                            credential_type=PluginCredentialType.MODEL,
                        )

            return credentials

    def get_system_configuration_status(self) -> SystemConfigurationStatus | None:
        """
        Get system configuration status.
        :return:
        """
        if self.system_configuration.enabled is False:
            return SystemConfigurationStatus.UNSUPPORTED

        current_quota_type = self.system_configuration.current_quota_type
        current_quota_configuration = next(
            (q for q in self.system_configuration.quota_configurations if q.quota_type == current_quota_type), None
        )
        if current_quota_configuration is None:
            return None

        if not current_quota_configuration:
            return SystemConfigurationStatus.UNSUPPORTED

        return (
            SystemConfigurationStatus.ACTIVE
            if current_quota_configuration.is_valid
            else SystemConfigurationStatus.QUOTA_EXCEEDED
        )

    def is_custom_configuration_available(self) -> bool:
        """
        Check custom configuration available.
        :return:
        """
        has_provider_credentials = (
            self.custom_configuration.provider is not None
            and len(self.custom_configuration.provider.available_credentials) > 0
        )

        has_model_configurations = len(self.custom_configuration.models) > 0
        return has_provider_credentials or has_model_configurations

    def _get_provider_record(self, session: Session) -> Provider | None:
        """
        Get custom provider record.
        """
        stmt = select(Provider).where(
            Provider.tenant_id == self.tenant_id,
            Provider.provider_type == ProviderType.CUSTOM,
            Provider.provider_name.in_(self._get_provider_names()),
        )

        return session.execute(stmt).scalar_one_or_none()

    def _get_specific_provider_credential(self, credential_id: str) -> dict | None:
        """
        Get a specific provider credential by ID.
        :param credential_id: Credential ID
        :return:
        """
        # Extract secret variables from provider credential schema
        credential_secret_variables = self.extract_secret_variables(
            self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema
            else []
        )

        with Session(db.engine) as session:
            # Prefer the actual provider record name if exists (to handle aliased provider names)
            provider_record = self._get_provider_record(session)
            provider_name = provider_record.provider_name if provider_record else self.provider.provider

            stmt = select(ProviderCredential).where(
                ProviderCredential.id == credential_id,
                ProviderCredential.tenant_id == self.tenant_id,
                ProviderCredential.provider_name == provider_name,
            )

            credential = session.execute(stmt).scalar_one_or_none()

        if not credential or not credential.encrypted_config:
            raise ValueError(f"Credential with id {credential_id} not found.")

        try:
            credentials = json.loads(credential.encrypted_config)
        except JSONDecodeError:
            credentials = {}

        # Decrypt secret variables
        for key in credential_secret_variables:
            if key in credentials and credentials[key] is not None:
                try:
                    credentials[key] = encrypter.decrypt_token(tenant_id=self.tenant_id, token=credentials[key])
                except Exception:
                    pass

        return self.obfuscated_credentials(
            credentials=credentials,
            credential_form_schemas=self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema
            else [],
        )

    def _check_provider_credential_name_exists(
        self, credential_name: str, session: Session, exclude_id: str | None = None
    ) -> bool:
        """
        not allowed same name when create or update a credential
        """
        stmt = select(ProviderCredential.id).where(
            ProviderCredential.tenant_id == self.tenant_id,
            ProviderCredential.provider_name.in_(self._get_provider_names()),
            ProviderCredential.credential_name == credential_name,
        )
        if exclude_id:
            stmt = stmt.where(ProviderCredential.id != exclude_id)
        return session.execute(stmt).scalar_one_or_none() is not None

    def get_provider_credential(self, credential_id: str | None = None) -> dict | None:
        """
        Get provider credentials.

        :param credential_id: if provided, return the specified credential
        :return:
        """
        if credential_id:
            return self._get_specific_provider_credential(credential_id)

        # Default behavior: return current active provider credentials
        credentials = self.custom_configuration.provider.credentials if self.custom_configuration.provider else {}

        return self.obfuscated_credentials(
            credentials=credentials,
            credential_form_schemas=self.provider.provider_credential_schema.credential_form_schemas
            if self.provider.provider_credential_schema
            else [],
        )

    def validate_provider_credentials(self, credentials: dict, credential_id: str = "", session: Session | None = None):
        """
        Validate custom credentials.
        :param credentials: provider credentials
        :param credential_id: (Optional)If provided, can use existing credential's hidden api key to validate
        :param session: optional database session
        :return:
        """

        def _validate(s: Session):
            # Get provider credential secret variables
            provider_credential_secret_variables = self.extract_secret_variables(
                self.provider.provider_credential_schema.credential_form_schemas
                if self.provider.provider_credential_schema
                else []
            )

            if credential_id:
                try:
                    stmt = select(ProviderCredential).where(
                        ProviderCredential.tenant_id == self.tenant_id,
                        ProviderCredential.provider_name.in_(self._get_provider_names()),
                        ProviderCredential.id == credential_id,
                    )
                    credential_record = s.execute(stmt).scalar_one_or_none()
                    # fix origin data
                    if credential_record and credential_record.encrypted_config:
                        if not credential_record.encrypted_config.startswith("{"):
                            original_credentials = {"openai_api_key": credential_record.encrypted_config}
                        else:
                            original_credentials = json.loads(credential_record.encrypted_config)
                    else:
                        original_credentials = {}
                except JSONDecodeError:
                    original_credentials = {}

                # encrypt credentials
                for key, value in credentials.items():
                    if key in provider_credential_secret_variables:
                        # if send [__HIDDEN__] in secret input, it will be same as original value
                        if value == HIDDEN_VALUE and key in original_credentials:
                            credentials[key] = encrypter.decrypt_token(
                                tenant_id=self.tenant_id, token=original_credentials[key]
                            )

            model_provider_factory = ModelProviderFactory(self.tenant_id)
            validated_credentials = model_provider_factory.provider_credentials_validate(
                provider=self.provider.provider, credentials=credentials
            )

            for key, value in validated_credentials.items():
                if key in provider_credential_secret_variables:
                    validated_credentials[key] = encrypter.encrypt_token(self.tenant_id, value)

            return validated_credentials

        if session:
            return _validate(session)
        else:
            with Session(db.engine) as new_session:
                return _validate(new_session)

    def _generate_provider_credential_name(self, session) -> str:
        """
        Generate a unique credential name for provider.
        :return: credential name
        """
        return self._generate_next_api_key_name(
            session=session,
            query_factory=lambda: select(ProviderCredential).where(
                ProviderCredential.tenant_id == self.tenant_id,
                ProviderCredential.provider_name.in_(self._get_provider_names()),
            ),
        )

    def _generate_custom_model_credential_name(self, model: str, model_type: ModelType, session) -> str:
        """
        Generate a unique credential name for custom model.
        :return: credential name
        """
        return self._generate_next_api_key_name(
            session=session,
            query_factory=lambda: select(ProviderModelCredential).where(
                ProviderModelCredential.tenant_id == self.tenant_id,
                ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                ProviderModelCredential.model_name == model,
                ProviderModelCredential.model_type == model_type.to_origin_model_type(),
            ),
        )

    def _generate_next_api_key_name(self, session, query_factory) -> str:
        """
        Generate next available API KEY name by finding the highest numbered suffix.
        :param session: database session
        :param query_factory: function that returns the SQLAlchemy query
        :return: next available API KEY name
        """
        try:
            stmt = query_factory()
            credential_records = session.execute(stmt).scalars().all()

            if not credential_records:
                return "API KEY 1"

            # Extract numbers from API KEY pattern using list comprehension
            pattern = re.compile(r"^API KEY\s+(\d+)$")
            numbers = [
                int(match.group(1))
                for cr in credential_records
                if cr.credential_name and (match := pattern.match(cr.credential_name.strip()))
            ]

            # Return next sequential number
            next_number = max(numbers, default=0) + 1
            return f"API KEY {next_number}"

        except Exception as e:
            logger.warning("Error generating next credential name: %s", str(e))
            return "API KEY 1"

    def _get_provider_names(self):
        """
        The provider name might be stored in the database as either `openai` or `langgenius/openai/openai`.
        """
        model_provider_id = ModelProviderID(self.provider.provider)
        provider_names = [self.provider.provider]
        if model_provider_id.is_langgenius():
            provider_names.append(model_provider_id.provider_name)
        return provider_names

    def create_provider_credential(self, credentials: dict, credential_name: str | None):
        """
        Add custom provider credentials.
        :param credentials: provider credentials
        :param credential_name: credential name
        :return:
        """
        with Session(db.engine) as session:
            if credential_name:
                if self._check_provider_credential_name_exists(credential_name=credential_name, session=session):
                    raise ValueError(f"Credential with name '{credential_name}' already exists.")
            else:
                credential_name = self._generate_provider_credential_name(session)

            credentials = self.validate_provider_credentials(credentials=credentials, session=session)
            provider_record = self._get_provider_record(session)
            try:
                new_record = ProviderCredential(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    encrypted_config=json.dumps(credentials),
                    credential_name=credential_name,
                )
                session.add(new_record)
                session.flush()

                if not provider_record:
                    # If provider record does not exist, create it
                    provider_record = Provider(
                        tenant_id=self.tenant_id,
                        provider_name=self.provider.provider,
                        provider_type=ProviderType.CUSTOM,
                        is_valid=True,
                        credential_id=new_record.id,
                    )
                    session.add(provider_record)

                    provider_model_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=provider_record.id,
                        cache_type=ProviderCredentialsCacheType.PROVIDER,
                    )
                    provider_model_credentials_cache.delete()

                    self.switch_preferred_provider_type(provider_type=ProviderType.CUSTOM, session=session)
                else:
                    # some historical data may have a provider record but not be set as valid
                    provider_record.is_valid = True

                session.commit()
            except Exception:
                session.rollback()
                raise

    def update_provider_credential(
        self,
        credentials: dict,
        credential_id: str,
        credential_name: str | None,
    ):
        """
        update a saved provider credential (by credential_id).

        :param credentials: provider credentials
        :param credential_id: credential id
        :param credential_name: credential name
        :return:
        """
        with Session(db.engine) as session:
            if credential_name and self._check_provider_credential_name_exists(
                credential_name=credential_name, session=session, exclude_id=credential_id
            ):
                raise ValueError(f"Credential with name '{credential_name}' already exists.")

            credentials = self.validate_provider_credentials(
                credentials=credentials, credential_id=credential_id, session=session
            )
            provider_record = self._get_provider_record(session)
            stmt = select(ProviderCredential).where(
                ProviderCredential.id == credential_id,
                ProviderCredential.tenant_id == self.tenant_id,
                ProviderCredential.provider_name.in_(self._get_provider_names()),
            )

            # Get the credential record to update
            credential_record = session.execute(stmt).scalar_one_or_none()
            if not credential_record:
                raise ValueError("Credential record not found.")
            try:
                # Update credential
                credential_record.encrypted_config = json.dumps(credentials)
                credential_record.updated_at = naive_utc_now()
                if credential_name:
                    credential_record.credential_name = credential_name
                session.commit()

                if provider_record and provider_record.credential_id == credential_id:
                    provider_model_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=provider_record.id,
                        cache_type=ProviderCredentialsCacheType.PROVIDER,
                    )
                    provider_model_credentials_cache.delete()

                self._update_load_balancing_configs_with_credential(
                    credential_id=credential_id,
                    credential_record=credential_record,
                    credential_source="provider",
                    session=session,
                )
            except Exception:
                session.rollback()
                raise

    def _update_load_balancing_configs_with_credential(
        self,
        credential_id: str,
        credential_record: ProviderCredential | ProviderModelCredential,
        credential_source: str,
        session: Session,
    ):
        """
        Update load balancing configurations that reference the given credential_id.

        :param credential_id: credential id
        :param credential_record: the encrypted_config and credential_name
        :param credential_source: the credential comes from the provider_credential(`provider`)
            or the provider_model_credential(`custom_model`)
        :param session: the database session
        :return:
        """
        # Find all load balancing configs that use this credential_id
        stmt = select(LoadBalancingModelConfig).where(
            LoadBalancingModelConfig.tenant_id == self.tenant_id,
            LoadBalancingModelConfig.provider_name.in_(self._get_provider_names()),
            LoadBalancingModelConfig.credential_id == credential_id,
            LoadBalancingModelConfig.credential_source_type == credential_source,
        )
        load_balancing_configs = session.execute(stmt).scalars().all()

        if not load_balancing_configs:
            return

        # Update each load balancing config with the new credentials
        for lb_config in load_balancing_configs:
            # Update the encrypted_config with the new credentials
            lb_config.encrypted_config = credential_record.encrypted_config
            lb_config.name = credential_record.credential_name
            lb_config.updated_at = naive_utc_now()

            # Clear cache for this load balancing config
            lb_credentials_cache = ProviderCredentialsCache(
                tenant_id=self.tenant_id,
                identity_id=lb_config.id,
                cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
            )
            lb_credentials_cache.delete()

        session.commit()

    def delete_provider_credential(self, credential_id: str):
        """
        Delete a saved provider credential (by credential_id).

        :param credential_id: credential id
        :return:
        """
        with Session(db.engine) as session:
            stmt = select(ProviderCredential).where(
                ProviderCredential.id == credential_id,
                ProviderCredential.tenant_id == self.tenant_id,
                ProviderCredential.provider_name.in_(self._get_provider_names()),
            )

            # Get the credential record to update
            credential_record = session.execute(stmt).scalar_one_or_none()
            if not credential_record:
                raise ValueError("Credential record not found.")

            # Check if this credential is used in load balancing configs
            lb_stmt = select(LoadBalancingModelConfig).where(
                LoadBalancingModelConfig.tenant_id == self.tenant_id,
                LoadBalancingModelConfig.provider_name.in_(self._get_provider_names()),
                LoadBalancingModelConfig.credential_id == credential_id,
                LoadBalancingModelConfig.credential_source_type == "provider",
            )
            lb_configs_using_credential = session.execute(lb_stmt).scalars().all()
            try:
                for lb_config in lb_configs_using_credential:
                    lb_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=lb_config.id,
                        cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
                    )
                    lb_credentials_cache.delete()
                    session.delete(lb_config)

                # Check if this is the currently active credential
                provider_record = self._get_provider_record(session)

                # Check available credentials count BEFORE deleting
                # if this is the last credential, we need to delete the provider record
                count_stmt = select(func.count(ProviderCredential.id)).where(
                    ProviderCredential.tenant_id == self.tenant_id,
                    ProviderCredential.provider_name.in_(self._get_provider_names()),
                )
                available_credentials_count = session.execute(count_stmt).scalar() or 0
                session.delete(credential_record)

                if provider_record and available_credentials_count <= 1:
                    # If all credentials are deleted, delete the provider record
                    session.delete(provider_record)

                    provider_model_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=provider_record.id,
                        cache_type=ProviderCredentialsCacheType.PROVIDER,
                    )
                    provider_model_credentials_cache.delete()
                    self.switch_preferred_provider_type(provider_type=ProviderType.SYSTEM, session=session)
                elif provider_record and provider_record.credential_id == credential_id:
                    provider_record.credential_id = None
                    provider_record.updated_at = naive_utc_now()

                    provider_model_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=provider_record.id,
                        cache_type=ProviderCredentialsCacheType.PROVIDER,
                    )
                    provider_model_credentials_cache.delete()
                    self.switch_preferred_provider_type(provider_type=ProviderType.SYSTEM, session=session)

                session.commit()
            except Exception:
                session.rollback()
                raise

    def switch_active_provider_credential(self, credential_id: str):
        """
        Switch active provider credential (copy the selected one into current active snapshot).

        :param credential_id: credential id
        :return:
        """
        with Session(db.engine) as session:
            stmt = select(ProviderCredential).where(
                ProviderCredential.id == credential_id,
                ProviderCredential.tenant_id == self.tenant_id,
                ProviderCredential.provider_name.in_(self._get_provider_names()),
            )
            credential_record = session.execute(stmt).scalar_one_or_none()
            if not credential_record:
                raise ValueError("Credential record not found.")

            provider_record = self._get_provider_record(session)
            if not provider_record:
                raise ValueError("Provider record not found.")

            try:
                provider_record.credential_id = credential_record.id
                provider_record.updated_at = naive_utc_now()
                session.commit()

                provider_model_credentials_cache = ProviderCredentialsCache(
                    tenant_id=self.tenant_id,
                    identity_id=provider_record.id,
                    cache_type=ProviderCredentialsCacheType.PROVIDER,
                )
                provider_model_credentials_cache.delete()
                self.switch_preferred_provider_type(ProviderType.CUSTOM, session=session)
            except Exception:
                session.rollback()
                raise

    def _get_custom_model_record(
        self,
        model_type: ModelType,
        model: str,
        session: Session,
    ) -> ProviderModel | None:
        """
        Get custom model credentials.
        """
        # get provider model

        model_provider_id = ModelProviderID(self.provider.provider)
        provider_names = [self.provider.provider]
        if model_provider_id.is_langgenius():
            provider_names.append(model_provider_id.provider_name)

        stmt = select(ProviderModel).where(
            ProviderModel.tenant_id == self.tenant_id,
            ProviderModel.provider_name.in_(provider_names),
            ProviderModel.model_name == model,
            ProviderModel.model_type == model_type.to_origin_model_type(),
        )

        return session.execute(stmt).scalar_one_or_none()

    def _get_specific_custom_model_credential(
        self, model_type: ModelType, model: str, credential_id: str
    ) -> dict | None:
        """
        Get a specific provider credential by ID.
        :param credential_id: Credential ID
        :return:
        """
        model_credential_secret_variables = self.extract_secret_variables(
            self.provider.model_credential_schema.credential_form_schemas
            if self.provider.model_credential_schema
            else []
        )

        with Session(db.engine) as session:
            stmt = select(ProviderModelCredential).where(
                ProviderModelCredential.id == credential_id,
                ProviderModelCredential.tenant_id == self.tenant_id,
                ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                ProviderModelCredential.model_name == model,
                ProviderModelCredential.model_type == model_type.to_origin_model_type(),
            )

            credential_record = session.execute(stmt).scalar_one_or_none()

        if not credential_record or not credential_record.encrypted_config:
            raise ValueError(f"Credential with id {credential_id} not found.")

        try:
            credentials = json.loads(credential_record.encrypted_config)
        except JSONDecodeError:
            credentials = {}

        # Decrypt secret variables
        for key in model_credential_secret_variables:
            if key in credentials and credentials[key] is not None:
                try:
                    credentials[key] = encrypter.decrypt_token(tenant_id=self.tenant_id, token=credentials[key])
                except Exception:
                    pass

        current_credential_id = credential_record.id
        current_credential_name = credential_record.credential_name

        credentials = self.obfuscated_credentials(
            credentials=credentials,
            credential_form_schemas=self.provider.model_credential_schema.credential_form_schemas
            if self.provider.model_credential_schema
            else [],
        )

        return {
            "current_credential_id": current_credential_id,
            "current_credential_name": current_credential_name,
            "credentials": credentials,
        }

    def _check_custom_model_credential_name_exists(
        self, model_type: ModelType, model: str, credential_name: str, session: Session, exclude_id: str | None = None
    ) -> bool:
        """
        not allowed same name when create or update a credential
        """
        stmt = select(ProviderModelCredential).where(
            ProviderModelCredential.tenant_id == self.tenant_id,
            ProviderModelCredential.provider_name.in_(self._get_provider_names()),
            ProviderModelCredential.model_name == model,
            ProviderModelCredential.model_type == model_type.to_origin_model_type(),
            ProviderModelCredential.credential_name == credential_name,
        )
        if exclude_id:
            stmt = stmt.where(ProviderModelCredential.id != exclude_id)
        return session.execute(stmt).scalar_one_or_none() is not None

    def get_custom_model_credential(self, model_type: ModelType, model: str, credential_id: str | None) -> dict | None:
        """
        Get custom model credentials.

        :param model_type: model type
        :param model: model name
        :return:
        """
        # If credential_id is provided, return the specific credential
        if credential_id:
            return self._get_specific_custom_model_credential(
                model_type=model_type, model=model, credential_id=credential_id
            )

        for model_configuration in self.custom_configuration.models:
            if (
                model_configuration.model_type == model_type
                and model_configuration.model == model
                and model_configuration.credentials
            ):
                current_credential_id = model_configuration.current_credential_id
                current_credential_name = model_configuration.current_credential_name

                credentials = self.obfuscated_credentials(
                    credentials=model_configuration.credentials,
                    credential_form_schemas=self.provider.model_credential_schema.credential_form_schemas
                    if self.provider.model_credential_schema
                    else [],
                )
                return {
                    "current_credential_id": current_credential_id,
                    "current_credential_name": current_credential_name,
                    "credentials": credentials,
                }
        return None

    def validate_custom_model_credentials(
        self,
        model_type: ModelType,
        model: str,
        credentials: dict,
        credential_id: str = "",
        session: Session | None = None,
    ):
        """
        Validate custom model credentials.

        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :param credential_id: (Optional)If provided, can use existing credential's hidden api key to validate
        :return:
        """

        def _validate(s: Session):
            # Get provider credential secret variables
            provider_credential_secret_variables = self.extract_secret_variables(
                self.provider.model_credential_schema.credential_form_schemas
                if self.provider.model_credential_schema
                else []
            )

            if credential_id:
                try:
                    stmt = select(ProviderModelCredential).where(
                        ProviderModelCredential.id == credential_id,
                        ProviderModelCredential.tenant_id == self.tenant_id,
                        ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                        ProviderModelCredential.model_name == model,
                        ProviderModelCredential.model_type == model_type.to_origin_model_type(),
                    )
                    credential_record = s.execute(stmt).scalar_one_or_none()
                    original_credentials = (
                        json.loads(credential_record.encrypted_config)
                        if credential_record and credential_record.encrypted_config
                        else {}
                    )
                except JSONDecodeError:
                    original_credentials = {}

                # decrypt credentials
                for key, value in credentials.items():
                    if key in provider_credential_secret_variables:
                        # if send [__HIDDEN__] in secret input, it will be same as original value
                        if value == HIDDEN_VALUE and key in original_credentials:
                            credentials[key] = encrypter.decrypt_token(
                                tenant_id=self.tenant_id, token=original_credentials[key]
                            )

            model_provider_factory = ModelProviderFactory(self.tenant_id)
            validated_credentials = model_provider_factory.model_credentials_validate(
                provider=self.provider.provider, model_type=model_type, model=model, credentials=credentials
            )

            for key, value in validated_credentials.items():
                if key in provider_credential_secret_variables:
                    validated_credentials[key] = encrypter.encrypt_token(self.tenant_id, value)

            return validated_credentials

        if session:
            return _validate(session)
        else:
            with Session(db.engine) as new_session:
                return _validate(new_session)

    def create_custom_model_credential(
        self, model_type: ModelType, model: str, credentials: dict, credential_name: str | None
    ) -> None:
        """
        Create a custom model credential.

        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :return:
        """
        with Session(db.engine) as session:
            if credential_name:
                if self._check_custom_model_credential_name_exists(
                    model=model, model_type=model_type, credential_name=credential_name, session=session
                ):
                    raise ValueError(f"Model credential with name '{credential_name}' already exists for {model}.")
            else:
                credential_name = self._generate_custom_model_credential_name(
                    model=model, model_type=model_type, session=session
                )
            # validate custom model config
            credentials = self.validate_custom_model_credentials(
                model_type=model_type, model=model, credentials=credentials, session=session
            )
            provider_model_record = self._get_custom_model_record(model_type=model_type, model=model, session=session)

            try:
                credential = ProviderModelCredential(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    model_name=model,
                    model_type=model_type.to_origin_model_type(),
                    encrypted_config=json.dumps(credentials),
                    credential_name=credential_name,
                )
                session.add(credential)
                session.flush()

                # save provider model
                if not provider_model_record:
                    provider_model_record = ProviderModel(
                        tenant_id=self.tenant_id,
                        provider_name=self.provider.provider,
                        model_name=model,
                        model_type=model_type.to_origin_model_type(),
                        credential_id=credential.id,
                        is_valid=True,
                    )
                    session.add(provider_model_record)

                session.commit()

                provider_model_credentials_cache = ProviderCredentialsCache(
                    tenant_id=self.tenant_id,
                    identity_id=provider_model_record.id,
                    cache_type=ProviderCredentialsCacheType.MODEL,
                )
                provider_model_credentials_cache.delete()
            except Exception:
                session.rollback()
                raise

    def update_custom_model_credential(
        self, model_type: ModelType, model: str, credentials: dict, credential_name: str | None, credential_id: str
    ) -> None:
        """
        Update a custom model credential.

        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :param credential_name: credential name
        :param credential_id: credential id
        :return:
        """
        with Session(db.engine) as session:
            if credential_name and self._check_custom_model_credential_name_exists(
                model=model,
                model_type=model_type,
                credential_name=credential_name,
                session=session,
                exclude_id=credential_id,
            ):
                raise ValueError(f"Model credential with name '{credential_name}' already exists for {model}.")
            # validate custom model config
            credentials = self.validate_custom_model_credentials(
                model_type=model_type,
                model=model,
                credentials=credentials,
                credential_id=credential_id,
                session=session,
            )
            provider_model_record = self._get_custom_model_record(model_type=model_type, model=model, session=session)

            stmt = select(ProviderModelCredential).where(
                ProviderModelCredential.id == credential_id,
                ProviderModelCredential.tenant_id == self.tenant_id,
                ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                ProviderModelCredential.model_name == model,
                ProviderModelCredential.model_type == model_type.to_origin_model_type(),
            )
            credential_record = session.execute(stmt).scalar_one_or_none()
            if not credential_record:
                raise ValueError("Credential record not found.")

            try:
                # Update credential
                credential_record.encrypted_config = json.dumps(credentials)
                credential_record.updated_at = naive_utc_now()
                if credential_name:
                    credential_record.credential_name = credential_name
                session.commit()

                if provider_model_record and provider_model_record.credential_id == credential_id:
                    provider_model_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=provider_model_record.id,
                        cache_type=ProviderCredentialsCacheType.MODEL,
                    )
                    provider_model_credentials_cache.delete()

                self._update_load_balancing_configs_with_credential(
                    credential_id=credential_id,
                    credential_record=credential_record,
                    credential_source="custom_model",
                    session=session,
                )
            except Exception:
                session.rollback()
                raise

    def delete_custom_model_credential(self, model_type: ModelType, model: str, credential_id: str):
        """
        Delete a saved provider credential (by credential_id).

        :param credential_id: credential id
        :return:
        """
        with Session(db.engine) as session:
            stmt = select(ProviderModelCredential).where(
                ProviderModelCredential.id == credential_id,
                ProviderModelCredential.tenant_id == self.tenant_id,
                ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                ProviderModelCredential.model_name == model,
                ProviderModelCredential.model_type == model_type.to_origin_model_type(),
            )
            credential_record = session.execute(stmt).scalar_one_or_none()
            if not credential_record:
                raise ValueError("Credential record not found.")

            lb_stmt = select(LoadBalancingModelConfig).where(
                LoadBalancingModelConfig.tenant_id == self.tenant_id,
                LoadBalancingModelConfig.provider_name.in_(self._get_provider_names()),
                LoadBalancingModelConfig.credential_id == credential_id,
                LoadBalancingModelConfig.credential_source_type == "custom_model",
            )
            lb_configs_using_credential = session.execute(lb_stmt).scalars().all()

            try:
                for lb_config in lb_configs_using_credential:
                    lb_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=lb_config.id,
                        cache_type=ProviderCredentialsCacheType.LOAD_BALANCING_MODEL,
                    )
                    lb_credentials_cache.delete()
                    session.delete(lb_config)

                # Check if this is the currently active credential
                provider_model_record = self._get_custom_model_record(model_type, model, session=session)

                # Check available credentials count BEFORE deleting
                # if this is the last credential, we need to delete the custom model record
                count_stmt = select(func.count(ProviderModelCredential.id)).where(
                    ProviderModelCredential.tenant_id == self.tenant_id,
                    ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                    ProviderModelCredential.model_name == model,
                    ProviderModelCredential.model_type == model_type.to_origin_model_type(),
                )
                available_credentials_count = session.execute(count_stmt).scalar() or 0
                session.delete(credential_record)

                if provider_model_record and available_credentials_count <= 1:
                    # If all credentials are deleted, delete the custom model record
                    session.delete(provider_model_record)
                elif provider_model_record and provider_model_record.credential_id == credential_id:
                    provider_model_record.credential_id = None
                    provider_model_record.updated_at = naive_utc_now()
                    provider_model_credentials_cache = ProviderCredentialsCache(
                        tenant_id=self.tenant_id,
                        identity_id=provider_model_record.id,
                        cache_type=ProviderCredentialsCacheType.PROVIDER,
                    )
                    provider_model_credentials_cache.delete()

                session.commit()

            except Exception:
                session.rollback()
                raise

    def add_model_credential_to_model(self, model_type: ModelType, model: str, credential_id: str):
        """
        if model list exist this custom model, switch the custom model credential.
        if model list not exist this custom model, use the credential to add a new custom model record.

        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        with Session(db.engine) as session:
            stmt = select(ProviderModelCredential).where(
                ProviderModelCredential.id == credential_id,
                ProviderModelCredential.tenant_id == self.tenant_id,
                ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                ProviderModelCredential.model_name == model,
                ProviderModelCredential.model_type == model_type.to_origin_model_type(),
            )
            credential_record = session.execute(stmt).scalar_one_or_none()
            if not credential_record:
                raise ValueError("Credential record not found.")

            # validate custom model config
            provider_model_record = self._get_custom_model_record(model_type=model_type, model=model, session=session)

            if not provider_model_record:
                # create provider model record
                provider_model_record = ProviderModel(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    model_name=model,
                    model_type=model_type.to_origin_model_type(),
                    is_valid=True,
                    credential_id=credential_id,
                )
            else:
                if provider_model_record.credential_id == credential_record.id:
                    raise ValueError("Can't add same credential")
                provider_model_record.credential_id = credential_record.id
                provider_model_record.updated_at = naive_utc_now()

                # clear cache
                provider_model_credentials_cache = ProviderCredentialsCache(
                    tenant_id=self.tenant_id,
                    identity_id=provider_model_record.id,
                    cache_type=ProviderCredentialsCacheType.MODEL,
                )
                provider_model_credentials_cache.delete()

            session.add(provider_model_record)
            session.commit()

    def switch_custom_model_credential(self, model_type: ModelType, model: str, credential_id: str):
        """
        switch the custom model credential.

        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        with Session(db.engine) as session:
            stmt = select(ProviderModelCredential).where(
                ProviderModelCredential.id == credential_id,
                ProviderModelCredential.tenant_id == self.tenant_id,
                ProviderModelCredential.provider_name.in_(self._get_provider_names()),
                ProviderModelCredential.model_name == model,
                ProviderModelCredential.model_type == model_type.to_origin_model_type(),
            )
            credential_record = session.execute(stmt).scalar_one_or_none()
            if not credential_record:
                raise ValueError("Credential record not found.")

            provider_model_record = self._get_custom_model_record(model_type=model_type, model=model, session=session)
            if not provider_model_record:
                raise ValueError("The custom model record not found.")

            provider_model_record.credential_id = credential_record.id
            provider_model_record.updated_at = naive_utc_now()
            session.add(provider_model_record)
            session.commit()

            # clear cache
            provider_model_credentials_cache = ProviderCredentialsCache(
                tenant_id=self.tenant_id,
                identity_id=provider_model_record.id,
                cache_type=ProviderCredentialsCacheType.MODEL,
            )
            provider_model_credentials_cache.delete()

    def delete_custom_model(self, model_type: ModelType, model: str):
        """
        Delete custom model.
        :param model_type: model type
        :param model: model name
        :return:
        """
        with Session(db.engine) as session:
            # get provider model
            provider_model_record = self._get_custom_model_record(model_type=model_type, model=model, session=session)

            # delete provider model
            if provider_model_record:
                session.delete(provider_model_record)
                session.commit()

                provider_model_credentials_cache = ProviderCredentialsCache(
                    tenant_id=self.tenant_id,
                    identity_id=provider_model_record.id,
                    cache_type=ProviderCredentialsCacheType.MODEL,
                )

                provider_model_credentials_cache.delete()

    def _get_provider_model_setting(
        self, model_type: ModelType, model: str, session: Session
    ) -> ProviderModelSetting | None:
        """
        Get provider model setting.
        """
        stmt = select(ProviderModelSetting).where(
            ProviderModelSetting.tenant_id == self.tenant_id,
            ProviderModelSetting.provider_name.in_(self._get_provider_names()),
            ProviderModelSetting.model_type == model_type.to_origin_model_type(),
            ProviderModelSetting.model_name == model,
        )
        return session.execute(stmt).scalars().first()

    def enable_model(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Enable model.
        :param model_type: model type
        :param model: model name
        :return:
        """
        with Session(db.engine) as session:
            model_setting = self._get_provider_model_setting(model_type=model_type, model=model, session=session)

            if model_setting:
                model_setting.enabled = True
                model_setting.updated_at = naive_utc_now()

            else:
                model_setting = ProviderModelSetting(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    model_type=model_type.to_origin_model_type(),
                    model_name=model,
                    enabled=True,
                )
                session.add(model_setting)
            session.commit()

        return model_setting

    def disable_model(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Disable model.
        :param model_type: model type
        :param model: model name
        :return:
        """
        with Session(db.engine) as session:
            model_setting = self._get_provider_model_setting(model_type=model_type, model=model, session=session)

            if model_setting:
                model_setting.enabled = False
                model_setting.updated_at = naive_utc_now()
            else:
                model_setting = ProviderModelSetting(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    model_type=model_type.to_origin_model_type(),
                    model_name=model,
                    enabled=False,
                )
                session.add(model_setting)
            session.commit()

        return model_setting

    def get_provider_model_setting(self, model_type: ModelType, model: str) -> ProviderModelSetting | None:
        """
        Get provider model setting.
        :param model_type: model type
        :param model: model name
        :return:
        """
        with Session(db.engine) as session:
            return self._get_provider_model_setting(model_type=model_type, model=model, session=session)

    def enable_model_load_balancing(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Enable model load balancing.
        :param model_type: model type
        :param model: model name
        :return:
        """

        model_provider_id = ModelProviderID(self.provider.provider)
        provider_names = [self.provider.provider]
        if model_provider_id.is_langgenius():
            provider_names.append(model_provider_id.provider_name)

        with Session(db.engine) as session:
            stmt = select(func.count(LoadBalancingModelConfig.id)).where(
                LoadBalancingModelConfig.tenant_id == self.tenant_id,
                LoadBalancingModelConfig.provider_name.in_(provider_names),
                LoadBalancingModelConfig.model_type == model_type.to_origin_model_type(),
                LoadBalancingModelConfig.model_name == model,
            )
            load_balancing_config_count = session.execute(stmt).scalar() or 0
            if load_balancing_config_count <= 1:
                raise ValueError("Model load balancing configuration must be more than 1.")

            model_setting = self._get_provider_model_setting(model_type=model_type, model=model, session=session)

            if model_setting:
                model_setting.load_balancing_enabled = True
                model_setting.updated_at = naive_utc_now()
            else:
                model_setting = ProviderModelSetting(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    model_type=model_type.to_origin_model_type(),
                    model_name=model,
                    load_balancing_enabled=True,
                )
                session.add(model_setting)
            session.commit()

        return model_setting

    def disable_model_load_balancing(self, model_type: ModelType, model: str) -> ProviderModelSetting:
        """
        Disable model load balancing.
        :param model_type: model type
        :param model: model name
        :return:
        """

        with Session(db.engine) as session:
            model_setting = self._get_provider_model_setting(model_type=model_type, model=model, session=session)

            if model_setting:
                model_setting.load_balancing_enabled = False
                model_setting.updated_at = naive_utc_now()
            else:
                model_setting = ProviderModelSetting(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    model_type=model_type.to_origin_model_type(),
                    model_name=model,
                    load_balancing_enabled=False,
                )
                session.add(model_setting)
            session.commit()

        return model_setting

    def get_model_type_instance(self, model_type: ModelType) -> AIModel:
        """
        Get current model type instance.

        :param model_type: model type
        :return:
        """
        model_provider_factory = ModelProviderFactory(self.tenant_id)

        # Get model instance of LLM
        return model_provider_factory.get_model_type_instance(provider=self.provider.provider, model_type=model_type)

    def get_model_schema(self, model_type: ModelType, model: str, credentials: dict | None) -> AIModelEntity | None:
        """
        Get model schema
        """
        model_provider_factory = ModelProviderFactory(self.tenant_id)
        return model_provider_factory.get_model_schema(
            provider=self.provider.provider, model_type=model_type, model=model, credentials=credentials
        )

    def switch_preferred_provider_type(self, provider_type: ProviderType, session: Session | None = None):
        """
        Switch preferred provider type.
        :param provider_type:
        :return:
        """
        if provider_type == self.preferred_provider_type:
            return

        if provider_type == ProviderType.SYSTEM and not self.system_configuration.enabled:
            return

        def _switch(s: Session):
            stmt = select(TenantPreferredModelProvider).where(
                TenantPreferredModelProvider.tenant_id == self.tenant_id,
                TenantPreferredModelProvider.provider_name.in_(self._get_provider_names()),
            )
            preferred_model_provider = s.execute(stmt).scalars().first()

            if preferred_model_provider:
                preferred_model_provider.preferred_provider_type = provider_type.value
            else:
                preferred_model_provider = TenantPreferredModelProvider(
                    tenant_id=self.tenant_id,
                    provider_name=self.provider.provider,
                    preferred_provider_type=provider_type.value,
                )
                s.add(preferred_model_provider)
            s.commit()

        if session:
            return _switch(session)
        else:
            with Session(db.engine) as session:
                return _switch(session)

    def extract_secret_variables(self, credential_form_schemas: list[CredentialFormSchema]) -> list[str]:
        """
        Extract secret input form variables.

        :param credential_form_schemas:
        :return:
        """
        secret_input_form_variables = []
        for credential_form_schema in credential_form_schemas:
            if credential_form_schema.type == FormType.SECRET_INPUT:
                secret_input_form_variables.append(credential_form_schema.variable)

        return secret_input_form_variables

    def obfuscated_credentials(self, credentials: dict, credential_form_schemas: list[CredentialFormSchema]):
        """
        Obfuscated credentials.

        :param credentials: credentials
        :param credential_form_schemas: credential form schemas
        :return:
        """
        # Get provider credential secret variables
        credential_secret_variables = self.extract_secret_variables(credential_form_schemas)

        # Obfuscate provider credentials
        copy_credentials = credentials.copy()
        for key, value in copy_credentials.items():
            if key in credential_secret_variables:
                copy_credentials[key] = encrypter.obfuscated_token(value)

        return copy_credentials

    def get_provider_model(
        self, model_type: ModelType, model: str, only_active: bool = False
    ) -> ModelWithProviderEntity | None:
        """
        Get provider model.
        :param model_type: model type
        :param model: model name
        :param only_active: return active model only
        :return:
        """
        provider_models = self.get_provider_models(model_type, only_active, model)

        for provider_model in provider_models:
            if provider_model.model == model:
                return provider_model

        return None

    def get_provider_models(
        self, model_type: ModelType | None = None, only_active: bool = False, model: str | None = None
    ) -> list[ModelWithProviderEntity]:
        """
        Get provider models.
        :param model_type: model type
        :param only_active: only active models
        :param model: model name
        :return:
        """
        model_provider_factory = ModelProviderFactory(self.tenant_id)
        provider_schema = model_provider_factory.get_provider_schema(self.provider.provider)

        model_types: list[ModelType] = []
        if model_type:
            model_types.append(model_type)
        else:
            model_types = list(provider_schema.supported_model_types)

        # Group model settings by model type and model
        model_setting_map: defaultdict[ModelType, dict[str, ModelSettings]] = defaultdict(dict)
        for model_setting in self.model_settings:
            model_setting_map[model_setting.model_type][model_setting.model] = model_setting

        if self.using_provider_type == ProviderType.SYSTEM:
            provider_models = self._get_system_provider_models(
                model_types=model_types, provider_schema=provider_schema, model_setting_map=model_setting_map
            )
        else:
            provider_models = self._get_custom_provider_models(
                model_types=model_types,
                provider_schema=provider_schema,
                model_setting_map=model_setting_map,
                model=model,
            )

        if only_active:
            provider_models = [m for m in provider_models if m.status == ModelStatus.ACTIVE]

        # resort provider_models
        # Optimize sorting logic: first sort by provider.position order, then by model_type.value
        # Get the position list for model types (retrieve only once for better performance)
        model_type_positions = {}
        if hasattr(self.provider, "position") and self.provider.position:
            model_type_positions = self.provider.position

        def get_sort_key(model: ModelWithProviderEntity):
            # Get the position list for the current model type
            positions = model_type_positions.get(model.model_type.value, [])

            # If the model name is in the position list, use its index for sorting
            # Otherwise use a large value (list length) to place undefined models at the end
            position_index = positions.index(model.model) if model.model in positions else len(positions)

            # Return composite sort key: (model_type value, model position index)
            return (model.model_type.value, position_index)

        # Sort using the composite sort key
        return sorted(provider_models, key=get_sort_key)

    def _get_system_provider_models(
        self,
        model_types: Sequence[ModelType],
        provider_schema: ProviderEntity,
        model_setting_map: dict[ModelType, dict[str, ModelSettings]],
    ) -> list[ModelWithProviderEntity]:
        """
        Get system provider models.

        :param model_types: model types
        :param provider_schema: provider schema
        :param model_setting_map: model setting map
        :return:
        """
        provider_models = []
        for model_type in model_types:
            for m in provider_schema.models:
                if m.model_type != model_type:
                    continue

                status = ModelStatus.ACTIVE
                if m.model_type in model_setting_map and m.model in model_setting_map[m.model_type]:
                    model_setting = model_setting_map[m.model_type][m.model]
                    if model_setting.enabled is False:
                        status = ModelStatus.DISABLED

                provider_models.append(
                    ModelWithProviderEntity(
                        model=m.model,
                        label=m.label,
                        model_type=m.model_type,
                        features=m.features,
                        fetch_from=m.fetch_from,
                        model_properties=m.model_properties,
                        deprecated=m.deprecated,
                        provider=SimpleModelProviderEntity(self.provider),
                        status=status,
                    )
                )

        if self.provider.provider not in original_provider_configurate_methods:
            original_provider_configurate_methods[self.provider.provider] = []
            for configurate_method in provider_schema.configurate_methods:
                original_provider_configurate_methods[self.provider.provider].append(configurate_method)

        should_use_custom_model = False
        if original_provider_configurate_methods[self.provider.provider] == [ConfigurateMethod.CUSTOMIZABLE_MODEL]:
            should_use_custom_model = True

        for quota_configuration in self.system_configuration.quota_configurations:
            if self.system_configuration.current_quota_type != quota_configuration.quota_type:
                continue

            restrict_models = quota_configuration.restrict_models
            if len(restrict_models) == 0:
                break

            if should_use_custom_model:
                if original_provider_configurate_methods[self.provider.provider] == [
                    ConfigurateMethod.CUSTOMIZABLE_MODEL
                ]:
                    # only customizable model
                    for restrict_model in restrict_models:
                        copy_credentials = (
                            self.system_configuration.credentials.copy()
                            if self.system_configuration.credentials
                            else {}
                        )
                        if restrict_model.base_model_name:
                            copy_credentials["base_model_name"] = restrict_model.base_model_name

                        try:
                            custom_model_schema = self.get_model_schema(
                                model_type=restrict_model.model_type,
                                model=restrict_model.model,
                                credentials=copy_credentials,
                            )
                        except Exception as ex:
                            logger.warning("get custom model schema failed, %s", ex)
                            continue

                        if not custom_model_schema:
                            continue

                        if custom_model_schema.model_type not in model_types:
                            continue

                        status = ModelStatus.ACTIVE
                        if (
                            custom_model_schema.model_type in model_setting_map
                            and custom_model_schema.model in model_setting_map[custom_model_schema.model_type]
                        ):
                            model_setting = model_setting_map[custom_model_schema.model_type][custom_model_schema.model]
                            if model_setting.enabled is False:
                                status = ModelStatus.DISABLED

                        provider_models.append(
                            ModelWithProviderEntity(
                                model=custom_model_schema.model,
                                label=custom_model_schema.label,
                                model_type=custom_model_schema.model_type,
                                features=custom_model_schema.features,
                                fetch_from=FetchFrom.PREDEFINED_MODEL,
                                model_properties=custom_model_schema.model_properties,
                                deprecated=custom_model_schema.deprecated,
                                provider=SimpleModelProviderEntity(self.provider),
                                status=status,
                            )
                        )

            # if llm name not in restricted llm list, remove it
            restrict_model_names = [rm.model for rm in restrict_models]
            for model in provider_models:
                if model.model_type == ModelType.LLM and model.model not in restrict_model_names:
                    model.status = ModelStatus.NO_PERMISSION
                elif not quota_configuration.is_valid:
                    model.status = ModelStatus.QUOTA_EXCEEDED

        return provider_models

    def _get_custom_provider_models(
        self,
        model_types: Sequence[ModelType],
        provider_schema: ProviderEntity,
        model_setting_map: dict[ModelType, dict[str, ModelSettings]],
        model: str | None = None,
    ) -> list[ModelWithProviderEntity]:
        """
        Get custom provider models.

        :param model_types: model types
        :param provider_schema: provider schema
        :param model_setting_map: model setting map
        :return:
        """
        provider_models = []

        credentials = None
        if self.custom_configuration.provider:
            credentials = self.custom_configuration.provider.credentials

        for model_type in model_types:
            if model_type not in self.provider.supported_model_types:
                continue

            for m in provider_schema.models:
                if m.model_type != model_type:
                    continue

                status = ModelStatus.ACTIVE if credentials else ModelStatus.NO_CONFIGURE
                load_balancing_enabled = False
                has_invalid_load_balancing_configs = False
                if m.model_type in model_setting_map and m.model in model_setting_map[m.model_type]:
                    model_setting = model_setting_map[m.model_type][m.model]
                    if model_setting.enabled is False:
                        status = ModelStatus.DISABLED

                    provider_model_lb_configs = [
                        config
                        for config in model_setting.load_balancing_configs
                        if config.credential_source_type != "custom_model"
                    ]

                    load_balancing_enabled = model_setting.load_balancing_enabled
                    # when the user enable load_balancing but available configs are less than 2 display warning
                    has_invalid_load_balancing_configs = load_balancing_enabled and len(provider_model_lb_configs) < 2

                provider_models.append(
                    ModelWithProviderEntity(
                        model=m.model,
                        label=m.label,
                        model_type=m.model_type,
                        features=m.features,
                        fetch_from=m.fetch_from,
                        model_properties=m.model_properties,
                        deprecated=m.deprecated,
                        provider=SimpleModelProviderEntity(self.provider),
                        status=status,
                        load_balancing_enabled=load_balancing_enabled,
                        has_invalid_load_balancing_configs=has_invalid_load_balancing_configs,
                    )
                )

        # custom models
        for model_configuration in self.custom_configuration.models:
            if model_configuration.model_type not in model_types:
                continue
            if model_configuration.unadded_to_model_list:
                continue
            if model and model != model_configuration.model:
                continue
            try:
                custom_model_schema = self.get_model_schema(
                    model_type=model_configuration.model_type,
                    model=model_configuration.model,
                    credentials=model_configuration.credentials,
                )
            except Exception as ex:
                logger.warning("get custom model schema failed, %s", ex)
                continue

            if not custom_model_schema:
                continue

            status = ModelStatus.ACTIVE
            load_balancing_enabled = False
            has_invalid_load_balancing_configs = False
            if (
                custom_model_schema.model_type in model_setting_map
                and custom_model_schema.model in model_setting_map[custom_model_schema.model_type]
            ):
                model_setting = model_setting_map[custom_model_schema.model_type][custom_model_schema.model]
                if model_setting.enabled is False:
                    status = ModelStatus.DISABLED

                custom_model_lb_configs = [
                    config
                    for config in model_setting.load_balancing_configs
                    if config.credential_source_type != "provider"
                ]

                load_balancing_enabled = model_setting.load_balancing_enabled
                # when the user enable load_balancing but available configs are less than 2 display warning
                has_invalid_load_balancing_configs = load_balancing_enabled and len(custom_model_lb_configs) < 2

            if len(model_configuration.available_model_credentials) > 0 and not model_configuration.credentials:
                status = ModelStatus.CREDENTIAL_REMOVED

            provider_models.append(
                ModelWithProviderEntity(
                    model=custom_model_schema.model,
                    label=custom_model_schema.label,
                    model_type=custom_model_schema.model_type,
                    features=custom_model_schema.features,
                    fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
                    model_properties=custom_model_schema.model_properties,
                    deprecated=custom_model_schema.deprecated,
                    provider=SimpleModelProviderEntity(self.provider),
                    status=status,
                    load_balancing_enabled=load_balancing_enabled,
                    has_invalid_load_balancing_configs=has_invalid_load_balancing_configs,
                )
            )

        return provider_models


class ProviderConfigurations(BaseModel):
    """
    Model class for provider configuration dict.
    """

    tenant_id: str
    configurations: dict[str, ProviderConfiguration] = Field(default_factory=dict)

    def __init__(self, tenant_id: str):
        super().__init__(tenant_id=tenant_id)

    def get_models(
        self, provider: str | None = None, model_type: ModelType | None = None, only_active: bool = False
    ) -> list[ModelWithProviderEntity]:
        """
        Get available models.

        If preferred provider type is `system`:
          Get the current **system mode** if provider supported,
          if all system modes are not available (no quota), it is considered to be the **custom credential mode**.
          If there is no model configured in custom mode, it is treated as no_configure.
        system > custom > no_configure

        If preferred provider type is `custom`:
          If custom credentials are configured, it is treated as custom mode.
          Otherwise, get the current **system mode** if supported,
          If all system modes are not available (no quota), it is treated as no_configure.
        custom > system > no_configure

        If real mode is `system`, use system credentials to get models,
          paid quotas > provider free quotas > system free quotas
          include pre-defined models (exclude GPT-4, status marked as `no_permission`).
        If real mode is `custom`, use workspace custom credentials to get models,
          include pre-defined models, custom models(manual append).
        If real mode is `no_configure`, only return pre-defined models from `model runtime`.
          (model status marked as `no_configure` if preferred provider type is `custom` otherwise `quota_exceeded`)
        model status marked as `active` is available.

        :param provider: provider name
        :param model_type: model type
        :param only_active: only active models
        :return:
        """
        all_models = []
        for provider_configuration in self.values():
            if provider and provider_configuration.provider.provider != provider:
                continue

            all_models.extend(provider_configuration.get_provider_models(model_type, only_active))

        return all_models

    def to_list(self) -> list[ProviderConfiguration]:
        """
        Convert to list.

        :return:
        """
        return list(self.values())

    def __getitem__(self, key):
        if "/" not in key:
            key = str(ModelProviderID(key))

        return self.configurations[key]

    def __setitem__(self, key, value):
        self.configurations[key] = value

    def __contains__(self, key):
        if "/" not in key:
            key = str(ModelProviderID(key))
        return key in self.configurations

    def __iter__(self):
        # Return an iterator of (key, value) tuples to match BaseModel's __iter__
        yield from self.configurations.items()

    def values(self) -> Iterator[ProviderConfiguration]:
        return iter(self.configurations.values())

    def get(self, key, default=None) -> ProviderConfiguration | None:
        if "/" not in key:
            key = str(ModelProviderID(key))

        return self.configurations.get(key, default)


class ProviderModelBundle(BaseModel):
    """
    Provider model bundle.
    """

    configuration: ProviderConfiguration
    model_type_instance: AIModel

    # pydantic configs
    model_config = ConfigDict(arbitrary_types_allowed=True, protected_namespaces=())
