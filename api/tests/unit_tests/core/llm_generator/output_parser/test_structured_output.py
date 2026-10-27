import inspect
import json
from collections.abc import Iterator
from decimal import Decimal
from types import SimpleNamespace
from typing import Literal, NotRequired
from unittest.mock import MagicMock, patch

import pytest
from typing_extensions import TypedDict

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
from graphon.model_runtime.entities.common_entities import I18nObject
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
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from graphon.model_runtime.entities.model_entities import (
    AIModelEntity,
    FetchFrom,
    ModelFeature,
    ModelType,
    ParameterRule,
    ParameterType,
)


def make_model_schema(model: str) -> AIModelEntity:
    return AIModelEntity(
        model=model,
        label=I18nObject(en_US=model),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
    )


class _ModelInstance(ModelInstance):
    """Return a configured response while checking the invocation contract."""

    def __init__(self, response: LLMResult | Iterator[LLMResultChunk | SimpleNamespace]) -> None:
        self.response = response

    def invoke_llm(self, **kwargs: object):
        inspect.signature(ModelInstance.invoke_llm).bind(self, **kwargs)
        return self.response


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

    def test_parse_structured_output_ignores_json_in_reasoning_block(self):
        # Providers concatenate the reasoning block ahead of the answer, so a JSON object inside
        # <think> must not be taken as the structured output.
        text = '<think>\nthinking out loud\n{"think": "start"}\n</think>\n{"type": "user_input", "content": "hi"}'
        assert _parse_structured_output(text) == {"type": "user_input", "content": "hi"}

    def test_parse_structured_output_prefers_answer_over_reasoning_of_same_shape(self):
        text = '<think>{"type": "draft", "content": "guess"}</think>{"type": "user_input", "content": "final"}'
        assert _parse_structured_output(text) == {"type": "user_input", "content": "final"}

    def test_parse_structured_output_ignores_reasoning_block_with_attributes(self):
        text = '<Think duration="2s">{"think": "start"}</think>{"type": "user_input"}'
        assert _parse_structured_output(text) == {"type": "user_input"}

    def test_parse_structured_output_keeps_literal_think_tags_inside_answer(self):
        text = '{"content": "<think>quoted, not reasoning</think>"}'
        assert _parse_structured_output(text) == {"content": "<think>quoted, not reasoning</think>"}

    def test_parse_structured_output_keeps_literal_think_tags_in_fenced_answer(self):
        # Not strictly valid JSON, so it goes through the repair path, and the tags are still part
        # of the answer rather than reasoning.
        text = '```json\n{"content": "<think>quoted, not reasoning</think>"}\n```'
        assert _parse_structured_output(text) == {"content": "<think>quoted, not reasoning</think>"}

    def test_parse_structured_output_keeps_literal_think_tags_in_repaired_list(self):
        # Repairs into several candidates, and the first one is already the answer: a response that
        # does not open with a reasoning block keeps its literal tags.
        text = '{"content": "<think>quoted, not reasoning</think>"}\n{"extra": 1}'
        assert _parse_structured_output(text) == {"content": "<think>quoted, not reasoning</think>"}

    def test_parse_structured_output_keeps_literal_think_tags_after_reasoning_block(self):
        text = '<think>reasoning without json</think>{"content": "<think>x</think>"}\n{"extra": 1}'
        assert _parse_structured_output(text) == {"content": "<think>x</think>"}

    def test_parse_structured_output_keeps_literal_think_tags_after_empty_reasoning_block(self):
        # The deepseek-r1 '<think>\n\n</think>\n' prefix the repair fallback already knew about.
        text = '<think>\n\n</think>\n{"content": "<think>x</think>"}\n{"extra": 1}'
        assert _parse_structured_output(text) == {"content": "<think>x</think>"}

    @pytest.mark.parametrize("reasoning", ['{"key": "value"}', '{"key": "value"}\n{"other": 1}'])
    def test_parse_structured_output_unclosed_reasoning_block(self, reasoning: str):
        # A truncated answer keeps whatever the repair fallback made of it before.
        text = f"<think>{reasoning}"
        assert _parse_structured_output(text) == {"key": "value"}

    @pytest.mark.parametrize("reasoning", ['{"key": "value"}', '{"key": "value"}\n{"other": 1}'])
    def test_parse_structured_output_reasoning_only_output(self, reasoning: str):
        # Nothing but reasoning: there is no answer to prefer, so the old result stands.
        text = f"<think>{reasoning}</think>"
        assert _parse_structured_output(text) == {"key": "value"}

    def test_parse_structured_output_keeps_candidates_when_answer_cannot_be_repaired(self):
        # Repairing the answer produces a scalar, so retain the original object candidates.
        text = '<think>{"key": "value"}\n{"other": 1}</think>not json'
        assert _parse_structured_output(text) == {"key": "value"}

    def test_parse_structured_output_skips_consecutive_reasoning_blocks(self):
        text = ' \n<Think>{"draft": 1}</THINK>\n<think>{"draft": 2}</think>\n{"answer": "final"}'
        assert _parse_structured_output(text) == {"answer": "final"}

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
        model_schema = make_model_schema("gpt-4")
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
        model_schema = make_model_schema("gpt-4")
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
        model_schema = make_model_schema("gemini-1.5-pro")
        schema = {"type": "object", "additionalProperties": False}

        result = _prepare_schema_for_model("google", model_schema, schema)
        assert "additionalProperties" not in result

    def test_prepare_schema_for_model_ollama(self):
        model_schema = make_model_schema("llama3")
        schema = {"type": "object"}

        result = _prepare_schema_for_model("ollama", model_schema, schema)
        assert result == schema

    def test_prepare_schema_for_model_default(self):
        model_schema = make_model_schema("gpt-4")
        schema = {"type": "object"}

        result = _prepare_schema_for_model("openai", model_schema, schema)
        assert result == {"schema": schema, "name": "llm_response"}

    def test_invoke_llm_with_structured_output_no_stream_native(self):
        model_schema = make_model_schema("gpt-4")
        model_schema.features = [ModelFeature.STRUCTURED_OUTPUT]
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

        llm_response = LLMResult(
            model="gpt-4o",
            message=AssistantPromptMessage(content='{"result": "success"}'),
            usage=LLMUsage.empty_usage(),
            system_fingerprint="fp_native",
            prompt_messages=[UserPromptMessage(content="hi")],
        )

        model_instance = _ModelInstance(llm_response)

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
        model_schema = make_model_schema("gpt-4")
        model_schema.features = []
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

        llm_response = LLMResult(
            model="claude-3",
            message=AssistantPromptMessage(content='{"result": "success"}'),
            usage=LLMUsage.empty_usage(),
            system_fingerprint="fp_prompt",
            prompt_messages=[],
        )

        model_instance = _ModelInstance(llm_response)

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
        model_schema = make_model_schema("gpt-4")
        model_schema.features = []
        model_schema.parameter_rules = []

        llm_response = LLMResult(
            model=model_schema.model,
            message=AssistantPromptMessage(content=[TextPromptMessageContent(data="not a string")]),
            usage=LLMUsage.empty_usage(),
        )

        model_instance = _ModelInstance(llm_response)

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
        model_schema = make_model_schema("gpt-4")
        model_schema.features = []
        model_schema.parameter_rules = []
        model_schema.model = "gpt-4"

        # Model chunks carry validated deltas and stream metadata.
        chunk1 = LLMResultChunk(
            model=model_schema.model,
            delta=LLMResultChunkDelta(
                index=0, message=AssistantPromptMessage(content='{"key": '), usage=LLMUsage.empty_usage()
            ),
            prompt_messages=[UserPromptMessage(content="hi")],
            system_fingerprint="fp1",
        )

        chunk2 = LLMResultChunk(
            model=model_schema.model,
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content='"value"}')),
            prompt_messages=[UserPromptMessage(content="hi")],
            system_fingerprint="fp1",
        )

        chunk3 = LLMResultChunk(
            model=model_schema.model,
            delta=LLMResultChunkDelta(
                index=0, message=AssistantPromptMessage(content=[TextPromptMessageContent(data=" ")])
            ),
            prompt_messages=[UserPromptMessage(content="hi")],
            system_fingerprint="fp1",
        )

        # Preserve coverage for a delta-bearing event that is not an LLMResultChunk.
        event4 = SimpleNamespace(delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="")))

        model_instance = _ModelInstance(iter([chunk1, chunk2, chunk3, event4]))

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

    def test_invoke_llm_with_structured_output_stream_reasoning_block(self):
        model_schema = make_model_schema("gpt-4")
        model_schema.features = []
        model_schema.parameter_rules = []
        model_schema.model = "gpt-4"

        # The reasoning block spans several deltas, so the tags only pair up once accumulated.
        deltas = ['<think>{"think": ', '"start"}</think>', '{"type": "user_input",', ' "content": "hi"}']
        chunks_in = [
            LLMResultChunk(
                model=model_schema.model,
                delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=delta)),
                prompt_messages=[UserPromptMessage(content="hi")],
                system_fingerprint="fp1",
            )
            for delta in deltas
        ]

        generator = invoke_llm_with_structured_output(
            provider="openai",
            model_schema=model_schema,
            model_instance=_ModelInstance(iter(chunks_in)),
            prompt_messages=[UserPromptMessage(content="hi")],
            json_schema={},
            stream=True,
        )

        chunks = list(generator)
        assert chunks[-1].structured_output == {"type": "user_input", "content": "hi"}
        # The streamed text itself is untouched, so the reasoning still reaches the UI.
        assert "".join(str(chunk.delta.message.content) for chunk in chunks[:-1]) == "".join(deltas)

    def test_invoke_llm_with_structured_output_stream_no_id_events(self):
        model_schema = make_model_schema("gpt-4")
        model_schema.features = []
        model_schema.parameter_rules = []
        model_schema.model = "gpt-4"

        model_instance = _ModelInstance(iter([]))

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


