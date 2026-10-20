"""Allowlisted name-to-module registry and JSON state loading.

Modules export Config, State and exactly one native Capability or Toolset. All
configuration, state and references are checked before a run performs I/O. The
registry is server-owned; HTTP callers never supply import paths or live objects.
"""

from collections.abc import Mapping
from types import ModuleType
from typing import cast

from pydantic import BaseModel
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.toolsets import AbstractToolset

from dify_agent.layers import history
from dify_agent.layers.prompt import layer as prompt
from dify_agent.layers.config import layer as config
from dify_agent.layers.dify_core_tools import layer as core_tools
from dify_agent.layers.dify_plugin import llm_layer as llm, tools_layer as plugin_tools
from dify_agent.layers.execution_context import layer as execution_context
from dify_agent.layers.knowledge import layer as knowledge
from dify_agent.layers.output import output_layer as output
from dify_agent.layers.runtime import layer as runtime
from dify_agent.layers.shell import layer as shell
from dify_agent.layers.user_prompt import layer as user_prompt
from dify_agent.protocol.schemas import CreateRunRequest
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.context import Deps, LayerData, Services


REGISTRY: dict[str, ModuleType] = {
    "agent_soul_prompt": prompt,
    "workflow_node_job_prompt": prompt,
    "workflow_user_prompt": prompt,
    "agent_app_user_prompt": user_prompt,
    "prompt": prompt,
    "user_prompt": user_prompt,
    "execution_context": execution_context,
    "runtime": runtime,
    "shell": shell,
    "config": config,
    "history": history,
    "llm": llm,
    "tools": plugin_tools,
    "core_tools": core_tools,
    "knowledge": knowledge,
    "output": output,
}

_REFERENCES: dict[ModuleType, dict[str, ModuleType]] = {
    llm: {"execution_context": execution_context},
    plugin_tools: {"execution_context": execution_context, "shell": shell},
    core_tools: {"execution_context": execution_context},
    knowledge: {"execution_context": execution_context},
    shell: {"runtime": runtime, "execution_context": execution_context},
    config: {"shell": shell},
}


def load_modules(
    request: CreateRunRequest, services: Services, run_id: str, *, registry: Mapping[str, ModuleType] = REGISTRY
) -> Deps:
    """Create independent validated JSON data using current Config and saved State.

    Optional modules may be added or removed between runs. Retained unknown state
    names are rejected, while known removed slots are omitted from the new
    snapshot. Legacy migration happens at the snapshot DTO boundary.
    """
    names = [spec.name for spec in request.composition.layers]
    if len(set(names)) != len(names):
        raise ValueError("Module names must be unique")
    if "llm" not in names:
        raise ValueError("Missing required 'llm' module")
    state = request.session_snapshot.layers if request.session_snapshot is not None else {}
    unknown = state.keys() - registry.keys()
    if unknown:
        raise ValueError(f"Unknown snapshot modules: {', '.join(sorted(unknown))}")
    layers: dict[str, LayerData] = {}
    configs: dict[str, BaseModel] = {}
    for spec in request.composition.layers:
        module = registry.get(spec.name)
        if module is None:
            raise ValueError(f"Unknown registered module: {spec.name}")
        config_type = cast(type[BaseModel], module.Config)
        state_type = cast(type[BaseModel], module.State)
        has_capability = hasattr(module, "Capability")
        has_toolset = hasattr(module, "Toolset")
        if has_capability == has_toolset:
            raise TypeError(f"Module {spec.name} must export exactly one Capability or Toolset")
        implementation = module.Capability if has_capability else module.Toolset
        expected = AbstractCapability if has_capability else AbstractToolset
        if not issubclass(implementation, expected):
            raise TypeError(f"Module {spec.name} must use native Pydantic AI components")
        cfg = config_type.model_validate(spec.config)
        restored = state_type.model_validate(state.get(spec.name, {}))
        configs[spec.name] = cfg
        layers[spec.name] = {"config": cfg.model_dump(mode="json"), "state": restored.model_dump(mode="json")}
    for name, cfg in configs.items():
        module = registry[name]
        for field, expected_module in _REFERENCES.get(module, {}).items():
            target = cast(str | None, layers[name]["config"][field])
            if target is None:
                continue
            if target not in layers or registry[target] is not expected_module:
                raise ValueError(
                    f"Module {name} reference {field} must name a configured {expected_module.__name__} module"
                )
        if module is runtime and services.runtime_backend_profile is None:
            raise ValueError("Runtime module requires a configured runtime backend")
        if module is plugin_tools:
            for tool in cast(plugin_tools.Config, cfg).tools:
                plugin_tools._validate_required_hidden_parameters(tool, tool.parameters)
        if module is knowledge:
            target = cast(knowledge.Config, cfg).execution_context
            knowledge._build_caller_context(configs[target])
    return Deps(layers=layers, services=services, run_id=run_id)


def create_modules(
    deps: Deps, *, registry: Mapping[str, ModuleType] = REGISTRY
) -> dict[str, AbstractCapability[Deps] | AbstractToolset[Deps]]:
    """Construct fresh native instances for this run; no instance is restored."""
    return {
        name: (
            registry[name].Capability(name) if hasattr(registry[name], "Capability") else registry[name].Toolset(name)
        )
        for name in deps.layers
    }


def snapshot_modules(deps: Deps, *, registry: Mapping[str, ModuleType] = REGISTRY) -> SessionSnapshot:
    """Validate and copy final state after resource cleanup, excluding all Config."""
    return SessionSnapshot(
        layers={
            name: registry[name].State.model_validate(entry["state"]).model_dump(mode="json")
            for name, entry in deps.layers.items()
        }
    )
