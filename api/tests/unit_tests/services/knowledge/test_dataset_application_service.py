from collections.abc import Callable
from datetime import datetime
from unittest.mock import Mock, create_autospec

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.datasets.application import (
    DatasetApplicationService,
    DatasetModelConfigurationGateway,
    DatasetMutationStore,
    DatasetOperations,
)
from services.knowledge.datasets.contracts import (
    DatasetDetailProjection,
    DatasetListFilter,
    DatasetPermissionChangeSnapshot,
    DatasetUpdateSnapshot,
    DatasetVisibility,
)
from services.knowledge.datasets.retrieval import retrieval_methods
from services.knowledge.entities.datasets import DatasetPage
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request", None, "actor", "tenant")


def update_snapshot() -> DatasetUpdateSnapshot:
    return DatasetUpdateSnapshot(
        provider="vendor",
        indexing_technique="economy",
        embedding_model_provider=None,
        embedding_model=None,
        updated_at=datetime(2026, 1, 1),
        name="Dataset",
        permission="partial_members",
        collection_binding_id=None,
        runtime_mode="general",
        pipeline_id=None,
        chunk_structure=None,
        keyword_number=10,
        retrieval_model=None,
        summary_index_setting=None,
        is_multimodal=False,
    )


@pytest.fixture
def operations() -> Mock:
    result = create_autospec(DatasetOperations, instance=True, spec_set=True)
    result.get_dataset.return_value = {"id": "created"}
    return result


@pytest.fixture
def mutations() -> Mock:
    result = create_autospec(DatasetMutationStore, instance=True, spec_set=True)
    result.create_dataset.return_value = "created"
    result.delete_with_relations.return_value = True
    return result


@pytest.fixture
def models() -> Mock:
    return create_autospec(DatasetModelConfigurationGateway, instance=True, spec_set=True)


@pytest.fixture
def access() -> Mock:
    result = create_autospec(DatasetAccess, instance=True, spec_set=True)
    result.require_accessible.return_value = AccessibleDataset("dataset", "tenant")
    return result


@pytest.fixture
def service(operations: Mock, mutations: Mock, models: Mock, access: Mock) -> DatasetApplicationService:
    return DatasetApplicationService(
        dataset_access=access,
        operations=operations,
        mutations=mutations,
        models=models,
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
    service: DatasetApplicationService, operations: Mock
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
                "indexing_technique": "high_quality",
                "embedding_model": "missing",
                "embedding_model_provider": "provider",
            },
            {"id": "b", "indexing_technique": "economy", "embedding_model": None, "embedding_model_provider": None},
        ]
    }
    operations.embedding_models.return_value = set()
    result = service.list_accessible_datasets(CONTEXT, DatasetListFilter(ids=["a"]))
    operations.list_datasets.assert_called_once_with(CONTEXT, DatasetListFilter(ids=["a"]), ["a"], False)
    assert result["data"][0]["embedding_available"] is False
    assert result["data"][0]["permission_keys"] == ["dataset.edit"]
    assert result["data"][1]["embedding_available"] is True


def test_list_workspace_datasets_skips_account_visibility(service: DatasetApplicationService, operations: Mock) -> None:
    operations.list_datasets.return_value = {
        "data": [
            {
                "id": "a",
                "indexing_technique": "high_quality",
                "embedding_model": "model",
                "embedding_model_provider": "provider",
            }
        ]
    }
    operations.embedding_models.return_value = {"model:provider"}

    result = service.list_workspace_datasets(CONTEXT, DatasetListFilter(keyword="query"))

    operations.visibility.assert_not_called()
    operations.list_datasets.assert_called_once_with(
        CONTEXT,
        DatasetListFilter(keyword="query"),
        None,
        False,
    )
    assert result["data"] == [
        {
            "id": "a",
            "indexing_technique": "high_quality",
            "embedding_model": "model",
            "embedding_model_provider": "provider",
            "embedding_available": True,
        }
    ]


