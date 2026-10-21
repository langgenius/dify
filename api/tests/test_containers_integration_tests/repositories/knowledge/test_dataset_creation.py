"""Relational creation guarantees owned by the dataset repository."""

from dataclasses import replace
from typing import NoReturn
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.dataset import Dataset, DatasetPermission, ExternalKnowledgeApis, ExternalKnowledgeBindings, Pipeline
from models.enums import DatasetRuntimeMode
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessSnapshot
from services.knowledge.datasets.application import (
    DatasetApplicationService,
)
from services.knowledge.datasets.contracts import (
    DatasetCreateMutation,
    DatasetDetailProjection,
    DatasetListFilter,
    DatasetNameConflictError,
    DatasetVisibility,
    RagPipelineDatasetCreateMutation,
)
from services.knowledge.entities.datasets import DatasetDetailRecord, DatasetPage
from services.knowledge.resource_scope import DatasetRef


def _unexpected_dependency_call(name: str) -> NoReturn:
    raise AssertionError(f"creator compensation unexpectedly called {name}")


class _UnusedDatasetAccess:
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        del context, dataset_id
        return _unexpected_dependency_call("dataset access")

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        del context, snapshot
        return _unexpected_dependency_call("dataset access")


class _UnusedDatasetModels:
    def resolve_default_embedding_model(self, *, tenant_id: str) -> NoReturn:
        del tenant_id
        return _unexpected_dependency_call("default embedding model resolution")

    def resolve_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> NoReturn:
        del tenant_id, provider, model
        return _unexpected_dependency_call("embedding model resolution")

    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> NoReturn:
        del tenant_id, provider, model
        return _unexpected_dependency_call("reranking model validation")


class _CreatorAccessFailureOperations:
    def visibility(self, context: RequestContext) -> DatasetVisibility:
        del context
        return _unexpected_dependency_call("dataset visibility")

    def list_datasets(
        self,
        context: RequestContext,
        query: DatasetListFilter,
        accessible_ids: list[str] | None,
        include_own: bool,
    ) -> DatasetPage:
        del context, query, accessible_ids, include_own
        return _unexpected_dependency_call("dataset listing")

    def embedding_models(self, workspace_id: str) -> set[str]:
        del workspace_id
        return _unexpected_dependency_call("embedding model listing")

    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> DatasetDetailRecord:
        del context, ref
        return _unexpected_dependency_call("dataset projection")

    def console_permission_keys(self, context: RequestContext, dataset_id: str) -> list[str]:
        del context, dataset_id
        return _unexpected_dependency_call("console permission projection")

    def initialize_creator_access(self, context: RequestContext, dataset_id: str) -> None:
        del context, dataset_id
        raise RuntimeError("creator access unavailable")

    def next_rag_pipeline_dataset_name(self, tenant_id: str) -> str:
        del tenant_id
        return _unexpected_dependency_call("RAG pipeline dataset naming")

    def is_in_use(self, ref: DatasetRef) -> bool:
        del ref
        return _unexpected_dependency_call("dataset usage lookup")

    def queries(self, ref: DatasetRef, *, page: int, limit: int) -> NoReturn:
        del ref, page, limit
        return _unexpected_dependency_call("dataset query history")

    def related_apps(self, ref: DatasetRef) -> NoReturn:
        del ref
        return _unexpected_dependency_call("related applications")

    def indexing_status(self, ref: DatasetRef) -> NoReturn:
        del ref
        return _unexpected_dependency_call("dataset indexing status")

    def error_documents(self, ref: DatasetRef) -> NoReturn:
        del ref
        return _unexpected_dependency_call("dataset error documents")

    def partial_members(self, ref: DatasetRef) -> list[str]:
        del ref
        return _unexpected_dependency_call("dataset partial members")

    def auto_disable_logs(self, ref: DatasetRef) -> NoReturn:
        del ref
        return _unexpected_dependency_call("dataset auto-disable logs")


@pytest.fixture
def dataset_owner(db_session_with_containers: Session) -> tuple[str, str]:
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    account = Account(
        email=f"{uuid4()}@example.com",
        name="dataset creator",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    db_session_with_containers.add_all((tenant, account))
    db_session_with_containers.flush()
    db_session_with_containers.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
    )
    db_session_with_containers.commit()
    return tenant.id, account.id


def _repository(session: Session) -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False),
        wake_after_commit=lambda _session: None,
        revoke_keys_after_commit=lambda _session, _token_ids: None,
    )


@pytest.mark.parametrize("indexing_technique", [None, "economy", "high_quality"])
def test_create_persists_prepared_settings(
    db_session_with_containers: Session,
    dataset_owner: tuple[str, str],
    indexing_technique: str | None,
) -> None:
    tenant_id, actor_id = dataset_owner
    high_quality = indexing_technique == "high_quality"
    mutation = DatasetCreateMutation(
        tenant_id=tenant_id,
        actor_id=actor_id,
        name=f"dataset-{uuid4()}",
        description="description",
        indexing_technique=indexing_technique,
        permission="only_me",
        provider="vendor",
        embedding_model_provider="provider" if high_quality else None,
        embedding_model="embedding" if high_quality else None,
        retrieval_model={"search_method": "semantic_search", "top_k": 7},
    )

    dataset_id = _repository(db_session_with_containers).create_dataset(mutation)

    db_session_with_containers.rollback()
    dataset = db_session_with_containers.get(Dataset, dataset_id)
    assert dataset is not None
    assert (dataset.tenant_id, dataset.created_by, dataset.maintainer) == (tenant_id, actor_id, actor_id)
    assert dataset.name == mutation.name
    assert dataset.permission == mutation.permission
    assert dataset.indexing_technique == indexing_technique
    assert dataset.embedding_model_provider == mutation.embedding_model_provider
    assert dataset.embedding_model == mutation.embedding_model
    assert dataset.retrieval_model == mutation.retrieval_model


