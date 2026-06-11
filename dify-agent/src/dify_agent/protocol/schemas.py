"""Public HTTP protocol schemas for the Dify Agent run API.

This module is the shared wire contract for the FastAPI server, runtime event
producers, storage adapters, and Python client. Create-run requests expose a
Dify-friendly ``composition.layers[].config`` shape so callers can describe one
layer in one place; the server normalizes that public DTO into Agenton's
state-only ``CompositorConfig`` plus node-name keyed per-run configs before
calling ``Compositor.enter(configs=...)``. Session snapshots and ``on_exit`` stay
top-level because they are per-run resume state and exit policy, not graph node
definition.

The server still constructs layers only from explicit provider type ids, keeping
HTTP input data-only and preventing unsafe import-path construction. Run events
are append-only records; Redis stream ids (or in-memory equivalents in tests) are
the public cursors used by polling and SSE replay. Event envelopes keep the
public ``id``/``run_id``/``type``/``data``/``created_at`` shape, while each
``type`` has a typed ``data`` model so OpenAPI, Redis replay, and clients parse
the same payload contract. Model/provider selection is part of the submitted
composition, not a top-level run field; the runtime reads the model layer named
by ``DIFY_AGENT_MODEL_LAYER_ID``, the optional history layer named by
``DIFY_AGENT_HISTORY_LAYER_ID``, and the optional structured output layer named
by ``DIFY_AGENT_OUTPUT_LAYER_ID``. Request-level ``on_exit`` signals decide
whether each active layer is suspended or deleted when the run exits, with
suspend as the default so successful terminal events can include resumable
snapshots. Successful runs publish the final JSON-safe agent output and the
resumable Agenton session snapshot together on the terminal ``run_succeeded``
event so consumers can treat terminal events as complete run summaries. Session
snapshots carry only layer lifecycle/runtime state in compositor order; they do
not persist output-layer config. Resumed structured-output runs therefore must
resubmit the same ``output`` layer in ``composition.layers[]`` so snapshot layer
name/order still matches the composition and the runtime can rebuild the same
structured output contract.
"""

from datetime import datetime, timezone
from typing import Annotated, ClassVar, Final, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter
from pydantic_ai.messages import AgentStreamEvent

from agenton.compositor import CompositorConfig, CompositorSessionSnapshot, LayerConfigInput, LayerNodeConfig
from agenton.layers import ExitIntent, LifecycleState


DIFY_AGENT_MODEL_LAYER_ID: Final[str] = "llm"
DIFY_AGENT_HISTORY_LAYER_ID: Final[str] = "history"
DIFY_AGENT_OUTPUT_LAYER_ID: Final[str] = "output"
RunStatus = Literal["running", "paused", "succeeded", "failed", "cancelled"]
RunPurpose = Literal["workflow_node", "single_step", "agent_app", "babysit", "fasten_preview"]
RunEventType = Literal[
    "run_started",
    "pydantic_ai_event",
    "run_paused",
    "run_succeeded",
    "run_failed",
    "run_cancelled",
]
SandboxReadEncoding = Literal["utf-8", "base64"]


def utc_now() -> datetime:
    """Return the timezone-aware timestamp format used by public schemas."""
    return datetime.now(timezone.utc)


