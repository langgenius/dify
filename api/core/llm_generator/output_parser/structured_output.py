import json
from collections.abc import Mapping, Sequence
from copy import deepcopy
from enum import StrEnum
from typing import Any, TypeVar, cast

import json_repair
from pydantic import BaseModel, TypeAdapter, ValidationError

from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.file_ref import detect_file_path_fields
from core.llm_generator.prompts import (
    STRUCTURED_OUTPUT_FINAL_TURN_REMINDER,
    STRUCTURED_OUTPUT_PROMPT,
    STRUCTURED_OUTPUT_TOOL_CALL_PROMPT,
)
from core.model_manager import ModelInstance
from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultWithStructuredOutput,
)
from core.model_runtime.entities.message_entities import (
    PromptMessage,
    PromptMessageTool,
    SystemPromptMessage,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import AIModelEntity, ModelFeature, ParameterRule


class ResponseFormat(StrEnum):
    """Constants for model response formats"""

    JSON_SCHEMA = "json_schema"  # model's structured output mode. some model like gemini, gpt-4o,  support this mode.
    JSON = "JSON"  # model's json mode. some model like claude support this mode.
    JSON_OBJECT = "json_object"  # json mode's another alias. some model like deepseek-chat, qwen use this alias.


class SpecialModelType(StrEnum):
    """Constants for identifying model types"""

    GEMINI = "gemini"
    OLLAMA = "ollama"


# Tool name for structured output via tool call
STRUCTURED_OUTPUT_TOOL_NAME = "structured_output"

# Features that indicate tool call support
TOOL_CALL_FEATURES = {ModelFeature.TOOL_CALL, ModelFeature.MULTI_TOOL_CALL, ModelFeature.STREAM_TOOL_CALL}

T = TypeVar("T", bound=BaseModel)


def invoke_llm_with_structured_output(
    *,
    provider: str,
    model_schema: AIModelEntity,
    model_instance: ModelInstance,
    prompt_messages: Sequence[PromptMessage],
    json_schema: Mapping[str, Any],
    model_parameters: Mapping[str, Any] | None = None,
    tools: Sequence[PromptMessageTool] | None = None,
    stop: list[str] | None = None,
    user: str | None = None,
    callbacks: list[Callback] | None = None,
    allow_file_path: bool = False,
) -> LLMResultWithStructuredOutput:
    """
    Invoke large language model with structured output.

    This method invokes model_instance.invoke_llm with json_schema and parses
    the result as structured output.

    :param provider: model provider name
    :param model_schema: model schema entity
    :param model_instance: model instance to invoke
    :param prompt_messages: prompt messages
    :param json_schema: json schema for structured output
    :param model_parameters: model parameters
    :param tools: tools for tool calling
    :param stop: stop words
    :param user: unique user id
    :param callbacks: callbacks
    :param allow_file_path: allow schema fields formatted as file-path
    :return: response with structured output
    """
    model_parameters_with_json_schema: dict[str, Any] = dict(model_parameters or {})

    if detect_file_path_fields(json_schema) and not allow_file_path:
        raise OutputParserError("Structured output file paths are only supported in sandbox mode.")

    # Determine structured output strategy

    use_tool_call = False
    if model_schema.support_structure_output:
        # Priority 1: Native JSON schema support
        model_parameters_with_json_schema = _handle_native_json_schema(
            provider, model_schema, json_schema, model_parameters_with_json_schema, model_schema.parameter_rules
        )
    elif _supports_tool_call(model_schema):
        # Priority 2: Tool call based structured output
        structured_output_tool = _create_structured_output_tool(json_schema)
        tools = [structured_output_tool]
        use_tool_call = True
    else:
        # Priority 3: Prompt-based fallback
        _set_response_format(model_parameters_with_json_schema, model_schema.parameter_rules)
    prompt_messages = _handle_prompt_based_schema(
        prompt_messages=prompt_messages,
        structured_output_schema=json_schema,
        use_tool_call=use_tool_call,
    )

    # Append a "final turn" reminder at the very end of the conversation so the
    # model sees it right before generating.  This exploits recency bias to
    # override the in-context bash/tool-call patterns from earlier history.
    # Merge into the last user message when possible to avoid consecutive
    # UserPromptMessages (some APIs like Anthropic require user/assistant alternation).
    if use_tool_call:
        messages = list(prompt_messages)
        if messages and isinstance(messages[-1], UserPromptMessage) and isinstance(messages[-1].content, str):
            messages[-1] = UserPromptMessage(
                content=messages[-1].content + "\n\n" + STRUCTURED_OUTPUT_FINAL_TURN_REMINDER,
            )
        else:
            messages.append(UserPromptMessage(content=STRUCTURED_OUTPUT_FINAL_TURN_REMINDER))
        prompt_messages = messages

    llm_result = model_instance.invoke_llm(
        prompt_messages=list(prompt_messages),
        model_parameters=model_parameters_with_json_schema,
        tools=tools,
        stop=stop,
        stream=False,
        user=user,
        callbacks=callbacks,
    )

    # Non-streaming result
    structured_output = _extract_structured_output(llm_result)

    # Fill missing fields with default values
    structured_output = fill_defaults_from_schema(structured_output, json_schema)

    return LLMResultWithStructuredOutput(
        structured_output=structured_output,
        model=llm_result.model,
        message=llm_result.message,
        usage=llm_result.usage,
        system_fingerprint=llm_result.system_fingerprint,
        prompt_messages=llm_result.prompt_messages,
    )


def invoke_llm_with_pydantic_model(
    *,
    provider: str,
    model_schema: AIModelEntity,
    model_instance: ModelInstance,
    prompt_messages: Sequence[PromptMessage],
    output_model: type[T],
    model_parameters: Mapping[str, Any] | None = None,
    tools: Sequence[PromptMessageTool] | None = None,
    stop: list[str] | None = None,
    user: str | None = None,
    callbacks: list[Callback] | None = None,
) -> T:
    """
    Invoke large language model with a Pydantic output model.

    This helper generates a JSON schema from the Pydantic model, invokes the
    structured-output LLM path, and validates the result.

    The helper performs a non-streaming invocation and returns the validated
    Pydantic model directly.
    """
    json_schema = _schema_from_pydantic(output_model)

    result = invoke_llm_with_structured_output(
        provider=provider,
        model_schema=model_schema,
        model_instance=model_instance,
        prompt_messages=prompt_messages,
        json_schema=json_schema,
        model_parameters=model_parameters,
        tools=tools,
        stop=stop,
        user=user,
        callbacks=callbacks,
    )

    structured_output = result.structured_output
    if structured_output is None:
        raise OutputParserError("Structured output is empty")

    return _validate_structured_output(output_model, structured_output)


def parse_structured_output_text(*, result_text: str, json_schema: Mapping[str, Any]) -> dict[str, Any]:
    structured_output = _parse_structured_output(result_text)
    return fill_defaults_from_schema(structured_output, json_schema)


def _schema_from_pydantic(output_model: type[BaseModel]) -> dict[str, Any]:
    return output_model.model_json_schema()


def _validate_structured_output(
    output_model: type[T],
    structured_output: Mapping[str, Any],
) -> T:
    try:
        validated_output = output_model.model_validate(structured_output)
    except ValidationError as exc:
        raise OutputParserError(f"Structured output validation failed: {exc}") from exc
    return validated_output


def _supports_tool_call(model_schema: AIModelEntity) -> bool:
    """Check if model supports tool call feature."""
    return bool(set(model_schema.features or []) & TOOL_CALL_FEATURES)


def _create_structured_output_tool(json_schema: Mapping[str, Any]) -> PromptMessageTool:
    """Create a tool definition for structured output."""
    return PromptMessageTool(
        name=STRUCTURED_OUTPUT_TOOL_NAME,
        description="Generate structured output according to the provided schema. "
        "You MUST call this function to provide your response in the required format.",
        parameters=dict(json_schema),
    )


def _extract_structured_output(llm_result: LLMResult) -> Mapping[str, Any]:
    """
    Extract structured output from LLM result (non-streaming).
    First tries to extract from tool_calls (if present), then falls back to text content.
    """
    # Try to extract from tool call first
    tool_calls = llm_result.message.tool_calls
    if tool_calls:
        for tool_call in tool_calls:
            if tool_call.function.name == STRUCTURED_OUTPUT_TOOL_NAME:
                return _parse_tool_call_arguments(tool_call.function.arguments)

    # Fallback to text content parsing
    content = llm_result.message.get_text_content()
    return _parse_structured_output(content)


def _parse_tool_call_arguments(arguments: str) -> Mapping[str, Any]:
    """Parse JSON from tool call arguments."""
    if not arguments:
        raise OutputParserError("Tool call arguments is empty")

    try:
        parsed = json.loads(arguments)
        if not isinstance(parsed, dict):
            raise OutputParserError(f"Tool call arguments is not a dict: {arguments}")
        return parsed
    except json.JSONDecodeError:
        # Try to repair malformed JSON
        repaired = json_repair.loads(arguments)
        if not isinstance(repaired, dict):
            raise OutputParserError(f"Failed to parse tool call arguments: {arguments}")
        return repaired


def _get_default_value_for_type(type_name: str | list[str] | None) -> Any:
    """Get default empty value for a JSON schema type."""
    # Handle array of types (e.g., ["string", "null"])
    if isinstance(type_name, list):
        # Use the first non-null type
        type_name = next((t for t in type_name if t != "null"), None)

    if type_name == "string":
        return ""
    elif type_name == "object":
        return {}
    elif type_name == "array":
        return []
    elif type_name in {"number", "integer"}:
        return 0
    elif type_name == "boolean":
        return False
    elif type_name == "null" or type_name is None:
        return None
    else:
        return None


def fill_defaults_from_schema(
    output: Mapping[str, Any],
    json_schema: Mapping[str, Any],
) -> dict[str, Any]:
    """
    Fill missing required fields in output with default empty values based on JSON schema.

    Only fills default values for fields that are marked as required in the schema.
    Recursively processes nested objects to fill their required fields as well.

    Default values by type:
    - string → ""
    - object → {} (with nested required fields filled)
    - array → []
    - number/integer → 0
    - boolean → False
    - null → None
    """
    result = dict(output)
    properties = json_schema.get("properties", {})
    required_fields = set(json_schema.get("required", []))

    for prop_name, prop_schema in properties.items():
        prop_type = prop_schema.get("type")
        is_required = prop_name in required_fields

        if prop_name not in result:
            # Field is missing from output
            if is_required:
                # Only fill default value for required fields
                if prop_type == "object" and "properties" in prop_schema:
                    # Create empty object and recursively fill its required fields
                    result[prop_name] = fill_defaults_from_schema({}, prop_schema)
                else:
                    result[prop_name] = _get_default_value_for_type(prop_type)
        elif isinstance(result[prop_name], dict) and prop_type == "object" and "properties" in prop_schema:
            # Field exists and is an object, recursively fill nested required fields
            result[prop_name] = fill_defaults_from_schema(result[prop_name], prop_schema)

    return result


def _handle_native_json_schema(
    provider: str,
    model_schema: AIModelEntity,
    structured_output_schema: Mapping[str, Any],
    model_parameters: dict[str, Any],
    rules: list[ParameterRule],
):
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
        if rule.name == "response_format" and ResponseFormat.JSON_SCHEMA in rule.options:
            model_parameters["response_format"] = ResponseFormat.JSON_SCHEMA

    return model_parameters


def _set_response_format(model_parameters: dict[str, Any], rules: list[ParameterRule]):
    """
    Set the appropriate response format parameter based on model rules.

    :param model_parameters: Model parameters to update
    :param rules: Model parameter rules
    """
    for rule in rules:
        if rule.name == "response_format":
            if ResponseFormat.JSON in rule.options:
                model_parameters["response_format"] = ResponseFormat.JSON
            elif ResponseFormat.JSON_OBJECT in rule.options:
                model_parameters["response_format"] = ResponseFormat.JSON_OBJECT


def _handle_prompt_based_schema(
    prompt_messages: Sequence[PromptMessage],
    structured_output_schema: Mapping[str, Any],
    *,
    use_tool_call: bool = False,
) -> list[PromptMessage]:
    """
    Inject structured output instructions into the system prompt.

    When use_tool_call is True, the prompt explicitly instructs the model to call the
    `structured_output` tool instead of outputting raw JSON, which significantly
    improves tool-call compliance for models that otherwise tend to respond with
    plain text.

    Args:
        prompt_messages: Original sequence of prompt messages
        structured_output_schema: JSON schema for the expected output
        use_tool_call: If True, use tool-call-specific prompt that forces the model
            to invoke the structured_output tool rather than emitting JSON text.

    Returns:
        list[PromptMessage]: Updated prompt messages with structured output requirements
    """
    if use_tool_call:
        # Tool call mode: schema is already in the tool definition, no need to duplicate
        structured_output_prompt = STRUCTURED_OUTPUT_TOOL_CALL_PROMPT
    else:
        schema_str = json.dumps(structured_output_schema, ensure_ascii=False)
        structured_output_prompt = STRUCTURED_OUTPUT_PROMPT.replace("{{schema}}", schema_str)

    system_prompt = next(
        (prompt for prompt in prompt_messages if isinstance(prompt, SystemPromptMessage)),
        None,
    )
    system_prompt_content = (
        structured_output_prompt + "\n\n" + system_prompt.content
        if system_prompt and isinstance(system_prompt.content, str)
        else structured_output_prompt
    )
    system_prompt = SystemPromptMessage(content=system_prompt_content)

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


def _prepare_schema_for_model(provider: str, model_schema: AIModelEntity, schema: Mapping):
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

    # Strip Dify-internal custom formats (e.g. "file-path") that external model APIs
    # do not recognise.  The field type ("string") is sufficient for the model to
    # produce the expected value; the custom format is only used by Dify post-processing.
    _strip_custom_formats(processed_schema)

    # Apply model-specific transformations
    if SpecialModelType.GEMINI in model_schema.model:
        remove_additional_properties(processed_schema)
        return processed_schema
    elif SpecialModelType.OLLAMA in provider:
        return processed_schema
    else:
        # OpenAI-style native structured output requires every property key to
        # appear in ``required``.  Ensure this recursively so user schemas that
        # leave ``required`` empty or partial don't get rejected by the API.
        _ensure_all_properties_required(processed_schema)
        return {"schema": processed_schema, "name": "llm_response"}


def remove_additional_properties(schema: dict):
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


def convert_boolean_to_string(schema: dict):
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


# Formats that are Dify-internal and not part of the standard JSON Schema spec
# recognised by model providers (OpenAI, Azure, Google, etc.).
_CUSTOM_FORMATS = frozenset({"file-path"})


def _strip_custom_formats(schema: dict) -> None:
    """Remove Dify-internal ``format`` values from a JSON schema in-place.

    Model APIs (OpenAI, Azure, etc.) reject unknown format values in their
    structured-output / response_format mode.  This strips only the formats
    that are Dify-specific (e.g. ``file-path``); standard formats like
    ``date-time`` or ``email`` are left untouched.
    """
    if not isinstance(schema, dict):
        return

    fmt = schema.get("format")
    if isinstance(fmt, str) and fmt.lower().replace("_", "-") in _CUSTOM_FORMATS:
        del schema["format"]

    for value in schema.values():
        if isinstance(value, dict):
            _strip_custom_formats(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _strip_custom_formats(item)


def _ensure_all_properties_required(schema: dict) -> None:
    """Ensure ``required`` lists every key from ``properties``, recursively.

    OpenAI's native structured-output mode (response_format with json_schema)
    mandates that ``required`` contains ALL property names.  Schemas authored
    in Dify may leave ``required`` empty or partial, so we patch it here
    before sending to the API.
    """
    if not isinstance(schema, dict):
        return

    if schema.get("type") == "object":
        properties = schema.get("properties")
        if isinstance(properties, dict) and properties:
            schema["required"] = list(properties.keys())

    for value in schema.values():
        if isinstance(value, dict):
            _ensure_all_properties_required(value)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, dict):
                    _ensure_all_properties_required(item)
