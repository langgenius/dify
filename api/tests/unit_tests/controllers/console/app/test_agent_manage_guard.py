from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, scoped_session, sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.console.app.error import AppNotFoundError
from controllers.console.app.wraps import agent_manage_required_for_agent_app
from core.rbac import RBACPermission, RBACResourceScope
from models import Account
from models.agent import Agent, AgentScope, AgentSource, AgentStatus
from models.model import App, AppMode

TENANT_ID = "tenant-1"


def _guarded_view():
    calls: list[dict[str, object]] = []

    @agent_manage_required_for_agent_app
    def view(*args, **kwargs):
        calls.append(kwargs)
        return "ok"

    return view, calls


def _persist_app(
    session: Session,
    *,
    scope: AgentScope | None = None,
    status: AgentStatus = AgentStatus.ACTIVE,
) -> App:
    app_model = App(
        id="app-1",
        tenant_id=TENANT_ID,
        name="Managed App",
        mode=AppMode.AGENT if scope is not None else AppMode.CHAT,
        enable_site=True,
        enable_api=False,
    )
    session.add(app_model)
    if scope is not None:
        agent = Agent(
            tenant_id=TENANT_ID,
            name=f"{scope.value} agent",
            scope=scope,
            source=AgentSource.AGENT_APP if scope == AgentScope.ROSTER else AgentSource.WORKFLOW,
            status=status,
            app_id=app_model.id if scope == AgentScope.ROSTER else None,
            backing_app_id=app_model.id if scope == AgentScope.WORKFLOW_ONLY else None,
        )
        session.add(agent)
    session.commit()
    return app_model


def _patch_guard(account: Account, rbac_enabled: bool):
    return (
        patch("controllers.console.app.wraps.current_account_with_tenant", return_value=(account, TENANT_ID)),
        patch("controllers.console.app.wraps.dify_config.RBAC_ENABLED", rbac_enabled),
    )


class TestAgentManageRequiredForAgentApp:
    @pytest.fixture(autouse=True)
    def _bind_database(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
    ):
        self.sqlite_session = sqlite_session
        self.account = Account(name="Guard User", email="guard@example.com")
        self.account.id = "account-1"
        session_proxy = scoped_session(sqlite_session_factory)
        with patch("controllers.console.app.wraps.db.session", session_proxy):
            yield
        session_proxy.remove()

    def test_non_agent_app_passes_through_without_workspace_check(self):
        view, calls = _guarded_view()
        _persist_app(self.sqlite_session)
        patches = _patch_guard(self.account, rbac_enabled=True)

        with patches[0], patches[1], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_not_called()
        assert calls == [{"app_id": "app-1"}]

    def test_roster_agent_app_requires_agent_manage_when_rbac_enabled(self):
        view, _ = _guarded_view()
        _persist_app(self.sqlite_session, scope=AgentScope.ROSTER)
        patches = _patch_guard(self.account, rbac_enabled=True)

        with patches[0], patches[1], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_called_once_with(
            tenant_id=TENANT_ID,
            account_id=self.account.id,
            resource_type=RBACResourceScope.WORKSPACE,
            scene=RBACPermission.AGENT_MANAGE,
            resource_required=False,
        )

    def test_roster_agent_app_denied_without_agent_manage(self):
        view, calls = _guarded_view()
        _persist_app(self.sqlite_session, scope=AgentScope.ROSTER)
        patches = _patch_guard(self.account, rbac_enabled=True)

        with (
            patches[0],
            patches[1],
            patch("controllers.console.app.wraps.enforce_rbac_access", side_effect=Forbidden()),
        ):
            with pytest.raises(Forbidden):
                view(app_id="app-1")

        assert calls == []

    def test_roster_agent_app_skips_workspace_check_when_rbac_disabled(self):
        view, _ = _guarded_view()
        _persist_app(self.sqlite_session, scope=AgentScope.ROSTER)
        patches = _patch_guard(self.account, rbac_enabled=False)

        with patches[0], patches[1], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_not_called()

    def test_hidden_backing_app_is_rejected_even_without_rbac(self):
        """A workflow-only backing App is not part of the general app management plane."""
        view, calls = _guarded_view()
        _persist_app(self.sqlite_session, scope=AgentScope.WORKFLOW_ONLY)
        patches = _patch_guard(self.account, rbac_enabled=False)

        with patches[0], patches[1]:
            with pytest.raises(AppNotFoundError):
                view(app_id="app-1")

        assert calls == []

    def test_hidden_backing_app_is_rejected_before_workspace_check(self):
        view, calls = _guarded_view()
        _persist_app(self.sqlite_session, scope=AgentScope.WORKFLOW_ONLY)
        patches = _patch_guard(self.account, rbac_enabled=True)

        with patches[0], patches[1], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            with pytest.raises(AppNotFoundError):
                view(app_id="app-1")

        gate.assert_not_called()
        assert calls == []

    def test_binding_lookup_covers_archived_agents(self):
        """An Agent App stays gated after its roster Agent is archived."""
        view, _ = _guarded_view()
        _persist_app(self.sqlite_session, scope=AgentScope.ROSTER, status=AgentStatus.ARCHIVED)
        patches = _patch_guard(self.account, rbac_enabled=True)

        with patches[0], patches[1], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            view(app_id="app-1")

        gate.assert_called_once()

    def test_resource_id_path_alias_is_resolved(self):
        view, _ = _guarded_view()
        _persist_app(self.sqlite_session, scope=AgentScope.ROSTER)
        patches = _patch_guard(self.account, rbac_enabled=True)

        with patches[0], patches[1], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(resource_id="app-1") == "ok"

        gate.assert_called_once()

    def test_unknown_app_passes_through_for_downstream_handling(self):
        view, calls = _guarded_view()
        patches = _patch_guard(self.account, rbac_enabled=True)

        with patches[0], patches[1], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_not_called()
        assert calls == [{"app_id": "app-1"}]
