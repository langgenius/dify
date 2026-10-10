"""Annotation writes through real Console admission, repositories, and SQLite."""

from decimal import Decimal
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import event, select, text, update
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from constants import COOKIE_NAME_CSRF_TOKEN, HEADER_NAME_CSRF_TOKEN
from controllers.common.rbac import RBAC_CHECKS_ATTR, PlainApp, RBACPermission
from controllers.console.app import annotation as annotation_module
from enums.account import TenantAccountRole
from libs.external_api import ExternalApi
from libs.passport import PassportService
from libs.token import generate_csrf_token
from models import Account, App
from models.account import AccountStatus, TenantAccountJoin
from models.enums import ConversationFromSource
from models.model import AppAnnotationHitHistory, Message, MessageAnnotation
from tests.unit_tests.controllers.console.app import test_annotation_queries
from tests.unit_tests.controllers.console.app.test_annotation_queries import _Harness, _history
from tests.unit_tests.model_factories import make_account, make_app, make_conversation, make_message

query_harness = test_annotation_queries.harness

type _Operation = Literal["create", "update", "delete"]
_OPERATIONS: tuple[_Operation, ...] = ("create", "update", "delete")


@pytest.fixture
def harness(query_harness: _Harness) -> _Harness:
    api = ExternalApi(query_harness.app)
    api.add_resource(
        annotation_module.AnnotationUpdateDeleteApi,
        "/apps/<uuid:app_id>/annotations/<uuid:annotation_id>",
        endpoint="console.annotation_commands",
    )
    return query_harness


def _request(
    harness: _Harness,
    operation: _Operation,
    *,
    payload: dict[str, object] | None = None,
    app_id: str | None = None,
    annotation_id: str | None = None,
    authenticated: bool = True,
    csrf: bool = True,
) -> TestResponse:
    path = f"/apps/{app_id or harness.target.id}/annotations"
    if operation != "create":
        path += f"/{annotation_id or harness.annotation.id}"
    client = harness.app.test_client()
    token = generate_csrf_token(harness.account.id)
    headers = {HEADER_NAME_CSRF_TOKEN: token} if csrf else {}
    if authenticated:
        headers["Authorization"] = f"Bearer {PassportService().issue({'user_id': harness.account.id})}"
    client.set_cookie(COOKIE_NAME_CSRF_TOKEN, token)
    commits: list[Session] = []

    def record_commit(session: Session) -> None:
        commits.append(session)

    event.listen(Session, "before_commit", record_commit)
    try:
        response = client.open(
            path, method="DELETE" if operation == "delete" else "POST", json=payload, headers=headers
        )
    finally:
        event.remove(Session, "before_commit", record_commit)
    assert len(commits) == (1 if response.status_code < 400 else 0)
    assert all(not session.in_transaction() and not session.identity_map for session in harness.sessions)
    if response.status_code == 204:
        assert response.data == b""
    else:
        assert response.headers["Content-Type"] == "application/json"
    return response


def _annotations(harness: _Harness) -> list[MessageAnnotation]:
    with harness.factory() as session:
        return list(session.scalars(select(MessageAnnotation).order_by(MessageAnnotation.id)).all())


def _message(harness: _Harness, *, app_id: str | None = None) -> Message:
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=app_id or harness.target.id,
        inputs={},
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=harness.account.id,
    )
    message = make_message(
        message_id=str(uuid4()),
        app_id=conversation.app_id,
        conversation_id=conversation.id,
        inputs={},
        message={},
        query="Message question",
        answer="Original response",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id=harness.account.id,
    )
    with harness.factory.begin() as session:
        session.add_all([conversation, message])
    return message


@pytest.mark.parametrize(
    ("answer_fields", "expected"),
    [
        ({"answer": "Answer"}, "Answer"),
        ({"content": "Legacy content"}, "Legacy content"),
        ({"answer": "", "content": "Fallback"}, "Fallback"),
        ({"answer": "Answer", "content": "Ignored"}, "Answer"),
        ({"content": ""}, ""),
    ],
)
def test_create_direct_annotation_preserves_answer_fallback_and_response(
    harness: _Harness, answer_fields: dict[str, object], expected: str
) -> None:
    response = _request(harness, "create", payload={"question": "Manual question", **answer_fields})

    assert response.status_code == 201
    body = response.get_json()
    with harness.factory() as session:
        stored = session.get(MessageAnnotation, body["id"])
        assert stored is not None
        assert (stored.app_id, stored.account_id, stored.conversation_id, stored.message_id) == (
            harness.target.id,
            harness.account.id,
            None,
            None,
        )
        assert body == {
            "id": stored.id,
            "question": "Manual question",
            "answer": expected,
            "hit_count": 0,
            "created_at": int(stored.created_at.timestamp()),
        }
        assert stored.question == "Manual question"
        assert stored.content == expected


