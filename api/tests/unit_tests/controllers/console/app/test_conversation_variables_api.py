"""Console conversation-variable behavior through the decorated resource and real SQL."""

from collections.abc import Callable
from datetime import datetime, timedelta
from typing import TypedDict, cast
from unittest.mock import create_autospec
from uuid import UUID

import pytest
from flask import Flask
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden, UnprocessableEntity

from controllers.console.app.conversation_variables import ConversationVariablesApi
from controllers.console.app.error import AppNotFoundError
from controllers.console.workspace.error import AccountNotInitializedError
from controllers.console.wraps import RBACPermission
from enums import DeploymentEdition
from extensions.ext_application_services import build_application_services
from extensions.ext_database import db
from extensions.ext_redis import RedisClientWrapper
from factories import variable_factory
from libs import login
from models import AppMode, ConversationVariable
from models.account import Account, AccountStatus, TenantAccountRole
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from services.enterprise.rbac_service import RBACService
from tests.unit_tests.model_factories import make_account, make_app, make_tenant

APP_ID = "11111111-1111-1111-1111-111111111111"
OTHER_APP_ID = "22222222-2222-2222-2222-222222222222"
CONVERSATION_ID = "33333333-3333-3333-3333-333333333333"


class VariablePage(TypedDict):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[dict[str, str | int | None]]


@pytest.fixture(autouse=True)
def admitted_account(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_engine: Engine,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> Account:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, LOGIN_DISABLED=True, RBAC_ENABLED=False)
    account = make_account(tenant=make_tenant(), role=TenantAccountRole.NORMAL)
    monkeypatch.setattr(login, "_resolve_current_user", lambda: account)
    # Legacy admission still reads through the request session. New query
    # adapters use the separately owned session factory bound to the same DB.
    monkeypatch.setattr(db, "session", sqlite_session)
    monkeypatch.setattr(type(db), "engine", property(lambda _self: sqlite_engine))
    services = build_application_services(
        database_client=sqlite_session_factory,
        deployment_edition=DeploymentEdition.CLOUD,
        initialization_password="",
        redis=create_autospec(RedisClientWrapper, instance=True),
    )
    monkeypatch.setitem(app.extensions, "application_services", services)
    sqlite_session.add(make_app(app_id=APP_ID, mode=AppMode.ADVANCED_CHAT))
    sqlite_session.commit()
    return account


def _get(app: Flask, *, app_id: str = APP_ID, conversation_id: str | None = CONVERSATION_ID) -> VariablePage:
    params: dict[str, str] = {} if conversation_id is None else {"conversation_id": conversation_id}
    with app.test_request_context(f"/console/api/apps/{app_id}/conversation-variables", query_string=params):
        response = ConversationVariablesApi().get(app_id=UUID(app_id))
    assert isinstance(response, dict)
    return cast(VariablePage, response)


def _variable(
    name: str,
    *,
    app_id: str = APP_ID,
    conversation_id: str = CONVERSATION_ID,
    value_type: str = "string",
    value: object = "value",
) -> ConversationVariable:
    variable = variable_factory.build_conversation_variable_from_mapping(
        {"id": f"draft-{name}", "name": name, "value_type": value_type, "value": value, "description": "description"}
    )
    return ConversationVariable.from_variable(app_id=app_id, conversation_id=conversation_id, variable=variable)


@pytest.mark.parametrize(
    ("value_type", "value", "exposed_type", "exposed_value"),
    [
        ("string", "hello", "string", "hello"),
        ("integer", 42, "number", "42"),
        ("float", 1.5, "number", "1.5"),
        ("boolean", True, "boolean", "True"),
        ("array[string]", ["a", "b"], "array[string]", "['a', 'b']"),
        ("object", {"key": "value"}, "object", "{'key': 'value'}"),
        ("array[object]", [{"x": 1}], "array[object]", "[{'x': 1}]"),
    ],
)
def test_variable_wire_values_and_storage_id(
    app: Flask,
    sqlite_session: Session,
    value_type: str,
    value: object,
    exposed_type: str,
    exposed_value: str,
) -> None:
    row = _variable("example", value_type=value_type, value=value)
    row.created_at = datetime(2026, 1, 1)
    row.updated_at = datetime(2026, 1, 2)
    sqlite_session.add(row)
    sqlite_session.commit()

    response = _get(app)

    assert response == {
        "page": 1,
        "limit": 100,
        "total": 1,
        "has_more": False,
        "data": [
            {
                "id": row.id,
                "name": "example",
                "value_type": exposed_type,
                "value": exposed_value,
                "description": "description",
                "created_at": int(row.created_at.timestamp()),
                "updated_at": int(row.updated_at.timestamp()),
            }
        ],
    }
    assert row.id != row.to_variable().id