class _StructuredOutputCase(TypedDict):
    name: str
    provider: str
    model_name: str
    support_structure_output: bool
    stream: bool
    json_schema: dict[str, object]
    expected_llm_response: LLMResult | list[LLMResultChunk] | list[MagicMock]
    expected_result_type: type[LLMResultWithStructuredOutput] | Literal["generator"] | None
    should_raise: bool
    parameter_rules: NotRequired[list[ParameterRule]]
    expected_response_format: NotRequired[str]
    expected_error: NotRequired[type[Exception]]


def _response_format_rule(*options: str) -> ParameterRule:
    return ParameterRule(
        name="response_format",
        label=I18nObject(en_US="Response Format"),
        type=ParameterType.STRING,
        options=list(options),
    )


def create_mock_usage(prompt_tokens: int = 10, completion_tokens: int = 5) -> LLMUsage:
    """Create a mock LLMUsage with all required fields"""
    return LLMUsage(
        prompt_tokens=prompt_tokens,
        prompt_unit_price=Decimal("0.001"),
        prompt_price_unit=Decimal(1),
        prompt_price=Decimal(str(prompt_tokens)) * Decimal("0.001"),
        completion_tokens=completion_tokens,
        completion_unit_price=Decimal("0.002"),
        completion_price_unit=Decimal(1),
        completion_price=Decimal(str(completion_tokens)) * Decimal("0.002"),
        total_tokens=prompt_tokens + completion_tokens,
        total_price=Decimal(str(prompt_tokens)) * Decimal("0.001") + Decimal(str(completion_tokens)) * Decimal("0.002"),
        currency="USD",
        latency=1.5,
    )


