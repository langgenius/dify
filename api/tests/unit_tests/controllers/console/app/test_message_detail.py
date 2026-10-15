"""Console detail admission retains app-wide reads without list-only restrictions."""

from collections.abc import Callable
from typing import Literal
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select, text, update

from models.account import TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentScope
from models.enums import ConversationFromSource
from models.model import App, AppMode, Conversation, Message
from tests.unit_tests.controllers.console.app.test_message_list import (
    _error,
    _get,
    _route,
    harness,
    installed_app_harness,
)
from tests.unit_tests.controllers.console.explore.test_message_suggested_questions import _Harness

__all__ = ["harness", "installed_app_harness"]


def _detail_route(state: _Harness, kind: Literal["app", "agent"], *, scope: AgentScope = AgentScope.ROSTER) -> str:
    return _route(state, kind, scope=scope).removesuffix("/chat-messages") + f"/messages/{state.message.id}"


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("role", list(TenantAccountRole))
def test_detail_keeps_all_initialized_workspace_roles(
    harness: _Harness, kind: Literal["app", "agent"], role: TenantAccountRole
) -> None:
    route = _detail_route(harness, kind)
    with harness.factory.begin() as session:
        session.execute(
            update(TenantAccountJoin).where(TenantAccountJoin.account_id == harness.account.id).values(role=role)
        )
    response = _get(harness, route)
    assert response.status_code == 200
    assert response.get_json()["id"] == harness.message.id
    harness.assert_closed()


@pytest.mark.parametrize("mode", list(AppMode))
def test_plain_app_detail_keeps_every_app_mode(harness: _Harness, mode: AppMode) -> None:
    route = _detail_route(harness, "app")
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(mode=mode))
    response = _get(harness, route)
    assert response.status_code == 200
    assert response.get_json()["id"] == harness.message.id


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("actor", ["other-account", "end-user", "deleted-conversation", "missing-conversation"])
def test_detail_keeps_other_actors_and_deleted_agent_conversations_visible(
    harness: _Harness, kind: Literal["app", "agent"], actor: str
) -> None:
    route = _detail_route(harness, kind)
    with harness.factory.begin() as session:
        if actor == "deleted-conversation":
            session.execute(
                update(Conversation).where(Conversation.id == harness.conversation.id).values(is_deleted=True)
            )
        elif actor == "missing-conversation":
            session.execute(delete(Conversation).where(Conversation.id == harness.conversation.id))
        else:
            for model in (Message, Conversation):
                record_id = harness.message.id if model is Message else harness.conversation.id
                values = (
                    {"from_account_id": str(uuid4())}
                    if actor == "other-account"
                    else {
                        "from_account_id": None,
                        "from_end_user_id": str(uuid4()),
                        "from_source": ConversationFromSource.API,
                    }
                )
                session.execute(update(model).where(model.id == record_id).values(**values))
    response = _get(harness, route)
    assert response.status_code == 200
    assert response.get_json()["id"] == harness.message.id
    harness.assert_closed()


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("missing", ["login", "csrf"])
def test_detail_requires_real_login_and_csrf(harness: _Harness, kind: Literal["app", "agent"], missing: str) -> None:
    response = _get(harness, _detail_route(harness, kind), authenticated=missing != "login", csrf=missing != "csrf")
    _error(response, status=401, code="unauthorized")
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("missing", ["message", "foreign-message"])
def test_detail_requires_message_in_admitted_app(
    harness: _Harness, kind: Literal["app", "agent"], missing: str
) -> None:
    route = _detail_route(harness, kind)
    with harness.factory.begin() as session:
        if missing == "message":
            session.execute(delete(Message).where(Message.id == harness.message.id))
        else:
            session.execute(update(Message).where(Message.id == harness.message.id).values(app_id=str(uuid4())))
    response = _get(harness, route)
    _error(response, status=404, code="not_found")
    assert response.get_json()["message"] == "Message Not Exists."


@pytest.mark.parametrize("kind", ["app", "agent"])
@pytest.mark.parametrize("missing", ["app", "foreign-workspace"])
def test_detail_rejects_missing_or_foreign_app(harness: _Harness, kind: Literal["app", "agent"], missing: str) -> None:
    route = _detail_route(harness, kind)
    with harness.factory.begin() as session:
        if missing == "app":
            session.execute(delete(App).where(App.id == harness.target.id))
        else:
            session.execute(update(App).where(App.id == harness.target.id).values(tenant_id=str(uuid4())))
    _error(_get(harness, route), status=404, code="app_not_found" if kind == "app" else "agent_not_found_error")


def test_detail_rejects_archived_app(harness: _Harness) -> None:
    route = _detail_route(harness, "app")
    with harness.factory.begin() as session:
        session.execute(text("UPDATE apps SET status = 'archived' WHERE id = :id"), {"id": harness.target.id})
    _error(_get(harness, route), status=404, code="app_not_found")


@pytest.mark.parametrize("scope", [AgentScope.ROSTER, AgentScope.WORKFLOW_ONLY])
def test_detail_resolves_existing_agent_runtime_without_creating_apps(harness: _Harness, scope: AgentScope) -> None:
    route = _detail_route(harness, "agent", scope=scope)
    response = _get(harness, route)
    assert response.status_code == 200
    if scope == AgentScope.WORKFLOW_ONLY:
        _error(
            _get(harness, f"/apps/{harness.target.id}/messages/{harness.message.id}"), status=404, code="app_not_found"
        )
        with harness.factory.begin() as session:
            session.execute(update(Agent).values(backing_app_id=None))
            count = session.scalar(select(func.count()).select_from(App))
        _error(_get(harness, route), status=404, code="agent_not_found_error")
        with harness.factory() as session:
            assert session.scalar(select(func.count()).select_from(App)) == count
            assert session.scalar(select(Agent.backing_app_id)) is None


def test_plain_detail_rbac_admits_app_maintainer_and_rejects_agent_binding(
    harness: _Harness, config_overrides: Callable[..., None]
) -> None:
    route = _detail_route(harness, "app")
    config_overrides(RBAC_ENABLED=True)
    with harness.factory.begin() as session:
        session.execute(update(App).where(App.id == harness.target.id).values(maintainer=harness.account.id))
        session.execute(
            update(TenantAccountJoin)
            .where(TenantAccountJoin.account_id == harness.account.id)
            .values(role=TenantAccountRole.NORMAL)
        )
    response = _get(harness, route)
    assert response.status_code == 200
    assert response.get_json()["id"] == harness.message.id
    _route(harness, "agent")
    _error(_get(harness, route), status=404, code="not_found")
