from __future__ import annotations

from decimal import Decimal
from enum import StrEnum, auto
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator

from core.model_runtime.entities.common_entities import I18nObject


class ModelType(StrEnum):
    """
    Enum class for model type.
    """

    LLM = auto()
    TEXT_EMBEDDING = "text-embedding"
    RERANK = auto()
    SPEECH2TEXT = auto()
    MODERATION = auto()
    TTS = auto()

    @classmethod
    def value_of(cls, origin_model_type: str) -> ModelType:
        """
        Get model type from origin model type.

        :return: model type
        """
        if origin_model_type in {"text-generation", cls.LLM}:
            return cls.LLM
        elif origin_model_type in {"embeddings", cls.TEXT_EMBEDDING}:
            return cls.TEXT_EMBEDDING
        elif origin_model_type in {"reranking", cls.RERANK}:
            return cls.RERANK
        elif origin_model_type in {"speech2text", cls.SPEECH2TEXT}:
            return cls.SPEECH2TEXT
        elif origin_model_type in {"tts", cls.TTS}:
            return cls.TTS
        elif origin_model_type == cls.MODERATION:
            return cls.MODERATION
        else:
            raise ValueError(f"invalid origin model type {origin_model_type}")

    def to_origin_model_type(self) -> str:
        """
        Get origin model type from model type.

        :return: origin model type
        """
        if self == self.LLM:
            return "text-generation"
        elif self == self.TEXT_EMBEDDING:
            return "embeddings"
        elif self == self.RERANK:
            return "reranking"
        elif self == self.SPEECH2TEXT:
            return "speech2text"
        elif self == self.TTS:
            return "tts"
        elif self == self.MODERATION:
            return "moderation"
        else:
            raise ValueError(f"invalid model type {self}")


class FetchFrom(StrEnum):
    """
    Enum class for fetch from.
    """

    PREDEFINED_MODEL = "predefined-model"
    CUSTOMIZABLE_MODEL = "customizable-model"


class ModelFeature(StrEnum):
    """
    Enum class for llm feature.
    """

    TOOL_CALL = "tool-call"
    MULTI_TOOL_CALL = "multi-tool-call"
    AGENT_THOUGHT = "agent-thought"
    VISION = auto()
    STREAM_TOOL_CALL = "stream-tool-call"
    DOCUMENT = auto()
    VIDEO = auto()
    AUDIO = auto()
    STRUCTURED_OUTPUT = "structured-output"


class DefaultParameterName(StrEnum):
    """
    Enum class for parameter template variable.
    """

    TEMPERATURE = auto()
    TOP_P = auto()
    TOP_K = auto()
    PRESENCE_PENALTY = auto()
    FREQUENCY_PENALTY = auto()
    MAX_TOKENS = auto()
    RESPONSE_FORMAT = auto()
    JSON_SCHEMA = auto()

    @classmethod
    def value_of(cls, value: Any) -> DefaultParameterName:
        """
        Get parameter name from value.

        :param value: parameter value
        :return: parameter name
        """
        for name in cls:
            if name.value == value:
                return name
        raise ValueError(f"invalid parameter name {value}")


class ParameterType(StrEnum):
    """
    Enum class for parameter type.
    """

    FLOAT = auto()
    INT = auto()
    STRING = auto()
    BOOLEAN = auto()
    TEXT = auto()


class ModelPropertyKey(StrEnum):
    """
    Enum class for model property key.
    """

    MODE = auto()
    CONTEXT_SIZE = auto()
    MAX_CHUNKS = auto()
    FILE_UPLOAD_LIMIT = auto()
    SUPPORTED_FILE_EXTENSIONS = auto()
    MAX_CHARACTERS_PER_CHUNK = auto()
    DEFAULT_VOICE = auto()
    VOICES = auto()
    WORD_LIMIT = auto()
    AUDIO_TYPE = auto()
    MAX_WORKERS = auto()


class ProviderModel(BaseModel):
    """
    Model class for provider model.
    """

    model: str
    label: I18nObject
    model_type: ModelType
    features: list[ModelFeature] | None = None
    fetch_from: FetchFrom
    model_properties: dict[ModelPropertyKey, Any]
    deprecated: bool = False
    model_config = ConfigDict(protected_namespaces=())

    @property
    def support_structure_output(self) -> bool:
        return self.features is not None and ModelFeature.STRUCTURED_OUTPUT in self.features


class ParameterRule(BaseModel):
    """
    Model class for parameter rule.
    """

    name: str
    use_template: str | None = None
    label: I18nObject
    type: ParameterType
    help: I18nObject | None = None
    required: bool = False
    default: Any | None = None
    min: float | None = None
    max: float | None = None
    precision: int | None = None
    options: list[str] = []


class PriceConfig(BaseModel):
    """
    Model class for pricing info.
    """

    input: Decimal
    output: Decimal | None = None
    unit: Decimal
    currency: str


class AIModelEntity(ProviderModel):
    """
    Model class for AI model.
    """

    parameter_rules: list[ParameterRule] = []
    pricing: PriceConfig | None = None

    @model_validator(mode="after")
    def validate_model(self):
        supported_schema_keys = ["json_schema"]
        schema_key = next((rule.name for rule in self.parameter_rules if rule.name in supported_schema_keys), None)
        if not schema_key:
            return self
        if self.features is None:
            self.features = [ModelFeature.STRUCTURED_OUTPUT]
        else:
            if ModelFeature.STRUCTURED_OUTPUT not in self.features:
                self.features.append(ModelFeature.STRUCTURED_OUTPUT)
        return self


class ModelUsage(BaseModel):
    pass


class PriceType(StrEnum):
    """
    Enum class for price type.
    """

    INPUT = auto()
    OUTPUT = auto()


class PriceInfo(BaseModel):
    """
    Model class for price info.
    """

    unit_price: Decimal
    unit: Decimal
    total_amount: Decimal
    currency: str
