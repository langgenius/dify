"""Native module contracts: canonical JSON data, references and data migration."""

from types import ModuleType

import httpx
import pytest
from pydantic import ValidationError
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.messages import ModelRequest, UserPromptPart
from pydantic_ai.toolsets import AbstractToolset

from dify_agent.layers import history
from dify_agent.layers.prompt import layer as prompt
from dify_agent.protocol.schemas import CreateRunRequest, RunComposition, RunLayerSpec
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.context import Services
from dify_agent.runtime.modules import REGISTRY, create_modules, load_modules, snapshot_modules


@pytest.fixture
def services():
    return Services(httpx.AsyncClient(), httpx.AsyncClient())


def request(*extra: RunLayerSpec, snapshot: SessionSnapshot | None = None) -> CreateRunRequest:
    return CreateRunRequest(
        composition=RunComposition(
            layers=[
                RunLayerSpec(
                    name="execution_context",
                    config={"tenant_id": "tenant", "agent_mode": "agent_app", "invoke_from": "web-app"},
                ),
                RunLayerSpec(name="llm", config={"plugin_id": "openai", "model_provider": "openai", "model": "demo"}),
                *extra,
            ]
        ),
        session_snapshot=snapshot,
    )


def test_all_registered_modules_export_native_components(services):
    for module in set(REGISTRY.values()):
        assert hasattr(module, "Config") and hasattr(module, "State")
        assert hasattr(module, "Capability") != hasattr(module, "Toolset")
        implementation = module.Capability if hasattr(module, "Capability") else module.Toolset
        native = AbstractCapability if hasattr(module, "Capability") else AbstractToolset
        assert issubclass(implementation, native)


def test_one_module_registered_twice_has_independent_json_and_fresh_instances(services):
    registry = {**REGISTRY, "first": prompt, "second": prompt}
    incoming = request(
        RunLayerSpec(name="first", config={"user": "first"}),
        RunLayerSpec(name="second", config={"user": "second"}),
        RunLayerSpec(name="history"),
    )
    a = load_modules(incoming, services, "a", registry=registry)
    b = load_modules(incoming, services, "b", registry=registry)
    assert a.layers["first"]["config"]["user"] == "first"
    assert a.layers["second"]["config"]["user"] == "second"
    a.layers["first"]["config"]["user"] = "changed"
    assert b.layers["first"]["config"]["user"] == "first"
    assert incoming.composition.layers[2].config["user"] == "first"
    assert create_modules(a, registry=registry)["first"] is not create_modules(b, registry=registry)["first"]
    assert "config" not in snapshot_modules(a, registry=registry).layers["history"]


def test_state_requires_explicit_json_writeback(services):
    incoming = request(RunLayerSpec(name="history"))
    deps = load_modules(incoming, services, "test")
    parsed = history.State.model_validate(deps.layers["history"]["state"])
    parsed.messages.append(ModelRequest(parts=[UserPromptPart(content="saved")]))
    assert deps.layers["history"]["state"]["messages"] == []
    deps.layers["history"]["state"] = parsed.model_dump(mode="json")
    # Persistence uses the module-owned dump, independent of current config.
    snap = snapshot_modules(deps)
    again = load_modules(request(RunLayerSpec(name="history"), snapshot=snap), services, "again")
    again.layers["history"]["state"]["messages"].append({"kind": "request", "parts": []})
    assert len(snap.layers["history"]["messages"]) == 1
    assert history.State.model_validate(snap.layers["history"]).messages == parsed.messages


@pytest.mark.parametrize(
    "spec,error",
    [
        (RunLayerSpec(name="unknown"), "Unknown registered module"),
        (RunLayerSpec(name="llm"), "unique"),
        (RunLayerSpec(name="tools", config={"execution_context": "missing"}), "reference execution_context"),
        (RunLayerSpec(name="shell", config={"runtime": "execution_context"}), "reference runtime"),
    ],
)
def test_invalid_module_or_reference_is_rejected_before_io(spec, error, services):
    with pytest.raises(ValueError, match=error):
        load_modules(request(spec), services, "test")


def test_snapshot_uses_current_config_and_drops_removed_optional_slots(services):
    incoming = request(
        RunLayerSpec(name="prompt", config={"user": "current"}),
        snapshot=SessionSnapshot(layers={"prompt": {}, "tools": {}}),
    )
    deps = load_modules(incoming, services, "test")
    assert deps.layers["prompt"]["config"]["user"] == "current"
    assert "tools" not in snapshot_modules(deps).layers
    with pytest.raises(ValueError, match="Unknown snapshot modules"):
        load_modules(request(snapshot=SessionSnapshot(layers={"unregistered": {}})), services, "bad")


