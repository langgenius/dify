from collections.abc import Callable
from dataclasses import dataclass, field
from unittest.mock import MagicMock, create_autospec

import pytest

from machinery.context import RequestContext
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalDatasetCreatePayload
from services.errors.dataset import DatasetNameDuplicateError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.external.application import (
    ExternalDatasetDetails,
    ExternalHitTestingError,
    ExternalKnowledgeApplicationService,
    ExternalKnowledgeRepository,
    ExternalKnowledgeRetrieval,
    ExternalTemplateNotFoundError,
)
from services.knowledge.hit_testing.entities import HitTestingQueryRecorder
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request", None, "actor", "tenant")


@dataclass
class _RecordingCreatorAccess:
    calls: list[tuple[RequestContext, DatasetRef]] = field(default_factory=list)
    events: list[str] | None = None

    def __call__(self, context: RequestContext, ref: DatasetRef) -> None:
        self.calls.append((context, ref))
        if self.events is not None:
            self.events.append("access")


@pytest.fixture
def repository() -> MagicMock:
    return create_autospec(ExternalKnowledgeRepository, instance=True, spec_set=True)


@pytest.fixture
def access() -> MagicMock:
    result = create_autospec(DatasetAccess, instance=True, spec_set=True)
    result.require_accessible.return_value = AccessibleDataset("dataset", "tenant")
    return result


@pytest.fixture
def retrieval() -> MagicMock:
    return create_autospec(ExternalKnowledgeRetrieval, instance=True, spec_set=True)


@pytest.fixture
def queries() -> MagicMock:
    return create_autospec(HitTestingQueryRecorder, instance=True, spec_set=True)


@pytest.fixture
def dataset_details() -> MagicMock:
    return create_autospec(ExternalDatasetDetails, instance=True, spec_set=True)


@pytest.fixture
def sync_access() -> _RecordingCreatorAccess:
    return _RecordingCreatorAccess()


@pytest.fixture
def service(
    repository: MagicMock,
    access: MagicMock,
    retrieval: MagicMock,
    queries: MagicMock,
    dataset_details: MagicMock,
    sync_access: _RecordingCreatorAccess,
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
    repository: MagicMock,
    retrieval: MagicMock,
    settings: dict[str, str],
    method: Callable[..., object],
) -> None:
    extra: dict[str, str] = (
        {"template_id": "template"} if method is ExternalKnowledgeApplicationService.update_template else {}
    )
    with pytest.raises(ValueError, match="(?:api list is empty|api_key is required|endpoint is required)"):
        method(service, CONTEXT, name="API", settings=settings, **extra)
    assert repository.mock_calls == []
    assert retrieval.mock_calls == []


def test_template_probe_precedes_persistence(
    service: ExternalKnowledgeApplicationService, repository: MagicMock, retrieval: MagicMock
) -> None:
    retrieval.check_settings.side_effect = ValueError("unreachable")
    with pytest.raises(ValueError, match="unreachable"):
        service.create_template(
            CONTEXT,
            name="API",
            settings={"endpoint": "https://example", "api_key": "secret"},
        )
    repository.create_template.assert_not_called()


def test_retrieval_authorization_precedes_validation_and_network(
    service: ExternalKnowledgeApplicationService, access: MagicMock, repository: MagicMock
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        service.hit_testing(CONTEXT, dataset_id="dataset", query="", retrieval_model=None, metadata_filters=None)
    assert repository.mock_calls == []


@pytest.mark.parametrize("query", ["", "a" * 251])
def test_invalid_query_prevents_retrieval(
    service: ExternalKnowledgeApplicationService, repository: MagicMock, query: str
) -> None:
    with pytest.raises(ValueError, match="(?:Query cannot exceed 250 characters|Query or attachment_ids is required)"):
        service.hit_testing(CONTEXT, dataset_id="dataset", query=query, retrieval_model=None, metadata_filters=None)
    repository.prepare_retrieval.assert_not_called()


def test_retrieval_failure_is_neutral_and_receives_owned_identity(
    service: ExternalKnowledgeApplicationService, repository: MagicMock
) -> None:
    repository.prepare_retrieval.side_effect = RuntimeError("unavailable")
    with pytest.raises(ExternalHitTestingError, match="unavailable"):
        service.hit_testing(
            CONTEXT,
            dataset_id="dataset",
            query="query",
            retrieval_model={"top_k": 2},
            metadata_filters=None,
        )
    repository.prepare_retrieval.assert_called_once_with(
        tenant_id="tenant",
        dataset_id="dataset",
        query="query",
        retrieval_model={"top_k": 2},
        metadata_filters=None,
    )


def test_failed_network_does_not_record_query(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    retrieval: MagicMock,
    queries: MagicMock,
) -> None:
    repository.prepare_retrieval.return_value = (
        "prepared",
        {
            "url": "https://example/retrieval",
            "request_method": "post",
            "headers": {"Content-Type": "application/json"},
            "params": {"query": "query"},
        },
    )
    retrieval.retrieve.side_effect = RuntimeError("unreachable")
    with pytest.raises(ExternalHitTestingError, match="unreachable"):
        service.hit_testing(CONTEXT, dataset_id="dataset", query="query", retrieval_model=None, metadata_filters=None)
    queries.record_hit_testing_query.assert_not_called()


def test_non_external_dataset_skips_network_and_history(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    retrieval: MagicMock,
    queries: MagicMock,
) -> None:
    repository.prepare_retrieval.return_value = ("not_external", None)
    assert service.hit_testing(
        CONTEXT,
        dataset_id="dataset",
        query="query",
        retrieval_model=None,
        metadata_filters=None,
    ) == {"query": {"content": "query"}, "records": []}
    retrieval.retrieve.assert_not_called()
    queries.record_hit_testing_query.assert_not_called()


@pytest.mark.parametrize(
    ("status", "error"),
    [
        ("name_conflict", DatasetNameDuplicateError),
        ("template_missing", ExternalTemplateNotFoundError),
    ],
)
def test_external_dataset_creation_maps_persistence_outcomes(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    status: str,
    error: type[Exception],
) -> None:
    repository.create_dataset.return_value = (status, None, None)
    with pytest.raises(error):
        service.create_dataset(
            CONTEXT,
            payload=ExternalDatasetCreatePayload(
                name="Dataset",
                external_knowledge_api_id="api",
                external_knowledge_id="knowledge",
            ),
        )


def test_external_dataset_creation_commits_before_access_sync_and_detail(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    dataset_details: MagicMock,
    sync_access: _RecordingCreatorAccess,
) -> None:
    payload = ExternalDatasetCreatePayload(
        name="Dataset",
        external_knowledge_api_id="api",
        external_knowledge_id="knowledge",
    )
    ref = DatasetRef("tenant", "dataset")
    events: list[str] = []
    repository.create_dataset.side_effect = lambda **_kwargs: (
        events.append("persist") or ("created", "tenant", "dataset")
    )
    sync_access.events = events
    dataset_details.get_dataset.side_effect = lambda *_args: events.append("detail") or {"id": "dataset"}
    dataset_details.console_permission_keys.side_effect = lambda *_args: events.append("permissions") or ["read"]

    result = service.create_dataset(CONTEXT, payload=payload)

    assert events == ["persist", "access", "detail", "permissions"]
    assert result == {"id": "dataset", "permission_keys": ["read"]}
    assert sync_access.calls == [(CONTEXT, ref)]
    dataset_details.get_dataset.assert_called_once_with(CONTEXT, ref)
