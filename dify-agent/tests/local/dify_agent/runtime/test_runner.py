import asyncio

import pytest

from agenton.compositor import CompositorConfig, LayerNodeConfig
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.runner import AgentRunRunner, AgentRunValidationError
from dify_agent.server.schemas import AgentProfileConfig, CreateRunRequest


def test_runner_emits_terminal_success_and_snapshot() -> None:
    request = CreateRunRequest(
        compositor=CompositorConfig(
            layers=[
                LayerNodeConfig(
                    name="prompt",
                    type="plain.prompt",
                    config={"prefix": "system", "user": "hello"},
                )
            ]
        ),
        agent_profile=AgentProfileConfig(output_text="done"),
    )
    sink = InMemoryRunEventSink()

    asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-1").run())

    event_types = [event.type for event in sink.events["run-1"]]
    assert event_types[0] == "run_started"
    assert "pydantic_ai_event" in event_types
    assert event_types[-3:] == ["agent_output", "session_snapshot", "run_succeeded"]
    assert sink.statuses["run-1"] == "succeeded"


def test_runner_fails_empty_user_prompts() -> None:
    request = CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config={"prefix": "system"})]
        )
    )
    sink = InMemoryRunEventSink()

    with pytest.raises(AgentRunValidationError):
        asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-2").run())

    assert [event.type for event in sink.events["run-2"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-2"] == "failed"


def test_runner_fails_blank_string_user_prompt_list() -> None:
    request = CreateRunRequest(
        compositor=CompositorConfig(
            layers=[LayerNodeConfig(name="prompt", type="plain.prompt", config={"user": ["", "   "]})]
        )
    )
    sink = InMemoryRunEventSink()

    with pytest.raises(AgentRunValidationError):
        asyncio.run(AgentRunRunner(sink=sink, request=request, run_id="run-3").run())

    assert [event.type for event in sink.events["run-3"]] == ["run_started", "run_failed"]
    assert sink.statuses["run-3"] == "failed"
