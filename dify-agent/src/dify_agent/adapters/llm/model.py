"""Bridge Dify plugin-daemon LLM invocations into Pydantic AI's model interface.

The API and agent layers are clients of the plugin daemon, not direct hosts of provider SDK
implementations. This adapter therefore targets the plugin-daemon dispatch protocol and maps
Pydantic AI messages into the daemon's Graphon-compatible request and stream response schema.
"""

from __future__ import annotations

import base64
import re
from collections.abc import AsyncGenerator, AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from dataclasses import KW_ONLY, InitVar, dataclass, field
from datetime import datetime, timezone
from typing import cast

from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    AudioPromptMessageContent,
    DocumentPromptMessageContent,
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentUnionTypes,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
    ToolPromptMessage,
    UserPromptMessage,
    VideoPromptMessageContent,
)
from typing_extensions import assert_never, override

from pydantic_ai._parts_manager import ModelResponsePartsManager
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import (
    AudioUrl,
    BinaryContent,
    BuiltinToolCallPart,
    BuiltinToolReturnPart,
    CachePoint,
    CompactionPart,
    DocumentUrl,
    FilePart,
    FinishReason,
    ImageUrl,
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ModelResponsePart,
    ModelResponseStreamEvent,
    MultiModalContent,
    RetryPromptPart,
    SystemPromptPart,
    TextContent,
    TextPart,
    ThinkingPart,
    ToolCallPart,
    ToolReturnPart,
    UploadedFile,
    UserContent,
    UserPromptPart,
    VideoUrl,
)
from pydantic_ai.models import Model, ModelRequestParameters, StreamedResponse
from pydantic_ai.profiles import ModelProfileSpec
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage

from .provider import DifyPluginDaemonLLMClient, DifyPluginDaemonProvider

_THINK_START = "<think>\n"
_THINK_END = "\n</think>"
_THINK_OPEN_TAG = "<think>"
_THINK_CLOSE_TAG = "</think>"
_THINK_TAG_PATTERN = re.compile(r"<think>(.*?)</think>", re.DOTALL)
_DETAIL_HIGH = "high"


@dataclass(slots=True)
class _DifyRequestInput:
    credentials: dict[str, object]
    prompt_messages: list[PromptMessage]
    model_parameters: dict[str, object]
    tools: list[PromptMessageTool] | None
    stop_sequences: list[str] | None