@pytest.mark.parametrize("bound_ids", [frozenset(), frozenset({"dataset"})])
def test_resource_token_list_preserves_binding_scope(
    service: DatasetApplicationService, operations: Mock, bound_ids: frozenset[str]
) -> None:
    context = CONTEXT._replace(resource_dataset_ids=bound_ids)
    page: DatasetPage = {"data": [], "has_more": False, "page": 1, "limit": 20, "total": 0}
    operations.list_datasets.return_value = page
    operations.embedding_models.return_value = set()
    query = DatasetListFilter(include_all=True)

    service.list_workspace_datasets(context, query)

    operations.list_datasets.assert_called_once_with(context, query, sorted(bound_ids), False)


def test_resource_token_list_intersects_account_scope_and_disables_owner_bypass(
    service: DatasetApplicationService, operations: Mock
) -> None:
    context = CONTEXT._replace(resource_dataset_ids=frozenset({"bound", "hidden"}))
    operations.visibility.return_value = DatasetVisibility(
        workspace_permissions=["dataset.create_and_management"],
        overrides={"bound": ["dataset.preview"], "unbound": ["dataset.preview"]},
    )
    page: DatasetPage = {"data": [], "has_more": False, "page": 1, "limit": 20, "total": 0}
    operations.list_datasets.return_value = page
    operations.embedding_models.return_value = set()
    query = DatasetListFilter()

    service.list_accessible_datasets(context, query)

    operations.list_datasets.assert_called_once_with(context, query, ["bound"], False)


@pytest.mark.parametrize(
    "method",
    [DatasetApplicationService.create_dataset, DatasetApplicationService.create_dataset_with_requested_permission],
)
def test_resource_token_cannot_create_unbound_datasets(
    service: DatasetApplicationService, mutations: Mock, method: Callable[..., object]
) -> None:
    context = CONTEXT._replace(resource_dataset_ids=frozenset({"bound"}))

    with pytest.raises(DatasetAccessDeniedError):
        method(service, context, values={"name": "new"})

    mutations.create_dataset.assert_not_called()


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
    access: Mock,
    operations: Mock,
    method: Callable[..., object],
    extra: dict[str, object],
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        method(service, CONTEXT, dataset_id="dataset", **extra)
    assert operations.mock_calls == []


def test_rbac_create_normalizes_permission_without_mutating_input(
    service: DatasetApplicationService, mutations: Mock
) -> None:
    values = {"name": "name", "permission": "only_me"}
    service.create_dataset(CONTEXT, values=values)
    assert mutations.create_dataset.call_args.args[0].permission == "all_team_members"
    assert values["permission"] == "only_me"


def test_service_create_projection_initializes_creator_access_without_console_projection(
    service: DatasetApplicationService, operations: Mock
) -> None:
    result = service.create_dataset_with_requested_permission(
        CONTEXT,
        values={"name": "name"},
        projection=DatasetDetailProjection.CORE,
    )

    assert result == {"id": "created"}
    operations.initialize_creator_access.assert_called_once_with(CONTEXT, "created")
    operations.console_permission_keys.assert_not_called()


def test_console_create_projection_initializes_and_adds_permissions(
    service: DatasetApplicationService, operations: Mock
) -> None:
    operations.console_permission_keys.return_value = ["dataset.preview"]

    result = service.create_dataset(
        CONTEXT,
        values={"name": "name"},
        projection=DatasetDetailProjection.CONSOLE,
    )

    operations.initialize_creator_access.assert_called_once_with(CONTEXT, "created")
    operations.console_permission_keys.assert_called_once_with(CONTEXT, "created")
    assert result["permission_keys"] == ["dataset.preview"]


@pytest.mark.parametrize("projection", [DatasetDetailProjection.CORE, DatasetDetailProjection.CONSOLE])
def test_create_compensates_when_creator_access_initialization_fails(
    service: DatasetApplicationService, operations: Mock, mutations: Mock, projection: DatasetDetailProjection
) -> None:
    operations.initialize_creator_access.side_effect = RuntimeError("RBAC unavailable")

    with pytest.raises(RuntimeError, match="RBAC unavailable"):
        service.create_dataset(
            CONTEXT,
            values={"name": "name"},
            projection=projection,
        )

    mutations.delete_with_relations.assert_called_once_with(DatasetRef("tenant", "created"))


