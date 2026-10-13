"""List contracts with real token admission, shared queries, and SQLite."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import timedelta
from http import HTTPStatus
from uuid import uuid4

import pytest
from sqlalchemy import event, select, update
from sqlalchemy.orm import Session, SessionTransaction
from werkzeug.test import TestResponse

from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.service_api.app.conversation import ConversationApi
from machinery.context import RequestContext
from models import Tenant, TenantStatus
from models.enums import ConversationFromSource, InvokeFrom
from models.model import App, AppMode, Conversation, EndUser
from models.resource_access_token import ResourceAccessToken
from models.utils.file_input_compat import restore_input_files
from repositories.conversation_repository import ConversationRepository
from services.auth.resource_access_token_contracts import ResourceAccessTokenResource
from services.conversation_query_service import ConversationQueryService
from services.entities.conversation_entities import ConversationSort
from tests.unit_tests.controllers.service_api.app import test_conversation_rename as rename_tests
from tests.unit_tests.controllers.service_api.app.test_conversation_rename import _Harness as RenameHarness
from tests.unit_tests.controllers.service_api.app.test_conversation_rename import _Services as RenameServices
from tests.unit_tests.model_factories import make_app, make_conversation

rename_harness = rename_tests.harness


@dataclass(frozen=True)
class _Services(RenameServices):
    conversation_queries: ConversationQueryService


@dataclass(frozen=True)
class _Harness:
    source: RenameHarness

    def get(
        self,
        query: Mapping[str, str | int] | None = None,
        *,
        user: str | None = "alice",
        authorization: str | None = "Bearer rename-token",
        requested_app_id: str | None = None,
    ) -> TestResponse:
        headers = {"Authorization": authorization} if authorization is not None else {}
        if requested_app_id is not None:
            headers["X-Dify-App-ID"] = requested_app_id
        args = dict(query or {})
        if user is not None:
            args["user"] = user
        return self.source.app.test_client().get("/conversations", query_string=args, headers=headers)


@pytest.fixture
def harness(rename_harness: RenameHarness) -> _Harness:
    original = rename_harness.app.extensions["application_services"]
    assert isinstance(original, RenameServices)
    rename_harness.app.extensions["application_services"] = _Services(
        app_definitions=original.app_definitions,
        app_scoped_end_users=original.app_scoped_end_users,
        conversation_names=original.conversation_names,
        resource_access_tokens=original.resource_access_tokens,
        conversation_queries=ConversationQueryService(
            conversations=ConversationRepository(session_factory=rename_harness.repository_factory),
            restore_inputs=restore_input_files,
        ),
    )
    rename_harness.api.add_resource(ConversationApi, "/conversations")
    return _Harness(rename_harness)


@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT])
def test_list_preserves_wire_contract_and_closes_admission_before_query(harness: _Harness, mode: AppMode) -> None:
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
                "name": "Original name",
                "inputs": {"text": "", "list": [], "zero": 0, "flag": False, "null": None},
                "status": "normal",
                "introduction": None,
                "created_at": int(source.conversation.created_at.timestamp()),
                "updated_at": int(source.conversation.updated_at.timestamp()),
            }
        ],
    }
    assert source.admissions
    assert source.provisions
    assert source.queries
    assert source.scoped_sessions == []
    source.assert_closed()


@pytest.mark.parametrize("sort_by", ["created_at", "-created_at", "updated_at", "-updated_at"])
def test_sort_cursor_and_empty_last_id_follow_existing_contract(harness: _Harness, sort_by: ConversationSort) -> None:
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
    newest.invoke_from = InvokeFrom.SERVICE_API
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
    source.assert_closed()


@pytest.mark.parametrize(
    "field", ["app_id", "from_end_user_id", "from_source", "from_account_id", "is_deleted", "invoke_from"]
)
def test_list_and_cursor_do_not_cross_user_app_or_invocation_scope(harness: _Harness, field: str) -> None:
    source = harness.source
    value: str | bool
    if field == "is_deleted":
        value = True
    elif field == "from_source":
        value = ConversationFromSource.CONSOLE
    elif field == "invoke_from":
        value = InvokeFrom.WEB_APP.value
    else:
        value = str(uuid4())
    with source.factory.begin() as session:
        session.execute(update(Conversation).where(Conversation.id == source.conversation.id).values({field: value}))
    response = harness.get()
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"limit": 20, "has_more": False, "data": []}
    cursor = harness.get({"last_id": source.conversation.id})
    assert cursor.status_code == HTTPStatus.NOT_FOUND
    assert cursor.get_json() == {
        "code": "conversation_cursor_not_found",
        "message": "The conversation cursor is not in the current list. Refresh the list and try again.",
        "status": HTTPStatus.NOT_FOUND,
    }
    source.assert_closed()


@pytest.mark.parametrize("query", [{"limit": "0"}, {"limit": "101"}, {"last_id": "invalid"}, {"sort_by": "name"}])
def test_invalid_query_returns_422_before_querying(harness: _Harness, query: dict[str, str]) -> None:
    response = harness.get(query)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert harness.source.queries == []
    harness.source.assert_closed()


@pytest.mark.parametrize("user", [None, "", "another-user"])
def test_new_or_anonymous_user_receives_empty_list(harness: _Harness, user: str | None) -> None:
    response = harness.get(user=user)
    assert response.status_code == HTTPStatus.OK
    assert response.get_json() == {"limit": 20, "has_more": False, "data": []}
    with harness.source.factory() as session:
        assert len(session.scalars(select(EndUser)).all()) == 2
    harness.source.assert_closed()


@pytest.mark.parametrize("authorization", [None, "Basic rename-token", "Bearer invalid-token"])
def test_invalid_token_preserves_authentication_error_and_header(harness: _Harness, authorization: str | None) -> None:
    source = harness.source
    response = harness.get(authorization=authorization)
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert response.get_json()["code"] == "unauthorized"
    assert source.admissions == source.provisions == source.queries == []
    source.assert_closed()


@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW])
def test_non_chat_mode_is_rejected_before_querying(harness: _Harness, mode: AppMode) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))
    response = harness.get()
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    assert source.queries == []
    source.assert_closed()


@pytest.mark.parametrize("change_app_too", [False, True], ids=["end-user-workspace", "app-workspace"])
def test_workspace_change_after_admission_prevents_list(harness: _Harness, change_app_too: bool) -> None:
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
        response = harness.get()
    finally:
        event.remove(source.provision_factory, "after_transaction_end", change_owner)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
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
    response = harness.get(user="new-user")
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == code
    assert source.provisions == source.queries == []
    source.assert_closed()


@pytest.mark.parametrize("multiple_apps", [False, True], ids=["implicit-single-app", "explicit-multiple-apps"])
def test_resource_token_lists_bound_app_and_records_usage(harness: _Harness, multiple_apps: bool) -> None:
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
            request_id="list-resource-token",
            trace_id=None,
            account_id=str(uuid4()),
            active_workspace_id=source.tenant.id,
        ),
        name="List app token",
        resources=tuple(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app_id) for app_id in app_ids),
    )
    response = harness.get(
        authorization=f"Bearer {token.token}",
        requested_app_id=source.target.id if multiple_apps else None,
    )
    assert response.status_code == HTTPStatus.OK
    assert [item["id"] for item in response.get_json()["data"]] == [source.conversation.id]
    source.assert_closed()
    with source.factory() as session:
        stored_token = session.get(ResourceAccessToken, token.token_id)
        assert stored_token is not None
        assert stored_token.last_used_at is not None
        assert session.scalars(select(EndUser.id)).all() == [source.end_user.id]
