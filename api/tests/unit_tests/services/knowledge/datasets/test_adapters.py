import json
from collections.abc import Callable
from unittest.mock import patch

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.console.datasets.datasets import (
    DatasetDetailResponse,
    DatasetListResponse,
    DatasetQueryListResponse,
    DatasetUpdatePayload,
    RelatedAppListResponse,
)
from enums import DeploymentEdition
from enums.creator import CreatorUserRole
from fields.service_api.dataset import DatasetCreatePayload as ServiceDatasetCreatePayload
from fields.service_api.dataset import DatasetUpdatePayload as ServiceDatasetUpdatePayload
from machinery.context import RequestContext
from models import Account, App, Dataset, Document
from models.account import Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import (
    AppDatasetJoin,
    DatasetPermission,
    DatasetPermissionEnum,
    DatasetQuery,
    DocumentSegment,
    ExternalKnowledgeApis,
    ExternalKnowledgeBindings,
)
from models.enums import (
    ApiTokenType,
    DatasetQuerySource,
    DataSourceType,
    DocumentCreatedFrom,
    IndexingStatus,
    SegmentStatus,
)
from models.model import ApiToken, AppMode, DatasetApiTokenBinding
from models.resource_access_token import ResourceAccessToken, ResourceAccessTokenRelation
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import (
    SQLAlchemyDatasetRepository,
    SQLAlchemyRagPipelineDatasetUpdates,
)
from services.enterprise import rbac_service
from services.enterprise.base import EnterpriseRequest
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccessSnapshot,
    DatasetNotFoundError,
)
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetApplicationService, prepare_rag_pipeline_dataset_update
from services.knowledge.datasets.contracts import (
    DatasetIndexAction,
    DatasetListFilter,
    RagPipelineDatasetSettings,
)
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.model_configuration import EmbeddingModelConfiguration
from services.knowledge.entities.resource_scope import DatasetRef
from services.rbac import contracts as rbac_contracts
from services.tag_application_service import CreateTagInput, TagApplicationService, TagBindingInput
from tests.helpers.unit.config_override import apply_config_overrides
from tests.helpers.unit.rbac_fakes import RBACDomain

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


class AllowAllDatasetAccess:
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        return AccessibleDataset(dataset_id, context.active_workspace_id)

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        return AccessibleDataset(snapshot.dataset.id, context.active_workspace_id)


class RecordingModelConfiguration:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self.before_resolve: Callable[[], None] | None = None
        self.supports_vision = False

    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration:
        del tenant_id
        self.calls.append("embedding")
        if self.before_resolve is not None:
            self.before_resolve()
        return EmbeddingModelConfiguration("provider", "embedding", self.supports_vision)

    def resolve_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> EmbeddingModelConfiguration:
        del tenant_id
        self.calls.append("embedding")
        if self.before_resolve is not None:
            self.before_resolve()
        return EmbeddingModelConfiguration(provider, model, self.supports_vision)

    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        del tenant_id, provider, model
        self.calls.append("reranking")


class RecordingDatasetCleanup:
    def __init__(self) -> None:
        self.calls: list[DatasetCleanupRecord] = []
        self.before_cleanup: Callable[[DatasetCleanupRecord], None] | None = None

    def __call__(self, cleanup: DatasetCleanupRecord) -> None:
        if self.before_cleanup is not None:
            self.before_cleanup(cleanup)
        self.calls.append(cleanup)


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


def external_api(api_id: str, *, tenant_id: str = "tenant") -> ExternalKnowledgeApis:
    row = ExternalKnowledgeApis(
        tenant_id=tenant_id,
        created_by=CONTEXT.account_id,
        updated_by=CONTEXT.account_id,
        name=api_id,
        description="",
        settings="{}",
    )
    row.id = api_id
    return row


@pytest.fixture
def cleanup_dataset() -> RecordingDatasetCleanup:
    return RecordingDatasetCleanup()


@pytest.fixture
def mutations(
    sqlite_session_factory: sessionmaker[Session],
) -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
    )


def _ignore_index_update(
    session: Session,
    *,
    dataset_id: str,
    action: DatasetIndexAction | None,
    from_rag_pipeline: bool,
) -> None:
    del session, dataset_id, action, from_rag_pipeline


@pytest.fixture
def rag_pipeline_updates(
    sqlite_session_factory: sessionmaker[Session],
    operations: SQLAlchemyDatasetOperations,
) -> SQLAlchemyRagPipelineDatasetUpdates:
    del operations
    return SQLAlchemyRagPipelineDatasetUpdates(
        session_factory=sqlite_session_factory,
        index_update_after_commit=_ignore_index_update,
    )


