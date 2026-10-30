"""MySQL locking regressions for document metadata projections and schema changes."""

from threading import Event, Thread, local
from typing import Literal, cast
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.dataset import Dataset, DatasetMetadata, DatasetMetadataBinding, Document
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from repositories.knowledge.metadata_repository import SQLAlchemyMetadataRepository
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessSnapshot
from services.knowledge.documents.adapters import SQLAlchemyDocumentOperations
from services.knowledge.documents.application import DatasetDocumentApplicationService
from services.knowledge.entities.resource_scope import DatasetRef


class _WorkerRole(local):
    role: str | None

    def __init__(self) -> None:
        self.role = None


class _MetadataDatasetAccessBoundary:
    def __init__(self, *, tenant_id: str, dataset_id: str) -> None:
        self._tenant_id = tenant_id
        self._dataset_id = dataset_id

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        assert context.active_workspace_id == self._tenant_id
        assert dataset_id == self._dataset_id
        return AccessibleDataset(dataset_id, self._tenant_id)

    def check_access(self, context: RequestContext, snapshot: DatasetAccessSnapshot) -> AccessibleDataset:
        del context, snapshot
        raise AssertionError("metadata update uses require_accessible")


class _UnexpectedActorCredentialsBoundary:
    @staticmethod
    def resolve(
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]:
        del workspace_id, actor_id, credential_id, provider, plugin_id
        raise AssertionError("metadata update must not resolve datasource credentials")


