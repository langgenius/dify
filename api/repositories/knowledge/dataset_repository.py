"""SQLAlchemy repository for tenant-owned dataset state."""

from sqlalchemy import and_, delete, exists, literal, select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.dataset import Dataset, DatasetPermission, DatasetQuery, Document
from models.enums import CreatorUserRole, DatasetQuerySource
from models.model import App
from repositories.knowledge.dataset_read_repository import get_dataset_doc_form, pipeline_dataset_query
from services.errors.dataset import DatasetNotFoundError
from services.errors.knowledge_retrieval import (
    InnerKnowledgeRetrieveAppNotFoundError,
    InnerKnowledgeRetrieveAppTenantMismatchError,
    InnerKnowledgeRetrieveDatasetNotFoundError,
    InnerKnowledgeRetrieveDatasetTenantMismatchError,
)
from services.knowledge.dataset_access import DatasetAccessRecord, DatasetAccessSnapshot
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.indexing.estimate import DatasetEstimateRecord
from services.knowledge.segments.application import SegmentDatasetRecord, SegmentDocumentRecord, SegmentScope


def _dataset_access_record(dataset: Dataset) -> DatasetAccessRecord:
    return DatasetAccessRecord(
        id=dataset.id,
        workspace_id=dataset.tenant_id,
        maintainer_id=dataset.maintainer,
        permission=str(dataset.permission),
    )


def _dataset_estimate_record(dataset: Dataset) -> DatasetEstimateRecord:
    return DatasetEstimateRecord(
        id=dataset.id,
        workspace_id=dataset.tenant_id,
        indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique is not None else None,
    )


def _get_dataset(session: Session, dataset_ref: DatasetRef) -> Dataset | None:
    """Shared SQL for implementation adapters that already own a transaction."""
    return session.scalar(
        select(Dataset)
        .where(
            Dataset.id == dataset_ref.dataset_id,
            Dataset.tenant_id == dataset_ref.tenant_id,
        )
        .limit(1)
    )