@pytest.fixture
def operations(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    application_tags: TagApplicationService,
    rbac_domain: RBACDomain,
    mutations: SQLAlchemyDatasetRepository,
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
        datasets=mutations,
    )


@pytest.fixture
def model_configuration() -> RecordingModelConfiguration:
    return RecordingModelConfiguration()


@pytest.fixture
def service(
    operations: SQLAlchemyDatasetOperations,
    mutations: SQLAlchemyDatasetRepository,
    model_configuration: RecordingModelConfiguration,
    cleanup_dataset: RecordingDatasetCleanup,
) -> DatasetApplicationService:
    return DatasetApplicationService(
        dataset_access=AllowAllDatasetAccess(),
        operations=operations,
        mutations=mutations,
        models=model_configuration,
        cleanup_dataset=cleanup_dataset,
        rbac_enabled=False,
        service_api_url="",
        vector_store="milvus",
        tidb_fulltext=False,
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
                DatasetPermission(tenant_id="tenant", dataset_id="dataset", account_id="actor"),
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
    assert response["data"][0]["partial_member_list"] == ["actor", "member"]
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

    result = operations.list_datasets(CONTEXT, DatasetListFilter(ids=["dataset", "foreign"]), None, False)
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

    result = operations.list_datasets(CONTEXT, DatasetListFilter(ids=["dataset"]), None, False)
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

    result = operations.list_datasets(CONTEXT, DatasetListFilter(tag_ids=[tag.id]), None, False)
    response = DatasetListResponse.model_validate(result)

    assert [row.id for row in response.data] == ([] if foreign_tag else ["dataset"])
    assert response.total == (0 if foreign_tag else 1)


def test_listing_requires_all_selected_tags(
    operations: SQLAlchemyDatasetOperations,
    application_tags: TagApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(dataset(id="single-tag", name="Single tag"))
    first = application_tags.create_tag(CONTEXT, CreateTagInput(name="First", type="knowledge"))
    second = application_tags.create_tag(CONTEXT, CreateTagInput(name="Second", type="knowledge"))
    application_tags.create_bindings(
        CONTEXT,
        TagBindingInput(tag_ids=(first.id, second.id), target_id="dataset", type="knowledge"),
    )
    application_tags.create_bindings(
        CONTEXT,
        TagBindingInput(tag_ids=(first.id,), target_id="single-tag", type="knowledge"),
    )

    result = operations.list_datasets(
        CONTEXT,
        DatasetListFilter(tag_ids=(first.id, second.id)),
        None,
        False,
    )

    assert [row["id"] for row in result["data"]] == ["dataset"]


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
    result = operations.list_datasets(CONTEXT, DatasetListFilter(ids=["dataset"]), ids, True)
    assert result["total"] == (1 if maintainer == "actor" else len(ids))


@pytest.mark.parametrize("requested_ids", [[], ["dataset", "unbound"]])
@pytest.mark.parametrize("bound_ids", [[], ["dataset"]])
def test_binding_scope_restricts_paginated_and_explicit_lists_without_rbac(
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
    requested_ids: list[str],
    bound_ids: list[str],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(dataset(id="unbound", name="Unbound"))

    result = operations.list_datasets(
        CONTEXT,
        DatasetListFilter(ids=requested_ids, include_all=True),
        bound_ids,
        False,
    )

    assert [row["id"] for row in result["data"]] == bound_ids
    assert result["total"] == len(bound_ids)


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
    ],
)
def test_wrong_tenant_ref_cannot_read_or_write(operations: SQLAlchemyDatasetOperations, method: str) -> None:
    args: list[object] = [CONTEXT] if method == "get_dataset" else []
    args.append(DatasetRef("other", "dataset"))
    extra: dict[str, int] = {"page": 1, "limit": 20} if method == "queries" else {}
    methods: dict[str, Callable[..., object]] = {
        "get_dataset": operations.get_dataset,
        "is_in_use": operations.is_in_use,
        "queries": operations.queries,
        "related_apps": operations.related_apps,
        "indexing_status": operations.indexing_status,
        "error_documents": operations.error_documents,
        "partial_members": operations.partial_members,
    }
    with pytest.raises(DatasetNotFoundError):
        methods[method](*args, **extra)


def test_create_update_and_api_status_commit_owned_changes(
    service: DatasetApplicationService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    created = service.create_dataset_with_requested_permission(
        CONTEXT,
        values={"name": "Created", "description": "desc", "indexing_technique": "economy", "permission": "only_me"},
    )
    assert DatasetDetailResponse.model_validate(created).name == "Created"
    result = service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={"name": "Renamed", "permission": "all_team_members"},
    )
    assert result["name"] == "Renamed"
    service.set_api_enabled(CONTEXT, dataset_id=REF.dataset_id, status="enable")
    with sqlite_session_factory() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        assert row.name == "Renamed"
        assert row.enable_api is True
        assert session.get(Dataset, created["id"]) is not None


def test_economy_update_accepts_console_empty_embedding_configuration(
    service: DatasetApplicationService,
    model_configuration: RecordingModelConfiguration,
) -> None:
    payload = DatasetUpdatePayload(
        name="Renamed",
        indexing_technique="economy",
        embedding_model="",
        embedding_model_provider="",
    )

    result = service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values=payload.model_dump(exclude_unset=True),
    )

    assert result["name"] == "Renamed"
    assert model_configuration.calls == []


