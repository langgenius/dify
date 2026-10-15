"""Shared service ownership, configuration selection, and session lifecycle."""

import json
from base64 import b64decode
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import FileAccessScope, bind_file_access_scope
from core.memory.token_buffer_memory import PreparedHistory
from extensions.ext_database import db
from extensions.ext_storage import storage
from extensions.storage.opendal_storage import OpenDALStorage
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from libs.datetime_utils import naive_utc_now
from models import Account, App, AppMode, Conversation, Message
from models.agent import (
    Agent,
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentConfigVersionKind,
    AgentDebugConversation,
    AgentScope,
    AgentSource,
    AgentWorkspaceBinding,
)
from models.agent_config_entities import AgentSoulConfig
from models.enums import ConversationFromSource, CreatorUserRole, EndUserType
from models.model import AppModelConfig, EndUser, MessageFile, UploadFile
from models.workflow import Workflow, WorkflowType
from repositories.message_repository import MessageRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import MessageAccount, MessageActor, MessageEndUser
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import (
    MessageActorNotFoundError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_suggested_questions_generator import SuggestedQuestionsGenerator
from services.message_suggested_questions_queries import SuggestedQuestionsQuery
from services.message_suggested_questions_service import (
    MessageSuggestedQuestionsService,
    SuggestedQuestionsContext,
    SuggestedQuestionsInvokeFrom,
)
from tests.unit_tests.core.model_fixtures import make_model_instance


@dataclass(frozen=True)
class _Harness:
    flask_app: Flask
    target: App
    account: Account
    end_user: EndUser
    conversation: Conversation
    message: Message
    factory: sessionmaker[Session]
    queries: SuggestedQuestionsQuery
    service: MessageSuggestedQuestionsService[PreparedHistory]
    read_sessions: list[Session]
    scoped_sessions: list[Session]

    def actor(self, invoke_from: SuggestedQuestionsInvokeFrom) -> MessageActor:
        if invoke_from in {"explore", "debugger"}:
            with self.factory.begin() as session:
                for model, record_id in ((Message, self.message.id), (Conversation, self.conversation.id)):
                    session.execute(
                        update(model)
                        .where(model.id == record_id)
                        .values(
                            from_source=ConversationFromSource.CONSOLE,
                            from_account_id=self.account.id,
                            from_end_user_id=None,
                        )
                    )
            return MessageAccount(account_id=self.account.id)
        return MessageEndUser(end_user_id=self.end_user.id)

    def get(self, actor: MessageActor, *, invoke_from: SuggestedQuestionsInvokeFrom) -> list[str]:
        return self.service.get_suggested_questions(
            app_id=self.target.id,
            app_owner_tenant_id=self.target.tenant_id,
            expected_app_mode=self.target.mode,
            actor=actor,
            invoke_from=invoke_from,
            message_id=self.message.id,
        )

    def prepare(self, actor: MessageActor, *, invoke_from: SuggestedQuestionsInvokeFrom) -> SuggestedQuestionsContext:
        context = self.queries.prepare(
            app_id=self.target.id,
            app_owner_tenant_id=self.target.tenant_id,
            expected_app_mode=self.target.mode,
            actor=actor,
            invoke_from=invoke_from,
            message_id=self.message.id,
        )
        assert context is not None
        return context

    def set_mode(self, mode: AppMode) -> None:
        with self.factory.begin() as session:
            session.execute(update(App).where(App.id == self.target.id).values(mode=mode))
            session.execute(update(Conversation).where(Conversation.id == self.conversation.id).values(mode=mode))
        self.target.mode = mode

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.read_sessions + self.scoped_sessions
        )


