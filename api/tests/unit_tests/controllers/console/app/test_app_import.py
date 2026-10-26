import io
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from inspect import unwrap
from typing import BinaryIO, Protocol, cast
from unittest.mock import Mock
from uuid import UUID, uuid4

import httpx
import pytest
from flask import Flask
from flask_restx import Resource
from pydantic import ValidationError
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

from constants.dsl_version import CURRENT_APP_DSL_VERSION
from controllers.console.app import app as app_module
from controllers.console.app import app_import as console
from controllers.console.app import app_import as controller
from controllers.console.app import app_import as import_module
from controllers.console.app.error import AppNotFoundError, DraftWorkflowNotSync
from controllers.inner_api.app import dsl as inner
from controllers.openapi import app_dsl as openapi
from controllers.openapi._errors import OpenApiErrorFormatter
from controllers.openapi._models import AppDslImportPayload
from core.rbac import RBACPermission
from enums import DeploymentEdition
from extensions.ext_redis import redis_client
from libs.external_api import ExternalApi
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode
from services import app_import_source
from services.agent.errors import InvalidRosterAgentPackageError
from services.agent.roster_package_importer import RosterAgentPackageImportResult
from services.app.console_gateway import AppTransferGateway, EnterpriseConsoleAppAccess
from services.app_dsl_service import AppDslService, PendingData
from services.app_package_service import AppPackageService, PreparedAppPackage
from services.billing_service import BillingService, _BillingHTTPStatusError
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.dsl_entities import AppImportPackage, AppImportParams, DslImportWarning, Import, ImportStatus
from services.entities.feature_entities import FeatureModel, LimitationModel
from services.errors.app import DraftChangedError
from services.errors.base import NoPermissionError
from services.feature_service import FeatureService
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.recommended_app_package_service import RecommendedAgentPackageSource, RecommendedAppPackageService
from services.system_feature_service import SystemFeatureService
from tests.helpers.unit.config_override import apply_config_overrides
from tests.unit_tests.controllers.conftest import ControllerTestServices

"""Console imports finalize persistence before publishing permissions and access settings."""


