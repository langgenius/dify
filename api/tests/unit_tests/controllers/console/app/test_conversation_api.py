from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from fields.conversation_fields import ConversationResponseSource
from graphon.enums import WorkflowExecutionStatus
from models import Account, EndUser, Message, MessageAnnotation, MessageFeedback
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    EndUserType,
    FeedbackFromSource,
    FeedbackRating,
    WorkflowRunTriggeredFrom,
)
from models.model import AppMode, Conversation
from models.workflow import WorkflowRun, WorkflowType
from tests.unit_tests.model_factories import make_conversation


def _make_account() -> Account:
    account = Account(name="Account", email="account@example.com", timezone="UTC")
    account.id = "u1"
    return account


def _conversation(*, conversation_id: str = "c1", app_id: str = "app-1") -> Conversation:
    return make_conversation(
        conversation_id=conversation_id,
        app_id=app_id,
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.EXPLORE,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="u1",
    )


def test_conversation_response_source_uses_caller_session(sqlite_session: Session) -> None:
    account = _make_account()
    end_user = EndUser(
        id="end-user-1",
        tenant_id="tenant-1",
        app_id="app-1",
        type=EndUserType.SERVICE_API,
        external_user_id="external-user-1",
        name="End user",
        session_id="end-user-session",
    )
    conversation = _conversation()
    conversation.mode = AppMode.ADVANCED_CHAT
    conversation.override_model_configs = "{}"
    conversation.summary = "summary"
    conversation.inputs = {"topic": "support"}
    conversation.from_end_user_id = end_user.id
    conversation.from_account_id = account.id
    message = Message(
        id="message-1",
        app_id=conversation.app_id,
        model_provider=None,
        model_id=None,
        override_model_configs=None,
        conversation_id=conversation.id,
        inputs={},
        query="first question",
        message={},
        message_tokens=1,
        message_unit_price=Decimal(0),
        message_price_unit=Decimal("0.001"),
        answer="answer",
        answer_tokens=1,
        answer_unit_price=Decimal(0),
        answer_price_unit=Decimal("0.001"),
        parent_message_id=None,
        provider_response_latency=0,
        total_price=Decimal(0),
        currency="USD",
        error=None,
        message_metadata=None,
        invoke_from=InvokeFrom.EXPLORE,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=end_user.id,
        from_account_id=account.id,
        workflow_run_id="run-1",
        app_mode=AppMode.ADVANCED_CHAT,
    )
    annotation = MessageAnnotation(
        app_id=conversation.app_id,
        question="question",
        content="annotation",
        account_id=account.id,
        conversation_id=conversation.id,
        message_id=message.id,
    )
    feedbacks = [
        MessageFeedback(
            app_id=conversation.app_id,
            conversation_id=conversation.id,
            message_id=message.id,
            rating=rating,
            from_source=source,
            from_account_id=account.id,
        )
        for source, rating in (
            (FeedbackFromSource.USER, FeedbackRating.LIKE),
            (FeedbackFromSource.USER, FeedbackRating.DISLIKE),
            (FeedbackFromSource.ADMIN, FeedbackRating.LIKE),
        )
    ]
    workflow_run = WorkflowRun(
        id="run-1",
        tenant_id="tenant-1",
        app_id=conversation.app_id,
        workflow_id="workflow-1",
        type=WorkflowType.WORKFLOW,
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        version="1",
        graph="{}",
        inputs="{}",
        status=WorkflowExecutionStatus.SUCCEEDED,
        outputs="{}",
        error=None,
        elapsed_time=1,
        total_tokens=1,
        total_steps=1,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=account.id,
        finished_at=None,
        exceptions_count=0,
    )
    sqlite_session.add_all([account, end_user, conversation, message, annotation, workflow_run, *feedbacks])
    sqlite_session.commit()

    source = ConversationResponseSource(conversation, session=sqlite_session)

    assert source.inputs == {"topic": "support"}
    assert source.model_config == {"model_id": None, "provider": None}
    assert source.summary_or_query == "summary"
    assert source.annotated is True
    annotation_source = source.annotation
    assert annotation_source is not None
    assert annotation_source.account is account
    assert source.message_count == 1
    assert source.user_feedback_stats == {"like": 1, "dislike": 1}
    assert source.admin_feedback_stats == {"like": 1, "dislike": 0}
    assert source.status_count == {"success": 1, "failed": 0, "partial_success": 0, "paused": 0}
    assert source.first_message is not None
    assert source.from_end_user_session_id == "end-user-session"
    assert source.from_account_name == "Account"
