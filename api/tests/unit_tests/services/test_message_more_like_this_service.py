"""Exercise regeneration policy and ownership through the real SQLite repository."""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, event, func, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from extensions.ext_database import db
from graphon.file import FileTransferMethod, FileType
from models import Account, App, AppMode, AppModelConfig, Conversation, EndUser, Message, MessageFile
from models.enums import ConversationFromSource, CreatorUserRole, MessageFileBelongsTo
from models.provider import Provider
from repositories.message_repository import MessageRepository
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.app_definition_query_service import AppDefinitionUnavailableError
from services.entities.message_entities import MessageAccount, MessageActor, MessageEndUser
from services.errors.app import MoreLikeThisDisabledError
from services.errors.app_model_config import AppModelConfigBrokenError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageActorNotFoundError, MessageNotExistsError
from services.message_more_like_this_generator import MessageMoreLikeThisGenerator
from services.message_more_like_this_service import (
    MessageMoreLikeThisService,
    MoreLikeThisConfigNotFoundError,
    MoreLikeThisNotCompletionError,
    MoreLikeThisResponse,
    MoreLikeThisSource,
)


@dataclass
class _Harness:
    service: MessageMoreLikeThisService
    repository: MessageRepository
    app_id: str
    tenant_id: str
    actor: MessageActor
    message_id: str
    conversation_id: str
    current_config_id: str
    historical_config_id: str
    committed_sessions: list[Session]
    read_sessions: list[Session]
    scoped_sessions: list[Session]

    def assert_closed(self) -> None:
        assert all(
            not session.in_transaction() and not session.identity_map
            for session in self.read_sessions + self.scoped_sessions
        )

    def source(self) -> MoreLikeThisSource:
        return self.repository.get_more_like_this_source(
            app_id=self.app_id,
            app_owner_tenant_id=self.tenant_id,
            actor=self.actor,
            message_id=self.message_id,
        )

    def generate(self) -> MoreLikeThisResponse:
        return self.service.generate(
            app_id=self.app_id,
            app_owner_tenant_id=self.tenant_id,
            actor=self.actor,
            message_id=self.message_id,
            streaming=False,
        )


