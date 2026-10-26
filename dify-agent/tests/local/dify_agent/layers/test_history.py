"""Regression coverage for history persistence across pydantic-ai-slim 2.53.

Interruption during tool execution appends a trailing ``ModelRequest`` marked
interrupted, but cancellation before tool processing begins ends the history on
a complete ``ModelResponse`` with unmatched tool calls. ``save_messages`` marks
that response interrupted so the next fresh prompt can resume instead of
hitting ``UserError`` for unprocessed tool calls.
"""

import asyncio

import httpx
import pytest
from pydantic_ai import Agent, capture_run_messages
from pydantic_ai.exceptions import UserError
from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from pydantic_ai.tools import Tool

from dify_agent.layers import history
from dify_agent.runtime.context import Deps, Services


def _deps(client: httpx.AsyncClient) -> Deps:
    return Deps(
        layers={"history": {"config": {}, "state": {}}},
        services=Services(client, client),
        run_id="run-1",
    )


def _saved_messages(deps: Deps) -> list:
    return history.Capability("history").load_messages(deps)


@pytest.mark.anyio
async def test_cancellation_before_tool_processing_requires_manual_interrupted_marker() -> None:
    """Cancellation ahead of the tool stream leaves a dangling tool-call
    response that only the manual interrupted marker makes resumable."""
    tool_calls = 0

    def my_tool() -> str:
        nonlocal tool_calls
        tool_calls += 1
        return "tool-output"

    handler_calls = 0

    async def handler(ctx, stream):
        nonlocal handler_calls
        handler_calls += 1
        if handler_calls == 1:
            async for _ in stream:
                pass
            return
        raise asyncio.CancelledError()

    model = FunctionModel(
        function=lambda messages, info: ModelResponse(parts=[TextPart("resumed-answer")]),
        stream_function=lambda messages, info: _stream_first(),
    )

    async def _stream_first():
        yield {0: DeltaToolCall(name="my_tool", json_args="{}", tool_call_id="call-1")}

    agent = Agent(model, tools=[Tool(my_tool)], output_type=str)

    async with httpx.AsyncClient(trust_env=False) as client:
        with capture_run_messages() as messages:
            with pytest.raises(asyncio.CancelledError):
                await agent.run("run the tool", event_stream_handler=handler)

        assert tool_calls == 0
        assert isinstance(messages[-1], ModelResponse)
        assert messages[-1].state == "complete"
        assert any(isinstance(part, ToolCallPart) for part in messages[-1].parts)
        assert not any(getattr(m, "state", None) == "interrupted" for m in messages)

        # Untreated history cannot take a fresh prompt: native UserError.
        with pytest.raises(UserError, match="unprocessed tool calls"):
            await agent.run("continue please", message_history=messages)

        # The manual interrupted marker makes the same history resumable.
        cap = history.Capability("history")
        deps = Deps(
            layers={"history": {"config": {}, "state": {}}},
            services=Services(client, client),
            run_id="run-1",
        )
        cap.save_messages(deps, messages, interrupted=True)
        resumed_history = cap.load_messages(deps)
        assert isinstance(resumed_history[-1], ModelResponse)
        assert resumed_history[-1].state == "interrupted"

        tool_calls = 0
        result = await agent.run("continue please", message_history=resumed_history)
        assert result.output == "resumed-answer"
        assert tool_calls == 0


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("tail", "interrupted", "expected_state"),
    [
        (
            ModelRequest(
                parts=[ToolReturnPart(tool_name="t", tool_call_id="c1", content="partial")],
                state="interrupted",
                instructions="transient-instructions",
            ),
            True,
            "interrupted",
        ),
        (
            ModelResponse(parts=[ToolCallPart(tool_name="t", args="{}", tool_call_id="c2")]),
            False,
            "complete",
        ),
        (
            ModelResponse(parts=[TextPart("final answer")]),
            True,
            "complete",
        ),
    ],
    ids=[
        "native-interrupted-request-preserved",
        "interrupted-false-keeps-complete",
        "text-only-tail-not-rewritten",
    ],
)
async def test_save_messages_tail_state(tail, interrupted, expected_state) -> None:
    original_tail_state = tail.state
    async with httpx.AsyncClient(trust_env=False) as client:
        deps = _deps(client)
        history.Capability("history").save_messages(
            deps,
            [ModelRequest(parts=[UserPromptPart("hi")], instructions="transient"), tail],
            interrupted=interrupted,
        )
        saved = _saved_messages(deps)

    assert saved[-1].state == expected_state
    assert all(m.instructions is None for m in saved if isinstance(m, ModelRequest))
    assert tail.state == original_tail_state