def _repeatable_read_sessions(mysql_session: Session) -> tuple[Engine, sessionmaker[Session]]:
    engine = cast(Engine, mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ"))
    return engine, sessionmaker(bind=engine, expire_on_commit=False)


def _join_if_started(thread: Thread) -> None:
    if thread.ident is not None:
        thread.join(timeout=10)


def _is_dataset_update_lock(statement: str) -> bool:
    normalized = " ".join(statement.lower().replace("`", "").split())
    return " from datasets " in normalized and " for update" in normalized


@pytest.mark.parametrize("schema_operation", ["rename", "delete", "disable_builtin"])
@pytest.mark.parametrize("first_writer", ["document", "schema"])
def test_document_metadata_and_schema_writer_serialize_on_current_dataset_lock(
    mysql_session: Session,
    schema_operation: Literal["rename", "delete", "disable_builtin"],
    first_writer: Literal["document", "schema"],
) -> None:
    """Either commit order must preserve the current binding and built-in ownership rules."""

    engine, sessions = _repeatable_read_sessions(mysql_session)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    metadata_id = str(uuid4())
    actor_id = str(uuid4())
    with sessions.begin() as seed:
        dataset = Dataset(
            id=dataset_id,
            tenant_id=tenant_id,
            name=f"metadata-race-{uuid4()}",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique="economy",
            created_by=actor_id,
        )
        dataset.built_in_field_enabled = True
        document = Document(
            id=document_id,
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            batch=str(uuid4()),
            name="Document",
            created_from=DocumentCreatedFrom.WEB,
            created_by=actor_id,
            indexing_status=IndexingStatus.COMPLETED,
            doc_form="text_model",
            enabled=True,
        )
        document.doc_type = "others"
        document.doc_metadata = {
            "custom_author": "Ada",
            "document_name": "Document",
            "legacy_type_field": "replace me",
        }
        field = DatasetMetadata(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            type="string",
            name="custom_author",
            created_by=actor_id,
        )
        field.id = metadata_id
        binding = DatasetMetadataBinding(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            metadata_id=metadata_id,
            document_id=document_id,
            created_by=actor_id,
        )
        seed.add_all([dataset, document, field, binding])

    operations = SQLAlchemyDocumentOperations(
        session_factory=sessions,
        actor_credentials=_UnexpectedActorCredentialsBoundary(),
    )
    application = DatasetDocumentApplicationService(
        dataset_access=_MetadataDatasetAccessBoundary(tenant_id=tenant_id, dataset_id=dataset_id),
        operations=operations,
        metadata_schema={"others": {}},
    )
    metadata = SQLAlchemyMetadataRepository(session_factory=sessions)
    context = RequestContext(str(uuid4()), None, actor_id, tenant_id)
    dataset_ref = DatasetRef(tenant_id, dataset_id)

    first_locked = Event()
    allow_first_commit = Event()
    second_lock_attempted = Event()
    document_finished = Event()
    schema_finished = Event()
    document_errors: list[BaseException] = []
    schema_errors: list[BaseException] = []
    worker = _WorkerRole()
    second_writer = "schema" if first_writer == "document" else "document"

    def hold_first_dataset_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if worker.role == first_writer and _is_dataset_update_lock(statement):
            first_locked.set()
            assert allow_first_commit.wait(timeout=10)

    def observe_second_dataset_lock(_connection, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        if worker.role == second_writer and _is_dataset_update_lock(statement):
            second_lock_attempted.set()

    def update_document_metadata() -> None:
        try:
            worker.role = "document"
            application.update_metadata(
                context,
                dataset_id=dataset_id,
                document_id=document_id,
                doc_type="others",
                doc_metadata={"title": "Current title", "document_name": "stale built-in"},
            )
        except BaseException as error:
            document_errors.append(error)
        finally:
            document_finished.set()

    def update_schema() -> None:
        try:
            worker.role = "schema"
            if schema_operation == "rename":
                metadata.rename(dataset_ref, metadata_id, name="renamed_author", actor_id=actor_id)
            elif schema_operation == "delete":
                metadata.delete(dataset_ref, metadata_id)
            else:
                metadata.set_built_in(dataset_ref, enabled=False)
        except BaseException as error:
            schema_errors.append(error)
        finally:
            schema_finished.set()

    document_writer = Thread(target=update_document_metadata)
    schema_writer = Thread(target=update_schema)
    first_thread = document_writer if first_writer == "document" else schema_writer
    second_thread = schema_writer if first_writer == "document" else document_writer
    second_finished = schema_finished if first_writer == "document" else document_finished
    event.listen(engine, "after_cursor_execute", hold_first_dataset_lock)
    event.listen(engine, "before_cursor_execute", observe_second_dataset_lock)
    try:
        first_thread.start()
        assert first_locked.wait(timeout=10)
        second_thread.start()
        assert second_lock_attempted.wait(timeout=10)
        assert not second_finished.wait(timeout=0.25)
        allow_first_commit.set()
        _join_if_started(first_thread)
        _join_if_started(second_thread)
        assert not first_thread.is_alive()
        assert not second_thread.is_alive()
        assert document_errors == []
        assert schema_errors == []

        with sessions() as verify:
            dataset = verify.get_one(Dataset, dataset_id)
            document = verify.get_one(Document, document_id)
            field = verify.get(DatasetMetadata, metadata_id)
            binding = verify.scalar(
                select(DatasetMetadataBinding).where(
                    DatasetMetadataBinding.tenant_id == tenant_id,
                    DatasetMetadataBinding.dataset_id == dataset_id,
                    DatasetMetadataBinding.document_id == document_id,
                    DatasetMetadataBinding.metadata_id == metadata_id,
                )
            )
            if schema_operation == "rename":
                assert dataset.built_in_field_enabled is True
                assert field is not None
                assert field.name == "renamed_author"
                assert binding is not None
                assert document.doc_metadata == {
                    "title": "Current title",
                    "document_name": "Document",
                    "renamed_author": "Ada",
                }
            elif schema_operation == "delete":
                assert dataset.built_in_field_enabled is True
                assert field is None
                assert binding is None
                assert document.doc_metadata == {
                    "title": "Current title",
                    "document_name": "Document",
                }
            else:
                assert dataset.built_in_field_enabled is False
                assert field is not None
                assert field.name == "custom_author"
                assert binding is not None
                assert document.doc_metadata == {
                    "title": "Current title",
                    "custom_author": "Ada",
                }
    finally:
        allow_first_commit.set()
        _join_if_started(first_thread)
        _join_if_started(second_thread)
        event.remove(engine, "after_cursor_execute", hold_first_dataset_lock)
        event.remove(engine, "before_cursor_execute", observe_second_dataset_lock)
        with sessions.begin() as cleanup:
            cleanup.execute(
                delete(DatasetMetadataBinding).where(
                    DatasetMetadataBinding.tenant_id == tenant_id,
                    DatasetMetadataBinding.dataset_id == dataset_id,
                )
            )
            cleanup.execute(
                delete(DatasetMetadata).where(
                    DatasetMetadata.tenant_id == tenant_id,
                    DatasetMetadata.dataset_id == dataset_id,
                )
            )
            cleanup.execute(delete(Document).where(Document.tenant_id == tenant_id, Document.dataset_id == dataset_id))
            cleanup.execute(delete(Dataset).where(Dataset.tenant_id == tenant_id, Dataset.id == dataset_id))
