from collections.abc import Callable, Iterator
from unittest.mock import patch

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.datasets.datasets import DatasetDetailResponse, DatasetListResponse, DatasetQueryListResponse
from machinery.context import RequestContext
from models import Account, ApiToken, App, Dataset, Document
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetQuery,
    DocumentSegment,
)
from models.enums import CreatorUserRole, DatasetQuerySource, IndexingStatus, SegmentStatus
from models.model import DatasetApiTokenBinding
from services.enterprise import rbac_service
from services.knowledge.dataset_access import DatasetNotFoundError
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetKeyLimitError, DatasetKeyNotFoundError, DatasetListFilter
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.resource_scope import DatasetRef
from tests.unit_tests.config_override import apply_config_overrides

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


def dataset(**values: object) -> Dataset:
    return Dataset(
        **{
            "id": "dataset",
            "tenant_id": "tenant",
            "name": "Dataset",
            "created_by": "actor",
            "maintainer": "actor",
            "indexing_technique": "economy",
            "permission": "all_team_members",
            **values,
        }
    )


def document(**values: object) -> Document:
    return Document(
        **{
            "id": "document",
            "tenant_id": "tenant",
            "dataset_id": "dataset",
            "position": 1,
            "data_source_type": "local_file",
            "batch": "batch",
            "name": "Document",
            "created_from": "web",
            "created_by": "actor",
            "indexing_status": IndexingStatus.ERROR,
            **values,
        }
    )


@pytest.fixture
def operations(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[SQLAlchemyDatasetOperations]:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=False)
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Workspace")
        tenant.id = "tenant"
        account = Account(name="Actor", email="actor@example.com")
        account.id = "actor"
        session.add_all(
            [
                tenant,
                account,
                TenantAccountJoin(tenant_id="tenant", account_id="actor", role=TenantAccountRole.OWNER),
                dataset(),
                dataset(id="foreign", tenant_id="other", name="Foreign"),
            ]
        )
    with (
        patch.object(rbac_service.RBACService.MyPermissions, "get", return_value=rbac_service.MyPermissionsResponse()),
        patch.object(
            rbac_service.RBACService.DatasetPermissions, "batch_get", return_value={"dataset": ["dataset.preview"]}
        ),
        patch.object(rbac_service, "try_sync_creator_access_policy_member_bindings"),
    ):
        yield SQLAlchemyDatasetOperations(session_factory=sqlite_session_factory)


