"""Delete contracts using real API tokens, EndUser admission, and SQLite writes."""

from dataclasses import dataclass
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.orm import Session, SessionTransaction
from werkzeug.test import TestResponse

from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.service_api.app.conversation import ConversationDetailApi
from machinery.context import RequestContext
from models import Tenant, TenantStatus
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, EndUser
from models.resource_access_token import ResourceAccessToken
from repositories.conversation_repository import ConversationRepository
from services.auth.resource_access_token_contracts import ResourceAccessTokenResource
from services.conversation_command_service import ConversationCommandService
from tests.unit_tests.controllers.service_api.app import test_conversation_rename as rename_tests
from tests.unit_tests.controllers.service_api.app.test_conversation_rename import _Harness as RenameHarness
from tests.unit_tests.controllers.service_api.app.test_conversation_rename import _Services as RenameServices
from tests.unit_tests.model_factories import make_app

rename_harness = rename_tests.harness


@dataclass(frozen=True)
class _Services(RenameServices):
    conversation_commands: ConversationCommandService


@dataclass(frozen=True)
class _Harness:
    source: RenameHarness
    cleanups: list[tuple[str, str, tuple[str, ...]]]

    def delete(
        self,
        *,
        conversation_id: str | None = None,
        user: str | None = "alice",
        authorization: str | None = "Bearer rename-token",
        requested_app_id: str | None = None,
    ) -> TestResponse:
        headers = {"Authorization": authorization} if authorization is not None else {}
        if requested_app_id is not None:
            headers["X-Dify-App-ID"] = requested_app_id
        return self.source.app.test_client().delete(
            f"/conversations/{conversation_id or self.source.conversation.id}",
            json={"user": user} if user is not None else {},
            headers=headers,
        )

    def assert_not_deleted(self) -> None:
        with self.source.factory() as session:
            stored = session.get(Conversation, self.source.conversation.id)
            assert stored is not None
            assert not stored.is_deleted
        assert self.cleanups == []


@pytest.fixture
def harness(rename_harness: RenameHarness) -> _Harness:
    cleanups: list[tuple[str, str, tuple[str, ...]]] = []

    def enqueue_cleanup(*, tenant_id: str, conversation_id: str, retired_workspace_ids: tuple[str, ...]) -> None:
        rename_harness.assert_closed()
        with rename_harness.factory() as session:
            stored = session.get(Conversation, conversation_id)
            assert stored is not None
            assert stored.is_deleted
        cleanups.append((tenant_id, conversation_id, retired_workspace_ids))

    original = rename_harness.app.extensions["application_services"]
    assert isinstance(original, RenameServices)
    rename_harness.app.extensions["application_services"] = _Services(
        app_definitions=original.app_definitions,
        app_scoped_end_users=original.app_scoped_end_users,
        conversation_names=original.conversation_names,
        resource_access_tokens=original.resource_access_tokens,
        conversation_commands=ConversationCommandService(
            conversations=ConversationRepository(session_factory=rename_harness.repository_factory),
            enqueue_delete_cleanup=enqueue_cleanup,
        ),
    )
    rename_harness.api.add_resource(ConversationDetailApi, "/conversations/<uuid:conversation_id>")
    return _Harness(rename_harness, cleanups)


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_delete_commits_before_cleanup_after_admission_connections_close(harness: _Harness, mode: AppMode) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))

    response = harness.delete()

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""
    assert response.headers["Content-Type"] == "application/json"
    assert harness.cleanups == [(source.tenant.id, source.conversation.id, ())]
    assert source.admissions
    assert source.provisions
    assert source.queries
    assert source.scoped_sessions == []
    source.assert_closed()

    repeated = harness.delete()
    assert repeated.status_code == HTTPStatus.NOT_FOUND
    assert repeated.json is not None
    assert repeated.json["code"] == "conversation_not_found"
    assert len(harness.cleanups) == 1
    source.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_source", "from_account_id", "is_deleted"])
def test_delete_rejects_conversation_outside_end_user_scope(harness: _Harness, field: str) -> None:
    source = harness.source
    value: str | bool
    if field == "is_deleted":
        value = True
    elif field == "from_source":
        value = ConversationFromSource.CONSOLE
    elif field == "from_account_id":
        value = source.end_user.id
    else:
        value = str(uuid4())
    with source.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == source.conversation.id).values({field: value}))

    response = harness.delete()

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.json is not None
    assert response.json == {
        "code": "conversation_not_found",
        "message": "The conversation was not found for this user and app.",
        "status": HTTPStatus.NOT_FOUND,
    }
    assert harness.cleanups == []
    with source.factory() as session:
        stored = session.get(Conversation, source.conversation.id)
        assert stored is not None
        assert stored.is_deleted is (field == "is_deleted")
    source.assert_closed()


