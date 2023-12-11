from decimal import Decimal
from enum import Enum
from typing import Optional

from pydantic import BaseModel

from core.model_runtime.entities.message_entities import AssistantPromptMessage
from core.model_runtime.entities.model_entities import ModelUsage, PriceInfo


class LLMMode(Enum):
    """
    Enum class for large language model mode.
    """
    COMPLETION = "completion"
    CHAT = "chat"

    @classmethod
    def value_of(cls, value: str) -> 'LLMMode':
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f'invalid mode value {value}')


class LLMUsage(ModelUsage):
    """
    Model class for llm usage.
    """
    prompt_tokens: int
    prompt_unit_price: Decimal
    prompt_price_unit: Decimal
    prompt_price: Decimal
    completion_tokens: int
    completion_unit_price: Decimal
    completion_price_unit: Decimal
    completion_price: Decimal
    total_tokens: int
    total_price: Decimal
    currency: str
    latency: float


class LLMResult(BaseModel):
    """
    Model class for llm result.
    """
    model: str
    message: AssistantPromptMessage
    usage: LLMUsage
    system_fingerprint: Optional[str] = None


class LLMResultChunkDelta(BaseModel):
    """
    Model class for llm result chunk delta.
    """
    index: int
    message: AssistantPromptMessage
    usage: Optional[LLMUsage] = None
    finish_reason: Optional[str] = None


class LLMResultChunk(BaseModel):
    """
    Model class for llm result chunk.
    """
    model: str
    system_fingerprint: Optional[str] = None
    delta: LLMResultChunkDelta


class NumTokensResult(PriceInfo):
    """
    Model class for number of tokens result.
    """
    tokens: int
