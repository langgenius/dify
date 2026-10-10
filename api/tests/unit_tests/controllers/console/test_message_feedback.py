"""Feedback HTTP writes through real Console admission, application services and SQLite."""

from collections.abc import Iterator
from http import HTTPStatus
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, func, select, update
from sqlalchemy.orm import Session, SessionTransaction
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.console.app.message import AgentMessageFeedbackApi, MessageFeedbackApi
from controllers.console.explore.message import MessageFeedbackApi as InstalledMessageFeedbackApi
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, InstalledApp, Message, MessageFeedback
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import _Harness
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import (
    harness as installed_app_harness,
)

__all__ = ["installed_app_harness"]


@pytest.fixture
def harness(installed_app_harness: _Harness) -> Iterator[_Harness]:
    state = installed_app_harness
    api = ExternalApi(state.app)
    api.add_resource(MessageFeedbackApi, "/apps/<uuid:app_id>/feedbacks", endpoint="console.app_feedback")
    api.add_resource(AgentMessageFeedbackApi, "/agent/<uuid:agent_id>/feedbacks", endpoint="console.agent_feedback")
    api.add_resource(
        InstalledMessageFeedbackApi,
        "/installed-apps/<uuid:installed_app_id>/messages/<uuid:message_id>/feedbacks",
        endpoint="console.installed_feedback",
    )
    yield state
    if state.sessions:
        state.assert_closed()
    with state.factory() as session:
        installation = session.get(InstalledApp, state.installation.id)
        if installation is not None:
            assert installation.last_used_at is None


def _post(
    state: _Harness,
    *,
    body: dict[str, object],
    route: str | None = None,
    installation_id: str | None = None,
    message_id: str | None = None,
    authenticated: bool = True,
    csrf: bool = True,
) -> TestResponse:
    client = state.app.test_client()
    token = generate_csrf_token(state.account.id)
    headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
    if authenticated:
        headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': state.account.id})}"
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    if route is None:
        route = (
            f"/installed-apps/{installation_id or state.installation.id}"
            f"/messages/{message_id or state.message.id}/feedbacks"
        )
    else:
        body = {"message_id": message_id or state.message.id, **body}
    return client.post(route, headers=headers, json=body)


def _success(response: TestResponse) -> None:
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"result": "success"}
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)


def _error(response: TestResponse, *, status: HTTPStatus, code: str) -> None:
    assert response.status_code == status
    assert response.headers["Content-Type"] == "application/json"
    assert int(response.headers["Content-Length"]) == len(response.data)
    payload = response.get_json()
    assert payload["status"] == status
    assert payload["code"] == code
    assert payload["message"]


def _admin_route(state: _Harness, kind: Literal["app", "agent"], *, scope: AgentScope = AgentScope.ROSTER) -> str:
    """Make the admitted account an app owner while retaining a distinct installation fixture."""
    with state.factory.begin() as session:
        session.execute(update(App).where(App.id == state.target.id).values(tenant_id=state.installation.tenant_id))
        if kind == "agent":
            agent_id = str(uuid4())
            session.execute(update(App).where(App.id == state.target.id).values(mode=AppMode.AGENT))
            session.add(
                Agent(
                    id=agent_id,
                    tenant_id=state.installation.tenant_id,
                    name="Feedback agent",
                    scope=scope,
                    source=AgentSource.AGENT_APP if scope == AgentScope.ROSTER else AgentSource.WORKFLOW,
                    status=AgentStatus.ACTIVE,
                    app_id=state.target.id if scope == AgentScope.ROSTER else str(uuid4()),
                    backing_app_id=state.target.id if scope == AgentScope.WORKFLOW_ONLY else None,
                    workflow_id=str(uuid4()) if scope == AgentScope.WORKFLOW_ONLY else None,
                    workflow_node_id="node" if scope == AgentScope.WORKFLOW_ONLY else None,
                )
            )
            return f"/agent/{agent_id}/feedbacks"
    return f"/apps/{state.target.id}/feedbacks"


