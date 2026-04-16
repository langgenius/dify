from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from graphon.model_runtime.entities.llm_entities import LLMMode
from graphon.model_runtime.entities.model_entities import ModelPropertyKey

from core.app.app_config.easy_ui_based_app.model_config.converter import ModelConfigConverter
from core.entities.model_entities import ModelStatus
from core.errors.error import (
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)


class TestModelConfigConverter:
    @pytest.fixture(autouse=True)
    def patch_response_entity(self, mocker):
        """
        Patch ModelConfigWithCredentialsEntity to bypass Pydantic validation
        and return a simple namespace object instead.
        """

        def _factory(**kwargs):
            return SimpleNamespace(**kwargs)

        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.ModelConfigWithCredentialsEntity",
            side_effect=_factory,
        )

    @pytest.fixture
    def mock_app_config(self):
        app_config = MagicMock()
        app_config.tenant_id = "tenant_1"

        model_config = MagicMock()
        model_config.provider = "openai"
        model_config.model = "gpt-4"
        model_config.parameters = {"temperature": 0.5}
        model_config.mode = None

        app_config.model = model_config
        return app_config

    @pytest.fixture
    def mock_provider_bundle(self):
        bundle = MagicMock()

        # configuration
        configuration = MagicMock()
        configuration.provider.provider = "openai"
        configuration.get_current_credentials.return_value = {"api_key": "key"}

        provider_model = MagicMock()
        provider_model.status = ModelStatus.ACTIVE
        configuration.get_provider_model.return_value = provider_model

        bundle.configuration = configuration

        # model type instance
        model_type_instance = MagicMock()
        model_schema = MagicMock()
        model_schema.model_properties = {}
        model_type_instance.get_model_schema.return_value = model_schema
        bundle.model_type_instance = model_type_instance

        return bundle

    @pytest.fixture
    def patch_provider_manager(self, mocker, mock_provider_bundle):
        mock_manager = MagicMock()
        mock_manager.get_provider_model_bundle.return_value = mock_provider_bundle
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=mock_manager,
        )
        return mock_manager

    # =============================
    # Positive Scenarios
    # =============================

    def test_convert_success_default_mode(self, mock_app_config, patch_provider_manager):
        result = ModelConfigConverter.convert(mock_app_config)

        assert result.provider == "openai"
        assert result.model == "gpt-4"
        assert result.mode == LLMMode.CHAT
        assert result.parameters == {"temperature": 0.5}
        assert result.stop == []

    def test_convert_success_with_stop_parameter(self, mock_app_config, patch_provider_manager):
        mock_app_config.model.parameters = {"temperature": 0.7, "stop": ["\n"]}

        result = ModelConfigConverter.convert(mock_app_config)

        assert result.parameters == {"temperature": 0.7}
        assert result.stop == ["\n"]

    def test_convert_mode_from_schema_valid(self, mock_app_config, mock_provider_bundle, mocker):
        mock_app_config.model.mode = None

        mock_provider_bundle.model_type_instance.get_model_schema.return_value.model_properties = {
            ModelPropertyKey.MODE: LLMMode.COMPLETION.value
        }

        mock_manager = MagicMock()
        mock_manager.get_provider_model_bundle.return_value = mock_provider_bundle
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=mock_manager,
        )

        result = ModelConfigConverter.convert(mock_app_config)
        assert result.mode == LLMMode.COMPLETION

    def test_convert_mode_from_schema_invalid_fallback(self, mock_app_config, mock_provider_bundle, mocker):
        mock_provider_bundle.model_type_instance.get_model_schema.return_value.model_properties = {
            ModelPropertyKey.MODE: "invalid"
        }

        mock_manager = MagicMock()
        mock_manager.get_provider_model_bundle.return_value = mock_provider_bundle
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=mock_manager,
        )

        result = ModelConfigConverter.convert(mock_app_config)
        assert result.mode == LLMMode.CHAT

    # =============================
    # Credential Errors
    # =============================

    def test_convert_credentials_none_raises(self, mock_app_config, mock_provider_bundle, mocker):
        mock_provider_bundle.configuration.get_current_credentials.return_value = None

        mock_manager = MagicMock()
        mock_manager.get_provider_model_bundle.return_value = mock_provider_bundle
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=mock_manager,
        )

        with pytest.raises(ProviderTokenNotInitError):
            ModelConfigConverter.convert(mock_app_config)

    # =============================
    # Provider Model Errors
    # =============================

    def test_convert_provider_model_none_raises(self, mock_app_config, mock_provider_bundle, mocker):
        mock_provider_bundle.configuration.get_provider_model.return_value = None

        mock_manager = MagicMock()
        mock_manager.get_provider_model_bundle.return_value = mock_provider_bundle
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=mock_manager,
        )

        with pytest.raises(ValueError):
            ModelConfigConverter.convert(mock_app_config)

    @pytest.mark.parametrize(
        ("status", "expected_exception"),
        [
            (ModelStatus.NO_CONFIGURE, ProviderTokenNotInitError),
            (ModelStatus.NO_PERMISSION, ModelCurrentlyNotSupportError),
            (ModelStatus.QUOTA_EXCEEDED, QuotaExceededError),
        ],
    )
    def test_convert_provider_model_status_errors(
        self, mock_app_config, mock_provider_bundle, mocker, status, expected_exception
    ):
        mock_provider = MagicMock()
        mock_provider.status = status
        mock_provider_bundle.configuration.get_provider_model.return_value = mock_provider

        mock_manager = MagicMock()
        mock_manager.get_provider_model_bundle.return_value = mock_provider_bundle
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=mock_manager,
        )

        with pytest.raises(expected_exception):
            ModelConfigConverter.convert(mock_app_config)

    # =============================
    # Schema Errors
    # =============================

    def test_convert_model_schema_none_raises(self, mock_app_config, mock_provider_bundle, mocker):
        mock_provider_bundle.model_type_instance.get_model_schema.return_value = None

        mock_manager = MagicMock()
        mock_manager.get_provider_model_bundle.return_value = mock_provider_bundle
        mocker.patch(
            "core.app.app_config.easy_ui_based_app.model_config.converter.create_plugin_provider_manager",
            return_value=mock_manager,
        )

        with pytest.raises(ValueError):
            ModelConfigConverter.convert(mock_app_config)

    # =============================
    # Edge Cases
    # =============================

    @pytest.mark.parametrize(
        "parameters",
        [
            {},
            {"stop": []},
            {"stop": ["END"], "max_tokens": 100},
        ],
    )
    def test_convert_parameter_edge_cases(self, mock_app_config, patch_provider_manager, parameters):
        mock_app_config.model.parameters = parameters.copy()

        result = ModelConfigConverter.convert(mock_app_config)

        if "stop" in parameters:
            assert result.stop == parameters.get("stop")
            expected_params = parameters.copy()
            expected_params.pop("stop", None)
            assert result.parameters == expected_params
        else:
            assert result.stop == []
            assert result.parameters == parameters
