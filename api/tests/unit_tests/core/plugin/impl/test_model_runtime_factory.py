from unittest.mock import Mock, patch

from core.plugin.impl.model_runtime_factory import create_plugin_model_assembly


def test_plugin_model_assembly_reuses_single_runtime_across_views():
    runtime = Mock(name="runtime")
    provider_factory = Mock(name="provider_factory")
    provider_manager = Mock(name="provider_manager")
    model_manager = Mock(name="model_manager")

    with (
        patch(
            "core.plugin.impl.model_runtime_factory.create_plugin_model_runtime",
            return_value=runtime,
        ) as mock_runtime_factory,
        patch(
            "core.plugin.impl.model_runtime_factory.ModelProviderFactory",
            return_value=provider_factory,
        ) as mock_provider_factory_cls,
        patch("core.provider_manager.ProviderManager", return_value=provider_manager) as mock_provider_manager_cls,
        patch("core.model_manager.ModelManager", return_value=model_manager) as mock_model_manager_cls,
    ):
        assembly = create_plugin_model_assembly(tenant_id="tenant-1", user_id="user-1")

        assert assembly.model_provider_factory is provider_factory
        assert assembly.provider_manager is provider_manager
        assert assembly.model_manager is model_manager
        assert assembly.model_provider_factory is provider_factory
        assert assembly.provider_manager is provider_manager
        assert assembly.model_manager is model_manager

    mock_runtime_factory.assert_called_once_with(tenant_id="tenant-1", user_id="user-1")
    mock_provider_factory_cls.assert_called_once_with(runtime=runtime)
    mock_provider_manager_cls.assert_called_once_with(model_runtime=runtime)
    mock_model_manager_cls.assert_called_once_with(provider_manager=provider_manager)
