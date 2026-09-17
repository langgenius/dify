from collections.abc import Callable
from unittest.mock import MagicMock, create_autospec

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.external.application import (
    ExternalHitTestingError,
    ExternalKnowledgeApplicationService,
    ExternalKnowledgeOperations,
)
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request", None, "actor", "tenant")


@pytest.fixture
def operations() -> MagicMock:
    return create_autospec(ExternalKnowledgeOperations, instance=True, spec_set=True)


@pytest.fixture
def access() -> MagicMock:
    result = create_autospec(DatasetAccess, instance=True, spec_set=True)
    result.require_accessible.return_value = AccessibleDataset("dataset", "tenant")
    return result


@pytest.fixture
def service(operations: MagicMock, access: MagicMock) -> ExternalKnowledgeApplicationService:
    return ExternalKnowledgeApplicationService(dataset_access=access, operations=operations)


@pytest.mark.parametrize("settings", [{}, {"endpoint": "https://example"}, {"api_key": "secret"}])
@pytest.mark.parametrize(
    "method", [ExternalKnowledgeApplicationService.create_template, ExternalKnowledgeApplicationService.update_template]
)
def test_template_validation_prevents_io(
    service: ExternalKnowledgeApplicationService,
    operations: MagicMock,
    settings: dict[str, str],
    method: Callable[..., object],
) -> None:
    extra: dict[str, str] = (
        {"template_id": "template"} if method is ExternalKnowledgeApplicationService.update_template else {}
    )
    with pytest.raises(ValueError):
        method(service, CONTEXT, name="API", settings=settings, **extra)
    assert operations.mock_calls == []


def test_retrieval_authorization_precedes_validation_and_network(
    service: ExternalKnowledgeApplicationService, access: MagicMock, operations: MagicMock
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        service.hit_testing(CONTEXT, dataset_id="dataset", query="", retrieval_model=None, metadata_filters=None)
    assert operations.mock_calls == []


@pytest.mark.parametrize("query", ["", "a" * 251])
def test_invalid_query_prevents_retrieval(
    service: ExternalKnowledgeApplicationService, operations: MagicMock, query: str
) -> None:
    with pytest.raises(ValueError):
        service.hit_testing(CONTEXT, dataset_id="dataset", query=query, retrieval_model=None, metadata_filters=None)
    operations.retrieve.assert_not_called()


def test_retrieval_failure_is_neutral_and_receives_owned_ref(
    service: ExternalKnowledgeApplicationService, operations: MagicMock
) -> None:
    operations.retrieve.side_effect = RuntimeError("unavailable")
    with pytest.raises(ExternalHitTestingError, match="unavailable"):
        service.hit_testing(
            CONTEXT, dataset_id="dataset", query="query", retrieval_model={"top_k": 2}, metadata_filters=None
        )
    operations.retrieve.assert_called_once_with(
        CONTEXT, DatasetRef("tenant", "dataset"), query="query", retrieval_model={"top_k": 2}, metadata_filters=None
    )
