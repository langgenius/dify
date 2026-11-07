"""Lock the framework-neutral error boundary used by both hit-testing controllers."""

from dataclasses import dataclass, field

import pytest

from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from machinery.context import RequestContext
from services.errors.index import IndexNotInitializedError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessSnapshot
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.hit_testing.application import HitTestingApplicationService
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResult
from services.knowledge.hit_testing.errors import HitTestingFailedError

CONTEXT = RequestContext("request", None, "actor", "tenant")
REQUEST = HitTestingRequest("query", None, None, None)


class _DatasetAccess:
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        assert context is CONTEXT
        assert dataset_id == "dataset"
        return AccessibleDataset("dataset", "tenant")

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        del context, snapshot
        raise AssertionError("hit testing must resolve access by dataset ID")


@dataclass(slots=True)
class _RaisingRetrieval:
    error: Exception

    def retrieve(self, context: RequestContext, ref: DatasetRef, request: HitTestingRequest) -> HitTestingResult:
        assert context is CONTEXT
        assert ref == DatasetRef("tenant", "dataset")
        assert request is REQUEST
        raise self.error


@dataclass(slots=True)
class _QueryRecorder:
    calls: list[tuple[str, DatasetRef, str]] = field(default_factory=list)

    def record_hit_testing_query(self, actor_id: str, ref: DatasetRef, content: str) -> None:
        self.calls.append((actor_id, ref, content))


@pytest.mark.parametrize(
    "error",
    [
        ProviderTokenNotInitError("missing token"),
        QuotaExceededError("quota"),
        ModelCurrentlyNotSupportError("unsupported"),
        LLMBadRequestError("bad request"),
        IndexNotInitializedError("not initialized"),
    ],
    ids=lambda error: type(error).__name__,
)
def test_http_mapped_value_errors_preserve_identity_and_skip_query_history(error: Exception) -> None:
    queries = _QueryRecorder()
    service = HitTestingApplicationService(
        dataset_access=_DatasetAccess(),
        retrieval=_RaisingRetrieval(error),
        queries=queries,
    )

    with pytest.raises(type(error)) as failure:
        service.retrieve(CONTEXT, dataset_id="dataset", request=REQUEST)

    assert failure.value is error
    assert queries.calls == []


def test_unexpected_error_is_wrapped_and_skips_query_history() -> None:
    error = RuntimeError("unavailable")
    queries = _QueryRecorder()
    service = HitTestingApplicationService(
        dataset_access=_DatasetAccess(),
        retrieval=_RaisingRetrieval(error),
        queries=queries,
    )

    with pytest.raises(HitTestingFailedError, match="unavailable") as failure:
        service.retrieve(CONTEXT, dataset_id="dataset", request=REQUEST)

    assert failure.value.__cause__ is error
    assert queries.calls == []