@dataclass(slots=True)
class DifyLLMAdapterModel(Model[DifyPluginDaemonLLMClient]):
    """Use a Dify plugin-daemon transport plus request-level model identity."""

    model: str
    daemon_provider: DifyPluginDaemonProvider
    _: KW_ONLY
    model_provider: str
    credentials: dict[str, object] = field(default_factory=dict, repr=False)
    model_profile: InitVar[ModelProfileSpec | None] = None
    model_settings: InitVar[ModelSettings | None] = None

    def __post_init__(
        self,
        model_profile: ModelProfileSpec | None,
        model_settings: ModelSettings | None,
    ) -> None:
        Model.__init__(
            self,
            settings=model_settings,
            profile=model_profile or self.daemon_provider.model_profile(self.model),
        )

    @property
    @override
    def provider(self) -> DifyPluginDaemonProvider:
        return self.daemon_provider

    @property
    @override
    def model_name(self) -> str:
        return self.model

    @property
    @override
    def system(self) -> str:
        return self.daemon_provider.name

    @override
    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        prepared_settings, prepared_params = self.prepare_request(model_settings, model_request_parameters)
        request_input = self._build_request_input(messages, prepared_settings, prepared_params)

        response = DifyStreamedResponse(
            model_request_parameters=prepared_params,
            chunks=self.daemon_provider.client.iter_llm_result_chunks(
                provider=self.model_provider,
                model=self.model_name,
                credentials=request_input.credentials,
                prompt_messages=request_input.prompt_messages,
                model_parameters=request_input.model_parameters,
                tools=request_input.tools,
                stop=request_input.stop_sequences,
                stream=False,
            ),
            response_model_name=self.model_name,
            provider_name_value=self.system,
        )
        async for _event in response:
            pass
        return response.get()

    @asynccontextmanager
    @override
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        run_context: object | None = None,
    ) -> AsyncGenerator[StreamedResponse, None]:
        del run_context
        prepared_settings, prepared_params = self.prepare_request(model_settings, model_request_parameters)
        request_input = self._build_request_input(messages, prepared_settings, prepared_params)

        yield DifyStreamedResponse(
            model_request_parameters=prepared_params,
            chunks=self.daemon_provider.client.iter_llm_result_chunks(
                provider=self.model_provider,
                model=self.model_name,
                credentials=request_input.credentials,
                prompt_messages=request_input.prompt_messages,
                model_parameters=request_input.model_parameters,
                tools=request_input.tools,
                stop=request_input.stop_sequences,
                stream=True,
            ),
            response_model_name=self.model_name,
            provider_name_value=self.system,
        )

    def _build_request_input(
        self,
        messages: Sequence[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> _DifyRequestInput:
        return _DifyRequestInput(
            credentials=dict(self.credentials),
            prompt_messages=_map_messages_to_prompt_messages(messages, model_request_parameters),
            model_parameters=_map_model_settings_to_parameters(model_settings),
            tools=_map_tool_definitions_to_prompt_tools(model_request_parameters),
            stop_sequences=_get_stop_sequences(model_settings),
        )


@dataclass
class DifyStreamedResponse(StreamedResponse):
    chunks: AsyncIterator[LLMResultChunk]
    response_model_name: str
    provider_name_value: str
    _timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    _embedded_thinking_parser: "_EmbeddedThinkingParser" = field(default_factory=lambda: _EmbeddedThinkingParser())

    @override
    async def _get_event_iterator(self) -> AsyncIterator[ModelResponseStreamEvent]:
        async for chunk in self.chunks:
            if chunk.delta.usage is not None:
                self._usage: RequestUsage = _map_usage(chunk.delta.usage)
            if chunk.delta.finish_reason is not None:
                self.finish_reason: FinishReason | None = _normalize_finish_reason(chunk.delta.finish_reason)

            for event in _chunk_to_stream_events(
                self._parts_manager,
                chunk,
                self.provider_name_value,
                self._embedded_thinking_parser,
            ):
                yield event

        for event in self._embedded_thinking_parser.flush(self._parts_manager, self.provider_name_value):
            yield event

    @property
    @override
    def model_name(self) -> str:
        return self.response_model_name

    @property
    @override
    def provider_name(self) -> str:
        return self.provider_name_value

    @property
    @override
    def provider_url(self) -> None:
        return None

    @property
    @override
    def timestamp(self) -> datetime:
        return self._timestamp


def _map_messages_to_prompt_messages(
    messages: Sequence[ModelMessage],
    model_request_parameters: ModelRequestParameters,
) -> list[PromptMessage]:
    prompt_messages: list[PromptMessage] = []

    for message in messages:
        if isinstance(message, ModelRequest):
            prompt_messages.extend(_map_model_request_to_prompt_messages(message))
        elif isinstance(message, ModelResponse):
            assistant_message = _map_model_response_to_prompt_message(message)
            if assistant_message is not None:
                prompt_messages.append(assistant_message)
        else:
            assert_never(message)

    instruction_messages = [
        SystemPromptMessage(content=part.content)
        for part in (Model._get_instruction_parts(messages, model_request_parameters) or [])
        if part.content.strip()
    ]
    if instruction_messages:
        insert_at = next(
            (index for index, message in enumerate(prompt_messages) if not isinstance(message, SystemPromptMessage)),
            len(prompt_messages),
        )
        prompt_messages[insert_at:insert_at] = instruction_messages

    return prompt_messages


def _map_model_request_to_prompt_messages(message: ModelRequest) -> list[PromptMessage]:
    prompt_messages: list[PromptMessage] = []

    for part in message.parts:
        if isinstance(part, SystemPromptPart):
            prompt_messages.append(SystemPromptMessage(content=part.content))
        elif isinstance(part, UserPromptPart):
            prompt_messages.append(UserPromptMessage(content=_map_user_prompt_content(part.content)))
        elif isinstance(part, ToolReturnPart):
            prompt_messages.append(_map_tool_return_part_to_prompt_message(part))
        elif isinstance(part, RetryPromptPart):
            if part.tool_name is None:
                prompt_messages.append(UserPromptMessage(content=part.model_response()))
            else:
                prompt_messages.append(
                    ToolPromptMessage(
                        content=part.model_response(),
                        tool_call_id=part.tool_call_id,
                        name=part.tool_name,
                    )
                )
        else:
            assert_never(part)

    return prompt_messages


def _map_tool_return_part_to_prompt_message(part: ToolReturnPart) -> ToolPromptMessage:
    items = part.content_items(mode="str")
    if len(items) == 1 and isinstance(items[0], str):
        content: str | list[PromptMessageContentUnionTypes] | None = items[0]
    else:
        content_items: list[PromptMessageContentUnionTypes] = []
        for item in items:
            if isinstance(item, str):
                content_items.append(TextPromptMessageContent(data=item))
            elif isinstance(item, CachePoint):
                continue
            elif _is_multi_modal_content(item):
                content_items.append(_map_multi_modal_user_content(item))
            else:
                raise UnexpectedModelBehavior(f"Unsupported daemon tool message content: {type(item).__name__}")
        content = content_items or None

    return ToolPromptMessage(content=content, tool_call_id=part.tool_call_id, name=part.tool_name)


def _map_model_response_to_prompt_message(
    message: ModelResponse,
) -> AssistantPromptMessage | None:
    """Map prior assistant output into daemon prompt history.

    The plugin daemon requires ``PromptMessage.content`` to be present even when
    an assistant turn contains only tool calls. Tool-call-only assistant history
    therefore uses the empty string instead of ``null`` so the second request in
    a tool round trip remains schema-compatible.
    """
    content_parts: list[PromptMessageContentUnionTypes] = []
    tool_calls: list[AssistantPromptMessage.ToolCall] = []

    for part in message.parts:
        if isinstance(part, TextPart):
            if part.content:
                content_parts.append(TextPromptMessageContent(data=part.content))
        elif isinstance(part, ThinkingPart):
            if part.content:
                content_parts.append(TextPromptMessageContent(data=f"{_THINK_START}{part.content}{_THINK_END}"))
        elif isinstance(part, FilePart):
            content_parts.append(_map_binary_content_to_prompt_content(part.content))
        elif isinstance(part, ToolCallPart):
            tool_calls.append(
                AssistantPromptMessage.ToolCall(
                    id=part.tool_call_id or f"tool-call-{part.tool_name}",
                    type="function",
                    function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                        name=part.tool_name,
                        arguments=part.args_as_json_str(),
                    ),
                )
            )
        elif isinstance(part, BuiltinToolCallPart | BuiltinToolReturnPart | CompactionPart):
            raise UnexpectedModelBehavior(f"Unsupported response part for daemon adapter: {type(part).__name__}")
        else:
            assert_never(part)

    content = _normalize_prompt_content(content_parts)
    if content is None and not tool_calls:
        return None
    if content is None:
        content = ""

    return AssistantPromptMessage(content=content, tool_calls=tool_calls)


def _map_user_prompt_content(
    content: str | Sequence[UserContent],
) -> str | list[PromptMessageContentUnionTypes] | None:
    if isinstance(content, str):
        return content

    prompt_content: list[PromptMessageContentUnionTypes] = []
    for item in content:
        if isinstance(item, CachePoint):
            continue
        if isinstance(item, str):
            prompt_content.append(TextPromptMessageContent(data=item))
        elif isinstance(item, TextContent):
            prompt_content.append(TextPromptMessageContent(data=item.content))
        elif _is_multi_modal_content(item):
            prompt_content.append(_map_multi_modal_user_content(item))
        else:
            raise UnexpectedModelBehavior(f"Unsupported user prompt content: {type(item).__name__}")
    return _normalize_prompt_content(prompt_content)


def _is_multi_modal_content(item: object) -> bool:
    return isinstance(
        item,
        ImageUrl | AudioUrl | DocumentUrl | VideoUrl | BinaryContent | UploadedFile,
    )


def _map_multi_modal_user_content(
    item: MultiModalContent,
) -> PromptMessageContentUnionTypes:
    if isinstance(item, ImageUrl):
        detail = (
            ImagePromptMessageContent.DETAIL.HIGH
            if _get_detail(item) == _DETAIL_HIGH
            else ImagePromptMessageContent.DETAIL.LOW
        )
        return ImagePromptMessageContent(
            url=item.url,
            mime_type=item.media_type,
            format=item.format,
            filename=f"{item.identifier}.{item.format}",
            detail=detail,
        )
    if isinstance(item, AudioUrl):
        return AudioPromptMessageContent(
            url=item.url,
            mime_type=item.media_type,
            format=item.format,
            filename=f"{item.identifier}.{item.format}",
        )
    if isinstance(item, VideoUrl):
        return VideoPromptMessageContent(
            url=item.url,
            mime_type=item.media_type,
            format=item.format,
            filename=f"{item.identifier}.{item.format}",
        )
    if isinstance(item, DocumentUrl):
        return DocumentPromptMessageContent(
            url=item.url,
            mime_type=item.media_type,
            format=item.format,
            filename=f"{item.identifier}.{item.format}",
        )
    if isinstance(item, BinaryContent):
        return _map_binary_content_to_prompt_content(item)
    if isinstance(item, UploadedFile):
        raise UnexpectedModelBehavior("UploadedFile content is not supported by the daemon adapter")
    assert_never(item)


def _map_binary_content_to_prompt_content(
    item: BinaryContent,
) -> PromptMessageContentUnionTypes:
    filename = f"{item.identifier}.{item.format}"
    if item.is_image:
        detail = (
            ImagePromptMessageContent.DETAIL.HIGH
            if _get_detail(item) == _DETAIL_HIGH
            else ImagePromptMessageContent.DETAIL.LOW
        )
        return ImagePromptMessageContent(
            base64_data=item.base64,
            mime_type=item.media_type,
            format=item.format,
            filename=filename,
            detail=detail,
        )
    if item.is_audio:
        return AudioPromptMessageContent(
            base64_data=item.base64,
            mime_type=item.media_type,
            format=item.format,
            filename=filename,
        )
    if item.is_video:
        return VideoPromptMessageContent(
            base64_data=item.base64,
            mime_type=item.media_type,
            format=item.format,
            filename=filename,
        )
    if item.is_document:
        return DocumentPromptMessageContent(
            base64_data=item.base64,
            mime_type=item.media_type,
            format=item.format,
            filename=filename,
        )
    raise UnexpectedModelBehavior(f"Unsupported binary media type for daemon adapter: {item.media_type}")


def _normalize_prompt_content(
    content: list[PromptMessageContentUnionTypes],
) -> str | list[PromptMessageContentUnionTypes] | None:
    if not content:
        return None
    if len(content) == 1 and isinstance(content[0], TextPromptMessageContent):
        return content[0].data
    return content


def _map_tool_definitions_to_prompt_tools(
    model_request_parameters: ModelRequestParameters,
) -> list[PromptMessageTool] | None:
    tool_definitions = [
        *model_request_parameters.function_tools,
        *model_request_parameters.output_tools,
    ]
    if not tool_definitions:
        return None

    return [
        PromptMessageTool(
            name=tool_definition.name,
            description=tool_definition.description or "",
            parameters=cast(dict[str, object], tool_definition.parameters_json_schema),
        )
        for tool_definition in tool_definitions
    ]


def _map_model_settings_to_parameters(model_settings: ModelSettings | None) -> dict[str, object]:
    if not model_settings:
        return {}

    parameters: dict[str, object] = {
        key: value
        for key, value in model_settings.items()
        if value is not None and key not in {"extra_body", "stop_sequences"}
    }

    extra_body = model_settings.get("extra_body")
    if isinstance(extra_body, Mapping):
        parameters.update(cast(Mapping[str, object], extra_body))

    return parameters


def _get_stop_sequences(model_settings: ModelSettings | None) -> list[str] | None:
    if not model_settings:
        return None
    return list(model_settings.get("stop_sequences") or []) or None


def _map_usage(usage: LLMUsage) -> RequestUsage:
    return RequestUsage(input_tokens=usage.prompt_tokens, output_tokens=usage.completion_tokens)


def _normalize_finish_reason(finish_reason: str) -> FinishReason:
    lowered = finish_reason.lower()
    if lowered in {"stop", "length", "content_filter", "error", "tool_call"}:
        return cast(FinishReason, lowered)
    if lowered in {"tool_calls", "function_call", "function_calls"}:
        return "tool_call"
    return "error"


def _chunk_to_stream_events(
    parts_manager: ModelResponsePartsManager,
    chunk: LLMResultChunk,
    provider_name: str,
    embedded_thinking_parser: "_EmbeddedThinkingParser",
) -> list[ModelResponseStreamEvent]:
    events: list[ModelResponseStreamEvent] = []
    message = chunk.delta.message

    if isinstance(message.content, str):
        if message.content:
            events.extend(embedded_thinking_parser.parse(parts_manager, message.content, provider_name))
    elif isinstance(message.content, list):
        for part in _map_assistant_content_to_response_parts(message.content):
            if isinstance(part, TextPart):
                events.extend(
                    parts_manager.handle_text_delta(
                        vendor_part_id=None,
                        content=part.content,
                        provider_name=provider_name,
                    )
                )
            else:
                events.append(parts_manager.handle_part(vendor_part_id=None, part=part))

    for index, tool_call in enumerate(message.tool_calls):
        vendor_id = tool_call.id or f"chunk-{chunk.delta.index}-tool-{index}"
        events.append(
            parts_manager.handle_tool_call_part(
                vendor_part_id=vendor_id,
                tool_name=tool_call.function.name,
                args=tool_call.function.arguments,
                tool_call_id=tool_call.id,
                provider_name=provider_name,
            )
        )

    return events


def _map_assistant_content_to_response_parts(
    content: Sequence[PromptMessageContentUnionTypes],
) -> list[ModelResponsePart]:
    response_parts: list[ModelResponsePart] = []

    for item in content:
        if isinstance(item, TextPromptMessageContent):
            if item.data:
                response_parts.extend(_parse_assistant_text_parts(item.data))
        elif isinstance(
            item,
            ImagePromptMessageContent
            | AudioPromptMessageContent
            | VideoPromptMessageContent
            | DocumentPromptMessageContent,
        ):
            if item.url:
                raise UnexpectedModelBehavior(
                    "URL-based assistant multimodal output is not supported by the daemon adapter"
                )
            if not item.base64_data:
                continue
            response_parts.append(
                FilePart(
                    content=BinaryContent(
                        data=base64.b64decode(item.base64_data),
                        media_type=item.mime_type,
                    ),
                    provider_name=None,
                )
            )
        else:
            assert_never(item)

    return response_parts


def _get_detail(item: ImageUrl | BinaryContent) -> str | None:
    metadata = item.vendor_metadata or {}
    detail = metadata.get("detail")
    return detail if isinstance(detail, str) else None


def _parse_assistant_text_parts(content: str) -> list[ModelResponsePart]:
    response_parts: list[ModelResponsePart] = []
    cursor = 0

    for match in _THINK_TAG_PATTERN.finditer(content):
        if match.start() > cursor:
            response_parts.append(TextPart(content=content[cursor : match.start()], provider_name=None))

        thinking_content = match.group(1).strip("\n")
        if thinking_content:
            response_parts.append(ThinkingPart(content=thinking_content, provider_name=None))
        cursor = match.end()

    if cursor < len(content):
        response_parts.append(TextPart(content=content[cursor:], provider_name=None))

    if response_parts:
        return response_parts
    return [TextPart(content=content, provider_name=None)]


@dataclass(slots=True)
class _EmbeddedThinkingParser:
    _pending: str = ""
    _inside_thinking: bool = False

    def parse(
        self,
        parts_manager: ModelResponsePartsManager,
        content: str,
        provider_name: str,
    ) -> list[ModelResponseStreamEvent]:
        events: list[ModelResponseStreamEvent] = []
        buffer = self._pending + content
        self._pending = ""

        while buffer:
            if self._inside_thinking:
                end_index = buffer.find(_THINK_CLOSE_TAG)
                if end_index >= 0:
                    if end_index > 0:
                        events.extend(
                            parts_manager.handle_thinking_delta(
                                vendor_part_id=None,
                                content=buffer[:end_index],
                                provider_name=provider_name,
                            )
                        )
                    buffer = buffer[end_index + len(_THINK_CLOSE_TAG) :]
                    self._inside_thinking = False
                    continue

                safe_content, self._pending = _split_incomplete_tag_suffix(buffer, _THINK_CLOSE_TAG)
                if safe_content:
                    events.extend(
                        parts_manager.handle_thinking_delta(
                            vendor_part_id=None,
                            content=safe_content,
                            provider_name=provider_name,
                        )
                    )
                break

            start_index = buffer.find(_THINK_OPEN_TAG)
            if start_index >= 0:
                if start_index > 0:
                    events.extend(
                        parts_manager.handle_text_delta(
                            vendor_part_id=None,
                            content=buffer[:start_index],
                            provider_name=provider_name,
                        )
                    )
                buffer = buffer[start_index + len(_THINK_OPEN_TAG) :]
                self._inside_thinking = True
                continue

            safe_content, self._pending = _split_incomplete_tag_suffix(buffer, _THINK_OPEN_TAG)
            if safe_content:
                events.extend(
                    parts_manager.handle_text_delta(
                        vendor_part_id=None,
                        content=safe_content,
                        provider_name=provider_name,
                    )
                )
            break

        return events

    def flush(
        self,
        parts_manager: ModelResponsePartsManager,
        provider_name: str,
    ) -> list[ModelResponseStreamEvent]:
        if not self._pending:
            return []

        pending = self._pending
        self._pending = ""
        if self._inside_thinking:
            return list(
                parts_manager.handle_thinking_delta(
                    vendor_part_id=None,
                    content=pending,
                    provider_name=provider_name,
                )
            )
        return list(
            parts_manager.handle_text_delta(
                vendor_part_id=None,
                content=pending,
                provider_name=provider_name,
            )
        )


def _split_incomplete_tag_suffix(content: str, tag: str) -> tuple[str, str]:
    for suffix_length in range(len(tag) - 1, 0, -1):
        if content.endswith(tag[:suffix_length]):
            return content[:-suffix_length], content[-suffix_length:]
    return content, ""
