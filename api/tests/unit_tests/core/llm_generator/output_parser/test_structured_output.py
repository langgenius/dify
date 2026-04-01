import json
from unittest.mock import MagicMock, patch

import pytest
from graphon.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import AIModelEntity, ParameterRule, ParameterType

from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.structured_output import (
    ResponseFormat,
    _handle_native_json_schema,
    _handle_prompt_based_schema,
    _parse_structured_output,
    _prepare_schema_for_model,
    _set_response_format,
    convert_boolean_to_string,
    invoke_llm_with_structured_output,
    remove_additional_properties,
)
from core.model_manager import ModelInstance


class TestStructuredOutput:
    def test_remove_additional_properties(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
            "additionalProperties": False,
            "nested": {"type": "object", "additionalProperties": True},
            "items": [{"type": "object", "additionalProperties": False}],
        }
        remove_additional_properties(schema)
        assert "additionalProperties" not in schema
        assert "additionalProperties" not in schema["nested"]
        assert "additionalProperties" not in schema["items"][0]

        # Test with non-dict input
        remove_additional_properties(None)  # Should not raise
        remove_additional_properties([])  # Should not raise

    def test_convert_boolean_to_string(self):
        schema = {
            "type": "object",
            "properties": {
                "is_active": {"type": "boolean"},
                "tags": {"type": "array", "items": {"type": "boolean"}},
                "list_schema": [{"type": "boolean"}],
            },
        }
        convert_boolean_to_string(schema)
        assert schema["properties"]["is_active"]["type"] == "string"
        assert schema["properties"]["tags"]["items"]["type"] == "string"
        assert schema["properties"]["list_schema"][0]["type"] == "string"

        # Test with non-dict input
        convert_boolean_to_string(None)  # Should not raise
        convert_boolean_to_string([])  # Should not raise

    def test_parse_structured_output_valid(self):
        text = '{"key": "value"}'
        assert _parse_structured_output(text) == {"key": "value"}

    def test_parse_structured_output_non_dict_valid_json(self):
        # Even if it's valid JSON, if it's not a dict, it should try repair or fail
        text = '["a", "b"]'
        with patch("json_repair.loads") as mock_repair:
            mock_repair.return_value = {"key": "value"}
            assert _parse_structured_output(text) == {"key": "value"}

    def test_parse_structured_output_not_dict_fail_via_validate(self):
        # Force TypeAdapter to return a non-dict to trigger line 292
        with patch("pydantic.TypeAdapter.validate_json") as mock_validate:
            mock_validate.return_value = ["a list"]
            with pytest.raises(OutputParserError) as excinfo:
                _parse_structured_output('["a list"]')
            assert "Failed to parse structured output" in str(excinfo.value)

    def test_parse_structured_output_repair_success(self):
        text = "{'key': 'value'}"  # Invalid JSON (single quotes)
        # json_repair should handle this
        assert _parse_structured_output(text) == {"key": "value"}

    def test_parse_structured_output_repair_list(self):
        # Deepseek-r1 case: result is a list containing a dict
        text = '[{"key": "value"}]'
        assert _parse_structured_output(text) == {"key": "value"}

    def test_parse_structured_output_repair_list_no_dict(self):
        # Deepseek-r1 case: result is a list with NO dict
        text = "[1, 2, 3]"
        assert _parse_structured_output(text) == {}

    def test_parse_structured_output_repair_fail(self):
        text = "not a json at all"
        with patch("json_repair.loads") as mock_repair:
            mock_repair.return_value = "still not a dict or list"
            with pytest.raises(OutputParserError):
                _parse_structured_output(text)

    def test_set_response_format(self):
        # Test JSON
        params = {}
        rules = [
            ParameterRule(
                name="response_format",
                label={"en_US": ""},
                type=ParameterType.STRING,
                help={"en_US": ""},
                options=[ResponseFormat.JSON],
            )
        ]
        _set_response_format(params, rules)
        assert params["response_format"] == ResponseFormat.JSON

        # Test JSON_OBJECT
        params = {}
        rules = [
            ParameterRule(
                name="response_format",
                label={"en_US": ""},
                type=ParameterType.STRING,
                help={"en_US": ""},
                options=[ResponseFormat.JSON_OBJECT],
            )
        ]
        _set_response_format(params, rules)
        assert params["response_format"] == ResponseFormat.JSON_OBJECT

    def test_handle_native_json_schema(self):
        provider = "openai"
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.model = "gpt-4"
        structured_output_schema = {"type": "object"}
        model_parameters = {}
        rules = [
            ParameterRule(
                name="response_format",
                label={"en_US": ""},
                type=ParameterType.STRING,
                help={"en_US": ""},
                options=[ResponseFormat.JSON_SCHEMA],
            )
        ]

        updated_params = _handle_native_json_schema(
            provider, model_schema, structured_output_schema, model_parameters, rules
        )

        assert "json_schema" in updated_params
        assert json.loads(updated_params["json_schema"]) == {"schema": {"type": "object"}, "name": "llm_response"}
        assert updated_params["response_format"] == ResponseFormat.JSON_SCHEMA

    def test_handle_native_json_schema_no_format_rule(self):
        provider = "openai"
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.model = "gpt-4"
        structured_output_schema = {"type": "object"}
        model_parameters = {}
        rules = []

        updated_params = _handle_native_json_schema(
            provider, model_schema, structured_output_schema, model_parameters, rules
        )

        assert "json_schema" in updated_params
        assert "response_format" not in updated_params

    def test_handle_prompt_based_schema_with_system_prompt(self):
        prompt_messages = [
            SystemPromptMessage(content="Existing system prompt"),
            UserPromptMessage(content="User question"),
        ]
        schema = {"type": "object"}

        result = _handle_prompt_based_schema(prompt_messages, schema)

        assert len(result) == 2
        assert isinstance(result[0], SystemPromptMessage)
        assert "Existing system prompt" in result[0].content
        assert json.dumps(schema) in result[0].content
        assert isinstance(result[1], UserPromptMessage)

    def test_handle_prompt_based_schema_without_system_prompt(self):
        prompt_messages = [UserPromptMessage(content="User question")]
        schema = {"type": "object"}

        result = _handle_prompt_based_schema(prompt_messages, schema)

        assert len(result) == 2
        assert isinstance(result[0], SystemPromptMessage)
        assert json.dumps(schema) in result[0].content
        assert isinstance(result[1], UserPromptMessage)

    def test_prepare_schema_for_model_gemini(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.model = "gemini-1.5-pro"
        schema = {"type": "object", "additionalProperties": False}

        result = _prepare_schema_for_model("google", model_schema, schema)
        assert "additionalProperties" not in result

    def test_prepare_schema_for_model_ollama(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.model = "llama3"
        schema = {"type": "object"}

        result = _prepare_schema_for_model("ollama", model_schema, schema)
        assert result == schema

    def test_prepare_schema_for_model_default(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.model = "gpt-4"
        schema = {"type": "object"}

        result = _prepare_schema_for_model("openai", model_schema, schema)
        assert result == {"schema": schema, "name": "llm_response"}

    def test_invoke_llm_with_structured_output_no_stream_native(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.support_structure_output = True
        model_schema.parameter_rules = [
            ParameterRule(
                name="response_format",
                label={"en_US": ""},
                type=ParameterType.STRING,
                help={"en_US": ""},
                options=[ResponseFormat.JSON_SCHEMA],
            )
        ]
        model_schema.model = "gpt-4o"

        model_instance = MagicMock(spec=ModelInstance)
        mock_result = MagicMock(spec=LLMResult)
        mock_result.message = AssistantPromptMessage(content='{"result": "success"}')
        mock_result.model = "gpt-4o"
        mock_result.usage = LLMUsage.empty_usage()
        mock_result.system_fingerprint = "fp_native"
        mock_result.prompt_messages = [UserPromptMessage(content="hi")]

        model_instance.invoke_llm.return_value = mock_result

        result = invoke_llm_with_structured_output(
            provider="openai",
            model_schema=model_schema,
            model_instance=model_instance,
            prompt_messages=[UserPromptMessage(content="hi")],
            json_schema={"type": "object"},
            stream=False,
        )

        assert isinstance(result, LLMResultWithStructuredOutput)
        assert result.structured_output == {"result": "success"}
        assert result.system_fingerprint == "fp_native"

    def test_invoke_llm_with_structured_output_no_stream_prompt_based(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.support_structure_output = False
        model_schema.parameter_rules = [
            ParameterRule(
                name="response_format",
                label={"en_US": ""},
                type=ParameterType.STRING,
                help={"en_US": ""},
                options=[ResponseFormat.JSON],
            )
        ]
        model_schema.model = "claude-3"

        model_instance = MagicMock(spec=ModelInstance)
        mock_result = MagicMock(spec=LLMResult)
        mock_result.message = AssistantPromptMessage(content='{"result": "success"}')
        mock_result.model = "claude-3"
        mock_result.usage = LLMUsage.empty_usage()
        mock_result.system_fingerprint = "fp_prompt"
        mock_result.prompt_messages = []

        model_instance.invoke_llm.return_value = mock_result

        result = invoke_llm_with_structured_output(
            provider="anthropic",
            model_schema=model_schema,
            model_instance=model_instance,
            prompt_messages=[UserPromptMessage(content="hi")],
            json_schema={"type": "object"},
            stream=False,
        )

        assert isinstance(result, LLMResultWithStructuredOutput)
        assert result.structured_output == {"result": "success"}
        assert result.system_fingerprint == "fp_prompt"

    def test_invoke_llm_with_structured_output_no_string_error(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.support_structure_output = False
        model_schema.parameter_rules = []

        model_instance = MagicMock(spec=ModelInstance)
        mock_result = MagicMock(spec=LLMResult)
        mock_result.message = AssistantPromptMessage(content=[TextPromptMessageContent(data="not a string")])

        model_instance.invoke_llm.return_value = mock_result

        with pytest.raises(OutputParserError) as excinfo:
            invoke_llm_with_structured_output(
                provider="anthropic",
                model_schema=model_schema,
                model_instance=model_instance,
                prompt_messages=[],
                json_schema={},
                stream=False,
            )
        assert "Failed to parse structured output, LLM result is not a string" in str(excinfo.value)

    def test_invoke_llm_with_structured_output_stream(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.support_structure_output = False
        model_schema.parameter_rules = []
        model_schema.model = "gpt-4"

        model_instance = MagicMock(spec=ModelInstance)

        # Mock chunks
        chunk1 = MagicMock(spec=LLMResultChunk)
        chunk1.delta = LLMResultChunkDelta(
            index=0, message=AssistantPromptMessage(content='{"key": '), usage=LLMUsage.empty_usage()
        )
        chunk1.prompt_messages = [UserPromptMessage(content="hi")]
        chunk1.system_fingerprint = "fp1"

        chunk2 = MagicMock(spec=LLMResultChunk)
        chunk2.delta = LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content='"value"}'))
        chunk2.prompt_messages = [UserPromptMessage(content="hi")]
        chunk2.system_fingerprint = "fp1"

        chunk3 = MagicMock(spec=LLMResultChunk)
        chunk3.delta = LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(
                content=[
                    TextPromptMessageContent(data=" "),
                ]
            ),
        )
        chunk3.prompt_messages = [UserPromptMessage(content="hi")]
        chunk3.system_fingerprint = "fp1"

        event4 = MagicMock()
        event4.delta = LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=""))

        model_instance.invoke_llm.return_value = [chunk1, chunk2, chunk3, event4]

        generator = invoke_llm_with_structured_output(
            provider="openai",
            model_schema=model_schema,
            model_instance=model_instance,
            prompt_messages=[UserPromptMessage(content="hi")],
            json_schema={},
            stream=True,
        )

        chunks = list(generator)
        assert len(chunks) == 5
        assert chunks[-1].structured_output == {"key": "value"}
        assert chunks[-1].system_fingerprint == "fp1"
        assert chunks[-1].prompt_messages == [UserPromptMessage(content="hi")]

    def test_invoke_llm_with_structured_output_stream_no_id_events(self):
        model_schema = MagicMock(spec=AIModelEntity)
        model_schema.support_structure_output = False
        model_schema.parameter_rules = []
        model_schema.model = "gpt-4"

        model_instance = MagicMock(spec=ModelInstance)
        model_instance.invoke_llm.return_value = []

        generator = invoke_llm_with_structured_output(
            provider="openai",
            model_schema=model_schema,
            model_instance=model_instance,
            prompt_messages=[],
            json_schema={},
            stream=True,
        )

        with pytest.raises(OutputParserError):
            list(generator)

    def test_parse_structured_output_empty_string(self):
        with pytest.raises(OutputParserError):
            _parse_structured_output("")
