from __future__ import annotations

import json
import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any, cast

from core.model_manager import ModelInstance
from dify_graph.file import FileType, file_manager
from dify_graph.file.models import File
from dify_graph.model_runtime.entities import (
    ImagePromptMessageContent,
    PromptMessage,
    PromptMessageContentType,
    PromptMessageRole,
    TextPromptMessageContent,
)
from dify_graph.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessageContentUnionTypes,
    SystemPromptMessage,
    UserPromptMessage,
)
from dify_graph.model_runtime.entities.model_entities import AIModelEntity, ModelFeature, ModelPropertyKey
from dify_graph.model_runtime.memory import PromptMessageMemory
from dify_graph.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from dify_graph.nodes.base.entities import VariableSelector
from dify_graph.runtime import VariablePool
from dify_graph.variables import ArrayFileSegment, FileSegment
from dify_graph.variables.segments import ArrayAnySegment, NoneSegment

from .entities import LLMNodeChatModelMessage, LLMNodeCompletionModelPromptTemplate, MemoryConfig
from .exc import (
    InvalidVariableTypeError,
    MemoryRolePrefixRequiredError,
    NoPromptFoundError,
    TemplateTypeNotSupportError,
)
from .protocols import TemplateRenderer

logger = logging.getLogger(__name__)

VARIABLE_PATTERN = re.compile(r"\{\{#[^#]+#\}\}")
MAX_RESOLVED_VALUE_LENGTH = 1024


def fetch_model_schema(*, model_instance: ModelInstance) -> AIModelEntity:
    model_schema = cast(LargeLanguageModel, model_instance.model_type_instance).get_model_schema(
        model_instance.model_name,
        dict(model_instance.credentials),
    )
    if not model_schema:
        raise ValueError(f"Model schema not found for {model_instance.model_name}")
    return model_schema


def fetch_files(variable_pool: VariablePool, selector: Sequence[str]) -> Sequence[File]:
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