class SQLAlchemyDatasetRepository:
    """Own SQL access to tenant-scoped dataset state."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def validate_inner_retrieval_scope(self, *, tenant_id: str, app_id: str, dataset_ids: list[str]) -> None:
        """Release the app/dataset validation read before invoking retrieval or external I/O.

        The trusted inner API distinguishes missing resources from tenant
        mismatches and does not apply console visibility or enable_api policy.
        """
        with self._session_factory() as session:
            app_tenant_id = session.scalar(select(App.tenant_id).where(App.id == app_id).limit(1))
            if app_tenant_id is None:
                raise InnerKnowledgeRetrieveAppNotFoundError(f"App '{app_id}' not found")
            if app_tenant_id != tenant_id:
                raise InnerKnowledgeRetrieveAppTenantMismatchError(
                    f"App '{app_id}' does not belong to tenant '{tenant_id}'"
                )
            datasets = dict(
                session.execute(select(Dataset.id, Dataset.tenant_id).where(Dataset.id.in_(dataset_ids))).tuples().all()
            )
            missing_ids = sorted(set(dataset_ids) - datasets.keys())
            if missing_ids:
                raise InnerKnowledgeRetrieveDatasetNotFoundError(f"Datasets not found: {', '.join(missing_ids)}")
            mismatched_ids = sorted(dataset_id for dataset_id, owner in datasets.items() if owner != tenant_id)
            if mismatched_ids:
                raise InnerKnowledgeRetrieveDatasetTenantMismatchError(
                    f"Datasets do not belong to tenant '{tenant_id}': {', '.join(mismatched_ids)}"
                )

    def get_retrieval_model(self, ref: DatasetRef) -> dict[str, object] | None:
        with self._session_factory() as session:
            dataset = _get_dataset(session, ref)
            if dataset is None:
                raise DatasetNotFoundError()
            return dataset.retrieval_model

    def record_hit_testing_query(self, context: RequestContext, ref: DatasetRef, content: str) -> None:
        with self._session_factory.begin() as session:
            if _get_dataset(session, ref) is None:
                raise DatasetNotFoundError()
            session.add(
                DatasetQuery(
                    dataset_id=ref.dataset_id,
                    content=content,
                    source=DatasetQuerySource.HIT_TESTING,
                    source_app_id=None,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=context.account_id,
                )
            )

    def get_maintainer_id(self, workspace_id: str, resource_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(
                select(Dataset.maintainer).where(Dataset.id == resource_id, Dataset.tenant_id == workspace_id)
            )

    def get_dataset_id_by_document(self, workspace_id: str, document_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(
                select(Dataset.id)
                .join(Document, Document.dataset_id == Dataset.id)
                .where(
                    Dataset.tenant_id == workspace_id, Document.tenant_id == workspace_id, Document.id == document_id
                )
            )

    def get_dataset_id_by_pipeline(self, workspace_id: str, pipeline_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(pipeline_dataset_query(workspace_id, pipeline_id).with_only_columns(Dataset.id))

    def list_workspace_dataset_ids(self, tenant_id: str) -> list[str]:
        with self._session_factory() as session:
            return list(session.scalars(select(Dataset.id).where(Dataset.tenant_id == tenant_id)).all())

    def get_cleanup_record(self, dataset_ref: DatasetRef) -> DatasetCleanupRecord | None:
        """None means the dataset is already gone."""
        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            if dataset is None:
                return None
            return DatasetCleanupRecord(
                id=dataset.id,
                workspace_id=dataset.tenant_id,
                indexing_technique=dataset.indexing_technique,
                index_struct=dataset.index_struct,
                collection_binding_id=dataset.collection_binding_id,
                doc_form=get_dataset_doc_form(dataset, session=session),
                pipeline_id=dataset.pipeline_id,
            )

    def delete(self, dataset_ref: DatasetRef) -> None:
        with self._session_factory.begin() as session:
            session.execute(
                delete(Dataset).where(Dataset.id == dataset_ref.dataset_id, Dataset.tenant_id == dataset_ref.tenant_id)
            )

    def get_estimate_record(self, dataset_ref: DatasetRef) -> DatasetEstimateRecord | None:
        with self._session_factory() as session:
            dataset = _get_dataset(session, dataset_ref)
            return _dataset_estimate_record(dataset) if dataset is not None else None

    def is_notion_dataset(self, dataset_ref: DatasetRef) -> bool:
        """Return whether the owned dataset is configured for Notion imports."""
        with self._session_factory() as session:
            return bool(
                session.scalar(
                    select(
                        exists().where(
                            Dataset.id == dataset_ref.dataset_id,
                            Dataset.tenant_id == dataset_ref.tenant_id,
                            Dataset.data_source_type == "notion_import",
                        )
                    )
                )
            )

    def get_access_snapshot(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        actor_id: str,
    ) -> DatasetAccessSnapshot | None:
        with self._session_factory() as session:
            dataset = _get_dataset(session, DatasetRef(workspace_id, dataset_id))
            if dataset is None:
                return None

            actor_has_partial_access = bool(
                session.scalar(
                    select(
                        exists().where(
                            DatasetPermission.tenant_id == workspace_id,
                            DatasetPermission.dataset_id == dataset_id,
                            DatasetPermission.account_id == actor_id,
                            DatasetPermission.has_permission.is_(True),
                        )
                    )
                )
            )
            return DatasetAccessSnapshot(
                dataset=_dataset_access_record(dataset),
                actor_has_partial_access=actor_has_partial_access,
            )

    def get_segment_scope(
        self,
        *,
        dataset_ref: DatasetRef,
        document_id: str,
        actor_id: str | None,
    ) -> SegmentScope:
        """Read ownership, model configuration and the actor grant in one snapshot."""
        grant = (
            exists().where(
                DatasetPermission.tenant_id == dataset_ref.tenant_id,
                DatasetPermission.dataset_id == dataset_ref.dataset_id,
                DatasetPermission.account_id == actor_id,
                DatasetPermission.has_permission.is_(True),
            )
            if actor_id is not None
            else literal(False)
        )
        with self._session_factory() as session:
            row = session.execute(
                select(Dataset, Document, grant)
                .outerjoin(
                    Document,
                    and_(
                        Document.id == document_id,
                        Document.dataset_id == Dataset.id,
                        Document.tenant_id == Dataset.tenant_id,
                    ),
                )
                .where(Dataset.id == dataset_ref.dataset_id, Dataset.tenant_id == dataset_ref.tenant_id)
            ).one_or_none()
            if row is None:
                return SegmentScope(None, None)
            dataset, document, actor_has_access = row
            return SegmentScope(
                dataset=SegmentDatasetRecord(
                    id=dataset.id,
                    workspace_id=dataset.tenant_id,
                    indexing_technique=str(dataset.indexing_technique),
                    embedding_model_provider=dataset.embedding_model_provider,
                    embedding_model=dataset.embedding_model,
                ),
                document=SegmentDocumentRecord(
                    id=document.id,
                    dataset_id=document.dataset_id,
                    workspace_id=document.tenant_id,
                    doc_form=str(document.doc_form),
                )
                if document is not None
                else None,
                access_snapshot=DatasetAccessSnapshot(
                    dataset=_dataset_access_record(dataset),
                    actor_has_partial_access=bool(actor_has_access),
                )
                if actor_id is not None
                else None,
            )