def get_model_entity(provider: str, model_name: str, support_structure_output: bool = False) -> AIModelEntity:
    """Create a mock AIModelEntity for testing"""
    model_schema = MagicMock()
    model_schema.model = model_name
    model_schema.provider = provider
    model_schema.model_type = ModelType.LLM
    model_schema.model_provider = provider
    model_schema.model_name = model_name
    model_schema.support_structure_output = support_structure_output
    model_schema.parameter_rules = list[object]()

    return model_schema


def get_model_instance() -> MagicMock:
    """Create a mock ModelInstance for testing"""
    mock_instance = MagicMock()
    mock_instance.provider = "openai"
    mock_instance.credentials = dict[str, object]()
    return mock_instance


def test_structured_output_parser() -> None:
    """Test cases for invoke_llm_with_structured_output function"""

    testcases: list[_StructuredOutputCase] = [
        # Test case 1: Model with native structured output support, non-streaming
        {
            "name": "native_structured_output_non_streaming",
            "provider": "openai",
            "model_name": "gpt-4o",
            "support_structure_output": True,
            "stream": False,
            "json_schema": {"type": "object", "properties": {"name": {"type": "string"}}},
            "expected_llm_response": LLMResult(
                model="gpt-4o",
                message=AssistantPromptMessage(content='{"name": "test"}'),
                usage=create_mock_usage(prompt_tokens=10, completion_tokens=5),
            ),
            "expected_result_type": LLMResultWithStructuredOutput,
            "should_raise": False,
        },
        # Test case 2: Model with native structured output support, streaming
        {
            "name": "native_structured_output_streaming",
            "provider": "openai",
            "model_name": "gpt-4o",
            "support_structure_output": True,
            "stream": True,
            "json_schema": {"type": "object", "properties": {"name": {"type": "string"}}},
            "expected_llm_response": [
                LLMResultChunk(
                    model="gpt-4o",
                    prompt_messages=[UserPromptMessage(content="test")],
                    system_fingerprint="test",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content='{"name":'),
                        usage=create_mock_usage(prompt_tokens=10, completion_tokens=2),
                    ),
                ),
                LLMResultChunk(
                    model="gpt-4o",
                    prompt_messages=[UserPromptMessage(content="test")],
                    system_fingerprint="test",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=' "test"}'),
                        usage=create_mock_usage(prompt_tokens=10, completion_tokens=3),
                    ),
                ),
            ],
            "expected_result_type": "generator",
            "should_raise": False,
        },
        # Test case 3: Model without native structured output support, non-streaming
        {
            "name": "prompt_based_structured_output_non_streaming",
            "provider": "anthropic",
            "model_name": "claude-3-sonnet",
            "support_structure_output": False,
            "stream": False,
            "json_schema": {"type": "object", "properties": {"answer": {"type": "string"}}},
            "expected_llm_response": LLMResult(
                model="claude-3-sonnet",
                message=AssistantPromptMessage(content='{"answer": "test response"}'),
                usage=create_mock_usage(prompt_tokens=15, completion_tokens=8),
            ),
            "expected_result_type": LLMResultWithStructuredOutput,
            "should_raise": False,
        },
        # Test case 4: Model without native structured output support, streaming
        {
            "name": "prompt_based_structured_output_streaming",
            "provider": "anthropic",
            "model_name": "claude-3-sonnet",
            "support_structure_output": False,
            "stream": True,
            "json_schema": {"type": "object", "properties": {"answer": {"type": "string"}}},
            "expected_llm_response": [
                LLMResultChunk(
                    model="claude-3-sonnet",
                    prompt_messages=[UserPromptMessage(content="test")],
                    system_fingerprint="test",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content='{"answer": "test'),
                        usage=create_mock_usage(prompt_tokens=15, completion_tokens=3),
                    ),
                ),
                LLMResultChunk(
                    model="claude-3-sonnet",
                    prompt_messages=[UserPromptMessage(content="test")],
                    system_fingerprint="test",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(content=' response"}'),
                        usage=create_mock_usage(prompt_tokens=15, completion_tokens=5),
                    ),
                ),
            ],
            "expected_result_type": "generator",
            "should_raise": False,
        },
        # Test case 5: Streaming with list content
        {
            "name": "streaming_with_list_content",
            "provider": "openai",
            "model_name": "gpt-4o",
            "support_structure_output": True,
            "stream": True,
            "json_schema": {"type": "object", "properties": {"data": {"type": "string"}}},
            "expected_llm_response": [
                LLMResultChunk(
                    model="gpt-4o",
                    prompt_messages=[UserPromptMessage(content="test")],
                    system_fingerprint="test",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(
                            content=[
                                TextPromptMessageContent(data='{"data":'),
                            ]
                        ),
                        usage=create_mock_usage(prompt_tokens=10, completion_tokens=2),
                    ),
                ),
                LLMResultChunk(
                    model="gpt-4o",
                    prompt_messages=[UserPromptMessage(content="test")],
                    system_fingerprint="test",
                    delta=LLMResultChunkDelta(
                        index=0,
                        message=AssistantPromptMessage(
                            content=[
                                TextPromptMessageContent(data=' "value"}'),
                            ]
                        ),
                        usage=create_mock_usage(prompt_tokens=10, completion_tokens=3),
                    ),
                ),
            ],
            "expected_result_type": "generator",
            "should_raise": False,
        },
        # Test case 6: Error case - non-string LLM response content (non-streaming)
        {
            "name": "error_non_string_content_non_streaming",
            "provider": "openai",
            "model_name": "gpt-4o",
            "support_structure_output": True,
            "stream": False,
            "json_schema": {"type": "object", "properties": {"name": {"type": "string"}}},
            "expected_llm_response": LLMResult(
                model="gpt-4o",
                message=AssistantPromptMessage(content=None),  # Non-string content
                usage=create_mock_usage(prompt_tokens=10, completion_tokens=5),
            ),
            "expected_result_type": None,
            "should_raise": True,
            "expected_error": OutputParserError,
        },
        # Test case 7: JSON repair scenario
        {
            "name": "json_repair_scenario",
            "provider": "openai",
            "model_name": "gpt-4o",
            "support_structure_output": True,
            "stream": False,
            "json_schema": {"type": "object", "properties": {"name": {"type": "string"}}},
            "expected_llm_response": LLMResult(
                model="gpt-4o",
                message=AssistantPromptMessage(content='{"name": "test"'),  # Invalid JSON - missing closing brace
                usage=create_mock_usage(prompt_tokens=10, completion_tokens=5),
            ),
            "expected_result_type": LLMResultWithStructuredOutput,
            "should_raise": False,
        },
        # Test case 8: Model with parameter rules for response format
        {
            "name": "model_with_parameter_rules",
            "provider": "openai",
            "model_name": "gpt-4o",
            "support_structure_output": True,
            "stream": False,
            "json_schema": {"type": "object", "properties": {"result": {"type": "string"}}},
            "parameter_rules": [_response_format_rule("json_schema")],
            "expected_response_format": "json_schema",
            "expected_llm_response": LLMResult(
                model="gpt-4o",
                message=AssistantPromptMessage(content='{"result": "success"}'),
                usage=create_mock_usage(prompt_tokens=10, completion_tokens=5),
            ),
            "expected_result_type": LLMResultWithStructuredOutput,
            "should_raise": False,
        },
        # Test case 9: Model without native support but with JSON response format rules
        {
            "name": "non_native_with_json_rules",
            "provider": "anthropic",
            "model_name": "claude-3-sonnet",
            "support_structure_output": False,
            "stream": False,
            "json_schema": {"type": "object", "properties": {"output": {"type": "string"}}},
            "parameter_rules": [_response_format_rule("JSON")],
            "expected_response_format": "JSON",
            "expected_llm_response": LLMResult(
                model="claude-3-sonnet",
                message=AssistantPromptMessage(content='{"output": "result"}'),
                usage=create_mock_usage(prompt_tokens=15, completion_tokens=8),
            ),
            "expected_result_type": LLMResultWithStructuredOutput,
            "should_raise": False,
        },
    ]

    for case in testcases:
        # Setup model entity
        model_schema = get_model_entity(case["provider"], case["model_name"], case["support_structure_output"])

        # Add parameter rules if specified
        if "parameter_rules" in case:
            model_schema.parameter_rules = case["parameter_rules"]

        # Setup model instance
        model_instance = get_model_instance()
        model_instance.invoke_llm.return_value = case["expected_llm_response"]

        # Setup prompt messages
        prompt_messages = [
            SystemPromptMessage(content="You are a helpful assistant."),
            UserPromptMessage(content="Generate a response according to the schema."),
        ]

        if case["should_raise"]:
            # Test error cases
            expected_error = case.get("expected_error")
            assert expected_error is not None
            with pytest.raises(expected_error):  # noqa: PT012
                if case["stream"]:
                    result_generator = invoke_llm_with_structured_output(
                        provider=case["provider"],
                        model_schema=model_schema,
                        model_instance=model_instance,
                        prompt_messages=prompt_messages,
                        json_schema=case["json_schema"],
                        stream=case["stream"],
                    )
                    # Consume the generator to trigger the error
                    list(result_generator)
                else:
                    invoke_llm_with_structured_output(
                        provider=case["provider"],
                        model_schema=model_schema,
                        model_instance=model_instance,
                        prompt_messages=prompt_messages,
                        json_schema=case["json_schema"],
                        stream=case["stream"],
                    )
        else:
            # Test successful cases
            with patch(
                "core.llm_generator.output_parser.structured_output.json_repair.loads", autospec=True
            ) as mock_json_repair:
                # Configure json_repair mock for cases that need it
                if case["name"] == "json_repair_scenario":
                    mock_json_repair.return_value = {"name": "test"}

                result = invoke_llm_with_structured_output(
                    provider=case["provider"],
                    model_schema=model_schema,
                    model_instance=model_instance,
                    prompt_messages=prompt_messages,
                    json_schema=case["json_schema"],
                    stream=case["stream"],
                    model_parameters={"temperature": 0.7, "max_tokens": 100},
                )

                if case["expected_result_type"] == "generator":
                    # Test streaming results
                    assert hasattr(result, "__iter__")
                    chunks = list(result)
                    assert len(chunks) > 0

                    # Verify all chunks are LLMResultChunkWithStructuredOutput
                    for chunk in chunks[:-1]:  # All except last
                        assert isinstance(chunk, LLMResultChunkWithStructuredOutput)
                        assert chunk.model == case["model_name"]

                    # Last chunk should have structured output
                    last_chunk = chunks[-1]
                    assert isinstance(last_chunk, LLMResultChunkWithStructuredOutput)
                    assert last_chunk.structured_output is not None
                    assert isinstance(last_chunk.structured_output, dict)
                else:
                    # Test non-streaming results
                    expected_type = case["expected_result_type"]
                    assert isinstance(expected_type, type)
                    assert isinstance(result, expected_type)
                    assert result.model == case["model_name"]
                    assert result.structured_output is not None
                    assert isinstance(result.structured_output, dict)

                # Verify model_instance.invoke_llm was called with correct parameters
                model_instance.invoke_llm.assert_called_once()
                call_args = model_instance.invoke_llm.call_args

                assert call_args.kwargs["stream"] == case["stream"]
                assert "user" not in call_args.kwargs
                assert "temperature" in call_args.kwargs["model_parameters"]
                if "expected_response_format" in case:
                    assert call_args.kwargs["model_parameters"]["response_format"] == case["expected_response_format"]
                assert "max_tokens" in call_args.kwargs["model_parameters"]


