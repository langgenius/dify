from __future__ import annotations

from typing import Any

from core.app.entities.app_invoke_entities import ModelConfigWithCredentialsEntity
from core.errors.error import ProviderTokenNotInitError
from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.provider_manager import ProviderManager
from core.workflow.nodes.llm.entities import ModelConfig
from core.workflow.nodes.llm.exc import LLMModeRequiredError, ModelNotExistError
from core.workflow.nodes.llm.protocols import CredentialsProvider, ModelFactory


class DifyCredentialsProvider:
    tenant_id: str
    provider_manager: ProviderManager

    def __init__(self, tenant_id: str, provider_manager: ProviderManager | None = None) -> None:
        self.tenant_id = tenant_id
        self.provider_manager = provider_manager or ProviderManager()

    def fetch(self, provider_name: str, model_name: str) -> dict[str, Any]:
        provider_configurations = self.provider_manager.get_configurations(self.tenant_id)
        provider_configuration = provider_configurations.get(provider_name)
        if not provider_configuration:
            raise ValueError(f"Provider {provider_name} does not exist.")

        provider_model = provider_configuration.get_provider_model(model_type=ModelType.LLM, model=model_name)
        if provider_model is None:
            raise ModelNotExistError(f"Model {model_name} not exist.")
        provider_model.raise_for_status()

        credentials = provider_configuration.get_current_credentials(model_type=ModelType.LLM, model=model_name)
        if credentials is None:
            raise ProviderTokenNotInitError(f"Model {model_name} credentials is not initialized.")

        return credentials


class DifyModelFactory:
    tenant_id: str
    model_manager: ModelManager

    def __init__(self, tenant_id: str, model_manager: ModelManager | None = None) -> None:
        self.tenant_id = tenant_id
        self.model_manager = model_manager or ModelManager()

    def init_model_instance(self, provider_name: str, model_name: str) -> ModelInstance:
        return self.model_manager.get_model_instance(
            tenant_id=self.tenant_id,
            provider=provider_name,
            model_type=ModelType.LLM,
            model=model_name,
        )


def build_dify_model_access(tenant_id: str) -> tuple[CredentialsProvider, ModelFactory]:
    return (
        DifyCredentialsProvider(tenant_id=tenant_id),
        DifyModelFactory(tenant_id=tenant_id),
    )


def fetch_model_config(
    *,
    node_data_model: ModelConfig,
    credentials_provider: CredentialsProvider,
    model_factory: ModelFactory,
) -> tuple[ModelInstance, ModelConfigWithCredentialsEntity]:
    if not node_data_model.mode:
        raise LLMModeRequiredError("LLM mode is required.")

    credentials = credentials_provider.fetch(node_data_model.provider, node_data_model.name)
    model_instance = model_factory.init_model_instance(node_data_model.provider, node_data_model.name)
    provider_model_bundle = model_instance.provider_model_bundle

    provider_model = provider_model_bundle.configuration.get_provider_model(
        model=node_data_model.name,
        model_type=ModelType.LLM,
    )
    if provider_model is None:
        raise ModelNotExistError(f"Model {node_data_model.name} not exist.")
    provider_model.raise_for_status()

    stop: list[str] = []
    if "stop" in node_data_model.completion_params:
        stop = node_data_model.completion_params.pop("stop")

    model_schema = model_instance.model_type_instance.get_model_schema(node_data_model.name, credentials)
    if not model_schema:
        raise ModelNotExistError(f"Model {node_data_model.name} not exist.")

    return model_instance, ModelConfigWithCredentialsEntity(
        provider=node_data_model.provider,
        model=node_data_model.name,
        model_schema=model_schema,
        mode=node_data_model.mode,
        provider_model_bundle=provider_model_bundle,
        credentials=credentials,
        parameters=node_data_model.completion_params,
        stop=stop,
    )
