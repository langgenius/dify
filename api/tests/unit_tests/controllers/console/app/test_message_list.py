"""Console message lists through real HTTP admission, services and SQLite."""

import json
from collections.abc import Iterator
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select, update
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.app.message import AgentChatMessageListApi, AgentMessageApi, ChatMessageListApi, MessageApi
from core.workflow.nodes.human_input.entities import FormDefinition, UserActionConfig
from enums.account import TenantAccountRole
from graphon.file import FileTransferMethod, FileType
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models.account import TenantAccountJoin
from models.agent import Agent, AgentScope
from models.enums import ConversationFromSource, CreatorUserRole, FeedbackFromSource, FeedbackRating
from models.execution_extra_content import HumanInputContent
from models.human_input import HumanInputForm
from models.model import (
    App,
    AppAnnotationHitHistory,
    AppMode,
    Conversation,
    Message,
    MessageAgentThought,
    MessageAnnotation,
    MessageFeedback,
    MessageFile,
)
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import _Harness
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import (
    harness as installed_app_harness,
)
from tests.unit_tests.controllers.console.test_message_feedback import _admin_route
from tests.unit_tests.model_factories import make_message

__all__ = ["installed_app_harness"]

_CREATED_AT = datetime(2024, 1, 1)


@pytest.fixture
def harness(installed_app_harness: _Harness) -> Iterator[_Harness]:
    state = installed_app_harness
    api = ExternalApi(state.app)
    api.add_resource(ChatMessageListApi, "/apps/<uuid:app_id>/chat-messages", endpoint="console.app_messages")
    api.add_resource(AgentChatMessageListApi, "/agent/<uuid:agent_id>/chat-messages", endpoint="console.agent_messages")
    api.add_resource(MessageApi, "/apps/<uuid:app_id>/messages/<uuid:message_id>", endpoint="console.app_message")
    api.add_resource(
        AgentMessageApi, "/agent/<uuid:agent_id>/messages/<uuid:message_id>", endpoint="console.agent_message"
    )
    with state.factory.begin() as session:
        session.execute(update(Message).where(Message.id == state.message.id).values(created_at=_CREATED_AT))
    yield state
    if state.sessions:
        state.assert_closed()


def _route(state: _Harness, kind: Literal["app", "agent"] = "app", *, scope: AgentScope = AgentScope.ROSTER) -> str:
    return _admin_route(state, kind, scope=scope).removesuffix("/feedbacks") + "/chat-messages"


def _get(
    state: _Harness,
    route: str,
    *,
    conversation_id: str | None = None,
    query: str = "",
    authenticated: bool = True,
    csrf: bool = True,
) -> TestResponse:
    client = state.app.test_client()
    token = generate_csrf_token(state.account.id)
    headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
    if authenticated:
        headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': state.account.id})}"
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    response = client.get(
        f"{route}?conversation_id={state.conversation.id if conversation_id is None else conversation_id}&{query}",
        headers=headers,
    )
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    return response


def _error(response: TestResponse, *, status: int, code: str) -> None:
    assert response.status_code == status
    body = response.get_json()
    assert body["status"] == status
    assert body["code"] == code
    assert body["message"]


def _older_message(state: _Harness, *, age: int) -> Message:
    message = make_message(
        message_id=str(uuid4()),
        app_id=state.target.id,
        conversation_id=state.conversation.id,
        inputs={"zero": 0, "disabled": False, "null": None, "empty": []},
        query="Hello",
        message={"text": "Hello"},
        answer="你好",
        message_tokens=2,
        answer_tokens=3,
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        total_price=Decimal(0),
        provider_response_latency=0,
        currency="USD",
        status="normal",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=state.account.id,
        created_at=_CREATED_AT - timedelta(minutes=age),
    )
    with state.factory.begin() as session:
        session.add(message)
    return message