def test_dataset_detail_response_does_not_expose_vector_indexing_fields(
    operations: SQLAlchemyDatasetOperations,
) -> None:
    detail = operations.get_dataset(CONTEXT, REF)
    response_payload: dict[str, object] = dict(detail)
    response_payload["vector_indexing_status"] = "error"
    response_payload["vector_indexing_error"] = "internal provider failure"

    response = DatasetDetailResponse.model_validate(response_payload).model_dump(mode="json")

    assert "vector_indexing_status" not in response
    assert "vector_indexing_error" not in response


@pytest.mark.parametrize("payload_type", [DatasetUpdatePayload, ServiceDatasetUpdatePayload])
@pytest.mark.parametrize("indexing_technique", ["high_quality", "economy"])
def test_explicit_null_patch_preserves_existing_index_configuration(
    service: DatasetApplicationService,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
    payload_type: type[DatasetUpdatePayload] | type[ServiceDatasetUpdatePayload],
    indexing_technique: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.indexing_technique = indexing_technique
        row.description = "Previous description"
        row.embedding_model_provider = "provider" if indexing_technique == "high_quality" else None
        row.embedding_model = "embedding" if indexing_technique == "high_quality" else None
        row.collection_binding_id = "binding" if indexing_technique == "high_quality" else None
        row.is_multimodal = indexing_technique == "high_quality"
        row.retrieval_model = {"top_k": 5}
        row.summary_index_setting = {"enable": True}
        row.icon_info = {"icon_type": "emoji", "icon": "📙"}

    payload = payload_type.model_validate(
        {
            "name": "Renamed",
            "description": None,
            "indexing_technique": None,
            "embedding_model_provider": None,
            "embedding_model": None,
            "is_multimodal": None,
            "retrieval_model": None,
            "summary_index_setting": None,
            "icon_info": None,
        }
    )
    values = payload.model_dump(exclude_unset=True)

    service.update_dataset(CONTEXT, dataset_id=REF.dataset_id, values=values)

    with sqlite_session_factory() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        high_quality = indexing_technique == "high_quality"
        assert row.name == "Renamed"
        assert row.description is None
        assert row.indexing_technique == indexing_technique
        assert row.embedding_model_provider == ("provider" if high_quality else None)
        assert row.embedding_model == ("embedding" if high_quality else None)
        assert row.collection_binding_id == ("binding" if high_quality else None)
        assert row.is_multimodal is high_quality
        assert row.retrieval_model == {"top_k": 5}
        assert row.summary_index_setting == {"enable": True}
        assert row.icon_info == {"icon_type": "emoji", "icon": "📙"}
    assert model_configuration.calls == []
    assert values["indexing_technique"] is None


def test_explicit_false_patch_is_persisted(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.get_one(Dataset, REF.dataset_id).is_multimodal = True

    service.update_dataset(CONTEXT, dataset_id=REF.dataset_id, values={"is_multimodal": False})

    with sqlite_session_factory() as session:
        assert session.get_one(Dataset, REF.dataset_id).is_multimodal is False


def test_external_dataset_update_commits_binding_and_retrieval_configuration(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        row.provider = "external"
        external_api = ExternalKnowledgeApis(
            tenant_id=REF.tenant_id,
            created_by=CONTEXT.account_id,
            updated_by=CONTEXT.account_id,
            name="External API",
            description="",
            settings=json.dumps({"endpoint": "https://example.com", "api_key": "secret"}),
        )
        external_api.id = "external-api"
        session.add_all(
            [
                external_api,
                ExternalKnowledgeBindings(
                    tenant_id=REF.tenant_id,
                    dataset_id=REF.dataset_id,
                    created_by=CONTEXT.account_id,
                    external_knowledge_api_id="external-api",
                    external_knowledge_id="old-knowledge",
                ),
            ]
        )

    service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={
            "name": "External dataset",
            "external_knowledge_api_id": "external-api",
            "external_knowledge_id": "new-knowledge",
            "external_retrieval_model": {"top_k": 5},
        },
    )

    with sqlite_session_factory() as session:
        row = session.get(Dataset, REF.dataset_id)
        binding = session.scalar(
            select(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.dataset_id == REF.dataset_id)
        )
        assert row is not None
        assert row.name == "External dataset"
        assert row.retrieval_model == {"top_k": 5}
        assert binding is not None
        assert binding.external_knowledge_api_id == "external-api"
        assert binding.external_knowledge_id == "new-knowledge"


@pytest.mark.parametrize(
    ("values", "expected_name", "expected_description"),
    [
        ({"name": "Renamed external dataset"}, "Renamed external dataset", None),
        ({"description": "Updated description"}, "Dataset", "Updated description"),
        (
            {"name": "Null IDs preserve binding", "external_knowledge_api_id": None, "external_knowledge_id": None},
            "Null IDs preserve binding",
            None,
        ),
    ],
)
def test_external_dataset_partial_details_preserve_omitted_binding_fields(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    values: dict[str, object],
    expected_name: str,
    expected_description: str | None,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.provider = "external"
        external_api_row = external_api("external-api")
        session.add_all(
            [
                external_api_row,
                ExternalKnowledgeBindings(
                    tenant_id=REF.tenant_id,
                    dataset_id=REF.dataset_id,
                    created_by=CONTEXT.account_id,
                    external_knowledge_api_id=external_api_row.id,
                    external_knowledge_id="current-knowledge",
                ),
            ]
        )

    service.update_dataset(CONTEXT, dataset_id=REF.dataset_id, values=values)

    with sqlite_session_factory() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        binding = session.scalar(
            select(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.dataset_id == REF.dataset_id)
        )
        assert row.name == expected_name
        assert row.description == expected_description
        assert binding is not None
        assert binding.external_knowledge_api_id == "external-api"
        assert binding.external_knowledge_id == "current-knowledge"


@pytest.mark.parametrize(
    ("values", "expected_api_id", "expected_knowledge_id"),
    [
        ({"external_knowledge_api_id": "replacement-api"}, "replacement-api", "current-knowledge"),
        ({"external_knowledge_id": "replacement-knowledge"}, "current-api", "replacement-knowledge"),
    ],
)
def test_external_dataset_can_replace_one_binding_identity_field(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    values: dict[str, object],
    expected_api_id: str,
    expected_knowledge_id: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.provider = "external"
        session.add_all([external_api(api_id) for api_id in ("current-api", "replacement-api")])
        session.add(
            ExternalKnowledgeBindings(
                tenant_id=REF.tenant_id,
                dataset_id=REF.dataset_id,
                created_by=CONTEXT.account_id,
                external_knowledge_api_id="current-api",
                external_knowledge_id="current-knowledge",
            )
        )

    service.update_dataset(CONTEXT, dataset_id=REF.dataset_id, values=values)

    with sqlite_session_factory() as session:
        binding = session.scalar(
            select(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.dataset_id == REF.dataset_id)
        )
        assert binding is not None
        assert binding.external_knowledge_api_id == expected_api_id
        assert binding.external_knowledge_id == expected_knowledge_id


def test_external_dataset_rejects_cross_tenant_api_replacement(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.provider = "external"
        session.add_all(
            [
                external_api("current-api"),
                external_api("foreign-api", tenant_id="other"),
                ExternalKnowledgeBindings(
                    tenant_id=REF.tenant_id,
                    dataset_id=REF.dataset_id,
                    created_by=CONTEXT.account_id,
                    external_knowledge_api_id="current-api",
                    external_knowledge_id="current-knowledge",
                ),
            ]
        )

    with pytest.raises(ValueError, match="External API template not found"):
        service.update_dataset(
            CONTEXT,
            dataset_id=REF.dataset_id,
            values={"external_knowledge_api_id": "foreign-api"},
        )

    with sqlite_session_factory() as session:
        binding = session.scalar(
            select(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.dataset_id == REF.dataset_id)
        )
        assert binding is not None
        assert binding.external_knowledge_api_id == "current-api"
        assert binding.external_knowledge_id == "current-knowledge"


@pytest.mark.parametrize(
    ("values", "create_api", "message"),
    [
        ({"external_knowledge_api_id": ""}, False, "External knowledge api id is required"),
        ({"external_knowledge_id": ""}, False, "External knowledge id is required"),
        (
            {"external_knowledge_api_id": "missing", "external_knowledge_id": "knowledge"},
            False,
            "External API template not found",
        ),
        (
            {"external_knowledge_api_id": "external-api", "external_knowledge_id": "knowledge"},
            True,
            "External knowledge binding not found",
        ),
    ],
)
def test_external_dataset_update_rejects_invalid_or_stale_binding(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    values: dict[str, object],
    create_api: bool,
    message: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        row.provider = "external"
        if create_api:
            external_api = ExternalKnowledgeApis(
                tenant_id=REF.tenant_id,
                created_by=CONTEXT.account_id,
                updated_by=CONTEXT.account_id,
                name="External API",
                description="",
                settings="{}",
            )
            external_api.id = "external-api"
            session.add(external_api)

    with pytest.raises(ValueError, match=message):
        service.update_dataset(CONTEXT, dataset_id=REF.dataset_id, values=values)


def test_high_quality_update_preserves_omitted_model_and_allows_clearing_description(
    service: DatasetApplicationService,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "provider"
        row.embedding_model = "embedding"
        row.collection_binding_id = "binding"

    service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={
            "name": "Renamed",
            "description": None,
            "indexing_technique": "high_quality",
            "embedding_model_provider": None,
            "embedding_model": None,
            "retrieval_model": {"top_k": 4},
        },
    )

    with sqlite_session_factory() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        assert row.name == "Renamed"
        assert row.description is None
        assert row.embedding_model_provider == "provider"
        assert row.embedding_model == "embedding"
        assert row.collection_binding_id == "binding"
        assert row.retrieval_model == {"top_k": 4}
    assert model_configuration.calls == []


def test_high_quality_to_economy_update_clears_model_configuration(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "provider"
        row.embedding_model = "embedding"
        row.collection_binding_id = "binding"

    service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={"indexing_technique": "economy", "retrieval_model": {"top_k": 2}},
    )

    with sqlite_session_factory() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        assert row.indexing_technique == "economy"
        assert row.embedding_model_provider is None
        assert row.embedding_model is None
        assert row.collection_binding_id is None


def test_high_quality_create_resolves_embedding_and_validates_reranking(
    service: DatasetApplicationService,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    model_configuration.supports_vision = True

    result = service.create_dataset_with_requested_permission(
        CONTEXT,
        values={
            "name": "Created HQ",
            "indexing_technique": "high_quality",
            "embedding_model_provider": "langgenius/embedding/embedding",
            "embedding_model": "embedding",
            "retrieval_model": {
                "reranking_model": {
                    "reranking_provider_name": "provider/rerank",
                    "reranking_model_name": "rerank",
                }
            },
        },
    )

    assert model_configuration.calls == ["embedding", "reranking"]
    with sqlite_session_factory() as session:
        row = session.get(Dataset, result["id"])
        assert row is not None
        assert row.embedding_model_provider == "langgenius/embedding/embedding"
        assert row.embedding_model == "embedding"
        assert row.is_multimodal is True


def test_rag_pipeline_create_generates_incremental_name_and_initializes_creator_access(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    with sqlite_session_factory.begin() as session:
        session.add(dataset(id="untitled", name="Untitled 1"))

    with (
        patch.object(rbac_service.RBACService.DatasetAccess, "replace_whitelist") as replace_whitelist,
        patch.object(rbac_service, "sync_creator_access_policy_member_bindings") as sync_creator,
    ):
        result = service.create_rag_pipeline_dataset(
            CONTEXT,
            values={
                "name": None,
                "description": "Pipeline dataset",
                "permission": "partial_members",
                "icon_info": {"icon": "📘", "icon_type": "emoji"},
                "partial_member_list": ["member"],
            },
        )

    assert result["name"] == "Untitled 2"
    replace_whitelist.assert_called_once()
    sync_creator.assert_called_once()
    with sqlite_session_factory() as session:
        row = session.get(Dataset, result["id"])
        assert row is not None
        assert row.pipeline_id is not None
        assert row.permission == DatasetPermissionEnum.PARTIAL_TEAM
        assert (
            session.scalar(select(DatasetPermission.account_id).where(DatasetPermission.dataset_id == row.id))
            == "member"
        )


def test_update_model_provider_calls_run_after_snapshot_session_is_released(
    service: DatasetApplicationService,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    assert isinstance(sqlite_engine.pool, QueuePool)

    def change_snapshot_during_first_resolution() -> None:
        assert sqlite_engine.pool.checkedout() == 0
        if model_configuration.calls.count("embedding") == 1:
            with sqlite_session_factory.begin() as session:
                row = session.get(Dataset, REF.dataset_id)
                assert row is not None
                row.embedding_model = "concurrent-change"

    model_configuration.before_resolve = change_snapshot_during_first_resolution

    result = service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={
            "indexing_technique": "high_quality",
            "embedding_model_provider": "langgenius/openai/openai",
            "embedding_model": "embedding",
            "retrieval_model": {
                "reranking_model": {
                    "reranking_provider_name": "provider/rerank",
                    "reranking_model_name": "rerank",
                }
            },
        },
    )

    assert result["indexing_technique"] == "high_quality"
    assert model_configuration.calls == ["embedding", "reranking"] * 2


def test_prepare_and_stage_rag_pipeline_settings_in_caller_transaction(
    rag_pipeline_updates: SQLAlchemyRagPipelineDatasetUpdates,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    model_configuration.supports_vision = True
    snapshot = rag_pipeline_updates.get_update_snapshot(REF)
    assert snapshot is not None
    change = prepare_rag_pipeline_dataset_update(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        actor_id=CONTEXT.account_id,
        snapshot=snapshot,
        settings=RagPipelineDatasetSettings(
            chunk_structure="paragraph",
            indexing_technique="high_quality",
            embedding_model_provider="provider",
            embedding_model="embedding",
            keyword_number=None,
            retrieval_model={"top_k": 3},
            summary_index_setting={"enable": True},
        ),
        has_published=True,
        models=model_configuration,
    )

    with sqlite_session_factory.begin() as session:
        assert rag_pipeline_updates.stage_rag_pipeline_dataset_settings(session, change=change) is True

    with sqlite_session_factory() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        assert row.indexing_technique == "high_quality"
        assert row.embedding_model_provider == "provider"
        assert row.embedding_model == "embedding"
        assert row.is_multimodal is True
        assert row.collection_binding_id is not None


def test_stage_rag_pipeline_settings_rejects_a_changed_snapshot(
    rag_pipeline_updates: SQLAlchemyRagPipelineDatasetUpdates,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    snapshot = rag_pipeline_updates.get_update_snapshot(REF)
    assert snapshot is not None
    change = prepare_rag_pipeline_dataset_update(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        actor_id=CONTEXT.account_id,
        snapshot=snapshot,
        settings=RagPipelineDatasetSettings(
            chunk_structure="paragraph",
            indexing_technique="economy",
            embedding_model_provider=None,
            embedding_model=None,
            keyword_number=10,
            retrieval_model={"top_k": 3},
        ),
        has_published=False,
        models=model_configuration,
    )
    with sqlite_session_factory.begin() as concurrent:
        row = concurrent.get_one(Dataset, REF.dataset_id)
        row.name = "changed while model settings were being prepared"

    with sqlite_session_factory.begin() as staging:
        assert rag_pipeline_updates.stage_rag_pipeline_dataset_settings(staging, change=change) is False


@pytest.mark.parametrize(
    ("dataset_values", "settings", "message"),
    [
        (
            {"chunk_structure": "paragraph"},
            RagPipelineDatasetSettings(
                chunk_structure="sentence",
                indexing_technique="economy",
                embedding_model_provider=None,
                embedding_model=None,
                keyword_number=10,
                retrieval_model={},
            ),
            "Chunk structure is not allowed",
        ),
        (
            {"chunk_structure": "paragraph", "indexing_technique": "high_quality"},
            RagPipelineDatasetSettings(
                chunk_structure="paragraph",
                indexing_technique="economy",
                embedding_model_provider=None,
                embedding_model=None,
                keyword_number=10,
                retrieval_model={},
            ),
            "not allowed to be updated to economy",
        ),
    ],
)
def test_published_rag_pipeline_settings_reject_incompatible_changes(
    rag_pipeline_updates: SQLAlchemyRagPipelineDatasetUpdates,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
    dataset_values: dict[str, object],
    settings: RagPipelineDatasetSettings,
    message: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        for key, value in dataset_values.items():
            setattr(row, key, value)

    snapshot = rag_pipeline_updates.get_update_snapshot(REF)
    assert snapshot is not None
    with pytest.raises(ValueError, match=message):
        prepare_rag_pipeline_dataset_update(
            tenant_id=REF.tenant_id,
            dataset_id=REF.dataset_id,
            actor_id=CONTEXT.account_id,
            snapshot=snapshot,
            settings=settings,
            has_published=True,
            models=model_configuration,
        )


def test_service_core_create_compensates_when_creator_rbac_initialization_fails(
    service: DatasetApplicationService,
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    cleanup_dataset: RecordingDatasetCleanup,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    rbac_domain.transport.failure = RuntimeError("RBAC unavailable")
    payload = ServiceDatasetCreatePayload(name="Service dataset", permission="only_me")
    values = payload.model_dump()
    values["permission"] = str(payload.permission) if payload.permission else None
    values["retrieval_model"] = payload.retrieval_model

    with pytest.raises(RuntimeError, match="RBAC unavailable"):
        service.create_dataset_with_requested_permission(CONTEXT, values=values)
    assert len(cleanup_dataset.calls) == 1
    cleanup = cleanup_dataset.calls[0]
    assert cleanup.workspace_id == CONTEXT.active_workspace_id
    with sqlite_session_factory() as session:
        assert session.scalar(select(Dataset.id).where(Dataset.name == "Service dataset")) is None


def test_create_compensates_when_creator_policy_sync_fails_after_whitelist_initialization(
    service: DatasetApplicationService,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    cleanup_dataset: RecordingDatasetCleanup,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    payload = ServiceDatasetCreatePayload(name="Creator sync failure", permission="only_me")
    values = payload.model_dump()
    values["permission"] = str(payload.permission) if payload.permission else None
    values["retrieval_model"] = payload.retrieval_model
    requested_endpoints: list[str] = []
    created_dataset_id: str | None = None

    def send_rbac_request(method: str, endpoint: str, **kwargs: object) -> dict[str, object]:
        nonlocal created_dataset_id
        requested_endpoints.append(endpoint)
        if endpoint == "/rbac/datasets/whitelist":
            assert method == "PUT"
            params = kwargs.get("params")
            assert isinstance(params, dict)
            created_dataset_id = params.get("dataset_id")
            assert isinstance(created_dataset_id, str)
            return {}
        if endpoint == "/rbac/access-policies/creator-member-bindings":
            assert method == "PUT"
            params = kwargs.get("params")
            assert isinstance(params, dict)
            dataset_id = params.get("dataset_id")
            assert dataset_id == created_dataset_id
            return {
                "data": [
                    {
                        "id": "creator-binding",
                        "tenant_id": CONTEXT.active_workspace_id,
                        "access_policy_id": "creator-policy",
                        "resource_type": "dataset",
                        "resource_id": dataset_id,
                        "account_id": CONTEXT.account_id,
                    }
                ]
            }
        if endpoint == "/rbac/datasets/whitelist/members/batch":
            assert method == "POST"
            assert created_dataset_id is not None
            assert kwargs.get("json") == {
                "data": [
                    {
                        "dataset_id": created_dataset_id,
                        "account_ids": [CONTEXT.account_id],
                        "policy_id": "creator-policy",
                    }
                ]
            }
            raise RuntimeError("creator policy sync unavailable")
        raise AssertionError(f"unexpected RBAC endpoint: {endpoint}")

    with (
        patch.object(
            EnterpriseRequest,
            "send_inner_rbac_request",
            side_effect=send_rbac_request,
        ),
        pytest.raises(RuntimeError, match="creator policy sync unavailable"),
    ):
        service.create_dataset_with_requested_permission(CONTEXT, values=values)

    assert requested_endpoints == [
        "/rbac/datasets/whitelist",
        "/rbac/access-policies/creator-member-bindings",
        "/rbac/datasets/whitelist/members/batch",
    ]
    assert len(cleanup_dataset.calls) == 1
    cleanup = cleanup_dataset.calls[0]
    assert cleanup.workspace_id == CONTEXT.active_workspace_id
    with sqlite_session_factory() as session:
        assert session.scalar(select(Dataset.id).where(Dataset.name == "Creator sync failure")) is None


def test_service_core_get_releases_session_before_plugin_io_and_skips_console_rbac(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert isinstance(sqlite_engine.pool, QueuePool)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    rbac_domain.transport.failure = RuntimeError("RBAC unavailable")
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "langgenius/openai/openai"
        row.embedding_model = "embedding"

    class Configurations:
        def get_models(self, *, model_type: object, only_active: bool) -> list[object]:
            del model_type, only_active
            assert sqlite_engine.pool.checkedout() == 0
            return []

    class ProviderManager:
        def get_configurations(self, *, tenant_id: str) -> Configurations:
            assert tenant_id == CONTEXT.active_workspace_id
            assert sqlite_engine.pool.checkedout() == 0
            return Configurations()

    def provider_manager(*, tenant_id: str) -> ProviderManager:
        assert tenant_id == CONTEXT.active_workspace_id
        return ProviderManager()

    monkeypatch.setattr(
        "services.knowledge.datasets.adapters.create_plugin_provider_manager",
        provider_manager,
    )
    result = service.get_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
    )

    assert result["embedding_available"] is False
    assert rbac_domain.transport.requests == []


def test_external_dataset_create_rolls_back_when_binding_validation_fails(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with pytest.raises(ValueError, match="External API template not found"):
        service.create_dataset_with_requested_permission(
            CONTEXT,
            values={
                "name": "External dataset",
                "description": "",
                "indexing_technique": None,
                "permission": "only_me",
                "provider": "external",
                "external_knowledge_api_id": "missing",
                "external_knowledge_id": "remote-dataset",
            },
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(Dataset).where(Dataset.name == "External dataset")) is None


@pytest.mark.parametrize("rbac_enabled", [False, True])
def test_created_dataset_initializes_rbac_access(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    rbac_enabled: bool,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=rbac_enabled)

    with (
        patch.object(rbac_service.RBACService.DatasetAccess, "replace_whitelist") as replace_whitelist,
        patch.object(rbac_service, "sync_creator_access_policy_member_bindings") as sync_creator,
    ):
        result = service.create_dataset_with_requested_permission(
            CONTEXT,
            values={"name": "Created", "description": "desc", "indexing_technique": "economy", "permission": "only_me"},
        )
        dataset_id = result["id"]
        if rbac_enabled:
            replace_whitelist.assert_called_once_with(
                CONTEXT.active_workspace_id,
                CONTEXT.account_id,
                dataset_id,
                rbac_contracts.ReplaceMemberBindings(automatic_include_workspace_members=False),
            )
        else:
            replace_whitelist.assert_not_called()
        if rbac_enabled:
            sync_creator.assert_called_once_with(
                CONTEXT.active_workspace_id,
                CONTEXT.account_id,
                rbac_contracts.RBACResourceType.DATASET,
                dataset_id,
            )
        else:
            sync_creator.assert_not_called()

    with sqlite_session_factory() as session:
        assert session.get(Dataset, dataset_id) is not None


def test_partial_members_update_and_clear_are_committed(
    service: DatasetApplicationService, sqlite_session_factory: sessionmaker[Session]
) -> None:
    result = service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={"permission": "partial_members", "partial_member_list": [{"user_id": "actor"}]},
    )
    assert result["partial_member_list"] == ["actor"]
    result = service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={"permission": "all_team_members"},
    )
    assert result.get("partial_member_list", []) == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DatasetPermission)) == 0


def test_delete_dataset_atomically_removes_permissions_and_dispatches_cleanup(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    cleanup_dataset: RecordingDatasetCleanup,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        row.indexing_technique = "high_quality"
        row.chunk_structure = "text_model"
        api_token = ApiToken(id="api-token", tenant_id="tenant", type=ApiTokenType.DATASET, token="dataset-token")
        resource_token = ResourceAccessToken(
            id="resource-token",
            tenant_id="tenant",
            name="Bound token",
            track_id="track",
            token="sk-resource-token",
            created_by="actor",
        )
        session.add_all(
            [
                DatasetPermission(tenant_id="tenant", dataset_id="dataset", account_id="actor"),
                api_token,
                DatasetApiTokenBinding(api_token_id=api_token.id, dataset_id="dataset"),
                resource_token,
                ResourceAccessTokenRelation(
                    token_id=resource_token.id,
                    resource_type=ResourceAccessTokenResourceType.KNOWLEDGE,
                    dataset_id="dataset",
                ),
            ]
        )

    committed: list[bool] = []

    def assert_committed(_cleanup: DatasetCleanupRecord) -> None:
        with sqlite_session_factory() as session:
            committed.append(session.get(Dataset, "dataset") is None)

    cleanup_dataset.before_cleanup = assert_committed
    service.delete_dataset(CONTEXT, dataset_id=REF.dataset_id)

    with sqlite_session_factory() as session:
        assert session.get(Dataset, "dataset") is None
        assert session.scalar(select(func.count()).select_from(DatasetPermission)) == 0
        assert session.get(ApiToken, "api-token") is None
        assert session.get(ResourceAccessToken, "resource-token") is None
    assert len(cleanup_dataset.calls) == 1
    cleanup = cleanup_dataset.calls[0]
    assert cleanup.id == "dataset"
    assert cleanup.workspace_id == "tenant"
    assert cleanup.indexing_technique == "high_quality"
    assert cleanup.doc_form == "text_model"
    assert committed == [True]


def test_delete_empty_dataset_still_returns_cleanup_snapshot(
    mutations: SQLAlchemyDatasetRepository,
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    del operations
    with sqlite_session_factory.begin() as session:
        row = session.get(Dataset, "dataset")
        assert row is not None
        row.indexing_technique = None
        row.chunk_structure = None

    cleanup = mutations.delete_with_relations(REF)

    assert cleanup is not None
    assert cleanup.id == "dataset"
    assert cleanup.workspace_id == "tenant"
    assert cleanup.indexing_technique is None
    assert cleanup.doc_form == "text_model"
    with sqlite_session_factory() as session:
        assert session.get(Dataset, "dataset") is None


def test_delete_dataset_commit_failure_rolls_back_dataset_and_permissions(
    mutations: SQLAlchemyDatasetRepository,
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    del operations
    with sqlite_session_factory.begin() as session:
        session.add(DatasetPermission(tenant_id="tenant", dataset_id="dataset", account_id="actor"))

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory.class_, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            mutations.delete_with_relations(REF)
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", reject_commit)

    with sqlite_session_factory() as session:
        assert session.get(Dataset, "dataset") is not None
        assert session.scalar(select(func.count()).select_from(DatasetPermission)) == 1


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
