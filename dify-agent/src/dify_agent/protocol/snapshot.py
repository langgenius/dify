"""State-only session snapshots with version dispatch at model validation.

Configuration and live resources never belong to a snapshot. Module validators
check the data after it is paired with the current request configuration.
"""

from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator
from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, RetryPromptPart, ToolReturnPart


_LEGACY_NAMES = frozenset(
    {
        "agent_soul_prompt",
        "workflow_node_job_prompt",
        "workflow_user_prompt",
        "agent_app_user_prompt",
        "execution_context",
        "runtime",
        "shell",
        "config",
        "history",
        "llm",
        "tools",
        "core_tools",
        "knowledge",
        "ask_human",
        "output",
        "prompt",
        "user_prompt",
    }
)


def migrate_snapshot_v1_to_v2(snapshot: dict[str, object]) -> dict[str, object]:
    """Convert Agenton v1 list snapshots to state-only v2 JSON data.

    Legacy snapshots lack module types, so only known product slots can migrate.
    Removed slots have no resumable state; Config-derived fields are regenerated.
    Pending AskHuman calls are marked interrupted so native history repair can
    close them before the first new user turn.

    The input is not modified. Non-list shapes pass through for the current
    model's validation and defaults. This function performs no persistence I/O.
    """
    if set(snapshot) - {"schema_version", "layers"}:
        raise ValueError("Unknown legacy snapshot fields")
    layers = snapshot.get("layers")
    if not isinstance(layers, list):
        return snapshot
    states: dict[str, object] = {}
    seen: set[str] = set()
    for slot in layers:
        if not isinstance(slot, dict) or set(slot) != {"name", "lifecycle_state", "runtime_state"}:
            raise ValueError("Invalid legacy snapshot slot")
        name = slot["name"]
        if not isinstance(name, str) or name not in _LEGACY_NAMES:
            raise ValueError(f"Unknown legacy snapshot module: {name}")
        if name in seen:
            raise ValueError(f"Duplicate legacy snapshot module: {name}")
        seen.add(name)
        lifecycle = slot["lifecycle_state"]
        if lifecycle not in {"new", "suspended", "closed"}:
            raise ValueError(f"Invalid legacy lifecycle state: {lifecycle}")
        state = slot["runtime_state"]
        if not isinstance(state, dict):
            raise ValueError(f"Invalid legacy state for {name}")
        state = dict(state)
        if name == "ask_human":
            continue
        if lifecycle == "closed":
            state = {}
        elif name in {"shell", "config"}:
            state["initialized"] = lifecycle != "new"
        if name == "config":
            for key in (
                "config_context_json",
                "config_cli_help",
                "push_spec_semantics",
                "push_spec_json_schema",
                "push_spec_example",
            ):
                state.pop(key, None)
        states[name] = state
    history = states.get("history")
    if "ask_human" in seen and isinstance(history, dict):
        messages = ModelMessagesTypeAdapter.validate_python(history.get("messages", []))
        if messages and messages[-1].state == "complete":
            answered: set[str] = set()
            for message in reversed(messages):
                if isinstance(message, ModelRequest):
                    answered.update(
                        part.tool_call_id
                        for part in message.parts
                        if isinstance(part, (ToolReturnPart, RetryPromptPart))
                    )
                else:
                    if any(
                        call.tool_name == "ask_human" and call.tool_call_id not in answered
                        for call in message.tool_calls
                    ):
                        # Keep every other field/message; native PAI supplies the
                        # interrupted return when a new prompt is submitted.
                        raw_messages = history["messages"]
                        history["messages"] = [
                            *raw_messages[:-1],
                            {**raw_messages[-1], "state": "interrupted"},
                        ]
                    break
    return {"schema_version": 2, "layers": states}


class SessionSnapshot(BaseModel):
    """JSON state keyed by registered module name, independent of ordering."""

    schema_version: Literal[2] = 2
    layers: dict[str, dict[str, JsonValue]] = Field(default_factory=dict)
    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")

    @model_validator(mode="before")
    @classmethod
    def migrate_snapshot(cls, value: object) -> object:
        if isinstance(value, dict) and value.get("schema_version", 1) == 1:
            return migrate_snapshot_v1_to_v2(value)
        return value