class TestAppImportApiCases:
    @staticmethod
    @pytest.fixture
    def import_context(sqlite_session_factory: sessionmaker[Session]) -> RequestContext:
        account_id, tenant_id = str(uuid4()), str(uuid4())
        account = Account(name="Importer", email="importer@example.com")
        account.id = account_id
        tenant = Tenant(name="Workspace")
        tenant.id = tenant_id
        with sqlite_session_factory.begin() as session:
            session.add_all(
                [
                    account,
                    tenant,
                    TenantAccountJoin(tenant_id=tenant_id, account_id=account_id, role=TenantAccountRole.OWNER),
                ]
            )
        return RequestContext("import-request", None, account_id, tenant_id)

    @staticmethod
    @pytest.fixture
    def connections(sqlite_engine: Engine) -> Iterator[set[object]]:
        checked_out: set[object] = set()

        def checkout(connection: object, *_args: object) -> None:
            checked_out.add(connection)

        def checkin(connection: object, *_args: object) -> None:
            checked_out.remove(connection)

        event.listen(sqlite_engine, "checkout", checkout)
        event.listen(sqlite_engine, "checkin", checkin)
        try:
            yield checked_out
            assert not checked_out
        finally:
            event.remove(sqlite_engine, "checkout", checkout)
            event.remove(sqlite_engine, "checkin", checkin)

    @staticmethod
    @pytest.mark.usefixtures("app_query_services")
    @pytest.mark.parametrize("confirm", [False, True])
    @pytest.mark.parametrize("overwrite", [False, True])
    @pytest.mark.parametrize("status", list(ImportStatus))
    def test_import_transaction_and_response_contract(
        app: Flask,
        sqlite_session_factory: sessionmaker[Session],
        import_context: RequestContext,
        connections: set[object],
        monkeypatch: pytest.MonkeyPatch,
        config_overrides,
        status: ImportStatus,
        overwrite: bool,
        confirm: bool,
    ) -> None:
        config_overrides(RBAC_ENABLED=True, DEPLOYMENT_EDITION="COMMUNITY")
        monkeypatch.setattr(
            "services.app.console_gateway.rbac_service.RBACService.CheckAccess.check", lambda *a, **k: True
        )
        app_id = str(uuid4())
        result = Import(id="import-1", status=status, app_id=app_id, app_created=not overwrite)
        pending = PendingData(
            tenant_id=import_context.active_workspace_id,
            account_id=import_context.account_id,
            import_mode="yaml-content",
            yaml_content="app: {}",
            app_id=app_id if overwrite else None,
        )
        monkeypatch.setattr(redis_client, "get", lambda _key: pending.model_dump_json())

        def persist(dsl: AppDslService, *, account: Account, **_kwargs) -> Import:
            assert not connections, "Actor lookup must release its connection before starting the DSL operation"
            assert account.id == import_context.account_id
            assert account.current_tenant_id == import_context.active_workspace_id
            dsl._session.add(
                App(
                    id=app_id,
                    tenant_id=account.current_tenant_id,
                    name="Imported",
                    mode=AppMode.WORKFLOW,
                    enable_site=True,
                    enable_api=True,
                )
            )
            dsl._session.flush()
            return result

        monkeypatch.setattr(AppDslService, "confirm_import" if confirm else "import_app", persist)
        permissions: list[str] = []
        access_updates: list[tuple[str, str]] = []

        def get_permissions(_self, context: RequestContext, imported_id: str) -> list[str]:
            assert not connections
            assert context == import_context
            with sqlite_session_factory() as session:
                assert session.get(App, imported_id) is not None
            permissions.append(imported_id)
            return ["app.acl.view_layout"]

        def update_access(imported_id: str, access_mode: str) -> None:
            assert not connections, "WebApp access initialization must follow transaction completion"
            access_updates.append((imported_id, access_mode))

        monkeypatch.setattr(EnterpriseConsoleAppAccess, "created_permissions", get_permissions)
        monkeypatch.setattr(SystemFeatureService, "is_webapp_auth_enabled", lambda: True)
        monkeypatch.setattr(EnterpriseService.WebAppAuth, "update_app_access_mode", update_access)
        with app.test_request_context(
            method="POST",
            json={
                "mode": "yaml-content",
                "yaml_content": "app: {}",
                "app_id": app_id if overwrite else None,
            },
        ):
            if confirm:
                api = controller.AppImportConfirmApi()
                response, status_code = unwrap(api.post)(api, import_context, import_id="import-1")
            else:
                api = controller.AppImportApi()
                response, status_code = unwrap(api.post)(api, import_context)
        with sqlite_session_factory() as session:
            assert (session.get(App, app_id) is not None) is (status != ImportStatus.FAILED)
        completed = status in {ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS}
        assert permissions == ([app_id] if completed and not overwrite else [])
        assert response["permission_keys"] == (["app.acl.view_layout"] if permissions else [])
        # Overwrites keep the existing web app access mode; only completed creations get the private default.
        assert access_updates == ([(app_id, "private")] if completed and not overwrite else [])
        assert status_code == (
            400 if status == ImportStatus.FAILED else 202 if status == ImportStatus.PENDING and not confirm else 200
        )

    @staticmethod
    @pytest.mark.usefixtures("app_query_services")
    @pytest.mark.parametrize("missing", [False, True])
    def test_check_dependencies_releases_database_before_plugin_io(
        app: Flask,
        import_context: RequestContext,
        sqlite_session_factory: sessionmaker[Session],
        connections: set[object],
        monkeypatch: pytest.MonkeyPatch,
        missing: bool,
    ) -> None:
        app_id = str(uuid4())
        if not missing:
            with sqlite_session_factory.begin() as session:
                session.add(
                    App(
                        id=app_id,
                        tenant_id=import_context.active_workspace_id,
                        name="Imported",
                        mode=AppMode.CHAT,
                        enable_site=True,
                        enable_api=True,
                    )
                )
        monkeypatch.setattr(redis_client, "get", lambda _key: '{"dependencies":[]}')
        called = []

        def check(*, tenant_id: str, dependencies):
            assert not connections
            assert tenant_id == import_context.active_workspace_id
            called.append(dependencies)
            return []

        monkeypatch.setattr(DependenciesAnalysisService, "get_leaked_dependencies", check)
        api = controller.AppImportCheckDependenciesApi()
        with app.test_request_context():
            if missing:
                with pytest.raises(AppNotFoundError):
                    unwrap(api.get)(api, import_context, app_id=app_id)
                assert called == []
            else:
                response, code = unwrap(api.get)(api, import_context, app_id=app_id)
                assert code == 200
                assert response == {"leaked_dependencies": []}
                assert called == [[]]

    @staticmethod
    @pytest.mark.parametrize("confirm", [False, True])
    def test_permission_errors_are_mapped_at_http_boundary(
        app_query_services, app: Flask, monkeypatch, confirm: bool
    ) -> None:
        def denied(*_args, **_kwargs):
            raise NoPermissionError("Import denied")

        monkeypatch.setattr(app_query_services.apps.console, "confirm_import" if confirm else "import_app", denied)
        context = RequestContext("request", None, "actor", "workspace")
        with app.test_request_context(method="POST", json={"mode": "yaml-content"}):
            if confirm:
                api = controller.AppImportConfirmApi()
                with pytest.raises(Forbidden, match="Import denied"):
                    unwrap(api.post)(api, context, import_id="import-1")
            else:
                api = controller.AppImportApi()
                with pytest.raises(Forbidden, match="Import denied"):
                    unwrap(api.post)(api, context)

    @staticmethod
    def test_confirming_an_import_whose_draft_changed_is_a_conflict(
        app_query_services, app: Flask, monkeypatch
    ) -> None:
        """A pending openapi import carries a draft_hash; a console confirm after the draft changed must not 500."""

        def changed(*_args, **_kwargs):
            raise DraftChangedError()

        monkeypatch.setattr(app_query_services.apps.console, "confirm_import", changed)
        context = RequestContext("request", None, "actor", "workspace")
        with app.test_request_context(method="POST"):
            api = controller.AppImportConfirmApi()
            with pytest.raises(DraftWorkflowNotSync) as exc_info:
                unwrap(api.post)(api, context, import_id="import-1")

        assert exc_info.value.code == 409

    @staticmethod
    def test_import_response_schema_hides_creation_marker() -> None:
        assert "app_created" not in controller.console_ns.models[Import.__name__].__schema__["properties"]


