from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.structured_output import invoke_llm_with_structured_output
from core.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultChunk,
    LLMResultChunkDelta,
    LLMResultChunkWithStructuredOutput,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.entities.model_entities import AIModelEntity, ModelType


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
    model_schema.parameter_rules = []

    return model_schema


def get_model_instance() -> MagicMock:
    """Create a mock ModelInstance for testing"""
    mock_instance = MagicMock()
    mock_instance.provider = "openai"
    mock_instance.credentials = {}
    return mock_instance


def test_structured_output_parser():
    """Test cases for invoke_llm_with_structured_output function"""

    testcases = [
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
            "parameter_rules": [
                MagicMock(name="response_format", options=["json_schema"], required=False),
            ],
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
            "parameter_rules": [
                MagicMock(name="response_format", options=["JSON"], required=False),
            ],
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
        print(f"Running test case: {case['name']}")

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
            with pytest.raises(case["expected_error"]):  # noqa: PT012
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
            with patch("core.llm_generator.output_parser.structured_output.json_repair.loads") as mock_json_repair:
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
                    user="test_user",
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
                    assert isinstance(result, case["expected_result_type"])
                    assert result.model == case["model_name"]
                    assert result.structured_output is not None
                    assert isinstance(result.structured_output, dict)

                # Verify model_instance.invoke_llm was called with correct parameters
                model_instance.invoke_llm.assert_called_once()
                call_args = model_instance.invoke_llm.call_args

                assert call_args.kwargs["stream"] == case["stream"]
                assert call_args.kwargs["user"] == "test_user"
                assert "temperature" in call_args.kwargs["model_parameters"]
                assert "max_tokens" in call_args.kwargs["model_parameters"]


def test_parse_structured_output_edge_cases():
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

    with patch("core.llm_generator.output_parser.structured_output.json_repair.loads") as mock_json_repair:
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


def test_model_specific_schema_preparation():
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
