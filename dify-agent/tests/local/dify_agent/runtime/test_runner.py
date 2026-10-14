"""Run the real native Agent to verify history, output and cleanup boundaries."""

import asyncio
from dataclasses import replace
from types import SimpleNamespace

import httpx
import pytest
from pydantic_ai import Agent, Tool
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import (
    UserPromptPart,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from pydantic_ai.tools import DeferredToolRequests

from dify_agent.adapters.shell.protocols import ShellCommandResult
from dify_agent.layers import history
from dify_agent.layers.dify_plugin import llm_layer
from dify_agent.protocol.schemas import (
    CreateRunRequest,
    RunComposition,
    RunFailedEvent,
    RunLayerSpec,
    RunSucceededEvent,
    RunFailureType,
)
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.context import Services
from dify_agent.runtime.event_sink import InMemoryRunEventSink
from dify_agent.runtime.runner import AgentRunRunner
from dify_agent.runtime_backend import RuntimeBackendProfile, RuntimeLayout


def request(*extra, snapshot=None, instruction="Current instruction", user="hello"):
    return CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="execution_context",
                    config={
                        "tenant_id": "tenant",
                        "user_id": "user",
                        "user_from": "account",
                        "app_id": "app",
                        "agent_mode": "agent_app",
                        "invoke_from": "web-app",
                    },
                ),
                RunLayerSpec(name="llm", config={"plugin_id": "openai", "model_provider": "openai", "model": "demo"}),
                RunLayerSpec(name="prompt", config={"prefix": instruction, "user": user}),
                RunLayerSpec(name="history"),
                *extra,
            ]
        ),
        session_snapshot=snapshot,
    )


def run_runner(incoming, services, monkeypatch, stream, *, run_id="test", timeout=10):
    model = FunctionModel(stream_function=stream)
    monkeypatch.setattr(llm_layer.Capability, "build_model", lambda self, deps: model)
    sink = InMemoryRunEventSink()
    runner = AgentRunRunner(sink=sink, request=incoming, run_id=run_id, services=services, run_timeout_seconds=timeout)
    return runner, sink


@pytest.mark.anyio
async def test_native_run_restores_conversation_but_uses_current_instructions(monkeypatch):
    seen = []

    async def stream(messages, info):
        seen.append((list(messages), info.instructions))
        yield "reply"

    async with httpx.AsyncClient() as client:
        services = Services(client, client)
        first, first_sink = run_runner(request(), services, monkeypatch, stream, run_id="first")
        await first.run()
        terminal = first_sink.events["first"][-1]
        assert isinstance(terminal, RunSucceededEvent)
        assert terminal.data.output == "reply"
        snapshot = terminal.data.session_snapshot
        state = history.State.model_validate(snapshot.layers["history"])
        assert len(state.messages) == 2
        assert all(m.instructions is None for m in state.messages if isinstance(m, ModelRequest))
        second, sink = run_runner(
            request(snapshot=snapshot, instruction="Revised instruction", user="next"),
            services,
            monkeypatch,
            stream,
            run_id="second",
        )
        await second.run()
        assert len(seen[1][0]) == 3
        assert seen[1][1] == "Revised instruction"
        assert "Current instruction" not in snapshot.model_dump_json()
        assert isinstance(sink.events["second"][-1], RunSucceededEvent)
        assert not client.is_closed


