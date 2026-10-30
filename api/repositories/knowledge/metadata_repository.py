"""Tenant-scoped metadata operations; each mutation owns one atomic transaction."""

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.built_in_field import BuiltInField
from libs.datetime_utils import naive_utc_now
from models.account import Account
from models.dataset import (
    Dataset,
    DatasetMetadata,
    DatasetMetadataBinding,
    Document,
    build_built_in_field_values,
)
from services.errors.metadata import MetadataResourceNotFoundError
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.metadata.contracts import (
    MetadataList,
    MetadataOperation,
    MetadataRecord,
    validate_metadata_value,
)


def lock_metadata_dataset(session: Session, ref: DatasetRef) -> Dataset | None:
    """Lock and refresh the dataset that serializes all metadata mutations."""

    return session.scalar(
        select(Dataset)
        .where(Dataset.id == ref.dataset_id, Dataset.tenant_id == ref.tenant_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def lock_metadata_document(session: Session, ref: DatasetRef, document_id: str) -> Document | None:
    """Lock and refresh one document after its dataset metadata lock is held."""

    return session.scalar(
        select(Document)
        .where(
            Document.id == document_id,
            Document.tenant_id == ref.tenant_id,
            Document.dataset_id == ref.dataset_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def lock_metadata_document_bindings(
    session: Session, ref: DatasetRef, document_id: str
) -> list[tuple[DatasetMetadataBinding, DatasetMetadata]]:
    """Lock and current-read the document's valid custom metadata bindings.

    The caller must already hold the dataset metadata lock and the document
    lock, in that order. Joining through the complete owner chain prevents a
    malformed cross-tenant binding from protecting or restoring JSON values.
    """

    rows = session.execute(
        select(DatasetMetadataBinding, DatasetMetadata)
        .join(
            DatasetMetadata,
            (DatasetMetadata.id == DatasetMetadataBinding.metadata_id)
            & (DatasetMetadata.tenant_id == DatasetMetadataBinding.tenant_id)
            & (DatasetMetadata.dataset_id == DatasetMetadataBinding.dataset_id),
        )
        .where(
            DatasetMetadataBinding.tenant_id == ref.tenant_id,
            DatasetMetadataBinding.dataset_id == ref.dataset_id,
            DatasetMetadataBinding.document_id == document_id,
        )
        .order_by(DatasetMetadataBinding.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).tuples()
    return [(binding, metadata) for binding, metadata in rows]


class SQLAlchemyMetadataRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._sessions = session_factory

    @staticmethod
    def _dataset(session: Session, ref: DatasetRef, *, write: bool = False) -> Dataset:
        dataset = (
            lock_metadata_dataset(session, ref)
            if write
            else session.scalar(select(Dataset).where(Dataset.id == ref.dataset_id, Dataset.tenant_id == ref.tenant_id))
        )
        if dataset is None:
            raise MetadataResourceNotFoundError("Dataset not found.")
        return dataset

    @staticmethod
    def _fields(ref: DatasetRef):
        return select(DatasetMetadata).where(
            DatasetMetadata.tenant_id == ref.tenant_id, DatasetMetadata.dataset_id == ref.dataset_id
        )

    @staticmethod
    def _documents(ref: DatasetRef):
        return select(Document).where(Document.tenant_id == ref.tenant_id, Document.dataset_id == ref.dataset_id)

    @staticmethod
    def _bindings(ref: DatasetRef):
        return select(DatasetMetadataBinding).where(
            DatasetMetadataBinding.tenant_id == ref.tenant_id, DatasetMetadataBinding.dataset_id == ref.dataset_id
        )

    @staticmethod
    def _record(row: DatasetMetadata) -> MetadataRecord:
        return MetadataRecord(
            id=row.id,
            name=row.name,
            type=row.type,
            tenant_id=row.tenant_id,
            dataset_id=row.dataset_id,
            created_by=row.created_by,
            created_at=row.created_at,
            updated_by=row.updated_by,
            updated_at=row.updated_at,
        )

    @classmethod
    def _check_name(cls, session: Session, ref: DatasetRef, name: str) -> None:
        if session.scalar(cls._fields(ref).where(DatasetMetadata.name == name).limit(1)) is not None:
            raise ValueError("Metadata name already exists.")

    def create(self, ref: DatasetRef, *, name: str, field_type: str, actor_id: str) -> MetadataRecord:
        with self._sessions.begin() as session:
            self._dataset(session, ref, write=True)
            self._check_name(session, ref, name)
            row = DatasetMetadata(
                tenant_id=ref.tenant_id, dataset_id=ref.dataset_id, name=name, type=field_type, created_by=actor_id
            )
            session.add(row)
            session.flush()
            return self._record(row)

    def rename(self, ref: DatasetRef, metadata_id: str, *, name: str, actor_id: str) -> MetadataRecord:
        with self._sessions.begin() as session:
            self._dataset(session, ref, write=True)
            self._check_name(session, ref, name)
            row = session.scalar(self._fields(ref).where(DatasetMetadata.id == metadata_id))
            if row is None:
                raise MetadataResourceNotFoundError("Metadata not found.")
            old_name = row.name
            row.name, row.updated_by, row.updated_at = name, actor_id, naive_utc_now()
            bindings = session.scalars(
                self._bindings(ref).where(DatasetMetadataBinding.metadata_id == metadata_id)
            ).all()
            for document in session.scalars(
                self._documents(ref).where(Document.id.in_([b.document_id for b in bindings]))
            ):
                values = dict(document.doc_metadata or {})
                if old_name in values:
                    values[name] = values.pop(old_name)
                document.doc_metadata = values
            return self._record(row)

    def delete(self, ref: DatasetRef, metadata_id: str) -> MetadataRecord:
        with self._sessions.begin() as session:
            self._dataset(session, ref, write=True)
            row = session.scalar(self._fields(ref).where(DatasetMetadata.id == metadata_id))
            if row is None:
                raise MetadataResourceNotFoundError("Metadata not found.")
            bindings = session.scalars(
                self._bindings(ref).where(DatasetMetadataBinding.metadata_id == metadata_id)
            ).all()
            for document in session.scalars(
                self._documents(ref).where(Document.id.in_([b.document_id for b in bindings]))
            ):
                values = dict(document.doc_metadata or {})
                values.pop(row.name, None)
                document.doc_metadata = values
            for binding in bindings:
                session.delete(binding)
            session.delete(row)
            return self._record(row)

    @staticmethod
    def _document_uploaders(session: Session, documents: Sequence[Document]) -> dict[str, str]:
        account_ids = {document.created_by for document in documents}
        if not account_ids:
            return {}
        return dict(session.execute(select(Account.id, Account.name).where(Account.id.in_(account_ids))).tuples().all())

    @staticmethod
    def _built_in(document: Document, *, uploader: str | None) -> dict[str, str | float | None]:
        return build_built_in_field_values(
            document_name=document.name,
            uploader=uploader,
            upload_date=document.upload_date,
            last_update_date=document.last_update_date,
            data_source_type=document.data_source_type,
        )

    def set_built_in(self, ref: DatasetRef, *, enabled: bool) -> None:
        with self._sessions.begin() as session:
            dataset = self._dataset(session, ref, write=True)
            # The dataset flag applies to every owned document, including ones that
            # are temporarily ineligible for retrieval. Reconcile even when the flag
            # already has the requested value so older partial writes can be healed.
            documents = list(session.scalars(self._documents(ref)))
            uploaders = self._document_uploaders(session, documents) if enabled else {}
            for document in documents:
                values = dict(document.doc_metadata or {})
                if enabled:
                    values.update(self._built_in(document, uploader=uploaders.get(document.created_by)))
                else:
                    for key in BuiltInField:
                        values.pop(key, None)
                if values != dict(document.doc_metadata or {}):
                    document.doc_metadata = values
            dataset.built_in_field_enabled = enabled

    def update_documents(self, ref: DatasetRef, operations: Sequence[MetadataOperation], *, actor_id: str) -> None:
        with self._sessions.begin() as session:
            dataset = self._dataset(session, ref, write=True)
            metadata_ids = {value.id for operation in operations for value in operation.metadata_list}
            fields = {
                row.id: row for row in session.scalars(self._fields(ref).where(DatasetMetadata.id.in_(metadata_ids)))
            }
            if metadata_ids != set(fields):
                raise MetadataResourceNotFoundError("Metadata not found.")
            document_ids = {operation.document_id for operation in operations}
            documents = {
                row.id: row
                for row in session.scalars(self._documents(ref).where(Document.id.in_(document_ids)).with_for_update())
            }
            if document_ids != set(documents):
                raise MetadataResourceNotFoundError("Document not found.")
            uploaders = (
                self._document_uploaders(session, list(documents.values())) if dataset.built_in_field_enabled else {}
            )

            # Validate the complete request before mutating any document or
            # binding. A later invalid operation must not partially apply an
            # earlier one, even if a subsequent query triggers autoflush.
            for operation in operations:
                for value in operation.metadata_list:
                    field = fields[value.id]
                    validate_metadata_value(field_name=field.name, field_type=field.type, value=value.value)

            for operation in operations:
                document = documents[operation.document_id]
                values = dict(document.doc_metadata or {}) if operation.partial_update else {}
                values.update({fields[value.id].name: value.value for value in operation.metadata_list})
                if dataset.built_in_field_enabled:
                    values.update(self._built_in(document, uploader=uploaders.get(document.created_by)))
                if values != dict(document.doc_metadata or {}):
                    document.doc_metadata = values
                bindings = session.scalars(
                    self._bindings(ref).where(DatasetMetadataBinding.document_id == document.id)
                ).all()
                previous = {binding.metadata_id for binding in bindings}
                if not operation.partial_update:
                    for binding in bindings:
                        session.delete(binding)
                    previous.clear()
                for value in operation.metadata_list:
                    if value.id in previous:
                        continue
                    session.add(
                        DatasetMetadataBinding(
                            tenant_id=ref.tenant_id,
                            dataset_id=ref.dataset_id,
                            document_id=document.id,
                            metadata_id=value.id,
                            created_by=actor_id,
                        )
                    )
                    previous.add(value.id)

    def list_fields(self, ref: DatasetRef) -> MetadataList:
        with self._sessions() as session:
            dataset = self._dataset(session, ref)
            counts = dict(
                session.execute(
                    select(DatasetMetadataBinding.metadata_id, func.count())
                    .where(
                        DatasetMetadataBinding.tenant_id == ref.tenant_id,
                        DatasetMetadataBinding.dataset_id == ref.dataset_id,
                    )
                    .group_by(DatasetMetadataBinding.metadata_id)
                )
                .tuples()
                .all()
            )
            return {
                "doc_metadata": [
                    {"id": row.id, "name": row.name, "type": row.type, "count": counts.get(row.id, 0)}
                    for row in session.scalars(self._fields(ref))
                ],
                "built_in_field_enabled": dataset.built_in_field_enabled,
            }