def fetch_prompt_messages(
    *,
    sys_query: str | None = None,
    sys_files: Sequence[File],
    context: str | None = None,
    memory: PromptMessageMemory | None = None,
    model_instance: ModelInstance,
    prompt_template: Sequence[LLMNodeChatModelMessage] | LLMNodeCompletionModelPromptTemplate,
    stop: Sequence[str] | None = None,
    memory_config: MemoryConfig | None = None,
    vision_enabled: bool = False,
    vision_detail: ImagePromptMessageContent.DETAIL,
    variable_pool: VariablePool,
    jinja2_variables: Sequence[VariableSelector],
    context_files: list[File] | None = None,
    template_renderer: TemplateRenderer | None = None,
) -> tuple[Sequence[PromptMessage], Sequence[str] | None]:
    prompt_messages: list[PromptMessage] = []
    model_schema = fetch_model_schema(model_instance=model_instance)

    if isinstance(prompt_template, list):
        prompt_messages.extend(
            handle_list_messages(
                messages=prompt_template,
                context=context,
                jinja2_variables=jinja2_variables,
                variable_pool=variable_pool,
                vision_detail_config=vision_detail,
                template_renderer=template_renderer,
            )
        )

        prompt_messages.extend(
            handle_memory_chat_mode(
                memory=memory,
                memory_config=memory_config,
                model_instance=model_instance,
            )
        )

        if sys_query:
            prompt_messages.extend(
                handle_list_messages(
                    messages=[
                        LLMNodeChatModelMessage(
                            text=sys_query,
                            role=PromptMessageRole.USER,
                            edition_type="basic",
                        )
                    ],
                    context="",
                    jinja2_variables=[],
                    variable_pool=variable_pool,
                    vision_detail_config=vision_detail,
                    template_renderer=template_renderer,
                )
            )
    elif isinstance(prompt_template, LLMNodeCompletionModelPromptTemplate):
        prompt_messages.extend(
            handle_completion_template(
                template=prompt_template,
                context=context,
                jinja2_variables=jinja2_variables,
                variable_pool=variable_pool,
                template_renderer=template_renderer,
            )
        )

        memory_text = handle_memory_completion_mode(
            memory=memory,
            memory_config=memory_config,
            model_instance=model_instance,
        )
        prompt_content = prompt_messages[0].content
        if isinstance(prompt_content, str):
            prompt_content = str(prompt_content)
            if "#histories#" in prompt_content:
                prompt_content = prompt_content.replace("#histories#", memory_text)
            else:
                prompt_content = memory_text + "\n" + prompt_content
            prompt_messages[0].content = prompt_content
        elif isinstance(prompt_content, list):
            for content_item in prompt_content:
                if isinstance(content_item, TextPromptMessageContent):
                    if "#histories#" in content_item.data:
                        content_item.data = content_item.data.replace("#histories#", memory_text)
                    else:
                        content_item.data = memory_text + "\n" + content_item.data
        else:
            raise ValueError("Invalid prompt content type")

        if sys_query:
            if isinstance(prompt_content, str):
                prompt_messages[0].content = str(prompt_messages[0].content).replace("#sys.query#", sys_query)
            elif isinstance(prompt_content, list):
                for content_item in prompt_content:
                    if isinstance(content_item, TextPromptMessageContent):
                        content_item.data = sys_query + "\n" + content_item.data
            else:
                raise ValueError("Invalid prompt content type")
    else:
        raise TemplateTypeNotSupportError(type_name=str(type(prompt_template)))

    _append_file_prompts(
        prompt_messages=prompt_messages,
        files=sys_files,
        vision_enabled=vision_enabled,
        vision_detail=vision_detail,
    )
    _append_file_prompts(
        prompt_messages=prompt_messages,
        files=context_files or [],
        vision_enabled=vision_enabled,
        vision_detail=vision_detail,
    )

    filtered_prompt_messages: list[PromptMessage] = []
    for prompt_message in prompt_messages:
        if isinstance(prompt_message.content, list):
            prompt_message_content: list[PromptMessageContentUnionTypes] = []
            for content_item in prompt_message.content:
                if not model_schema.features:
                    if content_item.type == PromptMessageContentType.TEXT:
                        prompt_message_content.append(content_item)
                    continue

                if (
                    (
                        content_item.type == PromptMessageContentType.IMAGE
                        and ModelFeature.VISION not in model_schema.features
                    )
                    or (
                        content_item.type == PromptMessageContentType.DOCUMENT
                        and ModelFeature.DOCUMENT not in model_schema.features
                    )
                    or (
                        content_item.type == PromptMessageContentType.VIDEO
                        and ModelFeature.VIDEO not in model_schema.features
                    )
                    or (
                        content_item.type == PromptMessageContentType.AUDIO
                        and ModelFeature.AUDIO not in model_schema.features
                    )
                ):
                    continue
                prompt_message_content.append(content_item)
            if not prompt_message_content:
                continue
            if len(prompt_message_content) == 1 and prompt_message_content[0].type == PromptMessageContentType.TEXT:
                prompt_message.content = prompt_message_content[0].data
            else:
                prompt_message.content = prompt_message_content
            filtered_prompt_messages.append(prompt_message)
        elif not prompt_message.is_empty():
            filtered_prompt_messages.append(prompt_message)

    if len(filtered_prompt_messages) == 0:
        raise NoPromptFoundError(
            "No prompt found in the LLM configuration. Please ensure a prompt is properly configured before proceeding."
        )

    return filtered_prompt_messages, stop


