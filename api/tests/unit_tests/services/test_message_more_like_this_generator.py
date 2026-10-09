"""Real completion preparation, stored files and failure cleanup without provider stubs.

The worker/Redis and provider transport paths live in the container suite. These
cases use invalid persisted provider data to stop model preparation before I/O.
"""

import json
from collections.abc import Generator, Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, delete, event, func, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope, get_current_file_access_scope
from core.entities.provider_entities import ProviderQuotaType, QuotaUnit
from core.hosting_configuration import HostingProvider, TrialHostingQuota
from core.workflow.file_reference import resolve_file_record_id
from extensions import ext_hosting_provider
from extensions.ext_database import db
from extensions.storage.storage_type import StorageType
from graphon.file import File, FileTransferMethod, FileType
from graphon.file.constants import FILE_MODEL_IDENTITY
from graphon.model_runtime.entities.model_entities import ModelType
from models import App, AppMode, AppModelConfig, Conversation, EndUser, Message, MessageFile, UploadFile
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.provider import Provider, ProviderModel, ProviderType
from repositories.message_repository import MessageRepository
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.entities.message_entities import MessageEndUser
from services.message_more_like_this_generator import (
    MessageMoreLikeThisGenerator,
    _file_mapping,
    _MoreLikeThisEventStream,
    _restore_inputs,
)
from services.message_more_like_this_service import MessageMoreLikeThisService, MoreLikeThisFile, MoreLikeThisResponse


@dataclass(frozen=True)
class _Runtime:
    app: Flask
    service: MessageMoreLikeThisService
    app_id: str
    tenant_id: str
    end_user_id: str
    message_id: str
    historical_config_id: str
    sessions: list[Session]

    def generate(self) -> MoreLikeThisResponse:
        with self.app.test_request_context("/messages/regenerate"):
            return self.service.generate(
                app_id=self.app_id,
                app_owner_tenant_id=self.tenant_id,
                actor=MessageEndUser(end_user_id=self.end_user_id),
                message_id=self.message_id,
                streaming=False,
            )


@pytest.fixture
def runtime(sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]) -> Iterator[_Runtime]:
    tenant_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        app_record = App(
            tenant_id=tenant_id, name="Completion", mode=AppMode.COMPLETION, enable_site=True, enable_api=True
        )
        session.add(app_record)
        session.flush()
        end_user = EndUser(tenant_id=tenant_id, app_id=app_record.id, type="browser", session_id=str(uuid4()))
        current = AppModelConfig(app_id=app_record.id, more_like_this='{"enabled":true}')
        historical = AppModelConfig(
            app_id=app_record.id,
            model=json.dumps(
                {"provider": "langgenius/openai/openai", "name": "test-model", "mode": "chat", "completion_params": {}}
            ),
            pre_prompt="Historical prompt",
        )
        session.add_all([end_user, current, historical])
        session.flush()
        app_record.app_model_config_id = current.id
        conversation = Conversation(
            app_id=app_record.id,
            app_model_config_id=historical.id,
            mode=AppMode.COMPLETION,
            name="Original completion",
            inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=app_record.id,
            conversation_id=conversation.id,
            inputs={},
            query="Original query",
            message={},
            answer="Original answer",
            message_unit_price=0,
            answer_unit_price=0,
            currency="USD",
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        session.add_all([message, Provider(tenant_id=tenant_id, provider_name="invalid/provider", is_valid=True)])
        session.flush()

    factory = sessionmaker(bind=sqlite_engine)
    service = MessageMoreLikeThisService(
        repository=MessageRepository(
            session_factory=factory, extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=factory)
        ),
        generator=MessageMoreLikeThisGenerator(session_factory=factory),
    )
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = str(sqlite_engine.url)
    db.init_app(app)
    sessions: list[Session] = []

    def observe(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        sessions.append(session)

    event.listen(factory, "after_begin", observe)
    with app.app_context():
        event.listen(db.session.session_factory, "after_begin", observe)
        try:
            yield _Runtime(app, service, app_record.id, tenant_id, end_user.id, message.id, historical.id, sessions)
        finally:
            event.remove(db.session.session_factory, "after_begin", observe)
            db.session.remove()
            db.engine.dispose()
            event.remove(factory, "after_begin", observe)


def test_real_model_preparation_failure_closes_queries_without_creating_records(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with pytest.raises(ValueError, match="Invalid plugin id invalid/provider"):
        runtime.generate()
    assert runtime.sessions
    assert all(not session.in_transaction() and not session.identity_map for session in runtime.sessions)
    assert get_current_file_access_scope() is None
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Message)) == 1
        assert session.scalar(select(func.count()).select_from(Conversation)) == 1