@pytest.mark.anyio
@pytest.mark.parametrize("with_regular_tool", [False, True])
async def test_legacy_ask_human_pause_accepts_first_new_user_turn(monkeypatch, with_regular_tool):
    """Produce real deferred history, migrate only data, then use the new runner."""

    async def ask_human(question: str) -> str:
        pytest.fail("the legacy external tool must never execute")

    async def regular() -> str:
        return "completed regular tool"

    def legacy_model(messages, info):
        calls = [ToolCallPart(tool_name="ask_human", args={"question": "Choose an action"}, tool_call_id="human-1")]
        if with_regular_tool:
            calls.append(ToolCallPart(tool_name="regular", args={}, tool_call_id="regular-1"))
        return ModelResponse(parts=calls)

    legacy_agent = Agent(
        FunctionModel(legacy_model),
        tools=[Tool(ask_human, prepare=lambda ctx, definition: replace(definition, kind="external")), regular],
        output_type=[str, DeferredToolRequests],
    )
    paused = await legacy_agent.run("Original request")
    assert isinstance(paused.output, DeferredToolRequests)
    legacy_state = history.State(messages=paused.all_messages()).model_dump(mode="json")
    assert legacy_state["messages"][-1]["state"] == "complete"
    snapshot = SessionSnapshot.model_validate(
        {
            "schema_version": 1,
            "layers": [
                {"name": "history", "lifecycle_state": "suspended", "runtime_state": legacy_state},
                {"name": "ask_human", "lifecycle_state": "suspended", "runtime_state": {}},
            ],
        }
    )
    assert "ask_human" not in snapshot.layers
    assert snapshot.layers["history"]["messages"][:-1] == legacy_state["messages"][:-1]
    assert snapshot.layers["history"]["messages"][-1] == {
        **legacy_state["messages"][-1],
        "state": "interrupted",
    }
    # Loading a snapshot must not mutate the stored legacy object.
    assert legacy_state["messages"][-1]["state"] == "complete"
    model_calls = []

    async def stream(messages, info):
        model_calls.append(messages)
        assert any(
            isinstance(part, UserPromptPart) and part.content == "Original request"
            for message in messages
            for part in message.parts
        )
        returns = {
            part.tool_call_id: part.content
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if isinstance(part, ToolReturnPart)
        }
        assert "human-1" in returns
        if with_regular_tool:
            assert returns["regular-1"] == "completed regular tool"
        assert messages[-1].parts[-1].content == "Continue without waiting for human input"
        yield "continued"

    async with httpx.AsyncClient() as client:
        runner, sink = run_runner(
            request(snapshot=snapshot, user="Continue without waiting for human input"),
            Services(client, client),
            monkeypatch,
            stream,
        )
        await runner.run()
        assert len(model_calls) == 1
        terminal = sink.events["test"][-1]
        assert isinstance(terminal, RunSucceededEvent)
        assert terminal.data.output == "continued"


@pytest.mark.anyio
async def test_failure_saves_user_history_and_classified_event(monkeypatch):
    async def stream(messages, info):
        raise ModelHTTPError(429, "demo", {"error_type": "InvokeRateLimitError", "message": "quota exceeded"})
        yield "unreachable"

    async with httpx.AsyncClient() as client:
        runner, sink = run_runner(request(), Services(client, client), monkeypatch, stream)
        with pytest.raises(ModelHTTPError):
            await runner.run()
        terminal = sink.events["test"][-1]
        assert isinstance(terminal, RunFailedEvent)
        assert terminal.data.error == "quota exceeded"
        assert terminal.data.reason == "InvokeRateLimitError"
        assert terminal.data.session_snapshot is not None
        saved = history.State.model_validate(terminal.data.session_snapshot.layers["history"])
        assert isinstance(saved.messages[0], ModelRequest)
        assert saved.messages[0].instructions is None
        assert saved.messages[-1].state == "interrupted"


@pytest.mark.anyio
@pytest.mark.parametrize("invalid_first", [False, True])
async def test_native_structured_output_uses_output_module(monkeypatch, invalid_first):
    attempts = []

    async def stream(messages, info):
        assert len(info.output_tools) == 1
        attempts.append(messages)
        if invalid_first and len(attempts) == 1:
            arguments = '{"answer":42}'
        else:
            if invalid_first:
                assert any(isinstance(part, RetryPromptPart) for message in messages for part in message.parts)
            arguments = '{"answer":"done"}'
        yield {0: DeltaToolCall(name=info.output_tools[0].name, json_args=arguments, tool_call_id="out")}

    spec = RunLayerSpec(
        name="output",
        config={
            "json_schema": {
                "type": "object",
                "properties": {"answer": {"type": "string"}},
                "required": ["answer"],
                "additionalProperties": False,
            }
        },
    )
    async with httpx.AsyncClient() as client:
        runner, sink = run_runner(request(spec), Services(client, client), monkeypatch, stream)
        await runner.run()
        terminal = sink.events["test"][-1]
        assert isinstance(terminal, RunSucceededEvent)
        assert terminal.data.output == {"answer": "done"}
        assert len(attempts) == (2 if invalid_first else 1)


