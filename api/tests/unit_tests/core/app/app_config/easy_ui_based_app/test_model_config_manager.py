from unittest.mock import MagicMock

import pytest

# Target
from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager

# -----------------------------
# Fixtures
# -----------------------------


@pytest.fixture
def valid_completion_params():
    return {"temperature": 0.7, "stop": ["\n"]}


@pytest.fixture
def valid_model_list():
    model = MagicMock()
    model.model = "gpt-4"
    model.model_properties = {"mode": "chat"}
    return [model]


@pytest.fixture
def provider_entities():
    provider = MagicMock()
    provider.provider = "openai/gpt"
    return [provider]


@pytest.fixture
def valid_config():
    return {
        "model": {"provider": "openai/gpt", "name": "gpt-4", "completion_params": {"temperature": 0.5, "stop": ["END"]}}
    }


# -----------------------------
# Test Class
# -----------------------------


class TestModelConfigManager:
    # ==========================================================
    # convert
    # ==========================================================

    def test_convert_success(self, valid_config):
        result = ModelConfigManager.convert(valid_config)

        assert result.provider == "openai/gpt"
        assert result.model == "gpt-4"
        assert result.parameters == {"temperature": 0.5}
        assert result.stop == ["END"]

    def test_convert_missing_model(self):
        with pytest.raises(ValueError, match="model is required"):
            ModelConfigManager.convert({})

    def test_convert_without_stop(self):
        config = {"model": {"provider": "openai/gpt", "name": "gpt-4", "completion_params": {"temperature": 0.9}}}
        result = ModelConfigManager.convert(config)
        assert result.stop == []
        assert result.parameters == {"temperature": 0.9}

    # ==========================================================
    # validate_model_completion_params
    # ==========================================================

    @pytest.mark.parametrize(
        "invalid_cp",
        [None, "string", 123, []],
    )
    def test_validate_model_completion_params_invalid_type(self, invalid_cp):
        with pytest.raises(ValueError, match="must be of object type"):
            ModelConfigManager.validate_model_completion_params(invalid_cp)

    def test_validate_model_completion_params_default_stop(self):
        cp = {"temperature": 0.2}
        result = ModelConfigManager.validate_model_completion_params(cp)
        assert result["stop"] == []

    def test_validate_model_completion_params_invalid_stop_type(self):
        cp = {"stop": "invalid"}
        with pytest.raises(ValueError, match="must be of list type"):
            ModelConfigManager.validate_model_completion_params(cp)

    def test_validate_model_completion_params_stop_length_exceeded(self):
        cp = {"stop": [1, 2, 3, 4, 5]}
        with pytest.raises(ValueError, match="less than 4"):
            ModelConfigManager.validate_model_completion_params(cp)

    # ==========================================================
    # validate_and_set_defaults
    # ==========================================================

    def test_validate_and_set_defaults_success(self, mocker, valid_config, provider_entities, valid_model_list):
        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        mock_pm = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ProviderManager")
        mock_pm.return_value.get_configurations.return_value.get_models.return_value = valid_model_list

        updated_config, keys = ModelConfigManager.validate_and_set_defaults("tenant1", valid_config)

        assert updated_config["model"]["mode"] == "chat"
        assert keys == ["model"]

    def test_validate_and_set_defaults_missing_model(self):
        with pytest.raises(ValueError, match="model is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", {})

    def test_validate_and_set_defaults_model_not_dict(self):
        with pytest.raises(ValueError, match="object type"):
            ModelConfigManager.validate_and_set_defaults("tenant1", {"model": "invalid"})

    def test_validate_and_set_defaults_missing_provider(self, mocker, provider_entities):
        config = {"model": {"name": "gpt-4", "completion_params": {}}}

        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        with pytest.raises(ValueError, match="model.provider is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_invalid_provider(self, mocker, provider_entities):
        config = {"model": {"provider": "invalid/provider", "name": "gpt-4", "completion_params": {}}}

        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        with pytest.raises(ValueError, match="model.provider is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_missing_name(self, mocker, provider_entities):
        config = {"model": {"provider": "openai/gpt", "completion_params": {}}}

        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        with pytest.raises(ValueError, match="model.name is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_empty_models(self, mocker, provider_entities):
        config = {"model": {"provider": "openai/gpt", "name": "gpt-4", "completion_params": {}}}

        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        mock_pm = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ProviderManager")
        mock_pm.return_value.get_configurations.return_value.get_models.return_value = []

        with pytest.raises(ValueError, match="must be in the specified model list"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_invalid_model_name(self, mocker, provider_entities, valid_model_list):
        config = {"model": {"provider": "openai/gpt", "name": "invalid", "completion_params": {}}}

        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        mock_pm = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ProviderManager")
        mock_pm.return_value.get_configurations.return_value.get_models.return_value = valid_model_list

        with pytest.raises(ValueError, match="must be in the specified model list"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_default_mode_when_missing(self, mocker, provider_entities):
        model = MagicMock()
        model.model = "gpt-4"
        model.model_properties = {}

        config = {"model": {"provider": "openai/gpt", "name": "gpt-4", "completion_params": {}}}

        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        mock_pm = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ProviderManager")
        mock_pm.return_value.get_configurations.return_value.get_models.return_value = [model]

        updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

        assert updated_config["model"]["mode"] == "completion"

    def test_validate_and_set_defaults_missing_completion_params(self, mocker, provider_entities, valid_model_list):
        config = {"model": {"provider": "openai/gpt", "name": "gpt-4"}}

        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        mock_factory.return_value.get_providers.return_value = provider_entities

        mock_pm = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ProviderManager")
        mock_pm.return_value.get_configurations.return_value.get_models.return_value = valid_model_list

        with pytest.raises(ValueError, match="completion_params is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_provider_without_slash_converted(self, mocker, valid_model_list):
        """
        Covers branch where provider does not contain '/' and
        ModelProviderID conversion is triggered (line 64).
        """
        config = {
            "model": {
                "provider": "openai",  # no slash -> triggers conversion
                "name": "gpt-4",
                "completion_params": {},
            }
        }

        # Mock ModelProviderID to return formatted provider
        mock_provider_id = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderID")
        mock_provider_id.return_value = "openai/gpt"

        # Mock provider factory
        mock_factory = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ModelProviderFactory")
        provider_entity = MagicMock()
        provider_entity.provider = "openai/gpt"
        mock_factory.return_value.get_providers.return_value = [provider_entity]

        # Mock provider manager
        mock_pm = mocker.patch("core.app.app_config.easy_ui_based_app.model_config.manager.ProviderManager")
        mock_pm.return_value.get_configurations.return_value.get_models.return_value = valid_model_list

        updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

        # Ensure conversion happened
        mock_provider_id.assert_called_once_with("openai")
        assert updated_config["model"]["provider"] == "openai/gpt"
