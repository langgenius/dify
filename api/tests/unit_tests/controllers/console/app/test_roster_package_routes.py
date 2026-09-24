import io
import zipfile
from collections.abc import Callable
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import ANY, Mock
from uuid import UUID

import httpx
import pytest
import yaml
from flask import Flask
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console.app import app as app_module
from controllers.console.app import app_import as import_module
from core.rbac import RBACPermission
from enums import CloudPlan, DeploymentEdition
from models.account import Account, Tenant
from models.model import App, AppMode
from services import app_import_source
from services.agent.errors import InvalidRosterAgentPackageError
from services.agent.roster_package_importer import RosterAgentPackageImportResult
from services.app_package_service import AppPackageService
from services.entities.dsl_entities import DslImportWarning


def _mock_download(monkeypatch: pytest.MonkeyPatch, content: bytes | None = None) -> Mock:
    fetch = Mock(
        return_value=httpx.Response(
            200,
            content=content if content is not None else _roster_archive().getvalue(),
            request=httpx.Request("GET", "https://example.com/download"),
        )
    )
    monkeypatch.setattr(app_import_source.remote_fetcher, "make_request", fetch)
    return fetch


def _roster_archive() -> io.BytesIO:
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("manifest.yaml", "format: dify.roster-agent")
    source.seek(0)
    return source


def _account() -> Account:
    account = Account(name="Importer", email="importer@example.com")
    account._current_tenant = Tenant(name="Workspace")
    account._current_tenant.id = "tenant-1"
    return account


def test_existing_import_route_dispatches_json_without_changing_payload(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
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


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/download?id=123",
        "https://example.com/agent.ifpkg",
        " https://example.com/agent.IFPKG?token=secret#download ",
    ],
)
def test_package_url_uses_agent_import(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], url: str
) -> None:
    config_overrides(RBAC_ENABLED=False)
    importer = Mock()
    fetch = _mock_download(monkeypatch)
    importer.import_package.return_value = RosterAgentPackageImportResult(
        app_id="app-1", agent_id="agent-1", warnings=[]
    )
    monkeypatch.setattr(import_module, "RosterAgentPackageImporter", lambda: importer)
    api = import_module.AppImportApi()
    import_dsl = Mock()
    monkeypatch.setattr(api, "_import_dsl", import_dsl)
    account = _account()
    with app.test_request_context(
        "/console/api/apps/imports", method="POST", json={"mode": "yaml-url", "yaml_url": url}
    ):
        data, status = unwrap(api.post)(api, account)
    assert status == 200
    assert data["app_mode"] == "agent"
    assert data["status"] == "completed"
    fetch.assert_called_once()
    assert importer.import_package.call_args.kwargs["tenant_id"] == "tenant-1"
    assert importer.import_package.call_args.kwargs["account"] is account
    import_dsl.assert_not_called()


@pytest.mark.parametrize(
    "url", ["https://example.com/app.yaml", "https://example.com/download", "https://example.com/agent.ifpkg"]
)
def test_yaml_url_keeps_dsl_import_without_package_retry(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], url: str
) -> None:
    config_overrides(RBAC_ENABLED=False)
    fetch = _mock_download(monkeypatch, b"app: {}")
    api = import_module.AppImportApi()
    import_dsl = Mock(return_value=({"status": "failed", "error": "Missing app data"}, 400))
    import_package = Mock()
    monkeypatch.setattr(api, "_import_dsl", import_dsl)
    monkeypatch.setattr(api, "_import_package", import_package)
    with app.test_request_context(
        "/console/api/apps/imports",
        method="POST",
        json={"mode": "yaml-url", "yaml_url": url, "app_id": "existing", "name": "Renamed"},
    ):
        result = unwrap(api.post)(api, _account())
    assert result[1] == 400
    assert import_dsl.call_args.args[0] == import_module.AppImportPayload(
        mode="yaml-content", yaml_content="app: {}", app_id="existing", name="Renamed"
    )
    fetch.assert_called_once()
    import_package.assert_not_called()


