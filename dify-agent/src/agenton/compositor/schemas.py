"""Serializable compositor DTOs and external boundary validation.

Graph config and session snapshots are separate boundaries on purpose. Graph
config describes only reusable composition state: schema version, ordered node
names, provider type ids, dependency mappings, and metadata. Session snapshots
carry only ordered layer lifecycle state plus serializable ``runtime_state``.

External DTOs are revalidated even when callers pass an already-constructed
Pydantic model instance. These models are mutable, so dumping and validating
again prevents post-construction mutations from bypassing compositor entry
validators. ``LifecycleState.ACTIVE`` remains internal-only and is rejected in
external session snapshots.
"""

from collections.abc import Mapping

from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator

from agenton.layers.base import LifecycleState

type _ConfigModelValue[ModelT: BaseModel] = ModelT | JsonValue | str | bytes


def _validate_config_model_input[ModelT: BaseModel](
    model_type: type[ModelT],
    value: _ConfigModelValue[ModelT] | Mapping[str, object],
) -> ModelT:
    """Validate an external DTO boundary, including existing model instances.

    Pydantic models in this package are generally mutable and do not all enable
    assignment validation. Revalidating existing instances through their dumped
    data prevents post-construction mutations from bypassing config or snapshot
    validators at compositor entry boundaries.
    """
    if isinstance(value, BaseModel):
        return model_type.model_validate(value.model_dump(mode="python", warnings=False))
    if isinstance(value, str | bytes):
        return model_type.model_validate_json(value)

    return model_type.model_validate(value)


class LayerNodeConfig(BaseModel):
    """Serializable config for one provider-backed layer graph node.

    Nodes intentionally contain no runtime state and no per-call layer config.
    Runtime state belongs to session snapshots; layer config belongs to
    ``Compositor.enter(configs=...)`` keyed by node name.
    """

    name: str
    type: str
    deps: Mapping[str, str] = Field(default_factory=dict)
    metadata: Mapping[str, JsonValue] = Field(default_factory=dict)

    model_config = ConfigDict(extra="forbid")


class CompositorConfig(BaseModel):
    """Serializable config for constructing a reusable compositor graph plan."""

    schema_version: int = 1
    layers: list[LayerNodeConfig]

    model_config = ConfigDict(extra="forbid")


type CompositorConfigValue = _ConfigModelValue[CompositorConfig] | Mapping[str, object]


def _validate_compositor_config_input(value: CompositorConfigValue) -> CompositorConfig:
    """Validate external graph config input for ``Compositor.from_config``."""
    return _validate_config_model_input(CompositorConfig, value)


class LayerSessionSnapshot(BaseModel):
    """Serializable snapshot for one layer's state-only invocation data.

    ``runtime_state`` is the only snapshotted mutable layer data. ``ACTIVE`` is
    rejected here because a running layer cannot be represented safely outside
    the active compositor entry.
    """

    name: str
    lifecycle_state: LifecycleState
    runtime_state: dict[str, JsonValue]

    model_config = ConfigDict(extra="forbid")

    @field_validator("lifecycle_state")
    @classmethod
    def _reject_active_lifecycle(cls, value: LifecycleState) -> LifecycleState:
        if value is LifecycleState.ACTIVE:
            raise ValueError("LifecycleState.ACTIVE is internal-only and cannot appear in session snapshots.")
        return value


class CompositorSessionSnapshot(BaseModel):
    """Serializable compositor session snapshot.

    Snapshots include ordered layer lifecycle state and serializable runtime
    state only. Live resources, handles, dependencies, prompts, tools, and
    config are outside Agenton snapshots and are never captured here.
    """

    schema_version: int = 1
    layers: list[LayerSessionSnapshot]

    model_config = ConfigDict(extra="forbid")


type CompositorSessionSnapshotValue = _ConfigModelValue[CompositorSessionSnapshot] | Mapping[str, object]
