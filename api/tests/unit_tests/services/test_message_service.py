import json
from collections.abc import Iterator
from datetime import datetime
from decimal import Decimal
from unittest.mock import MagicMock

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, scoped_session, sessionmaker

import models.model as model_module
import services.message_service as service_module
from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.model_runtime.entities.model_entities import ModelType
from models.account import Account, AccountStatus
from models.enums import (
    ConversationFromSource,
    EndUserType,
    FeedbackFromSource,
    FeedbackRating,
)
from models.model import (
    App,
    AppAnnotationSetting,
    AppMode,
    AppModelConfig,
    Conversation,
    EndUser,
    Message,
    MessageFeedback,
)
from repositories.sqlalchemy_execution_extra_content_repository import SQLAlchemyExecutionExtraContentRepository
from services.errors.message import (
    FirstMessageNotExistsError,
    LastMessageNotExistsError,
    MessageNotExistsError,
    SuggestedQuestionsAfterAnswerDisabledError,
)
from services.message_service import MessageService, attach_message_extra_contents

SQLITE_MODELS = (Conversation, Message, MessageFeedback, AppModelConfig, AppAnnotationSetting)
pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [SQLITE_MODELS], indirect=True),
]


class _DatabaseBinding:
    """Expose the real engine and scoped session expected by model/service modules."""

    engine: Engine
    session: scoped_session[Session]

    def __init__(self, engine: Engine, session: scoped_session[Session]) -> None:
        self.engine = engine
        self.session = session


class MessageServiceTestDataFactory:
    """Create real service inputs and persistent message-domain rows."""

    @staticmethod
    def create_app(
        app_id: str = "app-123",
        mode: AppMode = AppMode.ADVANCED_CHAT,
        tenant_id: str = "tenant-123",
    ) -> App:
        return App(
            id=app_id,
            tenant_id=tenant_id,
            name="Test App",
            description="",
            mode=mode,
            enable_site=True,
            enable_api=True,
            max_active_requests=0,
        )

    @staticmethod
    def create_end_user(user_id: str = "user-456") -> EndUser:
        return EndUser(
            id=user_id,
            tenant_id="tenant-123",
            app_id="app-123",
            type=EndUserType.SERVICE_API,
            session_id="session-789",
        )

    @staticmethod
    def create_account(user_id: str = "account-123") -> Account:
        account = Account(name="Admin", email="admin@example.com", status=AccountStatus.ACTIVE)
        account.id = user_id
        return account

    @staticmethod
    def create_conversation(
        conversation_id: str = "conv-001",
        app_id: str = "app-123",
        *,
        app_model_config_id: str | None = None,
        override_model_configs: str | None = None,
    ) -> Conversation:
        conversation = Conversation(
            id=conversation_id,
            app_id=app_id,
            app_model_config_id=app_model_config_id,
            override_model_configs=override_model_configs,
            mode=AppMode.CHAT,
            name="Test conversation",
            status="normal",
            from_source=ConversationFromSource.API,
            from_end_user_id="user-456",
        )
        conversation._inputs = {}
        return conversation

    @staticmethod
    def create_message(
        message_id: str = "msg-001",
        conversation_id: str = "conv-001",
        app_id: str = "app-123",
        *,
        created_at: datetime | None = None,
        from_source: ConversationFromSource = ConversationFromSource.API,
        from_end_user_id: str | None = "user-456",
        from_account_id: str | None = None,
    ) -> Message:
        message = Message(
            id=message_id,
            app_id=app_id,
            conversation_id=conversation_id,
            query="What is AI?",
            message={"role": "user", "content": "What is AI?"},
            answer="AI stands for Artificial Intelligence.",
            message_unit_price=Decimal("0.0001"),
            answer_unit_price=Decimal("0.0002"),
            currency="USD",
            from_source=from_source,
            from_end_user_id=from_end_user_id,
            from_account_id=from_account_id,
        )
        message._inputs = {}
        timestamp = created_at or datetime.now()
        message.created_at = timestamp
        message.updated_at = timestamp
        return message

    @staticmethod
    def create_feedback(
        feedback_id: str,
        message: Message,
        *,
        source: FeedbackFromSource,
        rating: FeedbackRating = FeedbackRating.LIKE,
    ) -> MessageFeedback:
        feedback = MessageFeedback(
            app_id=message.app_id,
            conversation_id=message.conversation_id,
            message_id=message.id,
            rating=rating,
            from_source=source,
            from_end_user_id="user-456" if source == FeedbackFromSource.USER else None,
            from_account_id="account-123" if source == FeedbackFromSource.ADMIN else None,
        )
        feedback.id = feedback_id
        return feedback


