import io
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from inspect import unwrap
from typing import BinaryIO, cast
from uuid import uuid4

import httpx
import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.console.app import app as app_module
from controllers.console.app import app_import as import_module
from core.rbac import RBACPermission
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from services import app_import_source
from services.agent.errors import InvalidRosterAgentPackageError
from services.agent.roster_package_importer import RosterAgentPackageImportResult
from services.app.console_gateway import AppTransferGateway
from services.app_package_service import AppPackageService, PreparedAppPackage
from services.entities.dsl_entities import AppImportPackage, AppImportParams, DslImportWarning, Import, ImportStatus
from services.entities.feature_entities import FeatureModel, LimitationModel
from tests.unit_tests.controllers.conftest import ControllerTestServices


def _roster_archive() -> io.BytesIO:
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr("manifest.yaml", "format: dify.roster-agent")
    source.seek(0)
    return source


def _mock_download(monkeypatch: pytest.MonkeyPatch, content: bytes | None = None) -> list[str]:
    calls: list[str] = []

    def fetch(method: str, url: str, **_kwargs: object) -> httpx.Response:
        calls.append(url)
        return httpx.Response(
            200,
            content=content if content is not None else _roster_archive().getvalue(),
            request=httpx.Request(method, url),
        )

    monkeypatch.setattr(app_import_source.remote_fetcher, "make_request", fetch)
    return calls


@dataclass(frozen=True)
class AgentImportCall:
    tenant_id: str
    account: Account
    content: bytes


@dataclass
class Imports:
    context: RequestContext
    dsl_calls: list[AppImportParams] = field(default_factory=list)
    packages: list[PreparedAppPackage] = field(default_factory=list)
    agent_calls: list[AgentImportCall] = field(default_factory=list)
    status: ImportStatus = ImportStatus.COMPLETED
    warnings: list[DslImportWarning] = field(default_factory=list)

    def dsl(
        self, context: RequestContext, params: AppImportParams, *, package: AppImportPackage | None = None
    ) -> Import:
        assert context == self.context
        self.dsl_calls.append(params)
        if package is not None:
            assert isinstance(package, PreparedAppPackage)
            assert not package.archive.closed
            self.packages.append(package)
        return Import(id="import-1", status=self.status, app_id="app-1")

    def agent(self, *, source: BinaryIO, tenant_id: str, account: Account) -> RosterAgentPackageImportResult:
        self.agent_calls.append(AgentImportCall(tenant_id, account, source.read()))
        return RosterAgentPackageImportResult(app_id="app-1", agent_id="agent-1", warnings=self.warnings)


@pytest.fixture
def imports(
    app_query_services: ControllerTestServices,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> Imports:
    config_overrides(RBAC_ENABLED=False, DEPLOYMENT_EDITION="COMMUNITY")
    actor, tenant = str(uuid4()), str(uuid4())
    account = Account(name="Importer", email="importer@example.com")
    account.id = actor
    workspace = Tenant(name="Workspace")
    workspace.id = tenant
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                account,
                workspace,
                TenantAccountJoin(tenant_id=tenant, account_id=actor, role=TenantAccountRole.OWNER),
            ]
        )
    result = Imports(RequestContext("request", None, actor, tenant))
    transfers = app_query_services.apps.console._transfers
    assert isinstance(transfers, AppTransferGateway)
    monkeypatch.setattr(transfers, "import_dsl", result.dsl)
    monkeypatch.setattr(transfers._agent_importer, "import_package", result.agent)
    monkeypatch.setattr("services.app.console_gateway.SystemFeatureService.is_webapp_auth_enabled", lambda: False)
    return result


def _post(
    app: Flask,
    imports: Imports,
    *,
    json: dict[str, object] | None = None,
    data: dict[str, object] | None = None,
) -> tuple[dict[str, object], int]:
    api = import_module.AppImportApi()
    with app.test_request_context("/console/api/apps/imports", method="POST", json=json, data=data):
        return cast(tuple[dict[str, object], int], unwrap(api.post)(api, imports.context))