def test_parse_structured_output_edge_cases() -> None:
    """Test edge cases for structured output parsing"""

    # Test case with list that contains dict (reasoning model scenario)
    testcase_list_with_dict = {
        "name": "list_with_dict_parsing",
        "provider": "deepseek",
        "model_name": "deepseek-r1",
        "support_structure_output": False,
        "stream": False,
        "json_schema": {"type": "object", "properties": {"thought": {"type": "string"}}},
        "expected_llm_response": LLMResult(
            model="deepseek-r1",
            message=AssistantPromptMessage(content='[{"thought": "reasoning process"}, "other content"]'),
            usage=create_mock_usage(prompt_tokens=10, completion_tokens=5),
        ),
        "expected_result_type": LLMResultWithStructuredOutput,
        "should_raise": False,
    }

    # Setup for list parsing test
    model_schema = get_model_entity(
        testcase_list_with_dict["provider"],
        testcase_list_with_dict["model_name"],
        testcase_list_with_dict["support_structure_output"],
    )

    model_instance = get_model_instance()
    model_instance.invoke_llm.return_value = testcase_list_with_dict["expected_llm_response"]

    prompt_messages = [UserPromptMessage(content="Test reasoning")]

    with patch(
        "core.llm_generator.output_parser.structured_output.json_repair.loads", autospec=True
    ) as mock_json_repair:
        # Mock json_repair to return a list with dict
        mock_json_repair.return_value = [{"thought": "reasoning process"}, "other content"]

        result = invoke_llm_with_structured_output(
            provider=testcase_list_with_dict["provider"],
            model_schema=model_schema,
            model_instance=model_instance,
            prompt_messages=prompt_messages,
            json_schema=testcase_list_with_dict["json_schema"],
            stream=testcase_list_with_dict["stream"],
        )

        assert isinstance(result, LLMResultWithStructuredOutput)
        assert result.structured_output == {"thought": "reasoning process"}