def test_url_without_any_import_permission_does_not_download(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=True)
    _mock_download(monkeypatch)
    account = _account()
    monkeypatch.setattr("controllers.common.wraps.current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", lambda *_args, **_kwargs: False)
    fetch = _mock_download(monkeypatch)
    api = import_module.AppImportApi()
    with app.test_request_context(
        "/console/api/apps/imports",
        method="POST",
        json={"mode": "yaml-url", "yaml_url": "https://example.com/download"},
    ):
        with pytest.raises(Forbidden):
            unwrap(api.post)(api, account)
    fetch.assert_not_called()


@pytest.mark.parametrize("is_yaml", [False, True])
def test_url_quota_is_enforced_after_content_detection(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], is_yaml: bool
) -> None:
    config_overrides(RBAC_ENABLED=False, DEPLOYMENT_EDITION="CLOUD")
    account = _account()
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: (account, "tenant-1"))
    features = Mock()
    features.apps = SimpleNamespace(size=1, limit=1)
    monkeypatch.setattr("controllers.console.wraps.FeatureService.get_features", lambda *_args, **_kwargs: features)
    _mock_download(monkeypatch, b"app: {}" if is_yaml else _roster_archive().getvalue())
    importer = Mock()
    importer.import_package.return_value = RosterAgentPackageImportResult(
        app_id="app-1", agent_id="agent-1", warnings=[]
    )
    monkeypatch.setattr(import_module, "RosterAgentPackageImporter", lambda: importer)
    api = import_module.AppImportApi()
    with app.test_request_context(
        "/console/api/apps/imports",
        method="POST",
        json={"mode": "yaml-url", "yaml_url": "https://example.com/download"},
    ):
        if is_yaml:
            with pytest.raises(Forbidden, match="number of apps"):
                unwrap(api.post)(api, account)
            importer.import_package.assert_not_called()
        else:
            data, status = unwrap(api.post)(api, account)
            assert status == 200
            assert data["app_mode"] == "agent"


def test_url_rejects_content_that_is_neither_yaml_nor_package(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=False)
    fetch = _mock_download(monkeypatch, b"[invalid")
    api = import_module.AppImportApi()
    with app.test_request_context(
        "/console/api/apps/imports",
        method="POST",
        json={"mode": "yaml-url", "yaml_url": "https://example.com/download"},
    ):
        with pytest.raises(InvalidRosterAgentPackageError):
            unwrap(api.post)(api, _account())
    fetch.assert_called_once()


@pytest.mark.parametrize("has_warning", [False, True])
def test_existing_import_route_accepts_package_and_preserves_import_response(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], has_warning: bool
) -> None:
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
        "/console/api/apps/imports", method="POST", data={"file": (_roster_archive(), "agent.ifpkg")}
    ):
        data, status = unwrap(api.post)(api, account)
        assert import_package.call_args.kwargs["source"].read() == _roster_archive().getvalue()
    assert status == 200
    assert data["app_id"] == "app-1"
    assert data["app_mode"] == "agent"
    assert data["status"] == ("completed-with-warnings" if has_warning else "completed")
    assert data["warnings"] == [warning.model_dump(mode="json") for warning in warnings]
    assert data["id"]
    assert import_package.call_args.kwargs["tenant_id"] == "tenant-1"