@pytest.fixture(params=["account", "end_user"])
def harness(
    request: pytest.FixtureRequest, sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session]
) -> Iterator[_Harness]:
    tenant_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=tenant_id, name="Completion", mode=AppMode.COMPLETION, enable_site=True, enable_api=True)
        account = Account(name="Viewer", email="viewer@example.com")
        session.add_all([app, account])
        session.flush()
        end_user = EndUser(tenant_id=tenant_id, app_id=app.id, type="browser", session_id=str(uuid4()))
        session.add(end_user)
        session.flush()
        current = AppModelConfig(
            app_id=app.id,
            more_like_this='{"enabled":true}',
            model='{"name":"current-model","completion_params":{"temperature":0.2}}',
        )
        historical = AppModelConfig(
            app_id=app.id,
            more_like_this='{"enabled":false}',
            model='{"provider":"langgenius/openai/openai","name":"historical-model","mode":"chat","completion_params":{"temperature":0.1,"top_p":0.8}}',
            pre_prompt="Historical prompt",
        )
        session.add_all(
            [current, historical, Provider(tenant_id=tenant_id, provider_name="invalid/provider", is_valid=True)]
        )
        app.app_model_config_id = current.id
        is_account = request.param == "account"
        actor: MessageActor = (
            MessageAccount(account_id=account.id) if is_account else MessageEndUser(end_user_id=end_user.id)
        )
        from_source = ConversationFromSource.CONSOLE if is_account else ConversationFromSource.API
        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=historical.id,
            mode=AppMode.COMPLETION,
            name="Earlier completion",
            inputs={},
            from_source=from_source,
            from_account_id=account.id if is_account else None,
            from_end_user_id=None if is_account else end_user.id,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=app.id,
            conversation_id=conversation.id,
            inputs={"count": 0, "empty": "", "items": [], "optional": None},
            query="Original query",
            message={},
            answer="Original answer",
            message_unit_price=0,
            answer_unit_price=0,
            currency="USD",
            from_source=from_source,
            from_account_id=account.id if is_account else None,
            from_end_user_id=None if is_account else end_user.id,
        )
        session.add(message)
        session.flush()

    read_sessions: list[Session] = []
    scoped_sessions: list[Session] = []
    committed_sessions: list[Session] = []
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    @event.listens_for(factory, "after_begin")
    def record_read(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        read_sessions.append(session)

    @event.listens_for(factory, "after_commit")
    def record_commit(session: Session) -> None:
        committed_sessions.append(session)

    flask_app = Flask(__name__)
    flask_app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(flask_app)

    def record_scoped(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        scoped_sessions.append(session)

    event.listen(db.session.session_factory, "after_begin", record_scoped)
    repository = MessageRepository(
        session_factory=factory, extra_contents=SQLAlchemyExecutionExtraContentRepository(session_maker=factory)
    )
    with flask_app.test_request_context("/more-like-this"):
        yield _Harness(
            service=MessageMoreLikeThisService(
                repository=repository, generator=MessageMoreLikeThisGenerator(session_factory=factory)
            ),
            repository=repository,
            app_id=app.id,
            tenant_id=tenant_id,
            actor=actor,
            message_id=message.id,
            conversation_id=conversation.id,
            current_config_id=current.id,
            historical_config_id=historical.id,
            committed_sessions=committed_sessions,
            read_sessions=read_sessions,
            scoped_sessions=scoped_sessions,
        )
    event.remove(db.session.session_factory, "after_begin", record_scoped)
    with flask_app.app_context():
        db.session.remove()
        db.engine.dispose()


def test_model_preparation_failure_preserves_historical_config_and_inputs(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    source = harness.source()
    assert source.query == "Original query"
    assert source.inputs == {"count": 0, "empty": "", "items": [], "optional": None}
    assert source.historical_model_config_id == harness.historical_config_id
    config = harness.repository.get_more_like_this_model_config(
        app_id=harness.app_id, app_owner_tenant_id=harness.tenant_id, model_config_id=harness.historical_config_id
    )
    assert config is not None
    assert config["pre_prompt"] == "Historical prompt"
    with pytest.raises(ValueError, match="Invalid plugin id invalid/provider"):
        harness.generate()
    with sqlite_session_factory() as session:
        historical = session.get(AppModelConfig, harness.historical_config_id)
        assert historical is not None
        assert historical.model is not None
        assert json.loads(historical.model)["completion_params"]["temperature"] == 0.1
        assert session.scalar(select(func.count()).select_from(Message)) == 1
        assert session.scalar(select(func.count()).select_from(Conversation)) == 1
    assert harness.committed_sessions == []
    harness.assert_closed()


def test_shared_repository_preserves_each_use_cases_deleted_conversation_policy(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = session.get(Conversation, harness.conversation_id)
        assert conversation is not None
        conversation.is_deleted = True

    with sqlite_session_factory() as session:
        with pytest.raises(ConversationNotExistsError):
            harness.repository.get_suggested_questions_context(
                session=session,
                app_id=harness.app_id,
                app_owner_tenant_id=harness.tenant_id,
                expected_app_mode=AppMode.COMPLETION,
                actor=harness.actor,
                message_id=harness.message_id,
            )
        assert session.in_transaction()

    assert harness.source().historical_model_config_id == harness.historical_config_id
    with pytest.raises(ValueError, match="Invalid plugin id invalid/provider"):
        harness.generate()
    harness.assert_closed()


@pytest.mark.parametrize("inaccessible", ["missing", "app", "source", "owner", "opposite_actor"])
def test_rejects_messages_outside_the_complete_actor_scope_before_feature_checks(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], inaccessible: str
) -> None:
    with sqlite_session_factory.begin() as session:
        current = session.get(AppModelConfig, harness.current_config_id)
        message = session.get(Message, harness.message_id)
        assert current is not None
        assert message is not None
        current.more_like_this = '{"enabled":false}'
        if inaccessible == "missing":
            harness.message_id = str(uuid4())
        elif inaccessible == "app":
            message.app_id = str(uuid4())
        elif inaccessible == "source":
            message.from_source = (
                ConversationFromSource.API
                if isinstance(harness.actor, MessageAccount)
                else ConversationFromSource.CONSOLE
            )
        elif inaccessible == "owner":
            if isinstance(harness.actor, MessageAccount):
                message.from_account_id = str(uuid4())
            else:
                message.from_end_user_id = str(uuid4())
        elif isinstance(harness.actor, MessageAccount):
            message.from_end_user_id = str(uuid4())
        else:
            message.from_account_id = str(uuid4())

    with pytest.raises(MessageNotExistsError):
        harness.generate()
    assert harness.scoped_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize("feature", [None, "", "{}", '{"enabled":false}'])
def test_disabled_current_feature_wins_over_malformed_historical_config(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], feature: str | None
) -> None:
    with sqlite_session_factory.begin() as session:
        current = session.get(AppModelConfig, harness.current_config_id)
        historical = session.get(AppModelConfig, harness.historical_config_id)
        assert current is not None
        assert historical is not None
        current.more_like_this = feature
        historical.model = "broken-json"

    with pytest.raises(MoreLikeThisDisabledError):
        harness.generate()
    assert len(harness.read_sessions) == 1
    assert harness.scoped_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize(
    ("current", "field", "value"),
    [
        (True, "more_like_this", '{"secret":"private-config-value"'),
        (True, "more_like_this", '["private-config-value"]'),
        (False, "model", '{"secret":"private-config-value"'),
        (False, "model", '["private-config-value"]'),
        (False, "model", '{"completion_params":["private-config-value"]}'),
        (False, "model", None),
    ],
    ids=["feature-json", "feature-shape", "model-json", "model-shape", "parameter-shape", "missing-model"],
)
def test_corrupt_persisted_configuration_has_context_without_echoing_values(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], current: bool, field: str, value: str | None
) -> None:
    """None represents a missing model payload in an existing configuration row."""
    config_id = harness.current_config_id if current else harness.historical_config_id
    with sqlite_session_factory.begin() as session:
        config = session.get(AppModelConfig, config_id)
        assert config is not None
        if field == "more_like_this":
            config.more_like_this = value
        else:
            config.model = value

    with pytest.raises(AppModelConfigBrokenError) as caught:
        harness.generate()

    description = str(caught.value)
    assert harness.app_id in description
    if current:
        assert harness.message_id in description
    else:
        assert harness.historical_config_id in description
    assert "private-config-value" not in description
    assert harness.scoped_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize("current_config", ["missing", "foreign"])
def test_missing_or_foreign_current_config_disables_feature(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], current_config: str
) -> None:
    with sqlite_session_factory.begin() as session:
        app = session.get(App, harness.app_id)
        current = session.get(AppModelConfig, harness.current_config_id)
        assert app is not None
        assert current is not None
        if current_config == "missing":
            app.app_model_config_id = None
        else:
            current.app_id = str(uuid4())
    with pytest.raises(MoreLikeThisDisabledError):
        harness.generate()
    assert harness.scoped_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize("enabled", [0, None, ""])
