"""Conversation commands through real Web admission and SQLite transactions."""

from dataclasses import dataclass
from http import HTTPStatus
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.orm import Session
from werkzeug.test import TestResponse

from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from controllers.web.conversation import ConversationApi, ConversationPinApi, ConversationUnPinApi
from models.agent import AgentWorkingResourceStatus, AgentWorkspace, AgentWorkspaceOwnerType
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, AppMode, Conversation, EndUser
from models.web import PinnedConversation
from repositories.conversation_repository import ConversationRepository
from services.conversation_command_service import ConversationCommandService
from tests.unit_tests.controllers.web import test_conversation_rename as rename_tests
from tests.unit_tests.controllers.web.test_conversation_rename import _Harness as RenameHarness

rename_harness = rename_tests.harness


@dataclass(frozen=True)
class _Services:
    conversation_commands: ConversationCommandService


@dataclass(frozen=True)
class _Harness:
    source: RenameHarness
    cleanups: list[tuple[str, str, tuple[str, ...]]]

    def request(self, action: str, *, conversation_id: str | None = None) -> TestResponse:
        path = f"/conversations/{conversation_id or self.source.conversation.id}"
        return self.source.app.test_client().open(
            path if action == "delete" else f"{path}/{action}",
            method="DELETE" if action == "delete" else "PATCH",
            headers={HEADER_NAME_APP_CODE: "public-app", HEADER_NAME_PASSPORT: self.source.passport},
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
        # Observe the real external boundary: committed state must be visible on
        # another connection, with neither admission nor command transactions open.
        rename_harness.assert_closed()
        with rename_harness.factory() as session:
            stored = session.get(Conversation, conversation_id)
            assert stored is not None
            assert stored.is_deleted
            for workspace_id in retired_workspace_ids:
                workspace = session.get(AgentWorkspace, workspace_id)
                assert workspace is not None
                assert workspace.status == AgentWorkingResourceStatus.RETIRED
                assert workspace.active_guard is None
                assert workspace.retired_at is not None
        cleanups.append((tenant_id, conversation_id, retired_workspace_ids))

    rename_harness.app.extensions["application_services"] = _Services(
        conversation_commands=ConversationCommandService(
            conversations=ConversationRepository(session_factory=rename_harness.repository_factory),
            enqueue_delete_cleanup=enqueue_cleanup,
        )
    )
    rename_harness.api.add_resource(ConversationApi, "/conversations/<uuid:c_id>")
    rename_harness.api.add_resource(ConversationPinApi, "/conversations/<uuid:c_id>/pin")
    rename_harness.api.add_resource(ConversationUnPinApi, "/conversations/<uuid:c_id>/unpin")
    return _Harness(rename_harness, cleanups)


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_delete_commits_retirement_before_cleanup_and_returns_empty_204(harness: _Harness, mode: AppMode) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))
        workspace = AgentWorkspace(
            id=str(uuid4()),
            tenant_id=source.target.tenant_id,
            app_id=source.target.id,
            owner_type=AgentWorkspaceOwnerType.CONVERSATION,
            owner_id=source.conversation.id,
            owner_scope_key="chatflow-node",
            backend_workspace_ref="backend-workspace",
            status=AgentWorkingResourceStatus.ACTIVE,
            active_guard=1,
        )
        session.add(workspace)

    response = harness.request("delete")

    assert response.status_code == HTTPStatus.NO_CONTENT
    assert response.data == b""
    assert response.headers["Content-Type"] == "application/json"
    assert harness.cleanups == [(source.target.tenant_id, source.conversation.id, (workspace.id,))]
    assert source.repository_sessions
    source.assert_closed()

    repeated = harness.request("delete")
    assert repeated.status_code == HTTPStatus.NOT_FOUND
    assert repeated.json is not None
    assert repeated.json["code"] == "conversation_not_found"
    assert len(harness.cleanups) == 1
    source.assert_closed()


