from __future__ import annotations

from typing import TYPE_CHECKING

from graphon.model_runtime.model_providers.model_provider_factory import ModelProviderFactory

from core.plugin.impl.model import PluginModelClient

if TYPE_CHECKING:
    from core.model_manager import ModelManager
    from core.plugin.impl.model_runtime import PluginModelRuntime
    from core.provider_manager import ProviderManager


class PluginModelAssembly:
    """Compose request-scoped model views on top of a single plugin runtime."""

    tenant_id: str
    user_id: str | None
    _model_runtime: PluginModelRuntime | None
    _model_provider_factory: ModelProviderFactory | None
    _provider_manager: ProviderManager | None
    _model_manager: ModelManager | None

    def __init__(self, *, tenant_id: str, user_id: str | None = None) -> None:
        self.tenant_id = tenant_id
        self.user_id = user_id
        self._model_runtime = None
        self._model_provider_factory = None
        self._provider_manager = None
        self._model_manager = None

    @property
    def model_runtime(self) -> PluginModelRuntime:
        if self._model_runtime is None:
            self._model_runtime = create_plugin_model_runtime(tenant_id=self.tenant_id, user_id=self.user_id)
        return self._model_runtime

    @property
    def model_provider_factory(self) -> ModelProviderFactory:
        if self._model_provider_factory is None:
            self._model_provider_factory = ModelProviderFactory(model_runtime=self.model_runtime)
        return self._model_provider_factory

    @property
    def provider_manager(self) -> ProviderManager:
        if self._provider_manager is None:
            from core.provider_manager import ProviderManager

            self._provider_manager = ProviderManager(model_runtime=self.model_runtime)
        return self._provider_manager

    @property
    def model_manager(self) -> ModelManager:
        if self._model_manager is None:
            from core.model_manager import ModelManager

            self._model_manager = ModelManager(provider_manager=self.provider_manager)
        return self._model_manager


def create_plugin_model_assembly(*, tenant_id: str, user_id: str | None = None) -> PluginModelAssembly:
    """Create a request-scoped assembly that shares one plugin runtime across model views."""
    return PluginModelAssembly(tenant_id=tenant_id, user_id=user_id)


def create_plugin_model_runtime(*, tenant_id: str, user_id: str | None = None) -> PluginModelRuntime:
    """Create a plugin runtime with its client dependency fully composed."""
    from core.plugin.impl.model_runtime import PluginModelRuntime

    return PluginModelRuntime(
        tenant_id=tenant_id,
        user_id=user_id,
        client=PluginModelClient(),
    )


def create_plugin_model_provider_factory(*, tenant_id: str, user_id: str | None = None) -> ModelProviderFactory:
    """Create a tenant-bound model provider factory for service flows."""
    return create_plugin_model_assembly(tenant_id=tenant_id, user_id=user_id).model_provider_factory


def create_plugin_provider_manager(*, tenant_id: str, user_id: str | None = None) -> ProviderManager:
    """Create a tenant-bound provider manager for service flows."""
    return create_plugin_model_assembly(tenant_id=tenant_id, user_id=user_id).provider_manager


def create_plugin_model_manager(*, tenant_id: str, user_id: str | None = None) -> ModelManager:
    """Create a tenant-bound model manager for service flows."""
    return create_plugin_model_assembly(tenant_id=tenant_id, user_id=user_id).model_manager
