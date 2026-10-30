from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from types import SimpleNamespace

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.app_config.entities import (
    AppAdditionalFeatures,
    EasyUIBasedAppConfig,
    EasyUIBasedAppModelConfigFrom,
    ModelConfigEntity,
    PromptTemplateEntity,
)
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.entities.app_invoke_entities import ChatAppGenerateEntity, InvokeFrom
from core.workflow.file_reference import build_file_reference
from graphon.file import File, FileTransferMethod, FileType
from models.account import Account
from models.model import App, AppMode, Conversation, Message, MessageFile, UploadFile
from repositories.file.upload_file_repository import (
    UploadFileRepository,
    lock_and_validate_owned_upload_files_in_session,
)
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.file import UploadFileReferenceNotFoundError
from services.file_adapters import build_upload_file_reclaimer
from tests.unit_tests.model_factories import make_account, make_app, make_upload_file


@dataclass(eq=False, repr=False)
class DummyModelConf:
    provider: str = "mock-provider"
    model: str = "mock-model"


class DummyCompletionGenerateEntity:
    __slots__ = ("app_config", "invoke_from", "user_id", "query", "inputs", "files", "model_conf")
    app_config: EasyUIBasedAppConfig
    invoke_from: InvokeFrom
    user_id: str
    query: str
    inputs: dict
    files: list
    model_conf: DummyModelConf

    def __init__(self, app_config: EasyUIBasedAppConfig) -> None:
        self.app_config = app_config
        self.invoke_from = InvokeFrom.WEB_APP
        self.user_id = "user-id"
        self.query = "hello"
        self.inputs = {}
        self.files = []
        self.model_conf = DummyModelConf()


def _app(*, app_id: str = "app") -> App:
    return make_app(app_id=app_id, tenant_id="tenant-id", name="Message App", icon_type=None)


def _account() -> Account:
    return make_account(account_id="user-id", name="Message User", email="message-user@example.com")


def _make_app_config(app_mode: AppMode) -> EasyUIBasedAppConfig:
    return EasyUIBasedAppConfig(
        tenant_id="tenant-id",
        app_id="app-id",
        app_mode=app_mode,
        app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
        app_model_config_id="model-config-id",
        app_model_config_dict={},
        model=ModelConfigEntity(provider="mock-provider", model="mock-model", mode="chat"),
        prompt_template=PromptTemplateEntity(
            prompt_type=PromptTemplateEntity.PromptType.SIMPLE,
            simple_prompt_template="Hello",
        ),
        additional_features=AppAdditionalFeatures(),
        variables=[],
    )


def _make_chat_generate_entity(app_config: EasyUIBasedAppConfig) -> ChatAppGenerateEntity:
    return ChatAppGenerateEntity.model_construct(
        task_id="task-id",
        app_config=app_config,
        model_conf=DummyModelConf(),
        file_upload_config=None,
        conversation_id=None,
        inputs={},
        query="hello",
        files=[],
        parent_message_id=None,
        user_id="user-id",
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        extras={},
        call_depth=0,
        trace_manager=None,
    )


def _make_upload_backed_file(
    upload: UploadFile,
    *,
    transfer_method: FileTransferMethod = FileTransferMethod.LOCAL_FILE,
) -> File:
    return File(
        file_id=f"runtime-{upload.id}",
        file_type=FileType.DOCUMENT,
        transfer_method=transfer_method,
        reference=build_file_reference(record_id=upload.id, storage_key=upload.key),
        remote_url="https://example.com/message.txt" if transfer_method == FileTransferMethod.REMOTE_URL else None,
        filename=upload.name,
        extension=f".{upload.extension}",
        mime_type=upload.mime_type,
        size=upload.size,
    )


def test_init_generate_records_skips_conversation_fields_for_non_conversation_entity(sqlite_session: Session):
    app_config = _make_app_config(AppMode.COMPLETION)
    entity = DummyCompletionGenerateEntity(app_config=app_config)

    generator = MessageBasedAppGenerator()

    conversation, message = generator._init_generate_records(
        entity,
        conversation=None,
        session=sqlite_session,
    )

    assert conversation.id is not None
    assert message.id is not None
    assert hasattr(entity, "conversation_id") is False
    assert hasattr(entity, "is_new_conversation") is False


