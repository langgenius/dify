"""Generated Code declarations must use native output types, not Python names."""

import pytest
from pydantic import ValidationError

from core.workflow.generator.prompts.builder_prompts import get_node_config_snippet
from core.workflow.generator.prompts.node_builder_prompts import get_node_builder_system_prompt
from graphon.nodes.code.entities import CodeNodeData


def test_generation_prompts_declare_native_numeric_output_types() -> None:
    for prompt in (get_node_config_snippet("code"), get_node_builder_system_prompt("code")):
        assert 'Use "number" for both integer and floating-point outputs' in prompt
        assert 'Use "array[number]" for numeric arrays' in prompt
        assert 'Never use "integer", "int", or "float" as an output type' in prompt
        for output_type in (
            "string",
            "number",
            "boolean",
            "object",
            "array[string]",
            "array[number]",
            "array[boolean]",
            "array[object]",
        ):
            assert f'"{output_type}"' in prompt


@pytest.mark.parametrize("value", [3, 3.5])
def test_native_code_accepts_number_declaration_for_integer_and_float(value: int | float) -> None:
    variables: list[object] = []
    config = {
        "title": "Summarize",
        "code_language": "python3",
        "code": f"def main():\n    return {{'units': {value!r}}}",
        "variables": variables,
        "outputs": {"units": {"type": "number", "children": None}},
    }
    native = CodeNodeData.model_validate(config)
    assert native.outputs["units"].type.value == "number"
    config["outputs"] = {"units": {"type": "integer", "children": None}}
    with pytest.raises(ValidationError, match="invalid type for code output"):
        CodeNodeData.model_validate(config)
