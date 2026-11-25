"""Feed buffered human steering input into a native agent run.

The store owns one bounded per-run inbox for human steering, available only
when the run opted in. This capability drains it at native model boundaries
and seals the inbox when the run would otherwise end, so queued input becomes
real user turns without polling the model.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, override

from pydantic_ai import Agent, RunContext
from pydantic_ai.capabilities import AbstractCapability, AgentNode, CapabilityOrdering, NodeResult
from pydantic_ai.messages import ModelRequest, UserPromptPart

from dify_agent.runtime.context import Deps

STEERING_INPUT_METADATA_KEY = "dify_steering_input_id"
"""ModelRequest metadata key carrying the steering input id for human turns."""


@dataclass(frozen=True, slots=True)
class RunInboxInput:
    """One drained human steering input with its enqueue id."""

    text: str
    input_id: str


def _enqueue_input(ctx: RunContext[Deps], item: RunInboxInput) -> None:
    """Deliver a drained input tagged with its steering id."""
    _ = ctx.enqueue(
        ModelRequest(
            parts=[UserPromptPart(content=item.text)],
            metadata={STEERING_INPUT_METADATA_KEY: item.input_id},
        )
    )


class RunInputStore(Protocol):
    """Minimal inbox surface the capability needs from the run store."""

    async def open_run_inputs(self, run_id: str) -> None: ...

    async def take_run_inputs(self, run_id: str, *, finish: bool = False) -> list[RunInboxInput]: ...


class RunInputCapability(AbstractCapability[Deps]):
    """Drain the run's steering inbox into native enqueued user input."""

    def __init__(self, store: RunInputStore) -> None:
        self._store = store

    @override
    def get_ordering(self) -> CapabilityOrdering:
        return CapabilityOrdering(position="outermost")

    @override
    async def before_node_run(self, ctx: RunContext[Deps], *, node: AgentNode[Deps]) -> AgentNode[Deps]:
        if Agent.is_model_request_node(node):
            for item in await self._store.take_run_inputs(ctx.deps.run_id):
                _enqueue_input(ctx, item)
        return node

    @override
    async def after_node_run(
        self,
        ctx: RunContext[Deps],
        *,
        node: AgentNode[Deps],
        result: NodeResult[Deps],
    ) -> NodeResult[Deps]:
        if Agent.is_end_node(result):
            # The finish drains pending input or seals the inbox atomically, so
            # enqueued input can still redirect a run that would otherwise end.
            for item in await self._store.take_run_inputs(ctx.deps.run_id, finish=True):
                _enqueue_input(ctx, item)
        return result
