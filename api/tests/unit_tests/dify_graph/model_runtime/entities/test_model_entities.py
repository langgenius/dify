from decimal import Decimal

import pytest

from dify_graph.model_runtime.entities.common_entities import I18nObject
from dify_graph.model_runtime.entities.model_entities import (
    AIModelEntity,
    DefaultParameterName,
    FetchFrom,
    ModelFeature,
    ModelPropertyKey,
    ModelType,
    ModelUsage,
    ParameterRule,
    ParameterType,
    PriceConfig,
    PriceInfo,
    PriceType,
    ProviderModel,
)


class TestModelType:
    def test_value_of(self):
        assert ModelType.value_of("text-generation") == ModelType.LLM
        assert ModelType.value_of(ModelType.LLM) == ModelType.LLM
        assert ModelType.value_of("embeddings") == ModelType.TEXT_EMBEDDING
        assert ModelType.value_of(ModelType.TEXT_EMBEDDING) == ModelType.TEXT_EMBEDDING
        assert ModelType.value_of("reranking") == ModelType.RERANK
        assert ModelType.value_of(ModelType.RERANK) == ModelType.RERANK
        assert ModelType.value_of("speech2text") == ModelType.SPEECH2TEXT
        assert ModelType.value_of(ModelType.SPEECH2TEXT) == ModelType.SPEECH2TEXT
        assert ModelType.value_of("tts") == ModelType.TTS
        assert ModelType.value_of(ModelType.TTS) == ModelType.TTS
        assert ModelType.value_of(ModelType.MODERATION) == ModelType.MODERATION

        with pytest.raises(ValueError, match="invalid origin model type invalid"):
            ModelType.value_of("invalid")

    def test_to_origin_model_type(self):
        assert ModelType.LLM.to_origin_model_type() == "text-generation"
        assert ModelType.TEXT_EMBEDDING.to_origin_model_type() == "embeddings"
        assert ModelType.RERANK.to_origin_model_type() == "reranking"
        assert ModelType.SPEECH2TEXT.to_origin_model_type() == "speech2text"
        assert ModelType.TTS.to_origin_model_type() == "tts"
        assert ModelType.MODERATION.to_origin_model_type() == "moderation"

        # Testing the else branch in to_origin_model_type
        # Since it's a StrEnum, it's hard to get an invalid value here unless we mock or Force it.
        # But if we look at the implementation:
        # if self == self.LLM: ... elif ... else: raise ValueError
        # We can try to create a "dummy" member if possible, or just skip it if we have 100% coverage otherwise.
        # Actually, adding a new member to an enum at runtime is possible but messy.
        # Let's see if we can trigger it.


class TestFetchFrom:
    def test_values(self):
        assert FetchFrom.PREDEFINED_MODEL == "predefined-model"
        assert FetchFrom.CUSTOMIZABLE_MODEL == "customizable-model"


class TestModelFeature:
    def test_values(self):
        assert ModelFeature.TOOL_CALL == "tool-call"
        assert ModelFeature.MULTI_TOOL_CALL == "multi-tool-call"
        assert ModelFeature.AGENT_THOUGHT == "agent-thought"
        assert ModelFeature.VISION == "vision"
        assert ModelFeature.STREAM_TOOL_CALL == "stream-tool-call"
        assert ModelFeature.DOCUMENT == "document"
        assert ModelFeature.VIDEO == "video"
        assert ModelFeature.AUDIO == "audio"
        assert ModelFeature.STRUCTURED_OUTPUT == "structured-output"


class TestDefaultParameterName:
    def test_value_of(self):
        assert DefaultParameterName.value_of("temperature") == DefaultParameterName.TEMPERATURE
        assert DefaultParameterName.value_of("top_p") == DefaultParameterName.TOP_P

        with pytest.raises(ValueError, match="invalid parameter name invalid"):
            DefaultParameterName.value_of("invalid")