def test_existing_import_route_dispatches_json_without_changing_payload(app: Flask, imports: Imports) -> None:
    data, status = _post(app, imports, json={"mode": "yaml-content", "yaml_content": "app: {}"})
    assert status == 200
    assert data["status"] == "completed"
    assert [params.model_dump() for params in imports.dsl_calls] == [
        AppImportParams(mode="yaml-content", yaml_content="app: {}").model_dump()
    ]
    assert imports.agent_calls == []


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/download?id=123",
        "https://example.com/agent.ifpkg",
        " https://example.com/agent.IFPKG?token=secret#download ",
    ],
)
def test_package_url_uses_agent_import(app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, url: str) -> None:
    fetched = _mock_download(monkeypatch)
    data, status = _post(app, imports, json={"mode": "yaml-url", "yaml_url": url})
    assert status == 200
    assert data["app_mode"] == "agent"
    assert data["status"] == "completed"
    assert len(fetched) == 1
    assert imports.dsl_calls == []
    (call,) = imports.agent_calls
    assert call.tenant_id == imports.context.active_workspace_id
    assert call.account.id == imports.context.account_id
    assert call.account.is_admin_or_owner is True


@pytest.mark.parametrize(
    "url", ["https://example.com/app.yaml", "https://example.com/download", "https://example.com/agent.ifpkg"]
)
def test_yaml_url_keeps_dsl_import_without_package_retry(
    app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    imports.status = ImportStatus.FAILED
    fetched = _mock_download(monkeypatch, b"app: {}")
    _, status = _post(app, imports, json={"mode": "yaml-url", "yaml_url": url, "app_id": "existing", "name": "Renamed"})
    assert status == 400
    assert (
        imports.dsl_calls[0].model_dump()
        == AppImportParams(mode="yaml-content", yaml_content="app: {}", app_id="existing", name="Renamed").model_dump()
    )
    assert len(fetched) == 1
    assert imports.agent_calls == []


def test_url_without_any_import_permission_does_not_download(
    app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> None:
    config_overrides(RBAC_ENABLED=True)
    monkeypatch.setattr(
        "services.app.console_gateway.rbac_service.RBACService.CheckAccess.check", lambda *_a, **_k: False
    )
    fetched = _mock_download(monkeypatch)
    with pytest.raises(Forbidden):
        _post(app, imports, json={"mode": "yaml-url", "yaml_url": "https://example.com/download"})
    assert fetched == []


@pytest.mark.parametrize("is_yaml", [False, True])
def test_url_quota_is_enforced_after_content_detection(
    app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], is_yaml: bool
) -> None:
    config_overrides(DEPLOYMENT_EDITION="CLOUD")
    features = FeatureModel(apps=LimitationModel(size=1, limit=1))
    monkeypatch.setattr("services.app.console_gateway.FeatureService.get_features", lambda *_a, **_k: features)
    _mock_download(monkeypatch, b"app: {}" if is_yaml else _roster_archive().getvalue())
    if is_yaml:
        with pytest.raises(Forbidden, match="number of apps"):
            _post(app, imports, json={"mode": "yaml-url", "yaml_url": "https://example.com/download"})
        assert imports.agent_calls == []
        assert imports.dsl_calls == []
    else:
        data, status = _post(app, imports, json={"mode": "yaml-url", "yaml_url": "https://example.com/download"})
        assert status == 200
        assert data["app_mode"] == "agent"


def test_url_rejects_content_that_is_neither_yaml_nor_package(
    app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch
) -> None:
    fetched = _mock_download(monkeypatch, b"[invalid")
    with pytest.raises(InvalidRosterAgentPackageError):
        _post(app, imports, json={"mode": "yaml-url", "yaml_url": "https://example.com/download"})
    assert len(fetched) == 1


@pytest.mark.parametrize("has_warning", [False, True])
def test_existing_import_route_accepts_package_and_preserves_import_response(
    app: Flask, imports: Imports, has_warning: bool
) -> None:
    imports.warnings = (
        [DslImportWarning(code="agent_skill_missing", path="skills.s_000001", message="Missing Skill")]
        if has_warning
        else []
    )
    data, status = _post(app, imports, data={"file": (_roster_archive(), "agent.ifpkg")})
    assert status == 200
    assert data["app_id"] == "app-1"
    assert data["app_mode"] == "agent"
    assert data["status"] == ("completed-with-warnings" if has_warning else "completed")
    assert data["warnings"] == [warning.model_dump(mode="json") for warning in imports.warnings]
    assert data["id"]
    assert imports.agent_calls[0].content == _roster_archive().getvalue()


@pytest.mark.parametrize("from_url", [False, True])
@pytest.mark.parametrize("denied", [RBACPermission.AGENT_CREATE, RBACPermission.AGENT_IMPORT_EXPORT_DSL])
def test_package_import_checks_agent_permissions_before_materializing_resources(
    app: Flask,
    imports: Imports,
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    denied: RBACPermission,
    from_url: bool,
) -> None:
    config_overrides(RBAC_ENABLED=True)
    _mock_download(monkeypatch)
    scenes: list[RBACPermission] = []

    def check(*_args: object, scene: RBACPermission, **_kwargs: object) -> bool:
        scenes.append(scene)
        return scene != denied

    monkeypatch.setattr("services.app.console_gateway.rbac_service.RBACService.CheckAccess.check", check)
    kwargs: dict[str, dict[str, object]] = (
        {"json": {"mode": "yaml-url", "yaml_url": "https://example.com/agent.ifpkg"}}
        if from_url
        else {"data": {"file": (_roster_archive(), "agent.ifpkg")}}
    )
    with pytest.raises(Forbidden):
        _post(app, imports, **kwargs)
    assert denied in scenes
    if not from_url:
        assert RBACPermission.APP_IMPORT_EXPORT_DSL not in scenes
    assert imports.agent_calls == []


@pytest.mark.parametrize("from_url", [False, True])
def test_package_import_rejects_overwrite(
    app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, from_url: bool
) -> None:
    _mock_download(monkeypatch)
    kwargs: dict[str, dict[str, object]] = (
        {"json": {"mode": "yaml-url", "yaml_url": "https://example.com/agent.ifpkg", "app_id": "existing"}}
        if from_url
        else {"data": {"app_id": "existing", "file": (_roster_archive(), "agent.ifpkg")}}
    )
    with pytest.raises(InvalidRosterAgentPackageError, match="overwriting"):
        _post(app, imports, **kwargs)


@pytest.mark.parametrize("from_url", [False, True])
@pytest.mark.parametrize("app_id", [None, "existing"])
@pytest.mark.parametrize("status", [ImportStatus.COMPLETED, ImportStatus.PENDING, ImportStatus.FAILED])
def test_ordinary_package_import_uses_dsl_permissions_and_confirmation(
    app: Flask,
    imports: Imports,
    monkeypatch: pytest.MonkeyPatch,
    app_id: str | None,
    status: ImportStatus,
    from_url: bool,
) -> None:
    imports.status = status
    dsl = "kind: app\nversion: 99.0.0\napp:\n  mode: workflow\n"
    with AppPackageService().export(dsl=dsl, name="Workflow") as package:
        form: dict[str, object] = {"file": (package.archive, "workflow.ifpkg"), "name": "Renamed"}
        if app_id:
            form["app_id"] = app_id
        if from_url:
            _mock_download(monkeypatch, package.archive.read())
            data, code = _post(
                app,
                imports,
                json={
                    "mode": "yaml-url",
                    "yaml_url": "https://example.com/workflow.ifpkg",
                    "name": "Renamed",
                    "app_id": app_id,
                },
            )
        else:
            data, code = _post(app, imports, data=form)
    assert code == {ImportStatus.FAILED: 400, ImportStatus.PENDING: 202}.get(status, 200)
    assert len(imports.packages) == 1
    assert imports.packages[0].archive.closed
    assert data["status"] == status
    assert len(imports.dsl_calls) == 1
    assert (
        imports.dsl_calls[0].model_dump()
        == AppImportParams(mode="yaml-content", yaml_content=dsl, name="Renamed", app_id=app_id).model_dump()
    )
    assert imports.agent_calls == []


def test_export_query_rejects_conflicting_version_selectors() -> None:
    with pytest.raises(ValidationError, match="version_id and workflow_id cannot be used together"):
        app_module.AppExportQuery.model_validate(
            {"version_id": "11111111-1111-4111-8111-111111111111", "workflow_id": "workflow-1"}
        )


@pytest.mark.parametrize("quota", [False, True])
def test_ordinary_package_import_checks_permission_and_quota(
    app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None], quota: bool
) -> None:
    config_overrides(RBAC_ENABLED=not quota, DEPLOYMENT_EDITION="CLOUD" if quota else "COMMUNITY")
    monkeypatch.setattr(
        "services.app.console_gateway.rbac_service.RBACService.CheckAccess.check", lambda *_a, **_k: False
    )
    features = FeatureModel(apps=LimitationModel(size=1, limit=1))
    monkeypatch.setattr("services.app.console_gateway.FeatureService.get_features", lambda *_a, **_k: features)
    with AppPackageService().export(dsl="kind: app\napp: {mode: workflow}\n", name="Workflow") as package:
        with pytest.raises(Forbidden):
            _post(app, imports, data={"file": (package.archive, "workflow.ifpkg")})
    assert imports.dsl_calls == []
