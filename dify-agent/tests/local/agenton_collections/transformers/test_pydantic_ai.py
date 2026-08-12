from collections.abc import Callable
from typing import cast

from pydantic_ai import Tool

from agenton.layers.types import (
    PlainPromptType,
    PlainToolType,
    PlainUserPromptType,
    PydanticAIPromptType,
    PydanticAIToolType,
    PydanticAIUserPromptType,
)
from agenton_collections.transformers.pydantic_ai import PYDANTIC_AI_TRANSFORMERS


def plain_tool(name: str) -> str:
    return f"hello {name}"


def dynamic_prompt() -> str:
    return "dynamic prompt"


def test_pydantic_ai_transformers_wrap_tagged_plain_prompts() -> None:
    prompts = [PlainPromptType("plain prompt")]

    result = PYDANTIC_AI_TRANSFORMERS["prompt_transformer"](prompts)

    assert len(result) == 1
    prompt_func = cast(Callable[[], str], result[0])
    assert prompt_func() == "plain prompt"


def test_pydantic_ai_transformers_preserve_tagged_existing_prompt_functions() -> None:
    result = PYDANTIC_AI_TRANSFORMERS["prompt_transformer"]([PydanticAIPromptType(dynamic_prompt)])

    assert result == [dynamic_prompt]


def test_pydantic_ai_transformers_accept_mixed_tagged_prompt_types() -> None:
    result = PYDANTIC_AI_TRANSFORMERS["prompt_transformer"](
        [PlainPromptType("plain prompt"), PydanticAIPromptType(dynamic_prompt)]
    )

    plain_prompt = cast(Callable[[], str], result[0])
    assert plain_prompt() == "plain prompt"
    assert result[1] is dynamic_prompt


def test_pydantic_ai_transformers_accept_tagged_user_prompt_types() -> None:
    result = PYDANTIC_AI_TRANSFORMERS["user_prompt_transformer"](
        [PlainUserPromptType("plain user"), PydanticAIUserPromptType("pydantic user")]
    )

    assert result == ["plain user", "pydantic user"]


def test_pydantic_ai_transformers_wrap_tagged_plain_tools() -> None:
    result = PYDANTIC_AI_TRANSFORMERS["tool_transformer"]([PlainToolType(plain_tool)])

    assert len(result) == 1
    tool = result[0]
    assert isinstance(tool, Tool)
    assert tool.function is plain_tool


def test_pydantic_ai_transformers_preserve_tagged_existing_tools() -> None:
    pydantic_ai_tool = Tool(plain_tool)

    result = PYDANTIC_AI_TRANSFORMERS["tool_transformer"]([PydanticAIToolType(pydantic_ai_tool)])

    assert result == [pydantic_ai_tool]


def test_pydantic_ai_transformers_accept_tagged_tool_types() -> None:
    pydantic_ai_tool = Tool(plain_tool)

    result = PYDANTIC_AI_TRANSFORMERS["tool_transformer"](
        [PlainToolType(plain_tool), PydanticAIToolType(pydantic_ai_tool)]
    )

    assert isinstance(result[0], Tool)
    assert result[0].function is plain_tool
    assert result[1] is pydantic_ai_tool
