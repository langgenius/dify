"""Conversation-variable HTTP contracts through real admission, services, and SQLite."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from http import HTTPStatus
from uuid import UUID, uuid4

import pytest
from pydantic import JsonValue
from sqlalchemy import event, select, update
from sqlalchemy.orm import Session, SessionTransaction
from werkzeug.test import TestResponse

from configs import dify_config
from constants.resource_access_token import ResourceAccessTokenResourceType
from controllers.service_api.app.conversation import ConversationVariableDetailApi, ConversationVariablesApi
from factories import variable_factory
from machinery.context import RequestContext
from models import Tenant, TenantStatus
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, EndUser
from models.resource_access_token import ResourceAccessToken
from models.workflow import ConversationVariable
from repositories.conversation_variable_repository import ConversationVariableRepository
from services.auth.resource_access_token_contracts import ResourceAccessTokenResource
from services.conversation_variable_command_service import ConversationVariableCommandService
from tests.unit_tests.controllers.service_api.app import test_conversation_rename as rename_tests
from tests.unit_tests.controllers.service_api.app.test_conversation_rename import _Harness as RenameHarness
from tests.unit_tests.controllers.service_api.app.test_conversation_rename import _Services as RenameServices
from tests.unit_tests.model_factories import make_app, make_conversation

rename_harness = rename_tests.harness
_CREATED_AT = datetime(2026, 1, 2, 3, 4, 5)
_UPDATED_AT = datetime(2026, 1, 3, 3, 4, 5)


@dataclass(frozen=True)
class _Services(RenameServices):
    conversation_variables: ConversationVariableRepository
    conversation_variable_commands: ConversationVariableCommandService


@dataclass(frozen=True)
class _Harness:
    source: RenameHarness
    row: ConversationVariable

    def request(
        self,
        method: str,
        *,
        body: Mapping[str, JsonValue] | None = None,
        query: Mapping[str, str | int] | None = None,
        conversation_id: str | None = None,
        variable_id: str | None = None,
        user: str | None = "alice",
        authorization: str | None = "Bearer rename-token",
        requested_app_id: str | None = None,
    ) -> TestResponse:
        headers = {"Authorization": authorization} if authorization is not None else {}
        if requested_app_id is not None:
            headers["X-Dify-App-ID"] = requested_app_id
        url = f"/conversations/{conversation_id or self.source.conversation.id}/variables"
        if method == "PUT":
            url += f"/{variable_id or self.row.id}"
            payload = dict(body) if body is not None else {"value": "Updated"}
            if user is not None:
                payload["user"] = user
            return self.source.app.test_client().put(url, json=payload, headers=headers)
        params = dict(query or {})
        if user is not None:
            params["user"] = user
        return self.source.app.test_client().get(url, query_string=params, headers=headers)

    def add_variable(
        self,
        name: str,
        *,
        value_type: str = "string",
        value: JsonValue = "Original",
        app_id: str | None = None,
        conversation_id: str | None = None,
        offset: int = 0,
    ) -> ConversationVariable:
        row = _variable(
            self.source,
            name=name,
            value_type=value_type,
            value=value,
            app_id=app_id,
            conversation_id=conversation_id,
            offset=offset,
        )
        with self.source.factory.begin() as session:
            session.add(row)
        return row

    def assert_unchanged(self) -> None:
        with self.source.factory() as session:
            row = session.get(ConversationVariable, (self.row.id, self.row.conversation_id))
            assert row is not None
            assert row.data == self.row.data
            assert row.updated_at == self.row.updated_at


def _variable(
    source: RenameHarness,
    *,
    name: str,
    value_type: str,
    value: JsonValue,
    app_id: str | None = None,
    conversation_id: str | None = None,
    offset: int = 0,
) -> ConversationVariable:
    variable = variable_factory.build_conversation_variable_from_mapping(
        {
            "id": f"draft-{name}",
            "name": name,
            "description": "Saved variable description",
            "value_type": value_type,
            "value": value,
        }
    )
    row = ConversationVariable.from_variable(
        app_id=app_id or source.target.id,
        conversation_id=conversation_id or source.conversation.id,
        variable=variable,
    )
    row.created_at = _CREATED_AT + timedelta(seconds=offset)
    row.updated_at = _UPDATED_AT
    return row


@pytest.fixture
def harness(rename_harness: RenameHarness) -> _Harness:
    original = rename_harness.app.extensions["application_services"]
    assert isinstance(original, RenameServices)
    repository = ConversationVariableRepository(session_factory=rename_harness.repository_factory)
    rename_harness.app.extensions["application_services"] = _Services(
        app_definitions=original.app_definitions,
        app_scoped_end_users=original.app_scoped_end_users,
        conversation_names=original.conversation_names,
        resource_access_tokens=original.resource_access_tokens,
        conversation_variables=repository,
        conversation_variable_commands=ConversationVariableCommandService(variables=repository),
    )
    rename_harness.api.add_resource(ConversationVariablesApi, "/conversations/<uuid:conversation_id>/variables")
    rename_harness.api.add_resource(
        ConversationVariableDetailApi, "/conversations/<uuid:conversation_id>/variables/<uuid:variable_id>"
    )
    row = _variable(rename_harness, name="greeting", value_type="string", value="Original")
    with rename_harness.factory.begin() as session:
        session.add(row)
    return _Harness(rename_harness, row)


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("mode", [AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT])
def test_supported_modes_preserve_wire_contract_and_close_admission_before_repository(
    harness: _Harness, method: str, mode: AppMode
) -> None:
    source = harness.source
    with source.factory.begin() as session:
        session.execute(update(App).where(App.id == source.target.id).values(mode=mode))
    response = harness.request(method)
    assert response.status_code == HTTPStatus.OK
    assert response.headers["Content-Type"] == "application/json"
    payload = response.get_json()
    value = payload if method == "PUT" else payload["data"][0]
    assert value == {
        "id": harness.row.id,
        "name": "greeting",
        "value_type": "string",
        "value": "Updated" if method == "PUT" else "Original",
        "description": "Saved variable description",
        "created_at": int(_CREATED_AT.timestamp()),
        "updated_at": value["updated_at"] if method == "PUT" else int(_UPDATED_AT.timestamp()),
    }
    assert str(UUID(value["id"])) == value["id"]
    with source.factory() as session:
        stored = session.get(ConversationVariable, (harness.row.id, source.conversation.id))
        assert stored is not None
        variable = stored.to_variable()
        assert variable.id == "draft-greeting"
        assert variable.value == value["value"]
        assert variable.selector == ["conversation", "greeting"]
        if method == "PUT":
            assert value["updated_at"] > int(_UPDATED_AT.timestamp())
            assert value["updated_at"] == int(stored.updated_at.timestamp())
    assert source.admissions
    assert source.provisions
    assert source.queries
    assert source.scoped_sessions == []
    source.assert_closed()


@pytest.mark.parametrize(
    ("value_type", "old_value", "new_value", "exposed_type", "wire_value"),
    [
        ("string", "before", "", "string", ""),
        ("integer", 1, 0, "number", "0"),
        ("float", 1.5, 0.5, "number", "0.5"),
        ("boolean", True, False, "boolean", "False"),
        ("object", {"before": True}, {}, "object", "{}"),
        ("array[string]", ["before"], [], "array[string]", "[]"),
        ("array[number]", [1], [2, 3.5], "array[number]", "[2, 3.5]"),
        ("array[object]", [{"before": True}], [{"value": None}], "array[object]", "[{'value': None}]"),
        ("array[boolean]", [True], [False], "array[boolean]", "[False]"),
    ],
)
def test_update_retains_stringified_json_values_and_variable_metadata(
    harness: _Harness,
    value_type: str,
    old_value: JsonValue,
    new_value: JsonValue,
    exposed_type: str,
    wire_value: str,
) -> None:
    row = harness.add_variable("boundary", value_type=value_type, value=old_value)
    response = harness.request("PUT", variable_id=row.id, body={"value": new_value})
    assert response.status_code == HTTPStatus.OK
    assert response.get_json()["value_type"] == exposed_type
    assert response.get_json()["value"] == wire_value
    with harness.source.factory() as session:
        stored = session.get(ConversationVariable, (row.id, row.conversation_id))
        assert stored is not None
        variable = stored.to_variable()
        assert variable.value == new_value
        assert variable.id == "draft-boundary"
        assert variable.description == "Saved variable description"
        assert variable.selector == ["conversation", "boundary"]
    listed = harness.request("GET", query={"variable_name": "boundary"})
    assert listed.status_code == HTTPStatus.OK
    assert listed.get_json()["data"] == [response.get_json()]
    harness.source.assert_closed()


def test_pagination_and_case_insensitive_filter_keep_cursor_inside_filtered_list(harness: _Harness) -> None:
    first = harness.add_variable("Preference_first", offset=1)
    second = harness.add_variable("preference_second", offset=2)
    harness.add_variable("unrelated", offset=3)
    first_response = harness.request("GET", query={"variable_name": "PREFERENCE", "limit": 1})
    assert first_response.status_code == HTTPStatus.OK
    assert first_response.get_json()["has_more"] is True
    assert [row["id"] for row in first_response.get_json()["data"]] == [first.id]
    second_response = harness.request("GET", query={"variable_name": "PREFERENCE", "limit": 1, "last_id": first.id})
    assert second_response.get_json()["has_more"] is False
    assert [row["id"] for row in second_response.get_json()["data"]] == [second.id]
    bad_cursor = harness.request("GET", query={"variable_name": "PREFERENCE", "last_id": harness.row.id})
    assert bad_cursor.status_code == HTTPStatus.NOT_FOUND
    assert bad_cursor.get_json()["code"] == "conversation_variable_not_found"
    harness.source.assert_closed()


def test_variable_name_underscore_is_literal_and_empty_cursor_means_first_page(harness: _Harness) -> None:
    matching = harness.add_variable("pref_name")
    harness.add_variable("prefXname")
    response = harness.request("GET", query={"variable_name": "PREF_", "last_id": ""})
    assert response.status_code == HTTPStatus.OK
    assert [item["id"] for item in response.get_json()["data"]] == [matching.id]
    harness.source.assert_closed()


@pytest.mark.parametrize("cursor", [False, True], ids=["no-cursor", "with-cursor"])
def test_other_conversation_and_app_variables_do_not_leak(harness: _Harness, cursor: bool) -> None:
    other_conversation = make_conversation(
        conversation_id=str(uuid4()),
        app_id=harness.source.target.id,
        name="Other",
        inputs={},
        from_source=ConversationFromSource.API,
        from_end_user_id=harness.source.end_user.id,
    )
    with harness.source.factory.begin() as session:
        session.add(other_conversation)
    foreign = harness.add_variable("foreign", conversation_id=other_conversation.id)
    harness.add_variable("wrong_app", app_id=str(uuid4()))
    response = harness.request("GET", query={"last_id": foreign.id} if cursor else {})
    if cursor:
        assert response.status_code == HTTPStatus.NOT_FOUND
        assert response.get_json()["code"] == "conversation_variable_not_found"
    else:
        assert response.status_code == HTTPStatus.OK
        assert [row["id"] for row in response.get_json()["data"]] == [harness.row.id]
    denied_update = harness.request("PUT", variable_id=foreign.id)
    assert denied_update.status_code == HTTPStatus.NOT_FOUND
    assert denied_update.get_json()["code"] == "conversation_variable_not_found"
    harness.assert_unchanged()
    harness.source.assert_closed()


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("field", ["app_id", "from_end_user_id", "from_source", "from_account_id", "is_deleted"])
def test_conversation_ownership_is_required_for_read_and_write(harness: _Harness, method: str, field: str) -> None:
    value: str | bool
    if field == "is_deleted":
        value = True
    elif field == "from_source":
        value = ConversationFromSource.CONSOLE
    else:
        value = str(uuid4())
    with harness.source.factory.begin() as session:
        session.execute(
            update(Conversation).where(Conversation.id == harness.source.conversation.id).values({field: value})
        )
    response = harness.request(method)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json() == {
        "code": "conversation_not_found",
        "message": "The conversation was not found for this user and app.",
        "status": HTTPStatus.NOT_FOUND,
    }
    harness.assert_unchanged()
    harness.source.assert_closed()


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("user", [None, "", "another-user"])
def test_missing_or_other_end_user_cannot_access_variables(harness: _Harness, method: str, user: str | None) -> None:
    response = harness.request(method, user=user)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    harness.assert_unchanged()
    harness.source.assert_closed()


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("change_app_too", [False, True], ids=["end-user-workspace", "app-workspace"])
def test_workspace_change_after_admission_blocks_variable_access(
    harness: _Harness, method: str, change_app_too: bool
) -> None:
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
        response = harness.request(method)
    finally:
        event.remove(source.provision_factory, "after_transaction_end", change_owner)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json()["code"] == "conversation_not_found"
    harness.assert_unchanged()
    source.assert_closed()


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("authorization", [None, "Basic rename-token", "Bearer invalid-token"])
def test_invalid_credentials_stop_before_database_use_case(
    harness: _Harness, method: str, authorization: str | None
) -> None:
    response = harness.request(method, authorization=authorization)
    assert response.status_code == HTTPStatus.UNAUTHORIZED
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert response.get_json()["code"] == "unauthorized"
    source = harness.source
    assert source.admissions == source.provisions == source.queries == []
    harness.assert_unchanged()
    source.assert_closed()


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("mode", [AppMode.COMPLETION, AppMode.WORKFLOW, AppMode.AGENT])
def test_unsupported_modes_fail_before_repository(harness: _Harness, method: str, mode: AppMode) -> None:
    with harness.source.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.source.target.id).values(mode=mode))
    response = harness.request(method)
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "not_chat_app"
    assert harness.source.queries == []
    harness.assert_unchanged()
    harness.source.assert_closed()


@pytest.mark.parametrize(
    "query",
    [
        {"limit": "0"},
        {"limit": "101"},
        {"last_id": "invalid"},
        {"variable_name": ""},
        {"variable_name": "a" * 256},
        {"variable_name": "foo'; DROP TABLE app;"},
    ],
)
def test_invalid_query_returns_422_before_repository(harness: _Harness, query: dict[str, str]) -> None:
    response = harness.request("GET", query=query)
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert harness.source.queries == []
    harness.source.assert_closed()


def test_missing_value_returns_422_without_write(harness: _Harness) -> None:
    response = harness.request("PUT", body={})
    assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
    assert response.get_json()["code"] == "unprocessable_entity"
    assert harness.source.queries == []
    harness.assert_unchanged()
    harness.source.assert_closed()


@pytest.mark.parametrize("new_value", [0, False, [], {}, None])
def test_type_mismatch_returns_specific_error_and_rolls_back(harness: _Harness, new_value: JsonValue) -> None:
    response = harness.request("PUT", body={"value": new_value})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    error = response.get_json()
    assert error["code"] == "conversation_variable_type_mismatch"
    assert "variable 'greeting' expects string" in error["message"]
    assert "but got" in error["message"]
    assert error["status"] == HTTPStatus.BAD_REQUEST
    harness.assert_unchanged()
    harness.source.assert_closed()


@pytest.mark.parametrize("method", ["GET", "PUT"])
def test_missing_variable_or_cursor_returns_specific_404(harness: _Harness, method: str) -> None:
    variable_id = str(uuid4())
    response = harness.request(method, query={"last_id": variable_id}, variable_id=variable_id)
    assert response.status_code == HTTPStatus.NOT_FOUND
    assert response.get_json() == {
        "code": "conversation_variable_not_found",
        "message": "The conversation variable was not found for this conversation.",
        "status": HTTPStatus.NOT_FOUND,
    }
    harness.assert_unchanged()
    harness.source.assert_closed()


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize("multiple_apps", [False, True], ids=["single-app", "multiple-apps"])
def test_resource_token_reuses_bound_end_user_and_records_usage(
    harness: _Harness, method: str, multiple_apps: bool
) -> None:
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
            request_id="variable-resource-token",
            trace_id=None,
            account_id=str(uuid4()),
            active_workspace_id=source.tenant.id,
        ),
        name="Variable app token",
        resources=tuple(ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app_id) for app_id in app_ids),
    )
    response = harness.request(
        method,
        authorization=f"Bearer {token.token}",
        requested_app_id=source.target.id if multiple_apps else None,
    )
    assert response.status_code == HTTPStatus.OK
    source.assert_closed()
    with source.factory() as session:
        stored_token = session.get(ResourceAccessToken, token.token_id)
        assert stored_token is not None
        assert stored_token.last_used_at is not None
        assert session.scalars(select(EndUser.id)).all() == [source.end_user.id]


@pytest.mark.parametrize("method", ["GET", "PUT"])
@pytest.mark.parametrize(
    ("failure", "code"), [("disabled_api", "app_api_disabled"), ("archived_workspace", "workspace_archived")]
)
def test_disabled_app_or_workspace_prevents_provisioning(
    harness: _Harness, method: str, failure: str, code: str
) -> None:
    source = harness.source
    with source.factory.begin() as session:
        if failure == "disabled_api":
            session.execute(update(App).where(App.id == source.target.id).values(enable_api=False))
        else:
            session.execute(update(Tenant).where(Tenant.id == source.tenant.id).values(status=TenantStatus.ARCHIVE))
    response = harness.request(method, user="new-user")
    assert response.status_code == HTTPStatus.FORBIDDEN
    assert response.get_json()["code"] == code
    assert source.provisions == source.queries == []
    harness.assert_unchanged()
    source.assert_closed()


def test_factory_size_rejection_preserves_error_and_rolls_back(harness: _Harness) -> None:
    response = harness.request("PUT", body={"value": "x" * (dify_config.MAX_VARIABLE_SIZE + 1)})
    assert response.status_code == HTTPStatus.BAD_REQUEST
    assert response.get_json()["code"] == "invalid_param"
    assert f"exceeds limit {dify_config.MAX_VARIABLE_SIZE}" in response.get_json()["message"]
    harness.assert_unchanged()
    harness.source.assert_closed()
