from __future__ import annotations

from decimal import Decimal
from inspect import unwrap
from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

from controllers.console.app import conversation as conversation_module
from core.app.entities.app_invoke_entities import InvokeFrom
from graphon.enums import WorkflowExecutionStatus
from models import Account, App, EndUser, Message, MessageAnnotation, MessageFeedback
from models.enums import (
    ConversationFromSource,
    CreatorUserRole,
    EndUserType,
    FeedbackFromSource,
    FeedbackRating,
    WorkflowRunTriggeredFrom,
)
from models.model import AppMode, Conversation, IconType
from models.workflow import WorkflowRun, WorkflowType
from services.errors.conversation import ConversationNotExistsError


def _make_account() -> Account:
    account = Account(name="Account", email="account@example.com", timezone="UTC")
    account.id = "u1"
    return account


def _app(*, mode: AppMode = AppMode.CHAT) -> App:
    return App(
        id="app-1",
        tenant_id="tenant-1",
        name="Conversation app",
        description="",
        mode=mode,
        icon_type=IconType.EMOJI,
        icon="robot",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=True,
        max_active_requests=None,
    )


def _conversation(*, conversation_id: str = "c1", app_id: str = "app-1") -> Conversation:
    conversation = Conversation(
        app_id=app_id,
        app_model_config_id=None,
        model_provider=None,
        override_model_configs=None,
        model_id=None,
        mode=AppMode.CHAT,
        name="Conversation",
        inputs={},
        introduction="",
        system_instruction="",
        system_instruction_tokens=0,
        status="normal",
        invoke_from=InvokeFrom.EXPLORE,
        from_source=ConversationFromSource.CONSOLE,
        from_end_user_id=None,
        from_account_id="u1",
    )
    conversation.id = conversation_id
    return conversation


def test_completion_conversation_list_returns_paginated_result(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.CompletionConversationApi()
    method = unwrap(api.get)
    account = _make_account()
    monkeypatch.setattr(conversation_module, "parse_time_range", lambda *_args, **_kwargs: (None, None))
    paginate_result = MagicMock()
    paginate_result.page = 1
    paginate_result.per_page = 20
    paginate_result.total = 0
    paginate_result.has_next = False
    paginate_result.items = []
    monkeypatch.setattr(conversation_module, "paginate_query", lambda *_args, **_kwargs: paginate_result)
    with app.test_request_context("/console/api/apps/app-1/completion-conversations", method="GET"):
        response = method(
            api,
            conversation_module.CompletionConversationQuery(),
            unbound_session,
            account,
            app_model=_app(mode=AppMode.COMPLETION),
        )
    assert response == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


def test_completion_conversation_list_invalid_time_range(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.CompletionConversationApi()
    method = unwrap(api.get)
    account = _make_account()
    monkeypatch.setattr(
        conversation_module,
        "parse_time_range",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad range")),
    )
    with app.test_request_context(
        "/console/api/apps/app-1/completion-conversations", method="GET", query_string={"start": "bad"}
    ):
        with pytest.raises(BadRequest):
            method(
                api,
                conversation_module.CompletionConversationQuery(),
                unbound_session,
                account,
                app_model=_app(mode=AppMode.COMPLETION),
            )


def test_chat_conversation_list_advanced_chat_calls_paginate(
    app: Flask, monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.ChatConversationApi()
    method = unwrap(api.get)
    account = _make_account()
    monkeypatch.setattr(conversation_module, "parse_time_range", lambda *_args, **_kwargs: (None, None))
    paginate_result = MagicMock()
    paginate_result.page = 1
    paginate_result.per_page = 20
    paginate_result.total = 0
    paginate_result.has_next = False
    paginate_result.items = []
    monkeypatch.setattr(conversation_module, "paginate_query", lambda *_args, **_kwargs: paginate_result)
    with app.test_request_context("/console/api/apps/app-1/chat-conversations", method="GET"):
        response = method(
            api,
            conversation_module.ChatConversationQuery(),
            unbound_session,
            account,
            app_model=_app(mode=AppMode.ADVANCED_CHAT),
        )
    assert response == {"page": 1, "limit": 20, "total": 0, "has_more": False, "data": []}


def test_get_conversation_updates_read_at(sqlite_session: Session) -> None:
    conversation = _conversation()
    sqlite_session.add(conversation)
    sqlite_session.flush()
    session = sqlite_session
    result = conversation_module._get_conversation(session, _make_account(), _app(), "c1")
    assert result is conversation
    assert conversation.read_at is not None
    assert conversation.read_account_id == "u1"


def test_get_conversation_missing_raises_not_found(sqlite_session: Session) -> None:
    session = sqlite_session
    with pytest.raises(NotFound):
        conversation_module._get_conversation(session, _make_account(), _app(), "missing")


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

    source = conversation_module.ConversationResponseSource(conversation, session=sqlite_session)

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


def test_completion_conversation_delete_maps_not_found(
    monkeypatch: pytest.MonkeyPatch, unbound_session: Session
) -> None:
    api = conversation_module.CompletionConversationDetailApi()
    method = unwrap(api.delete)
    monkeypatch.setattr(
        conversation_module.ConversationService,
        "delete",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ConversationNotExistsError()),
    )
    session = unbound_session
    with pytest.raises(NotFound):
        method(api, session, _make_account(), app_model=_app(), conversation_id="c1")