class Commands:
    """Remote command protocol double; the Agent and capability scopes stay real."""

    def __init__(self):
        self.deleted = []
        self.scripts = []
        self.tail_started = asyncio.Event()
        self.block_tail = False
        self.bootstrap_failures = 0

    async def run(self, script, *, cwd=None, env=None, timeout=10, mode="pty"):
        self.scripts.append(script)
        if mode == "stdio":
            failed = self.bootstrap_failures > 0
            self.bootstrap_failures = max(0, self.bootstrap_failures - 1)
            return ShellCommandResult("bootstrap", "exited", True, 1 if failed else 0, "", 0, False, "/tmp/output")
        return ShellCommandResult("remote", "running", False, None, "partial", 20, self.block_tail, "/tmp/output")

    async def tail(self, job_id, *, edge_bytes=None):
        self.tail_started.set()
        await asyncio.Event().wait()

    async def delete(self, job_id, *, force=False, grace_seconds=None):
        self.deleted.append(job_id)


class Backend:
    def __init__(self, commands):
        self.commands = commands
        self.active = False
        self.acquired = 0
        self.released = 0
        self.lease = SimpleNamespace(
            handle="binding",
            commands=commands,
            layout=RuntimeLayout(home_dir="/home/agent", workspace_dir="/home/agent/workspace/run"),
        )

    async def acquire(self, binding_ref):
        assert binding_ref == "binding"
        self.active = True
        self.acquired += 1
        return self.lease

    async def release(self, lease):
        assert self.active
        self.active = False
        self.released += 1


def runtime_specs(*, bootstrap=False):
    config = {"cli_tools": [{"name": "test", "install_commands": ["install-test"]}]} if bootstrap else {}
    # Request ordering deliberately differs from resource ownership ordering.
    return [
        RunLayerSpec(name="shell", config=config),
        RunLayerSpec(name="runtime", config={"backend_binding_ref": "binding"}),
    ]


