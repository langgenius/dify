"""SQLAlchemy repository for tenant-owned dataset state."""

from collections.abc import Sequence
from typing import override

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.entities.dataset_reference import DatasetRef
from models.dataset import Dataset, DatasetPermission
from services.entities.knowledge_entities.records import DatasetAccessSnapshot, DatasetRecord
from services.knowledge.application import DatasetAccessReader, DatasetNotFoundError


def _dataset_record(dataset: Dataset) -> DatasetRecord:
    return DatasetRecord(
        id=dataset.id,
        workspace_id=dataset.tenant_id,
        maintainer_id=dataset.maintainer,
        permission=str(dataset.permission),
        data_source_type=str(dataset.data_source_type) if dataset.data_source_type is not None else None,
        indexing_technique=str(dataset.indexing_technique) if dataset.indexing_technique is not None else None,
        embedding_model=dataset.embedding_model,
        embedding_model_provider=dataset.embedding_model_provider,
    )


class SQLAlchemyDatasetRepository(DatasetAccessReader):
    """Own SQL access to datasets and their partial-member grants."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_by_ref(self, dataset_ref: DatasetRef) -> DatasetRecord | None:
        with self._session_factory() as session:
            dataset = session.scalar(
                select(Dataset)
                .where(
                    Dataset.id == dataset_ref.dataset_id,
                    Dataset.tenant_id == dataset_ref.tenant_id,
                )
                .limit(1)
            )
            return _dataset_record(dataset) if dataset is not None else None

    @override
    def get_access_snapshot(
        self,
        *,
        workspace_id: str,
        dataset_id: str,
        actor_id: str,
    ) -> DatasetAccessSnapshot | None:
        with self._session_factory() as session:
            dataset = session.scalar(
                select(Dataset)
                .where(
                    Dataset.id == dataset_id,
                    Dataset.tenant_id == workspace_id,
                )
                .limit(1)
            )
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
                dataset=_dataset_record(dataset),
                actor_has_partial_access=actor_has_partial_access,
            )

    def list_partial_member_ids(self, dataset_ref: DatasetRef) -> tuple[str, ...]:
        with self._session_factory() as session:
            member_ids = session.scalars(
                select(DatasetPermission.account_id).where(
                    DatasetPermission.tenant_id == dataset_ref.tenant_id,
                    DatasetPermission.dataset_id == dataset_ref.dataset_id,
                    DatasetPermission.has_permission.is_(True),
                )
            ).all()
            return tuple(member_ids)

    def replace_partial_member_ids(self, dataset_ref: DatasetRef, member_ids: Sequence[str]) -> None:
        unique_member_ids = tuple(dict.fromkeys(member_ids))
        with self._session_factory.begin() as session:
            # Serialize replacements on the aggregate root so concurrent writers cannot
            # leave the union of two independently requested member sets.
            locked_dataset_id = session.scalar(
                select(Dataset.id)
                .where(
                    Dataset.id == dataset_ref.dataset_id,
                    Dataset.tenant_id == dataset_ref.tenant_id,
                )
                .with_for_update()
            )
            if locked_dataset_id is None:
                raise DatasetNotFoundError()

            session.execute(
                delete(DatasetPermission).where(
                    DatasetPermission.tenant_id == dataset_ref.tenant_id,
                    DatasetPermission.dataset_id == dataset_ref.dataset_id,
                )
            )
            session.add_all(
                DatasetPermission(
                    tenant_id=dataset_ref.tenant_id,
                    dataset_id=dataset_ref.dataset_id,
                    account_id=member_id,
                )
                for member_id in unique_member_ids
            )
