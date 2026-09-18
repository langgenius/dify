import io
from collections.abc import Callable
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, Forbidden

from controllers.console.app import app as app_module
from controllers.console.app import app_import as import_module
from core.rbac import RBACPermission
from models.account import Account, Tenant
from models.model import App, AppMode
from services import app_import_source
from services.agent.errors import InvalidRosterAgentPackageError
from services.agent.roster_package_importer import RosterAgentPackageImportResult
from services.entities.dsl_entities import DslImportWarning


def _mock_download(monkeypatch: pytest.MonkeyPatch, content: bytes = b"PK\x00\xff") -> Mock:
    fetch = Mock(
        return_value=httpx.Response(200, content=content, request=httpx.Request("GET", "https://example.com/download"))
    )
    monkeypatch.setattr(app_import_source.remote_fetcher, "make_request", fetch)
    return fetch


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
    _mock_download(monkeypatch, b"app: {}" if is_yaml else b"PK\x00\xff")
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


@pytest.mark.parametrize("from_url", [False, True])
@pytest.mark.parametrize("denied", [RBACPermission.AGENT_CREATE, RBACPermission.AGENT_IMPORT_EXPORT_DSL])
def test_package_import_checks_agent_permissions_before_reading_payload(
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
        else {"data": {"file": (io.BytesIO(b"package"), "agent.ifpkg")}}
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
        else {"data": {"app_id": "existing", "file": (io.BytesIO(b"package"), "agent.ifpkg")}}
    )
    with app.test_request_context("/console/api/apps/imports", method="POST", **request_kwargs):
        with pytest.raises(InvalidRosterAgentPackageError, match="overwriting"):
            unwrap(api.post)(api, _account())


@pytest.mark.parametrize("query", [{}, {"format": "ifpkg"}])
def test_existing_export_route_returns_ifpkg_for_agent(
    app: Flask, monkeypatch: pytest.MonkeyPatch, query: dict[str, str]
) -> None:
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


def test_ifpkg_export_rejects_non_agent_apps() -> None:
    model = App(id="app-1", tenant_id="tenant-1", mode=AppMode.WORKFLOW)
    with pytest.raises(BadRequest):
        unwrap(app_module.AppExportApi.get)(app_module.AppExportApi(), app_module.AppExportQuery(format="ifpkg"), model)


@pytest.mark.parametrize(
    ("mode", "query"),
    [(AppMode.AGENT, {"format": "yaml"}), (AppMode.WORKFLOW, {}), (AppMode.WORKFLOW, {"format": "yaml"})],
)
def test_yaml_export_remains_available(monkeypatch: pytest.MonkeyPatch, mode: AppMode, query: dict[str, str]) -> None:
    model = App(id="app-1", tenant_id="tenant-1", mode=mode)
    monkeypatch.setattr(app_module, "db", SimpleNamespace(session=lambda: object()))
    monkeypatch.setattr(app_module.AppDslService, "export_dsl", lambda **_kwargs: "app: {}")
    assert unwrap(app_module.AppExportApi.get)(
        app_module.AppExportApi(), app_module.AppExportQuery.model_validate(query), model
    ) == {"data": "app: {}"}
