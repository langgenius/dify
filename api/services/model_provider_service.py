import json
import logging
from typing import Any, Optional

from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, ProviderModelWithStatusEntity
from core.model_runtime.entities.model_entities import ModelType, ParameterRule
from core.model_runtime.model_providers.model_provider_factory import ModelProviderFactory
from core.provider_manager import ProviderManager
from models.model import App
from models.provider import ProviderType
from models.workflow import Workflow
from services.entities.model_provider_entities import (
    CustomConfigurationResponse,
    CustomConfigurationStatus,
    DefaultModelResponse,
    ModelWithProviderEntityResponse,
    ProviderResponse,
    ProviderWithModelsResponse,
    SimpleProviderEntityResponse,
    SystemConfigurationResponse,
)

logger = logging.getLogger(__name__)


class ModelProviderService:
    """
    Model Provider Service
    """

    def __init__(self) -> None:
        self.provider_manager = ProviderManager()

    def get_provider_list(self, tenant_id: str, model_type: Optional[str] = None) -> list[ProviderResponse]:
        """
        get provider list.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        provider_responses = []
        for provider_configuration in provider_configurations.values():
            if model_type:
                model_type_entity = ModelType.value_of(model_type)
                if model_type_entity not in provider_configuration.provider.supported_model_types:
                    continue

            provider_response = ProviderResponse(
                tenant_id=tenant_id,
                provider=provider_configuration.provider.provider,
                label=provider_configuration.provider.label,
                description=provider_configuration.provider.description,
                icon_small=provider_configuration.provider.icon_small,
                icon_large=provider_configuration.provider.icon_large,
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
                    else CustomConfigurationStatus.NO_CONFIGURE
                ),
                system_configuration=SystemConfigurationResponse(
                    enabled=provider_configuration.system_configuration.enabled,
                    current_quota_type=provider_configuration.system_configuration.current_quota_type,
                    quota_configurations=provider_configuration.system_configuration.quota_configurations,
                ),
            )

            provider_responses.append(provider_response)

        return provider_responses

    def get_models_by_provider(self, tenant_id: str, provider: str) -> list[ModelWithProviderEntityResponse]:
        """
        get provider models.
        For the model provider page,
        only supports passing in a single provider to query the list of supported models.

        :param tenant_id:
        :param provider:
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider available models
        return [
            ModelWithProviderEntityResponse(tenant_id=tenant_id, model=model)
            for model in provider_configurations.get_models(provider=provider)
        ]

    def _process_workflow_models_generic(self, workflow, app, provider, provider_short_name, callback):
        """Generic workflow model processing that accepts a callback for adding references."""
        try:
            if not workflow.graph:
                return

            graph_data = json.loads(workflow.graph)
            nodes = graph_data.get("nodes", [])

            for node in nodes:
                node_data = node.get("data", {})
                node_type = node_data.get("type", "")

                # Check if this node uses models (LLM, agent, etc.)
                if node_type in ["llm", "agent", "question-classifier", "parameter-extractor"]:
                    model_config = node_data.get("model", {})
                    node_provider = model_config.get("provider", "")
                    model_name = model_config.get("name", "")
                    model_mode = model_config.get("mode", "chat")

                    # Support both full and short provider names
                    node_provider_short = node_provider.split("/")[-1] if "/" in node_provider else node_provider

                    # If this node uses the specified provider
                    provider_matches = {provider, provider_short_name, node_provider_short}
                    if node_provider in provider_matches and model_name:
                        callback(
                            model_name,
                            model_mode,
                            workflow,
                            app,
                            node_data.get("title", "Untitled Node"),
                            "workflow",
                        )

        except (json.JSONDecodeError, KeyError, AttributeError) as e:
            logger.warning("Error parsing workflow graph for workflow %s: %s", workflow.id, e)

    def _process_chat_app_models_generic(self, app, provider, provider_short_name, callback):
        """Generic chat app model processing that accepts a callback for adding references."""
        try:
            # Check if app has model configuration
            if hasattr(app, "app_model_config") and app.app_model_config:
                model_config_data = app.app_model_config
                if hasattr(model_config_data, "model") and model_config_data.model:
                    model_dict = model_config_data.model

                    # Parse JSON string if needed
                    if isinstance(model_dict, str):
                        try:
                            model_dict = json.loads(model_dict)
                        except (json.JSONDecodeError, ValueError) as e:
                            logger.warning("Failed to parse model dict for app %s: %s", app.id, e)
                            return

                    # Ensure model_dict is a dictionary
                    if not isinstance(model_dict, dict):
                        logger.warning("model_dict is not a dictionary for app %s, got %s", app.id, type(model_dict))
                        return

                    node_provider = model_dict.get("provider", "")
                    model_name = model_dict.get("name", "")
                    model_mode = model_dict.get("mode", "chat")

                    # Support both full and short provider names
                    node_provider_short = node_provider.split("/")[-1] if "/" in node_provider else node_provider

                    # If this app uses the specified provider
                    provider_matches = {provider, provider_short_name, node_provider_short}
                    if node_provider in provider_matches and model_name:
                        callback(model_name, model_mode, None, app, app.name, "chat_app")

        except (AttributeError, KeyError) as e:
            logger.warning("Error processing chat app model config for app %s: %s", app.id, e)

    def get_provider_credentials(self, tenant_id: str, provider: str) -> Optional[dict]:
        """
        get provider credentials.
        """
        provider_configurations = self.provider_manager.get_configurations(tenant_id)
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        return provider_configuration.get_custom_credentials(obfuscated=True)

    def provider_credentials_validate(self, tenant_id: str, provider: str, credentials: dict) -> None:
        """
        validate provider credentials.

        :param tenant_id:
        :param provider:
        :param credentials:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        provider_configuration.custom_credentials_validate(credentials)

    def save_provider_credentials(self, tenant_id: str, provider: str, credentials: dict) -> None:
        """
        save custom provider config.

        :param tenant_id: workspace id
        :param provider: provider name
        :param credentials: provider credentials
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Add or update custom provider credentials.
        provider_configuration.add_or_update_custom_credentials(credentials)

    def remove_provider_credentials(self, tenant_id: str, provider: str) -> None:
        """
        remove custom provider config.

        :param tenant_id: workspace id
        :param provider: provider name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Remove custom provider credentials.
        provider_configuration.delete_custom_credentials()

    def get_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str) -> Optional[dict]:
        """
        get model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Get model custom credentials from ProviderModel if exists
        return provider_configuration.get_custom_model_credentials(
            model_type=ModelType.value_of(model_type), model=model, obfuscated=True
        )

    def model_credentials_validate(
        self, tenant_id: str, provider: str, model_type: str, model: str, credentials: dict
    ) -> None:
        """
        validate model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Validate model credentials
        provider_configuration.custom_model_credentials_validate(
            model_type=ModelType.value_of(model_type), model=model, credentials=credentials
        )

    def save_model_credentials(
        self, tenant_id: str, provider: str, model_type: str, model: str, credentials: dict
    ) -> None:
        """
        save model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :param credentials: model credentials
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Add or update custom model credentials
        provider_configuration.add_or_update_custom_model_credentials(
            model_type=ModelType.value_of(model_type), model=model, credentials=credentials
        )

    def remove_model_credentials(self, tenant_id: str, provider: str, model_type: str, model: str) -> None:
        """
        remove model credentials.

        :param tenant_id: workspace id
        :param provider: provider name
        :param model_type: model type
        :param model: model name
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Remove custom model credentials
        provider_configuration.delete_custom_model_credentials(model_type=ModelType.value_of(model_type), model=model)

    def get_models_by_model_type(self, tenant_id: str, model_type: str) -> list[ProviderWithModelsResponse]:
        """
        get models by model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider available models
        models = provider_configurations.get_models(model_type=ModelType.value_of(model_type))

        # Group models by provider
        provider_models: dict[str, list[ModelWithProviderEntity]] = {}
        for model in models:
            if model.provider.provider not in provider_models:
                provider_models[model.provider.provider] = []

            if model.deprecated:
                continue

            if model.status != ModelStatus.ACTIVE:
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
                    icon_large=first_model.provider.icon_large,
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
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # fetch credentials
        credentials = provider_configuration.get_current_credentials(model_type=ModelType.LLM, model=model)

        if not credentials:
            return []

        model_schema = provider_configuration.get_model_schema(
            model_type=ModelType.LLM, model=model, credentials=credentials
        )

        return model_schema.parameter_rules if model_schema else []

    def get_default_model_of_model_type(self, tenant_id: str, model_type: str) -> Optional[DefaultModelResponse]:
        """
        get default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :return:
        """
        model_type_enum = ModelType.value_of(model_type)

        try:
            result = self.provider_manager.get_default_model(tenant_id=tenant_id, model_type=model_type_enum)
            return (
                DefaultModelResponse(
                    model=result.model,
                    model_type=result.model_type,
                    provider=SimpleProviderEntityResponse(
                        tenant_id=tenant_id,
                        provider=result.provider.provider,
                        label=result.provider.label,
                        icon_small=result.provider.icon_small,
                        icon_large=result.provider.icon_large,
                        supported_model_types=result.provider.supported_model_types,
                    ),
                )
                if result
                else None
            )
        except Exception as e:
            logger.debug("get_default_model_of_model_type error: %s", e)
            return None

    def update_default_model_of_model_type(self, tenant_id: str, model_type: str, provider: str, model: str) -> None:
        """
        update default model of model type.

        :param tenant_id: workspace id
        :param model_type: model type
        :param provider: provider name
        :param model: model name
        :return:
        """
        model_type_enum = ModelType.value_of(model_type)
        self.provider_manager.update_default_model_record(
            tenant_id=tenant_id, model_type=model_type_enum, provider=provider, model=model
        )

    def get_model_provider_icon(
        self, tenant_id: str, provider: str, icon_type: str, lang: str
    ) -> tuple[Optional[bytes], Optional[str]]:
        """
        get model provider icon.

        :param tenant_id: workspace id
        :param provider: provider name
        :param icon_type: icon type (icon_small or icon_large)
        :param lang: language (zh_Hans or en_US)
        :return:
        """
        model_provider_factory = ModelProviderFactory(tenant_id)
        byte_data, mime_type = model_provider_factory.get_provider_icon(provider, icon_type, lang)

        return byte_data, mime_type

    def switch_preferred_provider(self, tenant_id: str, provider: str, preferred_provider_type: str) -> None:
        """
        switch preferred provider.

        :param tenant_id: workspace id
        :param provider: provider name
        :param preferred_provider_type: preferred provider type
        :return:
        """
        # Get all provider configurations of the current workspace
        provider_configurations = self.provider_manager.get_configurations(tenant_id)

        # Convert preferred_provider_type to ProviderType
        preferred_provider_type_enum = ProviderType.value_of(preferred_provider_type)

        # Get provider configuration
        provider_configuration = provider_configurations.get(provider)
        if not provider_configuration:
            raise ValueError(f"Provider {provider} does not exist.")

        # Switch preferred provider type
        provider_configuration.switch_preferred_provider_type(preferred_provider_type_enum)

    def enable_model(self, tenant_id: str, provider: str, model: str, model_type: str) -> None:
        """
        enable model.

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

        # Enable model
        provider_configuration.enable_model(model=model, model_type=ModelType.value_of(model_type))

    def disable_model(self, tenant_id: str, provider: str, model: str, model_type: str) -> None:
        """
        disable model.

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

        # Enable model
        provider_configuration.disable_model(model=model, model_type=ModelType.value_of(model_type))

    def _query_workflows_and_apps(self, tenant_id: str):
        """
        Shared method to query workflows and apps for model usage analysis.
        Returns filtered workflows and chat apps.
        """
        from extensions.ext_database import db

        # Query workflows and apps in the tenant
        workflows_and_apps = (
            db.session.query(Workflow, App)
            .join(App, Workflow.app_id == App.id)
            .filter(
                Workflow.tenant_id == tenant_id,
                App.tenant_id == tenant_id,
                db.or_(
                    Workflow.version == "draft",
                    Workflow.version != "draft",
                ),
            )
            .all()
        )

        # Also query chat applications without workflows
        chat_apps = (
            db.session.query(App)
            .filter(App.tenant_id == tenant_id, App.mode.in_(["chat", "agent-chat", "completion"]))
            .all()
        )

        # Filter workflows to keep only latest published version per app (plus drafts)
        filtered_workflows_and_apps = []
        app_latest_versions: dict[str, Any] = {}

        # First pass: collect all workflows grouped by app_id
        for workflow, app in workflows_and_apps:
            app_id = workflow.app_id
            if app_id not in app_latest_versions:
                app_latest_versions[app_id] = {"draft": None, "published": []}

            if workflow.version == "draft":
                app_latest_versions[app_id]["draft"] = (workflow, app)
            else:
                app_latest_versions[app_id]["published"].append((workflow, app))

        # Second pass: add draft and latest published version for each app
        for app_id, versions in app_latest_versions.items():
            if versions["draft"]:
                filtered_workflows_and_apps.append(versions["draft"])
            if versions["published"]:
                latest_published = max(versions["published"], key=lambda x: x[0].created_at)
                filtered_workflows_and_apps.append(latest_published)

        return filtered_workflows_and_apps, chat_apps

    def get_model_references(self, tenant_id: str, provider: str) -> dict:
        """
        Get model references for a specific provider.
        Returns all models from the provider and their usage in workflows and chat apps.
        """
        provider_short_name = provider.split("/")[-1] if "/" in provider else provider
        logger.info("Searching model references for provider: %s (short name: %s)", provider, provider_short_name)

        # Use shared query method
        filtered_workflows_and_apps, chat_apps = self._query_workflows_and_apps(tenant_id)

        logger.info(
            "Found %d workflows (after filtering) and %d chat apps to analyze",
            len(filtered_workflows_and_apps),
            len(chat_apps),
        )

        # Dictionary to store model references
        model_references: dict[str, dict[str, Any]] = {}

        # Process workflow applications
        for workflow, app in filtered_workflows_and_apps:
            self._process_workflow_models(workflow, app, provider, provider_short_name, model_references)

        # Process chat applications
        for app in chat_apps:
            self._process_chat_app_models(app, provider, provider_short_name, model_references)

        # Convert to list format for easier frontend consumption
        result = []
        for model_data in model_references.values():
            if model_data["workflows"]:  # Only include models that are actually used
                result.append(model_data)

        logger.info("Found %d models with references for provider %s", len(result), provider)

        return {
            "provider": provider,
            "models": result,
            "total_models": len(result),
            "total_workflows": sum(len(model["workflows"]) for model in result),
        }

    def _process_workflow_models(self, workflow, app, provider, provider_short_name, model_references):
        """Process models from workflow graph data."""

        def add_model_reference(model_name, model_mode, workflow, app, node_title, app_type):
            self._add_model_reference(model_references, model_name, model_mode, workflow, app, node_title, app_type)

        # Delegate to shared generic processing method
        self._process_workflow_models_generic(workflow, app, provider, provider_short_name, add_model_reference)

    def _process_chat_app_models(self, app, provider, provider_short_name, model_references):
        """Process models from chat application model_config."""

        def add_model_reference(model_name, model_mode, workflow, app, node_title, app_type):
            self._add_model_reference(model_references, model_name, model_mode, workflow, app, node_title, app_type)

        # Delegate to shared generic processing method
        self._process_chat_app_models_generic(app, provider, provider_short_name, add_model_reference)

    def _add_model_reference(self, model_references, model_name, model_mode, workflow, app, node_title, app_type):
        """Add a model reference to the collection."""
        model_key = f"{model_name}_{model_mode}"

        if model_key not in model_references:
            model_references[model_key] = {
                "model_name": model_name,
                "model_mode": model_mode,
                "model_type": "text-generation",  # Default type
                "workflows": [],
            }

        # Add workflow/app info - simplified to only show app name
        workflow_info = {
            "workflow_id": str(workflow.id) if workflow else None,
            "app_id": str(app.id),
            "app_name": app.name,
            "workflow_name": app.name,  # Simplified to use app name
            "node_title": node_title,
            "app_type": app_type,
        }

        # Avoid duplicates - group by app_id for the same model
        # Since we only show app names, no need to combine workflow names
        existing_for_app = None
        for existing_workflow in model_references[model_key]["workflows"]:
            if existing_workflow["app_id"] == workflow_info["app_id"]:
                existing_for_app = existing_workflow
                break

        if not existing_for_app:
            # New app for this model
            model_references[model_key]["workflows"].append(workflow_info)