def _roster_archive() -> io.BytesIO:
    source = io.BytesIO()
    with zipfile.ZipFile(source, "w") as archive:
        # Fixed timestamp: passing a filename string stamps the current local
        # time (2-second ZIP resolution), so two archives built across a
        # timestamp boundary differ byte-for-byte and flake the assertion below.
        info = zipfile.ZipInfo("manifest.yaml", date_time=(1980, 1, 1, 0, 0, 0))
        archive.writestr(info, "format: dify.roster-agent")
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
    app_created: bool = False
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
        return Import(id="import-1", status=self.status, app_id="app-1", app_created=self.app_created)

    def agent(self, *, source: BinaryIO, tenant_id: str, account: Account) -> RosterAgentPackageImportResult:
        self.agent_calls.append(AgentImportCall(tenant_id, account, source.read()))
        return RosterAgentPackageImportResult(app_id="app-1", agent_id="agent-1", warnings=self.warnings)


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


class TestRosterPackageRoutesCases:
    @staticmethod
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

    @staticmethod
    def test_existing_import_route_dispatches_json_without_changing_payload(app: Flask, imports: Imports) -> None:
        data, status = _post(app, imports, json={"mode": "yaml-content", "yaml_content": "app: {}"})
        assert status == 200
        assert data["status"] == "completed"
        assert [params.model_dump() for params in imports.dsl_calls] == [
            AppImportParams(mode="yaml-content", yaml_content="app: {}").model_dump()
        ]
        assert imports.agent_calls == []

    @staticmethod
    @pytest.mark.parametrize(
        "url",
        [
            "https://example.com/download?id=123",
            "https://example.com/agent.ifpkg",
            " https://example.com/agent.IFPKG?token=secret#download ",
        ],
    )
    def test_package_url_uses_agent_import(
        app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, url: str
    ) -> None:
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

    @staticmethod
    @pytest.mark.parametrize(
        "url", ["https://example.com/app.yaml", "https://example.com/download", "https://example.com/agent.ifpkg"]
    )
    def test_yaml_url_keeps_dsl_import_without_package_retry(
        app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, url: str
    ) -> None:
        imports.status = ImportStatus.FAILED
        fetched = _mock_download(monkeypatch, b"app: {}")
        _, status = _post(
            app, imports, json={"mode": "yaml-url", "yaml_url": url, "app_id": "existing", "name": "Renamed"}
        )
        assert status == 400
        assert (
            imports.dsl_calls[0].model_dump()
            == AppImportParams(
                mode="yaml-content", yaml_content="app: {}", app_id="existing", name="Renamed"
            ).model_dump()
        )
        assert len(fetched) == 1
        assert imports.agent_calls == []

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize("is_yaml", [False, True])
    def test_url_quota_is_enforced_after_content_detection(
        app: Flask,
        imports: Imports,
        app_query_services: ControllerTestServices,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        is_yaml: bool,
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION="CLOUD")
        transfers = app_query_services.apps.console._transfers
        assert isinstance(transfers, AppTransferGateway)
        monkeypatch.setattr(transfers, "import_dsl", AppTransferGateway.import_dsl.__get__(transfers))
        features = FeatureModel(apps=LimitationModel(size=1, limit=1))
        monkeypatch.setattr("services.app_dsl_service.FeatureService.get_features", lambda *_a, **_k: features)
        _mock_download(monkeypatch, b"app: {mode: workflow}" if is_yaml else _roster_archive().getvalue())
        if is_yaml:
            with pytest.raises(Forbidden, match="number of apps"):
                _post(app, imports, json={"mode": "yaml-url", "yaml_url": "https://example.com/download"})
            assert imports.agent_calls == []
            assert imports.dsl_calls == []
        else:
            data, status = _post(app, imports, json={"mode": "yaml-url", "yaml_url": "https://example.com/download"})
            assert status == 200
            assert data["app_mode"] == "agent"

    @staticmethod
    def test_url_rejects_content_that_is_neither_yaml_nor_package(
        app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fetched = _mock_download(monkeypatch, b"[invalid")
        with pytest.raises(InvalidRosterAgentPackageError):
            _post(app, imports, json={"mode": "yaml-url", "yaml_url": "https://example.com/download"})
        assert len(fetched) == 1

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize("from_url", [False, True])
    @pytest.mark.parametrize("overwrite", [False, True])
    def test_ordinary_package_import_keeps_access_mode_on_overwrite(
        app: Flask, imports: Imports, monkeypatch: pytest.MonkeyPatch, overwrite: bool, from_url: bool
    ) -> None:
        imports.app_created = not overwrite
        access_updates: list[tuple[str, str]] = []
        monkeypatch.setattr("services.app.console_gateway.SystemFeatureService.is_webapp_auth_enabled", lambda: True)
        monkeypatch.setattr(
            EnterpriseService.WebAppAuth,
            "update_app_access_mode",
            lambda app_id, access_mode: access_updates.append((app_id, access_mode)),
        )
        app_id = "app-1" if overwrite else None
        with AppPackageService().export(dsl="kind: app\napp:\n  mode: workflow\n", name="Workflow") as package:
            if from_url:
                _mock_download(monkeypatch, package.archive.read())
                _data, code = _post(
                    app,
                    imports,
                    json={"mode": "yaml-url", "yaml_url": "https://example.com/workflow.ifpkg", "app_id": app_id},
                )
            else:
                form: dict[str, object] = {"file": (package.archive, "workflow.ifpkg")}
                if app_id:
                    form["app_id"] = app_id
                _data, code = _post(app, imports, data=form)
        assert code == 200
        assert access_updates == ([] if overwrite else [("app-1", "private")])

    @staticmethod
    def test_export_query_rejects_conflicting_version_selectors() -> None:
        with pytest.raises(ValidationError, match="version_id and workflow_id cannot be used together"):
            app_module.AppExportQuery.model_validate(
                {"version_id": "11111111-1111-4111-8111-111111111111", "workflow_id": "workflow-1"}
            )

    @staticmethod
    def test_template_import_resolves_catalog_source_and_preserves_overrides(
        app: Flask, imports: Imports, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        transfers = app_query_services.apps.console._transfers
        assert isinstance(transfers, AppTransferGateway)
        template_id = UUID("11111111-1111-4111-8111-111111111111")
        version_id = UUID("22222222-2222-4222-8222-222222222222")
        source = RecommendedAgentPackageSource("source-tenant", "source-agent", version_id)
        catalog = Mock()
        catalog.get_package_source.return_value = source
        transfers._recommended_packages = RecommendedAppPackageService(sources=catalog, exporter=Mock())
        import_template = Mock(return_value=RosterAgentPackageImportResult("new-app", "new-agent", []))
        monkeypatch.setattr(transfers._agent_importer, "import_template", import_template)

        data, status = _post(
            app,
            imports,
            json={
                "mode": "template",
                "template_id": str(template_id),
                "version_id": str(version_id),
                "name": "My Agent",
                "app_id": "",
            },
        )

        assert status == 200
        assert data["app_id"] == "new-app"
        assert data["app_mode"] == "agent"
        catalog.get_package_source.assert_called_once_with(str(template_id), version_id)
        import_template.assert_called_once()
        assert import_template.call_args.kwargs["source"] == source
        assert import_template.call_args.kwargs["tenant_id"] == imports.context.active_workspace_id
        assert import_template.call_args.kwargs["account"].id == imports.context.account_id
        assert import_template.call_args.kwargs["name"] == "My Agent"

    @staticmethod
    def test_template_import_rejects_unlisted_source(
        app: Flask, imports: Imports, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        transfers = app_query_services.apps.console._transfers
        assert isinstance(transfers, AppTransferGateway)
        catalog = Mock()
        catalog.get_package_source.return_value = None
        transfers._recommended_packages = RecommendedAppPackageService(sources=catalog, exporter=Mock())
        import_template = Mock()
        monkeypatch.setattr(transfers._agent_importer, "import_template", import_template)

        with pytest.raises(import_module.RecommendedAppNotFoundHttpError):
            _post(
                app,
                imports,
                json={
                    "mode": "template",
                    "template_id": "11111111-1111-4111-8111-111111111111",
                    "version_id": "22222222-2222-4222-8222-222222222222",
                },
            )
        import_template.assert_not_called()

    @staticmethod
    def test_package_url_import_preserves_overrides(
        app: Flask, imports: Imports, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        transfers = app_query_services.apps.console._transfers
        assert isinstance(transfers, AppTransferGateway)
        import_url = Mock(return_value=RosterAgentPackageImportResult("new-app", "new-agent", []))
        monkeypatch.setattr(transfers._agent_importer, "import_package_url", import_url)

        data, status = _post(
            app,
            imports,
            json={"mode": "ifpkg-url", "package_url": "https://example.com/agent.ifpkg", "name": "My Agent"},
        )

        assert status == 200
        assert data["app_id"] == "new-app"
        import_url.assert_called_once()
        assert import_url.call_args.kwargs["url"] == "https://example.com/agent.ifpkg"
        assert import_url.call_args.kwargs["name"] == "My Agent"

    @staticmethod
    def test_package_url_retains_legacy_optional_selectors(
        app: Flask, imports: Imports, app_query_services: ControllerTestServices, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        transfers = app_query_services.apps.console._transfers
        assert isinstance(transfers, AppTransferGateway)
        import_url = Mock(return_value=RosterAgentPackageImportResult("new-app", "new-agent", []))
        monkeypatch.setattr(transfers._agent_importer, "import_package_url", import_url)

        data, status = _post(
            app,
            imports,
            json={
                "mode": "ifpkg-url",
                "package_url": "https://example.com/agent.ifpkg",
                "app_id": "",
                "template_id": "11111111-1111-4111-8111-111111111111",
                "version_id": "22222222-2222-4222-8222-222222222222",
            },
        )

        assert status == 200
        assert data["app_id"] == "new-app"
        import_url.assert_called_once()
        assert import_url.call_args.kwargs["url"] == "https://example.com/agent.ifpkg"

    @staticmethod
    @pytest.mark.parametrize("mode", ["template", "ifpkg-url"])
    def test_template_import_checks_permissions_before_accessing_source(
        app: Flask,
        imports: Imports,
        app_query_services: ControllerTestServices,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        mode: str,
    ) -> None:
        config_overrides(RBAC_ENABLED=True)
        monkeypatch.setattr(
            "services.app.console_gateway.rbac_service.RBACService.CheckAccess.check", lambda *_a, **_k: False
        )
        transfers = app_query_services.apps.console._transfers
        assert isinstance(transfers, AppTransferGateway)
        importer = Mock()
        monkeypatch.setattr(transfers, "_agent_importer", importer)
        payload: dict[str, object] = (
            {
                "mode": "template",
                "template_id": "11111111-1111-4111-8111-111111111111",
                "version_id": "22222222-2222-4222-8222-222222222222",
            }
            if mode == "template"
            else {"mode": "ifpkg-url", "package_url": "https://example.com/agent.ifpkg"}
        )
        with pytest.raises(Forbidden):
            _post(app, imports, json=payload)
        importer.assert_not_called()

    @staticmethod
    @pytest.mark.parametrize(
        "extra",
        [
            {"app_id": "existing"},
            {"yaml_content": "app: {}"},
        ],
    )
    def test_package_url_rejects_ambiguous_sources(app: Flask, imports: Imports, extra: dict[str, str]) -> None:
        with pytest.raises(InvalidRosterAgentPackageError):
            _post(app, imports, json={"mode": "ifpkg-url", "package_url": "https://example.com/agent.ifpkg", **extra})

    @staticmethod
    @pytest.mark.parametrize("quota", [False, True])
    def test_ordinary_package_import_checks_permission_and_quota(
        app: Flask,
        imports: Imports,
        app_query_services: ControllerTestServices,
        monkeypatch: pytest.MonkeyPatch,
        config_overrides: Callable[..., None],
        quota: bool,
    ) -> None:
        config_overrides(RBAC_ENABLED=not quota, DEPLOYMENT_EDITION="CLOUD" if quota else "COMMUNITY")
        transfers = app_query_services.apps.console._transfers
        assert isinstance(transfers, AppTransferGateway)
        monkeypatch.setattr(transfers, "import_dsl", AppTransferGateway.import_dsl.__get__(transfers))
        monkeypatch.setattr(
            "services.app.console_gateway.rbac_service.RBACService.CheckAccess.check", lambda *_a, **_k: False
        )
        features = FeatureModel(apps=LimitationModel(size=1, limit=1))
        monkeypatch.setattr("services.app_dsl_service.FeatureService.get_features", lambda *_a, **_k: features)
        with AppPackageService().export(dsl="kind: app\napp: {mode: workflow}\n", name="Workflow") as package:
            with pytest.raises(Forbidden):
                _post(app, imports, data={"file": (package.archive, "workflow.ifpkg")})
        assert imports.dsl_calls == []


"""Quota failures retain their HTTP semantics across both app import surfaces."""


class _EndpointView(Protocol):
    __handler__: Callable[..., tuple[object, int]]


class TestAppImportQuotaCases:
    @staticmethod
    @pytest.mark.parametrize(
        ("surface", "confirm"),
        [("console", False), ("console", True), ("openapi", False), ("openapi", True), ("inner", False)],
    )
    @pytest.mark.parametrize("failure", ["timeout", "upstream_503", "invalid_response", "quota_exhausted"])
    def test_import_quota_failure_http_status(
        app_query_services: ControllerTestServices,
        sqlite_session: Session,
        monkeypatch: pytest.MonkeyPatch,
        surface: str,
        confirm: bool,
        failure: str,
    ) -> None:
        apply_config_overrides(
            monkeypatch, DEPLOYMENT_EDITION=DeploymentEdition.CLOUD, INNER_API=True, INNER_API_KEY="test-inner-api-key"
        )
        monkeypatch.setattr("controllers.console.wraps._is_setup_completed", lambda: True)
        account = Account(name="Importer", email="importer@example.com")
        tenant = Tenant(name="Workspace")
        account.id, tenant.id = str(uuid4()), str(uuid4())
        sqlite_session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER),
            ]
        )
        sqlite_session.commit()
        context = RequestContext("request-1", None, account.id, tenant.id)
        content = (
            f"version: {CURRENT_APP_DSL_VERSION}\napp: {{name: Imported, mode: workflow}}\n"
            "workflow: {graph: {nodes: [], edges: []}, features: {}}\n"
        )
        pending = PendingData(
            tenant_id=tenant.id, account_id=account.id, import_mode="yaml-content", yaml_content=content
        )
        monkeypatch.setattr(redis_client, "get", lambda _: pending.model_dump_json())

        def unexpected_side_effect(*_args: object, **_kwargs: object) -> None:
            pytest.fail("A failed quota check must preserve pending data and avoid database writes")

        monkeypatch.setattr(redis_client, "delete", unexpected_side_effect)
        monkeypatch.setattr(AppDslService, "_create_or_update_app", unexpected_side_effect)
        if failure == "quota_exhausted":
            monkeypatch.setattr(
                FeatureService,
                "get_features",
                lambda *_args, **_kwargs: FeatureModel(apps=LimitationModel(size=5, limit=5)),
            )
        else:

            def failed_billing(*_args: object, **_kwargs: object) -> dict[str, str]:
                if failure == "timeout":
                    raise httpx.ReadTimeout("Private billing timeout details")
                if failure == "upstream_503":
                    raise _BillingHTTPStatusError("Private billing failure details", 503)
                return {"subscription": "Private invalid billing response"}

            monkeypatch.setattr(BillingService, "_send_request", failed_billing)

        app = Flask(__name__)
        app.config["TESTING"] = True
        app.extensions["application_services"] = app_query_services
        api = ExternalApi(app, error_body_formatter=OpenApiErrorFormatter() if surface == "openapi" else None)

        class AdmittedImport(Resource):
            def post(self) -> tuple[object, int]:
                if surface == "inner":
                    return inner.EnterpriseAppDSLImport().post(workspace_id=tenant.id)
                if surface == "console":
                    if confirm:
                        controller = console.AppImportConfirmApi()
                        return unwrap(controller.post)(controller, context, import_id="pending-1")
                    controller = console.AppImportApi()
                    return unwrap(controller.post)(controller, context)
                if confirm:
                    controller = openapi.AppDslImportConfirmApi()
                    return cast(_EndpointView, controller.post).__handler__(
                        controller, context, workspace_id=tenant.id, import_id="pending-1"
                    )
                controller = openapi.AppDslImportApi()
                return cast(_EndpointView, controller.post).__handler__(
                    controller,
                    context,
                    workspace_id=tenant.id,
                    body=AppDslImportPayload(mode="yaml-content", yaml_content=content),
                )

        api.add_resource(AdmittedImport, "/imports")
        response = app.test_client().post(
            "/imports",
            json={"mode": "yaml-content", "yaml_content": content, "creator_email": account.email},
            headers={"X-Inner-Api-Key": "test-inner-api-key"},
        )

        assert response.status_code == (403 if failure == "quota_exhausted" else 500)
        assert "Private" not in response.get_data(as_text=True)
        assert sqlite_session.scalar(select(App.id).where(App.tenant_id == tenant.id)) is None
