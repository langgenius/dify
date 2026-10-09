"""Run completion preparation, record creation and response handling with real dependencies."""

import json
from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast, override
from uuid import uuid4

import pytest
from flask import Flask
from httpx import Request, Response
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import get_current_file_access_scope
from core.entities.provider_configuration import ProviderConfiguration, ProviderConfigurations
from core.entities.provider_entities import CustomProviderConfiguration
from core.errors.error import ProviderTokenNotInitError
from core.file import remote_fetcher
from core.plugin.impl.model_runtime import PluginModelRuntime
from core.provider_manager import ProviderManager
from core.workflow.file_reference import resolve_file_record_id
from extensions.ext_database import db
from extensions.ext_storage import storage
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from graphon.file.constants import FILE_MODEL_IDENTITY
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage
from graphon.model_runtime.entities.model_entities import AIModelEntity
from models import (
    Account,
    App,
    AppMode,
    AppModelConfig,
    Conversation,
    EndUser,
    Message,
    MessageFile,
    ToolFile,
    UploadFile,
)
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from repositories.message_repository import MessageRepository
from services.entities.message_entities import MessageEndUser
from services.message_more_like_this_generator import MessageMoreLikeThisGenerator, _MoreLikeThisEventStream
from services.message_more_like_this_service import (
    MessageMoreLikeThisService,
    MoreLikeThisResponse,
)
from tests.unit_tests.core.model_fixtures import make_model_config

_PROVIDER = "langgenius/openai/openai"
_MODEL = "test-model"


@dataclass
class _Runtime:
    app: Flask
    service: MessageMoreLikeThisService
    generator: MessageMoreLikeThisGenerator
    app_id: str
    tenant_id: str
    end_user_id: str
    message_id: str
    historical_config_id: str
    provider: ProviderConfiguration
    closed_sessions: list[Session]
    model_parameters: list[dict[str, object]]
    prompts: list[str]

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
def runtime(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> _Runtime:
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
            more_like_this='{"enabled":false}',
            model=json.dumps(
                {"provider": _PROVIDER, "name": _MODEL, "mode": "chat", "completion_params": {"temperature": 0.1}}
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
            inputs={"count": 0, "empty": "", "items": []},
            query="Original query",
            message={},
            answer="Original answer",
            message_unit_price=0,
            answer_unit_price=0,
            currency="USD",
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        session.add(message)
        session.flush()

    closed_sessions: list[Session] = []

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            super().close()
            closed_sessions.append(self)

    factory = cast(sessionmaker[Session], sessionmaker(bind=sqlite_engine, class_=TrackedSession))
    generator = MessageMoreLikeThisGenerator(session_factory=factory)
    service = MessageMoreLikeThisService(repository=MessageRepository(session_factory=factory), generator=generator)
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    config = make_model_config(provider=_PROVIDER, model=_MODEL, mode="chat")
    provider = config.provider_model_bundle.configuration
    provider.tenant_id = tenant_id
    provider.provider.models = [config.model_schema]
    provider.custom_configuration.provider = CustomProviderConfiguration(credentials={"api_key": "test-key"})
    model_parameters: list[dict[str, object]] = []
    prompts: list[str] = []

    def configurations(_manager: ProviderManager, tenant_id: str) -> ProviderConfigurations:
        assert tenant_id == provider.tenant_id
        assert len(closed_sessions) >= 2
        assert all(not session.in_transaction() and not session.identity_map for session in closed_sessions)
        configurations = ProviderConfigurations(tenant_id=tenant_id)
        configurations.configurations[_PROVIDER] = provider
        return configurations

    def schema(_runtime: PluginModelRuntime, **_kwargs: object) -> AIModelEntity:
        return config.model_schema

    def tokens(_runtime: PluginModelRuntime, **_kwargs: object) -> int:
        return 1

    def invoke(
        _runtime: PluginModelRuntime,
        *,
        prompt_messages: Sequence[PromptMessage],
        model_parameters: dict[str, object],
        stream: bool,
        **_kwargs: object,
    ) -> LLMResult:
        assert not stream
        assert len(closed_sessions) == 3
        assert all(not session.in_transaction() and not session.identity_map for session in closed_sessions)
        parameters.append(dict(model_parameters))
        prompts.extend(prompt.get_text_content() for prompt in prompt_messages)
        return LLMResult(
            model=_MODEL,
            prompt_messages=list(prompt_messages),
            message=AssistantPromptMessage(content="New answer"),
            usage=LLMUsage.empty_usage(),
        )

    def load_file(filename: str) -> bytes:
        assert filename in {"stored/image.png", "tools/image.png"}
        assert len(closed_sessions) == 3
        assert all(not session.in_transaction() for session in closed_sessions)
        return b"test image content"

    parameters = model_parameters
    # Replace only credential loading and provider network calls. Config managers,
    # ModelConfigConverter, the worker, queue, record writes and pipeline stay real.
    monkeypatch.setattr(ProviderManager, "get_configurations", configurations)
    monkeypatch.setattr(PluginModelRuntime, "get_model_schema", schema)
    monkeypatch.setattr(PluginModelRuntime, "get_llm_num_tokens", tokens)
    monkeypatch.setattr(PluginModelRuntime, "invoke_llm", invoke)
    monkeypatch.setattr(storage, "load_once", load_file)
    return _Runtime(
        app,
        service,
        generator,
        app_record.id,
        tenant_id,
        end_user.id,
        message.id,
        historical.id,
        provider,
        closed_sessions,
        model_parameters,
        prompts,
    )


def test_real_runtime_creates_a_new_completion_and_closes_queries_before_model_invocation(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session]
) -> None:
    response = runtime.generate()
    assert isinstance(response, Mapping)
    assert response["answer"] == "New answer"
    assert response["message_id"] != runtime.message_id
    assert runtime.model_parameters == [{"temperature": 0.9}]
    assert any("Historical prompt" in prompt for prompt in runtime.prompts)
    with sqlite_session_factory() as session:
        message = session.get(Message, response["message_id"])
        original = session.get(Message, runtime.message_id)
        assert message is not None
        assert original is not None
        assert message.conversation_id != original.conversation_id
        assert message.query == "Original query"
        assert message._inputs == {"count": 0, "empty": "", "items": []}
        assert message.from_end_user_id == runtime.end_user_id
        assert message.from_account_id is None
        assert message.answer == "New answer"
        assert session.scalar(select(func.count()).select_from(Message)) == 2


def test_model_preparation_error_does_not_create_generation_records(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session]
) -> None:
    runtime.provider.custom_configuration.provider = None
    with pytest.raises(ProviderTokenNotInitError):
        runtime.generate()
    assert len(runtime.closed_sessions) == 2
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Message)) == 1
        assert session.scalar(select(func.count()).select_from(Conversation)) == 1