def test_duplicate_name_is_rejected_within_workspace(
    db_session_with_containers: Session, dataset_owner: tuple[str, str]
) -> None:
    tenant_id, actor_id = dataset_owner
    mutation = DatasetCreateMutation(
        tenant_id=tenant_id,
        actor_id=actor_id,
        name=f"dataset-{uuid4()}",
        description=None,
        indexing_technique="economy",
        permission="all_team_members",
        provider="vendor",
    )
    repository = _repository(db_session_with_containers)
    repository.create_dataset(mutation)
    with pytest.raises(DatasetNameConflictError):
        repository.create_dataset(mutation)


def test_external_binding_rechecks_workspace_and_commits_with_dataset(
    db_session_with_containers: Session, dataset_owner: tuple[str, str]
) -> None:
    tenant_id, actor_id = dataset_owner
    api = ExternalKnowledgeApis(
        tenant_id=tenant_id,
        name="external provider",
        description="",
        settings=None,
        created_by=actor_id,
        updated_by=None,
    )
    db_session_with_containers.add(api)
    db_session_with_containers.commit()
    mutation = DatasetCreateMutation(
        tenant_id=tenant_id,
        actor_id=actor_id,
        name=f"external-{uuid4()}",
        description=None,
        indexing_technique=None,
        permission="only_me",
        provider="external",
        external_knowledge_api_id=api.id,
        external_knowledge_id="remote knowledge",
    )
    repository = _repository(db_session_with_containers)
    with pytest.raises(ValueError, match="External API template not found"):
        repository.create_dataset(replace(mutation, tenant_id=str(uuid4())))
    dataset_id = repository.create_dataset(mutation)

    db_session_with_containers.rollback()
    binding = db_session_with_containers.scalar(
        select(ExternalKnowledgeBindings).where(ExternalKnowledgeBindings.dataset_id == dataset_id)
    )
    assert binding is not None
    assert (binding.tenant_id, binding.external_knowledge_api_id, binding.external_knowledge_id) == (
        tenant_id,
        api.id,
        mutation.external_knowledge_id,
    )


def test_rag_creation_commits_pipeline_icon_and_member_grants_together(
    db_session_with_containers: Session, dataset_owner: tuple[str, str]
) -> None:
    tenant_id, actor_id = dataset_owner
    icon = {"icon": "book", "icon_background": "#FFF4ED", "icon_type": "emoji"}
    mutation = RagPipelineDatasetCreateMutation(
        tenant_id=tenant_id,
        actor_id=actor_id,
        name=f"pipeline-{uuid4()}",
        description="pipeline description",
        permission="partial_members",
        icon_info=icon,
        partial_member_ids=(actor_id,),
    )

    dataset_id = _repository(db_session_with_containers).create_rag_pipeline_dataset(mutation)

    db_session_with_containers.rollback()
    dataset = db_session_with_containers.get(Dataset, dataset_id)
    assert dataset is not None
    assert dataset.pipeline_id is not None
    pipeline = db_session_with_containers.get(Pipeline, dataset.pipeline_id)
    assert pipeline is not None
    assert (pipeline.tenant_id, pipeline.name, pipeline.created_by) == (tenant_id, mutation.name, actor_id)
    assert dataset.runtime_mode == DatasetRuntimeMode.RAG_PIPELINE
    assert dataset.permission == mutation.permission
    assert dataset.icon_info == icon
    grants = db_session_with_containers.scalars(
        select(DatasetPermission).where(DatasetPermission.dataset_id == dataset_id)
    ).all()
    assert [(grant.tenant_id, grant.account_id, grant.has_permission) for grant in grants] == [
        (tenant_id, actor_id, True)
    ]


@pytest.mark.parametrize("projection", [DatasetDetailProjection.CORE, DatasetDetailProjection.CONSOLE])
def test_creator_access_failure_compensates_committed_dataset(
    db_session_with_containers: Session,
    dataset_owner: tuple[str, str],
    projection: DatasetDetailProjection,
) -> None:
    tenant_id, actor_id = dataset_owner
    repository = _repository(db_session_with_containers)
    service = DatasetApplicationService(
        dataset_access=_UnusedDatasetAccess(),
        operations=_CreatorAccessFailureOperations(),
        mutations=repository,
        models=_UnusedDatasetModels(),
        rbac_enabled=True,
        service_api_url="http://service-api.test",
        vector_store=None,
        tidb_fulltext=False,
    )
    dataset_name = f"creator-access-failure-{uuid4()}"

    with pytest.raises(RuntimeError, match="creator access unavailable"):
        service.create_dataset_with_requested_permission(
            RequestContext("request", None, actor_id, tenant_id),
            values={"name": dataset_name, "permission": "only_me"},
            projection=projection,
        )

    db_session_with_containers.rollback()
    assert db_session_with_containers.scalar(select(Dataset.id).where(Dataset.name == dataset_name)) is None
