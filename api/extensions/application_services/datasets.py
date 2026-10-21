"""Shared dataset dependencies for knowledge and data-source use cases."""

from dataclasses import dataclass
from functools import partial

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.rag_pipeline_repository import SQLAlchemyRagPipelineDatasetProjectionWriter
from services.api_token_service import ApiTokenCache
from services.knowledge.dataset_access import DatasetAccessService, WorkspaceRoleReader
from services.knowledge.task_outbox.gateway import wake_knowledge_task_dispatcher_after_commit


@dataclass(frozen=True, slots=True)
class DatasetDependencies:
    datasets: SQLAlchemyDatasetRepository
    documents: SQLAlchemyDocumentRepository
    access: DatasetAccessService


def build_dataset_dependencies(
    *, database_client: sessionmaker[Session], workspace_roles: WorkspaceRoleReader
) -> DatasetDependencies:
    datasets = SQLAlchemyDatasetRepository(
        session_factory=database_client,
        wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        revoke_keys_after_commit=partial(ApiTokenCache.delete_after_commit, scope="dataset"),
        rag_pipeline_projection_writer=SQLAlchemyRagPipelineDatasetProjectionWriter(),
    )
    return DatasetDependencies(
        datasets=datasets,
        documents=SQLAlchemyDocumentRepository(
            session_factory=database_client,
            wake_after_commit=wake_knowledge_task_dispatcher_after_commit,
        ),
        access=DatasetAccessService(
            datasets=datasets,
            workspace_roles=workspace_roles,
            legacy_permissions_enabled=not dify_config.RBAC_ENABLED,
        ),
    )
