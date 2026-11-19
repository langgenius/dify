import json
from collections.abc import Callable
from datetime import datetime
from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.datasets.datasets import (
    DatasetDetailResponse,
    DatasetListResponse,
    DatasetQueryListResponse,
    RelatedAppListResponse,
)
from enums import DeploymentEdition
from machinery.context import RequestContext
from models import Account, App, Dataset, Document
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetQuery,
    DocumentSegment,
)
from models.enums import (
    CreatorUserRole,
    DatasetQuerySource,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
)
from models.model import AppMode
from repositories.app.console_repository import ConsoleAppRepository
from services.enterprise import rbac_service
from services.knowledge.dataset_access import DatasetAccess, DatasetNotFoundError
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetApplicationService, DatasetListFilter
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.entities.datasets import DatasetAvailabilityFilter, DatasetPage
from services.knowledge.entities.document_creation import DocumentIndexingJobs
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.resource_scope import DatasetRef
from services.rbac import contracts as rbac_contracts
from services.tag_application_service import CreateTagInput, TagApplicationService, TagBindingInput
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.rbac_fakes import RBACDomain

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


def dataset(**values: object) -> Dataset:
    row = Dataset(
        id="dataset",
        tenant_id="tenant",
        name="Dataset",
        created_by="actor",
        maintainer="actor",
        indexing_technique="economy",
        permission="all_team_members",
    )
    for key, value in values.items():
        setattr(row, key, value)
    return row


def document(**values: object) -> Document:
    row = Document(
        tenant_id="tenant",
        dataset_id="dataset",
        position=1,
        data_source_type=DataSourceType("local_file"),
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom("web"),
        created_by="actor",
    )
    row.id = "document"
    row.indexing_status = IndexingStatus.ERROR
    for key, value in values.items():
        setattr(row, key, value)
    return row


@pytest.fixture
def operations(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    application_tags: TagApplicationService,
    rbac_domain: RBACDomain,
) -> SQLAlchemyDatasetOperations:
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
    return SQLAlchemyDatasetOperations(
        session_factory=sqlite_session_factory,
        tags=application_tags,
        app_queries=ConsoleAppRepository(session_factory=sqlite_session_factory),
        members=rbac_domain.rbac.members,
    )


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
        CONTEXT, DatasetListFilter(page=0, limit=1000, ids=["dataset", "foreign"]), None, embedding_models=set()
    )
    response = DatasetListResponse.model_validate(result).model_dump(mode="json")
    assert response["total"] == 1
    assert response["page"] == 1
    assert response["limit"] == 100
    assert response["has_more"] is False
    assert response["data"][0]["partial_member_list"] == ["member"]
    assert response["data"][0]["retrieval_model_dict"]["top_k"] == 2


