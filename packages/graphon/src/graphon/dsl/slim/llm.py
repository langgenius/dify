from __future__ import annotations

import json
import logging
from collections.abc import Generator, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal, overload, override

from pydantic import StrictStr, TypeAdapter, ValidationError

from graphon.dsl.slim.client import SlimClient, SlimClientConfig, SlimClientError
from graphon.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageRole,
    PromptMessageTool,
    TextPromptMessageContent,
    VideoPromptMessageContent,
)
from graphon.model_runtime.entities.model_entities import AIModelEntity
from graphon.model_runtime.model_providers.base.large_language_model import (
    merge_tool_call_deltas,
)
from graphon.model_runtime.model_providers.base.tokenizers.gpt2_tokenizer import (
    GPT2Tokenizer,
)
from graphon.model_runtime.utils.encoders import jsonable_encoder
from graphon.nodes.llm.runtime_protocols import LLMProtocol

_ACTION_GET_LLM_NUM_TOKENS = "get_llm_num_tokens"
_ACTION_INVOKE_LLM = "invoke_llm"
_MODEL_TYPE_LLM = "llm"
_MISSING_STRUCTURED_OUTPUT_MESSAGE = (
    "Slim structured-output response is missing structured_output data"
)
_SLIM_TIMEOUT_ERROR_CODE = "killed_by_timeout"
_SLIM_TIMEOUT_ERROR_MESSAGE = "killed by timeout"

logger = logging.getLogger(__name__)

_OPTIONAL_STR_ADAPTER = TypeAdapter(StrictStr | None)
_STRUCTURED_OUTPUT_ADAPTER = TypeAdapter(dict[StrictStr, Any] | None)

_PROMPT_CONTENT_TYPE_TO_CLASS = {
    PromptMessageContentType.TEXT.value: TextPromptMessageContent,
    PromptMessageContentType.IMAGE.value: ImagePromptMessageContent,
    PromptMessageContentType.AUDIO.value: AudioPromptMessageContent,
    PromptMessageContentType.VIDEO.value: VideoPromptMessageContent,
    PromptMessageContentType.DOCUMENT.value: DocumentPromptMessageContent,
}


class SlimStructuredOutputParseError(ValueError):
    """Raised when a structured-output response cannot be validated."""


@dataclass(slots=True)
class _StructuredOutputAccumulator:
    structured_output: Mapping[str, Any] | None = None
    has_structured_output: bool = False

    def consume(self, structured_output: Mapping[str, Any] | None) -> None:
        if structured_output is None:
            return
        self.structured_output = structured_output
        self.has_structured_output = True

    def finalize(self, *, expect_structured_output: bool) -> Mapping[str, Any] | None:
        if self.has_structured_output:
            return self.structured_output
        if expect_structured_output:
            raise SlimStructuredOutputParseError(_MISSING_STRUCTURED_OUTPUT_MESSAGE)
        return None


@dataclass(slots=True)
class _CollectedLLMResult:
    content_text: str = ""
    content_parts: list[Any] = field(default_factory=list)
    usage: LLMUsage = field(default_factory=LLMUsage.empty_usage)
    tool_calls: list[AssistantPromptMessage.ToolCall] = field(default_factory=list)
    structured_output: Mapping[str, Any] | None = None
    system_fingerprint: str | None = None


