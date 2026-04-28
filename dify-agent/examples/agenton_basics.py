"""Run with: uv run --project dify-agent python examples/agenton_basics.py."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from inspect import signature

from typing_extensions import override

from agenton.compositor import Compositor, CompositorLayerConfig
from agenton.layers import LayerControl, LayerDeps, NoLayerDeps, PlainLayer
from agenton_collections.plain import DynamicToolsLayer, ObjectLayer, ToolsLayer, with_object


@dataclass(frozen=True, slots=True)
class AgentProfile:
    name: str
    audience: str
    tone: str


class ProfilePromptDeps(LayerDeps):
    profile: ObjectLayer[AgentProfile]  # pyright: ignore[reportUninitializedInstanceVariable]


@dataclass(slots=True)
class ProfilePromptLayer(PlainLayer[ProfilePromptDeps]):
    @property
    @override
    def prefix_prompts(self) -> list[str]:
        profile = self.deps.profile.value
        return [
            f"You are {profile.name}, writing for {profile.audience}.",
            f"Keep the tone {profile.tone}.",
        ]


@dataclass(slots=True)
class TraceLayer(PlainLayer[NoLayerDeps]):
    events: list[str] = field(default_factory=list)

    @override
    async def on_context_create(self, control: LayerControl) -> None:
        self.events.append("create")

    @override
    async def on_context_tmp_leave(self, control: LayerControl) -> None:
        self.events.append("tmp_leave")

    @override
    async def on_context_reenter(self, control: LayerControl) -> None:
        self.events.append("reenter")

    @override
    async def on_context_delete(self, control: LayerControl) -> None:
        self.events.append("delete")


def count_words(text: str) -> int:
    return len(text.split())


@with_object(AgentProfile)
def write_tagline(profile: AgentProfile, topic: str) -> str:
    return f"{profile.name}: {topic} for {profile.audience}, in a {profile.tone} voice."


async def main() -> None:
    profile = AgentProfile(
        name="Agenton Assistant",
        audience="engineers composing agent capabilities",
        tone="precise and friendly",
    )
    trace = TraceLayer()

    compositor = Compositor.from_config(
        {
            "layers": [
                {
                    "name": "base_prompt",
                    "layer": {
                        "import_path": "agenton_collections.plain.basic:PromptLayer",
                        "config": {
                            "prefix": "Use config dicts for serializable layers.",
                            "suffix": "Before finalizing, make the result easy to scan.",
                        },
                    },
                },
                {
                    "name": "extra_prompt",
                    "layer": {
                        "import_path": "agenton_collections.plain.basic:PromptLayer",
                        "config": {
                            "prefix": "Use constructed instances for objects, local code, and callables.",
                        },
                    },
                },
                CompositorLayerConfig(
                    name="profile",
                    layer=ObjectLayer[AgentProfile](profile),
                ),
                CompositorLayerConfig(
                    name="profile_prompt",
                    deps={"profile": "profile"},
                    layer=ProfilePromptLayer(),
                ),
                CompositorLayerConfig(
                    name="tools",
                    layer=ToolsLayer(tool_entries=(count_words,)),
                ),
                CompositorLayerConfig(
                    name="dynamic_tools",
                    deps={"object_layer": "profile"},
                    layer=DynamicToolsLayer[AgentProfile](tool_entries=(write_tagline,)),
                ),
                CompositorLayerConfig(name="trace", layer=trace),
            ]
        }
    )

    print("Prompts:")
    for prompt in compositor.prompts:
        print(f"- {prompt}")

    print("\nTools:")
    for tool in compositor.tools:
        print(f"- {tool.__name__}{signature(tool)}")
    print([tool("layer composition") for tool in compositor.tools])

    async with compositor.enter() as lifecycle_control:
        lifecycle_control.tmp_leave = True
    async with compositor.enter(lifecycle_control):
        pass
    print("\nLifecycle:", trace.events)


if __name__ == "__main__":
    asyncio.run(main())
