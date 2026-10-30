"""Database-lock coverage for the UploadFile reclamation boundary."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Event, current_thread
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from enums.creator import CreatorUserRole
from graphon.file import FileTransferMethod, FileType
from models.enums import ConversationFromSource
from models.model import MessageFile, UploadFile
from repositories.file.upload_file_reclamation import SQLAlchemyUploadFileReclaimer
from repositories.file.upload_file_repository import (
    UploadFileRepository,
    lock_and_validate_owned_upload_files_in_session,
)
from services.errors.file import UploadFileReferenceNotFoundError
from services.file_adapters import build_upload_file_reclaimer
from tests.unit_tests.model_factories import (
    make_account,
    make_app,
    make_conversation,
    make_message,
    make_upload_file,
)


def _sessions(session: Session) -> sessionmaker[Session]:
    return sessionmaker(bind=session.get_bind(), expire_on_commit=False)


def _reclaimer(sessions: sessionmaker[Session]) -> SQLAlchemyUploadFileReclaimer:
    return build_upload_file_reclaimer(
        session_factory=sessions,
        files=UploadFileRepository(session_factory=sessions),
    )


def _seed_message_owner(session: Session) -> tuple[str, str, str]:
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    conversation_id = str(uuid4())
    message_id = str(uuid4())
    upload = make_upload_file(
        tenant_id=tenant_id,
        key=f"messages/{uuid4()}.txt",
        created_by=str(uuid4()),
    )
    session.add_all(
        [
            make_app(app_id=app_id, tenant_id=tenant_id),
            make_conversation(
                conversation_id=conversation_id,
                app_id=app_id,
                inputs={},
                from_source=ConversationFromSource.API,
            ),
            make_message(
                message_id=message_id,
                app_id=app_id,
                conversation_id=conversation_id,
                inputs={},
                query="question",
                message={},
                answer="answer",
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            ),
            upload,
        ]
    )
    session.commit()
    return tenant_id, message_id, upload.id


def _attach_message_file(
    sessions: sessionmaker[Session],
    *,
    tenant_id: str,
    message_id: str,
    upload_file_id: str,
) -> bool:
    try:
        with sessions.begin() as session:
            lock_and_validate_owned_upload_files_in_session(
                session,
                tenant_id=tenant_id,
                upload_file_ids=(upload_file_id,),
            )
            session.add(
                MessageFile(
                    message_id=message_id,
                    type=FileType.DOCUMENT,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    upload_file_id=upload_file_id,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=str(uuid4()),
                )
            )
    except UploadFileReferenceNotFoundError:
        return False
    return True


@pytest.fixture
def message_file_state(db_session_with_containers: Session) -> tuple[sessionmaker[Session], str, str, str]:
    tenant_id, message_id, upload_file_id = _seed_message_owner(db_session_with_containers)
    return _sessions(db_session_with_containers), tenant_id, message_id, upload_file_id


def test_account_avatar_is_a_live_reference(db_session_with_containers: Session) -> None:
    tenant_id = str(uuid4())
    account = make_account(account_id=str(uuid4()))
    avatar = make_upload_file(
        tenant_id=tenant_id,
        key=f"avatars/{uuid4()}.png",
        extension="png",
        mime_type="image/png",
        created_by=account.id,
    )
    account.avatar = avatar.id
    db_session_with_containers.add_all([account, avatar])
    db_session_with_containers.commit()

    sessions = _sessions(db_session_with_containers)
    deleted = _reclaimer(sessions).delete_unreferenced_files(
        tenant_id=tenant_id,
        file_ids=(avatar.id,),
        delete_blob=lambda _key: pytest.fail("a referenced avatar must not be deleted"),
    )

    assert deleted == ()
    with sessions() as session:
        assert session.get(UploadFile, avatar.id) is not None


def test_writer_first_reference_prevents_reclamation(
    db_session_with_containers: Session,
    message_file_state: tuple[sessionmaker[Session], str, str, str],
) -> None:
    sessions, tenant_id, message_id, upload_file_id = message_file_state
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
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
        if current_thread().name.startswith("upload-cleaner") and " from upload_files " in normalized:
            cleanup_reached_file_lock.set()

    writer = sessions()
    writer.begin()
    lock_and_validate_owned_upload_files_in_session(
        writer,
        tenant_id=tenant_id,
        upload_file_ids=(upload_file_id,),
    )
    event.listen(engine, "before_cursor_execute", observe_cleanup_lock)
    try:
        deleted_blob_keys: list[str] = []

        def reclaim() -> tuple[str, ...]:
            return _reclaimer(sessions).delete_unreferenced_files(
                tenant_id=tenant_id,
                file_ids=(upload_file_id,),
                delete_blob=deleted_blob_keys.append,
            )

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="upload-cleaner") as executor:
            future = executor.submit(reclaim)
            assert cleanup_reached_file_lock.wait(timeout=30)
            assert not future.done()
            writer.add(
                MessageFile(
                    message_id=message_id,
                    type=FileType.DOCUMENT,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    upload_file_id=upload_file_id,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=str(uuid4()),
                )
            )
            writer.commit()
            assert future.result(timeout=30) == ()
        assert deleted_blob_keys == []
    finally:
        if writer.in_transaction():
            writer.rollback()
        writer.close()
        event.remove(engine, "before_cursor_execute", observe_cleanup_lock)


def test_cleanup_first_makes_a_late_writer_revalidate_and_fail(
    db_session_with_containers: Session,
    message_file_state: tuple[sessionmaker[Session], str, str, str],
) -> None:
    sessions, tenant_id, message_id, upload_file_id = message_file_state
    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    writer_reached_file_lock = Event()

    def observe_writer_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if current_thread().name.startswith("message-writer") and " from upload_files " in normalized:
            writer_reached_file_lock.set()

    cleanup = sessions()
    cleanup.begin()
    deleted_blob_keys: list[str] = []
    reclaimer = _reclaimer(sessions)
    assert reclaimer.delete_unreferenced_files_in_session(
        cleanup,
        tenant_id=tenant_id,
        file_ids=(upload_file_id,),
        delete_blob=deleted_blob_keys.append,
    ) == (upload_file_id,)
    event.listen(engine, "before_cursor_execute", observe_writer_lock)
    try:
        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="message-writer") as executor:
            future = executor.submit(
                _attach_message_file,
                sessions,
                tenant_id=tenant_id,
                message_id=message_id,
                upload_file_id=upload_file_id,
            )
            assert writer_reached_file_lock.wait(timeout=30)
            assert not future.done()
            cleanup.commit()
            assert future.result(timeout=30) is False
        assert len(deleted_blob_keys) == 1
    finally:
        if cleanup.in_transaction():
            cleanup.rollback()
        cleanup.close()
        event.remove(engine, "before_cursor_execute", observe_writer_lock)


def test_blob_failure_keeps_an_orphan_after_metadata_commit(
    db_session_with_containers: Session,
    caplog: pytest.LogCaptureFixture,
) -> None:
    tenant_id = str(uuid4())
    upload = make_upload_file(tenant_id=tenant_id, key=f"uploads/{uuid4()}.txt")
    db_session_with_containers.add(upload)
    db_session_with_containers.commit()
    sessions = _sessions(db_session_with_containers)

    remaining_blobs = {upload.key}

    def fail_blob_delete(key: str) -> None:
        assert key in remaining_blobs
        raise OSError("storage unavailable")

    deleted = _reclaimer(sessions).delete_unreferenced_files(
        tenant_id=tenant_id,
        file_ids=(upload.id,),
        delete_blob=fail_blob_delete,
    )
    assert deleted == (upload.id,)
    with sessions() as session:
        assert session.get(UploadFile, upload.id) is None
    # The key remains discoverable by storage maintenance; failure must not
    # claim that an already committed metadata deletion rolled back.
    assert remaining_blobs == {upload.key}
    assert "Committed upload deletion left an orphaned blob" in caplog.text
    assert upload.key in caplog.text
