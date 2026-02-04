from decimal import Decimal
from typing import Any, cast
from unittest.mock import MagicMock, patch

import pytest
from pydantic import BaseModel, ConfigDict

from core.llm_generator.output_parser.errors import OutputParserError
from core.llm_generator.output_parser.structured_output import (
    fill_defaults_from_schema,
    invoke_llm_with_pydantic_model,
    invoke_llm_with_structured_output,
)
from core.model_runtime.entities.llm_entities import (
    LLMResult,
    LLMResultWithStructuredOutput,
    LLMUsage,
)
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    SystemPromptMessage,
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

    return cast(AIModelEntity, model_schema)


def get_model_instance() -> MagicMock:
    """Create a mock ModelInstance for testing"""
    mock_instance = MagicMock()
    mock_instance.provider = "openai"
    mock_instance.credentials = {}
    return mock_instance


def test_structured_output_parser():
    """Test cases for invoke_llm_with_structured_output function"""

    testcases: list[dict[str, Any]] = [
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
        # Setup model entity
        model_schema = get_model_entity(case["provider"], case["model_name"], case["support_structure_output"])

        # Add parameter rules if specified
        if "parameter_rules" in case:
            cast(Any, model_schema).parameter_rules = case["parameter_rules"]

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
            with pytest.raises(case["expected_error"]):
                invoke_llm_with_structured_output(
                    provider=case["provider"],
                    model_schema=model_schema,
                    model_instance=model_instance,
                    prompt_messages=prompt_messages,
                    json_schema=case["json_schema"],
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
                    model_parameters={"temperature": 0.7, "max_tokens": 100},
                    user="test_user",
                )

                # Test non-streaming results
                expected_type = cast(type, case["expected_result_type"])
                assert isinstance(result, expected_type)
                assert result.model == case["model_name"]
                assert result.structured_output is not None
                assert isinstance(result.structured_output, dict)

                # Verify model_instance.invoke_llm was called with correct parameters
                model_instance.invoke_llm.assert_called_once()
                call_args = model_instance.invoke_llm.call_args

                assert call_args.kwargs["stream"] is False
                assert call_args.kwargs["user"] == "test_user"
                assert "temperature" in call_args.kwargs["model_parameters"]
                assert "max_tokens" in call_args.kwargs["model_parameters"]


def test_parse_structured_output_edge_cases():
    """Test edge cases for structured output parsing"""

    # Test case with list that contains dict (reasoning model scenario)
    testcase_list_with_dict: dict[str, Any] = {
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
        )

        assert isinstance(result, LLMResultWithStructuredOutput)
        assert result.structured_output == {"thought": "reasoning process"}


def test_model_specific_schema_preparation():
    """Test schema preparation for different model types"""

    # Test Gemini model
    gemini_case: dict[str, Any] = {
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
    )

    assert isinstance(result, LLMResultWithStructuredOutput)

    # Verify model_instance.invoke_llm was called and check the schema preparation
    model_instance.invoke_llm.assert_called_once()
    call_args = model_instance.invoke_llm.call_args

    # For Gemini, the schema should not have additionalProperties and boolean should be converted to string
    assert "json_schema" in call_args.kwargs["model_parameters"]


class ExampleOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str


def test_structured_output_with_pydantic_model_non_streaming():
    model_schema = get_model_entity("openai", "gpt-4o", support_structure_output=True)
    model_instance = get_model_instance()
    model_instance.invoke_llm.return_value = LLMResult(
        model="gpt-4o",
        message=AssistantPromptMessage(content='{"name": "test"}'),
        usage=create_mock_usage(prompt_tokens=8, completion_tokens=4),
    )

    prompt_messages = [UserPromptMessage(content="Return a JSON object with name.")]

    result = invoke_llm_with_pydantic_model(
        provider="openai",
        model_schema=model_schema,
        model_instance=model_instance,
        prompt_messages=prompt_messages,
        output_model=ExampleOutput,
    )

    assert isinstance(result, ExampleOutput)
    assert result.name == "test"


def test_structured_output_with_pydantic_model_validation_error():
    model_schema = get_model_entity("openai", "gpt-4o", support_structure_output=True)
    model_instance = get_model_instance()
    model_instance.invoke_llm.return_value = LLMResult(
        model="gpt-4o",
        message=AssistantPromptMessage(content='{"name": 123}'),
        usage=create_mock_usage(prompt_tokens=8, completion_tokens=4),
    )

    with pytest.raises(OutputParserError):
        invoke_llm_with_pydantic_model(
            provider="openai",
            model_schema=model_schema,
            model_instance=model_instance,
            prompt_messages=[UserPromptMessage(content="test")],
            output_model=ExampleOutput
        )


class TestFillDefaultsFromSchema:
    """Test cases for fill_defaults_from_schema function"""

    def test_simple_required_fields(self):
        """Test filling simple required fields"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "age": {"type": "integer"},
                "email": {"type": "string"},
            },
            "required": ["name", "age"],
        }
        output: dict[str, Any] = {"name": "Alice"}

        result = fill_defaults_from_schema(output, schema)

        assert result == {"name": "Alice", "age": 0}
        # email is not required, so it should not be added
        assert "email" not in result

    def test_non_required_fields_not_filled(self):
        """Test that non-required fields are not filled"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "required_field": {"type": "string"},
                "optional_field": {"type": "string"},
            },
            "required": ["required_field"],
        }
        output: dict[str, Any] = {}

        result = fill_defaults_from_schema(output, schema)

        assert result == {"required_field": ""}
        assert "optional_field" not in result

    def test_nested_object_required_fields(self):
        """Test filling nested object required fields"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "email": {"type": "string"},
                        "address": {
                            "type": "object",
                            "properties": {
                                "city": {"type": "string"},
                                "street": {"type": "string"},
                                "zipcode": {"type": "string"},
                            },
                            "required": ["city", "street"],
                        },
                    },
                    "required": ["name", "email", "address"],
                },
            },
            "required": ["user"],
        }
        output: dict[str, Any] = {
            "user": {
                "name": "Alice",
                "address": {
                    "city": "Beijing",
                },
            }
        }

        result = fill_defaults_from_schema(output, schema)

        assert result == {
            "user": {
                "name": "Alice",
                "email": "",  # filled because required
                "address": {
                    "city": "Beijing",
                    "street": "",  # filled because required
                    # zipcode not filled because not required
                },
            }
        }

    def test_missing_nested_object_created(self):
        """Test that missing required nested objects are created"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "metadata": {
                    "type": "object",
                    "properties": {
                        "created_at": {"type": "string"},
                        "updated_at": {"type": "string"},
                    },
                    "required": ["created_at"],
                },
            },
            "required": ["metadata"],
        }
        output: dict[str, Any] = {}

        result = fill_defaults_from_schema(output, schema)

        assert result == {
            "metadata": {
                "created_at": "",
            }
        }

    def test_all_types_default_values(self):
        """Test default values for all types"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "str_field": {"type": "string"},
                "int_field": {"type": "integer"},
                "num_field": {"type": "number"},
                "bool_field": {"type": "boolean"},
                "arr_field": {"type": "array"},
                "obj_field": {"type": "object"},
            },
            "required": ["str_field", "int_field", "num_field", "bool_field", "arr_field", "obj_field"],
        }
        output: dict[str, Any] = {}

        result = fill_defaults_from_schema(output, schema)

        assert result == {
            "str_field": "",
            "int_field": 0,
            "num_field": 0,
            "bool_field": False,
            "arr_field": [],
            "obj_field": {},
        }

    def test_existing_values_preserved(self):
        """Test that existing values are not overwritten"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "count": {"type": "integer"},
            },
            "required": ["name", "count"],
        }
        output: dict[str, Any] = {"name": "Bob", "count": 42}

        result = fill_defaults_from_schema(output, schema)

        assert result == {"name": "Bob", "count": 42}

    def test_complex_nested_structure(self):
        """Test complex nested structure with multiple levels"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "email": {"type": "string"},
                        "age": {"type": "integer"},
                        "address": {
                            "type": "object",
                            "properties": {
                                "city": {"type": "string"},
                                "street": {"type": "string"},
                                "zipcode": {"type": "string"},
                            },
                            "required": ["city", "street"],
                        },
                    },
                    "required": ["name", "email", "address"],
                },
                "tags": {"type": "array"},
                "orders": {"type": "array"},
                "metadata": {
                    "type": "object",
                    "properties": {
                        "created_at": {"type": "string"},
                        "updated_at": {"type": "string"},
                    },
                    "required": ["created_at"],
                },
                "is_active": {"type": "boolean"},
                "notes": {"type": "string"},
            },
            "required": ["user", "tags", "metadata", "is_active"],
        }
        output: dict[str, Any] = {
            "user": {
                "name": "Alice",
                "age": 25,
                "address": {
                    "city": "Beijing",
                },
            },
            "orders": [{"id": 1}],
            "metadata": {
                "updated_at": "2024-01-01",
            },
        }

        result = fill_defaults_from_schema(output, schema)

        expected = {
            "user": {
                "name": "Alice",
                "email": "",  # required, filled
                "age": 25,  # not required but exists
                "address": {
                    "city": "Beijing",
                    "street": "",  # required, filled
                    # zipcode not required
                },
            },
            "tags": [],  # required, filled
            "orders": [{"id": 1}],  # not required but exists
            "metadata": {
                "created_at": "",  # required, filled
                "updated_at": "2024-01-01",  # exists
            },
            "is_active": False,  # required, filled
            # notes not required
        }
        assert result == expected

    def test_empty_schema(self):
        """Test with empty schema"""
        schema: dict[str, Any] = {}
        output: dict[str, Any] = {"any": "value"}

        result = fill_defaults_from_schema(output, schema)

        assert result == {"any": "value"}

    def test_schema_without_required(self):
        """Test schema without required field"""
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "optional1": {"type": "string"},
                "optional2": {"type": "integer"},
            },
        }
        output: dict[str, Any] = {}

        result = fill_defaults_from_schema(output, schema)

        # No required fields, so nothing should be added
        assert result == {}
