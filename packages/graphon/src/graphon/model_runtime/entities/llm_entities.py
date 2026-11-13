from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import Decimal
from enum import StrEnum
from typing import Any, Self, TypedDict

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StrictFloat,
    StrictInt,
    TypeAdapter,
    field_validator,
    model_validator,
)

from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
)
from graphon.model_runtime.entities.model_entities import ModelUsage, PriceInfo


class LLMMode(StrEnum):
    """Enum class for large language model mode."""

    COMPLETION = "completion"
    CHAT = "chat"


class LLMUsageMetadata(TypedDict, total=False):
    """TypedDict for LLM usage metadata.
    All fields are optional.
    """

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    prompt_unit_price: float | str
    completion_unit_price: float | str
    total_price: float | str
    currency: str
    prompt_price_unit: float | str
    completion_price_unit: float | str
    prompt_price: float | str
    completion_price: float | str
    latency: float
    time_to_first_token: float
    time_to_generate: float


class _LLMUsageMetadataInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    prompt_tokens: StrictInt = 0
    completion_tokens: StrictInt = 0
    total_tokens: StrictInt = 0
    prompt_unit_price: Decimal = Decimal(0)
    completion_unit_price: Decimal = Decimal(0)
    total_price: Decimal = Decimal(0)
    currency: str = "USD"
    prompt_price_unit: Decimal = Decimal(0)
    completion_price_unit: Decimal = Decimal(0)
    prompt_price: Decimal = Decimal(0)
    completion_price: Decimal = Decimal(0)
    latency: StrictInt | StrictFloat = 0.0
    time_to_first_token: StrictInt | StrictFloat | None = None
    time_to_generate: StrictInt | StrictFloat | None = None

    @field_validator("currency", mode="before")
    @classmethod
    def _normalize_currency(cls, value: object) -> str:
        return str(value)

    @model_validator(mode="after")
    def _derive_total_tokens(self) -> _LLMUsageMetadataInput:
        if self.total_tokens == 0 and (
            self.prompt_tokens > 0 or self.completion_tokens > 0
        ):
            self.total_tokens = self.prompt_tokens + self.completion_tokens
        return self


_LLM_USAGE_METADATA_INPUT_ADAPTER = TypeAdapter(_LLMUsageMetadataInput)


class LLMUsage(ModelUsage):
    """Model class for llm usage."""

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
    time_to_first_token: float | None = None
    time_to_generate: float | None = None

    @classmethod
    def empty_usage(cls) -> Self:
        return cls(
            prompt_tokens=0,
            prompt_unit_price=Decimal("0.0"),
            prompt_price_unit=Decimal("0.0"),
            prompt_price=Decimal("0.0"),
            completion_tokens=0,
            completion_unit_price=Decimal("0.0"),
            completion_price_unit=Decimal("0.0"),
            completion_price=Decimal("0.0"),
            total_tokens=0,
            total_price=Decimal("0.0"),
            currency="USD",
            latency=0.0,
            time_to_first_token=None,
            time_to_generate=None,
        )

    @classmethod
    def from_metadata(cls, metadata: Mapping[str, object]) -> LLMUsage:
        """Create LLMUsage instance from metadata dictionary with default values.

        Args:
            metadata: TypedDict containing usage metadata

        Returns:
            LLMUsage instance with values from metadata or defaults

        """
        normalized_metadata = _LLM_USAGE_METADATA_INPUT_ADAPTER.validate_python(
            metadata,
        )
        payload = normalized_metadata.model_dump(mode="python")
        payload["latency"] = float(normalized_metadata.latency)
        payload["time_to_first_token"] = (
            float(normalized_metadata.time_to_first_token)
            if normalized_metadata.time_to_first_token is not None
            else None
        )
        payload["time_to_generate"] = (
            float(normalized_metadata.time_to_generate)
            if normalized_metadata.time_to_generate is not None
            else None
        )
        return cls.model_validate(payload)

    def plus(self, other: LLMUsage) -> LLMUsage:
        """Add two LLMUsage instances together.

        :param other: Another LLMUsage instance to add

        Returns:
            A new `LLMUsage` instance with summed counters and pricing data.

        """
        if self.total_tokens == 0:
            return other
        return LLMUsage(
            prompt_tokens=self.prompt_tokens + other.prompt_tokens,
            prompt_unit_price=other.prompt_unit_price,
            prompt_price_unit=other.prompt_price_unit,
            prompt_price=self.prompt_price + other.prompt_price,
            completion_tokens=self.completion_tokens + other.completion_tokens,
            completion_unit_price=other.completion_unit_price,
            completion_price_unit=other.completion_price_unit,
            completion_price=self.completion_price + other.completion_price,
            total_tokens=self.total_tokens + other.total_tokens,
            total_price=self.total_price + other.total_price,
            currency=other.currency,
            latency=self.latency + other.latency,
            time_to_first_token=other.time_to_first_token,
            time_to_generate=other.time_to_generate,
        )

    def __add__(self, other: LLMUsage) -> LLMUsage:
        """Overload the + operator to add two LLMUsage instances.

        :param other: Another LLMUsage instance to add

        Returns:
            A new `LLMUsage` instance with summed counters and pricing data.

        """
        return self.plus(other)


