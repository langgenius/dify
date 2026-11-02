from unittest.mock import MagicMock, create_autospec

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.datasets.application import (
    DatasetApplicationService,
    DatasetListFilter,
    DatasetOperations,
    DatasetVisibility,
)
from services.knowledge.datasets.availability import is_embedding_available
from services.knowledge.entities.datasets import DatasetAvailabilityFilter

CONTEXT = RequestContext("request", None, "actor", "tenant")


OPENAI_MODEL_KEY = "text-embedding-3-small:langgenius/openai/openai"


@pytest.mark.parametrize(
    ("indexing_technique", "provider", "listing", "models", "expected"),
    [
        # Economy indexing needs no embedding model.
        ("economy", None, True, set(), True),
        ("economy", "langgenius/openai/openai", False, set(), True),
        # High quality resolves the active model key from the canonical provider.
        ("high_quality", "langgenius/openai/openai", True, {OPENAI_MODEL_KEY}, True),
        # A removed model stays unavailable.
        ("high_quality", "missing/provider/provider", True, {OPENAI_MODEL_KEY}, False),
        # Listing treats a high-quality row without a provider as available.
        ("high_quality", None, True, set(), True),
        ("high_quality", "", True, set(), True),
        # Detail responses keep the strict lookup for a missing provider.
        ("high_quality", None, False, set(), False),
    ],
)
def test_embedding_availability_follows_the_card_rule(
    indexing_technique: str,
    provider: str | None,
    listing: bool,
    models: set[str],
    expected: bool,
) -> None:
    assert (
        is_embedding_available(
            indexing_technique=indexing_technique,
            embedding_model="text-embedding-3-small",
            embedding_model_provider=provider,
            embedding_models=models,
            listing=listing,
        )
        is expected
    )


@pytest.fixture
def operations() -> MagicMock:
    return create_autospec(DatasetOperations, instance=True, spec_set=True)


@pytest.fixture
def service(operations: MagicMock) -> DatasetApplicationService:
    return DatasetApplicationService(
        dataset_access=create_autospec(DatasetAccess, instance=True, spec_set=True),
        operations=operations,
        rbac_enabled=True,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
    )


def test_list_passes_the_availability_filter_and_active_models_to_the_adapter(
    service: DatasetApplicationService, operations: MagicMock
) -> None:
    operations.visibility.return_value = DatasetVisibility()
    operations.embedding_models.return_value = {"text-embedding-3-small:langgenius/openai/openai"}
    operations.list_datasets.return_value = {
        "data": [
            {
                "id": "a",
                "indexing_technique": "high_quality",
                "embedding_model": "text-embedding-3-small",
                "embedding_model_provider": "langgenius/openai/openai",
            }
        ]
    }
    query = DatasetListFilter(availability=DatasetAvailabilityFilter.AVAILABLE)

    result = service.list_datasets(CONTEXT, query)

    operations.embedding_models.assert_called_once_with(CONTEXT.active_workspace_id)
    operations.list_datasets.assert_called_once_with(
        CONTEXT,
        query,
        [],
        embedding_models={"text-embedding-3-small:langgenius/openai/openai"},
    )
    assert result["data"][0]["embedding_available"] is True


def test_unavailable_cards_report_the_filtered_status(
    service: DatasetApplicationService, operations: MagicMock
) -> None:
    operations.visibility.return_value = DatasetVisibility()
    operations.embedding_models.return_value = set()
    operations.list_datasets.return_value = {
        "data": [
            {
                "id": "a",
                "indexing_technique": "high_quality",
                "embedding_model": "removed",
                "embedding_model_provider": "langgenius/openai/openai",
            }
        ]
    }

    result = service.list_datasets(CONTEXT, DatasetListFilter(availability=DatasetAvailabilityFilter.UNAVAILABLE))

    assert result["data"][0]["embedding_available"] is False
