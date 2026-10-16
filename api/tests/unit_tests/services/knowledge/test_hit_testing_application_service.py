import json
from unittest.mock import Mock, create_autospec

import pytest

from machinery.context import RequestContext
from services.errors.dataset import DatasetAccessDeniedError, DatasetNotFoundError
from services.errors.knowledge_retrieval import HitTestingFailedError, HitTestingInvocationError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.entities.hit_testing import HitTestingQueryRecorder, HitTestingRequest, HitTestingResult
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.hit_testing.application import (
    HitTestingApplicationService,
    HitTestingRetrieval,
)

CONTEXT = RequestContext("request", None, "actor", "tenant")


@pytest.fixture
def access() -> Mock:
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.require_accessible.return_value = AccessibleDataset("dataset", "tenant")
    return access


@pytest.fixture
def retrieval() -> Mock:
    return create_autospec(HitTestingRetrieval, instance=True, spec_set=True)


@pytest.fixture
def queries() -> Mock:
    return create_autospec(HitTestingQueryRecorder, instance=True, spec_set=True)


@pytest.fixture
def service(access: Mock, retrieval: Mock, queries: Mock) -> HitTestingApplicationService:
    return HitTestingApplicationService(dataset_access=access, retrieval=retrieval, queries=queries)


def test_permission_precedes_input_validation(
    service: HitTestingApplicationService, access: Mock, retrieval: Mock
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        service.hit_testing(CONTEXT, dataset_id="dataset", request=HitTestingRequest("", None, None))
    retrieval.retrieve.assert_not_called()


@pytest.mark.parametrize("query", ["", "x" * 251])
def test_invalid_input_skips_retrieval(service: HitTestingApplicationService, retrieval: Mock, query: str) -> None:
    with pytest.raises(ValueError):
        service.hit_testing(CONTEXT, dataset_id="dataset", request=HitTestingRequest(query, None, None))
    retrieval.retrieve.assert_not_called()


def test_attachment_only_query_is_valid_and_uses_owned_reference(
    service: HitTestingApplicationService, retrieval: Mock, queries: Mock
) -> None:
    request = HitTestingRequest("", None, ["upload"])
    retrieval.retrieve.return_value = HitTestingResult({"query": {"content": ""}, "records": []}, True)
    assert service.hit_testing(CONTEXT, dataset_id="dataset", request=request)["records"] == []
    retrieval.retrieve.assert_called_once_with(DatasetRef("tenant", "dataset"), request)
    context, ref, content = queries.record_hit_testing_query.call_args.args
    assert context == CONTEXT
    assert ref == DatasetRef("tenant", "dataset")
    assert json.loads(content) == [{"content_type": "image_query", "content": "upload"}]


def test_unexpected_failure_is_framework_neutral(
    service: HitTestingApplicationService, retrieval: Mock, queries: Mock
) -> None:
    retrieval.retrieve.side_effect = RuntimeError("unavailable")
    with pytest.raises(HitTestingFailedError, match="unavailable"):
        service.hit_testing(CONTEXT, dataset_id="dataset", request=HitTestingRequest("query", None, None))
    queries.record_hit_testing_query.assert_not_called()


def test_empty_metadata_match_skips_history(
    service: HitTestingApplicationService, retrieval: Mock, queries: Mock
) -> None:
    retrieval.retrieve.return_value = HitTestingResult({"query": {"content": "query"}, "records": []}, False)
    assert (
        service.hit_testing(CONTEXT, dataset_id="dataset", request=HitTestingRequest("query", None, None))["records"]
        == []
    )
    queries.record_hit_testing_query.assert_not_called()


@pytest.mark.parametrize(
    "error",
    [
        DatasetNotFoundError(),
        DatasetAccessDeniedError(),
        ValueError("invalid"),
        HitTestingInvocationError("unavailable"),
    ],
)
def test_domain_failure_preserves_http_mapping_and_skips_history(
    service: HitTestingApplicationService, retrieval: Mock, queries: Mock, error: Exception
) -> None:
    retrieval.retrieve.side_effect = error
    with pytest.raises(type(error)) as failure:
        service.hit_testing(CONTEXT, dataset_id="dataset", request=HitTestingRequest("query", None, None))
    assert failure.value is error
    queries.record_hit_testing_query.assert_not_called()
