"""Runtime Dify plugin context layer.

The public config identifies shared tenant/user daemon context only. Plugin
daemon URL and API key are server-side settings injected by the provider
factory. Concrete plugin ids belong to the LLM and tools layers that actually
invoke the daemon. The layer is intentionally config/settings-only under
Agenton's state-only core: it does not open, cache, close, or snapshot HTTP
clients, and its lifecycle hooks remain the inherited no-op hooks. Runtime code
passes the FastAPI lifespan-owned shared ``httpx.AsyncClient`` into
``create_daemon_provider`` or ``create_tool_client`` for each invocation.
"""

from dataclasses import dataclass

import httpx
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, NoLayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyPluginDaemonProvider
from dify_agent.layers.dify_plugin.configs import DIFY_PLUGIN_LAYER_TYPE_ID, DifyPluginLayerConfig
from dify_agent.layers.dify_plugin.tool_client import DifyPluginDaemonToolClient


@dataclass(slots=True)
class DifyPluginLayer(PlainLayer[NoLayerDeps, DifyPluginLayerConfig, EmptyRuntimeState]):
    """Layer that carries plugin daemon identity without owning live resources."""

    type_id = DIFY_PLUGIN_LAYER_TYPE_ID

    config: DifyPluginLayerConfig
    daemon_url: str
    daemon_api_key: str

    @classmethod
    @override
    def from_config(cls, config: DifyPluginLayerConfig) -> Self:
        """Reject construction without server-injected daemon settings."""
        del config
        raise TypeError("DifyPluginLayer requires server-side daemon settings and must use a provider factory.")

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyPluginLayerConfig,
        *,
        daemon_url: str,
        daemon_api_key: str,
    ) -> Self:
        """Create a plugin layer from public config plus server-only daemon settings."""
        return cls(config=config, daemon_url=daemon_url, daemon_api_key=daemon_api_key)

    def create_daemon_provider(self, *, plugin_id: str, http_client: httpx.AsyncClient) -> DifyPluginDaemonProvider:
        """Return a daemon provider backed by the shared plugin daemon client.

        Raises:
            RuntimeError: if ``http_client`` has already been closed.
        """
        if http_client.is_closed:
            raise RuntimeError("DifyPluginLayer.create_daemon_provider() requires an open shared HTTP client.")
        return DifyPluginDaemonProvider(
            tenant_id=self.config.tenant_id,
            plugin_id=plugin_id,
            plugin_daemon_url=self.daemon_url,
            plugin_daemon_api_key=self.daemon_api_key,
            user_id=self.config.user_id,
            http_client=http_client,
        )

    def create_tool_client(self, *, plugin_id: str, http_client: httpx.AsyncClient) -> DifyPluginDaemonToolClient:
        """Return a plugin-daemon tool client backed by the shared HTTP client.

        Raises:
            RuntimeError: if ``http_client`` has already been closed.
        """
        if http_client.is_closed:
            raise RuntimeError("DifyPluginLayer.create_tool_client() requires an open shared HTTP client.")
        return DifyPluginDaemonToolClient(
            tenant_id=self.config.tenant_id,
            plugin_id=plugin_id,
            plugin_daemon_url=self.daemon_url,
            plugin_daemon_api_key=self.daemon_api_key,
            user_id=self.config.user_id,
            http_client=http_client,
        )


__all__ = ["DifyPluginLayer"]
