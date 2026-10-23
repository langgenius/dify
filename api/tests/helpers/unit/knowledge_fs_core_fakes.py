"""Small typed test fakes shared by the knowledge-fs core/service unit tests.

They replace generic mock doubles with plain objects that record calls in lists.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from graphon.model_runtime.entities.common_entities import I18nObject
from graphon.model_runtime.entities.model_entities import AIModelEntity, FetchFrom, ModelFeature, ModelType
from services.knowledge_fs.observability import (
    KnowledgeFSBatchStatusMetric,
    KnowledgeFSCapabilityIssuanceMetric,
    KnowledgeFSControlSpaceStateMetric,
    KnowledgeFSLifecycleTaskMetric,
)


@dataclass(frozen=True)
class RecordedCall:
    args: tuple[object, ...]
    kwargs: dict[str, object]


@dataclass
class RecordingCallable:
    """A callable that records each invocation and returns or raises a configured result."""

    return_value: object = None
    side_effect: BaseException | Callable[..., object] | None = None
    name: str = ""
    calls: list[RecordedCall] = field(default_factory=list)

    def __call__(self, *args: object, **kwargs: object) -> object:
        self.calls.append(RecordedCall(args=args, kwargs=kwargs))
        if isinstance(self.side_effect, BaseException):
            raise self.side_effect
        if self.side_effect is not None:
            return self.side_effect(*args, **kwargs)
        return self.return_value

    @property
    def call_count(self) -> int:
        return len(self.calls)

    @property
    def last_call(self) -> RecordedCall:
        assert self.calls, f"{self.name or 'callable'} was not called"
        return self.calls[-1]

    def assert_called_once_with(self, *args: object, **kwargs: object) -> None:
        assert self.calls == [RecordedCall(args=args, kwargs=kwargs)], self.calls

    def assert_not_called(self) -> None:
        assert self.calls == [], self.calls


@dataclass(frozen=True)
class Marker:
    """An opaque, identity-comparable stand-in for a collaborator nobody inspects."""

    label: str


@dataclass(frozen=True)
class FakeCapabilityClaims:
    """The subset of signed Capability v2 claims that brokers read back after issuance."""

    exp: int
    iat: int = 0


@dataclass(frozen=True)
class FakeIssuedCapability:
    token: str
    claims: FakeCapabilityClaims


@dataclass
class RecordingOperationalMetrics:
    """KnowledgeFS operational metrics port that keeps every emitted event in order."""

    batch_statuses: list[KnowledgeFSBatchStatusMetric] = field(default_factory=list)
    capability_issuances: list[KnowledgeFSCapabilityIssuanceMetric] = field(default_factory=list)
    control_space_states: list[KnowledgeFSControlSpaceStateMetric] = field(default_factory=list)
    lifecycle_tasks: list[KnowledgeFSLifecycleTaskMetric] = field(default_factory=list)
    gauge_readers: list[Callable[[], Mapping[str, int]]] = field(default_factory=list)

    def record_batch_status(self, event: KnowledgeFSBatchStatusMetric) -> None:
        self.batch_statuses.append(event)

    def record_capability_issuance(self, event: KnowledgeFSCapabilityIssuanceMetric) -> None:
        self.capability_issuances.append(event)

    def record_control_space_state(self, event: KnowledgeFSControlSpaceStateMetric) -> None:
        self.control_space_states.append(event)

    def record_lifecycle_task(self, event: KnowledgeFSLifecycleTaskMetric) -> None:
        self.lifecycle_tasks.append(event)

    def register_control_space_state_gauge(self, read_counts: Callable[[], Mapping[str, int]]) -> None:
        self.gauge_readers.append(read_counts)


def llm_schema(*, features: list[ModelFeature]) -> AIModelEntity:
    return AIModelEntity(
        model="model",
        label=I18nObject(en_US="model"),
        model_type=ModelType.LLM,
        fetch_from=FetchFrom.PREDEFINED_MODEL,
        model_properties={},
        features=features,
    )


@dataclass
class SchemaModelInstance:
    schema: AIModelEntity

    def get_model_schema(self) -> AIModelEntity:
        return self.schema


@dataclass
class RecordingModelFactory:
    """Stands in for DifyModelFactory and records the constructor context and model lookups."""

    schema: AIModelEntity
    run_contexts: list[object] = field(default_factory=list)
    model_lookups: list[tuple[str, str]] = field(default_factory=list)

    def __call__(self, *, run_context: object) -> RecordingModelFactory:
        self.run_contexts.append(run_context)
        return self

    def init_model_instance(self, provider: str, model: str) -> SchemaModelInstance:
        self.model_lookups.append((provider, model))
        return SchemaModelInstance(self.schema)
