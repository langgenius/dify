"""Rename through real Web admission, application service, and SQLite persistence."""

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from http import HTTPStatus
from typing import Literal
from uuid import uuid4

import pytest
from flask import Flask
from pydantic import JsonValue
from sqlalchemy import Connection, Engine, delete, event, update
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker
from werkzeug.test import TestResponse

from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from controllers.web.conversation import ConversationRenameApi
from enums import DeploymentEdition
from extensions.ext_database import db
from graphon.file import File, FileTransferMethod, FileType
from libs.external_api import ExternalApi
from libs.passport import PassportService
from models.enums import ConversationFromSource, CustomizeTokenStrategy
from models.model import App, AppMode, Conversation, EndUser, Message, Site
from models.provider import Provider
from repositories.conversation_repository import ConversationRepository
from services.conversation_name_generator import generate_conversation_name
from services.conversation_name_service import ConversationNameService
from tests.unit_tests.model_factories import make_app, make_conversation, make_end_user, make_message

_CREATED_AT = datetime(2026, 1, 2, 3, 4, 5)
_UPDATED_AT = datetime(2026, 1, 3, 3, 4, 5)
_INPUTS: dict[str, JsonValue] = {"text": "", "list": [], "zero": 0, "flag": False, "null": None}


@dataclass
class _Services:
    conversation_names: ConversationNameService


@dataclass(frozen=True)
class _Harness:
    app: Flask
    target: App
    end_user: EndUser
    conversation: Conversation
    factory: sessionmaker[Session]
    passport: str
    admission_sessions: list[Session]
    repository_sessions: list[Session]
    provider_sessions: list[Session]

    def post(self, body: dict[str, object]) -> TestResponse:
        return self.app.test_client().post(
            f"/conversations/{self.conversation.id}/name",
            json=body,
            headers={HEADER_NAME_APP_CODE: "public-app", HEADER_NAME_PASSPORT: self.passport},
        )

    def assert_closed(self) -> None:
        sessions = self.admission_sessions + self.repository_sessions + self.provider_sessions
        assert sessions
        assert all(not session.in_transaction() and not session.identity_map for session in sessions)

    def assert_name(self, name: str) -> None:
        with self.factory() as session:
            conversation = session.get(Conversation, self.conversation.id)
            assert conversation is not None
            assert conversation.name == name


@pytest.fixture
def harness(
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> Iterator[_Harness]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, SECRET_KEY="conversation-rename-test-secret-key")
    target = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()))
    end_user = make_end_user(end_user_id=str(uuid4()), tenant_id=target.tenant_id, app_id=target.id)
    site = Site(
        app_id=target.id,
        title="Public app",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code="public-app",
    )
    conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=target.id,
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
        inputs=_INPUTS,
        name="Original title",
    )
    conversation.created_at = _CREATED_AT
    conversation.updated_at = _UPDATED_AT
    message = make_message(
        message_id=str(uuid4()),
        app_id=target.id,
        conversation_id=conversation.id,
        inputs={},
        message={},
        query="How does it work?",
        answer="Like this.",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
        from_end_user_id=end_user.id,
    )
    with sqlite_session_factory.begin() as session:
        # Real provider resolution fails before any plugin or LLM network call.
        provider = Provider(tenant_id=target.tenant_id, provider_name="invalid/provider", is_valid=True)
        session.add_all([target, end_user, site, conversation, message, provider])

    repository_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    admission_sessions: list[Session] = []
    repository_sessions: list[Session] = []
    provider_sessions: list[Session] = []

    def track_admission(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        admission_sessions.append(session)

    def track_repository(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        # Admission and provider lookup must release their transactions before
        # rename starts its own read/write transaction.
        assert all(not item.in_transaction() for item in admission_sessions + provider_sessions)
        repository_sessions.append(session)

    def track_provider(session: Session, _transaction: SessionTransaction, _connection: Connection) -> None:
        assert all(not item.in_transaction() for item in admission_sessions + repository_sessions)
        provider_sessions.append(session)

    event.listen(sqlite_session_factory, "after_begin", track_admission)
    event.listen(repository_factory, "after_begin", track_repository)
    passport = PassportService().issue({"app_code": site.code, "app_id": target.id, "end_user_id": end_user.id})
    app = Flask(__name__)
    app.config.update(TESTING=True, RESTX_ERROR_404_HELP=False, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    event.listen(db.session.session_factory, "after_begin", track_provider)
    app.extensions["application_services"] = _Services(
        ConversationNameService(
            conversations=ConversationRepository(session_factory=repository_factory),
            generate_name=generate_conversation_name,
        )
    )
    api = ExternalApi(app)
    api.add_resource(ConversationRenameApi, "/conversations/<uuid:c_id>/name")
    yield _Harness(
        app,
        target,
        end_user,
        conversation,
        sqlite_session_factory,
        passport,
        admission_sessions,
        repository_sessions,
        provider_sessions,
    )
    event.remove(sqlite_session_factory, "after_begin", track_admission)
    event.remove(repository_factory, "after_begin", track_repository)
    event.remove(db.session.session_factory, "after_begin", track_provider)
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_manual_rename_persists_name_and_preserves_response_contract(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = harness.post({"name": "Manual title"})
    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    body = response.get_json()
    assert body == {
        "id": harness.conversation.id,
        "name": "Manual title",
        "inputs": _INPUTS,
        "status": "normal",
        "introduction": None,
        "created_at": int(_CREATED_AT.timestamp()),
        "updated_at": body["updated_at"],
    }
    assert isinstance(body["updated_at"], int)
    assert body["updated_at"] > int(_UPDATED_AT.timestamp())
    harness.assert_name("Manual title")
    assert harness.repository_sessions
    harness.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_mode_is_rejected_before_repository(harness: _Harness, mode: AppMode) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = harness.post({"name": "Manual title"})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    assert not harness.repository_sessions
    harness.assert_name("Original title")
    harness.assert_closed()


@pytest.mark.parametrize("body", [{}, {"name": None}, {"name": ""}, {"name": "   "}, {"name": []}])
def test_invalid_manual_payload_is_rejected_without_writing(harness: _Harness, body: dict[str, object]) -> None:
    response = harness.post(body)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert not harness.repository_sessions
    harness.assert_name("Original title")
    harness.assert_closed()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("app_id", str(uuid4())),
        ("from_end_user_id", str(uuid4())),
        ("from_source", ConversationFromSource.CONSOLE),
        ("from_account_id", str(uuid4())),
        ("is_deleted", True),
    ],
)
def test_conversation_outside_end_user_scope_is_not_renamed(harness: _Harness, field: str, value: object) -> None:
    with harness.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == harness.conversation.id).values({field: value}))
    response = harness.post({"name": "Manual title"})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    assert response.get_json()["message"] == "The conversation was not found for this user and app."
    harness.assert_name("Original title")
    harness.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "tenant_id"])
