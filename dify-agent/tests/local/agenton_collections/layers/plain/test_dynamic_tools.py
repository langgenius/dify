import asyncio

import pytest
from pydantic_ai import Tool

from agenton_collections.layers.plain import DynamicToolsLayer, ObjectLayer, with_object


class Profile:
    """Profile object used by object-bound tool tests."""

    name: str

    def __init__(self, name: str) -> None:
        self.name = name


class OtherProfile:
    """Different runtime object used to trigger object mismatch checks."""


@with_object(Profile)
def greet(profile: Profile, topic: str) -> str:
    return f"{profile.name}: {topic}"


def test_with_object_rejects_tool_without_object_parameter() -> None:
    def tool() -> str:
        return "unused"

    with pytest.raises(ValueError, match="must accept the object dependency"):
        with_object(Profile)(tool)  # pyright: ignore[reportArgumentType]


def test_with_object_rejects_first_parameter_annotation_mismatch() -> None:
    def tool(profile: OtherProfile) -> str:
        return repr(profile)

    with pytest.raises(TypeError, match="first parameter should accept 'Profile'"):
        with_object(Profile)(tool)  # pyright: ignore[reportArgumentType]


def test_dynamic_tools_layer_rejects_mismatched_runtime_object_value() -> None:
    layer = DynamicToolsLayer[Profile](tool_entries=(greet,))
    layer.bind_deps({"object_layer": ObjectLayer[OtherProfile](OtherProfile())})

    with pytest.raises(TypeError, match="expected object dependency of type 'Profile'"):
        layer.tools


def public_greet(topic: str) -> str:
    return f"Ada: {topic}"


def test_dynamic_tools_layer_binds_object_as_pydantic_ai_equivalent_tool() -> None:
    layer = DynamicToolsLayer[Profile](tool_entries=(greet,))
    layer.bind_deps({"object_layer": ObjectLayer[Profile](Profile("Ada"))})

    expected_tool = Tool(public_greet, name="greet")
    dynamic_tool = Tool(layer.tools[0], name="greet")
    dynamic_result = asyncio.run(
        dynamic_tool.function_schema.call(
            {"topic": "layer composition"},
            None,  # pyright: ignore[reportArgumentType]
        )
    )
    expected_result = asyncio.run(
        expected_tool.function_schema.call(
            {"topic": "layer composition"},
            None,  # pyright: ignore[reportArgumentType]
        )
    )

    assert dynamic_tool.tool_def == expected_tool.tool_def
    assert dynamic_result == expected_result