def _attach_file(runtime: _Runtime, session_factory: sessionmaker[Session], *, limit: int = 2) -> UploadFile:
    upload = UploadFile(
        tenant_id=runtime.tenant_id,
        storage_type=StorageType.LOCAL,
        key="stored/image.png",
        name="image.png",
        size=123,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.END_USER,
        created_by=runtime.end_user_id,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=True,
    )
    with session_factory.begin() as session:
        config = session.get(AppModelConfig, runtime.historical_config_id)
        assert config is not None
        config.file_upload = json.dumps(
            {
                "enabled": True,
                "allowed_file_types": ["image"],
                "allowed_file_upload_methods": ["local_file"],
                "number_limits": limit,
            }
        )
        session.add(upload)
        session.add(
            MessageFile(
                message_id=runtime.message_id,
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                upload_file_id=upload.id,
                created_by_role=CreatorUserRole.END_USER,
                created_by=runtime.end_user_id,
                belongs_to=MessageFileBelongsTo.USER,
            )
        )
    return upload


@pytest.mark.parametrize("failure", ["missing", "tenant", "owner"])
def test_file_restoration_rejects_missing_or_foreign_uploads_before_model_resolution(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], failure: str
) -> None:
    upload = _attach_file(runtime, sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        file = session.get(UploadFile, upload.id)
        assert file is not None
        if failure == "missing":
            session.delete(file)
        elif failure == "tenant":
            file.tenant_id = str(uuid4())
        else:
            file.created_by = str(uuid4())
    with pytest.raises(ValueError, match="Invalid upload file"):
        runtime.generate()
    assert all(not session.in_transaction() and not session.identity_map for session in runtime.sessions)
    assert get_current_file_access_scope() is None


def test_attachment_count_limit_stops_generation(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session]
) -> None:
    for _ in range(2):
        _attach_file(runtime, sqlite_session_factory, limit=1)
    with pytest.raises(ValueError, match="Number of image files exceeds"):
        runtime.generate()
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Message)) == 1


