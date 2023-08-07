import enum
from typing import Optional

from langchain.load.serializable import Serializable
from pydantic import BaseModel


class ModelMode(enum.Enum):
    COMPLETION = 'completion'
    CHAT = 'chat'


class ModelType(enum.Enum):
    TEXT_GENERATION = 'text-generation'
    EMBEDDINGS = 'embeddings'
    SPEECH_TO_TEXT = 'speech-to-text'
    IMAGE = 'image'
    VIDEO = 'video'
    MODERATION = 'moderation'

    @staticmethod
    def value_of(value):
        for member in ModelType:
            if member.value == value:
                return member
        raise ValueError(f"No matching enum found for value '{value}'")


class ModelKwargs(BaseModel):
    max_tokens: Optional[int]
    temperature: Optional[float]
    top_p: Optional[float]
    presence_penalty: Optional[float]
    frequency_penalty: Optional[float]


class KwargRuleType(enum.Enum):
    STRING = 'string'
    INTEGER = 'integer'
    FLOAT = 'float'


class KwargRule(Serializable, BaseModel):
    enabled: bool = True
    min: Optional[float] = None
    max: Optional[float] = None
    default: Optional[float] = None
    alias: Optional[str] = None


class ModelKwargsRules(Serializable, BaseModel):
    max_tokens: KwargRule = KwargRule(enabled=False)
    temperature: KwargRule = KwargRule(enabled=False)
    top_p: KwargRule = KwargRule(enabled=False)
    presence_penalty: KwargRule = KwargRule(enabled=False)
    frequency_penalty: KwargRule = KwargRule(enabled=False)
