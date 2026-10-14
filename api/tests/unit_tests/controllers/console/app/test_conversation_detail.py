"""Console detail reads use real admission, queries, rendering and read receipts."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from http import HTTPStatus
from typing import Literal, cast
from uuid import uuid4

import pytest
from sqlalchemy import Connection, event, select, text, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACCheck, RBACPermission
from controllers.console.app.conversation import ChatConversationDetailApi, CompletionConversationDetailApi
from enums.account import TenantAccountRole
from fields.conversation_fields import ConversationDetail, ConversationMessageDetail, ConversationResponseSource
from libs.datetime_utils import naive_utc_now
from libs.helper import dump_response, to_timestamp
from libs.token import generate_csrf_token
from models import TenantAccountJoin
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import ConversationFromSource, CreatorUserRole, FeedbackFromSource, FeedbackRating
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppMode,
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageFeedback,
)
from models.utils.file_input_compat import restore_input_files
from repositories.conversation_repository import ConversationRepository
from services.conversation_command_service import ConversationCommandService
from services.conversation_query_service import ConversationQueryService
from services.message_query_adapters import MessageFileResolver
from tests.unit_tests.controllers.console.app import test_conversation_delete as delete_tests
from tests.unit_tests.controllers.console.app.test_conversation_delete import _Harness as DeleteHarness
from tests.unit_tests.model_factories import make_account, make_message

type _Kind = Literal["chat", "completion"]
_UPDATED_AT = datetime(2024, 2, 3, 4, 5, 6)
delete_harness = delete_tests.harness


@dataclass(frozen=True)
class _Services:
    conversation_commands: ConversationCommandService
    conversation_queries: ConversationQueryService


@dataclass(frozen=True)
class _Harness:
    source: DeleteHarness

    def get(
        self,
        kind: _Kind,
        *,
        account_id: str | None = None,
        conversation_id: str | None = None,
        authenticated: bool = True,
        csrf: bool = True,
    ) -> TestResponse:
        source = self.source
        client = source.app.test_client()
        actor = account_id or source.account.id
        headers: dict[str, str] = {}
        if authenticated:
            with client.session_transaction() as session:
                session["_user_id"] = actor
                session["_fresh"] = True
            if csrf:
                token = generate_csrf_token(actor)
                client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
                headers[HEADER_NAME_CSRF_TOKEN] = token
        response = client.get(
            f"/apps/{source.target.id}/{kind}-conversations/{conversation_id or source.conversation.id}",
            headers=headers,
        )
        source.assert_closed()
        assert response.content_type == "application/json"
        assert int(response.headers["Content-Length"]) == len(response.data)
        assert not source.cleanups
        return response

    def assert_unread(self) -> None:
        with self.source.factory() as session:
            conversation = session.get_one(Conversation, self.source.conversation.id)
            assert conversation.read_at is None
            assert conversation.read_account_id is None
            assert conversation.updated_at == _UPDATED_AT


@pytest.fixture
def harness(delete_harness: DeleteHarness) -> _Harness:
    previous = cast(delete_tests._Services, delete_harness.app.extensions["application_services"])
    factory = sessionmaker(bind=delete_harness.factory.kw["bind"], expire_on_commit=False)

    @event.listens_for(factory, "after_begin")
    def record_session(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        delete_harness.assert_closed()
        delete_harness.sessions.append(session)

    delete_harness.app.extensions["application_services"] = _Services(
        conversation_commands=previous.conversation_commands,
        conversation_queries=ConversationQueryService(
            conversations=ConversationRepository(session_factory=factory),
            restore_inputs=restore_input_files,
            files=MessageFileResolver(),
        ),
    )
    with delete_harness.factory.begin() as session:
        session.execute(
            update(Conversation)
            .where(Conversation.id == delete_harness.conversation.id)
            .values({Conversation.updated_at: _UPDATED_AT, Conversation.introduction: "Welcome"})
        )
    return _Harness(delete_harness)


def _message(harness: _Harness, *, created_at: datetime = _UPDATED_AT) -> Message:
    source = harness.source
    message = make_message(
        message_id=str(uuid4()),
        app_id=source.target.id,
        conversation_id=source.conversation.id,
        inputs={"empty": "", "zero": 0, "false": False, "null": None, "list": []},
        query="The first question",
        message=[{"role": "user", "text": "The prompt"}],
        answer="The answer",
        message_tokens=7,
        answer_tokens=13,
        provider_response_latency=1.25,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        total_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_account_id=source.account.id,
        created_at=created_at,
        updated_at=created_at,
    )
    message.message_metadata = '{"usage":{"total_tokens":20}}'
    with source.factory.begin() as session:
        session.add(message)
    return message


@pytest.mark.parametrize(
    ("kind", "mode"),
    [
        ("completion", AppMode.COMPLETION),
        ("chat", AppMode.CHAT),
        ("chat", AppMode.AGENT_CHAT),
        ("chat", AppMode.ADVANCED_CHAT),
        ("chat", AppMode.AGENT),
    ],
)
def test_empty_details_keep_response_and_mark_first_read_without_touching_updated_at(
    harness: _Harness, kind: _Kind, mode: AppMode
) -> None:
    source = harness.source
    source.mode(mode)
    with source.factory() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        schema = ConversationMessageDetail if kind == "completion" else ConversationDetail
        expected = dump_response(schema, ConversationResponseSource(stored, session=session))
    before = naive_utc_now()
    response = harness.get(kind)
    after = naive_utc_now()
    assert response.status_code == HTTPStatus.OK, response.get_json()
    assert response.get_json() == expected
    assert "read_at" not in response.get_json()
    if kind == "completion":
        assert response.get_json()["message"] is None
    else:
        assert response.get_json()["message_count"] == 0
        assert response.get_json()["updated_at"] == to_timestamp(_UPDATED_AT)
    with source.factory() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        assert stored.read_at is not None
        assert before <= stored.read_at <= after
        assert stored.read_account_id == source.account.id
        assert stored.updated_at == _UPDATED_AT


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize("scope", ["other_account", "end_user", "soft_deleted"])
def test_management_detail_preserves_app_wide_visibility(harness: _Harness, kind: _Kind, scope: str) -> None:
    source = harness.source
    source.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    with source.factory.begin() as session:
        conversation = session.get_one(Conversation, source.conversation.id)
        if scope == "other_account":
            conversation.from_account_id = str(uuid4())
        elif scope == "end_user":
            conversation.from_source = ConversationFromSource.API
            conversation.from_account_id = None
            conversation.from_end_user_id = str(uuid4())
        else:
            conversation.is_deleted = True
        conversation.updated_at = _UPDATED_AT
    response = harness.get(kind)
    assert response.status_code == HTTPStatus.OK, response.get_json()
    assert response.get_json()["id"] == source.conversation.id
    with source.factory() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        assert stored.is_deleted is (scope == "soft_deleted")
        assert stored.read_account_id == source.account.id


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_second_reader_does_not_replace_first_read_receipt(harness: _Harness, kind: _Kind) -> None:
    source = harness.source
    source.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    assert harness.get(kind).status_code == HTTPStatus.OK
    with source.factory.begin() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        first_read_at = stored.read_at
        second = make_account(account_id=str(uuid4()), name="Second reader")
        session.add_all(
            [
                second,
                TenantAccountJoin(tenant_id=source.tenant.id, account_id=second.id, role=TenantAccountRole.EDITOR),
            ]
        )
    assert harness.get(kind, account_id=second.id).status_code == HTTPStatus.OK
    with source.factory() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        assert stored.read_at == first_read_at
        assert stored.read_account_id == source.account.id
        assert stored.updated_at == _UPDATED_AT


def test_completion_detail_preserves_nested_message_projection(harness: _Harness) -> None:
    source = harness.source
    source.mode(AppMode.COMPLETION)
    first = _message(harness)
    _message(harness, created_at=_UPDATED_AT + timedelta(seconds=1))
    with source.factory.begin() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        stored.override_model_configs = json.dumps({"model": {"name": "fixture-model"}, "pre_prompt": "Be useful"})
        stored.updated_at = _UPDATED_AT
        annotation = MessageAnnotation(
            app_id=source.target.id,
            conversation_id=source.conversation.id,
            message_id=first.id,
            account_id=source.account.id,
            question="Question",
            content="Annotated answer",
        )
        session.add_all(
            [
                annotation,
                MessageFeedback(
                    app_id=source.target.id,
                    conversation_id=source.conversation.id,
                    message_id=first.id,
                    rating=FeedbackRating.LIKE,
                    from_source=FeedbackFromSource.USER,
                    from_account_id=source.account.id,
                    content="Helpful",
                ),
                AppAnnotationHitHistory(
                    app_id=source.target.id,
                    annotation_id=annotation.id,
                    source="annotation",
                    question="Question",
                    account_id=source.account.id,
                    score=0.8,
                    message_id=first.id,
                    annotation_question="Question",
                    annotation_content="Annotated answer",
                ),
                MessageAgentThought(
                    message_id=first.id,
                    position=2,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=source.account.id,
                    thought="Second thought",
                    tool_labels_str="{}",
                ),
                MessageAgentThought(
                    message_id=first.id,
                    position=1,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=source.account.id,
                    thought="First thought",
                    tool="search",
                    tool_labels_str='{"search":"Search"}',
                    message_files='["file-1"]',
                    message_chain_id=str(uuid4()),
                ),
            ]
        )
    with source.app.app_context(), source.factory() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        expected = dump_response(ConversationMessageDetail, ConversationResponseSource(stored, session=session))
    response = harness.get("completion")
    assert response.status_code == HTTPStatus.OK, response.get_json()
    actual = response.get_json()
    assert actual == expected
    message = actual["message"]
    assert message["id"] == first.id
    assert message["inputs"] == {"empty": "", "zero": 0, "false": False, "null": None, "list": []}
    assert message["metadata"] == {"usage": {"total_tokens": 20}}
    assert message["annotation_hit_history"]["annotation_id"] == annotation.id
    assert message["feedbacks"][0]["from_account"]["id"] == source.account.id
    assert [thought["thought"] for thought in message["agent_thoughts"]] == ["First thought", "Second thought"]
    assert message["agent_thoughts"][0]["chain_id"] is not None
    assert message["message_files"] == []


def test_chat_detail_preserves_annotations_and_feedback_counts(harness: _Harness) -> None:
    source = harness.source
    first = _message(harness)
    _message(harness, created_at=_UPDATED_AT + timedelta(seconds=1))
    with source.factory.begin() as session:
        session.add_all(
            [
                MessageAnnotation(
                    app_id=source.target.id,
                    conversation_id=source.conversation.id,
                    message_id=first.id,
                    account_id=source.account.id,
                    question="Question",
                    content="Annotated answer",
                ),
                *[
                    MessageFeedback(
                        app_id=source.target.id,
                        conversation_id=source.conversation.id,
                        message_id=first.id,
                        rating=rating,
                        from_source=feedback_source,
                    )
                    for feedback_source, rating in [
                        (FeedbackFromSource.USER, FeedbackRating.LIKE),
                        (FeedbackFromSource.USER, FeedbackRating.DISLIKE),
                        (FeedbackFromSource.ADMIN, FeedbackRating.LIKE),
                    ]
                ],
            ]
        )
    with source.factory() as session:
        stored = session.get_one(Conversation, source.conversation.id)
        expected = dump_response(ConversationDetail, ConversationResponseSource(stored, session=session))
    response = harness.get("chat")
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == expected
    assert response.get_json()["annotated"] is True
    assert response.get_json()["message_count"] == 2
    assert response.get_json()["user_feedback_stats"] == {"like": 1, "dislike": 1}
    assert response.get_json()["admin_feedback_stats"] == {"like": 1, "dislike": 0}


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize("gate", ["missing", "tenant", "status", "hidden_agent", "mode"])
def test_unavailable_app_cannot_be_read_or_marked(harness: _Harness, kind: _Kind, gate: str) -> None:
    source = harness.source
    source.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    with source.factory.begin() as session:
        app = session.get_one(App, source.target.id)
        if gate == "missing":
            session.delete(app)
        elif gate == "tenant":
            app.tenant_id = str(uuid4())
        elif gate == "status":
            session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :id"), {"id": app.id})
        elif gate == "mode":
            app.mode = AppMode.WORKFLOW
        else:
            app.mode = AppMode.AGENT
            session.add(
                Agent(
                    tenant_id=app.tenant_id,
                    name="Hidden",
                    scope=AgentScope.WORKFLOW_ONLY,
                    source=AgentSource.WORKFLOW,
                    backing_app_id=app.id,
                    status=AgentStatus.ARCHIVED,
                )
            )
    response = harness.get(kind)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "app_not_found"
    harness.assert_unread()


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize("change", ["missing", "other_app"])
def test_missing_or_other_app_conversation_does_not_mark_existing_row(
    harness: _Harness, kind: _Kind, change: str
) -> None:
    source = harness.source
    source.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    conversation_id = str(uuid4()) if change == "missing" else source.conversation.id
    if change == "other_app":
        with source.factory.begin() as session:
            session.execute(
                update(Conversation)
                .where(Conversation.id == conversation_id)
                .values({Conversation.app_id: str(uuid4()), Conversation.updated_at: _UPDATED_AT})
            )
    response = harness.get(kind, conversation_id=conversation_id)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    harness.assert_unread()


@pytest.mark.parametrize("kind", ["chat", "completion"])
@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_detail_preserves_edit_roles(harness: _Harness, kind: _Kind, role: TenantAccountRole) -> None:
    source = harness.source
    source.mode(AppMode.COMPLETION if kind == "completion" else AppMode.CHAT)
    with source.factory.begin() as session:
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == source.account.id))
        assert membership is not None
        membership.role = role
    response = harness.get(kind)
    if TenantAccountRole.is_editing_role(role):
        assert response.status_code == HTTPStatus.OK
    else:
        assert response.status_code == HTTPStatus.FORBIDDEN
        harness.assert_unread()


@pytest.mark.parametrize("kind", ["chat", "completion"])
def test_detail_requires_login_and_csrf(harness: _Harness, kind: _Kind) -> None:
    assert harness.get(kind, authenticated=False).status_code == HTTPStatus.UNAUTHORIZED
    assert harness.get(kind, csrf=False).status_code == HTTPStatus.UNAUTHORIZED
    harness.assert_unread()


@pytest.mark.parametrize("handler", [ChatConversationDetailApi.get, CompletionConversationDetailApi.get])
def test_detail_declares_app_view_layout(handler: Callable[..., object]) -> None:
    checks: tuple[RBACCheck, ...] = vars(handler)[RBAC_CHECKS_ATTR]
    assert len(checks) == 1
    assert checks[0].scene == RBACPermission.APP_VIEW_LAYOUT
    assert isinstance(checks[0].locator, PlainApp)
    assert checks[0].locator.param == "app_id"


@pytest.mark.parametrize("failure", ["metadata", "thought_files"])
def test_failed_message_rendering_does_not_mark_conversation_read(harness: _Harness, failure: str) -> None:
    source = harness.source
    source.mode(AppMode.COMPLETION)
    message = _message(harness)
    with source.factory.begin() as session:
        if failure == "metadata":
            stored = session.get_one(Message, message.id)
            stored.message_metadata = "invalid-json"
        else:
            session.add(
                MessageAgentThought(
                    message_id=message.id,
                    position=1,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=source.account.id,
                    message_files='[{"not":"a file id"}]',
                    tool_labels_str="{}",
                )
            )
    response = harness.get("completion")
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    harness.assert_unread()
