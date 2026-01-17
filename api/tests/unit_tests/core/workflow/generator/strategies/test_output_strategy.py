from unittest.mock import MagicMock

import pytest

from core.workflow.generator.strategies.output_strategy import (
    OutputMethod,
    StructuredOutputStrategy,
    parse_structured_output,
)


def test_output_method_enum():
    assert OutputMethod.TOOL_USE.value == "tool_use"
    assert OutputMethod.JSON_MODE.value == "json_mode"
    assert OutputMethod.RAW_WITH_VALIDATION.value == "raw_with_validation"


def test_parse_structured_output_valid_json():
    content = '{"nodes": [], "edges": []}'
    result = parse_structured_output(content)
    assert result["nodes"] == []
    assert result["edges"] == []


def test_parse_structured_output_with_markdown():
    content = """```json
{"nodes": [{"id": "start"}], "edges": []}
```"""
    result = parse_structured_output(content)
    assert result["nodes"] == [{"id": "start"}]


def test_parse_structured_output_with_nested_code_blocks():
    """Test that nested ``` in JSON strings (e.g., prompt templates) are handled correctly."""
    # This simulates LLM generating a prompt template with code blocks inside
    content = '''```json
{
  "nodes": [
    {
      "id": "llm_1",
      "type": "llm",
      "config": {
        "prompt_template": [
          {
            "role": "user",
            "text": "Review this code:\\n```python\\nprint('hello')\\n```\\nProvide feedback."
          }
        ]
      }
    }
  ],
  "edges": []
}
```'''
    result = parse_structured_output(content)
    assert result["nodes"][0]["id"] == "llm_1"
    # Verify the nested code block is preserved in the prompt template
    prompt_text = result["nodes"][0]["config"]["prompt_template"][0]["text"]
    assert "```python" in prompt_text


def test_parse_structured_output_invalid_raises():
    content = "not valid json at all"
    with pytest.raises(ValueError) as exc_info:
        parse_structured_output(content)
    assert "Failed to parse" in str(exc_info.value)


def test_parse_structured_output_truncated_json_reports_position():
    """Test that truncated JSON reports the error position for debugging."""
    # Simulate truncated JSON (missing closing brackets)
    content = '{"nodes": [{"id": "start", "type": "start"'
    with pytest.raises(ValueError) as exc_info:
        parse_structured_output(content)
    error_msg = str(exc_info.value)
    # Should include position info from JSONDecodeError
    assert "JSONDecodeError" in error_msg
    assert "pos" in error_msg
    # Should include content length for truncation detection
    assert "Content length:" in error_msg


def test_strategy_detect_tool_use_support():
    # Mock a model that supports tool use
    mock_model = MagicMock()
    mock_model.model_type_instance.model_properties.return_value = {"tool_call": True}

    strategy = StructuredOutputStrategy(mock_model)
    # Should attempt tool_use first for supported models
    assert strategy.preferred_method == OutputMethod.TOOL_USE