@pytest.mark.parametrize("change_app_too", [False, True], ids=["end-user-workspace", "app-workspace"])
def test_workspace_change_after_admission_prevents_delete(harness: _Harness, change_app_too: bool) -> None:
    source = harness.source

    def change_owner(_session: Session, _transaction: SessionTransaction) -> None:
        with source.factory.begin() as session:
            end_user = session.get(EndUser, source.end_user.id)
            assert end_user is not None
            end_user.tenant_id = str(uuid4())
            if change_app_too:
                target = session.get(App, source.target.id)
                assert target is not None
                target.tenant_id = end_user.tenant_id

    event.listen(source.provision_factory, "after_transaction_end", change_owner, once=True)
    try:
        response = harness.delete()
    finally:
        event.remove(source.provision_factory, "after_transaction_end", change_owner)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.json is not None
    assert response.json["code"] == "conversation_not_found"
    harness.assert_not_deleted()
    source.assert_closed()


def test_unknown_conversation_cannot_delete_existing_decoy(harness: _Harness) -> None:
    response = harness.delete(conversation_id=str(uuid4()))
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.json is not None
    assert response.json["code"] == "conversation_not_found"
    harness.assert_not_deleted()
    harness.source.assert_closed()


@pytest.mark.parametrize("user", [None, ""])
def test_anonymous_user_cannot_delete_identified_users_conversation(harness: _Harness, user: str | None) -> None:
    response = harness.delete(user=user)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.json is not None
    assert response.json["code"] == "conversation_not_found"
    with harness.source.factory() as session:
        end_users = session.scalars(select(EndUser)).all()
        assert len(end_users) == 2
        assert len([user for user in end_users if user.id != harness.source.end_user.id]) == 1
    harness.assert_not_deleted()
    harness.source.assert_closed()


@pytest.mark.parametrize("authorization", [None, "Basic rename-token", "Bearer invalid-token"])
def test_invalid_token_is_rejected_before_admission(harness: _Harness, authorization: str | None) -> None:
    source = harness.source
    response = harness.delete(authorization=authorization)
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert response.json is not None
    assert response.json["code"] == "unauthorized"
    assert source.admissions == source.provisions == source.queries == []
    harness.assert_not_deleted()
    source.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_mode_is_rejected_before_delete(harness: _Harness, mode: AppMode) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))
    response = harness.delete()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json is not None
    assert response.json["code"] == "not_chat_app"
    assert source.queries == []
    harness.assert_not_deleted()
    source.assert_closed()


@pytest.mark.parametrize(
    ("failure", "code"), [("disabled_api", "app_api_disabled"), ("archived_workspace", "workspace_archived")]
)
def test_disabled_app_or_workspace_is_rejected_before_provisioning(harness: _Harness, failure: str, code: str) -> None:
    source = harness.source
    with source.factory.begin() as session:
        if failure == "disabled_api":
            session.execute(update(App).where(App.id == source.target.id).values(enable_api=False))
        else:
            session.execute(update(Tenant).where(Tenant.id == source.tenant.id).values(status=TenantStatus.ARCHIVE))
    response = harness.delete(user="new-user")
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.json is not None
    assert response.json["code"] == code
    assert source.provisions == source.queries == []
    with source.factory() as session:
        assert session.scalars(select(EndUser.id)).all() == [source.end_user.id]
    harness.assert_not_deleted()
    source.assert_closed()


@pytest.mark.parametrize("multiple_apps", [False, True], ids=["implicit-single-app", "explicit-multiple-apps"])
def test_resource_token_deletes_bound_app_and_records_usage(harness: _Harness, multiple_apps: bool) -> None:
    source = harness.source
    app_ids = (source.target.id,)
    if multiple_apps:
        other = make_app(app_id=str(uuid4()), tenant_id=source.tenant.id)
        with source.factory.begin() as session:
            session.add(other)
        app_ids = (other.id, source.target.id)
    services = source.app.extensions["application_services"]
    assert isinstance(services, _Services)
    token = services.resource_access_tokens.create(
        RequestContext(
            request_id="delete-resource-token",
            trace_id=None,
            account_id=str(uuid4()),
            active_workspace_id=source.tenant.id,
        ),
        name="Delete app token",
        resources=tuple(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app_id) for app_id in app_ids),
    )

    response = harness.delete(
        authorization=f"Bearer {token.token}",
        requested_app_id=source.target.id if multiple_apps else None,
    )

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""
    assert harness.cleanups == [(source.tenant.id, source.conversation.id, ())]
    source.assert_closed()
    with source.factory() as session:
        stored_token = session.get(ResourceAccessToken, token.token_id)
        assert stored_token is not None
        assert stored_token.last_used_at is not None
        assert session.scalars(select(EndUser.id)).all() == [source.end_user.id]


def test_failed_delete_commit_rolls_back_without_publishing_cleanup(harness: _Harness) -> None:
    def reject_commit(_session: Session) -> None:
        raise RuntimeError("Database commit failed")

    source = harness.source
    event.listen(source.repository_factory, "before_commit", reject_commit)
    try:
        response = harness.delete()
    finally:
        event.remove(source.repository_factory, "before_commit", reject_commit)
    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    harness.assert_not_deleted()
    source.assert_closed()
