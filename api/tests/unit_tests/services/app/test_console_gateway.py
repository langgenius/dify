"""Policy and existing DSL adapters retain their domain-specific behavior."""

from collections.abc import Callable, Generator, Iterator
from typing import cast
from uuid import uuid4
from zipfile import ZipFile

import pytest
import yaml
from sqlalchemy import Engine, event, select
from sqlalchemy.exc import InvalidRequestError
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.entities.plugin import PluginDependency, PluginInstallation
from core.plugin.impl.plugin import PluginInstaller
from enums import CloudPlan, DeploymentEdition
from extensions.application_services.app import AppServices
from machinery.context import RequestContext
from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode, AppModelConfig, IconType
from models.workflow import Workflow, WorkflowType
from services.agent.package_resource_exporter import AgentPackageResourceExporter
from services.agent.roster_package_exporter import RosterAgentPackageExporter
from services.agent.roster_package_importer import RosterAgentPackageImporter
from services.agent.roster_service import AgentRosterService
from services.app.console_gateway import AppTransferGateway, EnterpriseConsoleAppAccess
from services.app.console_service import ConsoleAppNotFoundError, InvalidAppAccessModesError
from services.app_dsl_service import AppDslService
from services.app_package_service import AppPackageService, PreparedAppPackage
from services.enterprise.enterprise_service import EnterpriseService, WebAppSettings
from services.entities.app_entities import (
    AppExportOptions,
    CopyAppParams,
)
from services.entities.dsl_entities import AppDslExportData, AppImportPackage, AppImportParams, Import, ImportStatus
from services.plugin.dependencies_analysis import DependenciesAnalysisService
from services.system_feature_service import SystemFeatureService
from services.workflow_service import WorkflowService
from tests.unit_tests.model_factories import make_account, make_tenant, make_upload_file


@pytest.fixture
def copy_source(sqlite_session_factory: sessionmaker[Session]) -> tuple[RequestContext, str]:
    actor, workspace, app_id = str(uuid4()), str(uuid4()), str(uuid4())
    account = make_account(account_id=actor, name="Creator", email=f"{actor}@example.com")
    tenant = make_tenant(tenant_id=workspace, name="Workspace")
    with sqlite_session_factory.begin() as session:
        app = App(id=app_id, tenant_id=workspace, name="Original", mode=AppMode.CHAT, enable_site=True, enable_api=True)
        config = AppModelConfig(app_id=app_id, model="{}")
        session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(tenant_id=workspace, account_id=actor, role=TenantAccountRole.OWNER),
                app,
                config,
            ]
        )
        session.flush()
        app.app_model_config_id = config.id
    return RequestContext("request", None, actor, workspace), app_id


@pytest.fixture
def copy_connections(sqlite_engine: Engine) -> Iterator[set[object]]:
    connections: set[object] = set()

    def checkout(connection: object, *_args: object) -> None:
        connections.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        connections.remove(connection)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield connections
        assert not connections
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


