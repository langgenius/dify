import json
from collections.abc import Iterator
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from decimal import Decimal
from typing import cast, override
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import update
from sqlalchemy.orm import Session, sessionmaker

import services.message_service as message_module
from core import telemetry
from core.credit_usage import CreditUsageAppType
from core.model_context import get_credit_usage_metadata, use_credit_usage_metadata
from core.model_manager import ModelInstance, ModelManager
from core.ops.ops_trace_manager import TraceQueueManager
from core.telemetry import FeedbackCreatedEvent
from core.workflow.nodes.human_input.entities import FormDefinition, UserActionConfig
from extensions.ext_database import db
from models import Account, App, AppMode, AppModelConfig, Conversation, InstalledApp, Message
from models.enums import ConversationFromSource
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm
from services.account_errors import AccountNotFoundError
from services.errors.conversation import ConversationNotExistsError
from services.errors.message import MessageNotExistsError, SuggestedQuestionsAfterAnswerDisabledError
from services.installed_app_access_service import InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_message_adapters import InstalledAppMessageRuntime, emit_installed_app_feedback
from services.installed_app_message_service import MessageFeedbackEvent


@dataclass
class _Harness:
    runtime: InstalledAppMessageRuntime
    installation: InstalledAppRef
    account_id: str
    message_id: str
    conversation_id: str
    config_id: str
    read_sessions: list[Session]
    legacy_sessions: list[Session]
    model_manager: MagicMock

    def suggested_questions(self) -> list[str]:
        return self.runtime.get_suggested_questions(
            installed_app=self.installation, account_id=self.account_id, message_id=self.message_id
        )


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch) -> Iterator[_Harness]:
    with sqlite_session_factory.begin() as session:
        app = App(tenant_id=str(uuid4()), name="Original", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        account = Account(name="Viewer", email="message-viewer@example.com")
        session.add_all([app, account])
        session.flush()
        installed = InstalledApp(
            tenant_id=str(uuid4()), app_id=app.id, app_owner_tenant_id=app.tenant_id, position=0, is_pinned=False
        )
        config = AppModelConfig(
            app_id=app.id,
            suggested_questions_after_answer=json.dumps(
                {
                    "enabled": True,
                    "prompt": "Ask a follow-up",
                    "model": {"provider": "vendor", "name": "question-model"},
                }
            ),
        )
        session.add_all([installed, config])
        session.flush()
        app.app_model_config_id = config.id
        conversation = Conversation(
            app_id=app.id,
            app_model_config_id=config.id,
            mode=AppMode.CHAT,
            name="Conversation",
            inputs={},
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account.id,
            from_end_user_id=None,
            is_deleted=False,
        )
        session.add(conversation)
        session.flush()
        message = Message(
            app_id=app.id,
            conversation_id=conversation.id,
            inputs={},
            query="Original question",
            answer="Original answer",
            message={},
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.CONSOLE,
            from_account_id=account.id,
            from_end_user_id=None,
        )
        session.add(message)
        session.flush()

    read_sessions: list[Session] = []
    legacy_sessions: list[Session] = []

    class TrackedSession(Session):
        @override
        def close(self) -> None:
            super().close()
            read_sessions.append(self)

    factory = sessionmaker(bind=sqlite_session_factory.kw["bind"], class_=TrackedSession, expire_on_commit=True)
    runtime_app = Flask(__name__)
    runtime_app.config["SQLALCHEMY_DATABASE_URI"] = str(sqlite_session_factory.kw["bind"].url)
    db.init_app(runtime_app)

    @runtime_app.teardown_appcontext
    def capture_legacy_session(_error: BaseException | None) -> None:
        # Registered after db.init_app, so this runs before its session removal.
        legacy_sessions.append(db.session())

    manager = MagicMock(spec=ModelManager)
    model = MagicMock(spec=ModelInstance)
    model.get_llm_num_tokens.return_value = 4
    manager.get_default_model_instance.return_value = model

    def provider(*, tenant_id: str) -> ModelManager:
        assert tenant_id == app.tenant_id
        return manager

    monkeypatch.setattr(message_module.ModelManager, "for_tenant", provider)
    with runtime_app.app_context():
        try:
            yield _Harness(
                runtime=InstalledAppMessageRuntime(session_factory=cast(sessionmaker[Session], factory)),
                installation=InstalledAppRef(
                    id=installed.id, tenant_id=installed.tenant_id, app_id=app.id, app_mode="chat"
                ),
                account_id=account.id,
                message_id=message.id,
                conversation_id=conversation.id,
                config_id=config.id,
                read_sessions=read_sessions,
                legacy_sessions=legacy_sessions,
                model_manager=manager,
            )
        finally:
            db.session.remove()
            db.engine.dispose()


@pytest.mark.parametrize("fail", [False, True])
def test_suggestions_keep_real_history_and_release_isolated_legacy_session_on_success_or_failure(
    harness: _Harness, monkeypatch: pytest.MonkeyPatch, fail: bool
) -> None:
    outer = db.session()
    app = outer.get(App, harness.installation.app_id)
    assert app is not None
    app.name = "Pending outer edit"
    owner_tenant_id = app.tenant_id
    failure = RuntimeError("Suggestion provider unavailable")
    calls: list[str] = []
    tracing = MagicMock(spec=TraceQueueManager)

    def trace_manager(*, app_id: str) -> TraceQueueManager:
        assert app_id == harness.installation.app_id
        return tracing

    def generate(
        *, tenant_id: str, histories: str, instruction_prompt: str | None = None, model_config: object | None = None
    ) -> list[str]:
        assert tenant_id == owner_tenant_id
        assert histories == "Human: Original question\nAssistant: Original answer"
        assert instruction_prompt == "Ask a follow-up"
        assert model_config == {"provider": "vendor", "name": "question-model"}
        assert len(harness.read_sessions) == 1
        assert not harness.read_sessions[0].in_transaction()
        assert not harness.read_sessions[0].identity_map
        assert db.session() is not outer
        assert db.session().in_transaction()
        assert get_credit_usage_metadata() == {
            "app_type": CreditUsageAppType.CHATBOT,
            "request_id": "suggestions-request",
        }
        calls.append(histories)
        if fail:
            raise failure
        return ["Follow-up one?", "Follow-up two?"]

    monkeypatch.setattr(message_module.LLMGenerator, "generate_suggested_questions_after_answer", generate)
    monkeypatch.setattr(message_module, "TraceQueueManager", trace_manager)
    previous_metadata = get_credit_usage_metadata()
    with use_credit_usage_metadata({"request_id": "suggestions-request"}):
        inherited_metadata = get_credit_usage_metadata()
        if fail:
            with pytest.raises(RuntimeError) as error:
                harness.suggested_questions()
            assert error.value is failure
        else:
            assert harness.suggested_questions() == ["Follow-up one?", "Follow-up two?"]
        assert get_credit_usage_metadata() == inherited_metadata
    assert get_credit_usage_metadata() == previous_metadata
    assert len(calls) == 1
    assert len(harness.legacy_sessions) == 1
    legacy = harness.legacy_sessions[0]
    assert legacy is not outer
    assert not legacy.in_transaction()
    assert not legacy.identity_map
    assert db.session() is outer
    assert outer.in_transaction()
    assert app in outer.dirty
    assert app.name == "Pending outer edit"
    assert tracing.add_trace_task.call_count == (0 if fail else 1)


@pytest.mark.parametrize("case", ["disabled", "missing_workflow", "history_provider_failure"])
def test_suggestions_keep_disabled_feature_and_missing_workflow_or_model_behavior(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], case: str
) -> None:
    with sqlite_session_factory.begin() as session:
        if case == "disabled":
            config = session.get(AppModelConfig, harness.config_id)
            assert config is not None
            config.suggested_questions_after_answer = '{"enabled":false}'
        elif case == "missing_workflow":
            app = session.get(App, harness.installation.app_id)
            assert app is not None
            app.mode = AppMode.ADVANCED_CHAT
        else:
            harness.model_manager.get_default_model_instance.side_effect = RuntimeError("No history model")
    if case == "disabled":
        with pytest.raises(SuggestedQuestionsAfterAnswerDisabledError):
            harness.suggested_questions()
    else:
        assert harness.suggested_questions() == []
    assert len(harness.legacy_sessions) == 1
    assert not harness.legacy_sessions[0].in_transaction()
    assert not harness.legacy_sessions[0].identity_map