class LayerExitSignals(BaseModel):
    """Requested per-layer lifecycle behavior for the top-level ``on_exit`` field."""

    default: ExitIntent = ExitIntent.SUSPEND
    layers: dict[str, ExitIntent] = Field(default_factory=dict)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunLayerSpec(BaseModel):
    """Public graph node plus per-run layer config for one Dify Agent layer.

    ``name``/``type``/``deps``/``metadata`` are normalized into Agenton's
    provider-backed graph config. ``config`` is kept separate at the Agenton
    boundary and passed to ``Compositor.enter(configs=...)`` keyed by ``name``;
    existing layer config DTO instances are preserved so client code can stay
    DTO-first without being forced into raw dictionaries.
    """

    name: str
    type: str
    deps: dict[str, str] = Field(default_factory=dict)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    config: LayerConfigInput = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunComposition(BaseModel):
    """Public create-run composition DTO.

    The public shape intentionally differs from Agenton's internal
    ``CompositorConfig`` by carrying each layer's per-run config next to its graph
    node fields. Use ``normalize_composition`` at server/runtime boundaries before
    constructing a ``Compositor``.
    """

    schema_version: int = 1
    layers: list[RunLayerSpec]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CreateRunRequest(BaseModel):
    """Request body for creating one async agent run.

    Model/provider configuration must be supplied through the composition layer
    named by ``DIFY_AGENT_MODEL_LAYER_ID``. Optional persisted conversation
    history may be supplied through the composition layer named by
    ``DIFY_AGENT_HISTORY_LAYER_ID``. Structured output may be supplied through
    the optional composition layer named by
    ``DIFY_AGENT_OUTPUT_LAYER_ID``. ``on_exit`` defaults every active layer to
    suspend so callers receive a resumable success snapshot unless they
    explicitly request delete for one or more layers. Session snapshots do not
    preserve output-layer config, so resume requests that rely on structured
    output must include the same ``output`` layer in ``composition.layers[]`` to
    keep snapshot compatibility and rebuild the output schema. Dify tenant,
    user, and run-correlation identifiers must be submitted through a
    ``dify.execution_context`` entry in ``composition.layers[]``; there is no
    parallel top-level ``execution_context`` request field.
    """

    composition: RunComposition
    purpose: RunPurpose = "workflow_node"
    idempotency_key: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    session_snapshot: CompositorSessionSnapshot | None = None
    on_exit: LayerExitSignals = Field(default_factory=LayerExitSignals)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CancelRunRequest(BaseModel):
    """Request body for cancelling a run.

    Runtime cancellation is intentionally a separate protocol operation from
    failed execution so API callers can distinguish user/operator cancellation
    from model, tool, or infrastructure failures.
    """

    reason: str | None = None
    message: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxLocator(BaseModel):
    """Minimal resume payload needed to re-enter one sandbox shell layer.

    ``composition.layers`` and ``session_snapshot.layers`` must describe the
    same ordered layer slice so Agenton can resume runtime state deterministically.
    Callers are expected to build this DTO through
    ``build_sandbox_locator_from_run_request()`` rather than inventing an
    ad-hoc locator: that helper keeps the named shell layer plus its full
    transitive dependency closure, preserves matching snapshot entries in the
    same order, and leaves shell ``session_id`` inside runtime state only.

    ``shell_layer_name`` is part of the public contract and may differ from the
    conventional ``"shell"`` node name. The locator therefore identifies the
    resumable shell by graph node name plus matching snapshot state rather than
    by exposing any top-level ``session_id`` field.
    """

    composition: RunComposition
    session_snapshot: CompositorSessionSnapshot
    shell_layer_name: str = "shell"

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxListFilesRequest(BaseModel):
    """Request body for listing files inside a sandbox workspace."""

    locator: SandboxLocator
    path: str = "."

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxFileEntry(BaseModel):
    """One file-system entry returned by sandbox file listing."""

    name: str
    type: Literal["file", "directory"]
    size: int
    mtime: int

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxListResult(BaseModel):
    """Sandbox file listing response."""

    path: str
    entries: list[SandboxFileEntry]
    truncated: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxReadFileRequest(BaseModel):
    """Request body for reading one sandbox file."""

    locator: SandboxLocator
    path: str
    encoding: SandboxReadEncoding = "utf-8"
    max_bytes: int = Field(default=262144, ge=1)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxReadResult(BaseModel):
    """Sandbox file read response for text or base64 payloads."""

    path: str
    encoding: SandboxReadEncoding
    content: str
    size: int
    truncated: bool = False

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxUploadFileRequest(BaseModel):
    """Request body for uploading one sandbox file through the stub CLI."""

    locator: SandboxLocator
    path: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxUploadedFile(BaseModel):
    """Uploaded Dify file metadata returned by the stub CLI."""

    id: str
    name: str
    size: int
    mime_type: str

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class SandboxUploadResult(BaseModel):
    """Sandbox upload response."""

    path: str
    file: SandboxUploadedFile

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


