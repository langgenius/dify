"""Shared dataset dependencies for knowledge and data-source use cases."""

from dataclasses import dataclass

from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.knowledge.dataset_access import DatasetAccessService, WorkspaceRoleReader


@dataclass(frozen=True, slots=True)
class DatasetDependencies:
    datasets: SQLAlchemyDatasetRepository
    documents: SQLAlchemyDocumentRepository
    access: DatasetAccessService


def build_dataset_dependencies(
    *, database_client: sessionmaker[Session], workspace_roles: WorkspaceRoleReader
) -> DatasetDependencies:
    datasets = SQLAlchemyDatasetRepository(session_factory=database_client)
    return DatasetDependencies(
        datasets=datasets,
        documents=SQLAlchemyDocumentRepository(session_factory=database_client),
        access=DatasetAccessService(
            datasets=datasets,
            workspace_roles=workspace_roles,
            legacy_permissions_enabled=not dify_config.RBAC_ENABLED,
        ),
    )
