from collections.abc import Sequence
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.memory import NodeTokenBufferMemory, TokenBufferMemory
from core.memory.base import BaseMemory
from core.model_manager import ModelInstance
from core.prompt.entities.advanced_prompt_entities import MemoryConfig, MemoryMode
from dify_graph.enums import SystemVariableKey
from dify_graph.file.models import File
from dify_graph.model_runtime.entities import PromptMessageRole
from dify_graph.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    MultiModalPromptMessageContent,
    PromptMessage,
    PromptMessageContentUnionTypes,
    TextPromptMessageContent,
    ToolPromptMessage,
)
from dify_graph.model_runtime.entities.model_entities import AIModelEntity
from dify_graph.model_runtime.memory import PromptMessageMemory
from dify_graph.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from dify_graph.nodes.llm.entities import LLMGenerationData
from dify_graph.runtime import VariablePool
from dify_graph.variables.segments import ArrayAnySegment, ArrayFileSegment, FileSegment, NoneSegment, StringSegment

from .exc import InvalidVariableTypeError


def fetch_model_schema(*, model_instance: ModelInstance) -> AIModelEntity:
    model_schema = cast(LargeLanguageModel, model_instance.model_type_instance).get_model_schema(
        model_instance.model_name,
        model_instance.credentials,
    )
    if not model_schema:
        raise ValueError(f"Model schema not found for {model_instance.model_name}")
    return model_schema


def fetch_files(variable_pool: VariablePool, selector: Sequence[str]) -> Sequence["File"]:
    variable = variable_pool.get(selector)
    if variable is None:
        return []
    elif isinstance(variable, FileSegment):
        return [variable.value]
    elif isinstance(variable, ArrayFileSegment):
        return variable.value
    elif isinstance(variable, NoneSegment | ArrayAnySegment):
        return []
    raise InvalidVariableTypeError(f"Invalid variable type: {type(variable)}")


def fetch_memory(
    variable_pool: VariablePool,
    app_id: str,
    tenant_id: str,
    node_data_memory: MemoryConfig | None,
    model_instance: ModelInstance,
    node_id: str = "",
) -> BaseMemory | None:
    """
    Fetch memory based on configuration mode.

    Returns TokenBufferMemory for conversation mode (default),
    or NodeTokenBufferMemory for node mode (Chatflow only).
    """
    if not node_data_memory:
        return None

    conversation_id_variable = variable_pool.get(["sys", SystemVariableKey.CONVERSATION_ID])
    if not isinstance(conversation_id_variable, StringSegment):
        return None
    conversation_id = conversation_id_variable.value

    if node_data_memory.mode == MemoryMode.NODE:
        if not node_id:
            return None
        return NodeTokenBufferMemory(
            app_id=app_id,
            conversation_id=conversation_id,
            node_id=node_id,
            tenant_id=tenant_id,
            model_instance=model_instance,
        )
    else:
        from extensions.ext_database import db
        from models.model import Conversation

        with Session(db.engine, expire_on_commit=False) as session:
            stmt = select(Conversation).where(Conversation.app_id == app_id, Conversation.id == conversation_id)
            conversation = session.scalar(stmt)
            if not conversation:
                return None
        return TokenBufferMemory(conversation=conversation, model_instance=model_instance)


def convert_history_messages_to_text(
    *,
    history_messages: Sequence[PromptMessage],
    human_prefix: str,
    ai_prefix: str,
) -> str:
    string_messages: list[str] = []
    for message in history_messages:
        if message.role == PromptMessageRole.USER:
            role = human_prefix
        elif message.role == PromptMessageRole.ASSISTANT:
            role = ai_prefix
        else:
            continue

        if isinstance(message.content, list):
            content_parts = []
            for content in message.content:
                if isinstance(content, TextPromptMessageContent):
                    content_parts.append(content.data)
                elif isinstance(content, ImagePromptMessageContent):
                    content_parts.append("[image]")

            inner_msg = "\n".join(content_parts)
            string_messages.append(f"{role}: {inner_msg}")
        else:
            string_messages.append(f"{role}: {message.content}")

    return "\n".join(string_messages)


def fetch_memory_text(
    *,
    memory: PromptMessageMemory,
    max_token_limit: int,
    message_limit: int | None = None,
    human_prefix: str = "Human",
    ai_prefix: str = "Assistant",
) -> str:
    history_messages = memory.get_history_prompt_messages(
        max_token_limit=max_token_limit,
        message_limit=message_limit,
    )
    return convert_history_messages_to_text(
        history_messages=history_messages,
        human_prefix=human_prefix,
        ai_prefix=ai_prefix,
    )


