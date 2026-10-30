"""MySQL locking regressions for shared UploadFile reclamation."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event, current_thread
from typing import cast
from uuid import uuid4

from sqlalchemy import delete, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.rag.docstore.dataset_docstore import DatasetDocumentStore
from core.rag.models.document import AttachmentDocument
from enums.creator import CreatorUserRole
from graphon.file import FileTransferMethod, FileType
from models.dataset import SegmentAttachmentBinding
from models.model import App, IconType, MessageFile, UploadFile
from repositories.app.console_repository import ConsoleAppRepository
from repositories.app.upload_file_references import get_referenced_upload_file_ids as get_app_file_references
from repositories.conversation.upload_file_references import get_referenced_upload_file_ids
from repositories.file.upload_file_reclamation import SQLAlchemyUploadFileReclaimer
from repositories.file.upload_file_repository import (
    UploadFileRepository,
    lock_and_validate_owned_upload_files_in_session,
)
from repositories.knowledge.upload_file_references import (
    get_referenced_upload_file_ids as get_knowledge_file_references,
)
from tests.unit_tests.model_factories import make_app, make_dataset, make_upload_file


def test_old_snapshot_rechecks_message_owner_with_current_read(mysql_session: Session) -> None:
    """A reference committed after an old snapshot must still fence physical deletion."""

    engine = cast(Engine, mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ"))
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    tenant_id = str(uuid4())
    message_id = str(uuid4())
    upload = make_upload_file(
        tenant_id=tenant_id,
        key=f"messages/{uuid4()}.txt",
        created_by=str(uuid4()),
    )
    with sessions.begin() as session:
        session.add(upload)

    writer = sessions()
    writer.begin()
    lock_and_validate_owned_upload_files_in_session(
        writer,
        tenant_id=tenant_id,
        upload_file_ids=(upload.id,),
    )
    cleanup_reached_file_lock = Event()
    deleted_blob_keys: list[str] = []

    def observe_cleanup_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if current_thread().name.startswith("upload-cleaner") and " from upload_files " in normalized:
            cleanup_reached_file_lock.set()

    def reclaim_after_old_snapshot() -> tuple[str, ...]:
        with sessions.begin() as cleanup:
            # This non-locking read establishes a stale InnoDB REPEATABLE READ
            # snapshot before the message owner is committed.
            assert cleanup.scalars(select(MessageFile.id).where(MessageFile.upload_file_id == upload.id)).all() == []
            reclaimer = SQLAlchemyUploadFileReclaimer(
                session_factory=sessions,
                files=UploadFileRepository(session_factory=sessions),
                reference_queries=(get_referenced_upload_file_ids,),
            )
            return reclaimer.delete_unreferenced_files_in_session(
                cleanup,
                tenant_id=tenant_id,
                file_ids=(upload.id,),
                delete_blob=deleted_blob_keys.append,
            )

    event.listen(engine, "before_cursor_execute", observe_cleanup_lock)
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="upload-cleaner")
    try:
        cleanup_future = executor.submit(reclaim_after_old_snapshot)
        assert cleanup_reached_file_lock.wait(timeout=10)
        assert not cleanup_future.done()
        writer.add(
            MessageFile(
                message_id=message_id,
                type=FileType.DOCUMENT,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                upload_file_id=upload.id,
                created_by_role=CreatorUserRole.ACCOUNT,
                created_by=str(uuid4()),
            )
        )
        writer.commit()
        assert cleanup_future.result(timeout=10) == ()

        assert deleted_blob_keys == []
        with sessions() as session:
            assert session.get(UploadFile, upload.id) is not None
            assert session.scalar(select(MessageFile.id).where(MessageFile.upload_file_id == upload.id)) is not None
    finally:
        if writer.in_transaction():
            writer.rollback()
        writer.close()
        executor.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_cleanup_lock)
        with sessions.begin() as cleanup:
            cleanup.execute(delete(MessageFile).where(MessageFile.upload_file_id == upload.id))
            cleanup.execute(delete(UploadFile).where(UploadFile.id == upload.id))


def test_app_icon_writer_fence_serializes_reclamation(mysql_session: Session) -> None:
    """A real app writer must keep the upload alive across an old GC snapshot."""

    engine = cast(Engine, mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ"))
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    tenant_id = str(uuid4())
    actor_id = str(uuid4())
    app = make_app(app_id=str(uuid4()), tenant_id=tenant_id, name="App", icon_type=IconType.EMOJI)
    upload = make_upload_file(
        tenant_id=tenant_id,
        key=f"app-icons/{uuid4()}.png",
        created_by=actor_id,
    )
    with sessions.begin() as session:
        session.add_all([app, upload])

    old_snapshot_ready = Event()
    allow_reclamation = Event()
    writer_holds_file_lock = Event()
    release_writer = Event()
    cleanup_reached_file_lock = Event()

    def normalized_query(statement: str) -> str:
        return " ".join(statement.lower().replace('"', "").replace("`", "").split())

    def observe_before_query(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if current_thread().name.startswith("app-cleaner") and " from upload_files " in normalized_query(statement):
            cleanup_reached_file_lock.set()

    def observe_after_query(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if current_thread().name.startswith("app-writer") and " from upload_files " in normalized_query(statement):
            writer_holds_file_lock.set()
            assert release_writer.wait(timeout=10)

    def attach_icon() -> None:
        with sessions() as session:
            owned_app = session.get_one(App, app.id)
            ConsoleAppRepository.update_app_icon(
                owned_app,
                upload.id,
                "#ffffff",
                IconType.IMAGE,
                account_id=actor_id,
                session=session,
            )

    def reclaim_after_old_snapshot() -> tuple[str, ...]:
        with sessions.begin() as cleanup:
            assert cleanup.scalar(select(App.icon).where(App.id == app.id)) != upload.id
            old_snapshot_ready.set()
            assert allow_reclamation.wait(timeout=10)
            return SQLAlchemyUploadFileReclaimer(
                session_factory=sessions,
                files=UploadFileRepository(session_factory=sessions),
                reference_queries=(get_app_file_references,),
            ).delete_unreferenced_files_in_session(
                cleanup,
                tenant_id=tenant_id,
                file_ids=(upload.id,),
                delete_blob=lambda _key: None,
            )

    event.listen(engine, "before_cursor_execute", observe_before_query)
    event.listen(engine, "after_cursor_execute", observe_after_query)
    cleaner_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="app-cleaner")
    writer_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="app-writer")
    try:
        cleaner = cleaner_executor.submit(reclaim_after_old_snapshot)
        assert old_snapshot_ready.wait(timeout=10)
        writer = writer_executor.submit(attach_icon)
        assert writer_holds_file_lock.wait(timeout=10)
        allow_reclamation.set()
        assert cleanup_reached_file_lock.wait(timeout=10)
        assert not cleaner.done()
        release_writer.set()
        writer.result(timeout=10)
        assert cleaner.result(timeout=10) == ()

        with sessions() as session:
            assert session.get_one(App, app.id).icon == upload.id
            assert session.get(UploadFile, upload.id) is not None
    finally:
        release_writer.set()
        writer_executor.shutdown(wait=True, cancel_futures=True)
        cleaner_executor.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_before_query)
        event.remove(engine, "after_cursor_execute", observe_after_query)
        with sessions.begin() as cleanup:
            cleanup.execute(delete(App).where(App.id == app.id))
            cleanup.execute(delete(UploadFile).where(UploadFile.id == upload.id))


def test_dataset_docstore_attachment_writer_fence_serializes_reclamation(mysql_session: Session) -> None:
    """The legacy index writer must fence cleanup until its binding commits."""

    engine = cast(Engine, mysql_session.get_bind().execution_options(isolation_level="REPEATABLE READ"))
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    tenant_id = str(uuid4())
    dataset_id = str(uuid4())
    document_id = str(uuid4())
    segment_id = str(uuid4())
    upload = make_upload_file(
        tenant_id=tenant_id,
        key=f"dataset-attachments/{uuid4()}.png",
        created_by=str(uuid4()),
    )
    with sessions.begin() as session:
        session.add(upload)

    writer = sessions()
    writer.begin()
    DatasetDocumentStore(
        dataset=make_dataset(dataset_id=dataset_id, tenant_id=tenant_id),
        user_id=str(uuid4()),
        document_id=document_id,
    ).add_multimodel_documents_binding(
        segment_id,
        [AttachmentDocument(page_content="image", metadata={"doc_id": upload.id})],
        session=writer,
    )

    cleanup_reached_file_lock = Event()

    def observe_cleanup_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if current_thread().name.startswith("attachment-cleaner") and " from upload_files " in normalized:
            cleanup_reached_file_lock.set()

    def reclaim_after_old_snapshot() -> tuple[str, ...]:
        with sessions.begin() as cleanup:
            assert (
                cleanup.scalar(
                    select(SegmentAttachmentBinding.id).where(SegmentAttachmentBinding.attachment_id == upload.id)
                )
                is None
            )
            return SQLAlchemyUploadFileReclaimer(
                session_factory=sessions,
                files=UploadFileRepository(session_factory=sessions),
                reference_queries=(get_knowledge_file_references,),
            ).delete_unreferenced_files_in_session(
                cleanup,
                tenant_id=tenant_id,
                file_ids=(upload.id,),
                delete_blob=lambda _key: None,
            )

    event.listen(engine, "before_cursor_execute", observe_cleanup_lock)
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="attachment-cleaner")
    try:
        cleanup_future = executor.submit(reclaim_after_old_snapshot)
        assert cleanup_reached_file_lock.wait(timeout=10)
        assert not cleanup_future.done()
        writer.commit()
        assert cleanup_future.result(timeout=10) == ()

        with sessions() as session:
            assert session.get(UploadFile, upload.id) is not None
            assert (
                session.scalar(
                    select(SegmentAttachmentBinding.id).where(SegmentAttachmentBinding.attachment_id == upload.id)
                )
                is not None
            )
    finally:
        if writer.in_transaction():
            writer.rollback()
        writer.close()
        executor.shutdown(wait=True, cancel_futures=True)
        event.remove(engine, "before_cursor_execute", observe_cleanup_lock)
        with sessions.begin() as cleanup:
            cleanup.execute(delete(SegmentAttachmentBinding).where(SegmentAttachmentBinding.attachment_id == upload.id))
            cleanup.execute(delete(UploadFile).where(UploadFile.id == upload.id))
