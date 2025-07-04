import json
from collections.abc import Generator, Mapping, Sequence
from copy import deepcopy
from enum import StrEnum
from typing import Any, Literal, Optional, cast, overload

import json_repair
from pydantic import TypeAdapter, ValidationError

from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.prompts import STRUCTURED_OUTPUT_PROMPT
from core.model_manager import ModelInstance
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    TextPromptMessageContent,
)
from core.model_runtime.entities.model_entities import AIModelEntity, ParameterRule


class ResponseFormat(StrEnum):
    """Constants for model response formats"""

    JSON_SCHEMA = "json_schema"  # model's structured output mode. some model like gemini, gpt-4o,  support this mode.
    JSON = "JSON"  # model's json mode. some model like claude support this mode.
    JSON_OBJECT = "json_object"  # json mode's another alias. some model like deepseek-chat, qwen use this alias.


class SpecialModelType(StrEnum):
    """Constants for identifying model types"""

    GEMINI = "gemini"
    OLLAMA = "ollama"


@overload
def invoke_llm_with_structured_output(
    provider: str,
    model_schema: AIModelEntity,
    model_instance: ModelInstance,
    prompt_messages: Sequence[PromptMessage],
    json_schema: Mapping[str, Any],
    model_parameters: Optional[Mapping] = None,
    tools: Sequence[PromptMessageTool] | None = None,
    stop: Optional[list[str]] = None,
    stream: Literal[True] = True,
    user: Optional[str] = None,
    callbacks: Optional[list[Callback]] = None,
) -> Generator[LLMResultChunkWithStructuredOutput, None, None]: ...


@overload
def invoke_llm_with_structured_output(
    provider: str,
    model_schema: AIModelEntity,
    model_instance: ModelInstance,
    prompt_messages: Sequence[PromptMessage],
    json_schema: Mapping[str, Any],
    model_parameters: Optional[Mapping] = None,
    tools: Sequence[PromptMessageTool] | None = None,
    stop: Optional[list[str]] = None,
    stream: Literal[False] = False,
    user: Optional[str] = None,
    callbacks: Optional[list[Callback]] = None,
) -> LLMResultWithStructuredOutput: ...


@overload
def invoke_llm_with_structured_output(
    provider: str,
    model_schema: AIModelEntity,
    model_instance: ModelInstance,
    prompt_messages: Sequence[PromptMessage],
    json_schema: Mapping[str, Any],
    model_parameters: Optional[Mapping] = None,
    tools: Sequence[PromptMessageTool] | None = None,
    stop: Optional[list[str]] = None,
    stream: bool = True,
    user: Optional[str] = None,
    callbacks: Optional[list[Callback]] = None,
) -> LLMResultWithStructuredOutput | Generator[LLMResultChunkWithStructuredOutput, None, None]: ...


