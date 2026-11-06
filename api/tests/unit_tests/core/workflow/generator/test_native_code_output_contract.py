"""Generated Code declarations must use native output types, not Python names."""

import pytest
from pydantic import ValidationError

from core.workflow.generator.prompts.builder_prompts import get_node_config_snippet
from core.workflow.generator.prompts.node_builder_prompts import get_node_builder_system_prompt
from core.workflow.generator.prompts.planner_prompts import PLANNER_SYSTEM_PROMPT
from graphon.nodes.code.entities import CodeNodeData


@pytest.mark.parametrize(
    "prompt",
    [PLANNER_SYSTEM_PROMPT, get_node_config_snippet("code"), get_node_builder_system_prompt("code")],
    ids=["planner", "code-config", "code-builder"],
)
def test_batch_code_contract_validates_identity_before_grouping(prompt: str) -> None:
    """Wire identity guidance to each generation entry; generated behavior needs separate acceptance."""
    assert "Validate business identity fields before grouping or hash-based deduplication" in prompt
    assert "preserve each invalid record's original value and input index" in prompt
    assert "do not merge distinct invalid identities into one duplicate/conflict group" in prompt
    assert "continue processing valid records" in prompt
    assert "Preserve approved valid-identity duplicate and conflict semantics" in prompt
    assert "Do not replace unrelated calculations or rewrite the whole Code node" in prompt


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