class LLMResult(BaseModel):
    """Model class for llm result."""

    id: str | None = None
    model: str
    prompt_messages: Sequence[PromptMessage] = Field(default_factory=list)
    message: AssistantPromptMessage
    usage: LLMUsage
    system_fingerprint: str | None = None
    reasoning_content: str | None = None


class LLMStructuredOutput(BaseModel):
    """Model class for llm structured output."""

    structured_output: Mapping[str, Any] | None = None


class LLMResultWithStructuredOutput(LLMResult, LLMStructuredOutput):
    """Model class for llm result with structured output."""


class LLMPollingStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class LLMPollingResult(BaseModel):
    status: LLMPollingStatus
    plugin_state: dict[str, JsonValue] | None = None
    result: LLMResult | LLMResultWithStructuredOutput | None = None
    error: str | None = None
    next_check_after_seconds: StrictInt | None = Field(default=None, ge=1)
    expires_after_seconds: StrictInt | None = Field(default=None, ge=1)
    max_attempts: StrictInt | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _validate_status_payload(self) -> LLMPollingResult:
        if self.status == LLMPollingStatus.RUNNING and not self.plugin_state:
            msg = "plugin_state is required when polling status is running."
            raise ValueError(msg)
        if self.status == LLMPollingStatus.SUCCEEDED and self.result is None:
            msg = "result is required when polling status is succeeded."
            raise ValueError(msg)
        if self.status == LLMPollingStatus.FAILED:
            if self.error is None or not self.error.strip():
                msg = "error is required when polling status is failed."
                raise ValueError(msg)
            self.error = self.error.strip()
        return self


class LLMPollingConfig(BaseModel):
    min_check_interval_seconds: float = Field(default=1.0, gt=0)
    max_check_interval_seconds: float = Field(default=30.0, gt=0)
    max_wait_seconds: float = Field(default=7200.0, gt=0)
    max_attempts: int = Field(default=240, ge=1)
    wake_interval_seconds: float = Field(default=1.0, gt=0)

    @model_validator(mode="after")
    def _validate_intervals(self) -> LLMPollingConfig:
        if self.max_check_interval_seconds < self.min_check_interval_seconds:
            msg = (
                "max_check_interval_seconds must be greater than or equal to "
                "min_check_interval_seconds"
            )
            raise ValueError(msg)
        return self


class LLMResultChunkDelta(BaseModel):
    """Model class for llm result chunk delta."""

    index: int
    message: AssistantPromptMessage
    usage: LLMUsage | None = None
    finish_reason: str | None = None


class LLMResultChunk(BaseModel):
    """Model class for llm result chunk."""

    model: str
    prompt_messages: Sequence[PromptMessage] = Field(default_factory=list)
    system_fingerprint: str | None = None
    delta: LLMResultChunkDelta


class LLMResultChunkWithStructuredOutput(LLMResultChunk, LLMStructuredOutput):
    """Model class for llm result chunk with structured output."""


class NumTokensResult(PriceInfo):
    """Model class for number of tokens result."""

    tokens: int
