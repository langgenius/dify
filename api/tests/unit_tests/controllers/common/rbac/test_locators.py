"""Agent creator ownership stays within the active agent's workspace."""

from unittest.mock import MagicMock

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from configs import dify_config
from controllers.common.rbac import locators
from controllers.common.rbac.checks import RBACCheck, enforce_rbac_checks
from core.rbac import RBACPermission, RBACResourceScope
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from services import rbac_resource_service
from services.enterprise.rbac_service import RBACService


@pytest.fixture(autouse=True)
def bind_resource_session(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    monkeypatch.setattr(rbac_resource_service.db, "session", sqlite_session)


@pytest.mark.parametrize("status", [AgentStatus.ACTIVE, AgentStatus.ARCHIVED])
def test_agent_owner_resolution_is_workspace_scoped(sqlite_session: Session, status: AgentStatus) -> None:
    with sqlite_session.begin():
        sqlite_session.add(
            Agent(
                id="agent",
                tenant_id="workspace",
                name="Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                created_by="owner",
                status=status,
            )
        )
    locator = locators.AgentId()
    identity = locators.ResourceIdentity(RBACResourceScope.AGENT, "agent")
    assert locator.owner_id("workspace", identity) == ("owner" if status == AgentStatus.ACTIVE else None)
    assert locator.owner_id("other-workspace", identity) is None
    assert locator.owner_id("workspace", locators.ResourceIdentity(RBACResourceScope.AGENT, "missing")) is None


@pytest.mark.parametrize(
    ("workspace_id", "account_id", "is_owner"),
    [("workspace", "owner", True), ("workspace", "other", False), ("other-workspace", "owner", False)],
)
@pytest.mark.parametrize("permission", [RBACPermission.AGENT_PREVIEW, RBACPermission.AGENT_EDIT])
def test_agent_creator_bypasses_rbac_only_in_own_workspace(
    app: Flask,
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    workspace_id: str,
    account_id: str,
    is_owner: bool,
    permission: RBACPermission,
) -> None:
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    check_access = MagicMock(return_value=False)
    monkeypatch.setattr(RBACService.CheckAccess, "check", check_access)
    with sqlite_session.begin():
        sqlite_session.add(
            Agent(
                id="agent",
                tenant_id="workspace",
                name="Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                created_by="owner",
            )
        )
    with app.test_request_context():
        if is_owner:
            enforce_rbac_checks(
                tenant_id=workspace_id,
                account_id=account_id,
                checks=[RBACCheck(permission, locators.AgentId())],
                path_args={"agent_id": "agent"},
            )
            check_access.assert_not_called()
        else:
            with pytest.raises(Forbidden):
                enforce_rbac_checks(
                    tenant_id=workspace_id,
                    account_id=account_id,
                    checks=[RBACCheck(permission, locators.AgentId())],
                    path_args={"agent_id": "agent"},
                )
            check_access.assert_called_once_with(
                workspace_id,
                account_id,
                scene=permission,
                resource_type=RBACResourceScope.AGENT,
                resource_id="agent",
            )