@pytest.mark.parametrize("from_url", [False, True])
@pytest.mark.parametrize("denied", [RBACPermission.AGENT_CREATE, RBACPermission.AGENT_IMPORT_EXPORT_DSL])
def test_package_import_checks_agent_permissions_before_materializing_resources(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    denied: RBACPermission,
    from_url: bool,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    _mock_download(monkeypatch)
    account = _account()
    monkeypatch.setattr("controllers.common.wraps.current_account_with_tenant", lambda: (account, "tenant-1"))
    scenes = []

    def check(*_args, **kwargs: object) -> bool:
        scenes.append(kwargs["scene"])
        return kwargs["scene"] != denied

    monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", check)
    importer = Mock()
    monkeypatch.setattr(import_module, "RosterAgentPackageImporter", importer)
    api = import_module.AppImportApi()
    request_kwargs = (
        {"json": {"mode": "yaml-url", "yaml_url": "https://example.com/agent.ifpkg"}}
        if from_url
        else {"data": {"file": (_roster_archive(), "agent.ifpkg")}}
    )
    with app.test_request_context("/console/api/apps/imports", method="POST", **request_kwargs):
        with pytest.raises(Forbidden):
            unwrap(api.post)(api, account)
    assert denied in scenes
    if not from_url:
        assert RBACPermission.APP_IMPORT_EXPORT_DSL not in scenes
    importer.assert_not_called()


@pytest.mark.parametrize("from_url", [False, True])
def test_package_import_rejects_overwrite(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], from_url: bool
) -> None:
    config_overrides(RBAC_ENABLED=False)
    _mock_download(monkeypatch)
    api = import_module.AppImportApi()
    request_kwargs = (
        {"json": {"mode": "yaml-url", "yaml_url": "https://example.com/agent.ifpkg", "app_id": "existing"}}
        if from_url
        else {"data": {"app_id": "existing", "file": (_roster_archive(), "agent.ifpkg")}}
    )
    with app.test_request_context("/console/api/apps/imports", method="POST", **request_kwargs):
        with pytest.raises(InvalidRosterAgentPackageError, match="overwriting"):
            unwrap(api.post)(api, _account())


@pytest.mark.parametrize("query", [{}, {"format": "ifpkg"}])
def test_existing_export_route_returns_ifpkg_for_agent(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], query: dict[str, str]
) -> None:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
    get_plan = Mock(return_value=CloudPlan.SANDBOX)
    monkeypatch.setattr(app_module.FeatureService, "get_workspace_plan", get_plan)
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
    export.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-1", version_id=None)
    get_plan.assert_not_called()
    close.assert_called_once_with()


@pytest.mark.parametrize(
    "mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT, AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT]
)
@pytest.mark.parametrize("query", [{}, {"format": "ifpkg"}])
def test_default_export_packages_ordinary_app_dsl(
    app: Flask, monkeypatch: pytest.MonkeyPatch, mode: AppMode, query: dict[str, str]
) -> None:
    model = App(id="app-1", tenant_id="tenant-1", mode=mode, name="My App")
    dsl = f"kind: app\nversion: 0.7.0\napp:\n  mode: {mode}\n"
    export = Mock(return_value=yaml.safe_load(dsl))
    session = object()
    monkeypatch.setattr(app_module, "db", SimpleNamespace(session=lambda: session))
    monkeypatch.setattr(app_module.AppDslService, "export_data", export)
    with app.test_request_context():
        response = unwrap(app_module.AppExportApi.get)(
            app_module.AppExportApi(),
            app_module.AppExportQuery.model_validate({**query, "include_secret": True, "workflow_id": "revision-1"}),
            model,
        )
        response.direct_passthrough = False
        assert response.mimetype == "application/zip"
        assert "my-app.ifpkg" in response.headers["Content-Disposition"]
        prepared = AppPackageService().read_package(io.BytesIO(response.get_data()))
        assert prepared is not None
        with prepared:
            assert yaml.safe_load(prepared.dsl) == yaml.safe_load(dsl)
        response.close()
    export.assert_called_once_with(
        app_model=model, session=ANY, include_secret=True, workflow_id="revision-1", resource_exporter=ANY
    )


