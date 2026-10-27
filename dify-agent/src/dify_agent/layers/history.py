"""Conversation persistence in JSON state; run instructions remain transient."""

from collections.abc import Sequence
from dataclasses import replace

from pydantic import BaseModel, ConfigDict, Field
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponse

from dify_agent.runtime.context import Deps


class Config(BaseModel):
    model_config = ConfigDict(extra="forbid")


class State(BaseModel):
    messages: list[ModelMessage] = Field(default_factory=list)
    model_config = ConfigDict(extra="forbid")


class Capability(AbstractCapability[Deps]):
    def __init__(self, name: str):
        self.id = name
        self.name = name

    def load_messages(self, deps: Deps) -> list[ModelMessage]:
        return State.model_validate(deps.layers[self.name]["state"]).messages

    def save_messages(self, deps: Deps, messages: Sequence[ModelMessage], *, interrupted: bool = False) -> None:
        """Save captured history, closing unexecuted trailing calls on interruption.

        Pydantic AI closes unmatched tool calls on the next user turn when a response
        is marked interrupted, rather than complete.
        """
        persistent = [replace(m, instructions=None) if isinstance(m, ModelRequest) else m for m in messages]
        if interrupted and persistent:
            last = persistent[-1]
            if isinstance(last, ModelResponse) and last.state == "complete" and last.tool_calls:
                persistent[-1] = replace(last, state="interrupted")
        deps.layers[self.name]["state"] = State(messages=persistent).model_dump(mode="json")