def test_init_generate_records_sets_conversation_fields_for_chat_entity(sqlite_session: Session):
    app_config = _make_app_config(AppMode.CHAT)
    entity = _make_chat_generate_entity(app_config)

    generator = MessageBasedAppGenerator()

    conversation, _ = generator._init_generate_records(
        entity,
        conversation=None,
        session=sqlite_session,
    )

    assert entity.conversation_id == conversation.id
    assert entity.is_new_conversation is True
    assert conversation.id is not None


def test_init_generate_records_rejects_file_removed_after_early_validation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    upload = make_upload_file(file_id="upload-file", tenant_id="tenant-id", key="uploads/message.txt")
    with sqlite_session_factory.begin() as session:
        session.add(upload)

    # File parsing/validation happens before message persistence. Releasing that
    # transaction must not let a later MessageFile refer to a cleanup winner.
    with sqlite_session_factory.begin() as session:
        lock_and_validate_owned_upload_files_in_session(
            session,
            tenant_id="tenant-id",
            upload_file_ids=(upload.id,),
        )

    files = UploadFileRepository(session_factory=sqlite_session_factory)
    cleanup = build_upload_file_reclaimer(session_factory=sqlite_session_factory, files=files)
    claimed = cleanup.delete_unreferenced_files(
        tenant_id="tenant-id",
        file_ids=(upload.id,),
        delete_blob=lambda _key: None,
    )
    assert claimed == (upload.id,)

    entity = _make_chat_generate_entity(_make_app_config(AppMode.CHAT))
    entity.files = [_make_upload_backed_file(upload)]
    with sqlite_session_factory() as session:
        with pytest.raises(UploadFileReferenceNotFoundError) as exc_info:
            MessageBasedAppGenerator()._init_generate_records(entity, session=session)
    assert exc_info.value.missing_file_ids == (upload.id,)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, upload.id) is None
        assert session.scalar(select(func.count()).select_from(Conversation)) == 0
        assert session.scalar(select(func.count()).select_from(Message)) == 0
        assert session.scalar(select(func.count()).select_from(MessageFile)) == 0


def test_init_generate_records_revalidates_uploads_persisted_only_in_inputs(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    removed = make_upload_file(file_id="removed-input", tenant_id="tenant-id", key="uploads/input.txt")
    entity = _make_chat_generate_entity(_make_app_config(AppMode.CHAT))
    entity.inputs = {"attachment": _make_upload_backed_file(removed)}

    with sqlite_session_factory() as session:
        with pytest.raises(UploadFileReferenceNotFoundError) as exc_info:
            MessageBasedAppGenerator()._init_generate_records(entity, session=session)
    assert exc_info.value.missing_file_ids == (removed.id,)

    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Conversation)) == 0
        assert session.scalar(select(func.count()).select_from(Message)) == 0


