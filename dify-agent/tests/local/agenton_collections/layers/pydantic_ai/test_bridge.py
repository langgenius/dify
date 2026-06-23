from collections.abc import Callable
from dataclasses import dataclass
from typing import cast

from pydantic_ai import RunContext, Tool

from agenton_collections.layers.pydantic_ai import PydanticAIBridgeLayer


@dataclass(frozen=True, slots=True)
class Profile:
    name: str


def profile_prompt(ctx: RunContext[Profile]) -> str:
    return f"Profile: {ctx.deps.name}"


def existing_tool(ctx: RunContext[Profile]) -> str:
    return ctx.deps.name


def raw_tool(ctx: RunContext[Profile], topic: str) -> str:
    return f"{ctx.deps.name}: {topic}"


def test_pydantic_ai_bridge_layer_accepts_mixed_string_and_function_prompts() -> None:
    layer = PydanticAIBridgeLayer[Profile](
        prefix=("plain prefix", profile_prompt),
        user=("first user", "second user"),
        suffix="plain suffix",
    )

    prefix_prompts = layer.prefix_prompts
    user_prompts = layer.user_prompts
    suffix_prompts = layer.suffix_prompts

    plain_prefix = cast(Callable[[], str], prefix_prompts[0])
    plain_suffix = cast(Callable[[], str], suffix_prompts[0])
    assert plain_prefix() == "plain prefix"
    assert prefix_prompts[1] is profile_prompt
    assert user_prompts == ["first user", "second user"]
    assert plain_suffix() == "plain suffix"


def test_pydantic_ai_bridge_layer_accepts_mixed_tool_and_tool_function_entries() -> None:
    pydantic_ai_tool = Tool(existing_tool)
    layer = PydanticAIBridgeLayer[Profile](
        tool_entries=(pydantic_ai_tool, raw_tool),
    )

    tools = layer.tools

    assert tools[0] is pydantic_ai_tool
    assert isinstance(tools[1], Tool)
    assert tools[1].function is raw_tool
