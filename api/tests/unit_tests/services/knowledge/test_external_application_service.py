from collections.abc import Callable
from unittest.mock import Mock, create_autospec

import pytest

from machinery.context import RequestContext
from services.errors.dataset import DatasetAccessDeniedError
from services.errors.knowledge_retrieval import ExternalHitTestingError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess
from services.knowledge.entities.external import ExternalKnowledgeRetrievalRequest
from services.knowledge.entities.hit_testing import HitTestingQueryRecorder
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.external.application import (
    ExternalDatasetDetails,
    ExternalKnowledgeApplicationService,
    ExternalKnowledgeRepository,
    ExternalKnowledgeRetrieval,
)

CONTEXT = RequestContext("request", None, "actor", "tenant")


@pytest.fixture
def repository() -> Mock:
    return create_autospec(ExternalKnowledgeRepository, instance=True, spec_set=True)


@pytest.fixture
def access() -> Mock:
    result = create_autospec(DatasetAccess, instance=True, spec_set=True)
    result.require_accessible.return_value = AccessibleDataset("dataset", "tenant")
    return result


@pytest.fixture
def retrieval() -> Mock:
    return create_autospec(ExternalKnowledgeRetrieval, instance=True, spec_set=True)


@pytest.fixture
def queries() -> Mock:
    return create_autospec(HitTestingQueryRecorder, instance=True, spec_set=True)


@pytest.fixture
def dataset_details():
    return create_autospec(ExternalDatasetDetails, instance=True, spec_set=True)


@pytest.fixture
def sync_access():
    from services.knowledge.external.adapters import sync_external_dataset_creator_access

    return create_autospec(sync_external_dataset_creator_access, spec_set=True)


@pytest.fixture
def service(
    repository: Mock, access: Mock, retrieval: Mock, queries: Mock, dataset_details: Mock, sync_access: Mock
) -> ExternalKnowledgeApplicationService:
    return ExternalKnowledgeApplicationService(
        dataset_access=access,
        repository=repository,
        retrieval=retrieval,
        queries=queries,
        dataset_details=dataset_details,
        sync_creator_access=sync_access,
    )


@pytest.mark.parametrize("settings", [{}, {"endpoint": "https://example"}, {"api_key": "secret"}])
@pytest.mark.parametrize(
    "method", [ExternalKnowledgeApplicationService.create_template, ExternalKnowledgeApplicationService.update_template]
)
def test_template_validation_prevents_io(
    service: ExternalKnowledgeApplicationService,
    repository: Mock,
    settings: dict[str, str],
    method: Callable[..., object],
) -> None:
    extra: dict[str, str] = (
        {"template_id": "template"} if method is ExternalKnowledgeApplicationService.update_template else {}
    )
    with pytest.raises(ValueError):
        method(service, CONTEXT, name="API", settings=settings, **extra)
    assert repository.mock_calls == []


def test_retrieval_authorization_precedes_validation_and_network(
    service: ExternalKnowledgeApplicationService, access: Mock, repository: Mock
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        service.hit_testing(CONTEXT, dataset_id="dataset", query="", retrieval_model=None, metadata_filters=None)
    assert repository.mock_calls == []


@pytest.mark.parametrize("query", ["", "a" * 251])
def test_invalid_query_prevents_retrieval(
    service: ExternalKnowledgeApplicationService, repository: Mock, query: str
) -> None:
    with pytest.raises(ValueError):
        service.hit_testing(CONTEXT, dataset_id="dataset", query=query, retrieval_model=None, metadata_filters=None)
    repository.prepare_retrieval.assert_not_called()


def test_retrieval_failure_is_neutral_and_receives_owned_ref(
    service: ExternalKnowledgeApplicationService, repository: Mock
) -> None:
    repository.prepare_retrieval.side_effect = RuntimeError("unavailable")
    with pytest.raises(ExternalHitTestingError, match="unavailable"):
        service.hit_testing(
            CONTEXT, dataset_id="dataset", query="query", retrieval_model={"top_k": 2}, metadata_filters=None
        )
    repository.prepare_retrieval.assert_called_once_with(
        DatasetRef("tenant", "dataset"), query="query", retrieval_model={"top_k": 2}, metadata_filters=None
    )


def test_template_probe_precedes_persistence(service, repository, retrieval):
    retrieval.check_settings.side_effect = ValueError("unreachable")
    with pytest.raises(ValueError, match="unreachable"):
        service.create_template(CONTEXT, name="API", settings={"endpoint": "https://example", "api_key": "secret"})
    repository.create_template.assert_not_called()


def test_failed_network_does_not_record_query(service, repository, retrieval, queries):
    repository.prepare_retrieval.return_value = ExternalKnowledgeRetrievalRequest(
        "https://example", "key", "knowledge", "query", {}, None
    )
    retrieval.retrieve.side_effect = RuntimeError("unreachable")
    with pytest.raises(ExternalHitTestingError, match="unreachable"):
        service.hit_testing(CONTEXT, dataset_id="dataset", query="query", retrieval_model=None, metadata_filters=None)
    queries.record_hit_testing_query.assert_not_called()


def test_non_external_dataset_skips_network_and_history(service, repository, retrieval, queries):
    repository.prepare_retrieval.return_value = None
    assert service.hit_testing(
        CONTEXT, dataset_id="dataset", query="query", retrieval_model=None, metadata_filters=None
    ) == {"query": {"content": "query"}, "records": []}
    retrieval.retrieve.assert_not_called()
    queries.record_hit_testing_query.assert_not_called()


def test_external_dataset_creation_commits_before_access_sync_and_detail(
    service, repository, dataset_details, sync_access
):
    from services.knowledge.entities.external import ExternalDatasetCreatePayload

    payload = ExternalDatasetCreatePayload(
        name="Dataset", external_knowledge_api_id="api", external_knowledge_id="knowledge"
    )
    ref = DatasetRef("tenant", "dataset")
    repository.create_dataset.return_value = ref
    events = []
    repository.create_dataset.side_effect = lambda *_args: events.append("persist") or ref
    sync_access.side_effect = lambda *_args: events.append("access")
    dataset_details.get_dataset.side_effect = lambda *_args: events.append("detail") or {"id": "dataset"}
    assert service.create_dataset(CONTEXT, payload=payload) == {"id": "dataset"}
    assert events == ["persist", "access", "detail"]
    sync_access.assert_called_once_with(CONTEXT, ref)
    dataset_details.get_dataset.assert_called_once_with(CONTEXT, ref)