def _add_extra_content(state: _Harness, message_id: str) -> HumanInputForm:
    expiration = datetime(2027, 1, 1)
    definition = FormDefinition(
        form_content="Approve?",
        inputs=[],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="Approve?",
        expiration_time=expiration,
        node_title="Approval",
        display_in_ui=True,
    )
    form = HumanInputForm(
        tenant_id=state.target.tenant_id,
        app_id=state.target.id,
        workflow_run_id=str(uuid4()),
        node_id="approval",
        form_definition=definition.model_dump_json(),
        rendered_content="Approve?",
        expiration_time=expiration,
    )
    with state.factory.begin() as session:
        app = session.get(App, state.target.id)
        assert app is not None
        form.tenant_id = app.tenant_id
        session.add(form)
        session.flush()
        session.add(
            HumanInputContent.new(workflow_run_id=form.workflow_run_id or "", form_id=form.id, message_id=message_id)
        )
    return form


@pytest.mark.parametrize("kind", ["app", "agent"])
def test_list_preserves_complete_response_and_older_page_order(
    harness: _Harness, kind: Literal["app", "agent"]
) -> None:
    route = _route(harness, kind)
    oldest = _older_message(harness, age=2)
    middle = _older_message(harness, age=1)
    form = _add_extra_content(harness, middle.id)
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == middle.id).values(message_metadata=json.dumps({"zero": 0})))
        annotation = MessageAnnotation(
            app_id=harness.target.id,
            conversation_id=harness.conversation.id,
            message_id=middle.id,
            question="Question",
            content="Answer",
            account_id=harness.account.id,
        )
        session.add(annotation)
        session.flush()
        attachment = MessageFile(
            message_id=middle.id,
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.REMOTE_URL,
            url="https://example.com/photo.png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=harness.account.id,
        )
        session.add_all(
            [
                attachment,
                MessageFeedback(
                    app_id=harness.target.id,
                    conversation_id=harness.conversation.id,
                    message_id=middle.id,
                    rating=FeedbackRating.LIKE,
                    from_source=FeedbackFromSource.ADMIN,
                    from_account_id=harness.account.id,
                    content="Useful",
                ),
                AppAnnotationHitHistory(
                    app_id=harness.target.id,
                    annotation_id=annotation.id,
                    source="annotation",
                    question="Question",
                    account_id=harness.account.id,
                    score=0.5,
                    message_id=middle.id,
                    annotation_question="Question",
                    annotation_content="Answer",
                ),
                MessageAgentThought(
                    message_id=middle.id,
                    position=1,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by=harness.account.id,
                    thought="Consider the request",
                    tool_labels_str="{}",
                    tool_meta_str="{}",
                ),
            ]
        )
    response = _get(harness, route, query="limit=2")
    assert response.status_code == 200
    body = response.get_json()
    assert body["limit"] == 2
    assert body["has_more"] is True
    assert [item["id"] for item in body["data"]] == [middle.id, harness.message.id]
    item = body["data"][0]
    assert item["inputs"] == {"zero": 0, "disabled": False, "null": None, "empty": []}
    assert item["query"] == "Hello"
    assert item["message"] == {"text": "Hello"}
    assert item["answer"] == "你好"
    assert item["metadata"] == {"zero": 0}
    assert item["message_tokens"] == 2
    assert item["answer_tokens"] == 3
    assert item["created_at"] == int((_CREATED_AT - timedelta(minutes=1)).timestamp())
    assert item["feedbacks"][0]["from_account"] == {
        "id": harness.account.id,
        "name": harness.account.name,
        "email": harness.account.email,
    }
    assert item["feedbacks"][0]["content"] == "Useful"
    assert item["annotation"]["id"] == annotation.id
    assert item["annotation"]["account"]["id"] == harness.account.id
    assert item["annotation_hit_history"]["annotation_id"] == annotation.id
    assert item["annotation_hit_history"]["annotation_create_account"]["id"] == harness.account.id
    assert item["agent_thoughts"][0]["thought"] == "Consider the request"
    assert item["message_files"][0]["id"] == attachment.id
    assert item["message_files"][0]["url"] == "https://example.com/photo.png"
    assert item["extra_contents"][0]["workflow_run_id"] == form.workflow_run_id
    assert item["extra_contents"][0]["submitted"] is False
    detail_route = route.removesuffix("/chat-messages") + f"/messages/{middle.id}"
    detail = _get(harness, detail_route)
    assert detail.status_code == 200
    assert detail.get_json() == item
    response = _get(harness, route, query=f"limit=2&first_id={middle.id}")
    assert response.status_code == 200
    assert response.get_json()["has_more"] is False
    assert [item["id"] for item in response.get_json()["data"]] == [oldest.id]
    harness.assert_closed()


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("missing", ["login", "csrf"])
def test_list_requires_real_login_and_csrf(harness: _Harness, kind: Literal["app", "agent"], missing: str) -> None:
    response = _get(harness, _route(harness, kind), authenticated=missing != "login", csrf=missing != "csrf")
    _error(response, status=401, code="unauthorized")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