@pytest.mark.parametrize("action", ["delete", "pin"])
@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_source", "from_account_id", "is_deleted"])
def test_commands_cannot_target_conversations_outside_end_user_scope(
    harness: _Harness, action: str, field: str
) -> None:
    source = harness.source
    value: str | bool
    if field == "is_deleted":
        value = True
    elif field == "from_source":
        value = ConversationFromSource.CONSOLE
    elif field == "from_account_id":
        # Account and EndUser IDs are independent namespaces, even if equal.
        value = source.end_user.id
    else:
        value = str(uuid4())
    with source.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == source.conversation.id).values({field: value}))

    response = harness.request(action)

    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.json is not None
    assert response.json["code"] == "conversation_not_found"
    assert harness.cleanups == []
    with source.factory() as session:
        stored = session.get(Conversation, source.conversation.id)
        assert stored is not None
        assert stored.is_deleted is (field == "is_deleted")
        assert session.scalars(select(PinnedConversation)).all() == []
    source.assert_closed()


@pytest.mark.parametrize("action", ["delete", "pin", "unpin"])
@pytest.mark.parametrize("field", ["tenant_id", "app_id"])
def test_commands_reject_end_user_outside_app_owner_scope(
    harness: _Harness, action: str, field: Literal["tenant_id", "app_id"]
) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == source.end_user.id).values({field: str(uuid4())}))
    response = harness.request(action)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.json is not None
    assert response.json["code"] == "conversation_not_found"
    harness.assert_not_deleted()
    source.assert_closed()


def test_pin_and_unpin_are_idempotent_and_isolate_actor_role(harness: _Harness) -> None:
    source = harness.source
    with source.factory.begin() as session:
        other_pins = [
            PinnedConversation(
                app_id=source.target.id,
                conversation_id=source.conversation.id,
                created_by_role=role,
                created_by=actor_id,
            )
            for role, actor_id in [
                (CreatorUserRole.ACCOUNT, source.end_user.id),
                (CreatorUserRole.END_USER, str(uuid4())),
            ]
        ]
        session.add_all(other_pins)

    for _ in range(2):
        response = harness.request("pin")
        assert response.status_code == HTTPStatus.OK
        assert response.headers["Content-Type"] == "application/json"
        assert response.json is not None
        assert response.json == {"result": "success"}
        source.assert_closed()
    with source.factory() as session:
        pins = session.scalars(select(PinnedConversation)).all()
        own_pins = [
            pin
            for pin in pins
            if pin.created_by_role == CreatorUserRole.END_USER and pin.created_by == source.end_user.id
        ]
        assert len(pins) == 3
        assert len(own_pins) == 1
        assert own_pins[0].app_id == source.target.id
        assert own_pins[0].conversation_id == source.conversation.id

    for _ in range(2):
        response = harness.request("unpin")
        assert response.status_code == HTTPStatus.OK
        assert response.json is not None
        assert response.json == {"result": "success"}
        source.assert_closed()
    with source.factory() as session:
        assert set(session.scalars(select(PinnedConversation.id))) == {pin.id for pin in other_pins}
    harness.assert_not_deleted()


@pytest.mark.parametrize("action", ["delete", "pin", "unpin"])
def test_unknown_conversation_preserves_existing_decoy(harness: _Harness, action: str) -> None:
    response = harness.request(action, conversation_id=str(uuid4()))
    if action == "unpin":
        assert response.status_code == HTTPStatus.OK
        assert response.json is not None
        assert response.json == {"result": "success"}
    else:
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.json is not None
        assert response.json["code"] == "conversation_not_found"
    harness.assert_not_deleted()
    harness.source.assert_closed()


@pytest.mark.parametrize("action", ["delete", "pin", "unpin"])
@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_mode_is_rejected_before_command_transaction(harness: _Harness, action: str, mode: AppMode) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))
    response = harness.request(action)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.json is not None
    assert response.json["code"] == "not_chat_app"
    assert source.repository_sessions == []
    harness.assert_not_deleted()
    source.assert_closed()


def test_failed_delete_commit_rolls_back_without_publishing_cleanup(harness: _Harness) -> None:
    def reject_commit(_session: Session) -> None:
        raise RuntimeError("Database commit failed")

    source = harness.source
    event.listen(source.repository_factory, "before_commit", reject_commit)
    try:
        response = harness.request("delete")
    finally:
        event.remove(source.repository_factory, "before_commit", reject_commit)
    assert response.status_code == HTTPStatus.INTERNAL_SERVER_ERROR
    harness.assert_not_deleted()
    source.assert_closed()