def test_explore_feedback_create_update_revoke_with_cross_workspace_app(harness: _Harness) -> None:
    assert harness.target.tenant_id != harness.installation.tenant_id
    feedback_id: str | None = None
    for rating, content in (("like", ""), ("dislike", "Changed my mind")):
        _success(_post(harness, body={"rating": rating, "content": content}))
        with harness.factory() as session:
            rows = session.scalars(select(MessageFeedback)).all()
            assert len(rows) == 1
            feedback = rows[0]
            assert feedback_id is None or feedback.id == feedback_id
            feedback_id = feedback.id
            assert feedback.app_id == harness.target.id
            assert feedback.message_id == harness.message.id
            assert feedback.conversation_id == harness.conversation.id
            assert feedback.rating.value == rating
            assert feedback.content == content
            assert feedback.from_source == FeedbackFromSource.ADMIN
            assert feedback.from_account_id == harness.account.id
            assert feedback.from_end_user_id is None
    _success(_post(harness, body={"rating": None}))
    with harness.factory() as session:
        assert session.scalars(select(MessageFeedback)).all() == []


@pytest.mark.parametrize("owner", ["app_id", "from_account_id", "from_source", "from_end_user_id", "missing"])
def test_explore_requires_complete_message_ownership(harness: _Harness, owner: str) -> None:
    with harness.factory.begin() as session:
        if owner == "missing":
            session.execute(delete(Message).where(Message.id == harness.message.id))
        else:
            value = ConversationFromSource.API if owner == "from_source" else str(uuid4())
            session.execute(update(Message).where(Message.id == harness.message.id).values({owner: value}))
    _error(_post(harness, body={"rating": "like"}), status=HTTPStatus.NOT_FOUND, code="message_not_found")
    with harness.factory() as session:
        assert session.scalars(select(MessageFeedback)).all() == []