def build_context(
    prompt_messages: Sequence[PromptMessage],
    assistant_response: str,
    generation_data: LLMGenerationData | None = None,
    files: Sequence[Any] | None = None,
) -> list[PromptMessage]:
    """
    Build context from prompt messages and assistant response.
    Excludes system messages and includes the current LLM response.
    Returns list[PromptMessage] for use with ArrayPromptMessageSegment.
    """
    context_messages: list[PromptMessage] = [
        _truncate_multimodal_content(m) for m in prompt_messages if m.role != PromptMessageRole.SYSTEM
    ]

    file_suffix = ""
    if files:
        file_descriptions = _build_file_descriptions(files)
        if file_descriptions:
            file_suffix = f"\n\n{file_descriptions}"

    if generation_data and generation_data.trace:
        context_messages.extend(_build_messages_from_trace(generation_data, assistant_response, file_suffix))
    else:
        context_messages.append(AssistantPromptMessage(content=assistant_response + file_suffix))

    return context_messages


def _build_file_descriptions(files: Sequence[Any]) -> str:
    if not files:
        return ""

    descriptions: list[str] = ["[Generated Files]"]
    for file in files:
        file_id = getattr(file, "id", None) or getattr(file, "related_id", None)
        filename = getattr(file, "filename", "unknown")
        file_type = getattr(file, "type", "unknown")
        if hasattr(file_type, "value"):
            file_type = file_type.value

        if file_id:
            descriptions.append(f"- {filename} (id: {file_id}, type: {file_type})")

    return "\n".join(descriptions)


def _build_messages_from_trace(
    generation_data: LLMGenerationData,
    assistant_response: str,
    file_suffix: str = "",
) -> list[PromptMessage]:
    from dify_graph.nodes.llm.entities import ModelTraceSegment, ToolTraceSegment

    messages: list[PromptMessage] = []
    covered_text_len = 0

    for segment in generation_data.trace:
        if segment.type == "model" and isinstance(segment.output, ModelTraceSegment):
            model_output = segment.output
            segment_content = model_output.text or ""
            covered_text_len += len(segment_content)

            if model_output.tool_calls:
                tool_calls = [
                    AssistantPromptMessage.ToolCall(
                        id=tc.id or "",
                        type="function",
                        function=AssistantPromptMessage.ToolCall.ToolCallFunction(
                            name=tc.name or "",
                            arguments=tc.arguments or "{}",
                        ),
                    )
                    for tc in model_output.tool_calls
                ]
                messages.append(AssistantPromptMessage(content=segment_content, tool_calls=tool_calls))
            elif segment_content:
                messages.append(AssistantPromptMessage(content=segment_content))

        elif segment.type == "tool" and isinstance(segment.output, ToolTraceSegment):
            tool_output = segment.output
            messages.append(
                ToolPromptMessage(
                    content=tool_output.output or "",
                    tool_call_id=tool_output.id or "",
                    name=tool_output.name or "",
                )
            )

    remaining_text = assistant_response[covered_text_len:]
    final_content = remaining_text + file_suffix
    if final_content:
        messages.append(AssistantPromptMessage(content=final_content))

    return messages


def _truncate_multimodal_content(message: PromptMessage) -> PromptMessage:
    content = message.content
    if content is None or isinstance(content, str):
        return message

    new_content: list[PromptMessageContentUnionTypes] = []
    for item in content:
        if isinstance(item, MultiModalPromptMessageContent):
            if item.file_ref:
                new_content.append(item.model_copy(update={"base64_data": "", "url": ""}))
            else:
                truncated_base64 = ""
                if item.base64_data:
                    truncated_base64 = item.base64_data[:10] + "...[TRUNCATED]..." + item.base64_data[-10:]
                new_content.append(item.model_copy(update={"base64_data": truncated_base64}))
        else:
            new_content.append(item)

    return message.model_copy(update={"content": new_content})


def restore_multimodal_content_in_messages(messages: Sequence[PromptMessage]) -> list[PromptMessage]:
    return [_restore_message_content(msg) for msg in messages]


def _restore_message_content(message: PromptMessage) -> PromptMessage:
    from dify_graph.file.file_manager import restore_multimodal_content

    content = message.content
    if content is None or isinstance(content, str):
        return message

    restored_content: list[PromptMessageContentUnionTypes] = []
    for item in content:
        if isinstance(item, MultiModalPromptMessageContent):
            restored_item = restore_multimodal_content(item)
            restored_content.append(cast(PromptMessageContentUnionTypes, restored_item))
        else:
            restored_content.append(item)

    return message.model_copy(update={"content": restored_content})