@pytest.fixture
def factory() -> MessageServiceTestDataFactory:
    return MessageServiceTestDataFactory()


@pytest.fixture(autouse=True)
def database_boundaries(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> Iterator[scoped_session[Session]]:
    """Bind global model properties and service-owned factories to real SQLite sessions."""
    sessions = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    database = _DatabaseBinding(engine=sqlite_engine, session=sessions)
    monkeypatch.setattr(service_module, "db", database)
    monkeypatch.setattr(model_module, "db", database)
    try:
        yield sessions
    finally:
        sessions.remove()


@pytest.fixture
def empty_extra_content_repository(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    repository = MagicMock()
    repository.get_by_message_ids.side_effect = lambda message_ids: [[] for _ in message_ids]
    monkeypatch.setattr(service_module, "_create_execution_extra_content_repository", lambda: repository)
    return repository


def _persist(session: Session, *records: object) -> None:
    session.add_all(records)
    session.commit()


def _patch_conversation(monkeypatch: pytest.MonkeyPatch, conversation: Conversation) -> None:
    monkeypatch.setattr(service_module.ConversationService, "get_conversation", MagicMock(return_value=conversation))


class TestMessageServicePaginationByFirstId:
    """Verify cursor pagination using persisted message timestamps and IDs."""

    @pytest.mark.parametrize(("user", "conversation_id"), [(None, "conv-001"), ("end_user", "")])
    def test_early_return(
        self,
        user: str | None,
        conversation_id: str,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        result = MessageService.pagination_by_first_id(
            app_model=factory.create_app(),
            user=factory.create_end_user() if user else None,
            conversation_id=conversation_id,
            first_id=None,
            limit=10,
            session=sqlite_session,
        )

        assert result.data == []
        assert result.limit == 10
        assert result.has_more is False

    @pytest.mark.parametrize(
        ("order", "expected_ids"),
        [
            ("desc", ["msg-004", "msg-003", "msg-002", "msg-001", "msg-000"]),
            ("asc", ["msg-000", "msg-001", "msg-002", "msg-003", "msg-004"]),
        ],
    )
    def test_orders_persisted_messages(
        self,
        order: str,
        expected_ids: list[str],
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
        empty_extra_content_repository: MagicMock,
    ) -> None:
        conversation = factory.create_conversation()
        messages = [
            factory.create_message(f"msg-{index:03d}", created_at=datetime(2024, 1, 1, 12, index)) for index in range(5)
        ]
        _persist(sqlite_session, conversation, *messages)
        _patch_conversation(monkeypatch, conversation)

        result = MessageService.pagination_by_first_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            conversation_id=conversation.id,
            first_id=None,
            limit=10,
            order=order,
            session=sqlite_session,
        )

        assert [message.id for message in result.data] == expected_ids
        assert result.has_more is False

    def test_first_id_excludes_cursor_and_newer_messages(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
        empty_extra_content_repository: MagicMock,
    ) -> None:
        conversation = factory.create_conversation()
        messages = [
            factory.create_message(f"msg-{index:03d}", created_at=datetime(2024, 1, 1, 12, index)) for index in range(7)
        ]
        _persist(sqlite_session, conversation, *messages)
        _patch_conversation(monkeypatch, conversation)

        result = MessageService.pagination_by_first_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            conversation_id=conversation.id,
            first_id="msg-005",
            limit=10,
            order="desc",
            session=sqlite_session,
        )

        assert [message.id for message in result.data] == [f"msg-{index:03d}" for index in range(4, -1, -1)]

    def test_missing_first_id_raises(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        conversation = factory.create_conversation()
        _persist(sqlite_session, conversation)
        _patch_conversation(monkeypatch, conversation)

        with pytest.raises(FirstMessageNotExistsError):
            MessageService.pagination_by_first_id(
                app_model=factory.create_app(),
                user=factory.create_end_user(),
                conversation_id=conversation.id,
                first_id="missing",
                limit=10,
                session=sqlite_session,
            )

    def test_has_more_trims_oldest_extra_row(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
        empty_extra_content_repository: MagicMock,
    ) -> None:
        conversation = factory.create_conversation()
        messages = [
            factory.create_message(f"msg-{index:03d}", created_at=datetime(2024, 1, 1, 12, index))
            for index in range(11)
        ]
        _persist(sqlite_session, conversation, *messages)
        _patch_conversation(monkeypatch, conversation)

        result = MessageService.pagination_by_first_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            conversation_id=conversation.id,
            first_id=None,
            limit=10,
            order="desc",
            session=sqlite_session,
        )

        assert len(result.data) == 10
        assert result.has_more is True
        assert result.data[-1].id == "msg-001"

    def test_empty_conversation(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
        empty_extra_content_repository: MagicMock,
    ) -> None:
        conversation = factory.create_conversation()
        _persist(sqlite_session, conversation)
        _patch_conversation(monkeypatch, conversation)

        result = MessageService.pagination_by_first_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            conversation_id=conversation.id,
            first_id=None,
            limit=10,
            session=sqlite_session,
        )

        assert result.data == []
        assert result.has_more is False


