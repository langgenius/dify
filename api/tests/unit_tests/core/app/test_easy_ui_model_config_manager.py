from types import SimpleNamespace
from unittest.mock import patch

from graphon.model_runtime.entities.model_entities import ModelPropertyKey

from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
from core.app.app_config.entities import ModelConfigEntity
from models.provider_ids import ModelProviderID


def test_validate_and_set_defaults_reuses_single_model_assembly():
    provider_name = str(ModelProviderID("openai"))
    provider_entity = SimpleNamespace(provider=provider_name)
    model = SimpleNamespace(model="gpt-4o-mini", model_properties={ModelPropertyKey.MODE: "chat"})
    provider_configurations = SimpleNamespace(get_models=lambda **kwargs: [model])
    assembly = SimpleNamespace(
        model_provider_factory=SimpleNamespace(get_providers=lambda: [provider_entity]),
        provider_manager=SimpleNamespace(get_configurations=lambda tenant_id: provider_configurations),
    )
    config = {
        "model": {
            "provider": "openai",
            "name": "gpt-4o-mini",
            "completion_params": {"stop": []},
        }
    }

    with patch(
        "core.app.app_config.easy_ui_based_app.model_config.manager.create_plugin_model_assembly",
        return_value=assembly,
    ) as mock_assembly:
        result, keys = ModelConfigManager.validate_and_set_defaults("tenant-1", config)

    assert result["model"]["provider"] == provider_name
    assert result["model"]["mode"] == "chat"
    assert keys == ["model"]
    mock_assembly.assert_called_once_with(tenant_id="tenant-1")


def test_convert_keeps_model_config_shape():
    config = {
        "model": {
            "provider": "openai",
            "name": "gpt-4o-mini",
            "mode": "chat",
            "completion_params": {"temperature": 0.3, "stop": ["END"]},
        }
    }

    result = ModelConfigManager.convert(config)

    assert result == ModelConfigEntity(
        provider="openai",
        model="gpt-4o-mini",
        mode="chat",
        parameters={"temperature": 0.3},
        stop=["END"],
    )