def test_end_user_outside_app_owner_scope_is_rejected(harness: _Harness, field: Literal["app_id", "tenant_id"]) -> None:
    with harness.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == harness.end_user.id).values({field: str(uuid4())}))
    response = harness.post({"name": "Manual title"})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    harness.assert_name("Original title")
    harness.assert_closed()


def test_auto_rename_preserves_existing_name_when_real_provider_lookup_fails(
    harness: _Harness, caplog: pytest.LogCaptureFixture
) -> None:
    response = harness.post({"auto_generate": True, "name": "Ignored manual title"})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["name"] == "Original title"
    assert response.get_json()["updated_at"] == int(_UPDATED_AT.timestamp())
    failures = [
        record.exc_info[1]
        for record in caplog.records
        if record.name == "services.conversation_name_service" and record.exc_info is not None
    ]
    assert len(failures) == 1
    assert isinstance(failures[0], ValueError)
    assert str(failures[0]) == "Invalid plugin id invalid/provider"
    harness.assert_name("Original title")
    harness.assert_closed()


def test_auto_rename_without_first_message_returns_specific_not_found(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(delete(Message).where(Message.conversation_id == harness.conversation.id))
    response = harness.post({"auto_generate": True})
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_first_message_not_found"
    assert response.get_json()["message"] == "The conversation has no message from which to generate a name."
    harness.assert_name("Original title")
    harness.assert_closed()


def test_restored_remote_input_file_keeps_existing_wire_shape(harness: _Harness) -> None:
    file = File(
        file_id=str(uuid4()),
        file_type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.REMOTE_URL,
        remote_url="https://example.com/document.pdf",
        filename="document.pdf",
        extension=".pdf",
        mime_type="application/pdf",
        size=12,
    )
    with harness.factory.begin() as session:
        conversation = session.get(Conversation, harness.conversation.id)
        assert conversation is not None
        conversation.inputs = {"document": file}
    response = harness.post({"name": "Manual title"})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["inputs"] == {"document": dict(file.to_dict())}
    harness.assert_name("Manual title")
    harness.assert_closed()


@pytest.mark.parametrize("passport", ["missing", "invalid"])
def test_web_admission_rejects_missing_or_invalid_passport(harness: _Harness, passport: str) -> None:
    headers = {HEADER_NAME_APP_CODE: "public-app"}
    if passport == "invalid":
        headers[HEADER_NAME_PASSPORT] = "invalid-passport"
    response = harness.app.test_client().post(
        f"/conversations/{harness.conversation.id}/name", json={"name": "Manual title"}, headers=headers
    )
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.get_json()["code"] == "unauthorized"
    assert response.get_json()["message"] == ("App token is missing." if passport == "missing" else "Invalid token.")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert not harness.repository_sessions
    harness.assert_name("Original title")


def test_web_admission_rejects_disabled_site_before_rename(harness: _Harness) -> None:
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(enable_site=False))
    response = harness.post({"name": "Manual title"})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["message"] == "Site is disabled."
    assert not harness.repository_sessions
    harness.assert_name("Original title")
    harness.assert_closed()
