import decimal
from unittest.mock import MagicMock, patch

import pytest
from redis import RedisError

from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    ModelPropertyKey,
    ModelType,
    ParameterRule,
    ParameterType,
    PriceConfig,
    PriceType,
)
from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.model_providers.__base.ai_model import AIModel
from core.plugin.entities.plugin_daemon import PluginDaemonInnerError, PluginModelProviderEntity


class TestAIModel:
    @pytest.fixture
    def mock_plugin_model_provider(self):
        return MagicMock(spec=PluginModelProviderEntity)

    @pytest.fixture
    def ai_model(self, mock_plugin_model_provider):
        return AIModel(
            tenant_id="tenant_123",
            model_type=ModelType.LLM,
            plugin_id="plugin_123",
            provider_name="test_provider",
            plugin_model_provider=mock_plugin_model_provider,
        )

    def test_invoke_error_mapping(self, ai_model):
        mapping = ai_model._invoke_error_mapping
        assert InvokeConnectionError in mapping
        assert InvokeServerUnavailableError in mapping
        assert InvokeRateLimitError in mapping
        assert InvokeAuthorizationError in mapping
        assert InvokeBadRequestError in mapping
        assert PluginDaemonInnerError in mapping
        assert ValueError in mapping

    def test_transform_invoke_error(self, ai_model):
        # Case: mapped error (InvokeAuthorizationError)
        err = Exception("Original error")
        with patch.object(AIModel, "_invoke_error_mapping", {InvokeAuthorizationError: [Exception]}):
            transformed = ai_model._transform_invoke_error(err)
            assert isinstance(transformed, InvokeAuthorizationError)
            assert "Incorrect model credentials provided" in str(transformed.description)

        # Case: mapped error (InvokeError subclass)
        with patch.object(AIModel, "_invoke_error_mapping", {InvokeRateLimitError("Rate limit"): [Exception]}):
            transformed = ai_model._transform_invoke_error(err)
            assert isinstance(transformed, InvokeError)
            assert "[test_provider]" in transformed.description

        # Case: mapped error (not InvokeError)
        class CustomNonInvokeError(Exception):
            pass

        with patch.object(AIModel, "_invoke_error_mapping", {CustomNonInvokeError: [Exception]}):
            transformed = ai_model._transform_invoke_error(err)
            assert transformed == err

        # Case: unmapped error
        unmapped_err = Exception("Unmapped")
        transformed = ai_model._transform_invoke_error(unmapped_err)
        assert isinstance(transformed, InvokeError)
        assert "Error: Unmapped" in transformed.description

    def test_get_price(self, ai_model):
        model_name = "test_model"
        credentials = {"key": "value"}

        # Mock get_model_schema
        mock_schema = MagicMock(spec=AIModelEntity)
        mock_schema.pricing = PriceConfig(
            input=decimal.Decimal("0.002"),
            output=decimal.Decimal("0.004"),
            unit=decimal.Decimal(1000),  # 1000 tokens per unit
            currency="USD",
        )

        with patch.object(AIModel, "get_model_schema", return_value=mock_schema):
            # Test INPUT
            price_info = ai_model.get_price(model_name, credentials, PriceType.INPUT, 2000)
            assert price_info.unit_price == decimal.Decimal("0.002")

            # Test OUTPUT
            price_info = ai_model.get_price(model_name, credentials, PriceType.OUTPUT, 2000)
            assert price_info.unit_price == decimal.Decimal("0.004")

        # Case: unit_price is None (returns zeroed PriceInfo)
        mock_schema.pricing = None
        with patch.object(AIModel, "get_model_schema", return_value=mock_schema):
            price_info = ai_model.get_price(model_name, credentials, PriceType.INPUT, 1000)
            assert price_info.total_amount == decimal.Decimal("0.0")

    def test_get_price_no_price_config_error(self, ai_model):
        model_name = "test_model"

        # We need it to be truthy at line 107 and 112 but falsy at line 127.
        class ChangingPriceConfig:
            def __init__(self):
                self.input = decimal.Decimal("0.01")
                self.unit = decimal.Decimal(1)
                self.currency = "USD"
                self.called = 0

            def __bool__(self):
                self.called += 1
                return self.called <= 2

        mock_schema = MagicMock()
        mock_schema.pricing = ChangingPriceConfig()

        with patch.object(AIModel, "get_model_schema", return_value=mock_schema):
            with pytest.raises(ValueError) as excinfo:
                ai_model.get_price(model_name, {}, PriceType.INPUT, 1000)
            assert "Price config not found" in str(excinfo.value)

    def test_get_model_schema_cache_hit(self, ai_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}

        mock_schema = AIModelEntity(
            model="test_model",
            label=I18nObject(en_US="Test Model"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
            parameter_rules=[],
        )

        with patch("core.model_runtime.model_providers.__base.ai_model.redis_client") as mock_redis:
            mock_redis.get.return_value = mock_schema.model_dump_json().encode()

            schema = ai_model.get_model_schema(model_name, credentials)

            assert schema.model == "test_model"
            mock_redis.get.assert_called_once()

    def test_get_model_schema_cache_miss(self, ai_model):
        model_name = "test_model"
        credentials = {"api_key": "abc"}

        mock_schema = AIModelEntity(
            model="test_model",
            label=I18nObject(en_US="Test Model"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
            parameter_rules=[],
        )

        with (
            patch("core.model_runtime.model_providers.__base.ai_model.redis_client") as mock_redis,
            patch("core.plugin.impl.model.PluginModelClient") as mock_client,
        ):
            mock_redis.get.return_value = None
            mock_manager = mock_client.return_value
            mock_manager.get_model_schema.return_value = mock_schema

            schema = ai_model.get_model_schema(model_name, credentials)

            assert schema == mock_schema
            mock_manager.get_model_schema.assert_called_once()
            mock_redis.setex.assert_called_once()

    def test_get_model_schema_redis_error(self, ai_model):
        model_name = "test_model"

        with (
            patch("core.model_runtime.model_providers.__base.ai_model.redis_client") as mock_redis,
            patch("core.plugin.impl.model.PluginModelClient") as mock_client,
        ):
            mock_redis.get.side_effect = RedisError("Connection refused")
            mock_manager = mock_client.return_value
            mock_manager.get_model_schema.return_value = None

            schema = ai_model.get_model_schema(model_name, {})

            assert schema is None
            mock_manager.get_model_schema.assert_called_once()

    def test_get_model_schema_validation_error(self, ai_model):
        model_name = "test_model"

        with (
            patch("core.model_runtime.model_providers.__base.ai_model.redis_client") as mock_redis,
            patch("core.plugin.impl.model.PluginModelClient") as mock_client,
        ):
            mock_redis.get.return_value = b"invalid json"
            mock_manager = mock_client.return_value
            mock_manager.get_model_schema.return_value = None

            # This should trigger ValidationError at line 166 and go to delete()
            schema = ai_model.get_model_schema(model_name, {})

            assert schema is None
            mock_redis.delete.assert_called()

    def test_get_model_schema_redis_delete_error(self, ai_model):
        model_name = "test_model"

        with (
            patch("core.model_runtime.model_providers.__base.ai_model.redis_client") as mock_redis,
            patch("core.plugin.impl.model.PluginModelClient") as mock_client,
        ):
            mock_redis.get.return_value = b'{"invalid": "schema"}'
            mock_redis.delete.side_effect = RedisError("Delete failed")
            mock_manager = mock_client.return_value
            mock_manager.get_model_schema.return_value = None

            schema = ai_model.get_model_schema(model_name, {})

            assert schema is None
            mock_redis.delete.assert_called()

    def test_get_model_schema_redis_setex_error(self, ai_model):
        model_name = "test_model"
        mock_schema = AIModelEntity(
            model="test_model",
            label=I18nObject(en_US="Test Model"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
            parameter_rules=[],
        )

        with (
            patch("core.model_runtime.model_providers.__base.ai_model.redis_client") as mock_redis,
            patch("core.plugin.impl.model.PluginModelClient") as mock_client,
        ):
            mock_redis.get.return_value = None
            mock_redis.setex.side_effect = RuntimeError("Setex failed")
            mock_manager = mock_client.return_value
            mock_manager.get_model_schema.return_value = mock_schema

            schema = ai_model.get_model_schema(model_name, {})

            assert schema == mock_schema
            mock_redis.setex.assert_called()

    def test_get_customizable_model_schema_from_credentials_template_mapping_value_error(self, ai_model):
        model_name = "test_model"

        mock_schema = AIModelEntity(
            model="test_model",
            label=I18nObject(en_US="Test Model"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
            parameter_rules=[
                ParameterRule(
                    name="invalid",
                    use_template="invalid_template_name",
                    label=I18nObject(en_US="Invalid"),
                    type=ParameterType.FLOAT,
                )
            ],
        )

        with patch.object(AIModel, "get_customizable_model_schema", return_value=mock_schema):
            schema = ai_model.get_customizable_model_schema_from_credentials(model_name, {})
            assert schema.parameter_rules[0].use_template == "invalid_template_name"

    def test_get_customizable_model_schema_from_credentials(self, ai_model):
        model_name = "test_model"

        mock_schema = AIModelEntity(
            model="test_model",
            label=I18nObject(en_US="Test Model"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.CUSTOMIZABLE_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 1024},
            parameter_rules=[
                ParameterRule(
                    name="temp", use_template="temperature", label=I18nObject(en_US="Temp"), type=ParameterType.FLOAT
                ),
                ParameterRule(
                    name="top_p",
                    use_template="top_p",
                    label=I18nObject(en_US="Top P"),
                    type=ParameterType.FLOAT,
                    help=I18nObject(en_US=""),
                ),
                ParameterRule(
                    name="max_tokens",
                    use_template="max_tokens",
                    label=I18nObject(en_US="Max Tokens"),
                    type=ParameterType.INT,
                    help=I18nObject(en_US="", zh_Hans=""),
                ),
                ParameterRule(name="custom", label=I18nObject(en_US="Custom"), type=ParameterType.STRING),
            ],
        )

        with patch.object(AIModel, "get_customizable_model_schema", return_value=mock_schema):
            schema = ai_model.get_customizable_model_schema_from_credentials(model_name, {})

            assert schema.parameter_rules[0].max == 1.0
            assert schema.parameter_rules[1].help.en_US != ""
            assert schema.parameter_rules[2].help.zh_Hans != ""
            assert schema.parameter_rules[3].use_template is None

    def test_get_customizable_model_schema_from_credentials_none(self, ai_model):
        with patch.object(AIModel, "get_customizable_model_schema", return_value=None):
            schema = ai_model.get_customizable_model_schema_from_credentials("model", {})
            assert schema is None

    def test_get_customizable_model_schema_default(self, ai_model):
        assert ai_model.get_customizable_model_schema("model", {}) is None

    def test_get_default_parameter_rule_variable_map(self, ai_model):
        # Valid
        res = ai_model._get_default_parameter_rule_variable_map(DefaultParameterName.TEMPERATURE)
        assert res["default"] == 0.0

        # Invalid
        with pytest.raises(Exception) as excinfo:
            ai_model._get_default_parameter_rule_variable_map("invalid_name")
        assert "Invalid model parameter rule name" in str(excinfo.value)
