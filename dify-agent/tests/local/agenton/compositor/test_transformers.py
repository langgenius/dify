from collections import OrderedDict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from inspect import Parameter, signature

from typing_extensions import override

from agenton.compositor import Compositor, CompositorTransformerKwargs
from agenton.layers import NoLayerDeps, PlainLayer, PlainPromptType, PlainToolType

type ToolCallable = Callable[..., object]
type WrappedPrompt = tuple[str, str]


@dataclass(slots=True)
class PromptAndToolLayer(PlainLayer[NoLayerDeps]):
    prefix: list[str]
    suffix: list[str]
    tool_entries: list[ToolCallable]

    @property
    @override
    def prefix_prompts(self) -> list[str]:
        return self.prefix

    @property
    @override
    def suffix_prompts(self) -> list[str]:
        return self.suffix

    @property
    @override
    def tools(self) -> list[ToolCallable]:
        return self.tool_entries


def base_tool() -> str:
    return "base"


def wrapped_tool() -> str:
    return "wrapped"


def wrap_prompts(prompts: Sequence[PlainPromptType]) -> list[WrappedPrompt]:
    return [("wrapped", prompt.value) for prompt in prompts]


def describe_tools(tools: Sequence[PlainToolType]) -> list[str]:
    return [tool.value.__name__ for tool in tools]


def test_compositor_transformer_kwargs_keys_match_constructor_parameters() -> None:
    transformer_kwargs = set(CompositorTransformerKwargs.__required_keys__)
    parameters = signature(Compositor).parameters

    assert CompositorTransformerKwargs.__optional_keys__ == frozenset()
    assert transformer_kwargs == {
        name for name in parameters if name.endswith("_transformer")
    }
    assert all(parameters[name].kind is Parameter.KEYWORD_ONLY for name in transformer_kwargs)


def test_compositor_transformer_kwargs_keys_match_from_config_parameters() -> None:
    transformer_kwargs = set(CompositorTransformerKwargs.__required_keys__)
    parameters = signature(Compositor.from_config).parameters

    assert transformer_kwargs == {
        name for name in parameters if name.endswith("_transformer")
    }
    assert all(parameters[name].kind is Parameter.KEYWORD_ONLY for name in transformer_kwargs)


def test_compositor_transforms_prompts_to_another_type_after_layer_ordering() -> None:
    compositor: Compositor[WrappedPrompt, PlainToolType, PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict(
            [
                (
                    "first",
                    PromptAndToolLayer(
                        prefix=["first-prefix"],
                        suffix=["first-suffix"],
                        tool_entries=[],
                    ),
                ),
                (
                    "second",
                    PromptAndToolLayer(
                        prefix=["second-prefix"],
                        suffix=["second-suffix"],
                        tool_entries=[],
                    ),
                ),
            ]
        ),
        prompt_transformer=wrap_prompts,
    )

    assert compositor.prompts == [
        ("wrapped", "first-prefix"),
        ("wrapped", "second-prefix"),
        ("wrapped", "second-suffix"),
        ("wrapped", "first-suffix"),
    ]


def test_compositor_transforms_tools_to_another_type_after_layer_aggregation() -> None:
    compositor: Compositor[PlainPromptType, str, PlainPromptType, PlainToolType] = Compositor(
        layers=OrderedDict(
            [
                (
                    "tools",
                    PromptAndToolLayer(prefix=[], suffix=[], tool_entries=[base_tool, wrapped_tool]),
                )
            ]
        ),
        tool_transformer=describe_tools,
    )

    assert compositor.tools == ["base_tool", "wrapped_tool"]