@pytest.mark.parametrize("as_list", [False, True])
def test_stored_input_restoration_reloads_metadata_using_the_admitted_tenant(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], as_list: bool
) -> None:
    uploaded = _attach_file(runtime, sqlite_session_factory)
    mapping: dict[str, JsonValue] = {
        "dify_model_identity": FILE_MODEL_IDENTITY,
        "type": "image",
        "transfer_method": "local_file",
        "related_id": uploaded.id,
        "tenant_id": str(uuid4()),
        "filename": "untrusted-name.png",
    }
    scope = FileAccessScope(
        tenant_id=runtime.tenant_id,
        user_id=runtime.end_user_id,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    with bind_file_access_scope(scope):
        restored = _restore_inputs(
            {"file": [mapping] if as_list else mapping, "count": 0, "empty": "", "items": []},
            tenant_id=runtime.tenant_id,
        )
    file = restored["file"][0] if as_list else restored["file"]
    assert isinstance(file, File)
    assert file.filename == "image.png"
    assert resolve_file_record_id(file.reference) == uploaded.id
    assert restored["count"] == 0
    assert restored["empty"] == ""
    assert restored["items"] == []
    assert mapping["filename"] == "untrusted-name.png"


def test_real_provider_initialization_commit_does_not_flush_the_callers_pending_session(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    provider_name = "langgenius/openai/openai"
    with sqlite_session_factory.begin() as session:
        session.execute(delete(Provider).where(Provider.tenant_id == runtime.tenant_id))
        session.add(Provider(tenant_id=runtime.tenant_id, provider_name=provider_name, is_valid=True))
        # Model records are normalized after real hosting initialization commits.
        session.add(
            ProviderModel(
                tenant_id=runtime.tenant_id,
                provider_name="invalid/provider",
                model_name="broken",
                model_type=ModelType.LLM,
                is_valid=True,
            )
        )
    monkeypatch.setattr(
        ext_hosting_provider.hosting_configuration,
        "provider_map",
        {provider_name: HostingProvider(enabled=True, quota_unit=QuotaUnit.TIMES, quotas=[TrialHostingQuota()])},
    )
    caller = db.session()
    pending = caller.get(App, runtime.app_id)
    assert pending is not None
    pending.name = "Pending caller change"
    try:
        with pytest.raises(ValueError, match="Invalid plugin id invalid/provider"):
            runtime.generate()
        assert db.session() is caller
        assert caller.in_transaction()
        assert pending in caller.dirty
        with sqlite_session_factory() as session:
            trial = session.scalar(
                select(Provider).where(
                    Provider.tenant_id == runtime.tenant_id,
                    Provider.provider_type == ProviderType.SYSTEM,
                    Provider.quota_type == ProviderQuotaType.TRIAL,
                )
            )
            assert trial is not None
            assert session.scalar(select(App.name).where(App.id == runtime.app_id)) == "Completion"
    finally:
        caller.rollback()


@pytest.mark.parametrize(
    ("transfer_method", "url", "upload_file_id", "expected"),
    [
        (FileTransferMethod.LOCAL_FILE, None, None, "no upload_file_id"),
        (FileTransferMethod.REMOTE_URL, None, None, "no url"),
        (FileTransferMethod.TOOL_FILE, None, None, "no tool file reference"),
        (FileTransferMethod.DATASOURCE_FILE, None, "record", "invalid transfer_method"),
    ],
)
def test_invalid_stored_attachment_reports_the_message_file_id(
    transfer_method: FileTransferMethod, url: str | None, upload_file_id: str | None, expected: str
) -> None:
    file = MoreLikeThisFile("message-file-id", "image", transfer_method, url, upload_file_id)
    with pytest.raises(ValueError, match=f"MessageFile message-file-id .*{expected}"):
        _file_mapping(file)


@pytest.mark.parametrize("record_id", [None, "explicit-file-id"])
def test_legacy_tool_reference_is_recovered_without_changing_the_stored_reference(record_id: str | None) -> None:
    file = MoreLikeThisFile(
        "message-file-id", "image", "tool_file", "https://example.com/tools/legacy-id.png", record_id
    )
    mapping = _file_mapping(file)
    assert mapping["tool_file_id"] == (record_id or "legacy-id")
    assert file.upload_file_id == record_id


@pytest.mark.parametrize("termination", ["exhaust", "partial", "error"])
def test_event_stream_encodes_events_and_closes_its_source(termination: str) -> None:
    closed: list[bool] = []

    def source() -> Generator[Mapping[str, object] | str, None, None]:
        try:
            yield {"event": "message", "answer": "hello"}
            yield "ping"
            if termination == "error":
                # A real iterator failure tests this iterator wrapper's ownership.
                json.loads("{")
        finally:
            closed.append(True)

    stream = _MoreLikeThisEventStream(source())
    assert next(stream) == 'data: {"event":"message","answer":"hello"}\n\n'
    if termination == "partial":
        stream.close()
    else:
        assert next(stream) == "event: ping\n\n"
        with pytest.raises(json.JSONDecodeError if termination == "error" else StopIteration):
            next(stream)
    stream.close()
    assert closed == [True]


@pytest.mark.parametrize("consume_all", [False, True])
def test_flask_response_close_releases_its_real_event_iterator(consume_all: bool) -> None:
    from libs.helper import compact_generate_response

    closed: list[bool] = []

    def events() -> Generator[Mapping[str, object] | str, None, None]:
        try:
            yield {"event": "message", "answer": "hello"}
            yield {"event": "message_end"}
        finally:
            closed.append(True)

    with Flask(__name__).test_request_context():
        response = compact_generate_response(_MoreLikeThisEventStream(events()))
        try:
            assert response.mimetype == "text/event-stream"
            if consume_all:
                assert response.get_data(as_text=True) == (
                    'data: {"event":"message","answer":"hello"}\n\ndata: {"event":"message_end"}\n\n'
                )
            else:
                assert next(iter(response.response)) == 'data: {"event":"message","answer":"hello"}\n\n'
                assert not closed
        finally:
            response.close()
    assert closed == [True]
