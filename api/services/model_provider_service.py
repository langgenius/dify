import logging
from collections import defaultdict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, func, select

if TYPE_CHECKING:
    from models.account import Account

from configs import dify_config
from core.db.session_factory import session_factory
from core.entities.model_entities import ModelWithProviderEntity, ProviderModelWithStatusEntity
from core.helper.position_helper import is_filtered
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginModelProviderBinding
from core.plugin.impl.model_runtime_factory import create_plugin_model_provider_factory, create_plugin_provider_manager
from core.plugin.plugin_service import PluginService
from core.provider_manager import ProviderManager
from extensions import ext_hosting_provider
from graphon.model_runtime.entities.model_entities import ModelType, ParameterRule
from models.provider import (
    Provider,
    ProviderCredential,
    ProviderModel,
    ProviderModelCredential,
    ProviderType,
    TenantPreferredModelProvider,
)
from models.provider_ids import ModelProviderID
from services.entities.model_provider_entities import (
    CustomConfigurationResponse,
    CustomConfigurationStatus,
    DefaultModelResponse,
    ModelProviderCustomConfigurationSummaryResponse,
    ModelProviderPluginSummaryResponse,
    ModelProviderSummaryResponse,
    ModelProviderSystemConfigurationSummaryResponse,
    ModelWithProviderEntityResponse,
    ProviderResponse,
    ProviderWithModelsResponse,
    SimpleProviderEntityResponse,
    SystemConfigurationResponse,
)
from services.errors.app_model_config import ProviderNotFoundError

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _ProviderSummaryState:
    has_custom_provider: bool = False
    has_credentials: bool = False
    has_custom_models: bool = False
    current_credential_id: str | None = None
    current_credential_name: str | None = None
    current_credential_usable: bool = False
    preferred_provider_type: ProviderType | None = None