@pytest.mark.parametrize("role", list(TenantAccountRole))
@pytest.mark.parametrize("kind", ["app", "agent"])
def test_list_preserves_edit_permission(
    harness: _Harness, role: TenantAccountRole, kind: Literal["app", "agent"]
) -> None:
    route = _route(harness, kind)
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )
    response = _get(harness, route)
    if role in {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR}:
        assert response.status_code == 200
    else:
        _error(response, status=403, code="forbidden")


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
@pytest.mark.parametrize("owner", ["account", "end_user", "deleted"])
def test_plain_console_retains_app_wide_conversation_access(harness: _Harness, mode: AppMode, owner: str) -> None:
    route = _route(harness)
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
        values = {"is_deleted": True} if owner == "deleted" else {"from_account_id": str(uuid4())}
        if owner == "end_user":
            values = {
                "from_account_id": None,
                "from_end_user_id": str(uuid4()),
                "from_source": ConversationFromSource.API,
            }
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values(**values))
    response = _get(harness, route)
    assert response.status_code == 200
    assert response.get_json()["data"][0]["id"] == harness.message.id


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("owner", ["app_id", "from_account_id", "from_source", "from_end_user_id", "is_deleted"])
def test_agent_app_mode_requires_owned_conversation(
    harness: _Harness, kind: Literal["app", "agent"], owner: str
) -> None:
    route = _route(harness, "agent")
    if kind == "app":
        route = f"/apps/{harness.target.id}/chat-messages"
    value = True if owner == "is_deleted" else ConversationFromSource.API if owner == "from_source" else str(uuid4())
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values({owner: value}))
    _error(_get(harness, route), status=404, code="not_found")


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "limit=invalid", "first_id=invalid"])
def test_invalid_queries_use_shared_422(harness: _Harness, query: str) -> None:
    _error(_get(harness, _route(harness), query=query), status=422, code="unprocessable_entity")


def test_missing_conversation_and_foreign_cursor_keep_precise_errors(harness: _Harness) -> None:
    route = _route(harness)
    response = _get(harness, route, conversation_id=str(uuid4()))
    _error(response, status=404, code="not_found")
    assert response.get_json()["message"] == "Conversation Not Exists."
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values(conversation_id=str(uuid4())))
    response = _get(harness, route, query=f"first_id={harness.message.id}")
    _error(response, status=404, code="not_found")
    assert response.get_json()["message"] == "First message not found"


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_plain_console_rejects_non_chat_modes(harness: _Harness, mode: AppMode) -> None:
    route = _route(harness)
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    _error(_get(harness, route), status=404, code="app_not_found")


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
def test_agent_runtime_resolution_stays_read_only(harness: _Harness, scope: AgentScope) -> None:
    route = _route(harness, "agent", scope=scope)
    assert _get(harness, route).status_code == 200
    if scope == AgentScope.WORKFLOW_ONLY:
        _error(_get(harness, f"/apps/{harness.target.id}/chat-messages"), status=404, code="app_not_found")
        with harness.factory.begin() as session:
            session.execute(update(Agent).values(backing_app_id=None))
            app_count = session.scalar(select(func.count()).select_from(App))
        _error(_get(harness, route), status=404, code="agent_not_found_error")
        with harness.factory() as session:
            assert session.scalar(select(func.count()).select_from(App)) == app_count
            assert session.scalar(select(Agent.backing_app_id)) is None


def test_empty_conversation_returns_default_envelope(harness: _Harness) -> None:
    route = _route(harness)
    with harness.factory.begin() as session:
        session.execute(delete(Message).where(Message.id == harness.message.id))
    response = _get(harness, route, query="first_id=")
    assert response.status_code == 200
    assert response.get_json() == {"limit": 20, "has_more": False, "data": []}
