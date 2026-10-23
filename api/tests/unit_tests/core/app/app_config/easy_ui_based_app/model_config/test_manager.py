from types import SimpleNamespace
from typing import cast
from unittest.mock import patch

import pytest
from pytest_mock import MockerFixture

from core.app.app_config.easy_ui_based_app.model_config.manager import ModelConfigManager
from core.app.app_config.entities import ModelConfigEntity
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity, SimpleModelProviderEntity
from core.entities.provider_configuration import ProviderConfigurations
from core.plugin.impl.model_runtime_factory import PluginModelAssembly
from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import FetchFrom, ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import ProviderEntity
from models.model import AppModelConfigDict
from models.provider_ids import ModelProviderID

# Target


class TestModelConfigManagerCases:
    # -----------------------------
    # Fixtures
    # -----------------------------

    @staticmethod
    @pytest.fixture
    def valid_completion_params() -> dict[str, object]:
        return {"temperature": 0.7, "stop": ["\n"]}

    @staticmethod
    @pytest.fixture
    def valid_model_list(provider_entities: list[ProviderEntity]) -> list[ModelWithProviderEntity]:
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

    @staticmethod
    @pytest.fixture
    def provider_entities() -> list[ProviderEntity]:
        return [
            ProviderEntity(
                provider="langgenius/openai/openai",
                label=I18nObject(en_US="OpenAI"),
                supported_model_types=[ModelType.LLM],
                configurate_methods=[],
            )
        ]

    @staticmethod
    @pytest.fixture
    def valid_config() -> AppModelConfigDict:
        return cast(
            AppModelConfigDict,
            {
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-4",
                    "completion_params": {"temperature": 0.5, "stop": ["END"]},
                }
            },
        )

    # -----------------------------
    # Test Class
    # -----------------------------

    class TestModelConfigManager:
        @staticmethod
        def _patch_model_assembly(
            mocker: MockerFixture, *, provider_entities: list[ProviderEntity], model_list: list[ModelWithProviderEntity]
        ) -> PluginModelAssembly:
            assembly = PluginModelAssembly(tenant_id="tenant1")
            configurations = ProviderConfigurations(tenant_id="tenant1")

            def get_providers() -> list[ProviderEntity]:
                return provider_entities

            def get_configurations(tenant_id: str) -> ProviderConfigurations:
                assert tenant_id == assembly.tenant_id
                return configurations

            def get_models(
                self: ProviderConfigurations, *, provider: str, model_type: ModelType
            ) -> list[ModelWithProviderEntity]:
                assert self is configurations
                assert provider in [entity.provider for entity in provider_entities]
                assert model_type == ModelType.LLM
                return model_list

            def create_assembly(*, tenant_id: str) -> PluginModelAssembly:
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

        def test_convert_success(self, valid_config: AppModelConfigDict) -> None:
            result = ModelConfigManager.convert(valid_config)

            assert result.provider == "langgenius/openai/openai"
            assert result.model == "gpt-4"
            assert result.parameters == {"temperature": 0.5}
            assert result.stop == ["END"]

        def test_convert_missing_model(self) -> None:
            with pytest.raises(ValueError, match="model is required"):
                ModelConfigManager.convert(cast(AppModelConfigDict, {}))

        def test_convert_without_stop(self) -> None:
            config = {
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-4",
                    "completion_params": {"temperature": 0.9},
                }
            }
            result = ModelConfigManager.convert(cast(AppModelConfigDict, config))
            assert result.stop == []
            assert result.parameters == {"temperature": 0.9}

        # ==========================================================
        # validate_model_completion_params
        # ==========================================================

        @pytest.mark.parametrize(
            "invalid_cp",
            [None, "string", 123, []],
        )
        def test_validate_model_completion_params_invalid_type(self, invalid_cp: object) -> None:
            with pytest.raises(ValueError, match="must be of object type"):
                ModelConfigManager.validate_model_completion_params(invalid_cp)  # pyrefly: ignore[bad-argument-type]

        def test_validate_model_completion_params_default_stop(self) -> None:
            cp = {"temperature": 0.2}
            result = ModelConfigManager.validate_model_completion_params(cp)
            assert result["stop"] == []

        def test_validate_model_completion_params_invalid_stop_type(self) -> None:
            cp = {"stop": "invalid"}
            with pytest.raises(ValueError, match="must be of list type"):
                ModelConfigManager.validate_model_completion_params(cp)

        def test_validate_model_completion_params_stop_length_exceeded(self) -> None:
            cp = {"stop": [1, 2, 3, 4, 5]}
            with pytest.raises(ValueError, match="less than 4"):
                ModelConfigManager.validate_model_completion_params(cp)

        # ==========================================================
        # validate_and_set_defaults
        # ==========================================================

        def test_validate_and_set_defaults_success(
            self,
            mocker: MockerFixture,
            valid_config: AppModelConfigDict,
            provider_entities: list[ProviderEntity],
            valid_model_list: list[ModelWithProviderEntity],
        ) -> None:
            self._patch_model_assembly(
                mocker,
                provider_entities=provider_entities,
                model_list=valid_model_list,
            )

            updated_config, keys = ModelConfigManager.validate_and_set_defaults("tenant1", valid_config)

            assert updated_config["model"]["mode"] == "chat"
            assert keys == ["model"]

        def test_validate_and_set_defaults_missing_model(self) -> None:
            with pytest.raises(ValueError, match="model is required"):
                ModelConfigManager.validate_and_set_defaults("tenant1", {})

        def test_validate_and_set_defaults_model_not_dict(self) -> None:
            with pytest.raises(ValueError, match="object type"):
                ModelConfigManager.validate_and_set_defaults("tenant1", {"model": "invalid"})

        def test_validate_and_set_defaults_missing_provider(
            self, mocker: MockerFixture, provider_entities: list[ProviderEntity]
        ) -> None:
            config = {"model": {"name": "gpt-4", "completion_params": dict[str, object]()}}
            self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

            with pytest.raises(ValueError, match="model.provider is required"):
                ModelConfigManager.validate_and_set_defaults("tenant1", config)

        def test_validate_and_set_defaults_invalid_provider(
            self, mocker: MockerFixture, provider_entities: list[ProviderEntity]
        ) -> None:
            config = {
                "model": {"provider": "invalid/provider", "name": "gpt-4", "completion_params": dict[str, object]()}
            }
            self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

            with pytest.raises(ValueError, match="model.provider is required"):
                ModelConfigManager.validate_and_set_defaults("tenant1", config)

        def test_validate_and_set_defaults_missing_name(
            self, mocker: MockerFixture, provider_entities: list[ProviderEntity]
        ) -> None:
            config = {"model": {"provider": "langgenius/openai/openai", "completion_params": dict[str, object]()}}
            self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

            with pytest.raises(ValueError, match="model.name is required"):
                ModelConfigManager.validate_and_set_defaults("tenant1", config)

        def test_validate_and_set_defaults_empty_models(
            self, mocker: MockerFixture, provider_entities: list[ProviderEntity]
        ) -> None:
            config = {
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-4",
                    "completion_params": dict[str, object](),
                }
            }
            self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[])

            with pytest.raises(ValueError, match="must be in the specified model list"):
                ModelConfigManager.validate_and_set_defaults("tenant1", config)

        def test_validate_and_set_defaults_invalid_model_name(
            self,
            mocker: MockerFixture,
            provider_entities: list[ProviderEntity],
            valid_model_list: list[ModelWithProviderEntity],
        ) -> None:
            config = {
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "invalid",
                    "completion_params": dict[str, object](),
                }
            }
            self._patch_model_assembly(
                mocker,
                provider_entities=provider_entities,
                model_list=valid_model_list,
            )

            with pytest.raises(ValueError, match="must be in the specified model list"):
                ModelConfigManager.validate_and_set_defaults("tenant1", config)

        def test_validate_and_set_defaults_default_mode_when_missing(
            self,
            mocker: MockerFixture,
            provider_entities: list[ProviderEntity],
            valid_model_list: list[ModelWithProviderEntity],
        ) -> None:
            model = valid_model_list[0]
            model.model_properties = dict[ModelPropertyKey, object]()

            config = {
                "model": {
                    "provider": "langgenius/openai/openai",
                    "name": "gpt-4",
                    "completion_params": dict[str, object](),
                }
            }
            self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=[model])

            updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

            assert updated_config["model"]["mode"] == "completion"

        def test_validate_and_set_defaults_missing_completion_params(
            self,
            mocker: MockerFixture,
            provider_entities: list[ProviderEntity],
            valid_model_list: list[ModelWithProviderEntity],
        ) -> None:
            config = {"model": {"provider": "langgenius/openai/openai", "name": "gpt-4"}}
            self._patch_model_assembly(
                mocker,
                provider_entities=provider_entities,
                model_list=valid_model_list,
            )

            with pytest.raises(ValueError, match="completion_params is required"):
                ModelConfigManager.validate_and_set_defaults("tenant1", config)

        def test_validate_and_set_defaults_provider_without_slash_converted(
            self,
            mocker: MockerFixture,
            provider_entities: list[ProviderEntity],
            valid_model_list: list[ModelWithProviderEntity],
        ) -> None:
            """
            Covers branch where provider does not contain '/' and
            ModelProviderID conversion is triggered (line 64).
            """
            config = {
                "model": {
                    "provider": "openai",  # no slash -> triggers conversion
                    "name": "gpt-4",
                    "completion_params": dict[str, object](),
                }
            }

            self._patch_model_assembly(mocker, provider_entities=provider_entities, model_list=valid_model_list)

            updated_config, _ = ModelConfigManager.validate_and_set_defaults("tenant1", config)

            assert updated_config["model"]["provider"] == "langgenius/openai/openai"


class TestEasyUiModelConfigManagerCases:
    @staticmethod
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

    @staticmethod
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
