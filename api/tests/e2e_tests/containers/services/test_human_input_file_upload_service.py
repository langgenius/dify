import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Event, current_thread
from typing import override
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import services.human_input_file_upload_service as service_module
import tasks.delete_conversation_task as delete_conversation_module
from core.workflow.nodes.human_input.enums import HumanInputFormKind
from enums.creator import CreatorUserRole
from extensions.ext_database import db
from extensions.storage.storage_type import StorageType
from libs.datetime_utils import naive_utc_now
from models.human_input import (
    HumanInputForm,
    HumanInputFormRecipient,
    HumanInputFormUploadFile,
    HumanInputFormUploadToken,
    StandaloneWebAppRecipientPayload,
)
from models.model import AppMode, ConversationFromSource
from repositories.sqlalchemy_api_workflow_run_repository import DifyAPISQLAlchemyWorkflowRunRepository
from repositories.workflow.human_input.file_upload_repository import SQLAlchemyHumanInputFileUploadRepository
from services.entities.upload_file import FileUploadActor, UploadFileRecord
from services.file_service import FileService
from services.human_input_file_upload_service import (
    HITL_UPLOAD_TOKEN_PREFIX,
    HumanInputFileUploadService,
    HumanInputUploadContext,
    InvalidUploadTokenError,
)
from services.remote_file_service import RemoteFileService
from tests.helpers.unit.model_factories import make_account, make_app, make_conversation, make_upload_file


class _RecordingFiles(FileService):
    def __init__(self, upload: UploadFileRecord) -> None:
        self.upload = upload
        self.deleted: list[tuple[str, str]] = []

    @override
    def upload_file(
        self,
        *,
        actor: FileUploadActor,
        tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        allowed_extensions: frozenset[str] | None = None,
        source_url: str = "",
        default_file_size_limit: int | None = None,
    ) -> UploadFileRecord:
        del actor, tenant_id, filename, content, mimetype, allowed_extensions, source_url, default_file_size_limit
        return self.upload

    @override
    def delete_file(self, *, tenant_id: str, file_id: str) -> None:
        self.deleted.append((tenant_id, file_id))


def _upload_record(*, file_id: str, tenant_id: str) -> UploadFileRecord:
    return UploadFileRecord(
        id=file_id,
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"uploads/{file_id}",
        name="sample.txt",
        size=7,
        extension="txt",
        mime_type="text/plain",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=naive_utc_now(),
        hash=None,
        source_url="",
    )


def _create_waiting_form_recipient(
    db_session_with_containers: Session,
) -> tuple[str, str, datetime]:
    form_id = "00000000-0000-0000-0000-000000000101"
    recipient_id = "00000000-0000-0000-0000-000000000102"
    expiration_time = naive_utc_now() + timedelta(hours=1)

    db_session_with_containers.add(
        HumanInputForm(
            id=form_id,
            tenant_id=str(uuid.uuid4()),
            app_id=str(uuid.uuid4()),
            workflow_run_id=None,
            form_kind=HumanInputFormKind.DELIVERY_TEST,
            node_id="human-node",
            form_definition="{}",
            rendered_content="content",
            expiration_time=expiration_time,
        )
    )
    db_session_with_containers.add(
        HumanInputFormRecipient(
            id=recipient_id,
            form_id=form_id,
            delivery_id=str(uuid.uuid4()),
            recipient_type=StandaloneWebAppRecipientPayload().TYPE,
            recipient_payload=StandaloneWebAppRecipientPayload().model_dump_json(),
            access_token="form-token-1",
        )
    )
    db_session_with_containers.commit()
    return form_id, recipient_id, expiration_time