def test_listing_materializes_page_and_owner_scoped_partial_members(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        row.permission = DatasetPermissionEnum.PARTIAL_TEAM
        session.add_all(
            [
                DatasetPermission(tenant_id="tenant", dataset_id="dataset", account_id="member"),
                DatasetPermission(tenant_id="other", dataset_id="dataset", account_id="foreign"),
            ]
        )
    result = operations.list_datasets(
        CONTEXT, DatasetListFilter(page=0, limit=1000, ids=["dataset", "foreign"]), None, False
    )
    response = DatasetListResponse.model_validate(result).model_dump(mode="json")
    assert response["total"] == 1
    assert response["page"] == 1
    assert response["limit"] == 100
    assert response["has_more"] is False
    assert response["data"][0]["partial_member_list"] == ["member"]
    assert response["data"][0]["retrieval_model_dict"]["top_k"] == 2


@pytest.mark.parametrize(("ids", "own"), [([], False), (["dataset"], False)])
def test_list_visibility_restricts_even_requested_ids(
    operations: SQLAlchemyDatasetOperations, ids: list[str], own: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    result = operations.list_datasets(CONTEXT, DatasetListFilter(ids=["dataset"]), ids, own)
    assert result["total"] == len(ids)


@pytest.mark.parametrize(
    "method",
    [
        "get_dataset",
        "is_in_use",
        "queries",
        "related_apps",
        "indexing_status",
        "error_documents",
        "partial_members",
        "update_dataset",
        "delete_dataset",
        "set_api_enabled",
    ],
)
def test_wrong_tenant_ref_cannot_read_or_write(operations: SQLAlchemyDatasetOperations, method: str) -> None:
    args: list[object] = (
        [CONTEXT] if method in {"get_dataset", "update_dataset", "delete_dataset", "set_api_enabled"} else []
    )
    args.append(DatasetRef("other", "dataset"))
    if method == "update_dataset":
        args.append({"name": "changed"})
    if method == "set_api_enabled":
        args.append(True)
    extra: dict[str, int] = {"page": 1, "limit": 20} if method == "queries" else {}
    methods: dict[str, Callable[..., object]] = {
        "get_dataset": operations.get_dataset,
        "is_in_use": operations.is_in_use,
        "queries": operations.queries,
        "related_apps": operations.related_apps,
        "indexing_status": operations.indexing_status,
        "error_documents": operations.error_documents,
        "partial_members": operations.partial_members,
        "update_dataset": operations.update_dataset,
        "delete_dataset": operations.delete_dataset,
        "set_api_enabled": operations.set_api_enabled,
    }
    with pytest.raises(DatasetNotFoundError):
        methods[method](*args, **extra)


def test_create_update_and_api_status_commit_owned_changes(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    created = operations.create_dataset(
        CONTEXT, {"name": "Created", "description": "desc", "indexing_technique": "economy", "permission": "only_me"}
    )
    assert DatasetDetailResponse.model_validate(created).name == "Created"
    result = operations.update_dataset(CONTEXT, REF, {"name": "Renamed", "permission": "all_team_members"})
    assert result["name"] == "Renamed"
    operations.set_api_enabled(CONTEXT, REF, True)
    with sqlite_session_factory() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        assert row.name == "Renamed"
        assert row.enable_api is True
        assert session.get(Dataset, created["id"]) is not None


@pytest.mark.parametrize("entry_point", ["empty", "documents"])
@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_created_dataset_does_not_automatically_include_workspace_members(
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    entry_point: str,
    rbac_enabled: bool,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)

    def save_documents(
        created_dataset: Dataset, _config: KnowledgeConfig, _account: Account, *, session: Session
    ) -> tuple[list[Document], str]:
        row = document(id="created-document", dataset_id=created_dataset.id, data_source_type="upload_file")
        session.add(row)
        session.flush()
        return [row], "batch"

    with (
        patch.object(rbac_service.RBACService.DatasetAccess, "replace_whitelist") as replace_whitelist,
        patch(
            "tasks.initialize_created_app_rbac_access_task.initialize_created_app_rbac_access_task.delay"
        ) as initialize,
        patch(
            "services.knowledge.documents.adapters.DocumentService.save_document_with_dataset_id",
            side_effect=save_documents,
        ),
    ):
        if entry_point == "empty":
            result = operations.create_dataset(
                CONTEXT,
                {"name": "Created", "description": "desc", "indexing_technique": "economy", "permission": "only_me"},
            )
            dataset_id = result["id"]
        else:
            result = SQLAlchemyDocumentOperations(session_factory=sqlite_session_factory).initialize_dataset(
                CONTEXT,
                {
                    "indexing_technique": "economy",
                    "data_source": {
                        "info_list": {"data_source_type": "upload_file", "file_info_list": {"file_ids": ["file"]}}
                    },
                    "process_rule": {"mode": "automatic"},
                },
            )
            dataset_id = result["dataset"]["id"]
        if rbac_enabled:
            replace_whitelist.assert_called_once_with(
                CONTEXT.active_workspace_id,
                CONTEXT.account_id,
                dataset_id,
                rbac_service.ReplaceMemberBindings(automatic_include_workspace_members=False),
            )
        else:
            replace_whitelist.assert_not_called()
        initialize.assert_not_called()

    with sqlite_session_factory() as session:
        assert session.get(Dataset, dataset_id) is not None


def test_partial_members_update_and_clear_are_committed(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    result = operations.update_dataset(
        CONTEXT, REF, {"permission": "partial_members", "partial_member_list": [{"user_id": "actor"}]}
    )
    assert result["partial_member_list"] == ["actor"]
    result = operations.update_dataset(CONTEXT, REF, {"permission": "all_team_members"})
    assert result["partial_member_list"] == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DatasetPermission)) == 0


def test_status_counts_and_errors_exclude_foreign_documents(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                document(),
                document(id="foreign-doc", tenant_id="other"),
                DocumentSegment(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    document_id="document",
                    position=1,
                    content="content",
                    word_count=1,
                    tokens=1,
                    created_by="actor",
                    status=SegmentStatus.WAITING,
                ),
                DocumentSegment(
                    tenant_id="other",
                    dataset_id="dataset",
                    document_id="document",
                    position=1,
                    content="content",
                    word_count=1,
                    tokens=1,
                    created_by="actor",
                ),
            ]
        )
    result = operations.indexing_status(REF)
    assert len(result["data"]) == 1
    assert result["data"][0]["total_segments"] == 1
    assert result["data"][0]["completed_segments"] == 0
    assert operations.error_documents(REF)["total"] == 1


def test_queries_and_related_apps_materialize_after_session_close(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            DatasetQuery(
                dataset_id="dataset",
                content="query",
                source=DatasetQuerySource.HIT_TESTING,
                source_app_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="actor",
            )
        )
        session.add_all(
            [
                App(id="app", tenant_id="tenant", name="App", mode="chat", enable_api=False, enable_site=False),
                App(
                    id="foreign-app", tenant_id="other", name="Other", mode="chat", enable_api=False, enable_site=False
                ),
                AppDatasetJoin(app_id="app", dataset_id="dataset"),
                AppDatasetJoin(app_id="foreign-app", dataset_id="dataset"),
            ]
        )
    response = DatasetQueryListResponse.model_validate(operations.queries(REF, page=0, limit=0)).model_dump(mode="json")
    assert response["limit"] == 1
    assert response["has_more"] is False
    assert response["data"][0]["queries"][0]["content"] == "query"
    assert [app["id"] for app in operations.related_apps(REF)["data"]] == ["app"]


def test_scoped_key_commit_and_unknown_owner_rejection(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    result = operations.create_key("tenant", ["dataset"], max_keys=10)
    assert result["dataset_ids"] == ["dataset"]
    assert result["token"].startswith("dataset-")
    with sqlite_session_factory() as session:
        assert (
            session.scalar(
                select(DatasetApiTokenBinding.dataset_id).where(DatasetApiTokenBinding.api_token_id == result["id"])
            )
            == "dataset"
        )
    with pytest.raises(ValueError, match="Unknown knowledge base"):
        operations.create_key("tenant", ["foreign"], max_keys=10)
    assert len(operations.list_keys("tenant")) == 1


def test_key_limit_counts_only_workspace_dataset_keys(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                ApiToken(tenant_id="other", type="dataset", token="other"),
                ApiToken(tenant_id="tenant", type="app", token="app"),
            ]
        )
    operations.create_key("tenant", [], max_keys=1)
    with pytest.raises(DatasetKeyLimitError):
        operations.create_key("tenant", [], max_keys=1)


def test_delete_key_releases_transaction_before_cache_invalidation(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session], sqlite_engine: Engine
) -> None:
    key = operations.create_key("tenant", [], max_keys=10)
    active: set[object] = set()

    def checkout(_conn: object, record: object, _proxy: object) -> None:
        active.add(record)

    def checkin(_conn: object, record: object) -> None:
        active.discard(record)

    def invalidate(token: str, kind: str) -> None:
        assert not active
        assert token == key["token"]
        assert kind == "dataset"

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        with patch("services.knowledge.datasets.adapters.ApiTokenCache.delete", side_effect=invalidate) as cache:
            with pytest.raises(DatasetKeyNotFoundError):
                operations.delete_key("other", key["id"])
            cache.assert_not_called()
            operations.delete_key("tenant", key["id"])
            cache.assert_called_once()
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
    with sqlite_session_factory() as session:
        assert session.get(ApiToken, key["id"]) is None
