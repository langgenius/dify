"""Runtime Dify plugin context layer.

The public config identifies tenant/plugin/user context only. Plugin daemon URL,
API key, and timeout are server-side dependencies injected by the layer registry
factory. Each active compositor entry owns an HTTP client in ``LayerControl``
runtime handles; ``get_provider`` discovers those handles via a task-local
context variable so shared layer instances never store session-local clients.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar, Token
from dataclasses import dataclass
from typing import cast

import httpx
from pydantic import BaseModel, ConfigDict
from typing_extensions import Self, override

from agenton.layers import EmptyRuntimeState, LayerControl, NoLayerDeps, PlainLayer
from dify_agent.adapters.llm import DifyPluginDaemonProvider
from dify_agent.layers.dify_plugin.configs import DifyPluginLayerConfig


class DifyPluginRuntimeHandles(BaseModel):
    """Live per-entry handles for Dify plugin daemon access."""

    http_client: httpx.AsyncClient | None = None

    model_config = ConfigDict(extra="forbid", validate_assignment=True, arbitrary_types_allowed=True)


_ACTIVE_PLUGIN_HANDLES: ContextVar[dict[int, DifyPluginRuntimeHandles]] = ContextVar(
    "dify_agent_active_plugin_handles",
    default={},
)


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

    @override
    def enter(self, control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles]):
        """Enter the layer and expose active handles through task-local context."""
        return self._enter_with_active_handles(control)

    @asynccontextmanager
    async def _enter_with_active_handles(
        self,
        control: LayerControl[EmptyRuntimeState, DifyPluginRuntimeHandles],
    ) -> AsyncIterator[None]:
        async with self.lifecycle_enter(control):
            token = self._set_active_handles(control.runtime_handles)
            try:
                yield
            finally:
                _ACTIVE_PLUGIN_HANDLES.reset(token)

    def get_provider(self, *, plugin_provider: str) -> DifyPluginDaemonProvider:
        """Return a provider backed by this layer's active HTTP client.

        Raises:
            RuntimeError: if called outside an active compositor context for this
                layer, or after its runtime handles have been closed.
        """
        handles = _ACTIVE_PLUGIN_HANDLES.get().get(id(self))
        if handles is None or handles.http_client is None:
            raise RuntimeError("DifyPluginLayer.get_provider() requires an active compositor context.")
        return DifyPluginDaemonProvider(
            tenant_id=self.config.tenant_id,
            plugin_id=self.config.plugin_id,
            plugin_provider=plugin_provider,
            plugin_daemon_url=self.daemon_url,
            plugin_daemon_api_key=self.daemon_api_key,
            user_id=self.config.user_id,
            timeout=self.timeout,
            http_client=handles.http_client,
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

    def _set_active_handles(self, handles: DifyPluginRuntimeHandles) -> Token[dict[int, DifyPluginRuntimeHandles]]:
        active_handles = dict(_ACTIVE_PLUGIN_HANDLES.get())
        active_handles[id(self)] = handles
        return cast(Token[dict[int, DifyPluginRuntimeHandles]], _ACTIVE_PLUGIN_HANDLES.set(active_handles))


__all__ = ["DifyPluginLayer", "DifyPluginRuntimeHandles"]
