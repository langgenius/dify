"""Unit coverage for CodeNode output transformation and limits."""

import pytest

from configs import dify_config
from graphon.nodes.code.code_node import CodeNode
from graphon.nodes.code.entities import CodeNodeData
from graphon.nodes.code.limits import CodeNodeLimits


def _node() -> CodeNode:
    node = CodeNode.__new__(CodeNode)
    node._limits = CodeNodeLimits(
        max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
        max_number=dify_config.CODE_MAX_NUMBER,
        min_number=dify_config.CODE_MIN_NUMBER,
        max_precision=dify_config.CODE_MAX_PRECISION,
        max_depth=dify_config.CODE_MAX_DEPTH,
        max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
        max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
        max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
    )
    return node


def _outputs() -> dict[str, CodeNodeData.Output]:
    return {
        "string_validator": CodeNodeData.Output(type="string"),
        "number_validator": CodeNodeData.Output(type="number"),
        "number_array_validator": CodeNodeData.Output(type="array[number]"),
        "string_array_validator": CodeNodeData.Output(type="array[string]"),
        "object_validator": CodeNodeData.Output(
            type="object",
            children={
                "result": CodeNodeData.Output(type="number"),
                "depth": CodeNodeData.Output(
                    type="object",
                    children={
                        "depth": CodeNodeData.Output(
                            type="object",
                            children={"depth": CodeNodeData.Output(type="number")},
                        )
                    },
                ),
            },
        ),
    }


def test_transform_result_validates_nested_values_and_limits() -> None:
    node = _node()
    outputs = _outputs()
    valid = {
        "number_validator": 1,
        "string_validator": "1",
        "number_array_validator": [1, 2, 3, 3.333],
        "string_array_validator": ["1", "2", "3"],
        "object_validator": {"result": 1, "depth": {"depth": {"depth": 1}}},
    }
    node._transform_result(valid, outputs)

    wrong_types = {
        "number_validator": "1",
        "string_validator": 1,
        "number_array_validator": ["1"],
        "string_array_validator": [1],
        "object_validator": {"result": "1", "depth": {"depth": {"depth": "1"}}},
    }
    with pytest.raises(ValueError):
        node._transform_result(wrong_types, outputs)

    overlong = valid | {"string_validator": "1" * (dify_config.CODE_MAX_STRING_LENGTH + 1)}
    with pytest.raises(ValueError):
        node._transform_result(overlong, outputs)

    oversized_array = valid | {"number_array_validator": [1, 2, 3, 3.333] * 2000}
    with pytest.raises(ValueError):
        node._transform_result(oversized_array, outputs)


def test_transform_result_validates_object_arrays() -> None:
    node = _node()
    outputs = {"object_list": CodeNodeData.Output(type="array[object]")}
    node._transform_result({"object_list": [{"result": 1}, {"result": [1, 2, 3]}]}, outputs)

    with pytest.raises(ValueError):
        node._transform_result({"object_list": [{"result": 1}, 1]}, outputs)