class ModelProviderService:
    """
    Model Provider Service
    """

    @staticmethod
    def _get_provider_manager(tenant_id: str) -> ProviderManager:
        return create_plugin_provider_manager(tenant_id=tenant_id)

    def _get_provider_configuration(self, tenant_id: str, provider: str):
        """
        Get provider configuration or raise exception if not found.

        Args:
            tenant_id: Workspace identifier
            provider: Provider name

        Returns:
            Provider configuration instance

        Raises:
            ProviderNotFoundError: If provider doesn't exist
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self._get_provider_manager(tenant_id).get_configurations(tenant_id)
        provider_configuration = provider_configurations.get(provider)

        if not provider_configuration:
            raise ProviderNotFoundError(f"Provider {provider} does not exist.")

        return provider_configuration

    def get_provider_list(self, tenant_id: str, model_type: str | None = None) -> list[ProviderResponse]:
        """
        get provider list.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self._get_provider_manager(tenant_id).get_configurations(tenant_id)

        provider_responses = []
        for provider_configuration in provider_configurations.values():
            if model_type:
                model_type_entity = ModelType(model_type)
                if model_type_entity not in provider_configuration.provider.supported_model_types:
                    continue

            provider_config = provider_configuration.custom_configuration.provider
            models = provider_configuration.custom_configuration.models
            can_added_models = provider_configuration.custom_configuration.can_added_models

            # IMPORTANT: Never expose decrypted credentials in the provider list API.
            # Sanitize custom model configurations by dropping the credentials payload.
            sanitized_model_config = []
            if models:
                from core.entities.provider_entities import CustomModelConfiguration  # local import to avoid cycles

                for model in models:
                    sanitized_model_config.append(
                        CustomModelConfiguration(
                            model=model.model,
                            model_type=model.model_type,
                            credentials=None,  # strip secrets from list view
                            current_credential_id=model.current_credential_id,
                            current_credential_name=model.current_credential_name,
                            available_model_credentials=model.available_model_credentials,
                            unadded_to_model_list=model.unadded_to_model_list,
                        )
                    )

            provider_response = ProviderResponse(
                tenant_id=tenant_id,
                provider=provider_configuration.provider.provider,
                label=provider_configuration.provider.label,
                description=provider_configuration.provider.description,
                icon_small=provider_configuration.provider.icon_small,
                icon_small_dark=provider_configuration.provider.icon_small_dark,
                background=provider_configuration.provider.background,
                help=provider_configuration.provider.help,
                supported_model_types=provider_configuration.provider.supported_model_types,
                configurate_methods=provider_configuration.provider.configurate_methods,
                provider_credential_schema=provider_configuration.provider.provider_credential_schema,
                model_credential_schema=provider_configuration.provider.model_credential_schema,
                preferred_provider_type=provider_configuration.preferred_provider_type,
                custom_configuration=CustomConfigurationResponse(
                    status=CustomConfigurationStatus.ACTIVE
                    if provider_configuration.is_custom_configuration_available()
                    else CustomConfigurationStatus.NO_CONFIGURE,
                    current_credential_id=getattr(provider_config, "current_credential_id", None),
                    current_credential_name=getattr(provider_config, "current_credential_name", None),
                    available_credentials=getattr(provider_config, "available_credentials", []),
                    custom_models=sanitized_model_config,
                    can_added_models=can_added_models,
                ),
                system_configuration=SystemConfigurationResponse(
                    enabled=provider_configuration.system_configuration.enabled,
                    current_quota_type=provider_configuration.system_configuration.current_quota_type,
                    quota_configurations=provider_configuration.system_configuration.quota_configurations,
                ),
            )

            provider_responses.append(provider_response)

        return provider_responses

    @staticmethod
    def _load_provider_summary_states(tenant_id: str) -> dict[str, _ProviderSummaryState]:
        """Load only the workspace columns required by the collapsed provider list."""
        with session_factory.create_session() as session:
            custom_provider_rows = session.execute(
                select(
                    Provider.provider_name,
                    Provider.credential_id,
                    ProviderCredential.provider_name.label("credential_provider_name"),
                    ProviderCredential.credential_name,
                )
                .outerjoin(
                    ProviderCredential,
                    and_(
                        ProviderCredential.id == Provider.credential_id,
                        ProviderCredential.tenant_id == tenant_id,
                    ),
                )
                .where(
                    Provider.tenant_id == tenant_id,
                    Provider.provider_type == ProviderType.CUSTOM,
                    Provider.is_valid.is_(True),
                )
            ).all()
            credential_count_rows = session.execute(
                select(
                    ProviderCredential.provider_name,
                    func.count(ProviderCredential.id).label("credential_count"),
                )
                .where(ProviderCredential.tenant_id == tenant_id)
                .group_by(ProviderCredential.provider_name)
            ).all()
            custom_model_rows = session.execute(
                select(ProviderModel.provider_name.label("provider_name"))
                .where(
                    ProviderModel.tenant_id == tenant_id,
                    ProviderModel.is_valid.is_(True),
                )
                .union(
                    select(ProviderModelCredential.provider_name.label("provider_name")).where(
                        ProviderModelCredential.tenant_id == tenant_id
                    )
                )
            ).all()
            preferred_provider_rows = session.execute(
                select(
                    TenantPreferredModelProvider.provider_name,
                    TenantPreferredModelProvider.preferred_provider_type,
                ).where(TenantPreferredModelProvider.tenant_id == tenant_id)
            ).all()

        states: defaultdict[str, _ProviderSummaryState] = defaultdict(_ProviderSummaryState)
        credential_counts_by_provider: defaultdict[str, int] = defaultdict(int)
        for credential_count in credential_count_rows:
            provider_name = str(ModelProviderID(credential_count.provider_name))
            credential_counts_by_provider[provider_name] += credential_count.credential_count

        selected_provider_priorities: dict[str, bool] = {}
        for provider in custom_provider_rows:
            provider_name = str(ModelProviderID(provider.provider_name))
            state = states[provider_name]
            state.has_custom_provider = True

            is_canonical_row = provider.provider_name == provider_name
            if provider_name in selected_provider_priorities and not is_canonical_row:
                continue
            selected_provider_priorities[provider_name] = is_canonical_row
            state.current_credential_id = provider.credential_id
            if (
                provider.credential_provider_name is not None
                and str(ModelProviderID(provider.credential_provider_name)) == provider_name
            ):
                state.current_credential_name = provider.credential_name
                state.current_credential_usable = True
            else:
                state.current_credential_name = None
                state.current_credential_usable = False

        for provider_name, state in states.items():
            state.has_credentials = state.has_custom_provider and credential_counts_by_provider[provider_name] > 0

        for model in custom_model_rows:
            states[str(ModelProviderID(model.provider_name))].has_custom_models = True

        preferred_provider_priorities: dict[str, bool] = {}
        for preferred_provider in preferred_provider_rows:
            provider_name = str(ModelProviderID(preferred_provider.provider_name))
            is_canonical_row = preferred_provider.provider_name == provider_name
            if provider_name in preferred_provider_priorities and not is_canonical_row:
                continue
            preferred_provider_priorities[provider_name] = is_canonical_row
            states[provider_name].preferred_provider_type = preferred_provider.preferred_provider_type

        return dict(states)

    @staticmethod
    def _is_system_provider_enabled(provider: str) -> bool:
        configuration = ext_hosting_provider.hosting_configuration.provider_map.get(provider)
        return bool(configuration and configuration.enabled and configuration.quotas)

    @staticmethod
    def _select_binding(
        current_binding: PluginModelProviderBinding | None,
        candidate_binding: PluginModelProviderBinding,
    ) -> PluginModelProviderBinding:
        """Prefer a remote-debug runtime when one shadows an installed plugin."""
        if current_binding is None:
            return candidate_binding
        if (
            candidate_binding.source == PluginInstallationSource.Remote
            and current_binding.source != PluginInstallationSource.Remote
        ):
            return candidate_binding
        return current_binding

    @staticmethod
    def _get_preferred_provider_type(
        state: _ProviderSummaryState,
        *,
        custom_present: bool,
        system_enabled: bool,
    ) -> ProviderType:
        if state.preferred_provider_type is not None:
            return state.preferred_provider_type
        if dify_config.EDITION == "CLOUD" and system_enabled:
            return ProviderType.SYSTEM
        if custom_present:
            return ProviderType.CUSTOM
        if system_enabled:
            return ProviderType.SYSTEM
        return ProviderType.CUSTOM

    def get_provider_summary_list(
        self, tenant_id: str, model_type: ModelType | str | None = None
    ) -> tuple[list[ModelProviderSummaryResponse], dict[str, ModelProviderPluginSummaryResponse]]:
        """Build the first-screen provider projection without assembling provider configurations."""
        model_type_entity = ModelType(model_type) if model_type else None

        # Read bindings first: remote-debug identity changes invalidate provider metadata
        # before the provider cache is consulted.
        bindings = PluginService.list_model_provider_bindings(tenant_id)
        provider_entities = PluginService.fetch_plugin_model_providers(tenant_id=tenant_id)
        states = self._load_provider_summary_states(tenant_id)

        bindings_by_provider: dict[str, PluginModelProviderBinding] = {}
        for binding in bindings:
            provider_name = (
                str(ModelProviderID(binding.provider))
                if binding.provider.count("/") == 2
                else str(ModelProviderID(f"{binding.plugin_id}/{binding.provider}"))
            )
            bindings_by_provider[provider_name] = self._select_binding(
                bindings_by_provider.get(provider_name),
                binding,
            )

        provider_summaries: list[ModelProviderSummaryResponse] = []
        emitted_provider_names: set[str] = set()
        for provider_entity in provider_entities:
            if model_type_entity and model_type_entity not in provider_entity.supported_model_types:
                continue
            if is_filtered(
                include_set=dify_config.POSITION_PROVIDER_INCLUDES_SET,
                exclude_set=dify_config.POSITION_PROVIDER_EXCLUDES_SET,
                data=provider_entity,
                name_func=lambda provider: provider.provider,
            ):
                continue

            provider_id = ModelProviderID(provider_entity.provider)
            provider_name = str(provider_id)
            if provider_name in emitted_provider_names:
                continue
            emitted_provider_names.add(provider_name)

            state = states.get(provider_name, _ProviderSummaryState())
            custom_configured = (state.has_custom_provider and state.has_credentials) or state.has_custom_models
            custom_present = state.has_custom_provider or state.has_custom_models
            system_enabled = self._is_system_provider_enabled(provider_name)
            preferred_provider_type = self._get_preferred_provider_type(
                state,
                custom_present=custom_present,
                system_enabled=system_enabled,
            )

            provider_summaries.append(
                ModelProviderSummaryResponse(
                    tenant_id=tenant_id,
                    provider=provider_name,
                    plugin_id=provider_id.plugin_id,
                    label=provider_entity.label,
                    description=provider_entity.description,
                    icon_small=provider_entity.icon_small,
                    icon_small_dark=provider_entity.icon_small_dark,
                    supported_model_types=provider_entity.supported_model_types,
                    configurate_methods=provider_entity.configurate_methods,
                    preferred_provider_type=preferred_provider_type,
                    is_configured=custom_configured or system_enabled,
                    custom_configuration=ModelProviderCustomConfigurationSummaryResponse(
                        status=CustomConfigurationStatus.ACTIVE
                        if custom_configured
                        else CustomConfigurationStatus.NO_CONFIGURE,
                        has_credentials=state.has_credentials,
                        current_credential_id=state.current_credential_id,
                        current_credential_name=state.current_credential_name,
                        current_credential_usable=state.current_credential_usable,
                    ),
                    system_configuration=ModelProviderSystemConfigurationSummaryResponse(
                        enabled=system_enabled,
                    ),
                )
            )

        plugin_bindings: dict[str, PluginModelProviderBinding] = {}
        for binding in bindings_by_provider.values():
            plugin_bindings[binding.plugin_id] = self._select_binding(
                plugin_bindings.get(binding.plugin_id),
                binding,
            )

        plugin_summaries = {
            plugin_id: ModelProviderPluginSummaryResponse(
                installation_id=binding.installation_id,
                plugin_id=binding.plugin_id,
                plugin_unique_identifier=binding.plugin_unique_identifier,
                runtime_type=binding.runtime_type,
                source=binding.source,
                version=binding.version,
            )
            for plugin_id, binding in plugin_bindings.items()
        }
        return provider_summaries, plugin_summaries

    def get_models_by_provider(self, tenant_id: str, provider: str) -> list[ModelWithProviderEntityResponse]:
        """
        get provider models.
        For the model provider page,
        only supports passing in a single provider to query the list of supported models.

        :param tenant_id: workspace id
        :param provider: provider name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self._get_provider_manager(tenant_id).get_configurations(tenant_id)

        # Get provider available models
        return [
            ModelWithProviderEntityResponse(tenant_id=tenant_id, model=model)
            for model in provider_configurations.get_models(provider=provider)
        ]

    def get_provider_available_credentials(self, tenant_id: str, provider: str, user: "Account | None" = None):
        return self._get_provider_manager(tenant_id).get_provider_available_credentials(
            tenant_id=tenant_id,
            provider_name=provider,
            user=user,
        )

    def get_provider_model_available_credentials(
        self,
        tenant_id: str,
        provider: str,
        model_type: str,
        model: str,
    ):
        return self._get_provider_manager(tenant_id).get_provider_model_available_credentials(
            tenant_id=tenant_id,
            provider_name=provider,
            model_type=model_type,
            model_name=model,
        )

    def get_provider_credential(
        self, tenant_id: str, provider: str, credential_id: str | None = None
    ) -> dict[str, Any] | None:
        """
        get provider credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credential_id: credential id, if not provided, return current used credentials
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        return provider_configuration.get_provider_credential(credential_id=credential_id)

    def validate_provider_credentials(self, tenant_id: str, provider: str, credentials: dict[str, Any]):
        """
        validate provider credentials before saving.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials dict
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.validate_provider_credentials(credentials)

    def create_provider_credential(
        self, tenant_id: str, provider: str, credentials: dict[str, Any], credential_name: str | None
    ) -> None:
        """
        Create and save new provider credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials dict
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.create_provider_credential(credentials, credential_name)

    def update_provider_credential(
        self,
        tenant_id: str,
        provider: str,
        credentials: dict[str, Any],
        credential_id: str,
        credential_name: str | None,
    ) -> None:
        """
        update a saved provider credential (by credential_id).

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials dict
        :param credential_id: credential id
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.update_provider_credential(
            credential_id=credential_id,
            credentials=credentials,
            credential_name=credential_name,
        )

    def remove_provider_credential(self, tenant_id: str, provider: str, credential_id: str):
        """
        remove a saved provider credential (by credential_id).
        :param tenant_id: workspace id
        :param provider: provider name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.delete_provider_credential(credential_id=credential_id)

    def switch_active_provider_credential(self, tenant_id: str, provider: str, credential_id: str):
        """
        :param tenant_id: workspace id
        :param provider: provider name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.switch_active_provider_credential(credential_id=credential_id)

    def get_model_credential(
        self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str | None
    ) -> dict[str, Any] | None:
        """
        Retrieve model-specific credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: Optional credential ID, uses current if not provided
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        return provider_configuration.get_custom_model_credential(
            model_type=ModelType(model_type), model=model, credential_id=credential_id
        )

    def validate_model_credentials(
        self, tenant_id: str, provider: str, model_type: str, model: str, credentials: dict[str, Any]
    ):
        """
        validate model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.validate_custom_model_credentials(
            model_type=ModelType(model_type), model=model, credentials=credentials
        )

    def create_model_credential(
        self,
        tenant_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        credential_name: str | None,
    ) -> None:
        """
        create and save model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.create_custom_model_credential(
            model_type=ModelType(model_type),
            model=model,
            credentials=credentials,
            credential_name=credential_name,
        )

    def update_model_credential(
        self,
        tenant_id: str,
        provider: str,
        model_type: str,
        model: str,
        credentials: dict[str, Any],
        credential_id: str,
        credential_name: str | None,
    ) -> None:
        """
        update model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials dict
        :param credential_id: credential id
        :param credential_name: credential name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.update_custom_model_credential(
            model_type=ModelType(model_type),
            model=model,
            credentials=credentials,
            credential_id=credential_id,
            credential_name=credential_name,
        )

    def remove_model_credential(self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str):
        """
        remove model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.delete_custom_model_credential(
            model_type=ModelType(model_type), model=model, credential_id=credential_id
        )

    def switch_active_custom_model_credential(
        self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str
    ):
        """
        switch model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.switch_custom_model_credential(
            model_type=ModelType(model_type), model=model, credential_id=credential_id
        )

    def add_model_credential_to_model_list(
        self, tenant_id: str, provider: str, model_type: str, model: str, credential_id: str
    ):
        """
        add model credentials to model list.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credential_id: credential id
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.add_model_credential_to_model(
            model_type=ModelType(model_type), model=model, credential_id=credential_id
        )

    def remove_model(self, tenant_id: str, provider: str, model_type: str, model: str):
        """
        remove model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.delete_custom_model(model_type=ModelType(model_type), model=model)

    def get_models_by_model_type(self, tenant_id: str, model_type: str) -> list[ProviderWithModelsResponse]:
        """
        get models by model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self._get_provider_manager(tenant_id).get_configurations(tenant_id)

        # Get provider available models
        models = provider_configurations.get_models(model_type=ModelType(model_type), only_active=True)

        # Group models by provider
        provider_models: dict[str, list[ModelWithProviderEntity]] = {}
        for model in models:
            if model.provider.provider not in provider_models:
                provider_models[model.provider.provider] = []

            if model.deprecated:
                continue

            provider_models[model.provider.provider].append(model)

        # convert to ProviderWithModelsResponse list
        providers_with_models: list[ProviderWithModelsResponse] = []
        for provider, models in provider_models.items():
            if not models:
                continue

            first_model = models[0]

            providers_with_models.append(
                ProviderWithModelsResponse(
                    tenant_id=tenant_id,
                    provider=provider,
                    label=first_model.provider.label,
                    icon_small=first_model.provider.icon_small,
                    icon_small_dark=first_model.provider.icon_small_dark,
                    status=CustomConfigurationStatus.ACTIVE,
                    models=[
                        ProviderModelWithStatusEntity(
                            model=model.model,
                            label=model.label,
                            model_type=model.model_type,
                            features=model.features,
                            fetch_from=model.fetch_from,
                            model_properties=model.model_properties,
                            status=model.status,
                            load_balancing_enabled=model.load_balancing_enabled,
                        )
                        for model in models
                    ],
                )
            )

        return providers_with_models

    def get_model_parameter_rules(self, tenant_id: str, provider: str, model: str) -> list[ParameterRule]:
        """
        get model parameter rules.
        Only supports LLM.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)

        # fetch credentials
        credentials = provider_configuration.get_current_credentials(model_type=ModelType.LLM, model=model)

        if not credentials:
            return []

        model_schema = provider_configuration.get_model_schema(
            model_type=ModelType.LLM, model=model, credentials=credentials
        )

        return model_schema.parameter_rules if model_schema else []

    def get_default_model_of_model_type(self, tenant_id: str, model_type: str) -> DefaultModelResponse | None:
        """
        get default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        model_type_enum = ModelType(model_type)

        try:
            result = self._get_provider_manager(tenant_id).get_default_model(
                tenant_id=tenant_id, model_type=model_type_enum
            )
            return (
                DefaultModelResponse(
                    model=result.model,
                    model_type=result.model_type,
                    provider=SimpleProviderEntityResponse(
                        tenant_id=tenant_id,
                        provider=result.provider.provider,
                        label=result.provider.label,
                        icon_small=result.provider.icon_small,
                        supported_model_types=result.provider.supported_model_types,
                    ),
                )
                if result
                else None
            )
        except Exception as e:
            logger.debug("get_default_model_of_model_type error: %s", e)
            return None

    def update_default_model_of_model_type(self, tenant_id: str, model_type: str, provider: str, model: str):
        """
        update default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :param provider: provider name
        :param model: model name
        :return:
        """
        model_type_enum = ModelType(model_type)
        self._get_provider_manager(tenant_id).update_default_model_record(
            tenant_id=tenant_id, model_type=model_type_enum, provider=provider, model=model
        )

    def get_model_provider_icon(
        self, tenant_id: str, provider: str, icon_type: str, lang: str
    ) -> tuple[bytes | None, str | None]:
        """
        get model provider icon.

        :param tenant_id: workspace id
        :param provider: provider name
        :param icon_type: icon type (icon_small or icon_small_dark)
        :param lang: language (zh_Hans or en_US)
        :return:
        """
        model_provider_factory = create_plugin_model_provider_factory(tenant_id=tenant_id)
        byte_data, mime_type = model_provider_factory.get_provider_icon(provider, icon_type, lang)

        return byte_data, mime_type

    def switch_preferred_provider(self, tenant_id: str, provider: str, preferred_provider_type: str):
        """
        switch preferred provider.

        :param tenant_id: workspace id
        :param provider: provider name
        :param preferred_provider_type: preferred provider type
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)

        # Convert preferred_provider_type to ProviderType
        preferred_provider_type_enum = ProviderType.value_of(preferred_provider_type)

        # Switch preferred provider type
        provider_configuration.switch_preferred_provider_type(preferred_provider_type_enum)

    def enable_model(self, tenant_id: str, provider: str, model: str, model_type: str):
        """
        enable model.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.enable_model(model=model, model_type=ModelType(model_type))

    def disable_model(self, tenant_id: str, provider: str, model: str, model_type: str):
        """
        disable model.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model: model name
        :param model_type: model type
        :return:
        """
        provider_configuration = self._get_provider_configuration(tenant_id, provider)
        provider_configuration.disable_model(model=model, model_type=ModelType(model_type))
