from dataclasses import dataclass, field

import pytest

from machinery.context import RequestContext
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessDeniedError, DatasetAccessSnapshot
from services.knowledge.hit_testing.application import HitTestingApplicationService
from services.knowledge.hit_testing.entities import HitTestingRequest, HitTestingResponse, HitTestingResult
from services.knowledge.hit_testing.errors import HitTestingFailedError, HitTestingUpstreamError
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request", None, "actor", "tenant")


@dataclass
class DatasetAccessStub:
    error: Exception | None = None
    calls: list[tuple[RequestContext, str]] = field(default_factory=list)

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        self.calls.append((context, dataset_id))
        if self.error is not None:
            raise self.error
        return AccessibleDataset(dataset_id, context.active_workspace_id)

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        raise AssertionError(f"unexpected snapshot access for {snapshot.dataset.id} by {context.account_id}")


def empty_hit_testing_response() -> HitTestingResponse:
    return {"query": {"content": "query"}, "records": []}


@dataclass
class RetrievalStub:
    response: HitTestingResponse = field(default_factory=empty_hit_testing_response)
    error: Exception | None = None
    calls: list[tuple[RequestContext, DatasetRef, HitTestingRequest]] = field(default_factory=list)

    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        request: HitTestingRequest,
    ) -> HitTestingResult:
        self.calls.append((context, ref, request))
        if self.error is not None:
            raise self.error
        return HitTestingResult(self.response, True)


@dataclass
class QueryRecorderStub:
    calls: list[tuple[RequestContext, DatasetRef, str]] = field(default_factory=list)

    def record_hit_testing_query(self, context: RequestContext, dataset_ref: DatasetRef, content: str) -> None:
        self.calls.append((context, dataset_ref, content))


def _request(query: str = "query", attachment_ids: list[str] | None = None) -> HitTestingRequest:
    return HitTestingRequest(query, None, None, attachment_ids)


def test_access_precedes_input_validation_and_retrieval() -> None:
    access = DatasetAccessStub(error=DatasetAccessDeniedError())
    retrieval = RetrievalStub()
    service = HitTestingApplicationService(dataset_access=access, retrieval=retrieval, queries=QueryRecorderStub())

    with pytest.raises(DatasetAccessDeniedError):
        service.retrieve(CONTEXT, dataset_id="dataset", request=_request(""))

    assert retrieval.calls == []


@pytest.mark.parametrize(
    ("hit_testing_request", "message"),
    [
        (_request(""), "Query or attachment_ids is required"),
        (_request("x" * 251), "Query cannot exceed 250 characters"),
    ],
)
def test_invalid_input_stops_before_retrieval(hit_testing_request: HitTestingRequest, message: str) -> None:
    retrieval = RetrievalStub()
    service = HitTestingApplicationService(
        dataset_access=DatasetAccessStub(), retrieval=retrieval, queries=QueryRecorderStub()
    )

    with pytest.raises(ValueError, match=message):
        service.retrieve(CONTEXT, dataset_id="dataset", request=hit_testing_request)

    assert retrieval.calls == []


def test_attachment_only_request_uses_the_owned_dataset_reference() -> None:
    retrieval = RetrievalStub(response={"query": {"content": ""}, "records": []})
    service = HitTestingApplicationService(
        dataset_access=DatasetAccessStub(), retrieval=retrieval, queries=QueryRecorderStub()
    )
    request = _request("", ["upload"])

    assert service.retrieve(CONTEXT, dataset_id="dataset", request=request) == retrieval.response
    assert retrieval.calls == [(CONTEXT, DatasetRef("tenant", "dataset"), request)]


def test_unexpected_gateway_failure_becomes_a_domain_failure() -> None:
    retrieval = RetrievalStub(error=RuntimeError("unavailable"))
    service = HitTestingApplicationService(
        dataset_access=DatasetAccessStub(), retrieval=retrieval, queries=QueryRecorderStub()
    )

    with pytest.raises(HitTestingFailedError, match="unavailable"):
        service.retrieve(CONTEXT, dataset_id="dataset", request=_request())


def test_external_provider_failure_becomes_an_upstream_domain_failure() -> None:
    retrieval = RetrievalStub(error=ExternalKnowledgeRetrievalError("provider unavailable"))
    service = HitTestingApplicationService(
        dataset_access=DatasetAccessStub(), retrieval=retrieval, queries=QueryRecorderStub()
    )

    with pytest.raises(HitTestingUpstreamError, match="provider unavailable"):
        service.retrieve(CONTEXT, dataset_id="dataset", request=_request())