@pytest.mark.parametrize("entity", ["message", "conversation"])
@pytest.mark.parametrize("mismatch", ["app_id", "from_account_id", "from_source", "from_end_user_id"])
def test_suggestions_preserve_each_message_and_conversation_ownership_predicate(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], entity: str, mismatch: str
) -> None:
    value = ConversationFromSource.API if mismatch == "from_source" else str(uuid4())
    with sqlite_session_factory.begin() as session:
        if entity == "message":
            session.execute(update(Message).where(Message.id == harness.message_id).values({mismatch: value}))
        else:
            session.execute(
                update(Conversation).where(Conversation.id == harness.conversation_id).values({mismatch: value})
            )
    expected = MessageNotExistsError if entity == "message" else ConversationNotExistsError
    with pytest.raises(expected):
        harness.suggested_questions()
    harness.model_manager.get_default_model_instance.assert_not_called()
    assert len(harness.legacy_sessions) == 1
    assert not harness.legacy_sessions[0].in_transaction()


def test_suggestions_reject_deleted_conversation(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation_id).values(is_deleted=True))
    with pytest.raises(ConversationNotExistsError):
        harness.suggested_questions()


@pytest.mark.parametrize("missing", ["installation", "app", "account", "viewer_tenant"])
def test_missing_admission_entities_fail_before_legacy_runtime(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session], missing: str
) -> None:
    with sqlite_session_factory.begin() as session:
        if missing == "installation":
            entity = session.get(InstalledApp, harness.installation.id)
            assert entity is not None
            session.delete(entity)
        elif missing == "app":
            app = session.get(App, harness.installation.app_id)
            assert app is not None
            session.delete(app)
        elif missing == "account":
            account = session.get(Account, harness.account_id)
            assert account is not None
            session.delete(account)
        else:
            harness.installation = replace(harness.installation, tenant_id=str(uuid4()))
    expected = AccountNotFoundError if missing == "account" else InstalledAppNotFoundError
    with pytest.raises(expected):
        harness.suggested_questions()
    assert len(harness.read_sessions) == 1
    assert harness.legacy_sessions == []


