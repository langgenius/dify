import decimal
from unittest.mock import MagicMock, patch

import pytest
from pydantic import BaseModel

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import (
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
from dify_graph.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from dify_graph.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from dify_graph.model_runtime.model_providers.__base.ai_model import AIModel


class _ConcreteAIModel(AIModel):
    model_type = ModelType.LLM


class TestAIModel:
    @pytest.fixture
    def provider_schema(self) -> ProviderEntity:
        return ProviderEntity(
            provider="langgenius/openai/openai",
            provider_name="openai",
            label=I18nObject(en_US="OpenAI"),
            supported_model_types=[ModelType.LLM],
            configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
        )

    @pytest.fixture
    def model_runtime(self) -> MagicMock:
        return MagicMock()

    @pytest.fixture
    def ai_model(self, provider_schema: ProviderEntity, model_runtime: MagicMock) -> AIModel:
        return _ConcreteAIModel(
            provider_schema=provider_schema,
            model_runtime=model_runtime,
        )

    def test_init_stores_runtime_state_and_is_not_pydantic_model(
        self, ai_model: AIModel, provider_schema: ProviderEntity, model_runtime: MagicMock
    ) -> None:
        assert ai_model.model_type == ModelType.LLM
        assert ai_model.provider_schema is provider_schema
        assert ai_model.model_runtime is model_runtime
        assert ai_model.provider == "langgenius/openai/openai"
        assert ai_model.provider_display_name == "OpenAI"
        assert ai_model.started_at == 0
        assert not isinstance(ai_model, BaseModel)

    def test_direct_base_class_requires_subclass_model_type(
        self, provider_schema: ProviderEntity, model_runtime: MagicMock
    ) -> None:
        with pytest.raises(TypeError, match="subclasses must define model_type"):
            AIModel(provider_schema=provider_schema, model_runtime=model_runtime)

    def test_subclass_uses_class_level_model_type(
        self, provider_schema: ProviderEntity, model_runtime: MagicMock
    ) -> None:
        model = _ConcreteAIModel(provider_schema=provider_schema, model_runtime=model_runtime)
        assert model.model_type == ModelType.LLM

    def test_invoke_error_mapping(self, ai_model: AIModel) -> None:
        mapping = ai_model._invoke_error_mapping
        assert InvokeConnectionError in mapping
        assert InvokeServerUnavailableError in mapping
        assert InvokeRateLimitError in mapping
        assert InvokeAuthorizationError in mapping
        assert InvokeBadRequestError in mapping
        assert ValueError in mapping

    def test_transform_invoke_error(self, ai_model: AIModel) -> None:
        err = Exception("Original error")

        with patch.object(AIModel, "_invoke_error_mapping", {InvokeAuthorizationError: [Exception]}):
            transformed = ai_model._transform_invoke_error(err)
            assert isinstance(transformed, InvokeAuthorizationError)
            assert "Incorrect model credentials provided" in str(transformed.description)

        class CustomNonInvokeError(Exception):
            pass

        with patch.object(AIModel, "_invoke_error_mapping", {CustomNonInvokeError: [Exception]}):
            transformed = ai_model._transform_invoke_error(err)
            assert transformed == err

        transformed = ai_model._transform_invoke_error(Exception("Unmapped"))
        assert isinstance(transformed, InvokeError)
        assert transformed.description == "[OpenAI] Error: Unmapped"

    def test_get_price(self, ai_model: AIModel) -> None:
        model_name = "test_model"
        credentials = {"key": "value"}

        mock_schema = MagicMock(spec=AIModelEntity)
        mock_schema.pricing = PriceConfig(
            input=decimal.Decimal("0.002"),
            output=decimal.Decimal("0.004"),
            unit=decimal.Decimal(1000),
            currency="USD",
        )

        with patch.object(AIModel, "get_model_schema", return_value=mock_schema):
            price_info = ai_model.get_price(model_name, credentials, PriceType.INPUT, 2000)
            assert price_info.unit_price == decimal.Decimal("0.002")

            price_info = ai_model.get_price(model_name, credentials, PriceType.OUTPUT, 2000)
            assert price_info.unit_price == decimal.Decimal("0.004")

        mock_schema.pricing = None
        with patch.object(AIModel, "get_model_schema", return_value=mock_schema):
            price_info = ai_model.get_price(model_name, credentials, PriceType.INPUT, 1000)
            assert price_info.total_amount == decimal.Decimal("0.0")

    def test_get_price_no_price_config_error(self, ai_model: AIModel) -> None:
        class ChangingPriceConfig:
            def __init__(self) -> None:
                self.input = decimal.Decimal("0.01")
                self.unit = decimal.Decimal(1)
                self.currency = "USD"
                self.called = 0

            def __bool__(self) -> bool:
                self.called += 1
                return self.called <= 2

        mock_schema = MagicMock()
        mock_schema.pricing = ChangingPriceConfig()

        with patch.object(AIModel, "get_model_schema", return_value=mock_schema):
            with pytest.raises(ValueError, match="Price config not found"):
                ai_model.get_price("test_model", {}, PriceType.INPUT, 1000)

    def test_get_model_schema_delegates_to_runtime(
        self, ai_model: AIModel, model_runtime: MagicMock, provider_schema: ProviderEntity
    ) -> None:
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
        model_runtime.get_model_schema.return_value = mock_schema

        schema = ai_model.get_model_schema(model_name, credentials)

        assert schema == mock_schema
        model_runtime.get_model_schema.assert_called_once_with(
            provider=provider_schema.provider,
            model_type=ModelType.LLM,
            model=model_name,
            credentials=credentials,
        )

    def test_get_customizable_model_schema_from_credentials_template_mapping_value_error(
        self, ai_model: AIModel
    ) -> None:
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
            schema = ai_model.get_customizable_model_schema_from_credentials("test_model", {})
            assert schema is not None
            assert schema.parameter_rules[0].use_template == "invalid_template_name"

    def test_get_customizable_model_schema_from_credentials(self, ai_model: AIModel) -> None:
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
            schema = ai_model.get_customizable_model_schema_from_credentials("test_model", {})

            assert schema is not None
            assert schema.parameter_rules[0].max == 1.0
            assert schema.parameter_rules[1].help is not None
            assert schema.parameter_rules[1].help.en_US != ""
            assert schema.parameter_rules[2].help is not None
            assert schema.parameter_rules[2].help.zh_Hans != ""
            assert schema.parameter_rules[3].use_template is None

    def test_get_customizable_model_schema_from_credentials_none(self, ai_model: AIModel) -> None:
        with patch.object(AIModel, "get_customizable_model_schema", return_value=None):
            schema = ai_model.get_customizable_model_schema_from_credentials("model", {})
            assert schema is None

    def test_get_customizable_model_schema_default(self, ai_model: AIModel) -> None:
        assert ai_model.get_customizable_model_schema("model", {}) is None

    def test_get_default_parameter_rule_variable_map(self, ai_model: AIModel) -> None:
        result = ai_model._get_default_parameter_rule_variable_map(DefaultParameterName.TEMPERATURE)
        assert result["default"] == 0.0

        with pytest.raises(Exception, match="Invalid model parameter rule name"):
            ai_model._get_default_parameter_rule_variable_map("invalid_name")
