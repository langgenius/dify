"""Typed fakes shared by the KnowledgeFS task, command and extension unit tests."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, TypeVar, cast

from celery.exceptions import Retry

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
from services.knowledge_fs.retrieval_contracts import KnowledgeFSPublicErrorCode, KnowledgeFSPublicFailureResponse

_PayloadT = TypeVar("_PayloadT")


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

    def payload(self, method: str, payload_type: type[_PayloadT]) -> _PayloadT:
        """Return the ``payload`` keyword of the most recent call to ``method``, checked against ``payload_type``."""
        payload = self.calls[method][-1]["payload"]
        assert isinstance(payload, payload_type), f"{method} payload is {type(payload).__name__}"
        return payload

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


def json_object(value: object) -> dict[str, object]:
    """Narrow recorded JSON metadata, or an object nested in it, to a string-keyed dict."""
    assert isinstance(value, dict), f"expected a JSON object, got {type(value).__name__}"
    return cast(dict[str, object], value)


@dataclass(frozen=True)
class FacadeRuntime:
    """The ``KnowledgeFSRuntime`` member the source tasks read."""

    facade: RecordingKnowledgeFSFacade


# Every response has all required fields. Failure text stays raw so callers
# can test the downstream redaction boundary.
_RESPONSE_TIME = datetime(2026, 1, 1, tzinfo=UTC)


def source_response(
    *,
    metadata: dict[str, object],
    status: Literal["active", "disabled", "error", "syncing"],
    version: int,
    source_id: str = "source-1",
    connection_id: str | None = None,
) -> KnowledgeFSSourceResponse:
    """Given typed source values, return a complete validated source without I/O."""
    return KnowledgeFSSourceResponse(
        id=source_id,
        connection_id=connection_id,
        created_at=_RESPONSE_TIME,
        updated_at=_RESPONSE_TIME,
        knowledge_space_id="knowledge-space-1",
        name="Test source",
        permission_scope=[],
        type="web",
        uri="https://example.com",
        metadata=metadata,
        status=status,
        version=version,
    )


def source_list_response(
    *sources: KnowledgeFSSourceResponse, next_cursor: str | None = None
) -> KnowledgeFSSourceListResponse:
    """Given complete source DTOs, return their validated page without I/O."""
    return KnowledgeFSSourceListResponse(data=list(sources), next_cursor=next_cursor)


def source_workflow_response(
    *,
    workflow_id: str,
    state: str,
    source_id: str | None = None,
    failure_message: str | None = None,
    last_error_code: KnowledgeFSPublicErrorCode | None = None,
) -> KnowledgeFSSourceWorkflowResponse:
    """Given workflow values, return a complete DTO with raw failure text and no I/O.

    The caller supplies a public error code. Failure text is kept unchanged so
    downstream redaction remains observable. All required fields are present.
    """
    failure = (
        None
        if failure_message is None
        else KnowledgeFSPublicFailureResponse.model_construct(
            message=failure_message,
            code=last_error_code or "SOURCE_WORKFLOW_FAILED",
            category="dependency",
            retry_policy="manual",
        )
    )
    return KnowledgeFSSourceWorkflowResponse.model_construct(
        id=workflow_id,
        checkpoint="pending",
        created_at=_RESPONSE_TIME,
        updated_at=_RESPONSE_TIME,
        knowledge_space_id="knowledge-space-1",
        kind="source-import",
        execution_attempts=0,
        max_execution_attempts=3,
        progress_completed=0,
        progress_failed=0,
        progress_skipped=0,
        state=state,
        source_id=source_id,
        failure=failure,
        last_error_code=last_error_code,
    )


def sync_policy_response(*, revision: int) -> KnowledgeFSSourceSyncPolicyResponse:
    """Given a positive revision, return a complete manual sync policy without I/O."""
    return KnowledgeFSSourceSyncPolicyResponse(
        created_at=_RESPONSE_TIME,
        updated_at=_RESPONSE_TIME,
        enabled=False,
        expected_source_version=1,
        id="policy-1",
        knowledge_space_id="knowledge-space-1",
        mode="manual",
        revision=revision,
        source_id="source-1",
    )


def source_provider_list_response(*available_provider_ids: str) -> KnowledgeFSSourceProviderListResponse:
    """Given provider IDs, return complete available provider DTOs without I/O."""
    return KnowledgeFSSourceProviderListResponse(
        data=[
            KnowledgeFSSourceProviderResponse(
                id=provider_id,
                available=True,
                auth_kinds=["api-key"],
                capabilities=[],
                configuration=[],
                display_name=provider_id,
            )
            for provider_id in available_provider_ids
        ]
    )


def source_connection_response(
    *,
    connection_id: str,
    provider_id: str,
    status: Literal["provisioning", "active", "expired", "error", "revoked"],
    configuration: dict[str, bool | int | str] | None = None,
) -> KnowledgeFSSourceConnectionResponse:
    """Given typed connection values, return a complete validated connection without I/O."""
    return KnowledgeFSSourceConnectionResponse(
        id=connection_id,
        auth_kind="api-key",
        created_at=_RESPONSE_TIME,
        updated_at=_RESPONSE_TIME,
        knowledge_space_id="knowledge-space-1",
        name="Test connection",
        scopes=[],
        version=1,
        provider_id=provider_id,
        status=status,
        configuration=configuration or {},
    )


def source_connection_list_response(
    *connections: KnowledgeFSSourceConnectionResponse, next_cursor: str | None = None
) -> KnowledgeFSSourceConnectionListResponse:
    """Given complete connection DTOs, return their validated page without I/O."""
    return KnowledgeFSSourceConnectionListResponse(data=list(connections), next_cursor=next_cursor)