def test_issue_upload_token_returns_expiration_with_default_session_expiry(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    form_id, recipient_id, expiration_time = _create_waiting_form_recipient(db_session_with_containers)
    monkeypatch.setattr(service_module.secrets, "token_urlsafe", lambda _bytes: "random-value")

    service = HumanInputFileUploadService(
        uploads=SQLAlchemyHumanInputFileUploadRepository(session_factory=sessionmaker(bind=db.engine)),
        workflow_run_repository=MagicMock(),
        files=MagicMock(),
        remote_files=MagicMock(),
    )

    token = service.issue_upload_token("form-token-1")

    assert token.upload_token == f"{HITL_UPLOAD_TOKEN_PREFIX}random-value"
    assert token.expires_at == expiration_time

    db_session_with_containers.expire_all()
    token_model = db_session_with_containers.scalar(select(HumanInputFormUploadToken))
    assert token_model is not None
    assert token_model.form_id == form_id
    assert token_model.recipient_id == recipient_id
    assert token_model.token == token.upload_token


def test_conversation_cleanup_serializes_with_final_upload_owner_check(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A publisher that loses the form lock must reject and compensate its file."""

    tenant_id = str(uuid.uuid4())
    app_id = str(uuid.uuid4())
    conversation_id = str(uuid.uuid4())
    form_id = str(uuid.uuid4())
    recipient_id = str(uuid.uuid4())
    upload_token_id = str(uuid.uuid4())
    upload_file_id = str(uuid.uuid4())
    account = make_account(account_id=str(uuid.uuid4()))
    form = HumanInputForm(
        id=form_id,
        tenant_id=tenant_id,
        app_id=app_id,
        conversation_id=conversation_id,
        workflow_run_id=None,
        form_kind=HumanInputFormKind.RUNTIME,
        node_id="human-node",
        form_definition="{}",
        rendered_content="content",
        expiration_time=naive_utc_now() + timedelta(hours=1),
    )
    recipient = HumanInputFormRecipient(
        id=recipient_id,
        form_id=form_id,
        delivery_id=str(uuid.uuid4()),
        recipient_type=StandaloneWebAppRecipientPayload().TYPE,
        recipient_payload=StandaloneWebAppRecipientPayload().model_dump_json(),
        access_token="form-token-race",
    )
    upload_token = HumanInputFormUploadToken(
        id=upload_token_id,
        tenant_id=tenant_id,
        app_id=app_id,
        form_id=form_id,
        recipient_id=recipient_id,
        token="hitl-upload-token-race",
    )
    db_session_with_containers.add_all(
        [
            make_app(app_id=app_id, tenant_id=tenant_id, mode=AppMode.WORKFLOW, created_by=account.id),
            make_conversation(
                conversation_id=conversation_id,
                app_id=app_id,
                inputs={},
                from_source=ConversationFromSource.CONSOLE,
                from_account_id=account.id,
                is_deleted=True,
            ),
            form,
            recipient,
            upload_token,
            make_upload_file(file_id=upload_file_id, tenant_id=tenant_id),
        ]
    )
    db_session_with_containers.commit()

    engine = db_session_with_containers.get_bind()
    assert isinstance(engine, Engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(delete_conversation_module.session_factory, "get_session_maker", lambda: sessions)
    files = _RecordingFiles(_upload_record(file_id=upload_file_id, tenant_id=tenant_id))
    service = HumanInputFileUploadService(
        uploads=SQLAlchemyHumanInputFileUploadRepository(session_factory=sessions),
        workflow_run_repository=DifyAPISQLAlchemyWorkflowRunRepository(sessions),
        files=files,
        remote_files=RemoteFileService(files=files),
    )
    context = HumanInputUploadContext(
        tenant_id=tenant_id,
        app_id=app_id,
        form_id=form_id,
        recipient_id=recipient_id,
        upload_token_id=upload_token_id,
        owner=account,
    )
    cleanup_holds_form = Event()
    allow_cleanup = Event()
    publisher_reached_form = Event()

    def pause_after_cleanup_form_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if (
            current_thread().name.startswith("hitl-cleanup")
            and " from human_input_forms " in normalized
            and "conversation_id" in normalized
            and "for update" in normalized
        ):
            cleanup_holds_form.set()
            assert allow_cleanup.wait(timeout=30)

    def observe_publisher_form_lock(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        normalized = " ".join(statement.lower().replace('"', "").replace("`", "").split())
        if current_thread().name.startswith("hitl-publisher") and " from human_input_forms " in normalized:
            publisher_reached_form.set()

    event.listen(engine, "after_cursor_execute", pause_after_cleanup_form_lock)
    event.listen(engine, "before_cursor_execute", observe_publisher_form_lock)
    cleanup_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hitl-cleanup")
    publisher_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hitl-publisher")
    try:
        cleanup_future = cleanup_executor.submit(
            delete_conversation_module._cleanup_conversation_related_data,
            conversation_id,
        )
        assert cleanup_holds_form.wait(timeout=30)
        publisher_future = publisher_executor.submit(
            service.upload_local_file,
            context=context,
            filename="sample.txt",
            content=b"content",
            mimetype="text/plain",
        )
        assert publisher_reached_form.wait(timeout=30)
        assert not publisher_future.done()
        allow_cleanup.set()
        assert cleanup_future.result(timeout=30) is True
        with pytest.raises(InvalidUploadTokenError):
            publisher_future.result(timeout=30)
    finally:
        allow_cleanup.set()
        cleanup_executor.shutdown(wait=True)
        publisher_executor.shutdown(wait=True)
        event.remove(engine, "after_cursor_execute", pause_after_cleanup_form_lock)
        event.remove(engine, "before_cursor_execute", observe_publisher_form_lock)

    assert files.deleted == [(tenant_id, upload_file_id)]
    with sessions() as session:
        assert session.get(HumanInputForm, form_id) is None
        assert session.get(HumanInputFormUploadToken, upload_token_id) is None
        assert (
            session.scalar(select(HumanInputFormUploadFile).where(HumanInputFormUploadFile.form_id == form_id)) is None
        )