def test_legacy_snapshot_conversion_preserves_only_retained_state():
    snapshot = SessionSnapshot.model_validate(
        {
            "schema_version": 1,
            "layers": [
                {"name": "shell", "lifecycle_state": "suspended", "runtime_state": {"job_ids": [], "job_offsets": {}}},
                {
                    "name": "config",
                    "lifecycle_state": "new",
                    "runtime_state": {
                        "pulled_skill_outputs": {"skill": "content"},
                        "config_context_json": "obsolete manifest",
                        "config_cli_help": {"config": "obsolete help"},
                        "push_spec_json_schema": "obsolete",
                    },
                },
                {"name": "history", "lifecycle_state": "suspended", "runtime_state": {"messages": []}},
                {"name": "ask_human", "lifecycle_state": "suspended", "runtime_state": {"pending": "obsolete"}},
            ],
        }
    )
    assert snapshot.schema_version == 2
    assert snapshot.layers["shell"]["initialized"] is True
    assert snapshot.layers["config"] == {"initialized": False, "pulled_skill_outputs": {"skill": "content"}}
    assert snapshot.layers["history"] == {"messages": []}
    assert "ask_human" not in snapshot.layers
    assert SessionSnapshot.model_validate_json(snapshot.model_dump_json()) == snapshot


@pytest.mark.parametrize(
    "slot",
    [
        {"name": "custom", "lifecycle_state": "suspended", "runtime_state": {}},
        {"name": "shell", "lifecycle_state": "active", "runtime_state": {}},
        {"name": "shell", "lifecycle_state": "suspended", "runtime_state": None},
    ],
)
def test_invalid_legacy_state_is_rejected(slot):
    with pytest.raises(ValidationError):
        SessionSnapshot.model_validate({"schema_version": 1, "layers": [slot]})


def test_duplicate_removed_legacy_slots_are_rejected():
    slot = {"name": "ask_human", "lifecycle_state": "suspended", "runtime_state": {}}
    with pytest.raises(ValidationError, match="Duplicate"):
        SessionSnapshot.model_validate({"schema_version": 1, "layers": [slot, slot]})


@pytest.mark.anyio
async def test_native_sequential_tools_commit_json_state_without_lost_updates():
    import asyncio
    from pydantic import BaseModel
    from pydantic_ai import Agent, RunContext
    from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
    from pydantic_ai.models.function import FunctionModel
    from pydantic_ai.toolsets import FunctionToolset
    from dify_agent.runtime.context import Deps

    class Config(BaseModel):
        pass

    class State(BaseModel):
        count: int = 0

    class Toolset(FunctionToolset[Deps]):
        def __init__(self, name):
            super().__init__(id=name, sequential=True)
            self.name = name

            @self.tool
            async def increment(ctx: RunContext[Deps]) -> int:
                """Persist one increment across an async operation."""
                data = ctx.deps.layers[self.name]
                state = State.model_validate(data["state"])
                await asyncio.sleep(0)
                state.count += 1
                data["state"] = state.model_dump(mode="json")
                return state.count

    module = ModuleType("counter")
    module.Config = Config
    module.State = State
    module.Toolset = Toolset
    registry = {**REGISTRY, "counter": module}

    async def model(messages, info):
        parts = [p for m in messages if isinstance(m, ModelRequest) for p in m.parts if isinstance(p, ToolReturnPart)]
        if not parts:
            assert info.function_tools[0].sequential
            return ModelResponse(
                parts=[
                    ToolCallPart("increment", {}, tool_call_id="one"),
                    ToolCallPart("increment", {}, tool_call_id="two"),
                ]
            )
        assert [p.content for p in parts] == [1, 2]
        return ModelResponse(parts=[TextPart("done")])

    async with httpx.AsyncClient() as client:
        deps = load_modules(request(RunLayerSpec(name="counter")), Services(client, client), "test", registry=registry)
        native = create_modules(deps, registry=registry)["counter"]
        await Agent(FunctionModel(model), deps_type=Deps, toolsets=[native]).run("increment twice", deps=deps)
        assert snapshot_modules(deps, registry=registry).layers["counter"] == {"count": 2}
