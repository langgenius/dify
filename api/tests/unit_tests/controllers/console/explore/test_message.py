"""Explore message lists through real HTTP admission, services and SQLite."""

from collections.abc import Iterator
from uuid import uuid4

import pytest
from sqlalchemy import delete, event, update
from sqlalchemy.orm import Session, SessionTransaction

from controllers.console.explore.message import MessageListApi
from libs.external_api import ExternalApi
from models import Account
from models.enums import ConversationFromSource, FeedbackFromSource, FeedbackRating
from models.model import App, AppMode, Conversation, InstalledApp, Message, MessageFeedback
from tests.unit_tests.controllers.console.app.test_message_list import (
    _CREATED_AT,
    _add_extra_content,
    _error,
    _get,
    _older_message,
)
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import _Harness
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import (
    harness as installed_app_harness,
)

__all__ = ["installed_app_harness"]


@pytest.fixture
def harness(installed_app_harness: _Harness) -> Iterator[_Harness]:
    state = installed_app_harness
    api = ExternalApi(state.app)
    api.add_resource(MessageListApi, "/installed-apps/<uuid:installed_app_id>/messages", endpoint="console.messages")
    with state.factory.begin() as session:
        session.execute(update(Message).where(Message.id == state.message.id).values(created_at=_CREATED_AT))
    yield state
    if state.sessions:
        state.assert_closed()
    with state.factory() as session:
        installation = session.get(InstalledApp, state.installation.id)
        if installation is not None:
            assert installation.last_used_at is None


def _route(state: _Harness) -> str:
    return f"/installed-apps/{state.installation.id}/messages"


def test_list_preserves_response_and_fetches_older_messages_in_display_order(harness: _Harness) -> None:
    assert harness.target.tenant_id != harness.installation.tenant_id
    oldest = _older_message(harness, age=2)
    middle = _older_message(harness, age=1)
    form = _add_extra_content(harness, middle.id)
    with harness.factory.begin() as session:
        session.add_all(
            [
                MessageFeedback(
                    app_id=harness.target.id,
                    conversation_id=harness.conversation.id,
                    message_id=middle.id,
                    rating=rating,
                    from_source=source,
                )
                for rating, source in (
                    (FeedbackRating.LIKE, FeedbackFromSource.ADMIN),
                    (FeedbackRating.DISLIKE, FeedbackFromSource.USER),
                )
            ]
        )
    response = _get(harness, _route(harness), query="limit=2")
    assert response.status_code == 200
    body = response.get_json()
    assert body["limit"] == 2
    assert body["has_more"] is True
    assert [item["id"] for item in body["data"]] == [middle.id, harness.message.id]
    item = body["data"][0]
    assert item["inputs"] == {"zero": 0, "disabled": False, "null": None, "empty": []}
    assert item["feedback"] == {"rating": "dislike"}
    assert item["total_tokens"] == 5
    assert item["total_price"] == "0E-7"
    assert item["currency"] == "USD"
    assert item["extra_contents"][0]["workflow_run_id"] == form.workflow_run_id
    assert item["extra_contents"][0]["submitted"] is False
    assert item["extra_contents"][0]["form_submission_data"] is None
    response = _get(harness, _route(harness), query=f"limit=2&first_id={middle.id}")
    assert response.status_code == 200
    assert response.get_json()["has_more"] is False
    assert [item["id"] for item in response.get_json()["data"]] == [oldest.id]
    harness.assert_closed()


@pytest.mark.parametrize("empty_id", [False, True])
def test_empty_list_keeps_defaults(harness: _Harness, empty_id: bool) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Message).where(Message.id == harness.message.id))
    response = _get(harness, _route(harness), conversation_id="" if empty_id else None)
    assert response.status_code == 200
    assert response.get_json() == {"limit": 20, "has_more": False, "data": []}


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "limit=invalid", "first_id=invalid"])
def test_invalid_query_uses_shared_422(harness: _Harness, query: str) -> None:
    _error(_get(harness, _route(harness), query=query), status=422, code="unprocessable_entity")


@pytest.mark.parametrize(
    "owner", ["app_id", "from_account_id", "from_source", "from_end_user_id", "is_deleted", "missing"]
)
def test_list_requires_complete_conversation_ownership(harness: _Harness, owner: str) -> None:
    with harness.factory.begin() as session:
        if owner == "missing":
            session.execute(delete(Conversation).where(Conversation.id == harness.conversation.id))
        else:
            value = (
                True
                if owner == "is_deleted"
                else ConversationFromSource.API
                if owner == "from_source"
                else str(uuid4())
            )
            session.execute(
                update(Conversation).where(Conversation.id == harness.conversation.id).values({owner: value})
            )
    _error(_get(harness, _route(harness)), status=404, code="conversation_not_found")


def test_list_rejects_cursor_from_another_conversation(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Message).where(Message.id == harness.message.id).values(conversation_id=str(uuid4())))
    _error(
        _get(harness, _route(harness), query=f"first_id={harness.message.id}"),
        status=404,
        code="message_cursor_not_found",
    )


@pytest.mark.parametrize("missing", ["installation", "workspace", "app"])
def test_list_applies_installed_app_admission(harness: _Harness, missing: str) -> None:
    with harness.factory.begin() as session:
        if missing == "installation":
            session.execute(delete(InstalledApp).where(InstalledApp.id == harness.installation.id))
        elif missing == "workspace":
            session.execute(
                update(InstalledApp).where(InstalledApp.id == harness.installation.id).values(tenant_id=str(uuid4()))
            )
        else:
            session.execute(delete(App).where(App.id == harness.target.id))
    _error(_get(harness, _route(harness)), status=404, code="installed_app_not_found")


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.AGENT])
def test_non_chat_modes_have_specific_error(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    _error(_get(harness, _route(harness)), status=400, code="not_chat_app")


@pytest.mark.parametrize("missing", ["login", "csrf"])
def test_login_and_csrf_are_required(harness: _Harness, missing: str) -> None:
    response = _get(harness, _route(harness), authenticated=missing != "login", csrf=missing != "csrf")
    _error(response, status=401, code="unauthorized")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


@pytest.mark.parametrize("change", ["installation", "app", "owner", "account"])
def test_stale_admitted_resource_is_revalidated(harness: _Harness, change: str) -> None:
    def change_resource(_session: Session, _transaction: SessionTransaction) -> None:
        with harness.factory.begin() as session:
            if change == "installation":
                session.execute(delete(InstalledApp).where(InstalledApp.id == harness.installation.id))
            elif change == "account":
                session.execute(delete(Account).where(Account.id == harness.account.id))
            elif change == "app":
                session.execute(delete(App).where(App.id == harness.target.id))
            else:
                session.execute(update(App).where(App.id == harness.target.id).values(tenant_id=str(uuid4())))

    event.listen(harness.admission_factory, "after_transaction_end", change_resource, once=True)
    try:
        response = _get(harness, _route(harness))
    finally:
        event.remove(harness.admission_factory, "after_transaction_end", change_resource)
    status, code = (401, "unauthorized") if change == "account" else (404, "installed_app_not_found")
    _error(response, status=status, code=code)
