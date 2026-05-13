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
by ``DIFY_AGENT_MODEL_LAYER_ID`` and the optional structured output layer named
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
from agenton.layers import ExitIntent


DIFY_AGENT_MODEL_LAYER_ID: Final[str] = "llm"
DIFY_AGENT_OUTPUT_LAYER_ID: Final[str] = "output"
RunStatus = Literal["running", "succeeded", "failed"]
RunEventType = Literal[
    "run_started",
    "pydantic_ai_event",
    "run_succeeded",
    "run_failed",
]


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
    named by ``DIFY_AGENT_MODEL_LAYER_ID``. Structured output may be supplied
    through the optional composition layer named by
    ``DIFY_AGENT_OUTPUT_LAYER_ID``. ``on_exit`` defaults every active layer to
    suspend so callers receive a resumable success snapshot unless they
    explicitly request delete for one or more layers. Session snapshots do not
    preserve output-layer config, so resume requests that rely on structured
    output must include the same ``output`` layer in ``composition.layers[]`` to
    keep snapshot compatibility and rebuild the output schema.
    """

    composition: RunComposition
    session_snapshot: CompositorSessionSnapshot | None = None
    on_exit: LayerExitSignals = Field(default_factory=LayerExitSignals)

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


class CreateRunResponse(BaseModel):
    """Response returned after a run has been persisted and scheduled locally."""

    run_id: str
    status: RunStatus

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


RunEvent: TypeAlias = Annotated[
    RunStartedEvent | PydanticAIStreamRunEvent | RunSucceededEvent | RunFailedEvent,
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
    "CreateRunRequest",
    "CreateRunResponse",
    "DIFY_AGENT_MODEL_LAYER_ID",
    "DIFY_AGENT_OUTPUT_LAYER_ID",
    "EmptyRunEventData",
    "LayerExitSignals",
    "PydanticAIStreamRunEvent",
    "RUN_EVENT_ADAPTER",
    "RunComposition",
    "RunEvent",
    "RunEventType",
    "RunEventsResponse",
    "RunFailedEvent",
    "RunFailedEventData",
    "RunStartedEvent",
    "RunStatus",
    "RunStatusResponse",
    "RunSucceededEvent",
    "RunSucceededEventData",
    "RunLayerSpec",
    "normalize_composition",
    "utc_now",
]