class SlimLLM(LLMProtocol):
    """Standard Slim-backed LLM runtime.

    Slim actions are scoped by ``plugin_id`` first; ``provider`` is the
    plugin-internal provider name carried in the action payload, not a globally
    unique provider identifier. The runtime identity is therefore the pair
    ``(plugin_id, provider)``.
    """

    @override
    def __init__(
        self,
        *,
        config: SlimClientConfig,
        plugin_id: str,
        provider: str,
        model_name: str,
        credentials: Mapping[str, Any],
        parameters: Mapping[str, Any] | None = None,
        stop: Sequence[str] | None = None,
    ) -> None:
        self._plugin_id = plugin_id
        # Keep this as the plugin-local provider name. The Slim daemon receives
        # plugin_id out of band (for example, via "-id") and uses this payload
        # value to dispatch within that plugin. This is intentionally not the
        # full DSL provider path, so different plugins may reuse the same slug.
        self._provider = provider
        self._model_name = model_name
        self._credentials = dict(credentials)
        self._parameters: dict[str, Any] = dict(parameters or {})
        self._stop = list(stop) if stop is not None else None
        self._client = SlimClient(config=config)
        self._tokenizer = GPT2Tokenizer()

    @property
    @override
    def provider(self) -> str:
        return self._provider

    @property
    @override
    def model_name(self) -> str:
        return self._model_name

    @property
    @override
    def parameters(self) -> Mapping[str, Any]:
        return dict(self._parameters)

    @parameters.setter
    @override
    def parameters(self, value: Mapping[str, Any]) -> None:
        self._parameters = dict(value)

    @property
    @override
    def stop(self) -> Sequence[str] | None:
        return None if self._stop is None else list(self._stop)

    @override
    def get_model_schema(self) -> AIModelEntity:
        schema = self._client.get_ai_model_schema(
            plugin_id=self._plugin_id,
            provider=self._provider,
            model_type=_MODEL_TYPE_LLM,
            model=self._model_name,
            credentials=self._credentials,
        )
        if schema is None:
            msg = f"Model schema not found for {self._provider}/{self._model_name}"
            raise ValueError(msg)
        return schema

    @override
    def get_llm_num_tokens(self, prompt_messages: Sequence[PromptMessage]) -> int:
        try:
            result = self._invoke_unary_action(
                action=_ACTION_GET_LLM_NUM_TOKENS,
                data={
                    "provider": self._provider,
                    "model_type": _MODEL_TYPE_LLM,
                    "model": self._model_name,
                    "credentials": self._credentials,
                    "prompt_messages": _serialize_prompt_messages(prompt_messages),
                    "tools": [],
                },
            )
        except SlimClientError as error:
            if not _is_token_count_timeout(error):
                raise
            logger.info(
                "Slim token counting timed out for %s/%s; using local estimate",
                self._provider,
                self._model_name,
            )
            return _estimate_prompt_message_tokens(prompt_messages, self._tokenizer)
        return int(result["num_tokens"])

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResult: ...

    @overload
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunk, None, None]: ...

    @override
    def invoke_llm(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
    ) -> LLMResult | Generator[LLMResultChunk, None, None]:
        merged_parameters = dict(self._parameters)
        merged_parameters.update(model_parameters)
        return self._invoke_llm_internal(
            prompt_messages=prompt_messages,
            model_parameters=merged_parameters,
            tools=tools,
            stop=stop,
            stream=stream,
            expect_structured_output=False,
        )

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, Any],
        model_parameters: Mapping[str, Any],
        stop: Sequence[str] | None,
        stream: Literal[False],
    ) -> LLMResultWithStructuredOutput: ...

    @overload
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, Any],
        model_parameters: Mapping[str, Any],
        stop: Sequence[str] | None,
        stream: Literal[True],
    ) -> Generator[LLMResultChunkWithStructuredOutput, None, None]: ...

    @override
    def invoke_llm_with_structured_output(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        json_schema: Mapping[str, Any],
        model_parameters: Mapping[str, Any],
        stop: Sequence[str] | None,
        stream: bool,
    ) -> (
        LLMResultWithStructuredOutput
        | Generator[LLMResultChunkWithStructuredOutput, None, None]
    ):
        merged_parameters = dict(self._parameters)
        merged_parameters.update(model_parameters)
        merged_parameters["json_schema"] = json.dumps(dict(json_schema))
        return self._invoke_llm_internal(
            prompt_messages=prompt_messages,
            model_parameters=merged_parameters,
            tools=None,
            stop=stop,
            stream=stream,
            expect_structured_output=True,
        )

    @override
    def is_structured_output_parse_error(self, error: Exception) -> bool:
        _ = self
        return isinstance(error, SlimStructuredOutputParseError)

    @overload
    def _invoke_llm_internal(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[False],
        expect_structured_output: Literal[False],
    ) -> LLMResult: ...

    @overload
    def _invoke_llm_internal(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[True],
        expect_structured_output: Literal[False],
    ) -> Generator[LLMResultChunk, None, None]: ...

    @overload
    def _invoke_llm_internal(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[False],
        expect_structured_output: Literal[True],
    ) -> LLMResultWithStructuredOutput: ...

    @overload
    def _invoke_llm_internal(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: Literal[True],
        expect_structured_output: Literal[True],
    ) -> Generator[LLMResultChunkWithStructuredOutput, None, None]: ...

    def _invoke_llm_internal(
        self,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: Mapping[str, Any],
        tools: Sequence[PromptMessageTool] | None,
        stop: Sequence[str] | None,
        stream: bool,
        expect_structured_output: bool,
    ) -> (
        LLMResult
        | Generator[LLMResultChunk, None, None]
        | LLMResultWithStructuredOutput
        | Generator[LLMResultChunkWithStructuredOutput, None, None]
    ):
        effective_stop = stop if stop is not None else self._stop
        payload = {
            "provider": self._provider,
            "model_type": _MODEL_TYPE_LLM,
            "model": self._model_name,
            "credentials": self._credentials,
            "prompt_messages": _serialize_prompt_messages(prompt_messages),
            "model_parameters": dict(model_parameters),
            "stop": list(effective_stop or []),
            "tools": [jsonable_encoder(tool) for tool in tools or []],
            "stream": bool(stream),
        }
        chunks = self._invoke_action(action=_ACTION_INVOKE_LLM, data=payload)

        if expect_structured_output:
            structured_generator = _llm_chunk_generator(
                model=self._model_name,
                prompt_messages=prompt_messages,
                chunks=chunks,
                expect_structured_output=True,
            )
            if stream:
                return structured_generator
            return _collect_llm_result(
                model=self._model_name,
                prompt_messages=prompt_messages,
                chunks=structured_generator,
                expect_structured_output=True,
            )

        generator = _llm_chunk_generator(
            model=self._model_name,
            prompt_messages=prompt_messages,
            chunks=chunks,
            expect_structured_output=False,
        )
        if stream:
            return generator
        return _collect_llm_result(
            model=self._model_name,
            prompt_messages=prompt_messages,
            chunks=generator,
            expect_structured_output=False,
        )

    def _invoke_unary_action(
        self,
        *,
        action: str,
        data: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        payloads = list(self._invoke_action(action=action, data=data))
        if not payloads:
            return {}
        payload = payloads[-1]
        if not isinstance(payload, Mapping):
            msg = f"Expected dict payload for Slim action {action}, got {type(payload)}"
            raise TypeError(msg)
        return payload

    def _invoke_action(
        self,
        *,
        action: str,
        data: Mapping[str, Any],
    ) -> Iterable[Any]:
        return self._client.invoke_chunks(
            plugin_id=self._plugin_id,
            action=action,
            data=data,
        )


@overload
def _llm_chunk_generator(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunks: Iterable[Any],
    expect_structured_output: Literal[False],
) -> Generator[LLMResultChunk, None, None]: ...


@overload
def _llm_chunk_generator(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunks: Iterable[Any],
    expect_structured_output: Literal[True],
) -> Generator[LLMResultChunkWithStructuredOutput, None, None]: ...


def _llm_chunk_generator(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunks: Iterable[Any],
    expect_structured_output: bool,
) -> Generator[LLMResultChunk, None, None]:
    structured_output_accumulator = (
        _StructuredOutputAccumulator() if expect_structured_output else None
    )
    for chunk in chunks:
        if not isinstance(chunk, dict):
            msg = f"Unexpected LLM chunk payload: {chunk!r}"
            raise TypeError(msg)
        parsed_chunk = _parse_llm_chunk(
            model=model,
            prompt_messages=prompt_messages,
            chunk=chunk,
            expect_structured_output=expect_structured_output,
        )
        _consume_structured_output_chunk(
            chunk=parsed_chunk,
            accumulator=structured_output_accumulator,
        )
        yield parsed_chunk
    _finalize_structured_output(
        accumulator=structured_output_accumulator,
        expect_structured_output=expect_structured_output,
    )


@overload
def _collect_llm_result(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunks: Iterable[LLMResultChunk],
    expect_structured_output: Literal[False],
) -> LLMResult: ...


@overload
def _collect_llm_result(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunks: Iterable[LLMResultChunkWithStructuredOutput],
    expect_structured_output: Literal[True],
) -> LLMResultWithStructuredOutput: ...


def _collect_llm_result(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunks: Iterable[LLMResultChunk],
    expect_structured_output: bool,
) -> LLMResult:
    collected = _CollectedLLMResult()
    structured_output_accumulator = (
        _StructuredOutputAccumulator() if expect_structured_output else None
    )

    for chunk in chunks:
        _accumulate_llm_chunk(
            collected=collected,
            chunk=chunk,
            structured_output_accumulator=structured_output_accumulator,
        )

    collected.structured_output = _finalize_structured_output(
        accumulator=structured_output_accumulator,
        expect_structured_output=expect_structured_output,
    )

    assistant_message = AssistantPromptMessage(
        content=collected.content_text or collected.content_parts,
        tool_calls=collected.tool_calls,
    )
    if collected.structured_output is not None:
        return LLMResultWithStructuredOutput(
            model=model,
            prompt_messages=list(prompt_messages),
            message=assistant_message,
            usage=collected.usage,
            system_fingerprint=collected.system_fingerprint,
            structured_output=collected.structured_output,
        )
    return LLMResult(
        model=model,
        prompt_messages=list(prompt_messages),
        message=assistant_message,
        usage=collected.usage,
        system_fingerprint=collected.system_fingerprint,
    )


def _accumulate_llm_chunk(
    *,
    collected: _CollectedLLMResult,
    chunk: LLMResultChunk,
    structured_output_accumulator: _StructuredOutputAccumulator | None = None,
) -> None:
    delta_message = chunk.delta.message
    if isinstance(delta_message.content, str):
        collected.content_text += delta_message.content
    elif isinstance(delta_message.content, list):
        collected.content_parts.extend(delta_message.content)

    if delta_message.tool_calls:
        merge_tool_call_deltas(delta_message.tool_calls, collected.tool_calls)
    if chunk.delta.usage is not None:
        collected.usage = chunk.delta.usage
    _consume_structured_output_chunk(
        chunk=chunk,
        accumulator=structured_output_accumulator,
    )
    if chunk.system_fingerprint is not None:
        collected.system_fingerprint = chunk.system_fingerprint


def _consume_structured_output_chunk(
    *,
    chunk: LLMResultChunk,
    accumulator: _StructuredOutputAccumulator | None,
) -> None:
    if accumulator is None or not isinstance(chunk, LLMResultChunkWithStructuredOutput):
        return
    accumulator.consume(chunk.structured_output)


def _finalize_structured_output(
    *,
    accumulator: _StructuredOutputAccumulator | None,
    expect_structured_output: bool,
) -> Mapping[str, Any] | None:
    if accumulator is None:
        return None
    return accumulator.finalize(expect_structured_output=expect_structured_output)


@overload
def _parse_llm_chunk(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunk: dict[str, Any],
    expect_structured_output: Literal[False],
) -> LLMResultChunk: ...


@overload
def _parse_llm_chunk(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunk: dict[str, Any],
    expect_structured_output: Literal[True],
) -> LLMResultChunkWithStructuredOutput: ...


def _parse_llm_chunk(
    *,
    model: str,
    prompt_messages: Sequence[PromptMessage],
    chunk: dict[str, Any],
    expect_structured_output: bool,
) -> LLMResultChunk:
    delta_payload = chunk.get("delta") or {}
    if not isinstance(delta_payload, Mapping):
        msg = f"Unexpected LLM delta payload: {delta_payload!r}"
        raise TypeError(msg)
    message = _deserialize_assistant_prompt_message(
        delta_payload.get("message") or {},
    )
    delta = LLMResultChunkDelta(
        index=int(delta_payload.get("index", 0)),
        message=message,
        usage=_parse_optional_llm_usage(delta_payload.get("usage")),
        finish_reason=_OPTIONAL_STR_ADAPTER.validate_python(
            delta_payload.get("finish_reason"),
        ),
    )
    system_fingerprint = _OPTIONAL_STR_ADAPTER.validate_python(
        chunk.get("system_fingerprint"),
    )
    if expect_structured_output:
        try:
            structured_output = _STRUCTURED_OUTPUT_ADAPTER.validate_python(
                chunk.get("structured_output"),
            )
        except ValidationError as error:
            msg = "Invalid structured_output payload"
            raise SlimStructuredOutputParseError(msg) from error
        return LLMResultChunkWithStructuredOutput(
            model=model,
            prompt_messages=list(prompt_messages),
            system_fingerprint=system_fingerprint,
            delta=delta,
            structured_output=structured_output,
        )
    return LLMResultChunk(
        model=model,
        prompt_messages=list(prompt_messages),
        system_fingerprint=system_fingerprint,
        delta=delta,
    )


def _serialize_prompt_messages(
    prompt_messages: Sequence[PromptMessage],
) -> list[dict[str, Any]]:
    return [jsonable_encoder(item) for item in prompt_messages]


def _estimate_prompt_message_tokens(
    prompt_messages: Sequence[PromptMessage], tokenizer: GPT2Tokenizer
) -> int:
    # Fallback estimate only considers text content. Multimodal token accounting
    # remains provider-specific and should use Slim token counting when available.
    text = "\n".join(
        f"{message.role.value}: {message.get_text_content()}"
        for message in prompt_messages
    )
    if not text:
        return 0
    try:
        return tokenizer.get_num_tokens(text)
    except Exception:  # ruff:ignore[blind-except]
        return max(1, len(text) // 4)


def _is_token_count_timeout(error: SlimClientError) -> bool:
    if error.code == _SLIM_TIMEOUT_ERROR_CODE:
        return True
    return _SLIM_TIMEOUT_ERROR_MESSAGE in error.message


def _normalize_prompt_message_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    normalized_payload = dict(payload)
    content = normalized_payload.get("content")
    if isinstance(content, list):
        converted_content = []
        for item in content:
            if not isinstance(item, dict):
                converted_content.append(item)
                continue
            content_cls = _PROMPT_CONTENT_TYPE_TO_CLASS.get(item.get("type"))
            if content_cls is None:
                converted_content.append(item)
                continue
            converted_content.append(content_cls.model_validate(item))
        normalized_payload["content"] = converted_content
    return normalized_payload


def _deserialize_assistant_prompt_message(
    payload: Mapping[str, Any],
) -> AssistantPromptMessage:
    normalized_payload = _normalize_prompt_message_payload(payload)
    normalized_payload["role"] = PromptMessageRole.ASSISTANT.value
    return AssistantPromptMessage.model_validate(normalized_payload)


def _parse_optional_llm_usage(payload: object) -> LLMUsage | None:
    if payload is None:
        return None
    if not isinstance(payload, Mapping):
        msg = f"Unexpected LLM usage payload: {payload!r}"
        raise TypeError(msg)
    normalized_payload: dict[str, object] = {}
    for key, value in payload.items():
        if not isinstance(key, str):
            msg = f"Unexpected LLM usage payload key: {key!r}"
            raise TypeError(msg)
        normalized_payload[key] = value
    return LLMUsage.from_metadata(normalized_payload)