def test_listing_serializes_legacy_retrieval_settings_without_rewriting_rows(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    stored = {
        "search_method": "",
        "reranking_enable": "",
        "reranking_model": None,
        "score_threshold_enabled": "false",
        "top_k": 4,
    }
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        row.retrieval_model = stored

    result = operations.list_datasets(
        CONTEXT, DatasetListFilter(ids=["dataset", "foreign"]), None, embedding_models=set()
    )
    response = DatasetListResponse.model_validate(result).model_dump(mode="json")

    assert response["total"] == 1
    assert response["data"][0]["id"] == "dataset"
    retrieval = response["data"][0]["retrieval_model_dict"]
    assert retrieval["search_method"] == "semantic_search"
    assert retrieval["reranking_enable"] is False
    assert retrieval["score_threshold_enabled"] is False
    assert retrieval["top_k"] == 4
    with sqlite_session_factory() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        assert row.retrieval_model == stored


@pytest.mark.parametrize(
    ("edition", "community_dev_enabled", "can_upgrade"),
    [
        (DeploymentEdition.CLOUD, False, True),
        (DeploymentEdition.COMMUNITY, False, False),
        (DeploymentEdition.COMMUNITY, True, True),
    ],
)
def test_listing_upgrade_discovery_uses_server_availability(
    operations: SQLAlchemyDatasetOperations,
    monkeypatch: pytest.MonkeyPatch,
    edition: DeploymentEdition,
    community_dev_enabled: bool,
    can_upgrade: bool,
) -> None:
    apply_config_overrides(
        monkeypatch,
        DEPLOYMENT_EDITION=edition,
        KNOWLEDGE_FS_ENABLED=True,
        KNOWLEDGE_FS_COMMUNITY_DEV_ENABLED=community_dev_enabled,
    )

    result = operations.list_datasets(CONTEXT, DatasetListFilter(ids=["dataset"]), None, embedding_models=set())
    discovery = result["data"][0]["knowledge_fs_upgrade"]

    assert discovery["can_upgrade"] is can_upgrade
    assert discovery["block_reason"] == (None if can_upgrade else "feature_disabled")


@pytest.mark.parametrize("foreign_tag", [False, True])
def test_listing_filters_tags_within_workspace(
    operations: SQLAlchemyDatasetOperations,
    application_tags: TagApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    foreign_tag: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(dataset(id="untagged", name="Untagged"))
    context = RequestContext("request", None, "actor", "other") if foreign_tag else CONTEXT
    tag = application_tags.create_tag(context, CreateTagInput(name="Selected", type="knowledge"))
    application_tags.create_bindings(
        context,
        TagBindingInput(tag_ids=(tag.id,), target_id="foreign" if foreign_tag else "dataset", type="knowledge"),
    )

    result = operations.list_datasets(CONTEXT, DatasetListFilter(tag_ids=[tag.id]), None, embedding_models=set())
    response = DatasetListResponse.model_validate(result)

    assert [row.id for row in response.data] == ([] if foreign_tag else ["dataset"])
    assert response.total == (0 if foreign_tag else 1)


@pytest.mark.parametrize("ids", [[], ["dataset"]])
@pytest.mark.parametrize("maintainer", ["actor", "other"])
def test_list_visibility_restricts_even_requested_ids(
    operations: SQLAlchemyDatasetOperations,
    ids: list[str],
    maintainer: str,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        row.maintainer = maintainer
    result = operations.list_datasets(CONTEXT, DatasetListFilter(ids=["dataset"]), ids, embedding_models=set())
    assert result["total"] == (1 if maintainer == "actor" else len(ids))


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
def test_created_dataset_initializes_rbac_access(
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    entry_point: str,
    rbac_enabled: bool,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)

    def save_documents(
        created_dataset: Dataset, _config: KnowledgeConfig, _account: Account, *, session: Session
    ) -> tuple[list[Document], str, DocumentIndexingJobs]:
        row = document(id="created-document", dataset_id=created_dataset.id, data_source_type="upload_file")
        session.add(row)
        session.flush()
        return [row], "batch", DocumentIndexingJobs(DatasetRef(created_dataset.tenant_id, created_dataset.id))

    with (
        patch.object(rbac_service.RBACService.DatasetAccess, "replace_whitelist") as replace_whitelist,
        patch.object(rbac_service, "try_sync_creator_access_policy_member_bindings") as sync_creator,
        patch(
            "tasks.initialize_created_app_rbac_access_task.initialize_created_app_rbac_access_task.delay"
        ) as initialize,
        patch(
            "services.knowledge.documents.adapters.DocumentService.save_prepared_documents",
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
                rbac_contracts.ReplaceMemberBindings(automatic_include_workspace_members=False),
            )
        else:
            replace_whitelist.assert_not_called()
        if entry_point == "documents":
            if rbac_enabled:
                sync_creator.assert_called_once_with(
                    CONTEXT.active_workspace_id,
                    CONTEXT.account_id,
                    rbac_contracts.RBACResourceType.DATASET,
                    dataset_id,
                )
            else:
                sync_creator.assert_not_called()
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
                App(id="app", tenant_id="tenant", name="App", mode=AppMode.CHAT, enable_api=False, enable_site=False),
                App(
                    id="foreign-app",
                    tenant_id="other",
                    name="Other",
                    mode=AppMode.CHAT,
                    enable_api=False,
                    enable_site=False,
                ),
                AppDatasetJoin(app_id="app", dataset_id="dataset"),
                AppDatasetJoin(app_id="foreign-app", dataset_id="dataset"),
            ]
        )
    response = DatasetQueryListResponse.model_validate(operations.queries(REF, page=0, limit=0)).model_dump(mode="json")
    assert response["limit"] == 1
    assert response["has_more"] is False
    assert response["data"][0]["queries"][0]["content"] == "query"
    related = RelatedAppListResponse.model_validate(operations.related_apps(REF)).model_dump(mode="json")
    assert related["total"] == 1
    assert related["data"][0]["id"] == "app"
    assert related["data"][0]["mode"] == "chat"


ACTIVE_EMBEDDING_MODELS = {"text-embedding-3-small:langgenius/openai/openai"}


def high_quality_dataset(
    dataset_id: str,
    *,
    model: str = "text-embedding-3-small",
    provider: str = "openai",
    **values: object,
) -> Dataset:
    return dataset(
        id=dataset_id,
        name=dataset_id,
        indexing_technique="high_quality",
        embedding_model=model,
        embedding_model_provider=provider,
        **values,
    )


def list_with_availability(
    operations: SQLAlchemyDatasetOperations,
    availability: DatasetAvailabilityFilter,
    *,
    embedding_models: set[str] = ACTIVE_EMBEDDING_MODELS,
    page: int = 1,
    limit: int = 20,
    keyword: str | None = None,
    ids: list[str] | None = None,
    tag_ids: list[str] | None = None,
) -> DatasetPage:
    return operations.list_datasets(
        CONTEXT,
        DatasetListFilter(
            availability=availability,
            page=page,
            limit=limit,
            keyword=keyword,
            ids=tuple(ids or ()),
            tag_ids=tuple(tag_ids or ()),
        ),
        None,
        embedding_models=embedding_models,
    )


def test_availability_filter_is_applied_before_pagination(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        # The fixture seeds one economy dataset; these counts describe only
        # the rows this test adds.
        session.delete(session.get(Dataset, "dataset"))
        session.add_all(
            [
                high_quality_dataset("available-1"),
                high_quality_dataset("available-2"),
                high_quality_dataset("available-3"),
                high_quality_dataset("unavailable-1", model="removed-model"),
                high_quality_dataset("unavailable-2", model="removed-model"),
            ]
        )

    first_page = list_with_availability(operations, DatasetAvailabilityFilter.AVAILABLE, limit=2)
    second_page = list_with_availability(operations, DatasetAvailabilityFilter.AVAILABLE, page=2, limit=2)

    assert first_page["total"] == 3
    assert first_page["has_more"] is True
    assert len(first_page["data"]) == 2
    assert second_page["has_more"] is False
    assert {item["id"] for item in first_page["data"] + second_page["data"]} == {
        "available-1",
        "available-2",
        "available-3",
    }

    unavailable_page = list_with_availability(operations, DatasetAvailabilityFilter.UNAVAILABLE)

    assert unavailable_page["total"] == 2
    assert {item["id"] for item in unavailable_page["data"]} == {
        "unavailable-1",
        "unavailable-2",
    }

    all_page = list_with_availability(operations, DatasetAvailabilityFilter.ALL)

    assert all_page["total"] == 5


def test_availability_combines_with_keyword_and_tag_filters(
    operations: SQLAlchemyDatasetOperations,
    application_tags: TagApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                high_quality_dataset("available-handbook"),
                high_quality_dataset("available-other"),
                high_quality_dataset("unavailable-handbook", model="removed-model"),
            ]
        )
    tag = application_tags.create_tag(CONTEXT, CreateTagInput(name="Selected", type="knowledge"))
    for target_id in ("available-handbook", "unavailable-handbook"):
        application_tags.create_bindings(
            CONTEXT,
            TagBindingInput(tag_ids=(tag.id,), target_id=target_id, type="knowledge"),
        )

    result = list_with_availability(
        operations,
        DatasetAvailabilityFilter.AVAILABLE,
        keyword="handbook",
        tag_ids=[tag.id],
    )

    assert result["total"] == 1
    assert [item["id"] for item in result["data"]] == ["available-handbook"]


def test_availability_filter_preserves_permission_scope(
    operations: SQLAlchemyDatasetOperations,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    with sqlite_session_factory.begin() as session:
        session.delete(session.get(Dataset, "dataset"))
        session.add_all(
            [
                high_quality_dataset("visible"),
                high_quality_dataset("hidden", maintainer="other"),
            ]
        )

    result = operations.list_datasets(
        CONTEXT,
        DatasetListFilter(availability=DatasetAvailabilityFilter.AVAILABLE),
        ["visible"],
        embedding_models=ACTIVE_EMBEDDING_MODELS,
    )

    assert result["total"] == 1
    assert [item["id"] for item in result["data"]] == ["visible"]


def test_availability_follows_active_model_configuration(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    # A stored bare provider is normalized before the active model lookup.
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        row.indexing_technique = "high_quality"
        row.embedding_model = "text-embedding-3-small"
        row.embedding_model_provider = "openai"

    available = list_with_availability(operations, DatasetAvailabilityFilter.AVAILABLE)
    assert available["total"] == 1

    without_models = list_with_availability(
        operations,
        DatasetAvailabilityFilter.AVAILABLE,
        embedding_models=set(),
    )
    unavailable = list_with_availability(
        operations,
        DatasetAvailabilityFilter.UNAVAILABLE,
        embedding_models=set(),
    )

    assert without_models["total"] == 0
    assert unavailable["total"] == 1


def test_availability_filter_applies_to_requested_ids(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                high_quality_dataset("available"),
                high_quality_dataset("unavailable", model="removed-model"),
            ]
        )

    result = list_with_availability(
        operations,
        DatasetAvailabilityFilter.UNAVAILABLE,
        ids=["available", "unavailable"],
    )

    assert result["total"] == 1
    assert [item["id"] for item in result["data"]] == ["unavailable"]


@pytest.mark.parametrize(
    ("availability", "expected"),
    [
        (DatasetAvailabilityFilter.ALL, ["available-a", "available-b", "unavailable"]),
        (DatasetAvailabilityFilter.AVAILABLE, ["available-a", "available-b"]),
        (DatasetAvailabilityFilter.UNAVAILABLE, ["unavailable"]),
    ],
)
def test_selection_combines_requested_ids_with_availability_before_pagination(
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
    availability: DatasetAvailabilityFilter,
    expected: list[str],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                high_quality_dataset("available-b"),
                high_quality_dataset("available-a"),
                high_quality_dataset("unavailable", model="removed-model"),
                high_quality_dataset("not-requested"),
            ]
        )

    pages = [
        operations.list_datasets(
            CONTEXT,
            DatasetListFilter(
                ids=["unavailable", "available-b", "available-a", "foreign"],
                for_selection=True,
                availability=availability,
                page=page,
                limit=1,
            ),
            None,
            embedding_models=ACTIVE_EMBEDDING_MODELS,
        )
        for page in range(1, len(expected) + 1)
    ]

    assert [item["id"] for page in pages for item in page["data"]] == expected
    assert all(page["total"] == len(expected) for page in pages)
    assert [page["has_more"] for page in pages] == [True] * (len(expected) - 1) + [False]


def test_availability_filter_agrees_with_card_availability(
    operations: SQLAlchemyDatasetOperations,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    def active_embedding_models(_self: SQLAlchemyDatasetOperations, _workspace_id: str) -> set[str]:
        return ACTIVE_EMBEDDING_MODELS

    monkeypatch.setattr(SQLAlchemyDatasetOperations, "embedding_models", active_embedding_models)
    with sqlite_session_factory.begin() as session:
        session.delete(session.get(Dataset, "dataset"))
        session.add_all(
            [
                high_quality_dataset("available"),
                high_quality_dataset("unavailable", model="removed-model"),
                dataset(id="economy", name="economy"),
            ]
        )
    service = DatasetApplicationService(
        dataset_access=create_autospec(DatasetAccess, instance=True, spec_set=True),
        operations=operations,
        rbac_enabled=False,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
    )

    unavailable = service.list_datasets(CONTEXT, DatasetListFilter(availability=DatasetAvailabilityFilter.UNAVAILABLE))
    available = service.list_datasets(CONTEXT, DatasetListFilter(availability=DatasetAvailabilityFilter.AVAILABLE))

    assert unavailable["total"] == 1
    assert [item["id"] for item in unavailable["data"]] == ["unavailable"]
    assert all(item["embedding_available"] is False for item in unavailable["data"])
    assert available["total"] == 2
    assert {item["id"] for item in available["data"]} == {"available", "economy"}
    assert all(item["embedding_available"] is True for item in available["data"])


def test_availability_normalizes_legacy_embedding_provider_ids(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.delete(session.get(Dataset, "dataset"))
        session.add_all(
            [
                high_quality_dataset("bare", provider="openai"),
                high_quality_dataset("legacy-google", provider="langgenius/google/google"),
            ]
        )

    result = operations.list_datasets(
        CONTEXT,
        DatasetListFilter(availability=DatasetAvailabilityFilter.AVAILABLE),
        None,
        embedding_models={
            "text-embedding-3-small:langgenius/openai/openai",
            "text-embedding-3-small:langgenius/gemini/google",
        },
    )

    assert {item["id"] for item in result["data"]} == {"bare", "legacy-google"}


def test_query_history_pagination_preserves_invalid_image_records(
    operations: SQLAlchemyDatasetOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    contents = [
        "legacy text",
        json.dumps(
            [{"content_type": "text_query", "content": "example"}, {"content_type": "image_query", "content": ""}]
        ),
    ]
    ids = []
    with sqlite_session_factory.begin() as session:
        for day, content in enumerate(contents, 1):
            row = DatasetQuery(
                dataset_id="dataset",
                content=content,
                source=DatasetQuerySource.HIT_TESTING,
                source_app_id=None,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by="actor",
            )
            row.created_at = datetime(2026, 1, day)
            session.add(row)
            session.flush()
            ids.append(row.id)
    first = DatasetQueryListResponse.model_validate(operations.queries(REF, page=1, limit=1))
    second = DatasetQueryListResponse.model_validate(operations.queries(REF, page=2, limit=1))
    assert (first.total, first.page, first.limit, first.has_more) == (2, 1, 1, True)
    assert (second.total, second.page, second.limit, second.has_more) == (2, 2, 1, False)
    assert [first.data[0].id, second.data[0].id] == list(reversed(ids))
    assert [item.content for item in first.data[0].queries] == ["example", ""]
    assert first.data[0].queries[1].file_info is None
    assert second.data[0].queries[0].content == "legacy text"
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(DatasetQuery.content).order_by(DatasetQuery.created_at))) == contents