@pytest.mark.parametrize("requested_permission", ["only_me", "partial_members", None])
def test_create_with_requested_permission_preserves_request_and_input(
    service: DatasetApplicationService,
    mutations: Mock,
    requested_permission: str | None,
) -> None:
    values = {"name": "name", "permission": requested_permission}

    service.create_dataset_with_requested_permission(CONTEXT, values=values)

    assert mutations.create_dataset.call_args.args[0].permission == (requested_permission or "only_me")
    assert values == {"name": "name", "permission": requested_permission}


@pytest.mark.parametrize(
    "method",
    [DatasetApplicationService.create_dataset, DatasetApplicationService.create_dataset_with_requested_permission],
)
@pytest.mark.parametrize(
    ("requested_permission", "expected_permission"), [("partial_members", "partial_members"), (None, "only_me")]
)
def test_creation_uses_requested_permission_when_rbac_is_disabled(
    operations: Mock,
    mutations: Mock,
    models: Mock,
    access: Mock,
    method: Callable[..., object],
    requested_permission: str | None,
    expected_permission: str,
) -> None:
    service = DatasetApplicationService(
        dataset_access=access,
        operations=operations,
        mutations=mutations,
        models=models,
        rbac_enabled=False,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
    )
    values = {"name": "name", "permission": requested_permission}

    method(service, CONTEXT, values=values)

    assert mutations.create_dataset.call_args.args[0].permission == expected_permission
    assert values == {"name": "name", "permission": requested_permission}


def test_update_normalizes_console_partial_member_objects(
    operations: Mock,
    mutations: Mock,
    models: Mock,
    access: Mock,
) -> None:
    mutations.get_update_snapshot.return_value = update_snapshot()
    mutations.get_permission_change_snapshot.return_value = DatasetPermissionChangeSnapshot(
        actor_role="owner",
        current_permission="partial_members",
        current_member_ids=("old",),
    )
    mutations.update_dataset.return_value = True
    operations.get_dataset.return_value = {"id": "dataset"}
    service = DatasetApplicationService(
        dataset_access=access,
        operations=operations,
        mutations=mutations,
        models=models,
        rbac_enabled=False,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
    )

    service.update_dataset(
        CONTEXT,
        dataset_id="dataset",
        values={
            "permission": "partial_members",
            "partial_member_list": [{"user_id": "member"}, {"user_id": "member"}],
        },
    )

    mutation = mutations.update_dataset.call_args.args[0]
    assert mutation.partial_member_ids == ("member",)
    assert mutation.permission_expected.current_member_ids == ("old",)


def test_update_reloads_permission_fence_after_concurrent_change(
    operations: Mock,
    mutations: Mock,
    models: Mock,
    access: Mock,
) -> None:
    first = DatasetPermissionChangeSnapshot("owner", "partial_members", ("old",))
    second = DatasetPermissionChangeSnapshot("owner", "partial_members", ("member",))
    mutations.get_update_snapshot.side_effect = [update_snapshot(), update_snapshot()]
    mutations.get_permission_change_snapshot.side_effect = [first, second]
    mutations.update_dataset.side_effect = [False, True]
    operations.get_dataset.return_value = {"id": "dataset"}
    service = DatasetApplicationService(
        dataset_access=access,
        operations=operations,
        mutations=mutations,
        models=models,
        rbac_enabled=False,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
    )

    service.update_dataset(
        CONTEXT,
        dataset_id="dataset",
        values={"permission": "partial_members", "partial_member_list": [{"user_id": "member"}]},
    )

    assert [call.args[0].permission_expected for call in mutations.update_dataset.call_args_list] == [first, second]


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
    with pytest.raises(
        ValueError, match=("(?:Unsupported vector db type unsupported\\.|Vector store type is not configured\\.)")
    ):
        retrieval_methods(store)
