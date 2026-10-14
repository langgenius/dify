"""Conversation lists through real Web admission, queries, and SQLite reads."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import timedelta
from http import HTTPStatus
from uuid import uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import update
from werkzeug.test import TestResponse

from constants import HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT
from controllers.web.conversation import ConversationListApi
from graphon.file import File, FileTransferMethod, FileType
from models.enums import ConversationFromSource, CreatorUserRole, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser
from models.utils.file_input_compat import restore_input_files
from models.web import PinnedConversation
from repositories.conversation_repository import ConversationRepository
from services.conversation_query_service import ConversationQueryService
from services.entities.conversation_entities import ConversationSort
from services.message_query_adapters import MessageFileResolver
from tests.unit_tests.controllers.web import test_conversation_rename as rename_tests
from tests.unit_tests.controllers.web.test_conversation_rename import _Harness as RenameHarness
from tests.unit_tests.model_factories import make_conversation

rename_harness = rename_tests.harness


@dataclass(frozen=True)
class _Services:
    conversation_queries: ConversationQueryService


@dataclass(frozen=True)
class _Harness:
    source: RenameHarness
    restored_inputs: list[dict[str, JsonValue | File | list[File]]]

    def get(self, query: Mapping[str, str | int] | None = None) -> TestResponse:
        return self.source.app.test_client().get(
            "/conversations",
            query_string=query,
            headers={HEADER_NAME_APP_CODE: "public-app", HEADER_NAME_PASSPORT: self.source.passport},
        )


@pytest.fixture
def harness(rename_harness: RenameHarness) -> _Harness:
    restored_inputs: list[dict[str, JsonValue | File | list[File]]] = []

    def restore(
        *,
        inputs: Mapping[str, JsonValue | File | list[File]],
        tenant_resolver: Callable[[], str],
    ) -> dict[str, JsonValue | File | list[File]]:
        # Exercise the real restoration, observing its transaction boundary.
        rename_harness.assert_closed()
        restored = restore_input_files(inputs=inputs, tenant_resolver=tenant_resolver)
        restored_inputs.append(restored)
        return restored

    rename_harness.app.extensions["application_services"] = _Services(
        conversation_queries=ConversationQueryService(
            files=MessageFileResolver(),
            conversations=ConversationRepository(session_factory=rename_harness.repository_factory),
            restore_inputs=restore,
        )
    )
    rename_harness.api.add_resource(ConversationListApi, "/conversations")
    return _Harness(rename_harness, restored_inputs)


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_list_preserves_wire_contract_and_restores_inputs_after_session_close(harness: _Harness, mode: AppMode) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    assert response.get_json() == {
        "limit": 20,
        "has_more": False,
        "data": [
            {
                "id": source.conversation.id,
                "name": "Original title",
                "inputs": {"text": "", "list": [], "zero": 0, "flag": False, "null": None},
                "status": "normal",
                "introduction": None,
                "created_at": int(source.conversation.created_at.timestamp()),
                "updated_at": int(source.conversation.updated_at.timestamp()),
            }
        ],
    }
    assert len(harness.restored_inputs) == 1
    assert source.repository_sessions
    source.assert_closed()


@pytest.mark.parametrize("sort_by", ["created_at", "-created_at", "updated_at", "-updated_at"])
def test_sort_and_cursor_return_the_next_page(harness: _Harness, sort_by: ConversationSort) -> None:
    source = harness.source
    newest = make_conversation(
        conversation_id=str(uuid4()),
        app_id=source.target.id,
        from_source=ConversationFromSource.API,
        from_end_user_id=source.end_user.id,
        inputs={},
    )
    newest.created_at = source.conversation.created_at + timedelta(days=1)
    newest.updated_at = source.conversation.updated_at + timedelta(days=1)
    newest.invoke_from = InvokeFrom.WEB_APP
    with source.factory.begin() as session:
        session.add(newest)
    ordered_ids = [source.conversation.id, newest.id]
    if sort_by.startswith("-"):
        ordered_ids.reverse()

    first = harness.get({"sort_by": sort_by, "limit": 1, "last_id": ""})
    assert first.status_code == HTTPStatus.OK
    assert first.get_json()["has_more"] is True
    assert [item["id"] for item in first.get_json()["data"]] == ordered_ids[:1]
    second = harness.get({"sort_by": sort_by, "limit": 1, "last_id": ordered_ids[0]})
    assert second.status_code == HTTPStatus.OK
    assert second.get_json()["has_more"] is False
    assert [item["id"] for item in second.get_json()["data"]] == ordered_ids[1:]
    last = harness.get({"sort_by": sort_by, "last_id": ordered_ids[1]})
    assert last.get_json() == {"limit": 20, "has_more": False, "data": []}
    source.assert_closed()


@pytest.mark.parametrize(
    "field", ["app_id", "from_end_user_id", "from_source", "from_account_id", "is_deleted", "invoke_from"]
)
def test_list_and_cursor_cannot_expose_other_owners_or_invocation_sources(harness: _Harness, field: str) -> None:
    source = harness.source
    value: str | bool
    if field == "is_deleted":
        value = True
    elif field == "from_source":
        value = ConversationFromSource.CONSOLE
    elif field == "invoke_from":
        value = InvokeFrom.SERVICE_API.value
    else:
        value = str(uuid4())
    with source.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == source.conversation.id).values({field: value}))
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"limit": 20, "has_more": False, "data": []}
    cursor = harness.get({"last_id": source.conversation.id})
    assert cursor.status_code == HTTPStatus.NOT_FOUND
    assert cursor.get_json()["code"] == "conversation_cursor_not_found"
    source.assert_closed()


@pytest.mark.parametrize("pinned", [True, False])
def test_pin_filter_is_scoped_to_app_actor_and_role(harness: _Harness, pinned: bool) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.add(
            PinnedConversation(
                app_id=source.target.id,
                conversation_id=source.conversation.id,
                created_by_role=CreatorUserRole.END_USER,
                created_by=source.end_user.id,
            )
        )
    response = harness.get({"pinned": str(pinned).lower()})
    assert response.status_code == HTTPStatus.OK
    assert [item["id"] for item in response.get_json()["data"]] == ([source.conversation.id] if pinned else [])
    source.assert_closed()


@pytest.mark.parametrize("field", ["app_id", "created_by", "created_by_role"])
def test_another_owner_pin_does_not_hide_the_unpinned_conversation(harness: _Harness, field: str) -> None:
    source = harness.source
    pin = PinnedConversation(
        app_id=source.target.id,
        conversation_id=source.conversation.id,
        created_by_role=CreatorUserRole.END_USER,
        created_by=source.end_user.id,
    )
    if field == "created_by_role":
        pin.created_by_role = CreatorUserRole.ACCOUNT
    elif field == "created_by":
        pin.created_by = str(uuid4())
    else:
        pin.app_id = str(uuid4())
    with source.factory.begin() as session:
        session.add(pin)
    response = harness.get({"pinned": "false"})
    assert response.status_code == HTTPStatus.OK
    assert [item["id"] for item in response.get_json()["data"]] == [source.conversation.id]
    # Existing behavior: a requested pinned list with no pins is empty even
    # when a cursor is supplied; it does not first try to resolve that cursor.
    empty = harness.get({"pinned": "true", "last_id": str(uuid4())})
    assert empty.status_code == HTTPStatus.OK
    assert empty.get_json() == {"limit": 20, "has_more": False, "data": []}
    source.assert_closed()


@pytest.mark.parametrize("query", [{"limit": "0"}, {"limit": "101"}, {"last_id": "invalid"}, {"sort_by": "name"}])
def test_invalid_query_preserves_400_before_querying(harness: _Harness, query: dict[str, str]) -> None:
    response = harness.get(query)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert not harness.source.repository_sessions
    harness.source.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_mode_is_rejected_before_querying(harness: _Harness, mode: AppMode) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    assert not source.repository_sessions
    source.assert_closed()


@pytest.mark.parametrize("field", ["tenant_id", "app_id"])
def test_end_user_outside_app_owner_scope_is_rejected(harness: _Harness, field: str) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == source.end_user.id).values({field: str(uuid4())}))
    response = harness.get()
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    source.assert_closed()


def test_remote_file_input_keeps_its_existing_wire_shape(harness: _Harness) -> None:
    source = harness.source
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
    with source.factory.begin() as session:
        conversation = session.get(Conversation, source.conversation.id)
        assert conversation is not None
        conversation.inputs = {"document": file, "documents": [file]}
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["data"][0]["inputs"] == {
        "document": dict(file.to_dict()),
        "documents": [dict(file.to_dict())],
    }
    source.assert_closed()
