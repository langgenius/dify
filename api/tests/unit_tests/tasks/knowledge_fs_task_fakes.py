"""Typed fakes shared by the KnowledgeFS task, command and extension unit tests."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from celery.exceptions import Retry

from core.knowledge_fs.retrieval_contracts import KnowledgeFSPublicFailureResponse
from services.knowledge_fs.observability import (
    KnowledgeFSBatchStatusMetric,
    KnowledgeFSCapabilityIssuanceMetric,
    KnowledgeFSControlSpaceStateMetric,
    KnowledgeFSLifecycleTaskMetric,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSSourceConnectionListResponse,
    KnowledgeFSSourceConnectionResponse,
    KnowledgeFSSourceListResponse,
    KnowledgeFSSourceProviderListResponse,
    KnowledgeFSSourceProviderResponse,
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceSyncPolicyResponse,
    KnowledgeFSSourceWorkflowResponse,
)


@dataclass
class RecordingKnowledgeFSMetrics:
    """In-memory ``KnowledgeFSOperationalMetricsPort`` that records every event."""

    batch_statuses: list[KnowledgeFSBatchStatusMetric] = field(default_factory=list)
    capability_issuances: list[KnowledgeFSCapabilityIssuanceMetric] = field(default_factory=list)
    control_space_states: list[KnowledgeFSControlSpaceStateMetric] = field(default_factory=list)
    lifecycle_tasks: list[KnowledgeFSLifecycleTaskMetric] = field(default_factory=list)
    gauge_readers: list[Callable[[], Mapping[str, int]]] = field(default_factory=list)
    gauge_registration_error: Exception | None = None

    def record_batch_status(self, event: KnowledgeFSBatchStatusMetric) -> None:
        self.batch_statuses.append(event)

    def record_capability_issuance(self, event: KnowledgeFSCapabilityIssuanceMetric) -> None:
        self.capability_issuances.append(event)

    def record_control_space_state(self, event: KnowledgeFSControlSpaceStateMetric) -> None:
        self.control_space_states.append(event)

    def record_lifecycle_task(self, event: KnowledgeFSLifecycleTaskMetric) -> None:
        self.lifecycle_tasks.append(event)

    def register_control_space_state_gauge(self, read_counts: Callable[[], Mapping[str, int]]) -> None:
        if self.gauge_registration_error is not None:
            raise self.gauge_registration_error
        self.gauge_readers.append(read_counts)


@dataclass
class RecordingRetry:
    """Stand-in for a bound Celery ``Task.retry`` that records its keyword arguments."""

    error: BaseException = field(default_factory=Retry)
    calls: list[dict[str, object]] = field(default_factory=list)

    def __call__(self, **kwargs: object) -> Retry:
        self.calls.append(kwargs)
        raise self.error


class RecordingKnowledgeFSFacade:
    """Source-facing subset of ``KnowledgeFSDataFacade`` with scripted responses.

    ``script`` sets what a method returns. With several results they are consumed
    in order and the last one repeats; an exception result is raised. Calling a
    method that was never scripted fails the test instead of returning a dummy.
    """

    def __init__(self) -> None:
        self.calls: dict[str, list[dict[str, object]]] = {}
        self._results: dict[str, list[object]] = {}

    def script(self, method: str, *results: object) -> None:
        self._results[method] = list(results)

    def call_count(self, method: str) -> int:
        return len(self.calls.get(method, []))

    def payload(self, method: str) -> object:
        """Return the ``payload`` keyword of the most recent call to ``method``."""
        return self.calls[method][-1]["payload"]

    def _respond(self, method: str, kwargs: dict[str, object]) -> object:
        self.calls.setdefault(method, []).append(kwargs)
        results = self._results.get(method)
        if not results:
            raise AssertionError(f"unexpected KnowledgeFS facade call: {method}")
        result = results.pop(0) if len(results) > 1 else results[0]
        if isinstance(result, BaseException):
            raise result
        return result

    def list_sources(self, **kwargs: object) -> object:
        return self._respond("list_sources", kwargs)

    def get_source(self, **kwargs: object) -> object:
        return self._respond("get_source", kwargs)

    def create_source(self, **kwargs: object) -> object:
        return self._respond("create_source", kwargs)

    def update_source(self, **kwargs: object) -> object:
        return self._respond("update_source", kwargs)

    def list_source_providers(self, **kwargs: object) -> object:
        return self._respond("list_source_providers", kwargs)

    def list_source_connections(self, **kwargs: object) -> object:
        return self._respond("list_source_connections", kwargs)

    def create_source_connection(self, **kwargs: object) -> object:
        return self._respond("create_source_connection", kwargs)

    def import_selected_source_crawl(self, **kwargs: object) -> object:
        return self._respond("import_selected_source_crawl", kwargs)

    def import_source_workflow(self, **kwargs: object) -> object:
        return self._respond("import_source_workflow", kwargs)

    def consume_namespace_source_preview(self, **kwargs: object) -> object:
        return self._respond("consume_namespace_source_preview", kwargs)

    def get_source_workflow(self, **kwargs: object) -> object:
        return self._respond("get_source_workflow", kwargs)

    def get_source_sync_policy(self, **kwargs: object) -> object:
        return self._respond("get_source_sync_policy", kwargs)

    def update_source_sync_policy(self, **kwargs: object) -> object:
        return self._respond("update_source_sync_policy", kwargs)


@dataclass(frozen=True)
class FacadeRuntime:
    """The ``KnowledgeFSRuntime`` member the source tasks read."""

    facade: RecordingKnowledgeFSFacade


# Response builders construct real DTOs with only the fields a test exercises.
# ``model_construct`` keeps arbitrary remote error codes and messages verbatim.


def source_response(
    *,
    metadata: dict[str, object],
    status: str,
    version: int,
    source_id: str = "source-1",
    connection_id: str | None = None,
) -> KnowledgeFSSourceResponse:
    return KnowledgeFSSourceResponse.model_construct(
        id=source_id,
        connection_id=connection_id,
        metadata=metadata,
        status=status,
        version=version,
    )


def source_list_response(
    *sources: KnowledgeFSSourceResponse, next_cursor: str | None = None
) -> KnowledgeFSSourceListResponse:
    return KnowledgeFSSourceListResponse.model_construct(data=list(sources), next_cursor=next_cursor)


def source_workflow_response(
    *,
    workflow_id: str,
    state: str,
    source_id: str | None = None,
    failure_message: str | None = None,
    last_error_code: str | None = None,
) -> KnowledgeFSSourceWorkflowResponse:
    failure = (
        None if failure_message is None else KnowledgeFSPublicFailureResponse.model_construct(message=failure_message)
    )
    return KnowledgeFSSourceWorkflowResponse.model_construct(
        id=workflow_id,
        state=state,
        source_id=source_id,
        failure=failure,
        last_error_code=last_error_code,
    )


def sync_policy_response(*, revision: int) -> KnowledgeFSSourceSyncPolicyResponse:
    return KnowledgeFSSourceSyncPolicyResponse.model_construct(revision=revision)


def source_provider_list_response(*available_provider_ids: str) -> KnowledgeFSSourceProviderListResponse:
    return KnowledgeFSSourceProviderListResponse.model_construct(
        data=[
            KnowledgeFSSourceProviderResponse.model_construct(id=provider_id, available=True)
            for provider_id in available_provider_ids
        ]
    )


def source_connection_response(
    *,
    connection_id: str,
    provider_id: str,
    status: str,
    configuration: dict[str, bool | int | str] | None = None,
) -> KnowledgeFSSourceConnectionResponse:
    return KnowledgeFSSourceConnectionResponse.model_construct(
        id=connection_id,
        provider_id=provider_id,
        status=status,
        configuration=configuration or {},
    )


def source_connection_list_response(
    *connections: KnowledgeFSSourceConnectionResponse, next_cursor: str | None = None
) -> KnowledgeFSSourceConnectionListResponse:
    return KnowledgeFSSourceConnectionListResponse.model_construct(data=list(connections), next_cursor=next_cursor)