@pytest.fixture
def harness(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    target = App(
        id=str(uuid4()), tenant_id=str(uuid4()), name="Shared", mode=AppMode.CHAT, enable_site=True, enable_api=True
    )
    account = Account(name="Debugger", email="debugger@example.com")
    end_user = EndUser(
        tenant_id=target.tenant_id, app_id=target.id, type=EndUserType.SERVICE_API, session_id=str(uuid4())
    )
    config = AppModelConfig(
        app_id=target.id, suggested_questions_after_answer='{"enabled":true,"prompt":"Published questions"}'
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([target, account, end_user, config])
        session.flush()
        target.app_model_config_id = config.id
        conversation = Conversation(
            app_id=target.id,
            app_model_config_id=config.id,
            mode=AppMode.CHAT,
            name="End-user conversation",
            inputs={},
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=target.id,
            conversation_id=conversation.id,
            inputs={},
            query="How does this work?",
            message={},
            message_unit_price=Decimal(0),
            answer="Like this.",
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.API,
            from_end_user_id=end_user.id,
        )
        session.add(message)

    read_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    read_sessions: list[Session] = []

    @event.listens_for(read_factory, "after_begin")
    def track_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        read_sessions.append(session)

    flask_app = Flask(__name__)
    flask_app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(flask_app)
    scoped_sessions: list[Session] = []

    def track_scoped(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        scoped_sessions.append(session)

    event.listen(db.session.session_factory, "after_begin", track_scoped)
    queries = SuggestedQuestionsQuery(
        session_factory=read_factory,
        repository=MessageRepository(
            session_factory=read_factory,
        ),
    )
    with flask_app.app_context():
        yield _Harness(
            flask_app,
            target,
            account,
            end_user,
            conversation,
            message,
            sqlite_session_factory,
            queries,
            MessageSuggestedQuestionsService(queries=queries, generator=SuggestedQuestionsGenerator()),
            read_sessions,
            scoped_sessions,
        )
    event.remove(db.session.session_factory, "after_begin", track_scoped)
    with flask_app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("change", ["app_id", "tenant", "mode", "account"])
def test_service_rejects_stale_reference_before_model_queries(
    harness: _Harness, change: Literal["app_id", "tenant", "mode", "account"]
) -> None:
    account_id = str(uuid4()) if change == "account" else harness.account.id
    app_id = str(uuid4()) if change == "app_id" else harness.target.id
    error_type = MessageActorNotFoundError if change == "account" else AppDefinitionUnavailableError
    with pytest.raises(error_type, match=account_id if change == "account" else app_id):
        harness.service.get_suggested_questions(
            app_id=app_id,
            app_owner_tenant_id=str(uuid4()) if change == "tenant" else harness.target.tenant_id,
            expected_app_mode=AppMode.ADVANCED_CHAT if change == "mode" else harness.target.mode,
            actor=MessageAccount(account_id=account_id),
            invoke_from="explore",
            message_id=harness.message.id,
        )
    assert len(harness.read_sessions) == 1
    assert not harness.scoped_sessions
    harness.assert_closed()


@pytest.mark.parametrize("change", ["missing", "tenant", "app"])
def test_end_user_reload_requires_the_admitted_app_owner(
    harness: _Harness, change: Literal["missing", "tenant", "app"]
) -> None:
    end_user_id = str(uuid4()) if change == "missing" else harness.end_user.id
    if change != "missing":
        values = {"tenant_id" if change == "tenant" else "app_id": str(uuid4())}
        with harness.factory.begin() as session:
            session.execute(update(EndUser).where(EndUser.id == end_user_id).values(values))
    with pytest.raises(MessageActorNotFoundError, match=end_user_id):
        harness.get(MessageEndUser(end_user_id=end_user_id), invoke_from="service-api")
    assert not harness.scoped_sessions
    harness.assert_closed()


@pytest.mark.parametrize("invoke_from", ["debugger", "explore", "web-app", "service-api"])
def test_queries_return_detached_configuration_and_history_without_changing_caller_session(
    harness: _Harness, invoke_from: SuggestedQuestionsInvokeFrom, config_overrides: Callable[..., None]
) -> None:
    # Exercise the production path for deployments with plugin token counting disabled.
    config_overrides(PLUGIN_BASED_TOKEN_COUNTING_ENABLED=False)
    actor = harness.actor(invoke_from)
    feature = {
        "enabled": True,
        "prompt": "Published questions",
        "model": {"provider": "vendor", "name": "question-model"},
    }
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(suggested_questions_after_answer=json.dumps(feature))
        )
    with harness.flask_app.app_context():
        caller_session = db.session()
        caller_app = caller_session.get(App, harness.target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        harness.scoped_sessions.clear()

        context = harness.prepare(actor, invoke_from=invoke_from)
        assert context.app_id == harness.target.id
        assert context.tenant_id == harness.target.tenant_id
        assert context.app_mode == AppMode.CHAT
        assert context.message_id == harness.message.id
        assert context.conversation_id == harness.conversation.id
        assert context.actor == actor
        assert context.invoke_from == invoke_from
        assert context.config == feature
        assert len(harness.read_sessions) == 1
        harness.assert_closed()

        history = harness.queries.load_history(context)
        assert [(prompt.text, prompt.is_user_message) for prompt in history.prompts] == [
            ("How does this work?", True),
            ("Like this.", False),
        ]
        assert all(not prompt.files for prompt in history.prompts)
        assert all(prompt.tenant_id == harness.target.tenant_id for prompt in history.prompts)
        assert len(harness.read_sessions) == 2
        assert harness.read_sessions[0] is not harness.read_sessions[1]
        harness.assert_closed()
        model = make_model_instance(provider="langgenius/openai/openai", model="history-model")
        assert history.get_prompt_text(model_instance=model, max_token_limit=3000) == (
            "Human: How does this work?\nAssistant: Like this."
        )
        harness.assert_closed()

        assert db.session() is caller_session
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        assert not harness.scoped_sessions

    # The query did not commit the caller's pending edit, and the returned
    # configuration and history no longer depend on the persisted rows.
    with harness.factory.begin() as session:
        persisted_app = session.get(App, harness.target.id)
        assert persisted_app is not None
        assert persisted_app.name == "Shared"
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(suggested_questions_after_answer='{"enabled":false}')
        )
        session.execute(update(Message).where(Message.id == harness.message.id).values(answer="Changed answer"))
    assert context.config == feature
    assert history.prompts[-1].text == "Like this."


@pytest.mark.parametrize("invoke_from", ["explore", "service-api"])
@pytest.mark.parametrize("entity", ["message", "conversation"])
@pytest.mark.parametrize("change", ["id", "app_id", "from_account_id", "from_end_user_id", "from_source"])
def test_message_and_conversation_ownership_are_enforced(
    harness: _Harness,
    invoke_from: Literal["explore", "service-api"],
    entity: Literal["message", "conversation"],
    change: Literal["id", "app_id", "from_account_id", "from_end_user_id", "from_source"],
) -> None:
    actor = harness.actor(invoke_from)
    model = Message if entity == "message" else Conversation
    record_id = harness.message.id if entity == "message" else harness.conversation.id
    if change == "from_source":
        value = ConversationFromSource.API if invoke_from == "explore" else ConversationFromSource.CONSOLE
    else:
        value = str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(model).where(model.id == record_id).values({change: value}))
    error_type = MessageNotExistsError if entity == "message" else ConversationNotExistsError
    with harness.flask_app.app_context(), pytest.raises(error_type):
        harness.get(actor, invoke_from=invoke_from)
    harness.assert_closed()


@pytest.mark.parametrize("invoke_from", ["explore", "web-app"])
def test_actor_cannot_read_a_deleted_conversation(
    harness: _Harness, invoke_from: Literal["explore", "web-app"]
) -> None:
    actor = harness.actor(invoke_from)
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(is_deleted=True))
    with harness.flask_app.app_context(), pytest.raises(ConversationNotExistsError):
        harness.get(actor, invoke_from=invoke_from)
    harness.assert_closed()