def normalize_composition(composition: RunComposition) -> tuple[CompositorConfig, dict[str, LayerConfigInput]]:
    """Split public Dify composition into Agenton's graph config and layer configs.

    Returns:
        A ``CompositorConfig`` containing only graph fields and a node-name keyed
        config mapping suitable for ``Compositor.enter(configs=...)``.

    The helper is the stable public-to-Agenton boundary: it preserves concrete
    ``LayerConfig`` DTO inputs where possible, does not accept legacy
    ``LayerNodeConfig(config=...)`` payloads, and keeps session snapshots plus
    exit signals out of graph normalization.
    """

    graph_config = CompositorConfig(
        schema_version=composition.schema_version,
        layers=[
            LayerNodeConfig(
                name=layer.name,
                type=layer.type,
                deps=dict(layer.deps),
                metadata=dict(layer.metadata),
            )
            for layer in composition.layers
        ],
    )
    layer_configs = {layer.name: layer.config for layer in composition.layers}
    return graph_config, layer_configs


def build_sandbox_locator_from_run_request(
    request: CreateRunRequest,
    *,
    shell_layer_name: str = "shell",
) -> SandboxLocator:
    """Extract the resumable shell subset from a full run request.

    The locator keeps only the named shell layer plus its transitive
    dependencies and matching session snapshots, preserving the original layer
    order exactly so ``composition.layers`` and ``session_snapshot.layers`` stay
    aligned for Agenton resume validation. This helper is also the guardrail
    that prevents ``/sandbox`` callers from drifting into a second locator
    protocol: shell ``session_id`` remains buried inside shell runtime state and
    never becomes a separate top-level request field.
    """
    shell_layer = next((layer for layer in request.composition.layers if layer.name == shell_layer_name), None)
    if shell_layer is None:
        raise ValueError(f"Sandbox shell layer '{shell_layer_name}' is missing from composition.")
    if request.session_snapshot is None:
        raise ValueError("Sandbox locator requires a resumable session_snapshot.")

    included_names: set[str] = set()
    pending_names = [shell_layer_name]
    composition_by_name = {layer.name: layer for layer in request.composition.layers}
    while pending_names:
        current_name = pending_names.pop()
        if current_name in included_names:
            continue
        try:
            current_layer = composition_by_name[current_name]
        except KeyError as exc:
            raise ValueError(f"Sandbox layer dependency '{current_name}' is missing from composition.") from exc
        included_names.add(current_name)
        pending_names.extend(current_layer.deps.values())

    filtered_layers = [layer.model_copy(deep=True) for layer in request.composition.layers if layer.name in included_names]
    snapshot_by_name = {layer.name: layer for layer in request.session_snapshot.layers}
    filtered_snapshots = []
    for layer in filtered_layers:
        layer_snapshot = snapshot_by_name.get(layer.name)
        if layer_snapshot is None:
            raise ValueError(f"Sandbox layer snapshot '{layer.name}' is missing from session_snapshot.")
        filtered_snapshots.append(layer_snapshot.model_copy(deep=True))

    shell_snapshot = snapshot_by_name.get(shell_layer_name)
    if shell_snapshot is None:
        raise ValueError(f"Sandbox shell snapshot '{shell_layer_name}' is missing from session_snapshot.")
    if shell_snapshot.lifecycle_state is not LifecycleState.SUSPENDED:
        raise ValueError(
            f"Sandbox shell snapshot '{shell_layer_name}' must be suspended, got {shell_snapshot.lifecycle_state.value}."
        )

    return SandboxLocator(
        composition=RunComposition(
            schema_version=request.composition.schema_version,
            layers=filtered_layers,
        ),
        session_snapshot=CompositorSessionSnapshot(
            schema_version=request.session_snapshot.schema_version,
            layers=filtered_snapshots,
        ),
        shell_layer_name=shell_layer_name,
    )


