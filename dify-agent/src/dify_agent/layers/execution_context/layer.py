"""Runtime Dify execution-context layer.

The public config carries Dify-owned execution identifiers plus the tenant/user
daemon context needed by plugin-backed business layers. Server-only daemon URL
and API key are injected by the provider factory. The layer is intentionally
config/settings-only under Agenton's state-only core: it does not open, cache,
close, or snapshot HTTP clients, and its lifecycle hooks remain the inherited
no-op hooks. Runtime code passes the FastAPI lifespan-owned shared
``httpx.AsyncClient`` into ``create_daemon_provider`` or ``create_tool_client``
for each invocation.
"""

from dataclasses import dataclass
from typing import ClassVar

import httpx
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, NoLayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyPluginDaemonProvider
from dify_agent.layers.dify_plugin.tool_client import DifyPluginDaemonToolClient
from dify_agent.layers.execution_context.configs import (
    DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID,
    DifyExecutionContextLayerConfig,
)


@dataclass(slots=True)
class DifyExecutionContextLayer(PlainLayer[NoLayerDeps, DifyExecutionContextLayerConfig, EmptyRuntimeState]):
    """Layer that carries Dify execution context without owning live resources."""

    type_id: ClassVar[str] = DIFY_EXECUTION_CONTEXT_LAYER_TYPE_ID

    config: DifyExecutionContextLayerConfig
    daemon_url: str
    daemon_api_key: str

    @classmethod
    @override
    def from_config(cls, config: DifyExecutionContextLayerConfig) -> Self:
        """Reject construction without server-injected daemon settings."""
        del config
        raise TypeError(
            "DifyExecutionContextLayer requires server-side daemon settings and must use a provider factory."
        )

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyExecutionContextLayerConfig,
        *,
        daemon_url: str,
        daemon_api_key: str,
    ) -> Self:
        """Create the layer from public config plus server-only daemon settings."""
        return cls(config=config, daemon_url=daemon_url, daemon_api_key=daemon_api_key)

    def create_daemon_provider(self, *, plugin_id: str, http_client: httpx.AsyncClient) -> DifyPluginDaemonProvider:
        """Return a daemon provider backed by the shared plugin daemon client.

        Raises:
            RuntimeError: if ``http_client`` has already been closed.
        """
        if http_client.is_closed:
            raise RuntimeError(
                "DifyExecutionContextLayer.create_daemon_provider() requires an open shared HTTP client."
            )
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
            raise RuntimeError("DifyExecutionContextLayer.create_tool_client() requires an open shared HTTP client.")
        return DifyPluginDaemonToolClient(
            tenant_id=self.config.tenant_id,
            plugin_id=plugin_id,
            plugin_daemon_url=self.daemon_url,
            plugin_daemon_api_key=self.daemon_api_key,
            user_id=self.config.user_id,
            http_client=http_client,
        )


__all__ = ["DifyExecutionContextLayer"]