def handle_list_messages(
    *,
    messages: Sequence[LLMNodeChatModelMessage],
    context: str | None,
    jinja2_variables: Sequence[VariableSelector],
    variable_pool: VariablePool,
    vision_detail_config: ImagePromptMessageContent.DETAIL,
    template_renderer: TemplateRenderer | None = None,
) -> Sequence[PromptMessage]:
    prompt_messages: list[PromptMessage] = []
    for message in messages:
        if message.edition_type == "jinja2":
            result_text = render_jinja2_message(
                template=message.jinja2_text or "",
                jinja2_variables=jinja2_variables,
                variable_pool=variable_pool,
                template_renderer=template_renderer,
            )
            prompt_messages.append(
                combine_message_content_with_role(
                    contents=[TextPromptMessageContent(data=result_text)],
                    role=message.role,
                )
            )
            continue

        template = message.text.replace("{#context#}", context) if context else message.text
        segment_group = variable_pool.convert_template(template)
        file_contents: list[PromptMessageContentUnionTypes] = []
        for segment in segment_group.value:
            if isinstance(segment, ArrayFileSegment):
                for file in segment.value:
                    if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                        file_contents.append(
                            file_manager.to_prompt_message_content(file, image_detail_config=vision_detail_config)
                        )
            elif isinstance(segment, FileSegment):
                file = segment.value
                if file.type in {FileType.IMAGE, FileType.VIDEO, FileType.AUDIO, FileType.DOCUMENT}:
                    file_contents.append(
                        file_manager.to_prompt_message_content(file, image_detail_config=vision_detail_config)
                    )

        if segment_group.text:
            prompt_messages.append(
                combine_message_content_with_role(
                    contents=[TextPromptMessageContent(data=segment_group.text)],
                    role=message.role,
                )
            )
        if file_contents:
            prompt_messages.append(combine_message_content_with_role(contents=file_contents, role=message.role))

    return prompt_messages


def render_jinja2_message(
    *,
    template: str,
    jinja2_variables: Sequence[VariableSelector],
    variable_pool: VariablePool,
    template_renderer: TemplateRenderer | None = None,
) -> str:
    if not template:
        return ""
    if template_renderer is None:
        raise ValueError("template_renderer is required for jinja2 prompt rendering")

    jinja2_inputs: dict[str, Any] = {}
    for jinja2_variable in jinja2_variables:
        variable = variable_pool.get(jinja2_variable.value_selector)
        jinja2_inputs[jinja2_variable.variable] = variable.to_object() if variable else ""
    return template_renderer.render_jinja2(template=template, inputs=jinja2_inputs)


def handle_completion_template(
    *,
    template: LLMNodeCompletionModelPromptTemplate,
    context: str | None,
    jinja2_variables: Sequence[VariableSelector],
    variable_pool: VariablePool,
    template_renderer: TemplateRenderer | None = None,
) -> Sequence[PromptMessage]:
    if template.edition_type == "jinja2":
        result_text = render_jinja2_message(
            template=template.jinja2_text or "",
            jinja2_variables=jinja2_variables,
            variable_pool=variable_pool,
            template_renderer=template_renderer,
        )
    else:
        template_text = template.text.replace("{#context#}", context) if context else template.text
        result_text = variable_pool.convert_template(template_text).text
    return [
        combine_message_content_with_role(
            contents=[TextPromptMessageContent(data=result_text)],
            role=PromptMessageRole.USER,
        )
    ]


def combine_message_content_with_role(
    *,
    contents: str | list[PromptMessageContentUnionTypes] | None = None,
    role: PromptMessageRole,
) -> PromptMessage:
    match role:
        case PromptMessageRole.USER:
            return UserPromptMessage(content=contents)
        case PromptMessageRole.ASSISTANT:
            return AssistantPromptMessage(content=contents)
        case PromptMessageRole.SYSTEM:
            return SystemPromptMessage(content=contents)
        case _:
            raise NotImplementedError(f"Role {role} is not supported")


def calculate_rest_token(*, prompt_messages: list[PromptMessage], model_instance: ModelInstance) -> int:
    rest_tokens = 2000
    runtime_model_schema = fetch_model_schema(model_instance=model_instance)
    runtime_model_parameters = model_instance.parameters

    model_context_tokens = runtime_model_schema.model_properties.get(ModelPropertyKey.CONTEXT_SIZE)
    if model_context_tokens:
        curr_message_tokens = model_instance.get_llm_num_tokens(prompt_messages)

        max_tokens = 0
        for parameter_rule in runtime_model_schema.parameter_rules:
            if parameter_rule.name == "max_tokens" or (
                parameter_rule.use_template and parameter_rule.use_template == "max_tokens"
            ):
                max_tokens = (
                    runtime_model_parameters.get(parameter_rule.name)
                    or runtime_model_parameters.get(str(parameter_rule.use_template))
                    or 0
                )

        rest_tokens = model_context_tokens - max_tokens - curr_message_tokens
        rest_tokens = max(rest_tokens, 0)

    return rest_tokens