class CreateRunResponse(BaseModel):
    """Response returned after a run has been persisted and scheduled locally."""

    run_id: str
    status: RunStatus

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class CancelRunResponse(BaseModel):
    """Response returned after a cancel request is accepted."""

    run_id: str
    status: Literal["cancelled"]

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunStatusResponse(BaseModel):
    """Current server-side status for one run."""

    run_id: str
    status: RunStatus
    created_at: datetime
    updated_at: datetime
    error: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class EmptyRunEventData(BaseModel):
    """Typed empty payload for lifecycle events that carry no extra data."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunSucceededEventData(BaseModel):
    """Terminal success payload for final output and resumable session state."""

    output: JsonValue
    session_snapshot: CompositorSessionSnapshot

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunFailedEventData(BaseModel):
    """Terminal failure payload shown to polling and SSE consumers."""

    error: str
    reason: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunPausedEventData(BaseModel):
    """Pause payload used for human handoff or other resumable waits."""

    reason: str
    message: str | None = None
    session_snapshot: CompositorSessionSnapshot | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunCancelledEventData(BaseModel):
    """Terminal cancellation payload for explicit user/operator cancellation."""

    reason: str | None = None
    message: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class BaseRunEvent(BaseModel):
    """Shared append-only event envelope visible through polling and SSE."""

    id: str | None = None
    run_id: str
    created_at: datetime = Field(default_factory=utc_now)

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


class RunStartedEvent(BaseRunEvent):
    """Run lifecycle event emitted before runtime execution starts."""

    type: Literal["run_started"] = "run_started"
    data: EmptyRunEventData = Field(default_factory=EmptyRunEventData)


class PydanticAIStreamRunEvent(BaseRunEvent):
    """Pydantic AI stream event using the upstream typed event model."""

    type: Literal["pydantic_ai_event"] = "pydantic_ai_event"
    data: AgentStreamEvent


class RunSucceededEvent(BaseRunEvent):
    """Terminal success event carrying the complete successful run result."""

    type: Literal["run_succeeded"] = "run_succeeded"
    data: RunSucceededEventData


class RunFailedEvent(BaseRunEvent):
    """Terminal failure event emitted before the run status becomes failed."""

    type: Literal["run_failed"] = "run_failed"
    data: RunFailedEventData


class RunPausedEvent(BaseRunEvent):
    """Resumable pause event emitted when a run waits for outside input."""

    type: Literal["run_paused"] = "run_paused"
    data: RunPausedEventData


class RunCancelledEvent(BaseRunEvent):
    """Terminal cancellation event emitted after an explicit cancel request."""

    type: Literal["run_cancelled"] = "run_cancelled"
    data: RunCancelledEventData = Field(default_factory=RunCancelledEventData)


RunEvent: TypeAlias = Annotated[
    RunStartedEvent
    | PydanticAIStreamRunEvent
    | RunPausedEvent
    | RunSucceededEvent
    | RunFailedEvent
    | RunCancelledEvent,
    Field(discriminator="type"),
]
RUN_EVENT_ADAPTER: TypeAdapter[RunEvent] = TypeAdapter(RunEvent)


class RunEventsResponse(BaseModel):
    """Cursor-paginated event log response."""

    run_id: str
    events: list[RunEvent]
    next_cursor: str | None = None

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = [
    "BaseRunEvent",
    "SandboxFileEntry",
    "SandboxListFilesRequest",
    "SandboxListResult",
    "SandboxLocator",
    "SandboxReadEncoding",
    "SandboxReadFileRequest",
    "SandboxReadResult",
    "SandboxUploadFileRequest",
    "SandboxUploadedFile",
    "SandboxUploadResult",
    "CancelRunRequest",
    "CancelRunResponse",
    "CreateRunRequest",
    "CreateRunResponse",
    "DIFY_AGENT_HISTORY_LAYER_ID",
    "DIFY_AGENT_MODEL_LAYER_ID",
    "DIFY_AGENT_OUTPUT_LAYER_ID",
    "EmptyRunEventData",
    "LayerExitSignals",
    "PydanticAIStreamRunEvent",
    "RUN_EVENT_ADAPTER",
    "RunCancelledEvent",
    "RunCancelledEventData",
    "RunComposition",
    "RunEvent",
    "RunEventType",
    "RunEventsResponse",
    "RunFailedEvent",
    "RunFailedEventData",
    "RunPausedEvent",
    "RunPausedEventData",
    "RunPurpose",
    "RunStartedEvent",
    "RunStatus",
    "RunStatusResponse",
    "RunSucceededEvent",
    "RunSucceededEventData",
    "RunLayerSpec",
    "build_sandbox_locator_from_run_request",
    "normalize_composition",
    "utc_now",
]