def _attach_file(
    runtime: _Runtime,
    session_factory: sessionmaker[Session],
    *,
    transfer_method: FileTransferMethod,
    number_limits: int,
) -> tuple[str, str | None]:
    with session_factory.begin() as session:
        config = session.get(AppModelConfig, runtime.historical_config_id)
        assert config is not None
        config.file_upload = json.dumps(
            {
                "enabled": True,
                "allowed_file_types": ["image"],
                "allowed_file_upload_methods": ["local_file", "remote_url", "tool_file"],
                "number_limits": number_limits,
                "image": {"detail": "high"},
            }
        )
        file_id: str | None = None
        url: str | None = "https://example.com/image.png"
        if transfer_method == FileTransferMethod.LOCAL_FILE:
            uploaded = UploadFile(
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
            session.add(uploaded)
            file_id = uploaded.id
            url = None
        elif transfer_method == FileTransferMethod.TOOL_FILE:
            tool_file = ToolFile(
                user_id=runtime.end_user_id,
                tenant_id=runtime.tenant_id,
                conversation_id=None,
                file_key="tools/image.png",
                mimetype="image/png",
                original_url="https://example.com/image.png",
                name="tool-image.png",
                size=123,
            )
            session.add(tool_file)
            session.flush()
            file_id = tool_file.id
            url = f"https://example.com/tools/{tool_file.id}.png"
        message_file = MessageFile(
            message_id=runtime.message_id,
            type=FileType.IMAGE,
            transfer_method=transfer_method,
            url=url,
            upload_file_id=file_id if transfer_method == FileTransferMethod.LOCAL_FILE else None,
            created_by_role=CreatorUserRole.END_USER,
            created_by=runtime.end_user_id,
            belongs_to=MessageFileBelongsTo.USER,
        )
        session.add(message_file)
        return message_file.id, file_id


@pytest.mark.parametrize("transfer_method", [FileTransferMethod.LOCAL_FILE, FileTransferMethod.TOOL_FILE])
def test_real_runtime_rebuilds_owned_file_references_without_rewriting_history(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], transfer_method: FileTransferMethod
) -> None:
    message_file_id, file_id = _attach_file(
        runtime, sqlite_session_factory, transfer_method=transfer_method, number_limits=2
    )
    response = runtime.generate()
    assert isinstance(response, Mapping)
    with sqlite_session_factory() as session:
        original = session.get(MessageFile, message_file_id)
        regenerated = session.scalar(select(MessageFile).where(MessageFile.message_id == response["message_id"]))
        assert original is not None
        assert regenerated is not None
        assert regenerated.upload_file_id == file_id
        assert regenerated.transfer_method == transfer_method
        assert regenerated.created_by == runtime.end_user_id
        if transfer_method == FileTransferMethod.TOOL_FILE:
            assert original.upload_file_id is None