class TestParameterType:
    def test_values(self):
        assert ParameterType.FLOAT == "float"
        assert ParameterType.INT == "int"
        assert ParameterType.STRING == "string"
        assert ParameterType.BOOLEAN == "boolean"
        assert ParameterType.TEXT == "text"


class TestModelPropertyKey:
    def test_values(self):
        assert ModelPropertyKey.MODE == "mode"
        assert ModelPropertyKey.CONTEXT_SIZE == "context_size"


class TestProviderModel:
    def test_provider_model(self):
        model = ProviderModel(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 8192},
        )
        assert model.model == "gpt-4"
        assert model.support_structure_output is False

        model_with_features = ProviderModel(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4"),
            model_type=ModelType.LLM,
            features=[ModelFeature.STRUCTURED_OUTPUT],
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 8192},
        )
        assert model_with_features.support_structure_output is True


class TestParameterRule:
    def test_parameter_rule(self):
        rule = ParameterRule(
            name="temperature",
            label=I18nObject(en_US="Temperature"),
            type=ParameterType.FLOAT,
            default=0.7,
            min=0.0,
            max=1.0,
            precision=2,
        )
        assert rule.name == "temperature"
        assert rule.default == 0.7


class TestPriceConfig:
    def test_price_config(self):
        config = PriceConfig(input=Decimal("0.01"), output=Decimal("0.02"), unit=Decimal("0.001"), currency="USD")
        assert config.input == Decimal("0.01")
        assert config.output == Decimal("0.02")


class TestAIModelEntity:
    def test_ai_model_entity_no_json_schema(self):
        entity = AIModelEntity(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 8192},
            parameter_rules=[
                ParameterRule(name="temperature", label=I18nObject(en_US="Temperature"), type=ParameterType.FLOAT)
            ],
        )
        assert ModelFeature.STRUCTURED_OUTPUT not in (entity.features or [])

    def test_ai_model_entity_with_json_schema(self):
        # Case: json_schema in parameter rules, features is None
        entity = AIModelEntity(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4"),
            model_type=ModelType.LLM,
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 8192},
            parameter_rules=[
                ParameterRule(name="json_schema", label=I18nObject(en_US="JSON Schema"), type=ParameterType.STRING)
            ],
        )
        assert ModelFeature.STRUCTURED_OUTPUT in entity.features

    def test_ai_model_entity_with_json_schema_and_features_empty(self):
        # Case: json_schema in parameter rules, features is empty list
        entity = AIModelEntity(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4"),
            model_type=ModelType.LLM,
            features=[],
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 8192},
            parameter_rules=[
                ParameterRule(name="json_schema", label=I18nObject(en_US="JSON Schema"), type=ParameterType.STRING)
            ],
        )
        assert ModelFeature.STRUCTURED_OUTPUT in entity.features

    def test_ai_model_entity_with_json_schema_and_other_features(self):
        # Case: json_schema in parameter rules, features has other things
        entity = AIModelEntity(
            model="gpt-4",
            label=I18nObject(en_US="GPT-4"),
            model_type=ModelType.LLM,
            features=[ModelFeature.VISION],
            fetch_from=FetchFrom.PREDEFINED_MODEL,
            model_properties={ModelPropertyKey.CONTEXT_SIZE: 8192},
            parameter_rules=[
                ParameterRule(name="json_schema", label=I18nObject(en_US="JSON Schema"), type=ParameterType.STRING)
            ],
        )
        assert ModelFeature.STRUCTURED_OUTPUT in entity.features
        assert ModelFeature.VISION in entity.features


class TestModelUsage:
    def test_model_usage(self):
        usage = ModelUsage()
        assert isinstance(usage, ModelUsage)


class TestPriceType:
    def test_values(self):
        assert PriceType.INPUT == "input"
        assert PriceType.OUTPUT == "output"


class TestPriceInfo:
    def test_price_info(self):
        info = PriceInfo(unit_price=Decimal("0.01"), unit=Decimal(1000), total_amount=Decimal("0.05"), currency="USD")
        assert info.total_amount == Decimal("0.05")
