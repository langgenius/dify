"""Dify identity module; clients and transport settings remain lifespan-owned."""

import httpx
from pydantic import BaseModel, ConfigDict
from pydantic_ai.capabilities import AbstractCapability

from dify_agent.layers.execution_context.configs import DifyExecutionContextLayerConfig
from dify_agent.layers.dify_plugin.tool_client import DifyPluginDaemonToolClient
from dify_agent.runtime.context import Deps


class Config(DifyExecutionContextLayerConfig):
    pass


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Capability(AbstractCapability[Deps]):
    def __init__(self, name: str):
        self.id = name
        self.name = name

    @staticmethod
    def create_tool_client(
        deps: Deps, name: str, *, plugin_id: str, http_client: httpx.AsyncClient
    ) -> DifyPluginDaemonToolClient:
        if http_client.is_closed:
            raise RuntimeError("Plugin tool invocation requires an open shared HTTP client.")
        config = Config.model_validate(deps.layers[name]["config"])
        return DifyPluginDaemonToolClient(
            tenant_id=config.tenant_id,
            plugin_id=plugin_id,
            plugin_daemon_url=deps.services.plugin_daemon_url,
            plugin_daemon_api_key=deps.services.plugin_daemon_api_key,
            user_id=config.user_id,
            http_client=http_client,
        )
