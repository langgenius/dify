from collections.abc import Callable
from unittest.mock import MagicMock, create_autospec

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.datasets.application import (
    DatasetApplicationService,
    DatasetListFilter,
    DatasetOperations,
    DatasetVisibility,
)
from services.knowledge.datasets.retrieval import retrieval_methods

CONTEXT = RequestContext("request", None, "actor", "tenant")


@pytest.fixture
def operations() -> MagicMock:
    return create_autospec(DatasetOperations, instance=True, spec_set=True)


@pytest.fixture
def access() -> MagicMock:
    result = create_autospec(DatasetAccess, instance=True, spec_set=True)
    result.require_accessible.return_value = AccessibleDataset("dataset", "tenant")
    return result


@pytest.fixture
def service(operations: MagicMock, access: MagicMock) -> DatasetApplicationService:
    return DatasetApplicationService(
        dataset_access=access,
        operations=operations,
        rbac_enabled=True,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
    )


@pytest.mark.parametrize(
    ("defaults", "workspace", "overrides"),
    [
        (["dataset.preview"], [], {}),
        ([], ["dataset.full_access", "dataset.create_and_management"], {}),
        ([], [], {"hidden": ["dataset.preview"]}),
    ],
)
def test_restricted_whitelist_wins_over_all_other_grants(
    defaults: list[str], workspace: list[str], overrides: dict[str, list[str]]
) -> None:
    visibility = DatasetVisibility(defaults, workspace, overrides, False, ["allowed"])
    assert visibility.list_scope(rbac_enabled=True) == (["allowed"], False)


@pytest.mark.parametrize(
    ("visibility", "expected"),
    [
        (DatasetVisibility(default_permissions=["dataset.preview"]), (None, False)),
        (DatasetVisibility(workspace_permissions=["dataset.acl.preview"]), (None, False)),
        (DatasetVisibility(overrides={"a": ["dataset.preview"], "b": ["dataset.edit"]}), (["a"], False)),
        (DatasetVisibility(workspace_permissions=["dataset.create_and_management"]), ([], True)),
        (DatasetVisibility(unrestricted=False), ([], False)),
    ],
)
def test_visibility_scope(visibility: DatasetVisibility, expected: tuple[list[str] | None, bool]) -> None:
    assert visibility.list_scope(rbac_enabled=True) == expected
    assert visibility.list_scope(rbac_enabled=False) == (None, False)


def test_list_applies_visibility_and_reports_model_availability(
    service: DatasetApplicationService, operations: MagicMock
) -> None:
    operations.visibility.return_value = DatasetVisibility(
        default_permissions=["dataset.preview"],
        overrides={"a": ["dataset.edit"]},
        unrestricted=False,
        whitelist_ids=["a"],
    )
    operations.list_datasets.return_value = {
        "data": [
            {
                "id": "a",
                "provider": "vendor",
                "indexing_technique": "high_quality",
                "embedding_model": "missing",
                "embedding_model_provider": "provider",
                "retrieval_model_dict": {"search_method": "semantic_search", "reranking_enable": False},
            },
            {
                "id": "b",
                "provider": "vendor",
                "indexing_technique": "economy",
                "embedding_model": None,
                "embedding_model_provider": None,
                "retrieval_model_dict": {"search_method": "semantic_search", "reranking_enable": False},
            },
        ]
    }
    operations.embedding_models.return_value = set()
    result = service.list_datasets(CONTEXT, DatasetListFilter(ids=["a"]))
    operations.list_datasets.assert_called_once_with(CONTEXT, DatasetListFilter(ids=["a"]), ["a"], False)
    assert result["data"][0]["embedding_available"] is False
    assert result["data"][0]["permission_keys"] == ["dataset.edit"]
    assert result["data"][1]["embedding_available"] is True


def test_list_reports_unavailable_reranking_dependency(
    service: DatasetApplicationService, operations: MagicMock
) -> None:
    operations.visibility.return_value = DatasetVisibility()
    operations.embedding_models.return_value = {"embedding:langgenius/jina/jina"}
    operations.reranking_models.return_value = set()
    operations.list_datasets.return_value = {
        "data": [
            {
                "id": "dataset",
                "provider": "vendor",
                "indexing_technique": "high_quality",
                "embedding_model": "embedding",
                "embedding_model_provider": "langgenius/jina/jina",
                "retrieval_model_dict": {
                    "search_method": "hybrid_search",
                    "reranking_enable": True,
                    "reranking_mode": "reranking_model",
                    "reranking_model": {
                        "reranking_provider_name": "langgenius/jina/jina",
                        "reranking_model_name": "jina-reranker-v1-base-en",
                    },
                },
            }
        ]
    }

    result = service.list_datasets(CONTEXT, DatasetListFilter())

    assert result["data"][0]["embedding_available"] is True
    assert result["data"][0]["reranking_available"] is False

    operations.reranking_models.return_value = {"jina-reranker-v1-base-en:langgenius/jina/jina"}
    result = service.list_datasets(CONTEXT, DatasetListFilter())
    assert result["data"][0]["reranking_available"] is True