def handle_memory_chat_mode(
    *,
    memory: PromptMessageMemory | None,
    memory_config: MemoryConfig | None,
    model_instance: ModelInstance,
) -> Sequence[PromptMessage]:
    if not memory or not memory_config:
        return []
    rest_tokens = calculate_rest_token(prompt_messages=[], model_instance=model_instance)
    return memory.get_history_prompt_messages(
        max_token_limit=rest_tokens,
        message_limit=memory_config.window.size if memory_config.window.enabled else None,
    )


def handle_memory_completion_mode(
    *,
    memory: PromptMessageMemory | None,
    memory_config: MemoryConfig | None,
    model_instance: ModelInstance,
) -> str:
    if not memory or not memory_config:
        return ""

    rest_tokens = calculate_rest_token(prompt_messages=[], model_instance=model_instance)
    if not memory_config.role_prefix:
        raise MemoryRolePrefixRequiredError("Memory role prefix is required for completion model.")

    return fetch_memory_text(
        memory=memory,
        max_token_limit=rest_tokens,
        message_limit=memory_config.window.size if memory_config.window.enabled else None,
        human_prefix=memory_config.role_prefix.user,
        ai_prefix=memory_config.role_prefix.assistant,
    )


def _append_file_prompts(
    *,
    prompt_messages: list[PromptMessage],
    files: Sequence[File],
    vision_enabled: bool,
    vision_detail: ImagePromptMessageContent.DETAIL,
) -> None:
    if not vision_enabled or not files:
        return

    file_prompts = [file_manager.to_prompt_message_content(file, image_detail_config=vision_detail) for file in files]
    if (
        prompt_messages
        and isinstance(prompt_messages[-1], UserPromptMessage)
        and isinstance(prompt_messages[-1].content, list)
    ):
        existing_contents = prompt_messages[-1].content
        assert isinstance(existing_contents, list)
        prompt_messages[-1] = UserPromptMessage(content=file_prompts + existing_contents)
    else:
        prompt_messages.append(UserPromptMessage(content=file_prompts))


def _coerce_resolved_value(raw: str) -> int | float | bool | str:
    """Try to restore the original type from a resolved template string.

    Variable references are always resolved to text, but completion params may
    expect numeric or boolean values (e.g. a variable that holds "0.7" mapped to
    the ``temperature`` parameter).  This helper attempts a JSON parse so that
    ``"0.7"`` → ``0.7``, ``"true"`` → ``True``, etc.  Plain strings that are not
    valid JSON literals are returned as-is.
    """
    stripped = raw.strip()
    if not stripped:
        return raw

    try:
        parsed: object = json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        return raw

    if isinstance(parsed, (int, float, bool)):
        return parsed
    return raw


def resolve_completion_params_variables(
    completion_params: Mapping[str, Any],
    variable_pool: VariablePool,
) -> dict[str, Any]:
    """Resolve variable references (``{{#node_id.var#}}``) in string-typed completion params.

    Security notes:
    - Resolved values are length-capped to ``MAX_RESOLVED_VALUE_LENGTH`` to
      prevent denial-of-service through excessively large variable payloads.
    - This follows the same ``VariablePool.convert_template`` pattern used across
      Dify (Answer Node, HTTP Request Node, Agent Node, etc.).  The downstream
      model plugin receives these values as structured JSON key-value pairs — they
      are never concatenated into raw HTTP headers or SQL queries.
    - Numeric/boolean coercion is applied so that variables holding ``"0.7"`` are
      restored to their native type rather than sent as a bare string.
    """
    resolved: dict[str, Any] = {}
    for key, value in completion_params.items():
        if isinstance(value, str) and VARIABLE_PATTERN.search(value):
            segment_group = variable_pool.convert_template(value)
            text = segment_group.text
            if len(text) > MAX_RESOLVED_VALUE_LENGTH:
                logger.warning(
                    "Resolved value for param '%s' truncated from %d to %d chars",
                    key,
                    len(text),
                    MAX_RESOLVED_VALUE_LENGTH,
                )
                text = text[:MAX_RESOLVED_VALUE_LENGTH]
            resolved[key] = _coerce_resolved_value(text)
        else:
            resolved[key] = value
    return resolved