def test_init_generate_records_file_lock_serializes_cleanup_behind_message_commit(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
) -> None:
    upload = make_upload_file(file_id="upload-file", tenant_id="tenant-id", key="uploads/message.txt")
    with sqlite_session_factory.begin() as session:
        session.add(upload)

    entity = _make_chat_generate_entity(_make_app_config(AppMode.CHAT))
    entity.files = [_make_upload_backed_file(upload)]
    files = UploadFileRepository(session_factory=sqlite_session_factory)
    cleanup = build_upload_file_reclaimer(session_factory=sqlite_session_factory, files=files)
    cleanup_query_started = threading.Event()
    message_thread_id = threading.get_ident()

    def observe_cleanup_query(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if threading.get_ident() != message_thread_id and "upload_files" in statement:
            cleanup_query_started.set()

    event.listen(sqlite_engine, "before_cursor_execute", observe_cleanup_query)
    try:
        with sqlite_session_factory() as message_session:
            # SQLite ignores row-level FOR SHARE. An exclusive transaction gives
            # this unit test the same serialization point while both callers run
            # through their real repository paths.
            message_session.execute(text("BEGIN EXCLUSIVE"))
            with ThreadPoolExecutor(max_workers=1) as executor:
                cleanup_result = executor.submit(
                    cleanup.delete_unreferenced_files,
                    tenant_id="tenant-id",
                    file_ids=(upload.id,),
                    delete_blob=lambda _key: None,
                )
                assert cleanup_query_started.wait(timeout=2)
                _, message = MessageBasedAppGenerator()._init_generate_records(entity, session=message_session)
                assert cleanup_result.result(timeout=2) == ()
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", observe_cleanup_query)

    with sqlite_session_factory() as session:
        assert session.get(UploadFile, upload.id) is not None
        message_file = session.scalar(select(MessageFile).where(MessageFile.message_id == message.id))
        assert message_file is not None
        assert message_file.upload_file_id == upload.id


def test_init_generate_records_validates_only_upload_backed_file_methods(sqlite_session: Session) -> None:
    local = make_upload_file(file_id="local-upload", tenant_id="tenant-id", key="uploads/local.txt")
    datasource = make_upload_file(file_id="datasource-upload", tenant_id="tenant-id", key="uploads/datasource.txt")
    remote = make_upload_file(file_id="remote-upload", tenant_id="tenant-id", key="uploads/remote.txt")
    sqlite_session.add_all([local, datasource, remote])

    entity = _make_chat_generate_entity(_make_app_config(AppMode.CHAT))
    entity.files = [
        _make_upload_backed_file(local),
        _make_upload_backed_file(datasource, transfer_method=FileTransferMethod.DATASOURCE_FILE),
        _make_upload_backed_file(remote, transfer_method=FileTransferMethod.REMOTE_URL),
        File(
            file_id="pure-remote",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.REMOTE_URL,
            remote_url="https://example.com/unbacked.txt",
            filename="unbacked.txt",
            extension=".txt",
            mime_type="text/plain",
            size=10,
        ),
        File(
            file_id="tool-runtime",
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.TOOL_FILE,
            reference=build_file_reference(record_id="tool-file"),
            filename="tool.txt",
            extension=".txt",
            mime_type="text/plain",
            size=10,
        ),
    ]

    _, message = MessageBasedAppGenerator()._init_generate_records(entity, session=sqlite_session)

    persisted = sqlite_session.scalars(select(MessageFile).where(MessageFile.message_id == message.id)).all()
    assert {(row.transfer_method, row.upload_file_id) for row in persisted} == {
        (FileTransferMethod.LOCAL_FILE, local.id),
        (FileTransferMethod.DATASOURCE_FILE, datasource.id),
        (FileTransferMethod.REMOTE_URL, remote.id),
        (FileTransferMethod.REMOTE_URL, None),
        (FileTransferMethod.TOOL_FILE, "tool-file"),
    }


class TestMessageBasedAppGeneratorExtras:
    def test_handle_response_closed_file_raises_stopped(self, monkeypatch: pytest.MonkeyPatch):
        generator = MessageBasedAppGenerator()

        class _Pipeline:
            def __init__(self, **kwargs) -> None:
                _ = kwargs

            def process(self):
                raise ValueError("I/O operation on closed file.")

        monkeypatch.setattr(
            "core.app.apps.message_based_app_generator.EasyUIBasedGenerateTaskPipeline",
            _Pipeline,
        )

        with pytest.raises(GenerateTaskStoppedError):
            generator._handle_response(
                application_generate_entity=_make_chat_generate_entity(_make_app_config(AppMode.CHAT)),
                queue_manager=SimpleNamespace(),
                conversation=Conversation(id="conv", app_id="app"),
                message=Message(id="msg", app_id="app", conversation_id="conv"),
                user=_account(),
                stream=False,
            )

    def test_get_app_model_config_requires_valid_config(self, sqlite_session: Session):
        generator = MessageBasedAppGenerator()
        app_model = _app()
        session = sqlite_session

        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(app_model, conversation=None, session=session)

        conversation = Conversation(id="conversation-id", app_id="app", app_model_config_id="missing-id")
        with pytest.raises(AppModelConfigBrokenError):
            generator._get_app_model_config(
                app_model=_app(),
                conversation=conversation,
                session=session,
            )

    def test_get_conversation_introduction_handles_missing_inputs(self):
        app_config = _make_app_config(AppMode.CHAT)
        app_config.additional_features.opening_statement = "Hello {{name}}"
        entity = _make_chat_generate_entity(app_config)
        entity.inputs = {}

        generator = MessageBasedAppGenerator()

        assert generator._get_conversation_introduction(entity) == "Hello {name}"