def test_remote_file_metadata_is_fetched_only_after_source_sessions_close(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    _attach_file(runtime, sqlite_session_factory, transfer_method=FileTransferMethod.REMOTE_URL, number_limits=2)
    requests: list[tuple[str, str]] = []

    def request(method: str, url: str, **_kwargs: object) -> Response:
        assert method in {"HEAD", "GET"}
        assert len(runtime.closed_sessions) == (2 if method == "HEAD" else 3)
        assert all(not session.in_transaction() for session in runtime.closed_sessions)
        scope = get_current_file_access_scope()
        assert scope is not None
        assert scope.tenant_id == runtime.tenant_id
        assert scope.user_id == runtime.end_user_id
        requests.append((method, url))
        return Response(
            200,
            request=Request(method, url),
            headers={"Content-Type": "image/png", "Content-Length": "123"},
            content=b"test image content",
        )

    monkeypatch.setattr(remote_fetcher, "make_request", request)
    response = runtime.generate()
    assert isinstance(response, Mapping)
    assert response["answer"] == "New answer"
    assert requests.count(("HEAD", "https://example.com/image.png")) == 1
    assert ("GET", "https://example.com/image.png") in requests


@pytest.mark.parametrize("foreign_scope", ["tenant", "end_user"])
def test_file_restoration_rejects_foreign_uploads_before_model_resolution(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], foreign_scope: str
) -> None:
    _, file_id = _attach_file(
        runtime, sqlite_session_factory, transfer_method=FileTransferMethod.LOCAL_FILE, number_limits=2
    )
    with sqlite_session_factory.begin() as session:
        file = session.get(UploadFile, file_id)
        assert file is not None
        if foreign_scope == "tenant":
            file.tenant_id = str(uuid4())
        else:
            file.created_by = str(uuid4())
    with pytest.raises(ValueError, match="Invalid upload file"):
        runtime.generate()
    assert runtime.model_parameters == []
    assert len(runtime.closed_sessions) == 2


def test_attachment_count_limit_is_preserved(runtime: _Runtime, sqlite_session_factory: sessionmaker[Session]) -> None:
    for _ in range(2):
        _attach_file(runtime, sqlite_session_factory, transfer_method=FileTransferMethod.LOCAL_FILE, number_limits=1)
    with pytest.raises(ValueError, match="Number of image files exceeds"):
        runtime.generate()
    assert runtime.model_parameters == []
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Message)) == 1


def test_stored_input_files_use_the_admitted_tenant_instead_of_embedded_tenant(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _, file_id = _attach_file(
        runtime, sqlite_session_factory, transfer_method=FileTransferMethod.LOCAL_FILE, number_limits=2
    )
    with sqlite_session_factory.begin() as session:
        message = session.get(Message, runtime.message_id)
        assert message is not None
        message.inputs = {
            "file": {
                "dify_model_identity": FILE_MODEL_IDENTITY,
                "type": "image",
                "transfer_method": "local_file",
                "related_id": file_id,
                "tenant_id": str(uuid4()),
                "filename": "untrusted-name.png",
            }
        }
    response = runtime.generate()
    assert isinstance(response, Mapping)
    with sqlite_session_factory() as session:
        regenerated = session.get(Message, response["message_id"])
        assert regenerated is not None
        assert regenerated._inputs["file"]["filename"] == "image.png"
        assert resolve_file_record_id(regenerated._inputs["file"]["reference"]) == file_id


def test_preparation_commits_cannot_flush_the_callers_pending_session(
    runtime: _Runtime, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    resolve = ProviderManager.get_configurations

    def committing_lookup(manager: ProviderManager, tenant_id: str) -> ProviderConfigurations:
        result = resolve(manager, tenant_id)
        db.session.commit()
        return result

    monkeypatch.setattr(ProviderManager, "get_configurations", committing_lookup)
    with runtime.app.test_request_context("/caller"):
        pending = Account(name="Uncommitted", email="pending@example.com")
        db.session.add(pending)
        runtime.generate()
        assert pending in db.session.new
        with sqlite_session_factory() as session:
            assert session.scalar(select(Account).where(Account.email == "pending@example.com")) is None
        db.session.rollback()


@pytest.mark.parametrize("termination", ["exhaust", "partial", "error"])
def test_event_stream_encodes_events_and_closes_its_source(termination: str) -> None:
    closed: list[bool] = []

    def source() -> Generator[Mapping[str, object] | str, None, None]:
        try:
            yield {"event": "message", "answer": "hello"}
            yield "ping"
            if termination == "error":
                raise RuntimeError("provider stream failed")
        finally:
            closed.append(True)

    stream = _MoreLikeThisEventStream(source())
    assert next(stream) == 'data: {"event":"message","answer":"hello"}\n\n'
    if termination == "partial":
        stream.close()
    else:
        assert next(stream) == "event: ping\n\n"
        with pytest.raises(RuntimeError if termination == "error" else StopIteration):
            next(stream)
    stream.close()
    assert closed == [True]