@pytest.mark.parametrize("invoke_from", ["explore", "service-api"])
@pytest.mark.parametrize(
    "change", ["tenant", "mode", "app_id", "from_account_id", "from_end_user_id", "from_source", "deleted"]
)
def test_history_revalidates_app_and_conversation_after_preparing_context(
    harness: _Harness,
    invoke_from: Literal["explore", "service-api"],
    change: Literal["tenant", "mode", "app_id", "from_account_id", "from_end_user_id", "from_source", "deleted"],
) -> None:
    context = harness.queries.prepare(
        app_id=harness.target.id,
        app_owner_tenant_id=harness.target.tenant_id,
        expected_app_mode=harness.target.mode,
        actor=harness.actor(invoke_from),
        invoke_from=invoke_from,
        message_id=harness.message.id,
    )
    assert context is not None
    harness.assert_closed()

    with harness.factory.begin() as session:
        if change in {"tenant", "mode"}:
            values = {"tenant_id": str(uuid4())} if change == "tenant" else {"mode": AppMode.ADVANCED_CHAT}
            session.execute(update(App).where(App.id == harness.target.id).values(values))
        else:
            conversation_values: dict[str, object]
            if change == "deleted":
                conversation_values = {"is_deleted": True}
            elif change == "from_source":
                conversation_values = {
                    "from_source": ConversationFromSource.API
                    if invoke_from == "explore"
                    else ConversationFromSource.CONSOLE
                }
            else:
                conversation_values = {change: str(uuid4())}
            session.execute(
                update(Conversation).where(Conversation.id == harness.conversation.id).values(conversation_values)
            )

    error_type = AppDefinitionUnavailableError if change in {"tenant", "mode"} else ConversationNotExistsError
    with pytest.raises(error_type):
        harness.queries.load_history(context)
    assert len(harness.read_sessions) == 2
    harness.assert_closed()


