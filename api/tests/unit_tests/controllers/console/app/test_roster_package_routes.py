import io
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console.app import app as app_module
from controllers.console.app import app_import as import_module
from core.rbac import RBACPermission
from models.account import Account, Tenant
from models.model import App, AppMode
from services.agent.errors import InvalidRosterAgentPackageError
from services.agent.roster_package_importer import RosterAgentPackageImportResult
from services.entities.dsl_entities import DslImportWarning


def _account():
    account = Account(name="Importer", email="importer@example.com")
    account._current_tenant = Tenant(name="Workspace")
    account._current_tenant.id = "tenant-1"
    return account


def test_existing_import_route_dispatches_json_without_changing_payload(app, monkeypatch):
    api = import_module.AppImportApi()
    import_dsl = Mock(return_value=({"status": "completed"}, 200))
    monkeypatch.setattr(api, "_import_dsl", import_dsl)
    account = _account()
    with app.test_request_context(
        "/console/api/apps/imports", method="POST", json={"mode": "yaml-content", "yaml_content": "app: {}"}
    ):
        result = unwrap(api.post)(api, account)
    assert result == ({"status": "completed"}, 200)
    assert import_dsl.call_args.args == (
        import_module.AppImportPayload(mode="yaml-content", yaml_content="app: {}"),
        account,
    )


@pytest.mark.parametrize("has_warning", [False, True])
def test_existing_import_route_accepts_package_and_preserves_import_response(
    app, monkeypatch, config_overrides, has_warning
):
    config_overrides(RBAC_ENABLED=False)
    account = _account()
    warnings = (
        [DslImportWarning(code="agent_skill_missing", path="skills.s_000001", message="Missing Skill")]
        if has_warning
        else []
    )
    import_package = Mock(
        return_value=RosterAgentPackageImportResult(app_id="app-1", agent_id="agent-1", warnings=warnings)
    )
    monkeypatch.setattr(
        import_module, "RosterAgentPackageImporter", lambda: SimpleNamespace(import_package=import_package)
    )
    api = import_module.AppImportApi()
    with app.test_request_context(
        "/console/api/apps/imports", method="POST", data={"file": (io.BytesIO(b"package"), "agent.ifpkg")}
    ):
        data, status = unwrap(api.post)(api, account)
        assert import_package.call_args.kwargs["source"].read() == b"package"
    assert status == 200
    assert data["app_id"] == "app-1"
    assert data["app_mode"] == "agent"
    assert data["status"] == ("completed-with-warnings" if has_warning else "completed")
    assert data["warnings"] == [warning.model_dump(mode="json") for warning in warnings]
    assert data["id"]
    assert import_package.call_args.kwargs["tenant_id"] == "tenant-1"


@pytest.mark.parametrize("denied", [RBACPermission.AGENT_CREATE, RBACPermission.AGENT_IMPORT_EXPORT_DSL])
def test_package_import_checks_agent_permissions_before_reading_payload(app, monkeypatch, config_overrides, denied):
    config_overrides(RBAC_ENABLED=True)
    account = _account()
    monkeypatch.setattr("controllers.common.wraps.current_account_with_tenant", lambda: (account, "tenant-1"))
    scenes = []

    def check(*_args, **kwargs):
        scenes.append(kwargs["scene"])
        return kwargs["scene"] != denied

    monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", check)
    importer = Mock()
    monkeypatch.setattr(import_module, "RosterAgentPackageImporter", importer)
    api = import_module.AppImportApi()
    with app.test_request_context(
        "/console/api/apps/imports", method="POST", data={"file": (io.BytesIO(b"package"), "agent.ifpkg")}
    ):
        with pytest.raises(Forbidden):
            unwrap(api.post)(api, account)
    assert denied in scenes
    assert RBACPermission.APP_IMPORT_EXPORT_DSL not in scenes
    importer.assert_not_called()


def test_package_import_rejects_overwrite(app, config_overrides):
    config_overrides(RBAC_ENABLED=False)
    api = import_module.AppImportApi()
    with app.test_request_context(
        "/console/api/apps/imports",
        method="POST",
        data={"app_id": "existing", "file": (io.BytesIO(b"package"), "agent.ifpkg")},
    ):
        with pytest.raises(InvalidRosterAgentPackageError, match="overwriting"):
            unwrap(api.post)(api, _account())


@pytest.mark.parametrize("query", [{}, {"format": "ifpkg"}])
def test_existing_export_route_returns_ifpkg_for_agent(app, monkeypatch, query):
    model = App(id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT)
    monkeypatch.setattr(App, "bound_agent_id_with_session", lambda _self, **_kwargs: "agent-1")
    monkeypatch.setattr(app_module, "db", SimpleNamespace(session=lambda: object()))
    archive = io.BytesIO(b"package")
    close = Mock()
    export = Mock(return_value=SimpleNamespace(archive=archive, filename="agent.ifpkg", close=close))
    monkeypatch.setattr(app_module, "RosterAgentPackageExporter", lambda: SimpleNamespace(export=export))
    with app.test_request_context("/console/api/apps/app-1/export", query_string=query):
        response = unwrap(app_module.AppExportApi.get)(
            app_module.AppExportApi(), app_module.AppExportQuery.model_validate(query), model
        )
        response.direct_passthrough = False
        assert response.get_data() == b"package"
        assert response.mimetype == "application/zip"
        assert "agent.ifpkg" in response.headers["Content-Disposition"]
        response.close()
    export.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-1")
    close.assert_called_once_with()


def test_ifpkg_export_rejects_non_agent_apps():
    model = App(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
    with pytest.raises(BadRequest):
        unwrap(app_module.AppExportApi.get)(app_module.AppExportApi(), app_module.AppExportQuery(format="ifpkg"), model)


@pytest.mark.parametrize(
    ("mode", "query"),
    [(AppMode.AGENT, {"format": "yaml"}), (AppMode.WORKFLOW, {}), (AppMode.WORKFLOW, {"format": "yaml"})],
)
def test_yaml_export_remains_available(monkeypatch, mode, query):
    model = App(id="app-1", tenant_id="tenant-1", mode=mode)
    monkeypatch.setattr(app_module, "db", SimpleNamespace(session=lambda: object()))
    monkeypatch.setattr(app_module.AppDslService, "export_dsl", lambda **_kwargs: "app: {}")
    assert unwrap(app_module.AppExportApi.get)(
        app_module.AppExportApi(), app_module.AppExportQuery.model_validate(query), model
    ) == {"data": "app: {}"}
