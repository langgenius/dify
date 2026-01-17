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


def test_parse_structured_output_invalid_raises():
    content = "not valid json at all"
    with pytest.raises(ValueError) as exc_info:
        parse_structured_output(content)
    assert "Failed to parse" in str(exc_info.value)


def test_strategy_detect_tool_use_support():
    # Mock a model that supports tool use
    mock_model = MagicMock()
    mock_model.model_type_instance.model_properties.return_value = {"tool_call": True}

    strategy = StructuredOutputStrategy(mock_model)
    # Should attempt tool_use first for supported models
    assert strategy.preferred_method == OutputMethod.TOOL_USE