@pytest.mark.parametrize("from_url", [False, True])
@pytest.mark.parametrize("app_id", [None, "existing"])
@pytest.mark.parametrize("status", [200, 202, 400])
def test_ordinary_package_import_uses_dsl_permissions_and_confirmation(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    app_id: str | None,
    status: int,
    from_url: bool,
) -> None:
    config_overrides(RBAC_ENABLED=False)
    account = _account()
    api = import_module.AppImportApi()
    dsl = "kind: app\nversion: 99.0.0\napp:\n  mode: workflow\n"
    import_dsl = Mock(return_value=({"status": "pending"}, status))
    monkeypatch.setattr(api, "_import_dsl", import_dsl)
    agent_import = Mock()
    monkeypatch.setattr(api, "_import_agent_package", agent_import)
    with AppPackageService().export(dsl=dsl, name="Workflow") as package:
        form = {"file": (package.archive, "workflow.ifpkg"), "name": "Renamed"}
        if app_id:
            form["app_id"] = app_id
        if from_url:
            _mock_download(monkeypatch, package.archive.read())
            with app.test_request_context(
                method="POST",
                json={
                    "mode": "yaml-url",
                    "yaml_url": "https://example.com/workflow.ifpkg",
                    "name": "Renamed",
                    "app_id": app_id,
                },
            ):
                assert unwrap(api.post)(api, account) == ({"status": "pending"}, status)
        else:
            with app.test_request_context(method="POST", data=form):
                assert unwrap(api.post)(api, account) == ({"status": "pending"}, status)
    import_dsl.assert_called_once_with(
        import_module.AppImportPayload(mode="yaml-content", yaml_content=dsl, name="Renamed", app_id=app_id),
        account,
        package=ANY,
    )
    assert import_dsl.call_args.kwargs["package"].archive.closed
    agent_import.assert_not_called()