def invoke_llm_with_structured_output(
    provider: str,
    model_schema: AIModelEntity,
    model_instance: ModelInstance,
    prompt_messages: Sequence[PromptMessage],
    json_schema: Mapping[str, Any],
    model_parameters: Optional[Mapping] = None,
    tools: Sequence[PromptMessageTool] | None = None,
    stop: Optional[list[str]] = None,
    stream: bool = True,
    user: Optional[str] = None,
    callbacks: Optional[list[Callback]] = None,
) -> LLMResultWithStructuredOutput | Generator[LLMResultChunkWithStructuredOutput, None, None]:
    """
    Invoke large language model with structured output
    1. This method invokes model_instance.invoke_llm with json_schema
    2. Try to parse the result as structured output

    :param prompt_messages: prompt messages
    :param json_schema: json schema
    :param model_parameters: model parameters
    :param tools: tools for tool calling
    :param stop: stop words
    :param stream: is stream response
    :param user: unique user id
    :param callbacks: callbacks
    :return: full response or stream response chunk generator result
    """

    # handle native json schema
    model_parameters_with_json_schema: dict[str, Any] = {
        **(model_parameters or {}),
    }

    if model_schema.support_structure_output:
        model_parameters = _handle_native_json_schema(
            provider, model_schema, json_schema, model_parameters_with_json_schema, model_schema.parameter_rules
        )
    else:
        # Set appropriate response format based on model capabilities
        _set_response_format(model_parameters_with_json_schema, model_schema.parameter_rules)

        # handle prompt based schema
        prompt_messages = _handle_prompt_based_schema(
            prompt_messages=prompt_messages,
            structured_output_schema=json_schema,
        )

    llm_result = model_instance.invoke_llm(
        prompt_messages=list(prompt_messages),
        model_parameters=model_parameters_with_json_schema,
        tools=tools,
        stop=stop,
        stream=stream,
        user=user,
        callbacks=callbacks,
    )

    if isinstance(llm_result, LLMResult):
        if not isinstance(llm_result.message.content, str):
            raise OutputParserError(
                f"Failed to parse structured output, LLM result is not a string: {llm_result.message.content}"
            )

        return LLMResultWithStructuredOutput(
            structured_output=_parse_structured_output(llm_result.message.content),
            model=llm_result.model,
            message=llm_result.message,
            usage=llm_result.usage,
            system_fingerprint=llm_result.system_fingerprint,
            prompt_messages=llm_result.prompt_messages,
        )
    else:

        def generator() -> Generator[LLMResultChunkWithStructuredOutput, None, None]:
            result_text: str = ""
            prompt_messages: Sequence[PromptMessage] = []
            system_fingerprint: Optional[str] = None
            for event in llm_result:
                if isinstance(event, LLMResultChunk):
                    prompt_messages = event.prompt_messages
                    system_fingerprint = event.system_fingerprint

                    if isinstance(event.delta.message.content, str):
                        result_text += event.delta.message.content
                    elif isinstance(event.delta.message.content, list):
                        for item in event.delta.message.content:
                            if isinstance(item, TextPromptMessageContent):
                                result_text += item.data

                yield LLMResultChunkWithStructuredOutput(
                    model=model_schema.model,
                    prompt_messages=prompt_messages,
                    system_fingerprint=system_fingerprint,
                    delta=event.delta,
                )

            yield LLMResultChunkWithStructuredOutput(
                structured_output=_parse_structured_output(result_text),
                model=model_schema.model,
                prompt_messages=prompt_messages,
                system_fingerprint=system_fingerprint,
                delta=LLMResultChunkDelta(
                    index=0,
                    message=AssistantPromptMessage(content=""),
                    usage=None,
                    finish_reason=None,
                ),
            )

        return generator()


def _handle_native_json_schema(
    provider: str,
    model_schema: AIModelEntity,
    structured_output_schema: Mapping,
    model_parameters: dict,
    rules: list[ParameterRule],
) -> dict:
    """
    Handle structured output for models with native JSON schema support.

    :param model_parameters: Model parameters to update
    :param rules: Model parameter rules
    :return: Updated model parameters with JSON schema configuration
    """
    # Process schema according to model requirements
    schema_json = _prepare_schema_for_model(provider, model_schema, structured_output_schema)

    # Set JSON schema in parameters
    model_parameters["json_schema"] = json.dumps(schema_json, ensure_ascii=False)

    # Set appropriate response format if required by the model
    for rule in rules:
        if rule.name == "response_format" and ResponseFormat.JSON_SCHEMA.value in rule.options:
            model_parameters["response_format"] = ResponseFormat.JSON_SCHEMA.value

    return model_parameters


def _set_response_format(model_parameters: dict, rules: list) -> None:
    """
    Set the appropriate response format parameter based on model rules.

    :param model_parameters: Model parameters to update
    :param rules: Model parameter rules
    """
    for rule in rules:
        if rule.name == "response_format":
            if ResponseFormat.JSON.value in rule.options:
                model_parameters["response_format"] = ResponseFormat.JSON.value
            elif ResponseFormat.JSON_OBJECT.value in rule.options:
                model_parameters["response_format"] = ResponseFormat.JSON_OBJECT.value