class TestMessageServicePaginationByLastId:
    """Verify reverse cursor, conversation, and include-ID filtering."""

    def test_no_user(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        result = MessageService.pagination_by_last_id(
            app_model=factory.create_app(), user=None, last_id=None, limit=10, session=sqlite_session
        )
        assert result.data == []
        assert result.limit == 10
        assert result.has_more is False

    def test_without_last_id(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        messages = [
            factory.create_message(f"msg-{index:03d}", created_at=datetime(2024, 1, 1, 12, index)) for index in range(5)
        ]
        _persist(sqlite_session, *messages)

        result = MessageService.pagination_by_last_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            last_id=None,
            limit=10,
            session=sqlite_session,
        )

        assert [message.id for message in result.data] == [f"msg-{index:03d}" for index in range(4, -1, -1)]
        assert result.has_more is False

    def test_last_id_returns_older_rows(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        messages = [
            factory.create_message(f"msg-{index:03d}", created_at=datetime(2024, 1, 1, 12, index)) for index in range(7)
        ]
        _persist(sqlite_session, *messages)

        result = MessageService.pagination_by_last_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            last_id="msg-005",
            limit=10,
            session=sqlite_session,
        )

        assert [message.id for message in result.data] == [f"msg-{index:03d}" for index in range(4, -1, -1)]

    def test_missing_last_id_raises(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        with pytest.raises(LastMessageNotExistsError):
            MessageService.pagination_by_last_id(
                app_model=factory.create_app(),
                user=factory.create_end_user(),
                last_id="missing",
                limit=10,
                session=sqlite_session,
            )

    def test_conversation_filter(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        conversation = factory.create_conversation()
        other_conversation = factory.create_conversation("conv-002")
        matching = factory.create_message("matching", conversation_id=conversation.id)
        excluded = factory.create_message("excluded", conversation_id=other_conversation.id)
        _persist(sqlite_session, conversation, other_conversation, matching, excluded)
        _patch_conversation(monkeypatch, conversation)

        result = MessageService.pagination_by_last_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            last_id=None,
            limit=10,
            conversation_id=conversation.id,
            session=sqlite_session,
        )

        assert [message.id for message in result.data] == [matching.id]

    def test_include_ids_filter(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        messages = [
            factory.create_message(f"msg-{index:03d}", created_at=datetime(2024, 1, 1, 12, index)) for index in range(4)
        ]
        _persist(sqlite_session, *messages)

        result = MessageService.pagination_by_last_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            last_id=None,
            limit=10,
            include_ids=["msg-001", "msg-003"],
            session=sqlite_session,
        )

        assert [message.id for message in result.data] == ["msg-003", "msg-001"]

    def test_has_more(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        messages = [
            factory.create_message(f"msg-{index:03d}", created_at=datetime(2024, 1, 1, 12, index))
            for index in range(11)
        ]
        _persist(sqlite_session, *messages)

        result = MessageService.pagination_by_last_id(
            app_model=factory.create_app(),
            user=factory.create_end_user(),
            last_id=None,
            limit=10,
            session=sqlite_session,
        )

        assert len(result.data) == 10
        assert result.has_more is True


class TestMessageServiceUtilities:
    def test_attach_message_extra_contents_empty(self) -> None:
        attach_message_extra_contents([])

    def test_attach_message_extra_contents(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
    ) -> None:
        messages = [factory.create_message("msg-1"), factory.create_message("msg-2")]
        content_one = MagicMock()
        content_one.model_dump.return_value = {"key": "value1"}
        content_two = MagicMock()
        content_two.model_dump.return_value = {"key": "value2"}
        repository = MagicMock()
        repository.get_by_message_ids.return_value = [[content_one], [content_two]]
        monkeypatch.setattr(service_module, "_create_execution_extra_content_repository", lambda: repository)

        attach_message_extra_contents(messages)

        assert messages[0].extra_contents == [{"key": "value1"}]
        assert messages[1].extra_contents == [{"key": "value2"}]

    def test_attach_message_extra_contents_missing_list(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
    ) -> None:
        message = factory.create_message("msg-1")
        repository = MagicMock()
        repository.get_by_message_ids.return_value = []
        monkeypatch.setattr(service_module, "_create_execution_extra_content_repository", lambda: repository)

        attach_message_extra_contents([message])

        assert message.extra_contents == []

    def test_create_execution_extra_content_repository_uses_sqlite_factory(self, sqlite_engine: Engine) -> None:
        repository = service_module._create_execution_extra_content_repository()

        assert isinstance(repository, SQLAlchemyExecutionExtraContentRepository)
        assert repository._session_maker.kw["bind"] is sqlite_engine
        with repository._session_maker() as session:
            assert isinstance(session, Session)


class TestMessageServiceGetMessage:
    @pytest.mark.parametrize("actor", ["end_user", "account"])
    def test_identity_scoped_success(
        self,
        actor: str,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        if actor == "end_user":
            user: Account | EndUser = factory.create_end_user("end-user-123")
            message = factory.create_message(
                "msg-123", from_end_user_id=user.id, from_account_id=None, from_source=ConversationFromSource.API
            )
        else:
            user = factory.create_account("account-123")
            message = factory.create_message(
                "msg-123",
                from_end_user_id=None,
                from_account_id=user.id,
                from_source=ConversationFromSource.CONSOLE,
            )
        distractor = factory.create_message("wrong-app", app_id="app-456")
        _persist(sqlite_session, message, distractor)

        result = MessageService.get_message(
            app_model=factory.create_app(), user=user, message_id=message.id, session=sqlite_session
        )

        assert result.id == message.id

    def test_not_found(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        with pytest.raises(MessageNotExistsError):
            MessageService.get_message(
                app_model=factory.create_app(),
                user=factory.create_end_user(),
                message_id="missing",
                session=sqlite_session,
            )


class TestMessageServiceFeedback:
    def test_create_new_end_user_feedback(
        self,
        factory: MessageServiceTestDataFactory,
        database_boundaries: scoped_session[Session],
        sqlite_engine: Engine,
    ) -> None:
        session = database_boundaries()
        user = factory.create_end_user()
        message = factory.create_message("msg-123")
        _persist(session, message)

        feedback = MessageService.create_feedback(
            app_model=factory.create_app(),
            message_id=message.id,
            user=user,
            rating=FeedbackRating.LIKE,
            content="Good answer",
            session=session,
        )

        with Session(sqlite_engine) as verification_session:
            persisted = verification_session.get(MessageFeedback, feedback.id)
            assert persisted is not None
            assert persisted.rating == FeedbackRating.LIKE
            assert persisted.content == "Good answer"
            assert persisted.from_source == FeedbackFromSource.USER

    def test_update_account_feedback(
        self,
        factory: MessageServiceTestDataFactory,
        database_boundaries: scoped_session[Session],
        sqlite_engine: Engine,
    ) -> None:
        session = database_boundaries()
        user = factory.create_account()
        message = factory.create_message(
            "msg-123",
            from_source=ConversationFromSource.CONSOLE,
            from_end_user_id=None,
            from_account_id=user.id,
        )
        feedback = factory.create_feedback("feedback-1", message, source=FeedbackFromSource.ADMIN)
        _persist(session, message, feedback)

        result = MessageService.create_feedback(
            app_model=factory.create_app(),
            message_id=message.id,
            user=user,
            rating=FeedbackRating.DISLIKE,
            content="Bad answer",
            session=session,
        )

        assert result.id == feedback.id
        with Session(sqlite_engine) as verification_session:
            persisted = verification_session.get(MessageFeedback, feedback.id)
            assert persisted is not None
            assert persisted.rating == FeedbackRating.DISLIKE
            assert persisted.content == "Bad answer"

    def test_delete_feedback(
        self,
        factory: MessageServiceTestDataFactory,
        database_boundaries: scoped_session[Session],
        sqlite_engine: Engine,
    ) -> None:
        session = database_boundaries()
        user = factory.create_end_user()
        message = factory.create_message("msg-123")
        feedback = factory.create_feedback("feedback-1", message, source=FeedbackFromSource.USER)
        _persist(session, message, feedback)

        MessageService.create_feedback(
            app_model=factory.create_app(),
            message_id=message.id,
            user=user,
            rating=None,
            content=None,
            session=session,
        )

        with Session(sqlite_engine) as verification_session:
            assert verification_session.get(MessageFeedback, feedback.id) is None

    def test_get_all_feedbacks_is_app_scoped_and_paginated(
        self,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        message = factory.create_message("msg-123")
        newest = factory.create_feedback("feedback-new", message, source=FeedbackFromSource.USER)
        oldest = factory.create_feedback("feedback-old", message, source=FeedbackFromSource.USER)
        other_message = factory.create_message("other-msg", app_id="app-456")
        other_app = factory.create_feedback("feedback-other", other_message, source=FeedbackFromSource.USER)
        newest.created_at = datetime(2024, 1, 2)
        oldest.created_at = datetime(2024, 1, 1)
        other_app.created_at = datetime(2024, 1, 3)
        _persist(sqlite_session, newest, oldest, other_app)

        result = MessageService.get_all_messages_feedbacks(
            app_model=factory.create_app(), page=1, limit=1, session=sqlite_session
        )

        assert [record["id"] for record in result] == [newest.id]


class TestMessageServiceSuggestedQuestions:
    @staticmethod
    def _chat_boundaries(
        monkeypatch: pytest.MonkeyPatch,
        conversation: Conversation,
    ) -> tuple[MagicMock, MagicMock, MagicMock]:
        message = MagicMock()
        message.conversation_id = conversation.id
        monkeypatch.setattr(service_module.MessageService, "get_message", MagicMock(return_value=message))
        monkeypatch.setattr(
            service_module.ConversationService, "get_conversation", MagicMock(return_value=conversation)
        )
        model_manager = MagicMock()
        monkeypatch.setattr(service_module.ModelManager, "for_tenant", MagicMock(return_value=model_manager))
        memory = MagicMock()
        memory.return_value.get_history_prompt_text.return_value = "histories"
        monkeypatch.setattr(service_module, "TokenBufferMemory", memory)
        llm_generator = MagicMock()
        llm_generator.generate_suggested_questions_after_answer.return_value = ["Q1?"]
        monkeypatch.setattr(service_module, "LLMGenerator", llm_generator)
        monkeypatch.setattr(service_module, "TraceQueueManager", MagicMock())
        return model_manager, memory, llm_generator

    def test_user_none(self, factory: MessageServiceTestDataFactory, sqlite_session: Session) -> None:
        with pytest.raises(ValueError, match="user cannot be None"):
            MessageService.get_suggested_questions_after_answer(
                app_model=factory.create_app(),
                user=None,
                message_id="msg-123",
                invoke_from=InvokeFrom.WEB_APP,
                session=sqlite_session,
            )

    def test_advanced_chat_success(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        conversation = factory.create_conversation()
        _, _, llm_generator = self._chat_boundaries(monkeypatch, conversation)
        workflow = MagicMock()
        workflow.features_dict = {"suggested_questions_after_answer": {"enabled": True}}
        workflow_service = MagicMock()
        workflow_service.return_value.get_published_workflow.return_value = workflow
        monkeypatch.setattr(service_module, "WorkflowService", workflow_service)
        app_config_manager = MagicMock()
        app_config_manager.get_app_config.return_value.additional_features.suggested_questions_after_answer = True
        monkeypatch.setattr(service_module, "AdvancedChatAppConfigManager", app_config_manager)

        result = MessageService.get_suggested_questions_after_answer(
            app_model=factory.create_app(mode=AppMode.ADVANCED_CHAT),
            user=factory.create_end_user(),
            message_id="msg-123",
            invoke_from=InvokeFrom.WEB_APP,
            session=sqlite_session,
        )

        assert result == ["Q1?"]
        llm_generator.generate_suggested_questions_after_answer.assert_called_once()

    @pytest.mark.parametrize(
        ("config", "expected_prompt", "expected_model"),
        [
            ({"enabled": True}, None, None),
            (
                {
                    "enabled": True,
                    "prompt": "custom prompt",
                    "model": {
                        "provider": "openai",
                        "name": "gpt-4o-mini",
                        "completion_params": {"max_tokens": 2048, "temperature": 0.1},
                    },
                },
                "custom prompt",
                {
                    "provider": "openai",
                    "name": "gpt-4o-mini",
                    "completion_params": {"max_tokens": 2048, "temperature": 0.1},
                },
            ),
            (
                {"enabled": True, "model": {"provider": "openai", "name": "invalid-model"}},
                None,
                {"provider": "openai", "name": "invalid-model"},
            ),
        ],
    )
    def test_chat_app_uses_persisted_model_config(
        self,
        config: dict[str, object],
        expected_prompt: str | None,
        expected_model: dict[str, object] | None,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        app_model_config = AppModelConfig(
            app_id="app-123",
            suggested_questions_after_answer=json.dumps(config),
        )
        app_model_config.id = "config-1"
        conversation = factory.create_conversation(app_model_config_id=app_model_config.id)
        _persist(sqlite_session, app_model_config)
        model_manager, memory, llm_generator = self._chat_boundaries(monkeypatch, conversation)

        result = MessageService.get_suggested_questions_after_answer(
            app_model=factory.create_app(mode=AppMode.CHAT),
            user=factory.create_end_user(),
            message_id="msg-123",
            invoke_from=InvokeFrom.WEB_APP,
            session=sqlite_session,
        )

        assert result == ["Q1?"]
        model_manager.get_default_model_instance.assert_called_once_with(
            tenant_id="tenant-123", model_type=ModelType.LLM
        )
        memory.assert_called_once_with(
            conversation=conversation,
            model_instance=model_manager.get_default_model_instance.return_value,
        )
        llm_generator.generate_suggested_questions_after_answer.assert_called_once_with(
            tenant_id="tenant-123",
            histories="histories",
            instruction_prompt=expected_prompt,
            model_config=expected_model,
        )

    def test_chat_app_uses_compatible_override_model_config(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        override = {
            "model": {"provider": "openai", "name": "gpt-4o-mini", "mode": "chat"},
            "suggested_questions_after_answer": {"enabled": True, "prompt": "legacy prompt"},
        }
        conversation = factory.create_conversation(override_model_configs=json.dumps(override))
        _, _, llm_generator = self._chat_boundaries(monkeypatch, conversation)

        result = MessageService.get_suggested_questions_after_answer(
            app_model=factory.create_app(mode=AppMode.CHAT),
            user=factory.create_end_user(),
            message_id="msg-123",
            invoke_from=InvokeFrom.WEB_APP,
            session=sqlite_session,
        )

        assert result == ["Q1?"]
        llm_generator.generate_suggested_questions_after_answer.assert_called_once_with(
            tenant_id="tenant-123",
            histories="histories",
            instruction_prompt="legacy prompt",
            model_config=None,
        )

    def test_disabled_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
        factory: MessageServiceTestDataFactory,
        sqlite_session: Session,
    ) -> None:
        conversation = factory.create_conversation()
        self._chat_boundaries(monkeypatch, conversation)
        workflow = MagicMock()
        workflow_service = MagicMock()
        workflow_service.return_value.get_published_workflow.return_value = workflow
        monkeypatch.setattr(service_module, "WorkflowService", workflow_service)
        app_config_manager = MagicMock()
        app_config_manager.get_app_config.return_value.additional_features.suggested_questions_after_answer = False
        monkeypatch.setattr(service_module, "AdvancedChatAppConfigManager", app_config_manager)

        with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
            MessageService.get_suggested_questions_after_answer(
                app_model=factory.create_app(mode=AppMode.ADVANCED_CHAT),
                user=factory.create_end_user(),
                message_id="msg-123",
                invoke_from=InvokeFrom.WEB_APP,
                session=sqlite_session,
            )