@pytest.mark.parametrize("case", ["disabled", "missing_workflow"])
def test_account_preserves_disabled_feature_and_missing_workflow_behavior(
    harness: _Harness, case: Literal["disabled", "missing_workflow"]
) -> None:
    actor = harness.actor("explore")
    with harness.factory.begin() as session:
        if case == "disabled":
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.target.app_model_config_id)
                .values(suggested_questions_after_answer='{"enabled":false}')
            )
        else:
            session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.ADVANCED_CHAT))
            harness.target.mode = AppMode.ADVANCED_CHAT
    if case == "disabled":
        with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
            harness.get(actor, invoke_from="explore")
    else:
        assert harness.get(actor, invoke_from="explore") == []
    # Both branches finish before model resolution and the separate history query.
    assert not harness.scoped_sessions
    assert len(harness.read_sessions) == 1
    harness.assert_closed()


@pytest.mark.parametrize("invoke_from", ["debugger", "explore"])
def test_advanced_chat_debugger_uses_draft_while_explore_uses_published_workflow(
    harness: _Harness, invoke_from: Literal["debugger", "explore"]
) -> None:
    actor = harness.actor(invoke_from)
    with harness.factory.begin() as session:
        for version, prompt in ((Workflow.VERSION_DRAFT, "Draft questions"), ("published", "Published questions")):
            workflow = Workflow(
                tenant_id=harness.target.tenant_id,
                app_id=harness.target.id,
                type=WorkflowType.CHAT,
                version=version,
                graph='{"nodes":[],"edges":[]}',
                features=json.dumps({"suggested_questions_after_answer": {"enabled": True, "prompt": prompt}}),
                created_by=harness.account.id,
            )
            session.add(workflow)
            session.flush()
            if version != Workflow.VERSION_DRAFT:
                session.execute(update(App).where(App.id == harness.target.id).values({App.workflow_id: workflow.id}))
        session.execute(update(App).where(App.id == harness.target.id).values(mode=AppMode.ADVANCED_CHAT))
        session.execute(
            update(Conversation).where(Conversation.id == harness.conversation.id).values(mode=AppMode.ADVANCED_CHAT)
        )
    harness.target.mode = AppMode.ADVANCED_CHAT
    context = harness.prepare(actor, invoke_from=invoke_from)
    expected_prompt = "Draft questions" if invoke_from == "debugger" else "Published questions"
    assert context.config == {"enabled": True, "prompt": expected_prompt}
    assert context.app_mode == AppMode.ADVANCED_CHAT
    harness.assert_closed()


def test_history_detaches_remote_attachment_references_before_rendering(harness: _Harness) -> None:
    actor = harness.actor("explore")
    attachment = MessageFile(
        message_id=harness.message.id,
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.REMOTE_URL,
        url="https://example.com/history.png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=harness.account.id,
    )
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(
                file_upload=json.dumps(
                    {"enabled": True, "allowed_file_types": ["image"], "allowed_file_upload_methods": ["remote_url"]}
                )
            )
        )
        session.add(attachment)
    context = harness.prepare(actor, invoke_from="explore")
    history = harness.queries.load_history(context)
    harness.assert_closed()
    assert len(harness.read_sessions) == 2
    user_prompt, assistant_prompt = history.prompts
    assert user_prompt.text == "How does this work?"
    assert user_prompt.tenant_id == harness.target.tenant_id
    assert len(user_prompt.files) == 1
    reference = user_prompt.files[0]
    assert reference.id == attachment.id
    assert reference.type == FileType.IMAGE
    assert reference.transfer_method == FileTransferMethod.REMOTE_URL
    assert reference.url == attachment.url
    assert reference.upload_file_id is None
    assert not assistant_prompt.files


