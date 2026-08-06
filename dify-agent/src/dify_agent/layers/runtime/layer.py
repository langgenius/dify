"""Agenton layer exposing one operation-scoped RuntimeLease."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import ClassVar

from agenton.layers import EmptyRuntimeState, NoLayerDeps, PlainLayer
from typing_extensions import Self, override

from dify_agent.layers.runtime.configs import DIFY_RUNTIME_LAYER_TYPE_ID, DifyRuntimeLayerConfig
from dify_agent.runtime_backend import ExecutionBindingBackend, RuntimeLease
from dify_agent.runtime_backend.leases import open_runtime_lease


@dataclass(slots=True)
class DifyRuntimeLayer(PlainLayer[NoLayerDeps, DifyRuntimeLayerConfig, EmptyRuntimeState]):
    """Acquire/release a Binding without owning its product lifecycle."""

    type_id: ClassVar[str | None] = DIFY_RUNTIME_LAYER_TYPE_ID
    config: DifyRuntimeLayerConfig
    backend: ExecutionBindingBackend
    _lease: RuntimeLease | None = field(default=None, init=False)

    @classmethod
    @override
    def from_config(cls, config: DifyRuntimeLayerConfig) -> Self:
        del config
        raise TypeError("DifyRuntimeLayer requires a server-injected ExecutionBindingBackend")

    @classmethod
    def from_config_with_backend(
        cls,
        config: DifyRuntimeLayerConfig,
        *,
        backend: ExecutionBindingBackend,
    ) -> Self:
        return cls(config=DifyRuntimeLayerConfig.model_validate(config), backend=backend)

    @property
    def lease(self) -> RuntimeLease:
        if self._lease is None:
            raise RuntimeError("DifyRuntimeLayer lease is only available inside resource_context()")
        return self._lease

    @override
    @asynccontextmanager
    async def resource_context(self) -> AsyncGenerator[None]:
        if self._lease is not None:
            raise RuntimeError("DifyRuntimeLayer resource_context() is already active")
        async with open_runtime_lease(self.backend, self.config.backend_binding_ref) as lease:
            self._lease = lease
            try:
                yield
            finally:
                self._lease = None

    @override
    async def on_context_create(self) -> None:
        _ = self.lease

    @override
    async def on_context_resume(self) -> None:
        _ = self.lease

    @override
    async def on_context_suspend(self) -> None:
        _ = self.lease

    @override
    async def on_context_delete(self) -> None:
        _ = self.lease


__all__ = ["DifyRuntimeLayer"]