@pytest.mark.parametrize(
    ("operation", "payload", "message"),
    [
        ("create", {"question": "Question"}, "Either 'answer' or 'content' must be provided"),
        ("create", {"question": "Question", "answer": ""}, "Either 'answer' or 'content' must be provided"),
        ("create", {"answer": "Answer"}, "'question' is required when 'message_id' is not provided"),
        ("create", {"question": "", "answer": "Answer"}, "'question' is required when 'message_id' is not provided"),
        ("update", {"answer": "Answer"}, "'question' is required"),
        ("update", {"question": "Question"}, "'answer' is required"),
        ("update", {"question": "Question", "content": "Ignored"}, "'answer' is required"),
    ],
)
def test_missing_fields_reject_without_writing(
    harness: _Harness, operation: _Operation, payload: dict[str, object], message: str
) -> None:
    response = _request(harness, operation, payload=payload)

    assert response.status_code == 400
    assert response.get_json() == {"code": "invalid_param", "message": message, "status": 400}
    [stored] = _annotations(harness)
    assert (stored.id, stored.question, stored.content) == (harness.annotation.id, "First question", "First answer")


def test_linked_upsert_preserves_message_links_and_original_author(harness: _Harness) -> None:
    message = _message(harness)
    response = _request(harness, "create", payload={"message_id": message.id, "answer": "First annotation"})

    assert response.status_code == 201
    annotation_id = response.get_json()["id"]
    assert response.get_json()["question"] == message.query
    original_author = make_account(account_id=str(uuid4()), email="original@example.com")
    with harness.factory.begin() as session:
        session.add(original_author)
        session.execute(
            update(MessageAnnotation)
            .where(MessageAnnotation.id == annotation_id)
            .values(account_id=original_author.id, hit_count=5)
        )

    response = _request(
        harness, "create", payload={"message_id": message.id, "question": "Override", "answer": "Updated"}
    )

    assert response.status_code == 201
    assert response.get_json()["id"] == annotation_id
    assert response.get_json()["hit_count"] == 5
    rows = _annotations(harness)
    assert len(rows) == 2
    stored = next(row for row in rows if row.id == annotation_id)
    assert (stored.app_id, stored.conversation_id, stored.message_id, stored.account_id) == (
        harness.target.id,
        message.conversation_id,
        message.id,
        original_author.id,
    )
    assert (stored.question, stored.content) == ("Override", "Updated")


def test_linked_upsert_does_not_modify_foreign_app_annotation(harness: _Harness) -> None:
    message = _message(harness)
    other = make_app(app_id=str(uuid4()), tenant_id=harness.target.tenant_id)
    foreign = MessageAnnotation(
        app_id=other.id,
        message_id=message.id,
        question="Other question",
        content="Other answer",
        account_id=harness.account.id,
    )
    with harness.factory.begin() as session:
        session.add_all([other, foreign])

    response = _request(harness, "create", payload={"message_id": message.id, "question": "", "answer": "New answer"})

    assert response.status_code == 201
    assert response.get_json()["id"] != foreign.id
    assert response.get_json()["question"] == message.query
    with harness.factory() as session:
        stored = session.get(MessageAnnotation, foreign.id)
        assert stored is not None
        assert (stored.question, stored.content) == ("Other question", "Other answer")


@pytest.mark.parametrize("missing", [False, True], ids=["other-app", "missing"])
def test_create_requires_message_in_the_admitted_app(harness: _Harness, missing: bool) -> None:
    message_id = str(uuid4())
    if not missing:
        other = make_app(app_id=str(uuid4()), tenant_id=harness.target.tenant_id)
        with harness.factory.begin() as session:
            session.add(other)
        message_id = _message(harness, app_id=other.id).id

    response = _request(harness, "create", payload={"message_id": message_id, "answer": "Answer"})

    assert response.status_code == 404
    assert response.get_json()["message"] == "Message Not Exists."
    assert [row.id for row in _annotations(harness)] == [harness.annotation.id]


@pytest.mark.parametrize(("question", "answer"), [("Updated question", "Updated answer"), ("", "")])
def test_update_accepts_empty_strings_and_ignores_legacy_content(harness: _Harness, question: str, answer: str) -> None:
    response = _request(harness, "update", payload={"question": question, "answer": answer, "content": "Ignored"})

    assert response.status_code == 200
    [stored] = _annotations(harness)
    assert (stored.question, stored.content, stored.account_id) == (question, answer, harness.account.id)
    assert response.get_json() == {
        "id": harness.annotation.id,
        "question": question,
        "answer": answer,
        "hit_count": 3,
        "created_at": int(harness.annotation.created_at.timestamp()),
    }


