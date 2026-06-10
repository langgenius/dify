from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture

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
    @staticmethod
    def _patch_model_assembly(mocker, *, provider_entities, model_list):
        assembly = MagicMock()
        assembly.model_provider_factory.get_providers.return_value = provider_entities
        assembly.provider_manager.get_configurations.return_value.get_models.return_value = model_list
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.manager.create_plugin_model_assembly",
            return_value=assembly,
        )
        return assembly

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

    def test_validate_and_set_defaults_success(
        self, mocker: MockerFixture, valid_config, provider_entities, valid_model_list
    ):
        self._patch_model_assembly(
            mocker,
            provider_entities=provider_entities,
            model_list=valid_model_list,
        )

        updated_config, keys = ModelConfigManager.validate_and_set_defaults("tenant1", valid_config)

        assert updated_config["model"]["mode"] == "chat"
        assert keys == ["model"]

    def test_validate_and_set_defaults_missing_model(self):
        with pytest.raises(ValueError, match="model is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", {})

    def test_validate_and_set_defaults_model_not_dict(self):
        with pytest.raises(ValueError, match="object type"):
            ModelConfigManager.validate_and_set_defaults("tenant1", {"model": "invalid"})

    def test_validate_and_set_defaults_missing_provider(self, mocker: MockerFixture, provider_entities):
        config = {"model": {"name": "gpt-4", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

        with pytest.raises(ValueError, match="model.provider is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_invalid_provider(self, mocker: MockerFixture, provider_entities):
        config = {"model": {"provider": "invalid/provider", "name": "gpt-4", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

        with pytest.raises(ValueError, match="model.provider is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_missing_name(self, mocker: MockerFixture, provider_entities):
        config = {"model": {"provider": "openai/gpt", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

        with pytest.raises(ValueError, match="model.name is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_empty_models(self, mocker: MockerFixture, provider_entities):
        config = {"model": {"provider": "openai/gpt", "name": "gpt-4", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

        with pytest.raises(ValueError, match="must be in the specified model list"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_invalid_model_name(
        self, mocker: MockerFixture, provider_entities, valid_model_list
    ):
        config = {"model": {"provider": "openai/gpt", "name": "invalid", "completion_params": {}}}
        self._patch_model_assembly(
            mocker,
            provider_entities=provider_entities,
            model_list=valid_model_list,
        )

        with pytest.raises(ValueError, match="must be in the specified model list"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_default_mode_when_missing(self, mocker: MockerFixture, provider_entities):
        model = MagicMock()
        model.model = "gpt-4"
        model.model_properties = {}

        config = {"model": {"provider": "openai/gpt", "name": "gpt-4", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[model])

        updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

        assert updated_config["model"]["mode"] == "completion"

    def test_validate_and_set_defaults_missing_completion_params(
        self, mocker: MockerFixture, provider_entities, valid_model_list
    ):
        config = {"model": {"provider": "openai/gpt", "name": "gpt-4"}}
        self._patch_model_assembly(
            mocker,
            provider_entities=provider_entities,
            model_list=valid_model_list,
        )

        with pytest.raises(ValueError, match="completion_params is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_provider_without_slash_converted(self, mocker: MockerFixture, valid_model_list):
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
        provider_entity = MagicMock()
        provider_entity.provider = "openai/gpt"
        self._patch_model_assembly(mocker, provider_entities=[provider_entity], model_list=valid_model_list)

        updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

        # Ensure conversion happened
        mock_provider_id.assert_called_once_with("openai")
        assert updated_config["model"]["provider"] == "openai/gpt"