def test_extra_contents_use_real_repository_preserve_message_order_and_omit_none(
    harness: _Harness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    assert harness.runtime.get_extra_contents(message_ids=[]) == {}
    assert harness.read_sessions == []
    second_message_id = str(uuid4())
    absent_message_id = str(uuid4())
    expiration = datetime(2026, 9, 10)
    with sqlite_session_factory.begin() as session:
        for index, (message_id, title) in enumerate([(second_message_id, "Second"), (harness.message_id, "First")]):
            definition = FormDefinition(
                form_content="Approve?",
                inputs=[],
                user_actions=[UserActionConfig(id="approve", title="Approve")],
                rendered_content="Approve?",
                expiration_time=expiration,
                node_title=title,
                display_in_ui=True,
            )
            form = HumanInputForm(
                tenant_id=harness.installation.tenant_id,
                app_id=harness.installation.app_id,
                workflow_run_id=str(uuid4()),
                node_id=f"node-{index}",
                form_definition=definition.model_dump_json(),
                rendered_content="Approve?",
                expiration_time=expiration,
            )
            session.add(form)
            session.flush()
            content = HumanInputContent.new(
                workflow_run_id=form.workflow_run_id or "", form_id=form.id, message_id=message_id
            )
            content.created_at = expiration - timedelta(days=index)
            session.add(content)
    contents = harness.runtime.get_extra_contents(
        message_ids=[harness.message_id, absent_message_id, second_message_id]
    )
    assert list(contents) == [harness.message_id, absent_message_id, second_message_id]
    assert contents[absent_message_id] == []
    for message_id, title in [(harness.message_id, "First"), (second_message_id, "Second")]:
        assert len(contents[message_id]) == 1
        content = contents[message_id][0]
        assert content["type"] == "human_input"
        assert content["submitted"] is False
        assert "form_submission_data" not in content
        definition = content["form_definition"]
        assert isinstance(definition, dict)
        assert definition["node_title"] == title
        assert "form_token" not in definition
    assert len(harness.read_sessions) == 1
    assert not harness.read_sessions[0].in_transaction()
    assert not harness.read_sessions[0].identity_map


@pytest.mark.parametrize("fail", [False, True])
def test_feedback_telemetry_preserves_event_fields_and_suppresses_sink_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, fail: bool
) -> None:
    events: list[FeedbackCreatedEvent] = []

    def emit(event: FeedbackCreatedEvent) -> None:
        events.append(event)
        if fail:
            raise RuntimeError("Telemetry unavailable")

    monkeypatch.setattr(telemetry, "emit", emit)
    emit_installed_app_feedback(
        feedback=MessageFeedbackEvent(
            tenant_id="owner-tenant",
            app_id="app",
            conversation_id="conversation",
            message_id="message",
            account_id="account",
            rating="dislike",
            content="",
        )
    )
    assert len(events) == 1
    assert events[0].context.tenant_id == "owner-tenant"
    assert events[0].payload == {
        "message_id": "message",
        "app_id": "app",
        "conversation_id": "conversation",
        "from_end_user_id": None,
        "from_account_id": "account",
        "rating": "dislike",
        "from_source": "admin",
        "content": "",
    }
    if fail:
        assert "Failed to emit feedback telemetry for message message" in caplog.text
