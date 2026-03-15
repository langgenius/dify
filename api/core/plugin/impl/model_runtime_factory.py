from __future__ import annotations

from typing import TYPE_CHECKING

from core.plugin.impl.model import PluginModelClient

if TYPE_CHECKING:
    from core.model_manager import ModelManager
    from core.plugin.impl.model_runtime import PluginModelRuntime
    from core.provider_manager import ProviderManager
    from dify_graph.model_runtime.model_providers.model_provider_factory import ModelProviderFactory


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
    from dify_graph.model_runtime.model_providers.model_provider_factory import ModelProviderFactory

    return ModelProviderFactory(model_runtime=create_plugin_model_runtime(tenant_id=tenant_id, user_id=user_id))


def create_plugin_provider_manager(*, tenant_id: str, user_id: str | None = None) -> ProviderManager:
    """Create a tenant-bound provider manager for service flows."""
    from core.provider_manager import ProviderManager

    return ProviderManager(model_runtime=create_plugin_model_runtime(tenant_id=tenant_id, user_id=user_id))


def create_plugin_model_manager(*, tenant_id: str, user_id: str | None = None) -> ModelManager:
    """Create a tenant-bound model manager for service flows."""
    from core.model_manager import ModelManager

    return ModelManager(
        provider_manager=create_plugin_provider_manager(tenant_id=tenant_id, user_id=user_id),
    )