@pytest.mark.parametrize("case", ["missing-record", "other-owner", "missing-content", "available"])
def test_attachment_restoration_closes_sessions_for_real_file_failures(
    harness: _Harness,
    case: Literal["missing-record", "other-owner", "missing-content", "available"],
    config_overrides: Callable[..., None],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    config_overrides(PLUGIN_BASED_TOKEN_COUNTING_ENABLED=False, MULTIMODAL_SEND_FORMAT="base64")
    local_storage = OpenDALStorage(scheme="fs", root=str(tmp_path))
    # Bind an actual filesystem backend; file building, authorization and reads
    # all keep their production implementations.
    monkeypatch.setattr(storage, "storage_runner", local_storage, raising=False)
    image = b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+xU5sAAAAASUVORK5CYII=")
    upload = UploadFile(
        tenant_id=harness.target.tenant_id,
        storage_type=StorageType.LOCAL,
        key="history/image.png",
        name="image.png",
        size=len(image),
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.END_USER,
        created_by=str(uuid4()) if case == "other-owner" else harness.end_user.id,
        created_at=naive_utc_now(),
        used=True,
    )
    if case != "missing-content":
        local_storage.save(upload.key, image)
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(
                file_upload=json.dumps(
                    {"enabled": True, "allowed_file_types": ["image"], "allowed_file_upload_methods": ["local_file"]}
                )
            )
        )
        if case != "missing-record":
            session.add(upload)
        session.add(
            MessageFile(
                message_id=harness.message.id,
                type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                upload_file_id=upload.id,
                created_by_role=CreatorUserRole.END_USER,
                created_by=harness.end_user.id,
            )
        )
    context = harness.prepare(harness.actor("web-app"), invoke_from="web-app")
    history = harness.queries.load_history(context)
    assert len(harness.read_sessions) == 2
    harness.assert_closed()
    model = make_model_instance(provider="langgenius/openai/openai", model="history-model")
    file_sessions: list[Session] = []

    def track_file_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        harness.assert_closed()
        file_sessions.append(session)

    scope = FileAccessScope(
        tenant_id=harness.target.tenant_id,
        user_id=harness.end_user.id,
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
    )
    event.listen(harness.factory, "after_begin", track_file_read)
    try:
        with bind_file_access_scope(scope):
            if case == "available":
                assert history.get_prompt_text(model_instance=model, max_token_limit=3000) == (
                    "Human: [image]\nHow does this work?\nAssistant: Like this."
                )
            else:
                error = FileNotFoundError if case == "missing-content" else ValueError
                detail = "File not found" if case == "missing-content" else "Invalid upload file"
                with pytest.raises(error, match=detail):
                    history.get_prompt_text(model_instance=model, max_token_limit=3000)
    finally:
        event.remove(harness.factory, "after_begin", track_file_read)
    assert len(file_sessions) == (2 if case in {"missing-content", "available"} else 1)
    assert all(not session.in_transaction() and not session.identity_map for session in file_sessions)
    assert not harness.scoped_sessions
    harness.assert_closed()


