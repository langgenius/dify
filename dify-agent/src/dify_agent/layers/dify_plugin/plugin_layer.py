"""Runtime Dify plugin context layer.

The public config identifies tenant/plugin/user context only. Plugin daemon URL,
API key, and timeout are server-side dependencies injected by the layer registry
factory. Each active compositor entry owns an HTTP client in ``LayerControl``
runtime handles; callers pass the control explicitly to ``get_provider`` so
shared layer instances never store or discover session-local clients implicitly.
"""

from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ConfigDict
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, LayerControl, LifecycleState, NoLayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyPluginDaemonProvider
from dify_agent.layers.dify_plugin.configs import DifyPluginLayerConfig


class DifyPluginRuntimeHandles(BaseModel):
    """Live per-entry handles for Dify plugin daemon access."""

    http_client: httpx.AsyncClient | None = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True, arbitrary_types_allowed=True)


@dataclass(slots=True)
class DifyPluginLayer(PlainLayer[NoLayerDeps, DifyPluginLayerConfig, EmptyRuntimeState, DifyPluginRuntimeHandles]):
    """Layer that owns plugin daemon connection state for one active session."""

    type_id = "dify.plugin"

    config: DifyPluginLayerConfig
    daemon_url: str
    daemon_api_key: str
    timeout: float | httpx.Timeout | None = 600.0

    @classmethod
    @override
    def from_config(cls, config: DifyPluginLayerConfig) -> Self:
        """Reject construction without server-injected daemon settings."""
        del config
        raise TypeError("DifyPluginLayer requires server-side daemon settings and must use a registry factory.")

    @classmethod
    def from_config_with_settings(
        cls,
        config: DifyPluginLayerConfig,
        *,
        daemon_url: str,
        daemon_api_key: str,
        timeout: float | httpx.Timeout | None,
    ) -> Self:
        """Create a plugin layer from public config plus server-only daemon settings."""
        return cls(config=config, daemon_url=daemon_url, daemon_api_key=daemon_api_key, timeout=timeout)

    def get_provider(
        self,
        control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles],
        *,
        plugin_provider: str,
    ) -> DifyPluginDaemonProvider:
        """Return a provider backed by ``control``'s active HTTP client.

        Raises:
            RuntimeError: if ``control`` is not active or its HTTP client is
                absent/closed.
        """
        client = control.runtime_handles.http_client
        if control.state is not LifecycleState.ACTIVE or client is None or client.is_closed:
            raise RuntimeError("DifyPluginLayer.get_provider() requires an entered control with an open HTTP client.")
        return DifyPluginDaemonProvider(
            tenant_id=self.config.tenant_id,
            plugin_id=self.config.plugin_id,
            plugin_provider=plugin_provider,
            plugin_daemon_url=self.daemon_url,
            plugin_daemon_api_key=self.daemon_api_key,
            user_id=self.config.user_id,
            timeout=self.timeout,
            http_client=client,
        )

    @override
    async def on_context_create(
        self,
        control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles],
    ) -> None:
        await self._open_http_client(control)

    @override
    async def on_context_resume(
        self,
        control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles],
    ) -> None:
        await self._open_http_client(control)

    @override
    async def on_context_suspend(
        self,
        control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles],
    ) -> None:
        await self._close_http_client(control)

    @override
    async def on_context_delete(
        self,
        control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles],
    ) -> None:
        await self._close_http_client(control)

    async def _open_http_client(self, control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles]) -> None:
        if control.runtime_handles.http_client is None or control.runtime_handles.http_client.is_closed:
            control.runtime_handles.http_client = httpx.AsyncClient(timeout=self.timeout, trust_env=False)

    async def _close_http_client(self, control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles]) -> None:
        client = control.runtime_handles.http_client
        control.runtime_handles.http_client = None
        if client is not None:
            await client.aclose()

__all__ = ["DifyPluginLayer", "DifyPluginRuntimeHandles"]