@pytest.mark.parametrize("listing", [True, False], ids=["list", "detail"])
@pytest.mark.parametrize(
    ("overrides", "retrieval_overrides", "active_models", "available", "requires_reranking"),
    [
        ({}, {}, set(), False, True),
        ({}, {}, {"reranker:langgenius/jina/jina"}, True, True),
        ({}, {}, {"reranker:other/jina/jina"}, False, True),
        ({}, {"reranking_mode": "weighted_score"}, set(), True, False),
        ({}, {"reranking_enable": False}, set(), True, False),
        ({"indexing_technique": "economy"}, {}, set(), True, False),
        ({"provider": "external"}, {}, set(), True, False),
        ({}, {"reranking_model": {}}, set(), False, True),
        (
            {},
            {"reranking_model": {"reranking_provider_name": "bad/provider", "reranking_model_name": "reranker"}},
            set(),
            False,
            True,
        ),
        ({}, {"search_method": "semantic_search", "reranking_mode": "weighted_score"}, set(), False, True),
        ({}, {"search_method": "full_text_search", "reranking_mode": "weighted_score"}, set(), False, True),
        ({}, {"reranking_mode": None}, set(), False, True),
    ],
    ids=[
        "missing-model",
        "active-model",
        "different-provider",
        "weighted-score",
        "disabled-reranking",
        "economy",
        "external",
        "unconfigured-model",
        "invalid-provider-id",
        "semantic-reranking",
        "full-text-reranking",
        "legacy-mode",
    ],
)
def test_dataset_reranking_availability(
    service: DatasetApplicationService,
    operations: MagicMock,
    listing: bool,
    overrides: dict[str, object],
    retrieval_overrides: dict[str, object],
    active_models: set[str],
    available: bool,
    requires_reranking: bool,
) -> None:
    item = {
        "id": "dataset",
        "provider": "vendor",
        "indexing_technique": "high_quality",
        "embedding_model": "embedding",
        "embedding_model_provider": "langgenius/jina/jina",
        "retrieval_model_dict": {
            "search_method": "hybrid_search",
            "reranking_enable": True,
            "reranking_mode": "reranking_model",
            "reranking_model": {
                "reranking_provider_name": "langgenius/jina/jina",
                "reranking_model_name": "reranker",
            },
            **retrieval_overrides,
        },
        **overrides,
    }
    operations.visibility.return_value = DatasetVisibility()
    operations.list_datasets.return_value = {"data": [item]}
    operations.get_dataset.return_value = item
    operations.embedding_models.return_value = {"embedding:langgenius/jina/jina"}
    operations.reranking_models.return_value = active_models

    if listing:
        result = service.list_datasets(CONTEXT, DatasetListFilter())["data"][0]
    else:
        result = service.get_dataset(CONTEXT, dataset_id="dataset")

    assert result["embedding_available"] is True
    assert result["reranking_available"] is available
    if requires_reranking:
        operations.reranking_models.assert_called_once_with(CONTEXT.active_workspace_id)
    else:
        operations.reranking_models.assert_not_called()


@pytest.mark.parametrize(
    ("method", "extra"),
    [
        (DatasetApplicationService.get_dataset, {}),
        (DatasetApplicationService.update_dataset, {"values": {}}),
        (DatasetApplicationService.delete_dataset, {}),
        (DatasetApplicationService.is_in_use, {}),
        (DatasetApplicationService.queries, {"page": 1, "limit": 20}),
        (DatasetApplicationService.related_apps, {}),
        (DatasetApplicationService.indexing_status, {}),
        (DatasetApplicationService.error_documents, {}),
        (DatasetApplicationService.partial_members, {}),
        (DatasetApplicationService.auto_disable_logs, {}),
        (DatasetApplicationService.set_api_enabled, {"status": "enable"}),
    ],
)
def test_access_denial_precedes_all_owned_operations(
    service: DatasetApplicationService,
    access: MagicMock,
    operations: MagicMock,
    method: Callable[..., object],
    extra: dict[str, object],
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        method(service, CONTEXT, dataset_id="dataset", **extra)
    assert operations.mock_calls == []


def test_rbac_create_normalizes_permission_without_mutating_input(
    service: DatasetApplicationService, operations: MagicMock
) -> None:
    values = {"name": "name", "permission": "only_me"}
    service.create_dataset(CONTEXT, values=values)
    operations.create_dataset.assert_called_once_with(CONTEXT, {"name": "name", "permission": "all_team_members"})
    assert values["permission"] == "only_me"


def test_settings_are_injected_and_url_is_normalized(service: DatasetApplicationService) -> None:
    assert service.api_base_url(CONTEXT, request_base_url="https://api.example/v1/") == "https://api.example/v1"
    assert service.retrieval_settings(CONTEXT)["retrieval_method"] == [
        "semantic_search",
        "full_text_search",
        "hybrid_search",
    ]
    assert service.retrieval_settings(CONTEXT, vector_type="milvus", is_mock=True) == {
        "retrieval_method": ["semantic_search"]
    }


@pytest.mark.parametrize("fulltext", [True, False])
def test_tidb_retrieval_setting(fulltext: bool) -> None:
    result = retrieval_methods("tidb_vector", tidb_fulltext=fulltext)
    assert ("full_text_search" in result["retrieval_method"]) is fulltext


@pytest.mark.parametrize("store", [None, "unsupported"])
def test_invalid_vector_store(store: str | None) -> None:
    with pytest.raises(ValueError):
        retrieval_methods(store)
