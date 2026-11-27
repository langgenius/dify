"""Framework-free External node/job contracts and durable graph handoff.

Graphon adapters resolve typed variables and caller identity. This application
module only validates the frozen job and reads/creates durable execution intent.
Native Soul, snapshots, model configuration and runtime registries stay separate.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .invocation_service import ExternalInvocationService
from .io_contracts import JsonObject, JsonValue, OutputField
from .output_mapping import contains_file, normalize_node_defaults, validate_output_fields
from .runtime_contracts import (
    InvocationDraft,
    InvocationStore,
    RuntimeError,
    RuntimeResult,
    RuntimeScope,
    TimeoutPolicy,
    WaitPolicy,
)

EXTERNAL_NODE_KIND = "external_a2a"
EXTERNAL_NODE_VERSION = "2"


def is_external_node(data: Mapping[str, Any]) -> bool:
    """Identify External nodes explicitly; unknown kinds never become Native."""
    return (
        data.get("type") == "agent"
        and str(data.get("version")) == "2"
        and data.get("agent_node_kind") == EXTERNAL_NODE_KIND
    )


class ExternalGraphBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    binding_type: Literal["roster_agent"] = "roster_agent"
    agent_id: str | None = None
    binding_epoch: str | None = None
    original_reference: JsonObject | None = None
    # Accepted only as an empty compatibility field; no Native snapshot pin.
    current_snapshot_id: None = None


class ExternalWaitConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    enabled: bool = True
    wait_seconds: int = Field(default=600, ge=60, le=3600)
    on_timeout: TimeoutPolicy = TimeoutPolicy.END_WAITING
    additional_retries: int = Field(default=1, ge=0, le=2)
    retry_interval_seconds: int = Field(default=5, ge=1, le=60)

    def policy(self) -> WaitPolicy:
        """Return effective runtime policy without changing saved author settings."""
        return WaitPolicy(
            wait_seconds=self.wait_seconds if self.enabled else None,
            on_timeout=self.on_timeout,
            additional_retries=self.additional_retries,
            retry_interval_seconds=self.retry_interval_seconds,
        )


class ExternalOutputDeclaration(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    name: str = ""
    type: Literal["string", "number", "boolean", "object", "array", "file"]
    required: bool = True
    description: str | None = None
    children: tuple[ExternalOutputDeclaration, ...] = ()
    array_item: ExternalOutputDeclaration | None = None
    default_value: JsonValue = None
    failure_strategy: JsonObject | None = None
    id: str | None = None
    file: JsonObject | None = None
    check: JsonObject | None = None

    def field(self, *, item: bool = False) -> OutputField:
        """Normalize editor declarations; no business retry or model-based checks."""
        strategy = self.failure_strategy or {}
        retry = strategy.get("retry")
        if isinstance(retry, dict) and retry.get("enabled"):
            raise ValueError("External output failures cannot retry business execution.")
        if self.check and self.check.get("enabled"):
            raise ValueError("External model-based output checks are outside the supported profile.")
        if self.file and any(self.file.values()):
            raise ValueError("External output file format constraints require a supported profile.")
        if self.type == "array" and self.array_item is not None and self.array_item.type == "array":
            raise ValueError("Direct array[array] outputs are not supported.")
        if self.children and self.type != "object":
            raise ValueError("Only object outputs declare named children.")
        if self.array_item is not None and self.type != "array":
            raise ValueError("Only array outputs declare an item type.")
        if strategy.get("on_failure", "stop") not in {"stop", "default_value"}:
            raise ValueError("External output fallback uses the configured node Error Handling.")
        has_default = "default_value" in self.model_fields_set or strategy.get("on_failure") == "default_value"
        default = strategy.get("default_value") if strategy.get("on_failure") == "default_value" else self.default_value
        return OutputField(
            name=self.name or ("item" if item else ""),
            kind=self.type,
            required=self.required,
            children=tuple(child.field() for child in self.children),
            item=self.array_item.field(item=True) if self.array_item else None,
            has_default=has_default,
            default=default,
        )


class ExternalNodeJob(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    schema_version: Literal[1] = 1
    agent_task: str = ""
    agent_declared_outputs: tuple[ExternalOutputDeclaration, ...] = ()
    external_wait: ExternalWaitConfig = Field(default_factory=ExternalWaitConfig)

    @model_validator(mode="after")
    def validate_declarations(self) -> ExternalNodeJob:
        validate_output_fields(self.output_fields())
        return self

    def output_fields(self) -> tuple[OutputField, ...]:
        """Return declared fields, or the fixed plain-text output when undeclared."""
        return tuple(output.field() for output in self.agent_declared_outputs) or (
            OutputField(name="text", kind="string"),
        )

    @classmethod
    def parse_graph(cls, data: Mapping[str, Any]) -> ExternalNodeJob:
        """Extract only the explicit External job fields from a graph node payload."""
        return cls.model_validate(
            {key: data[key] for key in ("agent_task", "agent_declared_outputs", "external_wait") if key in data}
        )

    def validate_for_publish(self, binding: ExternalGraphBinding) -> None:
        """Unconnected/empty tasks remain editable drafts but cannot execute/publish."""
        if not binding.agent_id or not binding.binding_epoch:
            raise ValueError("Select an external agent before running or publishing.")
        if not self.agent_task.strip():
            raise ValueError("Enter a task for this agent.")

    def validate_node_defaults(self, defaults: Mapping[str, object]) -> None:
        """Forbid all file-valued node defaults by declaration, never by string content."""
        fields = {field.name: field for field in self.output_fields()}
        if any(key not in fields or contains_file(fields[key]) for key in defaults):
            raise ValueError("External node defaults must target declared non-file outputs.")
        normalize_node_defaults(defaults, self.output_fields())


@dataclass(frozen=True, slots=True, kw_only=True)
class ExternalWorkflowBinding:
    agent_id: str | None
    binding_epoch: str | None
    job: ExternalNodeJob
    original_reference: JsonObject | None = None


class WorkflowBindingReader(Protocol):
    def load_workflow_binding(self, scope: RuntimeScope, *, workflow_id: str, node_id: str) -> ExternalWorkflowBinding:
        """Rebuild owned persisted External binding; never fetch Native Soul/snapshot."""
        ...


class ExternalWorkflowRuntime:
    """Create/read durable execution intents without framework or persistence access."""

    def __init__(self, service: ExternalInvocationService, store: InvocationStore) -> None:
        self._service = service
        self._store = store

    def enter(self, scope: RuntimeScope, draft: InvocationDraft) -> RuntimeResult:
        """Re-entering the same frame reads its latest fixed Invocation, never resends."""
        existing = self._store.for_execution(scope, draft.identity)
        value = existing if existing is not None else self._service.start(scope, draft)
        if value.identity.workflow_revision != draft.identity.workflow_revision:
            raise RuntimeError("workflow_revision_changed", "The paused external node graph has changed.")
        return self._service.result(scope, value.id)
