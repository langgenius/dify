"""Serializable prompt module; instruction ordering is deliberately unspecified."""

from pydantic import BaseModel, ConfigDict

from dify_agent.layers.prompt.configs import Config
from pydantic_ai import RunContext
from pydantic_ai.messages import UserContent
from pydantic_ai.toolsets import FunctionToolset

from dify_agent.runtime.context import Deps


class State(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Toolset(FunctionToolset[Deps]):
    def __init__(self, name: str):
        self.name = name
        super().__init__(id=name, instructions=self._render_instructions)

    def _render_instructions(self, ctx: RunContext[Deps]) -> str:
        config = Config.model_validate(ctx.deps.layers[self.name]["config"])
        return "\n\n".join([*_fragments(config.prefix), *_fragments(config.suffix)])

    def build_user_content(self, deps: Deps) -> list[UserContent]:
        return list(_fragments(Config.model_validate(deps.layers[self.name]["config"]).user))


def _fragments(value: list[str] | str) -> list[str]:
    return [value] if isinstance(value, str) else value
