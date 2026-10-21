import json
from collections.abc import Callable
from datetime import datetime
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
from enums.knowledge import DatasetVectorIndexStatus
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
    CreatorUserRole,
    DatasetQuerySource,
    IndexingStatus,
    SegmentStatus,
)
from models.knowledge_task import KnowledgeTaskOutbox
from models.model import ApiToken, DatasetApiTokenBinding
from models.resource_access_token import ResourceAccessToken, ResourceAccessTokenRelation
from repositories.app.console_repository import ConsoleAppRepository
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.enterprise import rbac_service
from services.enterprise.base import EnterpriseRequest
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccessSnapshot,
    DatasetNotFoundError,
)
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetApplicationService
from services.knowledge.datasets.contracts import (
    DatasetDetailProjection,
    DatasetListFilter,
    RagPipelineDatasetSettings,
)
from services.knowledge.entities.model_configuration import EmbeddingModelConfiguration
from services.knowledge.indexing.cleanup import DeletionIndexCleanup
from services.knowledge.resource_scope import DatasetRef
from services.rbac import contracts as rbac_contracts
from services.tag_application_service import CreateTagInput, TagApplicationService, TagBindingInput
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.rbac_fakes import RBACDomain

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
def mutations(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        revoke_keys_after_commit=lambda _session, _tokens: None,
        session_factory=sqlite_session_factory,
        wake_after_commit=lambda _session: None,
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
) -> DatasetApplicationService:
    return DatasetApplicationService(
        dataset_access=AllowAllDatasetAccess(),
        operations=operations,
        mutations=mutations,
        models=model_configuration,
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


@pytest.mark.parametrize(("ids", "own"), [([], False), (["dataset"], False)])
def test_list_visibility_restricts_even_requested_ids(
    operations: SQLAlchemyDatasetOperations, ids: list[str], own: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    result = operations.list_datasets(CONTEXT, DatasetListFilter(ids=["dataset"]), ids, own)
    assert result["total"] == len(ids)


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


def _vector_intent(
    *,
    technique: str,
    provider: str | None,
    model: str | None,
    status: str = "failed",
    error: str | None = "vector provider unavailable",
    superseded: bool | None = False,
) -> KnowledgeTaskOutbox:
    payload: dict[str, object] = {
        "tenant_id": REF.tenant_id,
        "dataset_id": REF.dataset_id,
        "action": "update" if technique == "high_quality" else "remove",
        "expected_indexing_technique": technique,
        "expected_embedding_model_provider": provider,
        "expected_embedding_model": model,
        "regenerate_summary_vectors": technique == "high_quality",
    }
    if superseded is not None:
        payload["superseded"] = superseded
    return KnowledgeTaskOutbox(
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        resource_id=REF.dataset_id,
        task_kind="dataset_vector_index_update",
        status=status,
        last_error=error,
        payload=payload,
    )


def test_dataset_detail_exposes_only_current_vector_target_failure(
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "provider-current"
        row.embedding_model = "model-current"
        session.add(
            _vector_intent(
                technique="high_quality",
                provider="provider-old",
                model="model-old",
                superseded=True,
            )
        )

    historical = operations.get_dataset(CONTEXT, REF)
    assert historical["vector_indexing_status"] is None
    assert historical["vector_indexing_error"] is None

    with sqlite_session_factory.begin() as session:
        session.add(_vector_intent(technique="high_quality", provider="provider-current", model="model-current"))

    current = operations.get_dataset(CONTEXT, REF)
    assert current["vector_indexing_status"] is DatasetVectorIndexStatus.ERROR
    assert current["vector_indexing_error"] == "vector provider unavailable"
    response = DatasetDetailResponse.model_validate(current).model_dump(mode="json")
    assert response["vector_indexing_status"] == "error"
    assert response["vector_indexing_error"] == "vector provider unavailable"
    listed = operations.list_datasets(CONTEXT, DatasetListFilter(ids=[REF.dataset_id]), None, False)
    assert listed["data"][0]["vector_indexing_status"] is DatasetVectorIndexStatus.ERROR
    assert listed["data"][0]["vector_indexing_error"] == "vector provider unavailable"


def test_dataset_vector_projection_uses_current_marker_for_same_millisecond_a_to_b_to_a(
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    timestamp = datetime(2026, 1, 1)
    old_a = _vector_intent(
        technique="high_quality",
        provider="provider-a",
        model="model-a",
        superseded=True,
    )
    old_a.id = "ffffffff-ffff-7fff-bfff-ffffffffffff"
    old_a.created_at = timestamp
    middle_b = _vector_intent(
        technique="high_quality",
        provider="provider-b",
        model="model-b",
        status="completed",
        error=None,
        superseded=True,
    )
    middle_b.id = "88888888-8888-7888-8888-888888888888"
    middle_b.created_at = timestamp
    current_a = _vector_intent(
        technique="high_quality",
        provider="provider-a",
        model="model-a",
        status="completed",
        error=None,
        superseded=False,
    )
    current_a.id = "00000000-0000-7000-8000-000000000001"
    current_a.created_at = timestamp
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "provider-a"
        row.embedding_model = "model-a"
        session.add_all([old_a, middle_b, current_a])

    result = operations.get_dataset(CONTEXT, REF)

    assert result["vector_indexing_status"] is DatasetVectorIndexStatus.COMPLETED
    assert result["vector_indexing_error"] is None


def test_dataset_vector_projection_ignores_unmarked_legacy_rows(
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    timestamp = datetime(2026, 1, 1)
    failed = _vector_intent(
        technique="high_quality",
        provider="provider",
        model="embedding",
        superseded=None,
    )
    failed.id = "00000000-0000-7000-8000-000000000001"
    failed.created_at = timestamp
    completed = _vector_intent(
        technique="high_quality",
        provider="provider",
        model="embedding",
        status="completed",
        error=None,
        superseded=None,
    )
    completed.id = "ffffffff-ffff-7fff-bfff-ffffffffffff"
    completed.created_at = timestamp
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "provider"
        row.embedding_model = "embedding"
        session.add_all([failed, completed])

    result = operations.get_dataset(CONTEXT, REF)

    assert result["vector_indexing_status"] is None
    assert result["vector_indexing_error"] is None


@pytest.mark.parametrize(
    ("technique", "provider", "model", "values", "expected_action"),
    [
        (
            "high_quality",
            "provider",
            "embedding",
            {
                "indexing_technique": "high_quality",
                "embedding_model_provider": "provider",
                "embedding_model": "embedding",
            },
            "update",
        ),
        (
            "economy",
            None,
            None,
            {
                "indexing_technique": "economy",
                "embedding_model_provider": "",
                "embedding_model": "",
            },
            "remove",
        ),
    ],
)
def test_saving_same_vector_configuration_retries_failed_rebuild(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
    technique: str,
    provider: str | None,
    model: str | None,
    values: dict[str, object],
    expected_action: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.indexing_technique = technique
        row.embedding_model_provider = provider
        row.embedding_model = model
        session.add(_vector_intent(technique=technique, provider=provider, model=model))

    result = service.update_dataset(CONTEXT, dataset_id=REF.dataset_id, values=values)

    assert result["vector_indexing_status"] is DatasetVectorIndexStatus.INDEXING
    assert result["vector_indexing_error"] is None
    with sqlite_session_factory() as session:
        intents = session.scalars(
            select(KnowledgeTaskOutbox)
            .where(
                KnowledgeTaskOutbox.tenant_id == REF.tenant_id,
                KnowledgeTaskOutbox.dataset_id == REF.dataset_id,
                KnowledgeTaskOutbox.task_kind == "dataset_vector_index_update",
            )
            .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
        ).all()
        assert len(intents) == 2
        assert intents[0].status == "failed"
        assert intents[0].payload["superseded"] is True
        assert intents[1].status == "pending"
        assert intents[1].payload["action"] == expected_action
        assert intents[1].payload["superseded"] is False


def test_saving_configuration_does_not_retry_historical_vector_failure(
    service: DatasetApplicationService,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "provider-current"
        row.embedding_model = "model-current"
        session.add(
            _vector_intent(
                technique="high_quality",
                provider="provider-old",
                model="model-old",
                superseded=True,
            )
        )

    result = service.update_dataset(
        CONTEXT,
        dataset_id=REF.dataset_id,
        values={
            "indexing_technique": "high_quality",
            "embedding_model_provider": "provider-current",
            "embedding_model": "model-current",
        },
    )

    assert result["vector_indexing_status"] is None
    with sqlite_session_factory() as session:
        assert (
            session.scalar(
                select(func.count(KnowledgeTaskOutbox.id)).where(
                    KnowledgeTaskOutbox.dataset_id == REF.dataset_id,
                    KnowledgeTaskOutbox.task_kind == "dataset_vector_index_update",
                )
            )
            == 1
        )


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
        assert session.scalar(select(KnowledgeTaskOutbox.id)) is None
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
    ("values", "create_api", "message"),
    [
        ({"external_knowledge_api_id": "external-api"}, False, "External knowledge id is required"),
        ({"external_knowledge_id": "knowledge"}, False, "External knowledge api id is required"),
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
def test_external_dataset_update_rejects_incomplete_or_stale_binding(
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


def test_high_quality_to_economy_update_clears_model_and_persists_index_intent(
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
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.dataset_id == REF.dataset_id,
                KnowledgeTaskOutbox.task_kind == "dataset_vector_index_update",
            )
        )
        assert row is not None
        assert row.indexing_technique == "economy"
        assert row.embedding_model_provider is None
        assert row.embedding_model is None
        assert row.collection_binding_id is None
        assert intent is not None
        assert intent.payload["action"] == "remove"


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
    service: DatasetApplicationService,
    mutations: SQLAlchemyDatasetRepository,
    model_configuration: RecordingModelConfiguration,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    model_configuration.supports_vision = True
    change = service.prepare_rag_pipeline_dataset_settings(
        CONTEXT,
        dataset_id=REF.dataset_id,
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
    )

    with sqlite_session_factory.begin() as session:
        assert mutations.stage_rag_pipeline_dataset_settings(session, change=change) is True

    with sqlite_session_factory() as session:
        row = session.get(Dataset, REF.dataset_id)
        assert row is not None
        assert row.indexing_technique == "high_quality"
        assert row.embedding_model_provider == "provider"
        assert row.embedding_model == "embedding"
        assert row.is_multimodal is True
        assert row.collection_binding_id is not None
        assert (
            session.scalar(
                select(KnowledgeTaskOutbox.id).where(
                    KnowledgeTaskOutbox.dataset_id == REF.dataset_id,
                    KnowledgeTaskOutbox.task_kind == "dataset_vector_index_update",
                )
            )
            is not None
        )


def test_staging_same_rag_pipeline_settings_retries_failed_vector_rebuild(
    service: DatasetApplicationService,
    mutations: SQLAlchemyDatasetRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        row = session.get_one(Dataset, REF.dataset_id)
        row.chunk_structure = "paragraph"
        row.indexing_technique = "high_quality"
        row.embedding_model_provider = "provider"
        row.embedding_model = "embedding"
        session.add(_vector_intent(technique="high_quality", provider="provider", model="embedding"))

    change = service.prepare_rag_pipeline_dataset_settings(
        CONTEXT,
        dataset_id=REF.dataset_id,
        settings=RagPipelineDatasetSettings(
            chunk_structure="paragraph",
            indexing_technique="high_quality",
            embedding_model_provider="provider",
            embedding_model="embedding",
            keyword_number=None,
            retrieval_model={"top_k": 3},
        ),
        has_published=False,
    )
    with sqlite_session_factory.begin() as session:
        assert mutations.stage_rag_pipeline_dataset_settings(session, change=change) is True

    with sqlite_session_factory() as session:
        intents = session.scalars(
            select(KnowledgeTaskOutbox)
            .where(
                KnowledgeTaskOutbox.dataset_id == REF.dataset_id,
                KnowledgeTaskOutbox.task_kind == "dataset_vector_index_update",
            )
            .order_by(KnowledgeTaskOutbox.created_at, KnowledgeTaskOutbox.id)
        ).all()
        assert len(intents) == 2
        assert intents[0].payload["superseded"] is True
        assert intents[1].status == "pending"
        assert intents[1].payload["action"] == "update"
        assert intents[1].payload["superseded"] is False


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
    service: DatasetApplicationService,
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

    with pytest.raises(ValueError, match=message):
        service.prepare_rag_pipeline_dataset_settings(
            CONTEXT,
            dataset_id=REF.dataset_id,
            settings=settings,
            has_published=True,
        )


def test_service_core_create_compensates_when_creator_rbac_initialization_fails(
    service: DatasetApplicationService,
    rbac_domain: RBACDomain,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    rbac_domain.transport.failure = RuntimeError("RBAC unavailable")
    payload = ServiceDatasetCreatePayload(name="Service dataset", permission="only_me")
    values = payload.model_dump()
    values["permission"] = str(payload.permission) if payload.permission else None
    values["retrieval_model"] = payload.retrieval_model

    with pytest.raises(RuntimeError, match="RBAC unavailable"):
        service.create_dataset_with_requested_permission(CONTEXT, values=values)
    with sqlite_session_factory() as session:
        assert session.scalar(select(Dataset.id).where(Dataset.name == "Service dataset")) is None


@pytest.mark.parametrize("projection", [DatasetDetailProjection.CORE, DatasetDetailProjection.CONSOLE])
def test_create_compensates_when_creator_policy_sync_fails_after_whitelist_initialization(
    service: DatasetApplicationService,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
    projection: DatasetDetailProjection,
) -> None:
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    payload = ServiceDatasetCreatePayload(name="Creator sync failure", permission="only_me")
    values = payload.model_dump()
    values["permission"] = str(payload.permission) if payload.permission else None
    values["retrieval_model"] = payload.retrieval_model
    requested_endpoints: list[str] = []
    obsolete_intent_id: str | None = None
    created_dataset_id: str | None = None

    def send_rbac_request(method: str, endpoint: str, **kwargs: object) -> dict[str, object]:
        nonlocal created_dataset_id, obsolete_intent_id
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
            with sqlite_session_factory.begin() as session:
                intent = KnowledgeTaskOutbox(
                    tenant_id=CONTEXT.active_workspace_id,
                    dataset_id=created_dataset_id,
                    task_kind="document_index_create",
                    payload={"document_ids": []},
                )
                session.add(intent)
                session.flush()
                obsolete_intent_id = intent.id
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
        service.create_dataset_with_requested_permission(CONTEXT, values=values, projection=projection)

    assert requested_endpoints == [
        "/rbac/datasets/whitelist",
        "/rbac/access-policies/creator-member-bindings",
        "/rbac/datasets/whitelist/members/batch",
    ]
    assert obsolete_intent_id is not None
    with sqlite_session_factory() as session:
        assert session.scalar(select(Dataset.id).where(Dataset.name == "Creator sync failure")) is None
        obsolete_intent = session.get_one(KnowledgeTaskOutbox, obsolete_intent_id)
        assert obsolete_intent.status == "completed"
        assert obsolete_intent.last_error == "cancelled because the dataset was deleted"
        cleanup_intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.dataset_id == obsolete_intent.dataset_id,
                KnowledgeTaskOutbox.task_kind == "dataset_cleanup",
            )
        )
        assert cleanup_intent is not None


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
        projection=DatasetDetailProjection.CORE,
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


def test_delete_dataset_atomically_removes_permissions_and_persists_cleanup(
    mutations: SQLAlchemyDatasetRepository,
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    del operations
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

    assert mutations.delete_with_relations(REF) is True

    with sqlite_session_factory() as session:
        assert session.get(Dataset, "dataset") is None
        assert session.scalar(select(func.count()).select_from(DatasetPermission)) == 0
        assert session.get(ApiToken, "api-token") is None
        assert session.get(ResourceAccessToken, "resource-token") is None
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.dataset_id == "dataset",
                KnowledgeTaskOutbox.task_kind == "dataset_cleanup",
            )
        )
        assert intent is not None
        assert intent.payload["dataset_id"] == "dataset"
        assert intent.payload["tenant_id"] == "tenant"
        assert intent.payload["doc_form"] == "text_model"
        assert intent.payload["manifest"] == {
            "document_ids": [],
            "segment_ids": [],
            "document_files": [],
            "image_files": [],
            "segment_attachments": [],
        }


def test_delete_dataset_preserves_incomplete_historical_index_cleanup(
    mutations: SQLAlchemyDatasetRepository,
    operations: SQLAlchemyDatasetOperations,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    del operations
    with sqlite_session_factory.begin() as session:
        current_dataset = session.get(Dataset, "dataset")
        assert current_dataset is not None
        current_dataset.indexing_technique = "high_quality"
        current_dataset.embedding_model_provider = "provider-b"
        current_dataset.embedding_model = "model-b"
        historical_payload = DeletionIndexCleanup(
            tenant_id="tenant",
            dataset_id="dataset",
            indexing_technique="high_quality",
            index_struct='{"type":"pgvector"}',
            collection_binding_id="collection-a",
            embedding_model_provider="provider-a",
            embedding_model="model-a",
            vector_type="pgvector",
            delete_all=False,
            vector_node_ids=("historical-node",),
        ).to_payload()
        historical_cleanup = KnowledgeTaskOutbox(
            tenant_id="tenant",
            dataset_id="dataset",
            task_kind="deletion_index_cleanup",
            payload=historical_payload,
            resource_id="historical-cleanup",
            status="dispatched",
            claim_id="cleanup-claim",
        )
        obsolete_indexing = KnowledgeTaskOutbox(
            tenant_id="tenant",
            dataset_id="dataset",
            task_kind="document_index_create",
            payload={"document_ids": ["document"]},
            status="pending",
        )
        session.add_all([historical_cleanup, obsolete_indexing])
        session.flush()
        historical_cleanup_id = historical_cleanup.id
        obsolete_indexing_id = obsolete_indexing.id

    assert mutations.delete_with_relations(REF) is True

    with sqlite_session_factory() as session:
        preserved = session.get(KnowledgeTaskOutbox, historical_cleanup_id)
        assert preserved is not None
        assert preserved.status == "dispatched"
        assert preserved.claim_id == "cleanup-claim"
        assert preserved.last_error is None
        assert preserved.payload == historical_payload
        assert preserved.payload["embedding_model_provider"] == "provider-a"
        assert preserved.payload["collection_binding_id"] == "collection-a"

        cancelled = session.get(KnowledgeTaskOutbox, obsolete_indexing_id)
        assert cancelled is not None
        assert cancelled.status == "completed"
        assert cancelled.last_error == "cancelled because the dataset was deleted"


def test_delete_empty_dataset_still_persists_cleanup_intent(
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

    assert mutations.delete_with_relations(REF) is True

    with sqlite_session_factory() as session:
        intent = session.scalar(
            select(KnowledgeTaskOutbox).where(
                KnowledgeTaskOutbox.dataset_id == "dataset",
                KnowledgeTaskOutbox.task_kind == "dataset_cleanup",
            )
        )
        assert intent is not None
        assert intent.payload["indexing_technique"] is None
        assert intent.payload["doc_form"] is None
        assert intent.payload["manifest"] == {
            "document_ids": [],
            "segment_ids": [],
            "document_files": [],
            "image_files": [],
            "segment_attachments": [],
        }


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
    related = RelatedAppListResponse.model_validate(operations.related_apps(REF)).model_dump(mode="json")
    assert related["total"] == 1
    assert related["data"][0]["id"] == "app"
    assert related["data"][0]["mode"] == "chat"
