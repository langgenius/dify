"""Construct the API-metered model from JSON config and borrowed services."""

from pydantic import BaseModel, ConfigDict
from pydantic_ai.capabilities import AbstractCapability

from dify_agent.adapters.llm import DifyApiLLMProvider, DifyLLMAdapterModel
from dify_agent.layers.dify_plugin.configs import DifyPluginLLMLayerConfig
from dify_agent.layers.execution_context.layer import Config as ExecutionContextConfig
from dify_agent.runtime.context import Deps


class Config(DifyPluginLLMLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Capability(AbstractCapability[Deps]):
    def __init__(self, name: str):
        self.id = name
        self.name = name

    def build_model(self, deps: Deps) -> DifyLLMAdapterModel:
        config = Config.model_validate(deps.layers[self.name]["config"])
        if deps.services.dify_api_http_client.is_closed:
            raise RuntimeError("Model execution requires an open Dify API HTTP client.")
        provider = DifyApiLLMProvider(
            plugin_id=config.plugin_id,
            inner_api_url=deps.services.inner_api_url,
            inner_api_key=deps.services.inner_api_key,
            execution_context=ExecutionContextConfig.model_validate(deps.layers[config.execution_context]["config"]),
            agent_run_id=deps.run_id,
            http_client=deps.services.dify_api_http_client,
        )
        return DifyLLMAdapterModel(
            model=config.model,
            dify_provider=provider,
            model_provider=config.model_provider,
            model_settings=config.model_settings,
        )