@pytest.mark.parametrize("status", list(ImportStatus))
@pytest.mark.parametrize("missing_settings", [False, True])
def test_copy_finishes_transactions_before_external_access(
    app_services: AppServices,
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    copy_source: tuple[RequestContext, str],
    copy_connections: set[object],
    monkeypatch: pytest.MonkeyPatch,
    status: ImportStatus,
    missing_settings: bool,
) -> None:
    context, source_id = copy_source
    copied_id = str(uuid4())
    calls: list[str] = []
    commits: list[Session] = []

    def committed(session: Session) -> None:
        if session.get_bind() is sqlite_engine:
            commits.append(session)

    def dependencies(*, tenant_id: str, dependencies: list[str]) -> list[PluginDependency]:
        assert tenant_id == context.active_workspace_id
        assert dependencies == []
        assert not copy_connections, "Export must close its read transaction before resolving plugin metadata"
        assert commits == [], "A read-only export must not commit"
        calls.append("plugins")
        return []

    def persist(dsl: AppDslService, *, account: Account, yaml_content: str, name: str, **_kwargs: object) -> Import:
        assert not copy_connections
        assert account.id == context.account_id
        assert account.current_tenant_id == context.active_workspace_id
        assert yaml.safe_load(yaml_content)["app"]["name"] == "Original"
        assert name == "Copy"
        dsl._session.add(
            App(
                id=copied_id,
                tenant_id=context.active_workspace_id,
                name=name,
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
            )
        )
        dsl._session.flush()
        return Import(id="import-1", status=status, app_id=copied_id)

    def get_access(app_id: str) -> WebAppSettings:
        assert not copy_connections
        assert app_id == source_id
        calls.append("read_access")
        if missing_settings:
            raise ValueError("No settings")
        return WebAppSettings(accessMode="private")

    def set_access(app_id: str, access_mode: str) -> None:
        assert not copy_connections
        assert app_id == copied_id
        assert access_mode == ("public" if missing_settings else "private")
        with sqlite_session_factory() as session:
            assert session.get(App, copied_id) is not None
        calls.append("write_access")

    def permissions(_self: EnterpriseConsoleAppAccess, caller: RequestContext, app_id: str) -> list[str]:
        assert not copy_connections
        assert caller == context
        assert app_id == copied_id
        calls.append("permissions")
        return ["app.edit"]

    monkeypatch.setattr(DependenciesAnalysisService, "generate_dependencies", dependencies)
    monkeypatch.setattr(AppDslService, "import_app", persist)
    monkeypatch.setattr(SystemFeatureService, "is_webapp_auth_enabled", lambda: True)
    monkeypatch.setattr(EnterpriseService.WebAppAuth, "get_app_access_mode_by_id", get_access)
    monkeypatch.setattr(EnterpriseService.WebAppAuth, "update_app_access_mode", set_access)
    monkeypatch.setattr(EnterpriseConsoleAppAccess, "created_permissions", permissions)
    event.listen(Session, "after_commit", committed)
    try:
        result, copied = app_services.console.copy(context, source_id, CopyAppParams(name="Copy"))
    finally:
        event.remove(Session, "after_commit", committed)

    completed = status in {ImportStatus.COMPLETED, ImportStatus.COMPLETED_WITH_WARNINGS}
    assert result.status == status
    assert not copy_connections
    assert len(commits) == int(completed)
    with sqlite_session_factory() as session:
        assert (session.get(App, copied_id) is not None) is completed
    assert calls == (["plugins", "read_access", "write_access", "permissions"] if completed else ["plugins"])
    if completed:
        assert copied is not None
        assert copied.id == copied_id
        assert copied.permission_keys == ["app.edit"]
    else:
        assert copied is None


