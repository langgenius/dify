"""Demonstrate mid-run human steering delivered in FIFO order with a scripted model.

Run the local example from `dify-agent/` (no API keys or services required):
    uv run python examples/dify_agent/dify_agent_examples/run_async_agent_loop.py

This example is meant to be run from a source checkout because
`dify_agent_examples` is not part of the published package.
"""

from __future__ import annotations

import asyncio

from pydantic_ai import Agent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

_STEER = "Switch to plan B."
_FOLLOW_UP = "Keep the summary short."


async def main() -> None:
    model_busy = asyncio.Event()
    release_model = asyncio.Event()
    requests = 0

    async def scripted_model(messages: list[ModelMessage], _info: AgentInfo) -> ModelResponse:
        nonlocal requests
        requests += 1
        parts = [part for message in messages if isinstance(message, ModelRequest) for part in message.parts]
        inputs = [part.content for part in parts if isinstance(part, UserPromptPart)]
        if requests == 1:
            # Hold the model response so two steering inputs can be enqueued
            # while the turn is still in flight.
            model_busy.set()
            await release_model.wait()
            return ModelResponse(parts=[TextPart("Initial answer.")])
        assert requests == 2
        assert inputs.count(_STEER) == inputs.count(_FOLLOW_UP) == 1
        assert inputs.index(_STEER) < inputs.index(_FOLLOW_UP)
        print("Model 2: both steering inputs delivered once, in order.")
        return ModelResponse(parts=[TextPart("Following updated instructions.")])

    agent = Agent(FunctionModel(scripted_model))
    async with asyncio.timeout(10), asyncio.TaskGroup() as tasks:

        async def produce_inputs() -> None:
            await model_busy.wait()
            _ = run.enqueue(_STEER)
            _ = run.enqueue(_FOLLOW_UP)
            release_model.set()

        async with agent.iter("Summarize the results.") as run:
            tasks.create_task(produce_inputs())
            async for _node in run:
                pass
            assert run.result is not None and requests == 2
            print(f"Final: {run.result.output}")


if __name__ == "__main__":
    asyncio.run(main())
