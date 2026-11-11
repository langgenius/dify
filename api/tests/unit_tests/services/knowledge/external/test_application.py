from collections.abc import Callable
from dataclasses import dataclass, field
from unittest.mock import MagicMock, create_autospec

import pytest

from constants import HIDDEN_VALUE
from machinery.context import RequestContext
from services.errors.dataset import DatasetNameDuplicateError
from services.errors.knowledge_retrieval import (
    ExternalTemplateConcurrentUpdateError,
    ExternalTemplateNotFoundError,
)
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.entities.external import (
    ExternalDatasetCreatePayload,
    ExternalKnowledgeRetrievalRequest,
    ExternalRetrievalConfig,
)
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.external.application import (
    ExternalDatasetDetails,
    ExternalHitTestingError,
    ExternalKnowledgeApplicationService,
    ExternalKnowledgeRepository,
    ExternalKnowledgeRetrieval,
)
from services.knowledge.hit_testing.entities import HitTestingQueryRecorder

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
        api_key_mask=HIDDEN_VALUE,
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


def test_masked_template_update_probes_with_stored_secret_without_persisting_the_snapshot(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    retrieval: MagicMock,
) -> None:
    submitted_settings = {"endpoint": "https://changed", "api_key": HIDDEN_VALUE}
    repository.get_template.return_value = {"settings": {"endpoint": "https://old", "api_key": "stored-secret"}}
    repository.update_template.return_value = {"id": "template"}

    service.update_template(
        CONTEXT,
        template_id="template",
        name="Renamed",
        settings=submitted_settings,
    )

    retrieval.check_settings.assert_called_once_with({"endpoint": "https://changed", "api_key": "stored-secret"})
    repository.update_template.assert_called_once_with(
        tenant_id="tenant",
        template_id="template",
        user_id="actor",
        name="Renamed",
        settings=submitted_settings,
        expected_api_key="stored-secret",
    )
    assert submitted_settings["api_key"] == HIDDEN_VALUE


def test_template_update_checks_existence_before_provider_probe(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    retrieval: MagicMock,
) -> None:
    repository.get_template.return_value = None

    with pytest.raises(ExternalTemplateNotFoundError):
        service.update_template(
            CONTEXT,
            template_id="missing",
            name="Renamed",
            settings={"endpoint": "https://changed", "api_key": HIDDEN_VALUE},
        )

    retrieval.check_settings.assert_not_called()
    repository.update_template.assert_not_called()


def test_masked_template_update_rejects_a_secret_changed_after_probe(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    retrieval: MagicMock,
) -> None:
    repository.get_template.return_value = {"settings": {"endpoint": "https://old", "api_key": "stored-secret"}}
    repository.update_template.side_effect = ExternalTemplateConcurrentUpdateError(
        "API template credentials changed while the update was being validated. Please retry."
    )

    with pytest.raises(ExternalTemplateConcurrentUpdateError):
        service.update_template(
            CONTEXT,
            template_id="template",
            name="Renamed",
            settings={"endpoint": "https://changed", "api_key": HIDDEN_VALUE},
        )

    retrieval.check_settings.assert_called_once_with({"endpoint": "https://changed", "api_key": "stored-secret"})
    assert repository.update_template.call_args.kwargs["expected_api_key"] == "stored-secret"


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
    repository.get_retrieval_request.assert_not_called()


def test_retrieval_failure_is_neutral_and_receives_owned_identity(
    service: ExternalKnowledgeApplicationService, repository: MagicMock
) -> None:
    repository.get_retrieval_request.side_effect = RuntimeError("unavailable")
    with pytest.raises(ExternalHitTestingError, match="unavailable"):
        service.hit_testing(
            CONTEXT,
            dataset_id="dataset",
            query="query",
            retrieval_model={"top_k": 2},
            metadata_filters=None,
        )
    repository.get_retrieval_request.assert_called_once_with(
        tenant_id="tenant",
        dataset_id="dataset",
        query="query",
        retrieval_model=ExternalRetrievalConfig(top_k=2),
        metadata_filters=None,
    )


def test_failed_network_does_not_record_query(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    retrieval: MagicMock,
    queries: MagicMock,
) -> None:
    repository.get_retrieval_request.return_value = ExternalKnowledgeRetrievalRequest(
        endpoint="https://example",
        api_key=None,
        knowledge_id="knowledge",
        query="query",
        retrieval_model=ExternalRetrievalConfig(top_k=2),
        metadata_filters=None,
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
    repository.get_retrieval_request.return_value = None
    assert service.hit_testing(
        CONTEXT,
        dataset_id="dataset",
        query="query",
        retrieval_model=None,
        metadata_filters=None,
    ) == {"query": {"content": "query"}, "records": []}
    retrieval.retrieve.assert_not_called()
    queries.record_hit_testing_query.assert_not_called()


@pytest.mark.parametrize("error", [DatasetNameDuplicateError, ExternalTemplateNotFoundError])
def test_external_dataset_creation_maps_persistence_outcomes(
    service: ExternalKnowledgeApplicationService,
    repository: MagicMock,
    error: type[Exception],
) -> None:
    repository.create_dataset.side_effect = error()
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
    repository.create_dataset.side_effect = lambda **_kwargs: events.append("persist") or ref
    sync_access.events = events
    dataset_details.get_dataset.side_effect = lambda *_args: events.append("detail") or {"id": "dataset"}

    result = service.create_dataset(CONTEXT, payload=payload)

    assert events == ["persist", "access", "detail"]
    assert result == {"id": "dataset"}
    assert sync_access.calls == [(CONTEXT, ref)]
    dataset_details.get_dataset.assert_called_once_with(CONTEXT, ref)
