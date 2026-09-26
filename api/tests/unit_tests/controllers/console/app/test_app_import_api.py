"""Console imports finalize persistence before publishing permissions and access settings."""

from collections.abc import Iterator
from inspect import unwrap
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Forbidden

from controllers.console.app import app_import as controller
from controllers.console.app.error import AppNotFoundError
from extensions.ext_redis import redis_client
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode
from services.app.console_gateway import EnterpriseConsoleAppAccess
from services.app_dsl_service import AppDslService, PendingData
from services.enterprise.enterprise_service import EnterpriseService
from services.entities.dsl_entities import Import, ImportStatus
from services.errors.account import NoPermissionError
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.system_feature_service import SystemFeatureService


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
    monkeypatch.setattr("services.app.console_gateway.rbac_service.RBACService.CheckAccess.check", lambda *a, **k: True)
    app_id = str(uuid4())
    result = Import(id="import-1", status=status, app_id=app_id)
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
    assert access_updates == ([] if confirm else [(app_id, "private")])
    assert status_code == (
        400 if status == ImportStatus.FAILED else 202 if status == ImportStatus.PENDING and not confirm else 200
    )


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