def test_configuration_error_closes_query_session_and_preserves_caller_transaction(harness: _Harness) -> None:
    actor = harness.actor("explore")
    with harness.factory.begin() as session:
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(suggested_questions_after_answer="{")
        )
    with harness.flask_app.app_context():
        caller_session = db.session()
        caller_app = caller_session.get(App, harness.target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        harness.scoped_sessions.clear()
        with pytest.raises(json.JSONDecodeError):
            harness.get(actor, invoke_from="explore")
        assert len(harness.read_sessions) == 1
        harness.assert_closed()
        assert db.session() is caller_session
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        assert not harness.scoped_sessions
    with harness.factory() as session:
        persisted_app = session.get(App, harness.target.id)
        assert persisted_app is not None
        assert persisted_app.name == "Shared"


def _agent_soul(prompt: str, *, enabled: bool = True, model: dict[str, object] | None = None) -> AgentSoulConfig:
    feature: dict[str, object] = {"enabled": enabled, "prompt": prompt}
    if model is not None:
        feature["model"] = model
    return AgentSoulConfig.model_validate({"app_features": {"suggested_questions_after_answer": feature}})


def _published_agent(harness: _Harness, *, enabled: bool = True) -> Agent:
    agent = Agent(
        tenant_id=harness.target.tenant_id,
        app_id=harness.target.id,
        name="Published agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.AGENT_APP,
    )
    with harness.factory.begin() as session:
        session.add(agent)
        session.flush()
        snapshot = AgentConfigSnapshot(
            tenant_id=agent.tenant_id,
            agent_id=agent.id,
            version=1,
            config_snapshot=_agent_soul("Current agent questions", enabled=enabled),
        )
        session.add(snapshot)
        session.flush()
        agent.active_config_snapshot_id = snapshot.id
    return agent


@pytest.mark.parametrize("draft_type", [AgentConfigDraftType.DRAFT, AgentConfigDraftType.DEBUG_BUILD])
def test_agent_debugger_uses_matching_draft_with_custom_model(
    harness: _Harness, draft_type: AgentConfigDraftType
) -> None:
    harness.set_mode(AppMode.AGENT)
    actor = harness.actor("debugger")
    agent = _published_agent(harness)
    model: dict[str, object] = {"provider": "vendor", "name": "draft-model", "completion_params": {"temperature": 0.1}}
    with harness.factory.begin() as session:
        session.add_all(
            [
                AgentConfigDraft(
                    tenant_id=harness.target.tenant_id,
                    agent_id=agent.id,
                    draft_type=draft_type,
                    account_id=harness.account.id if draft_type == AgentConfigDraftType.DEBUG_BUILD else None,
                    draft_owner_key=harness.account.id if draft_type == AgentConfigDraftType.DEBUG_BUILD else "",
                    config_snapshot=_agent_soul("Matching draft questions", model=model),
                ),
                AgentDebugConversation(
                    tenant_id=harness.target.tenant_id,
                    agent_id=agent.id,
                    app_id=harness.target.id,
                    account_id=harness.account.id,
                    draft_type=draft_type,
                    conversation_id=harness.conversation.id,
                ),
            ]
        )
        session.execute(
            update(AppModelConfig)
            .where(AppModelConfig.id == harness.target.app_model_config_id)
            .values(suggested_questions_after_answer='{"enabled":false}')
        )
    context = harness.prepare(actor, invoke_from="debugger")
    assert context.config == {"enabled": True, "prompt": "Matching draft questions", "model": model}
    harness.assert_closed()


@pytest.mark.parametrize("version_kind", [AgentConfigVersionKind.SNAPSHOT, AgentConfigVersionKind.DRAFT])
def test_agent_conversation_uses_bound_config_before_current_published_config(
    harness: _Harness, version_kind: AgentConfigVersionKind
) -> None:
    harness.set_mode(AppMode.AGENT)
    agent = _published_agent(harness)
    with harness.factory.begin() as session:
        config: AgentConfigSnapshot | AgentConfigDraft
        if version_kind == AgentConfigVersionKind.SNAPSHOT:
            config = AgentConfigSnapshot(
                tenant_id=harness.target.tenant_id,
                agent_id=agent.id,
                version=2,
                config_snapshot=_agent_soul("Bound agent questions"),
            )
        else:
            config = AgentConfigDraft(
                tenant_id=harness.target.tenant_id,
                agent_id=agent.id,
                draft_type=AgentConfigDraftType.DRAFT,
                config_snapshot=_agent_soul("Bound agent questions"),
            )
        session.add(config)
        session.flush()
        binding = AgentWorkspaceBinding(
            tenant_id=harness.target.tenant_id,
            app_id=harness.target.id,
            workspace_id=str(uuid4()),
            agent_id=agent.id,
            agent_config_version_id=config.id,
            agent_config_version_kind=version_kind,
            backend_binding_ref="bound-agent",
        )
        session.add(binding)
        session.flush()
        session.execute(
            update(Conversation)
            .where(Conversation.id == harness.conversation.id)
            .values(agent_workspace_binding_id=binding.id)
        )
    context = harness.prepare(harness.actor("service-api"), invoke_from="service-api")
    assert context.config == {"enabled": True, "prompt": "Bound agent questions"}
    harness.assert_closed()


@pytest.mark.parametrize("case", ["published", "legacy", "disabled"])
def test_agent_published_config_and_legacy_fallback(
    harness: _Harness, case: Literal["published", "legacy", "disabled"]
) -> None:
    harness.set_mode(AppMode.AGENT)
    if case != "legacy":
        _published_agent(harness, enabled=case != "disabled")
    actor = harness.actor("service-api")
    if case == "disabled":
        with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
            harness.get(actor, invoke_from="service-api")
    else:
        context = harness.prepare(actor, invoke_from="service-api")
        expected_prompt = "Published questions" if case == "legacy" else "Current agent questions"
        assert context.config == {"enabled": True, "prompt": expected_prompt}
    harness.assert_closed()


@pytest.mark.parametrize("use_override", [False, True])
def test_chat_uses_conversation_config_and_custom_completion_parameters(harness: _Harness, use_override: bool) -> None:
    feature = {
        "enabled": True,
        "prompt": "Conversation questions",
        "model": {"provider": "vendor", "name": "conversation-model", "completion_params": {"temperature": 0.2}},
    }
    with harness.factory.begin() as session:
        if use_override:
            override = {
                "model": {"provider": "vendor", "name": "chat-model", "mode": "chat"},
                "suggested_questions_after_answer": feature,
            }
            session.execute(
                update(Conversation)
                .where(Conversation.id == harness.conversation.id)
                .values({Conversation.override_model_configs: json.dumps(override)})
            )
        else:
            session.execute(
                update(AppModelConfig)
                .where(AppModelConfig.id == harness.target.app_model_config_id)
                .values(suggested_questions_after_answer=json.dumps(feature))
            )
        current_config = AppModelConfig(app_id=harness.target.id, suggested_questions_after_answer='{"enabled":false}')
        session.add(current_config)
        session.flush()
        session.execute(
            update(App).where(App.id == harness.target.id).values({App.app_model_config_id: current_config.id})
        )
    context = harness.prepare(harness.actor("web-app"), invoke_from="web-app")
    assert context.config == feature
    harness.assert_closed()


@pytest.mark.parametrize(
    "file_upload",
    [
        None,
        {"image": None},
        {"image": {"enabled": False}},
        {"image": {"enabled": True, "number_limits": 3, "transfer_methods": ["remote_url"]}},
    ],
    ids=["null-upload", "null-image", "disabled-image", "legacy-image"],
)
def test_workflow_compatibility_normalization_does_not_dirty_or_write_rows(
    harness: _Harness, file_upload: dict[str, object] | None
) -> None:
    harness.set_mode(AppMode.ADVANCED_CHAT)
    actor = harness.actor("explore")
    features = json.dumps(
        {
            "suggested_questions_after_answer": {"enabled": True, "prompt": "Legacy workflow questions"},
            "file_upload": file_upload,
        }
    )
    with harness.factory.begin() as session:
        workflow = Workflow(
            tenant_id=harness.target.tenant_id,
            app_id=harness.target.id,
            type=WorkflowType.CHAT,
            version="published",
            graph='{"nodes":[],"edges":[]}',
            features=features,
            created_by=harness.account.id,
        )
        session.add(workflow)
        session.flush()
        session.execute(update(App).where(App.id == harness.target.id).values({App.workflow_id: workflow.id}))

    dirty_workflows: list[str] = []

    def record_changes(workflow: Workflow, _value: object, _old_value: object, _initiator: object) -> None:
        dirty_workflows.append(workflow.id)

    # Even a rolled-back assignment would leave a supposedly read-only query dirty.
    event.listen(Workflow._features, "set", record_changes)
    try:
        context = harness.prepare(actor, invoke_from="explore")
    finally:
        event.remove(Workflow._features, "set", record_changes)
    assert not dirty_workflows
    with harness.factory() as session:
        persisted = session.get(Workflow, workflow.id)
        assert persisted is not None
        assert persisted.serialized_features == features
    assert context.config == {"enabled": True, "prompt": "Legacy workflow questions"}
    harness.assert_closed()
