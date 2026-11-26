"""Native test runs offer only tools that can pass the native effect fence.

``read_media`` and ``read_config_skill_md`` carry no ``NativeToolBoundary``.
Under ``NativeEffectsCapability`` a call to either would stop the run with
``native_tool_boundary_unavailable``, so native runs do not offer them.
Ordinary runs keep offering both.
"""

import asyncio
import json

import httpx
import pytest
from pydantic_ai import Agent, DeferredToolRequests, RunContext
from pydantic_ai.messages import ModelRequest, ModelResponse, RetryPromptPart, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from dify_agent.adapters.shell.protocols import CompleteShellCommandResult
from dify_agent.agent_stub.protocol import file_reference
from dify_agent.layers.config import layer as config_module
from dify_agent.layers.read_media.layer import Capability as ReadMediaCapability
from dify_agent.layers.shell.layer import DifyShellLayerConfig, ShellSession
from dify_agent.layers.shell.layer import State as ShellState
from dify_agent.runtime.context import Deps, Services
from dify_agent.runtime.native_effects import NativeEffectsCapability
from tests.local.dify_agent.runtime.test_native_effects import waiting_session

FILE = {"transfer_method": "tool_file", "reference": file_reference("tool-file")}


def _layers(*, skills: tuple[str, ...] = ("alpha",)) -> dict:
    return {
        "read_media": {"config": {"shell": None}, "state": {}},
        "llm": {
            "config": {
                "plugin_id": "test",
                "model_provider": "test",
                "model": "model",
                "supported_modalities": ["vision", "document"],
            },
            "state": {},
        },
        "execution_context": {
            "config": {
                "tenant_id": "tenant",
                "user_id": "user",
                "user_from": "account",
                "app_id": "app",
                "agent_mode": "workflow_run",
                "invoke_from": "debugger",
            },
            "state": {},
        },
        "shell": {"config": DifyShellLayerConfig().model_dump(mode="json"), "state": ShellState().model_dump()},
        "config": {"config": {"skills": [{"name": name} for name in skills]}, "state": {}},
    }


async def _run(*, native: bool, tool: str, arguments: dict, monkeypatch) -> tuple[list[set[str]], list, list]:
    """Run one Agent whose model calls ``tool`` once, then answers; return what the model saw."""
    offered: list[set[str]] = []
    retries: list[RetryPromptPart] = []
    transport_calls: list[httpx.Request] = []
    shell_scripts: list[str] = []

    async def pull(session, script, **kwargs):
        shell_scripts.append(script)
        output = json.dumps({"items": [{"name": "alpha", "directory_path": "/skills/alpha", "skill_md": "Alpha"}]})
        return CompleteShellCommandResult("pull", "exited", True, 0, output, True, None, len(output))

    monkeypatch.setattr(ShellSession, "run_remote_script", pull)

    def model(messages, info):
        offered.append({definition.name for definition in info.function_tools})
        retries.extend(
            part
            for message in messages
            if isinstance(message, ModelRequest)
            for part in message.parts
            if isinstance(part, RetryPromptPart)
        )
        if len(offered) == 1:
            return ModelResponse(parts=[ToolCallPart(tool, arguments, tool_call_id="call")])
        return ModelResponse(parts=[TextPart("done")])

    def transport(request: httpx.Request) -> httpx.Response:
        transport_calls.append(request)
        return httpx.Response(500)

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        deps = Deps(
            layers=_layers(),
            services=Services(client, client, inner_api_key="test-inner-key"),
            run_id="run",
        )
        deps.resources.shells["shell"] = ShellSession("shell", deps)
        capabilities = [ReadMediaCapability("read_media")]
        if native:
            capabilities.append(NativeEffectsCapability(waiting_session()))
        agent = Agent(
            FunctionModel(model),
            deps_type=Deps,
            output_type=[str, DeferredToolRequests] if native else str,
            capabilities=capabilities,
            toolsets=[config_module.Capability("config").get_toolset()],
        )
        result = await agent.run("Inspect the inputs", deps=deps)
    assert result.output == "done"
    return offered, retries, transport_calls + shell_scripts


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [("read_media", {"file": FILE}), ("read_config_skill_md", {"name": "alpha"})],
)
def test_native_run_does_not_offer_unfenced_tools_and_a_stray_call_does_not_stop_it(tool, arguments, monkeypatch):
    offered, retries, io = asyncio.run(_run(native=True, tool=tool, arguments=arguments, monkeypatch=monkeypatch))

    assert all(tool not in names for names in offered)
    # The model may still name the tool (main's file observations mention read_media).
    # The SDK answers with an unknown-tool retry; the native fence never sees the call.
    assert any(tool in str(part.content) for part in retries)
    assert io == []


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [("read_media", {"file": FILE}), ("read_config_skill_md", {"name": "alpha"})],
)
def test_ordinary_run_still_offers_both_tools(tool, arguments, monkeypatch):
    offered, retries, io = asyncio.run(_run(native=False, tool=tool, arguments=arguments, monkeypatch=monkeypatch))

    assert {"read_media", "read_config_skill_md"} <= offered[0]
    assert retries == []
    # The call really ran: read_media asked for file metadata, the skill tool pulled through the shell.
    assert len(io) == 1


@pytest.mark.parametrize("native", [False, True])
def test_skill_tool_prompt_is_only_given_when_the_tool_is_offered(native):
    async def exercise():
        async with httpx.AsyncClient() as client:
            deps = Deps(layers=_layers(), services=Services(client, client), run_id="run")
            deps.resources.shells["shell"] = ShellSession("shell", deps)
            if native:
                deps.native_effects = waiting_session()
            ctx = RunContext(deps=deps, model=TestModel(), usage=RunUsage())
            capability = config_module.Capability("config")
            tools = await capability.get_toolset().get_tools(ctx)
            return set(tools), capability._instructions(ctx)

    tools, instructions = asyncio.run(exercise())

    assert ("read_config_skill_md" in tools) is not native
    assert ("read_config_skill_md(name)" in instructions) is not native
    # The fenced shell CLI path for skills stays documented in both modes.
    assert "dify-agent config skills pull --help" in instructions