def _handle_prompt_based_schema(
    prompt_messages: Sequence[PromptMessage], structured_output_schema: Mapping
) -> list[PromptMessage]:
    """
    Handle structured output for models without native JSON schema support.
    This function modifies the prompt messages to include schema-based output requirements.

    Args:
        prompt_messages: Original sequence of prompt messages

    Returns:
        list[PromptMessage]: Updated prompt messages with structured output requirements
    """
    # Convert schema to string format
    schema_str = json.dumps(structured_output_schema, ensure_ascii=False)

    # Find existing system prompt with schema placeholder
    system_prompt = next(
        (prompt for prompt in prompt_messages if isinstance(prompt, SystemPromptMessage)),
        None,
    )
    structured_output_prompt = STRUCTURED_OUTPUT_PROMPT.replace("{{schema}}", schema_str)
    # Prepare system prompt content
    system_prompt_content = (
        structured_output_prompt + "\n\n" + system_prompt.content
        if system_prompt and isinstance(system_prompt.content, str)
        else structured_output_prompt
    )
    system_prompt = SystemPromptMessage(content=system_prompt_content)

    # Extract content from the last user message

    filtered_prompts = [prompt for prompt in prompt_messages if not isinstance(prompt, SystemPromptMessage)]
    updated_prompt = [system_prompt] + filtered_prompts

    return updated_prompt


def _parse_structured_output(result_text: str) -> Mapping[str, Any]:
    structured_output: Mapping[str, Any] = {}
    parsed: Mapping[str, Any] = {}
    try:
        parsed = TypeAdapter(Mapping).validate_json(result_text)
        if not isinstance(parsed, dict):
            raise OutputParserError(f"Failed to parse structured output: {result_text}")
        structured_output = parsed
    except ValidationError:
        # if the result_text is not a valid json, try to repair it
        temp_parsed = json_repair.loads(result_text)
        if not isinstance(temp_parsed, dict):
            # handle reasoning model like deepseek-r1 got '<think>\n\n</think>\n' prefix
            if isinstance(temp_parsed, list):
                temp_parsed = next((item for item in temp_parsed if isinstance(item, dict)), {})
            else:
                raise OutputParserError(f"Failed to parse structured output: {result_text}")
        structured_output = cast(dict, temp_parsed)
    return structured_output


def _prepare_schema_for_model(provider: str, model_schema: AIModelEntity, schema: Mapping) -> dict:
    """
    Prepare JSON schema based on model requirements.

    Different models have different requirements for JSON schema formatting.
    This function handles these differences.

    :param schema: The original JSON schema
    :return: Processed schema compatible with the current model
    """

    # Deep copy to avoid modifying the original schema
    processed_schema = dict(deepcopy(schema))

    # Convert boolean types to string types (common requirement)
    convert_boolean_to_string(processed_schema)

    # Apply model-specific transformations
    if SpecialModelType.GEMINI in model_schema.model:
        remove_additional_properties(processed_schema)
        return processed_schema
    elif SpecialModelType.OLLAMA in provider:
        return processed_schema
    else:
        # Default format with name field
        return {"schema": processed_schema, "name": "llm_response"}


def remove_additional_properties(schema: dict) -> None:
    """
    Remove additionalProperties fields from JSON schema.
    Used for models like Gemini that don't support this property.

    :param schema: JSON schema to modify in-place
    """
    if not isinstance(schema, dict):
        return

    # Remove additionalProperties at current level
    schema.pop("additionalProperties", None)

    # Process nested structures recursively
    for value in schema.values():
        if isinstance(value, dict):
            remove_additional_properties(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    remove_additional_properties(item)


def convert_boolean_to_string(schema: dict) -> None:
    """
    Convert boolean type specifications to string in JSON schema.

    :param schema: JSON schema to modify in-place
    """
    if not isinstance(schema, dict):
        return

    # Check for boolean type at current level
    if schema.get("type") == "boolean":
        schema["type"] = "string"

    # Process nested dictionaries and lists recursively
    for value in schema.values():
        if isinstance(value, dict):
            convert_boolean_to_string(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    convert_boolean_to_string(item)