@pytest.mark.anyio
async def test_cancellation_during_remote_observation_deletes_job_and_releases_lease(monkeypatch):
    commands = Commands()
    commands.block_tail = True
    backend = Backend(commands)

    async def stream(messages, info):
        assert backend.active
        assert {t.name for t in info.function_tools} == {"shell_run", "shell_wait", "shell_input", "shell_interrupt"}
        assert all(t.sequential for t in info.function_tools)
        yield {0: DeltaToolCall(name="shell_run", json_args='{"script":"sleep 100"}', tool_call_id="call")}

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        runner, sink = run_runner(request(*runtime_specs()), services, monkeypatch, stream)
        task = asyncio.create_task(runner.run())
        await asyncio.wait_for(commands.tail_started.wait(), timeout=3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert commands.deleted == ["remote"]
        assert backend.released == 1 and not backend.active
        snap = runner.terminal_session_snapshot
        assert snap is not None
        assert snap.layers["shell"] == {"initialized": True, "job_ids": [], "job_offsets": {}}
        saved = history.State.model_validate(snap.layers["history"])
        responses = [m for m in saved.messages if isinstance(m, ModelResponse)]
        assert responses[-1].state == "interrupted"
        assert not client.is_closed


@pytest.mark.anyio
async def test_bootstrap_failure_retries_and_success_is_not_repeated(monkeypatch):
    commands = Commands()
    commands.bootstrap_failures = 1
    backend = Backend(commands)

    async def stream(messages, info):
        assert backend.active
        assert "Workspace" in info.instructions
        yield "done"

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        runner, sink = run_runner(request(*runtime_specs(bootstrap=True)), services, monkeypatch, stream)
        with pytest.raises(RuntimeError, match="bootstrap"):
            await runner.run()
        assert runner.terminal_session_snapshot.layers["shell"]["initialized"] is False
        second, _ = run_runner(
            request(*runtime_specs(bootstrap=True), snapshot=runner.terminal_session_snapshot),
            services,
            monkeypatch,
            stream,
            run_id="second",
        )
        await second.run()
        assert second.terminal_session_snapshot.layers["shell"]["initialized"] is True
        third, _ = run_runner(
            request(*runtime_specs(bootstrap=True), snapshot=second.terminal_session_snapshot),
            services,
            monkeypatch,
            stream,
            run_id="third",
        )
        await third.run()
        assert len(commands.scripts) == 2
        assert backend.acquired == backend.released == 3


@pytest.mark.anyio
async def test_timeout_releases_resource_and_preserves_snapshot(monkeypatch):
    commands = Commands()
    backend = Backend(commands)

    async def stream(messages, info):
        await asyncio.Event().wait()
        yield "unreachable"

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        runner, sink = run_runner(request(*runtime_specs()), services, monkeypatch, stream, timeout=0.05)
        with pytest.raises(UsageLimitExceeded):
            await runner.run()
        assert backend.released == 1
        terminal = sink.events["test"][-1]
        assert isinstance(terminal, RunFailedEvent)
        assert terminal.data.error_type == RunFailureType.AGENT_RUN_LIMIT_EXCEEDED
        assert terminal.data.session_snapshot.layers["shell"]["job_ids"] == []


@pytest.mark.anyio
async def test_bad_configuration_prevents_resource_acquisition(monkeypatch):
    commands = Commands()
    backend = Backend(commands)

    async def stream(messages, info):
        raise AssertionError("Model I/O must not happen")
        yield "unreachable"

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        runner, sink = run_runner(
            request(*runtime_specs(), RunLayerSpec(name="tools", config={"execution_context": "missing"})),
            services,
            monkeypatch,
            stream,
        )
        with pytest.raises(ValueError, match="reference"):
            await runner.run()
        assert backend.acquired == 0
        assert isinstance(sink.events["test"][-1], RunFailedEvent)


@pytest.mark.anyio
async def test_invalid_output_schema_fails_before_resource_and_model_io(monkeypatch):
    backend = Backend(Commands())

    async def stream(messages, info):
        pytest.fail("invalid output schema must not reach the model")
        yield "unreachable"

    async with httpx.AsyncClient() as client:
        services = Services(client, client, runtime_backend_profile=RuntimeBackendProfile(None, backend))
        runner, sink = run_runner(
            request(
                *runtime_specs(),
                RunLayerSpec(name="output", config={"json_schema": {"type": "object", "required": "invalid"}}),
            ),
            services,
            monkeypatch,
            stream,
        )
        with pytest.raises(ValueError, match="required"):
            await runner.run()
        assert backend.acquired == 0
        assert isinstance(sink.events["test"][-1], RunFailedEvent)


@pytest.mark.anyio
@pytest.mark.parametrize("user", ["hello", ""])
async def test_knowledge_user_context_is_captured_in_history_and_restored_cache(monkeypatch, user):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"results": [], "usage": {}})

    async def stream(messages, info):
        user_contents = [
            p.content for m in messages if isinstance(m, ModelRequest) for p in m.parts if isinstance(p, UserPromptPart)
        ]
        assert any("Knowledge retrieval results" in str(content) for content in user_contents)
        yield "done"

    knowledge = RunLayerSpec(
        name="knowledge",
        config={
            "sets": [
                {
                    "id": "support",
                    "name": "Support",
                    "datasets": [{"id": "dataset"}],
                    "query": {"mode": "user_query", "value": "release"},
                    "retrieval": {"mode": "multiple", "top_k": 4},
                }
            ]
        },
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        services = Services(client, client)
        first, _ = run_runner(request(knowledge, user=user), services, monkeypatch, stream)
        await first.run()
        snapshot = first.terminal_session_snapshot
        saved = history.State.model_validate(snapshot.layers["history"])
        assert any(
            "Knowledge retrieval results" in str(p.content)
            for m in saved.messages
            if isinstance(m, ModelRequest)
            for p in m.parts
            if isinstance(p, UserPromptPart)
        )
        second, _ = run_runner(
            request(knowledge, snapshot=snapshot, user=user), services, monkeypatch, stream, run_id="second"
        )
        await second.run()
        assert len(calls) == 1


@pytest.mark.anyio
@pytest.mark.parametrize("user", ["", ["", "   "]])
async def test_empty_current_user_content_fails_before_model_io(monkeypatch, user):
    async def stream(messages, info):
        pytest.fail("blank user input must not reach the model")
        yield "unreachable"

    async with httpx.AsyncClient() as client:
        runner, sink = run_runner(request(user=user), Services(client, client), monkeypatch, stream)
        with pytest.raises(ValueError, match="run.user_prompts must not be empty"):
            await runner.run()
        assert isinstance(sink.events["test"][-1], RunFailedEvent)