@pytest.mark.parametrize("export_format", [None, "ifpkg", "yaml"])
@pytest.mark.parametrize(
    ("edition", "plan", "allowed"),
    [
        (DeploymentEdition.CLOUD, CloudPlan.SANDBOX, False),
        (DeploymentEdition.CLOUD, CloudPlan.PROFESSIONAL, True),
        (DeploymentEdition.CLOUD, CloudPlan.TEAM, True),
        (DeploymentEdition.COMMUNITY, CloudPlan.SANDBOX, True),
        (DeploymentEdition.ENTERPRISE, CloudPlan.SANDBOX, True),
    ],
)
def test_version_export_requires_cloud_paid_plan(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    export_format: str | None,
    edition: DeploymentEdition,
    plan: CloudPlan,
    allowed: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    get_plan = Mock(return_value=plan)
    monkeypatch.setattr(app_module.FeatureService, "get_workspace_plan", get_plan)
    model = App(id="app-1", tenant_id="tenant-1", mode=AppMode.AGENT)
    monkeypatch.setattr(App, "bound_agent_id_with_session", lambda _self, **_kwargs: "agent-1")
    monkeypatch.setattr(app_module, "db", SimpleNamespace(session=lambda: object()))
    export = Mock(return_value=SimpleNamespace(archive=io.BytesIO(b"package"), filename="agent.ifpkg", close=Mock()))
    monkeypatch.setattr(app_module, "RosterAgentPackageExporter", lambda: SimpleNamespace(export=export))
    export_dsl = Mock(return_value="app: {}")
    monkeypatch.setattr(app_module.AppDslService, "export_dsl", export_dsl)
    version_id = "11111111-1111-4111-8111-111111111111"
    query = app_module.AppExportQuery.model_validate({"format": export_format, "version_id": version_id})
    with app.test_request_context("/console/api/apps/app-1/export"):
        if not allowed:
            with pytest.raises(Forbidden, match="paid plan"):
                unwrap(app_module.AppExportApi.get)(app_module.AppExportApi(), query, model)
            export.assert_not_called()
            export_dsl.assert_not_called()
        else:
            response = unwrap(app_module.AppExportApi.get)(app_module.AppExportApi(), query, model)
            if export_format == "yaml":
                assert response == {"data": "app: {}"}
                assert export_dsl.call_args.kwargs["version_id"] == UUID(version_id)
            else:
                export.assert_called_once_with(tenant_id="tenant-1", agent_id="agent-1", version_id=UUID(version_id))
                response.close()
    if edition == DeploymentEdition.CLOUD:
        get_plan.assert_called_once_with("tenant-1")
    else:
        get_plan.assert_not_called()


def test_export_query_rejects_conflicting_version_selectors() -> None:
    with pytest.raises(ValidationError, match="version_id and workflow_id cannot be used together"):
        app_module.AppExportQuery.model_validate(
            {"version_id": "11111111-1111-4111-8111-111111111111", "workflow_id": "workflow-1"}
        )


def test_version_export_rejects_non_agent_apps() -> None:
    query = app_module.AppExportQuery.model_validate({"version_id": "11111111-1111-4111-8111-111111111111"})
    with pytest.raises(BadRequest):
        unwrap(app_module.AppExportApi.get)(
            app_module.AppExportApi(), query, App(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
        )


@pytest.mark.parametrize(
    ("mode", "query"),
    [(AppMode.AGENT, {"format": "yaml"}), (AppMode.WORKFLOW, {"format": "yaml"})],
)
def test_yaml_export_remains_available(monkeypatch: pytest.MonkeyPatch, mode: AppMode, query: dict[str, str]) -> None:
    model = App(id="app-1", tenant_id="tenant-1", mode=mode)
    monkeypatch.setattr(app_module, "db", SimpleNamespace(session=lambda: object()))
    monkeypatch.setattr(app_module.AppDslService, "export_dsl", lambda **_kwargs: "app: {}")
    assert unwrap(app_module.AppExportApi.get)(
        app_module.AppExportApi(), app_module.AppExportQuery.model_validate(query), model
    ) == {"data": "app: {}"}


def test_ordinary_package_import_checks_app_permission(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=True)
    account = _account()
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr("controllers.common.wraps.current_account_with_tenant", lambda: (account, "tenant-1"))
    check = Mock(return_value=False)
    monkeypatch.setattr("controllers.common.rbac.checks.RBACService.CheckAccess.check", check)
    service = Mock()
    monkeypatch.setattr(import_module, "AppDslService", service)
    with AppPackageService().export(dsl="kind: app\napp: {mode: workflow}\n", name="Workflow") as package:
        with app.test_request_context(method="POST", data={"file": (package.archive, "workflow.ifpkg")}):
            api = import_module.AppImportApi()
            with pytest.raises(Forbidden):
                unwrap(api.post)(api, account)
    assert check.call_args.kwargs["scene"] == RBACPermission.APP_IMPORT_EXPORT_DSL
    service.assert_not_called()


def test_ordinary_package_import_cannot_bypass_app_quota(
    app: Flask, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(DEPLOYMENT_EDITION="CLOUD", RBAC_ENABLED=False)
    account = _account()
    monkeypatch.setattr("controllers.console.wraps.current_account_with_tenant", lambda: (account, "tenant-1"))
    monkeypatch.setattr(
        "controllers.console.wraps.FeatureService.get_features",
        lambda *_args, **_kwargs: SimpleNamespace(
            members=None,
            apps=SimpleNamespace(limit=1, size=1),
            documents_upload_quota=None,
            annotation_quota_limit=None,
        ),
    )
    service = Mock()
    monkeypatch.setattr(import_module, "AppDslService", service)
    with AppPackageService().export(dsl="kind: app\napp: {mode: workflow}\n", name="Workflow") as package:
        with app.test_request_context(method="POST", data={"file": (package.archive, "workflow.ifpkg")}):
            api = import_module.AppImportApi()
            with pytest.raises(Forbidden):
                unwrap(api.post)(api, account)
    service.assert_not_called()