def test_copy_rejects_foreign_import_result_before_external_effects(
    app_services: AppServices,
    sqlite_session_factory: sessionmaker[Session],
    copy_source: tuple[RequestContext, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context, source_id = copy_source
    foreign_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            App(
                id=foreign_id,
                tenant_id=str(uuid4()),
                name="Foreign",
                mode=AppMode.CHAT,
                enable_site=True,
                enable_api=True,
            )
        )

    def unexpected_effect(*_args: object, **_kwargs: object) -> None:
        pytest.fail("A foreign import result must not receive access or permission updates")

    monkeypatch.setattr(DependenciesAnalysisService, "generate_dependencies", lambda **_kwargs: [])
    monkeypatch.setattr(
        AppDslService,
        "import_app",
        lambda *_args, **_kwargs: Import(id="import-1", status=ImportStatus.COMPLETED, app_id=foreign_id),
    )
    monkeypatch.setattr(EnterpriseConsoleAppAccess, "inherit_access", unexpected_effect)
    monkeypatch.setattr(EnterpriseConsoleAppAccess, "created_permissions", unexpected_effect)
    with pytest.raises(ConsoleAppNotFoundError):
        app_services.console.copy(context, source_id, CopyAppParams())


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
def test_only_cloud_version_export_consults_workspace_plan(
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    sqlite_session_factory: sessionmaker[Session],
    edition: DeploymentEdition,
    plan: CloudPlan,
    allowed: bool,
) -> None:
    config_overrides(DEPLOYMENT_EDITION=edition)
    calls = []

    def get_plan(workspace_id: str) -> CloudPlan:
        calls.append(workspace_id)
        return plan

    monkeypatch.setattr("services.app.console_gateway.FeatureService.get_workspace_plan", get_plan)
    gateway = EnterpriseConsoleAppAccess(session_factory=sqlite_session_factory)
    assert gateway.can_export_version("workspace") is allowed
    assert calls == (["workspace"] if edition == DeploymentEdition.CLOUD else [])


def test_access_mode_batch_validates_completeness(
    monkeypatch: pytest.MonkeyPatch, sqlite_session_factory: sessionmaker[Session]
) -> None:
    monkeypatch.setattr("services.app.console_gateway.SystemFeatureService.is_webapp_auth_enabled", lambda: True)
    monkeypatch.setattr(
        "services.app.console_gateway.EnterpriseService.WebAppAuth.batch_get_app_access_mode_by_id",
        lambda **_kwargs: {},
    )
    gateway = EnterpriseConsoleAppAccess(session_factory=sqlite_session_factory)
    with pytest.raises(InvalidAppAccessModesError):
        gateway.access_modes(["app"])


@pytest.mark.parametrize(
    "mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT, AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT]
)
def test_dsl_export_uses_owned_short_session_and_preserves_selectors(sqlite_engine: Engine, mode: AppMode) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    app_id, workspace = str(uuid4()), str(uuid4())
    with factory.begin() as session:
        session.add(App(id=app_id, tenant_id=workspace, name="Example", mode=mode, enable_site=True, enable_api=True))
    calls = []
    opened = []

    class Dsl:
        def __init__(self, session: Session) -> None:
            opened.append(session)

        def load_export_data(self, **kwargs: object) -> AppDslExportData:
            calls.append(kwargs)
            assert kwargs["session"] is opened[-1]
            return AppDslExportData(workspace, {"kind": "app", "app": {"mode": mode}}, [])

        @staticmethod
        def serialize_export_data(prepared: AppDslExportData) -> str:
            assert prepared.tenant_id == workspace
            return f"kind: app\napp: {{mode: {mode}}}"

    gateway = AppTransferGateway(
        session_factory=factory,
        dsl_factory=cast(Callable[[Session], AppDslService], Dsl),
        packages=AppPackageService(),
        agent_packages=RosterAgentPackageExporter(),
        agent_importer=RosterAgentPackageImporter(),
    )
    context = RequestContext("request", None, "actor", workspace)
    options = AppExportOptions(include_secret=True, workflow_id="workflow")
    dsl = gateway.export_dsl(context, app_id, options)
    exported_app = calls[0]["app_model"]
    assert isinstance(exported_app, App)
    assert exported_app.id == app_id
    assert calls[0]["include_secret"] is True
    assert calls[0]["workflow_id"] == "workflow"
    with pytest.raises(InvalidRequestError):
        opened[0].execute(select(App))
    with pytest.raises(ConsoleAppNotFoundError):
        gateway.export_dsl(context._replace(active_workspace_id=str(uuid4())), app_id, options)
    assert len(calls) == 1


@pytest.mark.parametrize(
    "mode",
    [AppMode.CHAT, AppMode.COMPLETION, AppMode.AGENT_CHAT, AppMode.WORKFLOW, AppMode.ADVANCED_CHAT, AppMode.AGENT],
)
@pytest.mark.parametrize("remote_fails", [False, True])
def test_real_dsl_export_releases_connection_before_plugin_request(
    sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch, mode: AppMode, remote_fails: bool
) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    app_id, workspace, actor = str(uuid4()), str(uuid4()), str(uuid4())
    with factory.begin() as session:
        app = App(id=app_id, tenant_id=workspace, name="Example", mode=mode, enable_site=True, enable_api=True)
        session.add(app)
        session.flush()
        if mode in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
            session.add(
                Workflow(
                    tenant_id=workspace,
                    app_id=app_id,
                    type=WorkflowType.WORKFLOW,
                    version=Workflow.VERSION_DRAFT,
                    graph='{"nodes":[],"edges":[]}',
                    features="{}",
                    created_by=actor,
                )
            )
        elif mode == AppMode.AGENT:
            AgentRosterService(session).create_backing_agent_for_app(
                tenant_id=workspace, account_id=actor, app_id=app_id, name="Example"
            )
        else:
            config = AppModelConfig(app_id=app_id, model='{"provider":"langgenius/openai/openai","name":"example"}')
            session.add(config)
            session.flush()
            app.app_model_config_id = config.id

    workflow_service = WorkflowService(session_maker=factory)
    monkeypatch.setattr("services.app_dsl_service.WorkflowService", lambda: workflow_service)
    checked_out: set[object] = set()
    calls: list[list[str]] = []

    def checkout(connection: object, *_args: object) -> None:
        checked_out.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        checked_out.remove(connection)

    def fetch_plugins(_self: PluginInstaller, tenant_id: str, plugin_ids: list[str]) -> list[PluginInstallation]:
        assert tenant_id == workspace
        assert not checked_out, "Plugin daemon I/O must run after returning the database connection"
        calls.append(plugin_ids)
        if remote_fails:
            raise RuntimeError("Plugin daemon unavailable")
        return []

    monkeypatch.setattr(PluginInstaller, "fetch_plugin_installation_by_ids", fetch_plugins)
    gateway = AppTransferGateway(
        session_factory=factory,
        dsl_factory=AppDslService,
        packages=AppPackageService(),
        agent_packages=RosterAgentPackageExporter(),
        agent_importer=RosterAgentPackageImporter(),
    )
    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        context = RequestContext("request", None, actor, workspace)
        if remote_fails:
            with pytest.raises(RuntimeError, match="Plugin daemon unavailable"):
                gateway.export_dsl(context, app_id, AppExportOptions())
        else:
            exported = yaml.safe_load(gateway.export_dsl(context, app_id, AppExportOptions()))
            assert exported["app"]["mode"] == mode
            assert exported["dependencies"] == []
        assert len(calls) == 1
        assert not checked_out
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_console_package_export_preserves_icons_without_holding_database_connections(
    app_services: AppServices,
    sqlite_session_factory: sessionmaker[Session],
    copy_source: tuple[RequestContext, str],
    copy_connections: set[object],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context, app_id = copy_source
    payload = b"packaged icon"
    upload = make_upload_file(
        tenant_id=context.active_workspace_id,
        created_by=context.account_id,
        key="uploads/icon.png",
        name="icon.png",
        extension="png",
        mime_type="image/png",
        size=len(payload),
    )
    with sqlite_session_factory.begin() as session:
        app = session.get(App, app_id)
        assert app is not None
        app.icon_type = IconType.IMAGE
        app.icon = upload.id
        session.add(upload)

    calls: list[str] = []

    class Storage:
        def load_stream(self, filename: str) -> Generator[bytes, None, None]:
            assert not copy_connections, "Archive storage I/O must follow closure of both App read sessions"
            assert filename == upload.key
            calls.append("storage")
            yield payload

    def dependencies(*, tenant_id: str, dependencies: list[str]) -> list[PluginDependency]:
        assert not copy_connections
        assert tenant_id == context.active_workspace_id
        assert dependencies == []
        calls.append("plugins")
        return []

    monkeypatch.setattr(
        "services.app_package_service.AgentPackageResourceExporter",
        lambda: AgentPackageResourceExporter(storage_backend=Storage()),
    )
    monkeypatch.setattr(DependenciesAnalysisService, "generate_dependencies", dependencies)
    exported = app_services.console.export(context, app_id, AppExportOptions())
    assert not isinstance(exported, str)
    with exported:
        with ZipFile(exported.archive) as archive:
            manifest = yaml.safe_load(archive.read("manifest.yaml"))
            data = yaml.safe_load(archive.read("app.yaml"))
            icon = manifest["icons"][0]
            assert data["app"]["icon"] == icon["id"]
            assert archive.read(icon["path"]) == payload
    assert calls == ["plugins", "storage"]
    with sqlite_session_factory() as session:
        source = session.get(App, app_id)
        assert source is not None
        assert source.icon == upload.id


@pytest.mark.parametrize("status", list(ImportStatus))
def test_console_package_import_forwards_archive_and_closes_it(
    app_services: AppServices,
    copy_source: tuple[RequestContext, str],
    copy_connections: set[object],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
    status: ImportStatus,
) -> None:
    config_overrides(RBAC_ENABLED=False, DEPLOYMENT_EDITION="COMMUNITY")
    context, _ = copy_source
    archives: list[PreparedAppPackage] = []
    dsl = "kind: app\napp: {mode: chat}\n"

    def import_app(
        _self: AppDslService,
        *,
        account: Account,
        yaml_content: str,
        package: AppImportPackage | None,
        **_kwargs: object,
    ) -> Import:
        assert not copy_connections
        assert account.id == context.account_id
        assert isinstance(package, PreparedAppPackage)
        assert package.dsl == yaml_content == dsl
        assert not package.archive.closed
        archives.append(package)
        return Import(id="import-1", status=status)

    monkeypatch.setattr(AppDslService, "import_app", import_app)
    with AppPackageService().export(dsl=dsl, name="Example") as exported:
        result = app_services.console.import_app(context, AppImportParams(mode="yaml-content"), source=exported.archive)
    assert result.status == status
    assert len(archives) == 1
    assert archives[0].archive.closed