def test_keeps_legacy_enabled_flag_semantics(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], enabled: JsonValue
) -> None:
    with sqlite_session_factory.begin() as session:
        current = session.get(AppModelConfig, harness.current_config_id)
        assert current is not None
        current.more_like_this = json.dumps({"enabled": enabled})
    with pytest.raises(ValueError, match="Invalid plugin id invalid/provider"):
        harness.generate()
    assert len(harness.read_sessions) == 2
    harness.assert_closed()


@pytest.mark.parametrize("inaccessible", ["missing_app", "tenant", "mode", "actor"])
def test_rechecks_app_and_actor_before_loading_message(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], inaccessible: str
) -> None:
    expected_error: type[Exception] = AppDefinitionUnavailableError
    if inaccessible == "missing_app":
        harness.app_id = str(uuid4())
    elif inaccessible == "tenant":
        harness.tenant_id = str(uuid4())
    elif inaccessible == "mode":
        with sqlite_session_factory.begin() as session:
            app = session.get(App, harness.app_id)
            assert app is not None
            app.mode = AppMode.CHAT
        expected_error = MoreLikeThisNotCompletionError
    else:
        harness.actor = (
            MessageAccount(account_id=str(uuid4()))
            if isinstance(harness.actor, MessageAccount)
            else MessageEndUser(end_user_id=str(uuid4()))
        )
        expected_error = MessageActorNotFoundError
    with pytest.raises(expected_error):
        harness.generate()
    assert harness.scoped_sessions == []
    harness.assert_closed()


@pytest.mark.parametrize(
    "inaccessible", ["missing", "app", "source", "owner", "opposite_actor", "config", "null_config", "deleted_config"]
)
def test_rejects_historical_config_outside_the_message_owner_chain(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], inaccessible: str
) -> None:
    with sqlite_session_factory.begin() as session:
        conversation = session.get(Conversation, harness.conversation_id)
        assert conversation is not None
        if inaccessible == "missing":
            message = session.get(Message, harness.message_id)
            assert message is not None
            message.conversation_id = str(uuid4())
        elif inaccessible == "app":
            conversation.app_id = str(uuid4())
        elif inaccessible == "source":
            conversation.from_source = (
                ConversationFromSource.API
                if isinstance(harness.actor, MessageAccount)
                else ConversationFromSource.CONSOLE
            )
        elif inaccessible == "owner":
            if isinstance(harness.actor, MessageAccount):
                conversation.from_account_id = str(uuid4())
            else:
                conversation.from_end_user_id = str(uuid4())
        elif inaccessible == "opposite_actor":
            if isinstance(harness.actor, MessageAccount):
                conversation.from_end_user_id = str(uuid4())
            else:
                conversation.from_account_id = str(uuid4())
        elif inaccessible == "null_config":
            conversation.app_model_config_id = None
        elif inaccessible == "deleted_config":
            conversation.app_model_config_id = str(uuid4())
        else:
            historical = session.get(AppModelConfig, harness.historical_config_id)
            assert historical is not None
            historical.app_id = str(uuid4())

    with pytest.raises(MoreLikeThisConfigNotFoundError):
        harness.generate()
    assert harness.scoped_sessions == []
    harness.assert_closed()


def test_reads_file_references_without_restoring_or_rewriting_them(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        tool_file = MessageFile(
            message_id=harness.message_id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            url="https://example.com/files/tools/legacy-id.png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=str(uuid4()),
            belongs_to=MessageFileBelongsTo.ASSISTANT,
        )
        session.add(tool_file)
    source = harness.source()
    assert len(source.files) == 1
    assert source.files[0].url == "https://example.com/files/tools/legacy-id.png"
    assert source.files[0].upload_file_id is None
    assert harness.committed_sessions == []
    harness.assert_closed()
    with sqlite_session_factory() as session:
        saved = session.get(MessageFile, tool_file.id)
        assert saved is not None
        assert saved.upload_file_id is None
