from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from werkzeug.exceptions import Forbidden

from controllers.console.app.error import AppNotFoundError
from controllers.console.app.wraps import agent_manage_required_for_agent_app
from core.rbac import RBACPermission, RBACResourceScope
from models.agent import AgentScope

TENANT_ID = "tenant-1"
ACCOUNT = SimpleNamespace(id="account-1")


def _guarded_view():
    calls: list[dict[str, object]] = []

    @agent_manage_required_for_agent_app
    def view(*args, **kwargs):
        calls.append(kwargs)
        return "ok"

    return view, calls


def _app_with_binding(binding):
    app_model = MagicMock()
    app_model.agent_app_binding_with_session.return_value = binding
    return app_model


def _patch_guard(app_model, rbac_enabled: bool):
    mock_db = MagicMock()
    mock_db.session.scalar.return_value = app_model
    return (
        patch("controllers.console.app.wraps.db", mock_db),
        patch("controllers.console.app.wraps.current_account_with_tenant", return_value=(ACCOUNT, TENANT_ID)),
        patch("controllers.console.app.wraps.dify_config.RBAC_ENABLED", rbac_enabled),
    )


class TestAgentManageRequiredForAgentApp:
    def test_non_agent_app_passes_through_without_workspace_check(self):
        view, calls = _guarded_view()
        patches = _patch_guard(_app_with_binding(None), rbac_enabled=True)

        with patches[0], patches[1], patches[2], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_not_called()
        assert calls == [{"app_id": "app-1"}]

    def test_roster_agent_app_requires_agent_manage_when_rbac_enabled(self):
        view, _ = _guarded_view()
        binding = SimpleNamespace(scope=AgentScope.ROSTER)
        patches = _patch_guard(_app_with_binding(binding), rbac_enabled=True)

        with patches[0], patches[1], patches[2], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_called_once_with(
            tenant_id=TENANT_ID,
            account_id=ACCOUNT.id,
            resource_type=RBACResourceScope.WORKSPACE,
            scene=RBACPermission.AGENT_MANAGE,
            resource_required=False,
        )

    def test_roster_agent_app_denied_without_agent_manage(self):
        view, calls = _guarded_view()
        binding = SimpleNamespace(scope=AgentScope.ROSTER)
        patches = _patch_guard(_app_with_binding(binding), rbac_enabled=True)

        with (
            patches[0],
            patches[1],
            patches[2],
            patch("controllers.console.app.wraps.enforce_rbac_access", side_effect=Forbidden()),
        ):
            with pytest.raises(Forbidden):
                view(app_id="app-1")

        assert calls == []

    def test_roster_agent_app_skips_workspace_check_when_rbac_disabled(self):
        view, _ = _guarded_view()
        binding = SimpleNamespace(scope=AgentScope.ROSTER)
        patches = _patch_guard(_app_with_binding(binding), rbac_enabled=False)

        with patches[0], patches[1], patches[2], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_not_called()

    def test_hidden_backing_app_is_rejected_even_without_rbac(self):
        """A workflow-only backing App is not part of the general app management plane."""
        view, calls = _guarded_view()
        binding = SimpleNamespace(scope=AgentScope.WORKFLOW_ONLY)
        patches = _patch_guard(_app_with_binding(binding), rbac_enabled=False)

        with patches[0], patches[1], patches[2]:
            with pytest.raises(AppNotFoundError):
                view(app_id="app-1")

        assert calls == []

    def test_hidden_backing_app_is_rejected_before_workspace_check(self):
        view, calls = _guarded_view()
        binding = SimpleNamespace(scope=AgentScope.WORKFLOW_ONLY)
        patches = _patch_guard(_app_with_binding(binding), rbac_enabled=True)

        with patches[0], patches[1], patches[2], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            with pytest.raises(AppNotFoundError):
                view(app_id="app-1")

        gate.assert_not_called()
        assert calls == []

    def test_binding_lookup_covers_archived_agents(self):
        """An Agent App stays gated after its roster Agent is archived."""
        view, _ = _guarded_view()
        app_model = _app_with_binding(SimpleNamespace(scope=AgentScope.ROSTER))
        patches = _patch_guard(app_model, rbac_enabled=True)

        with patches[0], patches[1], patches[2], patch("controllers.console.app.wraps.enforce_rbac_access"):
            view(app_id="app-1")

        _, call_kwargs = app_model.agent_app_binding_with_session.call_args
        assert call_kwargs["include_archived"] is True

    def test_resource_id_path_alias_is_resolved(self):
        view, _ = _guarded_view()
        binding = SimpleNamespace(scope=AgentScope.ROSTER)
        patches = _patch_guard(_app_with_binding(binding), rbac_enabled=True)

        with patches[0], patches[1], patches[2], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(resource_id="app-1") == "ok"

        gate.assert_called_once()

    def test_unknown_app_passes_through_for_downstream_handling(self):
        view, calls = _guarded_view()
        patches = _patch_guard(None, rbac_enabled=True)

        with patches[0], patches[1], patches[2], patch("controllers.console.app.wraps.enforce_rbac_access") as gate:
            assert view(app_id="app-1") == "ok"

        gate.assert_not_called()
        assert calls == [{"app_id": "app-1"}]
