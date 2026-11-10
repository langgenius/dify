"""Pure first-whitelist reconstruction shared by the API and SDK handoff.

No owner/service construction or I/O is permitted here. The API separately
proves current pins, never-dispatched pending operations and object ownership.
"""

import json

from pydantic import JsonValue, TypeAdapter

from dify_agent.protocol.native_testing import Counter, FiniteJSON
from dify_agent.protocol.confirmed_recovery import AgentRecoverySuccessor
from dify_agent.protocol.native_continuation import AgentCheckpoint
from dify_agent.protocol.schemas import CreateRunRequest
from dify_agent.protocol.snapshot import SessionSnapshot
from dify_agent.runtime.native_continuation import NativeContinuationConflict


def _canonical_json(value: JsonValue) -> bytes:
    """Same finite canonical JSON used by immutable protocol digests."""
    finite = TypeAdapter(FiniteJSON).validate_python(value)
    return json.dumps(finite, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode(
        "utf-8"
    )


# Fixed first whitelist. Unknown module/state names refuse recovery rather than
# guessing whether arbitrary persisted state depends on the lost environment.
_RECOVERY_STATELESS_LAYERS = frozenset(
    {
        "agent_soul_prompt",
        "workflow_node_job_prompt",
        "workflow_user_prompt",
        "agent_app_user_prompt",
        "execution_context",
        "runtime",
        "llm",
        "tools",
        "core_tools",
        "output",
        "prompt",
        "user_prompt",
    }
)


def recovery_snapshot(checkpoint: AgentCheckpoint) -> SessionSnapshot:
    """Reconstruct only empty state; history/results remain separate and intact."""
    if checkpoint.job_refs:
        raise NativeContinuationConflict("confirmed recovery state unsupported")
    layers = {}
    for name, state in checkpoint.session_snapshot.layers.items():
        if name == "shell":
            if (
                set(state) - {"initialized", "job_ids", "job_offsets", "job_refs"}
                or ("initialized" in state and type(state["initialized"]) is not bool)
                or state.get("job_ids", []) != []
                or state.get("job_offsets", {}) != {}
                or state.get("job_refs", {}) != {}
            ):
                raise NativeContinuationConflict("confirmed recovery state unsupported")
            layers[name] = {**state, "initialized": False}
        elif name == "config":
            if (
                set(state) - {"initialized", "pulled_skill_outputs", "pulled_file_outputs"}
                or ("initialized" in state and type(state["initialized"]) is not bool)
                or state.get("pulled_skill_outputs", {}) != {}
                or state.get("pulled_file_outputs", {}) != {}
            ):
                raise NativeContinuationConflict("confirmed recovery state unsupported")
            layers[name] = {**state, "initialized": False}
        elif name == "history":
            if set(state) != {"messages"} or _canonical_json(state["messages"]) != _canonical_json(
                checkpoint.model_dump(mode="json")["history"]
            ):
                raise NativeContinuationConflict("confirmed recovery state unsupported")
            layers[name] = state
        elif name in _RECOVERY_STATELESS_LAYERS and not state:
            layers[name] = {}
        else:
            raise NativeContinuationConflict("confirmed recovery state unsupported")
    return SessionSnapshot(layers=layers)


def validate_recovery_checkpoint(relation: AgentRecoverySuccessor, old: AgentCheckpoint, new: AgentCheckpoint) -> None:
    _validate_recovery_pending(
        old,
        parent_execution_id=relation.parent_node.execution_id,
        workspace_generation=relation.predecessor.workspace_generation,
    )
    _validate_recovery_pending(
        new,
        parent_execution_id=relation.parent_node.execution_id,
        workspace_generation=relation.successor.workspace_generation,
    )
    if (
        old.native_test_profile != "confirmed"
        or new.native_test_profile != "confirmed"
        or old.run_id != relation.agent_run_id
        or old.ref != relation.parent_node.ref
        or old.generation != relation.expected_agent_generation
        or old.config_ref != relation.predecessor.config_ref
        or old.config_digest != relation.predecessor.config_digest
        or new.config_ref != relation.successor.config_ref
        or new.config_digest != relation.successor.config_digest
        or len(new.pending_calls) != len(old.pending_calls)
        or new.session_snapshot != recovery_snapshot(old)
    ):
        raise NativeContinuationConflict("confirmed recovery checkpoint mismatch")
    unchanged = {
        "protocol_version",
        "native_test_profile",
        "create_idempotency_key",
        "run_id",
        "generation",
        "ref",
        "stage",
        "history",
        "operation_cursor",
        "result_refs",
        "job_refs",
    }
    if old.model_dump(mode="json", include=unchanged) != new.model_dump(mode="json", include=unchanged):
        raise NativeContinuationConflict("confirmed recovery history mismatch")
    substitutions = {
        p.predecessor_operation_id: p.successor_operation_id for p in relation.pending_operation_substitutions
    }
    if set(substitutions) != {p.pending_operation_id for p in old.pending_calls}:
        raise NativeContinuationConflict("confirmed recovery pending mismatch")
    for before, after in zip(old.pending_calls, new.pending_calls, strict=True):
        if before.intent.key.occurrence_path[0] != relation.parent_node.execution_id:
            raise NativeContinuationConflict("confirmed recovery pending mismatch")
        metadata = {"call_id", "tool_name", "native_arguments", "deferred_kind", "stage", "wait_reason"}
        if before.model_dump(mode="json", include=metadata) != after.model_dump(mode="json", include=metadata):
            raise NativeContinuationConflict("confirmed recovery pending mismatch")
        expected_path = (
            relation.parent_node.execution_id,
            "recovery",
            str(relation.successor.workspace_generation),
            *before.intent.key.occurrence_path[-2:],
        )
        if after.pending_operation_id != substitutions[
            before.pending_operation_id
        ] or after.intent.key != before.intent.key.model_copy(update={"occurrence_path": expected_path}):
            raise NativeContinuationConflict("confirmed recovery pending mismatch")
        # No unrequested business argument or implementation substitution.
        if before.intent.model_dump(exclude={"key", "capability_digest"}) != after.intent.model_dump(
            exclude={"key", "capability_digest"}
        ):
            raise NativeContinuationConflict("confirmed recovery pending arguments changed")
        if after.pending_operation_id in old.result_refs:
            raise NativeContinuationConflict("confirmed recovery pending already completed")


def _validate_recovery_config(config: CreateRunRequest) -> None:
    from dify_agent.layers.shell.configs import DifyShellLayerConfig
    from dify_agent.layers.runtime.configs import DifyRuntimeLayerConfig
    from dify_agent.layers.config.configs import DifyConfigLayerConfig
    from dify_agent.layers.dify_core_tools.configs import DifyCoreToolsLayerConfig
    from dify_agent.layers.dify_plugin.configs import DifyPluginToolsLayerConfig

    bindings = 0
    for layer in config.composition.layers:
        name, value = layer.name, layer.config
        if name == "runtime":
            DifyRuntimeLayerConfig.model_validate(value)
            bindings += 1
        elif name == "shell":
            shell = DifyShellLayerConfig.model_validate(value)
            if shell.cli_tools or shell.secret_refs:
                raise NativeContinuationConflict("confirmed recovery bootstrap unsupported")
        elif name == "config":
            config_layer = DifyConfigLayerConfig.model_validate(value)
            if (
                config_layer.skills
                or config_layer.files
                or config_layer.mentioned_skill_names
                or config_layer.mentioned_file_names
            ):
                raise NativeContinuationConflict("confirmed recovery files unsupported")
        elif name in {"core_tools", "tools"}:
            tools = (
                DifyCoreToolsLayerConfig.model_validate(value)
                if name == "core_tools"
                else DifyPluginToolsLayerConfig.model_validate(value)
            )
            if tools.shell is not None or any(
                parameter.type in {"file", "files", "system-files"}
                for tool in tools.tools
                for parameter in tool.parameters
            ):
                raise NativeContinuationConflict("confirmed recovery files unsupported")
        elif name not in _RECOVERY_STATELESS_LAYERS and name != "history":
            raise NativeContinuationConflict("confirmed recovery layer unsupported")
        if name in {"user_prompt", "workflow_user_prompt", "agent_app_user_prompt"} and value.get("files"):
            raise NativeContinuationConflict("confirmed recovery files unsupported")
    if bindings != 1:
        raise NativeContinuationConflict("confirmed recovery config mismatch")


def _validate_recovery_pending(
    checkpoint: AgentCheckpoint, *, parent_execution_id: str | None = None, workspace_generation: int | None = None
) -> None:
    if checkpoint.native_test_profile != "confirmed":
        raise NativeContinuationConflict("confirmed recovery profile unsupported")
    selected_parent, selected_generation = parent_execution_id, workspace_generation
    for pending in checkpoint.pending_calls:
        path = pending.intent.key.occurrence_path
        if len(path) not in {3, 5} or path[-1] != pending.call_id:
            raise NativeContinuationConflict("confirmed recovery pending mismatch")
        generation = 0
        if len(path) == 5:
            raw_generation = path[2]
            if (
                path[1] != "recovery"
                or not raw_generation.isascii()
                or not raw_generation.isdecimal()
                or raw_generation[0] == "0"
            ):
                raise NativeContinuationConflict("confirmed recovery pending mismatch")
            try:
                generation = TypeAdapter(Counter).validate_python(int(raw_generation))
            except ValueError:
                raise NativeContinuationConflict("confirmed recovery pending mismatch") from None
        if selected_parent is None:
            selected_parent = path[0]
        if selected_generation is None:
            selected_generation = generation
        if path[0] != selected_parent or generation != selected_generation:
            raise NativeContinuationConflict("confirmed recovery pending mismatch")
        # Only these actual confirmed producers are reconstructible. Unknown
        # stages, namespaces and policy waits must never be normalized on handoff.
        combination = (
            checkpoint.stage,
            pending.stage,
            pending.intent.kind,
            path[-2],
            pending.wait_reason,
            pending.deferred_kind,
        )
        if combination not in {
            ("tool", "tool", "tool", "core_tool", "approval", "approval"),
            ("model", "model", "model", "model", "approval", "approval"),
        }:
            raise NativeContinuationConflict("confirmed recovery pending unsupported")
        if pending.call_id in checkpoint.result_refs or pending.pending_operation_id in checkpoint.result_refs:
            raise NativeContinuationConflict("confirmed recovery pending already completed")


def validate_recovery_eligibility(config: CreateRunRequest, checkpoint: AgentCheckpoint) -> None:
    """Apply the shared whitelist before allocation, without successor resources.

    This proves reconstructibility only. Owner/pin/scope and no-attempt/physical-
    claim checks remain with the existing API owners before any allocation.
    """
    try:
        _validate_recovery_config(config)
        recovery_snapshot(checkpoint)
        parent = config.native_parent_node
        if parent is not None and parent.ref != checkpoint.ref:
            raise NativeContinuationConflict("confirmed recovery pending mismatch")
        _validate_recovery_pending(
            checkpoint,
            parent_execution_id=parent.execution_id if parent is not None else None,
        )
    except ValueError:
        raise NativeContinuationConflict("confirmed recovery configuration unsupported") from None


def validate_recovery_configs(
    relation: AgentRecoverySuccessor, old: CreateRunRequest, new: CreateRunRequest, checkpoint: AgentCheckpoint
) -> None:
    _validate_recovery_config(old)
    _validate_recovery_pending(
        checkpoint,
        parent_execution_id=relation.parent_node.execution_id,
        workspace_generation=relation.successor.workspace_generation,
    )
    before, after = old.model_dump(mode="json"), new.model_dump(mode="json")
    for layer in before["composition"]["layers"]:
        if layer["name"] == "runtime":
            if layer["config"] != {"backend_binding_ref": relation.predecessor.binding_ref}:
                raise NativeContinuationConflict("confirmed recovery config mismatch")
            layer["config"]["backend_binding_ref"] = relation.successor.binding_ref
    if before["composition"] != after["composition"]:
        raise NativeContinuationConflict("confirmed recovery config mismatch")
    if new.session_snapshot is not None and new.session_snapshot != checkpoint.session_snapshot:
        raise NativeContinuationConflict("confirmed recovery config snapshot mismatch")