@pytest.mark.parametrize("mode", list(AppMode))
def test_explore_feedback_accepts_all_app_modes(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    _success(_post(harness, body={"rating": "like"}))


@pytest.mark.parametrize("admission", ["missing", "workspace", "app"])
def test_explore_rejects_unavailable_installation(harness: _Harness, admission: str) -> None:
    with harness.factory.begin() as session:
        if admission == "workspace":
            session.execute(
                update(InstalledApp).where(InstalledApp.id == harness.installation.id).values(tenant_id=str(uuid4()))
            )
        elif admission == "app":
            session.execute(delete(App).where(App.id == harness.target.id))
    _error(
        _post(harness, body={"rating": "like"}, installation_id=str(uuid4()) if admission == "missing" else None),
        status=HTTPStatus.NOT_FOUND,
        code="installed_app_not_found",
    )


def test_installation_removed_after_admission_cannot_receive_feedback(harness: _Harness) -> None:
    def remove_installation(_session: Session, _transaction: SessionTransaction) -> None:
        with harness.factory.begin() as session:
            session.execute(delete(InstalledApp).where(InstalledApp.id == harness.installation.id))

    event.listen(harness.admission_factory, "after_transaction_end", remove_installation, once=True)
    try:
        response = _post(harness, body={"rating": "like"})
    finally:
        event.remove(harness.admission_factory, "after_transaction_end", remove_installation)
    _error(response, status=HTTPStatus.NOT_FOUND, code="installed_app_not_found")
    with harness.factory() as session:
        assert session.scalars(select(MessageFeedback)).all() == []


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("owner", ["another_account", "end_user"])
def test_admin_can_rate_other_actors_messages_in_the_admitted_app(
    harness: _Harness, kind: Literal["app", "agent"], owner: str
) -> None:
    route = _admin_route(harness, kind)
    with harness.factory.begin() as session:
        message = session.get(Message, harness.message.id)
        assert message is not None
        message.from_account_id = str(uuid4()) if owner == "another_account" else None
        message.from_end_user_id = str(uuid4()) if owner == "end_user" else None
        message.from_source = ConversationFromSource.API if owner == "end_user" else ConversationFromSource.CONSOLE
        session.add(
            MessageFeedback(
                app_id=message.app_id,
                conversation_id=message.conversation_id,
                message_id=message.id,
                rating=FeedbackRating.LIKE,
                from_source=FeedbackFromSource.USER,
                from_end_user_id=message.from_end_user_id,
                content="User feedback stays separate",
            )
        )
    for rating, content in (("like", ""), ("dislike", None)):
        _success(_post(harness, route=route, body={"rating": rating, "content": content}))
        with harness.factory() as session:
            feedback = session.scalar(
                select(MessageFeedback).where(MessageFeedback.from_source == FeedbackFromSource.ADMIN)
            )
            assert feedback is not None
            assert feedback.rating.value == rating
            assert feedback.content == content
            assert feedback.from_account_id == harness.account.id
            assert feedback.from_end_user_id is None
    _success(_post(harness, route=route, body={"rating": None}))
    with harness.factory() as session:
        rows = session.scalars(select(MessageFeedback)).all()
        assert len(rows) == 1
        assert rows[0].from_source == FeedbackFromSource.USER
        assert rows[0].content == "User feedback stays separate"


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
def test_agent_feedback_resolves_existing_runtime_app(harness: _Harness, scope: AgentScope) -> None:
    route = _admin_route(harness, "agent", scope=scope)
    _success(_post(harness, route=route, body={"rating": "like"}))


def test_agent_feedback_does_not_create_a_missing_hidden_runtime_app(harness: _Harness) -> None:
    route = _admin_route(harness, "agent", scope=AgentScope.WORKFLOW_ONLY)
    with harness.factory.begin() as session:
        session.execute(update(Agent).values(backing_app_id=None))
        app_count = session.scalar(select(func.count()).select_from(App))
    _error(
        _post(harness, route=route, body={"rating": "like"}), status=HTTPStatus.NOT_FOUND, code="agent_not_found_error"
    )
    with harness.factory() as session:
        assert session.scalar(select(func.count()).select_from(App)) == app_count
        assert session.scalar(select(Agent.backing_app_id)) is None


def test_plain_app_feedback_cannot_address_an_agents_hidden_runtime_app(harness: _Harness) -> None:
    _admin_route(harness, "agent", scope=AgentScope.WORKFLOW_ONLY)
    _error(
        _post(harness, route=f"/apps/{harness.target.id}/feedbacks", body={"rating": "like"}),
        status=HTTPStatus.NOT_FOUND,
        code="app_not_found",
    )


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("missing", ["message", "message_app", "app_workspace", "app"])
def test_admin_feedback_still_requires_the_admitted_app(
    harness: _Harness, kind: Literal["app", "agent"], missing: str
) -> None:
    route = _admin_route(harness, kind)
    with harness.factory.begin() as session:
        if missing == "message":
            session.execute(delete(Message).where(Message.id == harness.message.id))
        elif missing == "message_app":
            session.execute(update(Message).where(Message.id == harness.message.id).values(app_id=str(uuid4())))
        elif missing == "app_workspace":
            session.execute(update(App).where(App.id == harness.target.id).values(tenant_id=str(uuid4())))
        else:
            session.execute(delete(App).where(App.id == harness.target.id))
    code = (
        "not_found" if missing.startswith("message") else "app_not_found" if kind == "app" else "agent_not_found_error"
    )
    _error(_post(harness, route=route, body={"rating": "like"}), status=HTTPStatus.NOT_FOUND, code=code)
    with harness.factory() as session:
        assert session.scalars(select(MessageFeedback)).all() == []


@pytest.mark.parametrize("kind", ["explore", "app", "agent"])
@pytest.mark.parametrize("body", [{"rating": "invalid"}, {"content": 123}])
def test_invalid_feedback_payload_is_rejected(harness: _Harness, kind: str, body: dict[str, object]) -> None:
    route = None if kind == "explore" else _admin_route(harness, "app" if kind == "app" else "agent")
    _error(_post(harness, route=route, body=body), status=HTTPStatus.UNPROCESSABLE_ENTITY, code="unprocessable_entity")


@pytest.mark.parametrize("kind", ["explore", "app", "agent"])
def test_revoke_without_feedback_has_specific_error(harness: _Harness, kind: str) -> None:
    route = None if kind == "explore" else _admin_route(harness, "app" if kind == "app" else "agent")
    _error(
        _post(harness, route=route, body={"rating": None}),
        status=HTTPStatus.BAD_REQUEST,
        code="message_feedback_rating_required",
    )


@pytest.mark.parametrize("kind", ["explore", "app", "agent"])
@pytest.mark.parametrize("missing", ["login", "csrf"])
def test_feedback_requires_real_login_and_csrf(harness: _Harness, kind: str, missing: str) -> None:
    route = None if kind == "explore" else _admin_route(harness, "app" if kind == "app" else "agent")
    response = _post(
        harness, route=route, body={"rating": "like"}, authenticated=missing != "login", csrf=missing != "csrf"
    )
    _error(response, status=HTTPStatus.UNAUTHORIZED, code="unauthorized")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