def test_delete_returns_empty_204_and_removes_only_owned_hit_history(harness: _Harness) -> None:
    owned = _history(harness, index=0)
    other_app = _history(harness, index=1, app_id=str(uuid4()))
    other_annotation = _history(harness, index=2)
    other_annotation.annotation_id = str(uuid4())
    with harness.factory.begin() as session:
        session.add_all([owned, other_app, other_annotation])

    response = _request(harness, "delete")

    assert response.status_code == 204
    assert _annotations(harness) == []
    with harness.factory() as session:
        assert set(session.scalars(select(AppAnnotationHitHistory.id)).all()) == {other_app.id, other_annotation.id}


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize("scope", ["missing", "other_tenant", "disabled"])
def test_writes_require_an_available_app_in_the_admitted_tenant(
    harness: _Harness, operation: _Operation, scope: str
) -> None:
    app_id = harness.target.id
    if scope == "missing":
        app_id = str(uuid4())
    else:
        with harness.factory.begin() as session:
            if scope == "other_tenant":
                session.execute(update(App).where(App.id == app_id).values(tenant_id=str(uuid4())))
            else:
                session.execute(text("UPDATE apps SET status = 'disabled' WHERE id = :app_id"), {"app_id": app_id})

    response = _request(harness, operation, app_id=app_id, payload={"question": "Question", "answer": "Answer"})

    assert response.status_code == 404
    assert response.get_json()["message"] == "App not found"
    [stored] = _annotations(harness)
    assert (stored.question, stored.content) == ("First question", "First answer")


@pytest.mark.parametrize("operation", ["update", "delete"])
@pytest.mark.parametrize("scope", ["missing", "other_app"])
def test_update_and_delete_require_annotation_in_the_admitted_app(
    harness: _Harness, operation: _Operation, scope: str
) -> None:
    annotation_id = str(uuid4())
    if scope == "other_app":
        with harness.factory.begin() as session:
            session.execute(
                update(MessageAnnotation)
                .where(MessageAnnotation.id == harness.annotation.id)
                .values(app_id=str(uuid4()))
            )
        annotation_id = harness.annotation.id

    response = _request(
        harness, operation, annotation_id=annotation_id, payload={"question": "Question", "answer": "Answer"}
    )

    assert response.status_code == 404
    assert response.get_json()["message"] == "Annotation not found"
    [stored] = _annotations(harness)
    assert (stored.question, stored.content) == ("First question", "First answer")


@pytest.mark.parametrize("operation", _OPERATIONS)
@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_write_roles_are_preserved(harness: _Harness, operation: _Operation, role: TenantAccountRole) -> None:
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )

    response = _request(harness, operation, payload={"question": "Question", "answer": "Answer"})

    if TenantAccountRole.is_editing_role(role):
        assert response.status_code == {"create": 201, "update": 200, "delete": 204}[operation]
    else:
        assert response.status_code == 403
        assert response.get_json()["code"] == "forbidden"
        assert [row.id for row in _annotations(harness)] == [harness.annotation.id]


@pytest.mark.parametrize("operation", _OPERATIONS)
def test_writes_require_authentication_csrf_and_initialization(harness: _Harness, operation: _Operation) -> None:
    payload: dict[str, object] = {"question": "Question", "answer": "Answer"}
    for authenticated, csrf in ((False, True), (True, False)):
        response = _request(harness, operation, payload=payload, authenticated=authenticated, csrf=csrf)
        assert response.status_code == 401
        assert response.get_json()["code"] == "unauthorized"
    with harness.factory.begin() as session:
        session.execute(
            update(Account).where(Account.id == harness.account.id).values(status=AccountStatus.UNINITIALIZED)
        )
    response = _request(harness, operation, payload=payload)
    assert response.status_code == 400
    assert response.get_json()["code"] == "account_not_initialized"
    assert [row.id for row in _annotations(harness)] == [harness.annotation.id]


def test_single_annotation_writes_keep_app_edit_rbac_declaration() -> None:
    for view in (
        annotation_module.AnnotationApi.post,
        annotation_module.AnnotationUpdateDeleteApi.post,
        annotation_module.AnnotationUpdateDeleteApi.delete,
    ):
        [check] = getattr(view, RBAC_CHECKS_ATTR)
        assert check.scene == RBACPermission.APP_EDIT
        assert isinstance(check.locator, PlainApp)
