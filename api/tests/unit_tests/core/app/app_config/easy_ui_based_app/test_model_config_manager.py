import pytest
from pytest_mock import MockerFixture

# Target
from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_configuration import ProviderConfigurations
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity

# -----------------------------
# Fixtures
# -----------------------------


@pytest.fixture
def valid_completion_params():
    return {"temperature": 0.7, "stop": ["\n"]}


@pytest.fixture
def valid_model_list(provider_entities):
    return [
        ModelWithProviderEntity(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.MODE: "chat"},
            status=ModelStatus.ACTIVE,
            provider=SimpleModelProviderEntity(provider_entities[0]),
        )
    ]


@pytest.fixture
def provider_entities():
    return [
        ProviderEntity(
            provider="langgenius/openai/openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[],
        )
    ]


@pytest.fixture
def valid_config():
    return {
        "model": {
            "provider": "langgenius/openai/openai",
            "name": "gpt-4",
            "completion_params": {"temperature": 0.5, "stop": ["END"]},
        }
    }


# -----------------------------
# Test Class
# -----------------------------


class TestModelConfigManager:
    @staticmethod
    def _patch_model_assembly(mocker, *, provider_entities, model_list):
        assembly = PluginModelAssembly(tenant_id="tenant1")
        configurations = ProviderConfigurations(tenant_id="tenant1")

        def get_providers():
            return provider_entities

        def get_configurations(tenant_id):
            assert tenant_id == assembly.tenant_id
            return configurations

        def get_models(self, *, provider, model_type):
            assert self is configurations
            assert provider in [entity.provider for entity in provider_entities]
            assert model_type == ModelType.LLM
            return model_list

        def create_assembly(*, tenant_id):
            assert tenant_id == assembly.tenant_id
            return assembly

        mocker.patch.object(assembly.model_provider_factory, "get_providers", new=get_providers)
        mocker.patch.object(assembly.provider_manager, "get_configurations", new=get_configurations)
        mocker.patch.object(ProviderConfigurations, "get_models", new=get_models)
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.manager.create_plugin_model_assembly",
            new=create_assembly,
        )
        return assembly

    # ==========================================================
    # convert
    # ==========================================================

    def test_convert_success(self, valid_config):
        result = ModelConfigManager.convert(valid_config)

        assert result.provider == "langgenius/openai/openai"
        assert result.model == "gpt-4"
        assert result.parameters == {"temperature": 0.5}
        assert result.stop == ["END"]

    def test_convert_missing_model(self):
        with pytest.raises(ValueError, match="model is required"):
            ModelConfigManager.convert({})

    def test_convert_without_stop(self):
        config = {
            "model": {
                "provider": "langgenius/openai/openai",
                "name": "gpt-4",
                "completion_params": {"temperature": 0.9},
            }
        }
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
        config = {"model": {"provider": "langgenius/openai/openai", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

        with pytest.raises(ValueError, match="model.name is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_empty_models(self, mocker: MockerFixture, provider_entities):
        config = {"model": {"provider": "langgenius/openai/openai", "name": "gpt-4", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

        with pytest.raises(ValueError, match="must be in the specified model list"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_invalid_model_name(
        self, mocker: MockerFixture, provider_entities, valid_model_list
    ):
        config = {"model": {"provider": "langgenius/openai/openai", "name": "invalid", "completion_params": {}}}
        self._patch_model_assembly(
            mocker,
            provider_entities=provider_entities,
            model_list=valid_model_list,
        )

        with pytest.raises(ValueError, match="must be in the specified model list"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_default_mode_when_missing(
        self, mocker: MockerFixture, provider_entities, valid_model_list
    ):
        model = valid_model_list[0]
        model.model_properties = {}

        config = {"model": {"provider": "langgenius/openai/openai", "name": "gpt-4", "completion_params": {}}}
        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[model])

        updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

        assert updated_config["model"]["mode"] == "completion"

    def test_validate_and_set_defaults_missing_completion_params(
        self, mocker: MockerFixture, provider_entities, valid_model_list
    ):
        config = {"model": {"provider": "langgenius/openai/openai", "name": "gpt-4"}}
        self._patch_model_assembly(
            mocker,
            provider_entities=provider_entities,
            model_list=valid_model_list,
        )

        with pytest.raises(ValueError, match="completion_params is required"):
            ModelConfigManager.validate_and_set_defaults("tenant1", config)

    def test_validate_and_set_defaults_provider_without_slash_converted(
        self, mocker: MockerFixture, provider_entities, valid_model_list
    ):
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

        self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=valid_model_list)

        updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

        assert updated_config["model"]["provider"] == "langgenius/openai/openai"