def test_variables_are_scoped_by_app_and_conversation(app: Flask, sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            make_app(app_id=OTHER_APP_ID, tenant_id="tenant-2", mode=AppMode.ADVANCED_CHAT),
            _variable("visible"),
            _variable("other-app", app_id=OTHER_APP_ID),
            _variable("other-conversation", conversation_id="44444444-4444-4444-4444-444444444444"),
        ]
    )
    sqlite_session.commit()

    assert [item["name"] for item in _get(app)["data"]] == ["visible"]


@pytest.mark.parametrize("count", [0, 101])
def test_first_hundred_variables_keep_existing_envelope_and_order(
    app: Flask, sqlite_session: Session, count: int
) -> None:
    for index in reversed(range(count)):
        row = _variable(f"var-{index}")
        row.created_at = datetime(2026, 1, 1) + timedelta(seconds=index)
        sqlite_session.add(row)
    sqlite_session.commit()

    response = _get(app)

    assert response["page"] == 1
    assert response["limit"] == 100
    assert response["total"] == min(count, 100)
    assert response["has_more"] is False
    assert [item["name"] for item in response["data"]] == [f"var-{index}" for index in range(min(count, 100))]


@pytest.mark.parametrize("condition", ["missing", "other-workspace", "wrong-mode"])
@pytest.mark.parametrize("conversation_id", [None, CONVERSATION_ID])
def test_app_admission_precedes_query_validation(
    app: Flask, sqlite_session: Session, condition: str, conversation_id: str | None
) -> None:
    if condition != "missing":
        sqlite_session.add(
            make_app(
                app_id=OTHER_APP_ID,
                tenant_id="tenant-2" if condition == "other-workspace" else "tenant-1",
                mode=AppMode.CHAT if condition == "wrong-mode" else AppMode.ADVANCED_CHAT,
            )
        )
        sqlite_session.commit()

    with pytest.raises(AppNotFoundError) as error:
        _get(app, app_id=OTHER_APP_ID, conversation_id=conversation_id)
    expected = (
        "App mode is not in the supported list: {'advanced-chat'}" if condition == "wrong-mode" else "App not found."
    )
    assert error.value.description == expected


@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_hidden_workflow_agent_app_stays_hidden(app: Flask, sqlite_session: Session, status: AgentStatus) -> None:
    sqlite_session.add(make_app(app_id=OTHER_APP_ID, mode=AppMode.AGENT))
    sqlite_session.add(
        Agent(
            tenant_id="tenant-1",
            name="Workflow agent",
            scope=AgentScope.WORKFLOW_ONLY,
            source=AgentSource.WORKFLOW,
            status=status,
            backing_app_id=OTHER_APP_ID,
        )
    )
    sqlite_session.commit()

    with pytest.raises(AppNotFoundError, match="App not found"):
        _get(app, app_id=OTHER_APP_ID)


def test_missing_query_is_422_only_after_app_admission(app: Flask) -> None:
    with pytest.raises(UnprocessableEntity, match="conversation_id"):
        _get(app, conversation_id=None)


@pytest.mark.parametrize("allowed", [False, True])
def test_rbac_policy_is_enforced_before_query_validation(
    app: Flask,
    admitted_account: Account,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    allowed: bool,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    check = create_autospec(RBACService.CheckAccess.check, return_value=allowed)
    monkeypatch.setattr(RBACService.CheckAccess, "check", check)

    expected_error = UnprocessableEntity if allowed else Forbidden
    with pytest.raises(expected_error):
        _get(app, conversation_id=None)
    assert check.call_count == 1
    assert check.call_args.args == ("tenant-1", admitted_account.id)
    assert check.call_args.kwargs["scene"] == RBACPermission.APP_CREATE_AND_MANAGEMENT


def test_uninitialized_account_cannot_read(app: Flask, admitted_account: Account) -> None:
    admitted_account.status = AccountStatus.UNINITIALIZED
    with pytest.raises(AccountNotInitializedError):
        _get(app, conversation_id=None)