def test_model_specific_schema_preparation() -> None:
    """Test schema preparation for different model types"""

    # Test Gemini model
    gemini_case = {
        "provider": "google",
        "model_name": "gemini-pro",
        "support_structure_output": True,
        "stream": False,
        "json_schema": {"type": "object", "properties": {"result": {"type": "boolean"}}, "additionalProperties": False},
    }

    model_schema = get_model_entity(
        gemini_case["provider"], gemini_case["model_name"], gemini_case["support_structure_output"]
    )

    model_instance = get_model_instance()
    model_instance.invoke_llm.return_value = LLMResult(
        model="gemini-pro",
        message=AssistantPromptMessage(content='{"result": "true"}'),
        usage=create_mock_usage(prompt_tokens=10, completion_tokens=5),
    )

    prompt_messages = [UserPromptMessage(content="Test")]

    result = invoke_llm_with_structured_output(
        provider=gemini_case["provider"],
        model_schema=model_schema,
        model_instance=model_instance,
        prompt_messages=prompt_messages,
        json_schema=gemini_case["json_schema"],
        stream=gemini_case["stream"],
    )

    assert isinstance(result, LLMResultWithStructuredOutput)

    # Verify model_instance.invoke_llm was called and check the schema preparation
    model_instance.invoke_llm.assert_called_once()
    call_args = model_instance.invoke_llm.call_args

    # For Gemini, the schema should not have additionalProperties and boolean should be converted to string
    assert "json_schema" in call_args.kwargs["model_parameters"]
