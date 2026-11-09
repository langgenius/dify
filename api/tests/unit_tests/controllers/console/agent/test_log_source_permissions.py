"""Exercise source-directory authorization without unwrapping the HTTP handlers."""

from collections.abc import Callable

import pytest
from flask import Flask
from flask_restx import Api

from configs import dify_config
from controllers.common.rbac import locators
from controllers.console.agent import roster
from core.rbac import RBACPermission
from enums import DeploymentEdition
from libs import login
from models.agent import Agent, AgentScope, AgentSource
from models.model import AppMode
from services.enterprise.rbac_service import RBACService
from tests.helpers.unit.model_factories import make_account, make_app, make_tenant
from tests.helpers.unit.rbac_fakes import RBACDomain

AGENT_ID = "00000000-0000-0000-0000-000000000001"
OTHER_AGENT_ID = "00000000-0000-0000-0000-000000000002"

type GrantPermissions = Callable[[set[RBACPermission]], list[tuple[str, str | None]]]


@pytest.fixture
def source_app(monkeypatch: pytest.MonkeyPatch, rbac_domain: RBACDomain) -> Flask:
    """Use real resource resolution and serialization with an authenticated test account."""
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.CLOUD)
    monkeypatch.setattr(dify_config, "LOGIN_DISABLED", True)
    account = make_account(tenant=make_tenant(), timezone="UTC")
    monkeypatch.setattr(login, "current_user", account)
    monkeypatch.setattr(locators, "application_services", lambda: rbac_domain)
    monkeypatch.setattr(roster, "application_services", lambda: rbac_domain)
    with rbac_domain.sessions.begin() as session:
        session.add(make_app(app_id="app-1", mode=AppMode.AGENT, name="Source Agent"))
        session.add(
            Agent(
                id=AGENT_ID,
                tenant_id="tenant-1",
                name="Source Agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                app_id="app-1",
                created_by="another-account",
            )
        )
    app = Flask(__name__)
    app.config["TESTING"] = True
    api = Api(app)
    for suffix, resource in (
        ("log-sources", roster.AgentLogSourcesApi),
        ("logs", roster.AgentLogsApi),
        ("logs/<uuid:conversation_id>/messages", roster.AgentLogMessagesApi),
        ("statistics/summary", roster.AgentStatisticsSummaryApi),
    ):
        api.add_resource(resource, f"/agent/<uuid:agent_id>/{suffix}")
    return app


@pytest.fixture
def grant(monkeypatch: pytest.MonkeyPatch) -> GrantPermissions:
    """Replace only the external permission decision, retaining the real RBAC gate."""

    def configure(scenes: set[RBACPermission]) -> list[tuple[str, str | None]]:
        calls: list[tuple[str, str | None]] = []

        def check(
            tenant_id: str,
            account_id: str,
            *,
            scene: RBACPermission,
            resource_type: str | None,
            resource_id: str | None,
        ) -> bool:
            calls.append((tenant_id, resource_id))
            return (
                tenant_id == "tenant-1"
                and account_id == "account-1"
                and resource_type == "agent"
                and resource_id == AGENT_ID
                and scene in scenes
            )

        monkeypatch.setattr(RBACService.CheckAccess, "check", check)
        return calls

    return configure


@pytest.mark.parametrize("permission", [RBACPermission.AGENT_MONITOR, RBACPermission.AGENT_LOG_MANAGE])
def test_sources_allow_either_resource_permission(
    source_app: Flask, grant: GrantPermissions, permission: RBACPermission
) -> None:
    grant({permission})
    response = source_app.test_client().get(f"/agent/{AGENT_ID}/log-sources")
    assert response.status_code == 200
    payload = response.get_json()
    assert isinstance(payload, dict)
    source = payload["data"][0]
    assert source["app_name"] == "Source Agent"
    assert set(source) == {
        "id",
        "type",
        "app_id",
        "app_name",
        "app_icon_type",
        "app_icon",
        "app_icon_background",
        "workflow_id",
        "workflow_version",
        "node_id",
    }


@pytest.mark.parametrize("permission", [RBACPermission.AGENT_PREVIEW, RBACPermission.AGENT_ACCESS_POINT_VIEW])
def test_sources_reject_unrelated_permissions(
    source_app: Flask, grant: GrantPermissions, permission: RBACPermission
) -> None:
    grant({permission})
    assert source_app.test_client().get(f"/agent/{AGENT_ID}/log-sources").status_code == 403


@pytest.mark.parametrize("suffix", ["logs", "logs/00000000-0000-0000-0000-000000000003/messages"])
def test_monitor_permission_does_not_expose_log_contents(
    source_app: Flask, grant: GrantPermissions, suffix: str
) -> None:
    grant({RBACPermission.AGENT_MONITOR})
    assert source_app.test_client().get(f"/agent/{AGENT_ID}/{suffix}").status_code == 403


def test_log_permission_does_not_grant_monitoring(source_app: Flask, grant: GrantPermissions) -> None:
    grant({RBACPermission.AGENT_LOG_MANAGE})
    assert source_app.test_client().get(f"/agent/{AGENT_ID}/statistics/summary").status_code == 403


@pytest.mark.parametrize(("tenant_id", "agent_id"), [("tenant-1", OTHER_AGENT_ID), ("other-tenant", AGENT_ID)])
def test_source_permission_is_scoped_to_tenant_and_agent(
    source_app: Flask,
    grant: GrantPermissions,
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    agent_id: str,
) -> None:
    calls = grant({RBACPermission.AGENT_MONITOR})
    monkeypatch.setattr(login, "current_user", make_account(tenant=make_tenant(tenant_id=tenant_id)))
    assert source_app.test_client().get(f"/agent/{agent_id}/log-sources").status_code == 403
    assert calls
    assert all(call == (tenant_id, agent_id) for call in calls)
