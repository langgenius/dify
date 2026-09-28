"""Console use cases exercise ports without a request or an ORM session."""

import json
from collections.abc import Sequence
from contextlib import AbstractContextManager
from dataclasses import dataclass, field, replace
from datetime import datetime
from io import BytesIO
from typing import BinaryIO, Literal, cast, override
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.impl.plugin import PluginInstaller
from core.tools.entities.tool_entities import ApiProviderSchemaType
from core.tools.tool_manager import ToolManager
from events.app_event import app_was_updated
from graphon.model_runtime.entities.model_entities import ModelType
from machinery.context import RequestContext
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.agent import Agent, AgentConfigSnapshot, AgentStatus
from models.agent_config_entities import AgentSoulConfig
from models.model import App, AppMode, AppModelConfig, IconType, InstalledApp, Site
from models.provider import TenantDefaultModel
from models.provider_ids import GenericProviderID
from models.tools import ApiToolProvider
from repositories.app.console_repository import ConsoleAppRepository
from services.agent.errors import AgentAccessNotReadyError
from services.agent.roster_package_entities import RosterAgentPackageExport
from services.agent.roster_service import AgentRosterService
from services.app.console_gateway import AppLifecycleGateway
from services.app.console_service import (
    AppExportPaidPlanRequiredError,
    ConsoleAppNotFoundError,
    ConsoleApps,
    ConsoleAppService,
    CreatorsPlatformDisabledError,
    InvalidAppExportError,
)
from services.entities.app_entities import (
    AppCreationSettings,
    AppDeletion,
    AppExportOptions,
    AppListParams,
    AppPage,
    AppRecord,
    AppReference,
    AppTraceSettings,
    CopyAppParams,
    CreateAppParams,
    ImportedAppPackage,
    RecentAppListItem,
    StarredAppListParams,
    UpdateAppParams,
)
from services.entities.dsl_entities import (
    AppImportPackage,
    AppImportParams,
    CheckDependenciesResult,
    Import,
    ImportStatus,
)
from services.model_provider_service import ModelProviderService

CONTEXT = RequestContext("request", "trace", "actor", "workspace")
RECORD = AppRecord(id="app", name="Example", mode_compatible_with_agent="chat")


@dataclass
class Apps:
    source: AppReference = AppReference("app", "Example", "chat", None)
    records: list[AppRecord] = field(default_factory=lambda: [RECORD])
    calls: list[tuple[object, ...]] = field(default_factory=list)

    def list_apps(self, context: RequestContext, params: AppListParams | StarredAppListParams) -> AppPage:
        self.calls.append(("list", context, params))
        return AppPage(params.page, params.limit, len(self.records), False, self.records)

    def recent(self, context: RequestContext, params: AppListParams) -> list[RecentAppListItem]:
        self.calls.append(("recent", context, params))
        return [RecentAppListItem("app", "Example", None, None, None, AppMode.CHAT, None, datetime(2026, 1, 1), None)]

    def get(self, context: RequestContext, app_id: str) -> AppRecord:
        self.calls.append(("get", context, app_id))
        return RECORD

    def create(self, context: RequestContext, params: CreateAppParams, settings: AppCreationSettings) -> AppRecord:
        assert settings.app == {"mode": params.mode}
        self.calls.append(("create", context, params))
        return RECORD

    def get_reference(self, context: RequestContext, app_id: str) -> AppReference:
        self.calls.append(("get_reference", context, app_id))
        return self.source

    def get_trace(self, context: RequestContext, app_id: str) -> AppTraceSettings:
        self.calls.append(("get_trace", context, app_id))
        raise ValueError("Stored tracing JSON is malformed")

    def set_trace(self, context: RequestContext, app_id: str, settings: AppTraceSettings) -> None:
        self.calls.append(("set_trace", context, app_id, settings))


@dataclass
class Permissions:
    def filter_list(self, params: AppListParams) -> AppListParams:
        return params.model_copy(update={"accessible_app_ids": ["app"], "include_own_apps": True})

    def keys_for(self, app_ids: list[str]) -> dict[str, list[str]]:
        return {app_id: ["app.preview"] for app_id in app_ids}


@dataclass
class Access:
    paid: bool = True
    calls: list[tuple[object, ...]] = field(default_factory=list)

    def require_import(self, context: RequestContext, kind: Literal["url", "dsl", "agent"]) -> None:
        del context, kind
        pytest.fail("Unexpected import admission")

    def imported_permissions(self, context: RequestContext, app_id: str) -> list[str]:
        del context, app_id
        pytest.fail("Unexpected import permissions lookup")

    def initialize_import_access(self, app_id: str) -> None:
        del app_id
        pytest.fail("Unexpected import access initialization")

    def permissions(self, context: RequestContext, *, app_id: str | None = None) -> Permissions:
        self.calls.append(("permissions", context, app_id))
        return Permissions()

    def created_permissions(self, context: RequestContext, app_id: str) -> list[str]:
        self.calls.append(("created_permissions", context, app_id))
        return ["app.edit"]

    def initialize_created_app(self, context: RequestContext, app_id: str) -> None:
        self.calls.append(("initialize", context, app_id))

    def inherit_access(self, source_app_id: str, app_id: str) -> None:
        self.calls.append(("inherit", source_app_id, app_id))

    def access_modes(self, app_ids: list[str]) -> dict[str, str]:
        self.calls.append(("modes", app_ids))
        return dict.fromkeys(app_ids, "private")

    def access_mode(self, app_id: str) -> str | None:
        del app_id
        return "private"

    def can_export_version(self, workspace_id: str) -> bool:
        self.calls.append(("paid", workspace_id))
        return self.paid


@dataclass
class Transfers:
    status: ImportStatus = ImportStatus.COMPLETED
    copied_id: str | None = RECORD.id
    calls: list[tuple[object, ...]] = field(default_factory=list)

    def download_import(self, url: str) -> AbstractContextManager[BinaryIO]:
        del url
        pytest.fail("Unexpected import download")

    def read_import_yaml(self, source: BinaryIO) -> str | None:
        del source
        pytest.fail("Unexpected import content detection")

    def read_app_package(self, source: BinaryIO) -> AppImportPackage | None:
        del source
        pytest.fail("Unexpected package read")

    def confirm_import(self, context: RequestContext, import_id: str) -> tuple[Import, bool]:
        del context, import_id
        pytest.fail("Unexpected import confirmation")

    def import_agent_package(self, context: RequestContext, source: BinaryIO) -> ImportedAppPackage:
        del context, source
        pytest.fail("Unexpected Agent package import")

    def check_dependencies(self, context: RequestContext, app_id: str) -> CheckDependenciesResult:
        del context, app_id
        pytest.fail("Unexpected dependency check")

    def import_dsl(
        self,
        context: RequestContext,
        params: AppImportParams,
        *,
        as_copy: bool = False,
        package: AppImportPackage | None = None,
    ) -> Import:
        assert package is None
        self.calls.append(("import", context, params, as_copy))
        return Import(id="import", status=self.status, app_id=self.copied_id)

    def export_dsl(self, context: RequestContext, app_id: str, options: AppExportOptions) -> str:
        self.calls.append(("dsl", context, app_id, options))
        return "app: example"

    def export_app_package(
        self, context: RequestContext, app_id: str, options: AppExportOptions
    ) -> RosterAgentPackageExport:
        self.calls.append(("package", context, app_id, options))
        return RosterAgentPackageExport(archive=BytesIO(b"package"), filename="example.ifpkg", size=7)

    def export_agent_package(
        self, *, workspace_id: str, agent_id: str, version_id: UUID | None
    ) -> RosterAgentPackageExport:
        self.calls.append(("agent", workspace_id, agent_id, version_id))
        return RosterAgentPackageExport(archive=BytesIO(b"agent"), filename="agent.ifpkg", size=5)


@dataclass
class Creators:
    enabled: bool = True
    calls: list[tuple[object, ...]] = field(default_factory=list)

    def require_enabled(self) -> None:
        if not self.enabled:
            raise CreatorsPlatformDisabledError

    def upload(self, dsl: str) -> str:
        self.calls.append(("upload", dsl))
        return "claim"

    def authorize(self, account_id: str) -> str | None:
        self.calls.append(("authorize", account_id))
        return "code"

    def redirect_url(self, claim_code: str, oauth_code: str | None) -> str:
        self.calls.append(("redirect", claim_code, oauth_code))
        return "https://creators.example.com"


class Tracing:
    def validate_provider(self, tracing_provider: str) -> None:
        if tracing_provider != "langfuse":
            raise ValueError("Invalid tracing provider")

    def require_provider_available(self, tracing_provider: str) -> None:
        self.validate_provider(tracing_provider)


Ports = tuple[ConsoleAppService, Apps, Access, Transfers, Creators]


@pytest.fixture
def ports() -> Ports:
    apps, access, transfers, creators = Apps(), Access(), Transfers(), Creators()
    service = ConsoleAppService(
        apps=cast(ConsoleApps, apps),
        access=access,
        transfers=transfers,
        creators=creators,
        tracing=Tracing(),
        lifecycle=Lifecycle(),
    )
    return service, apps, access, transfers, creators


def test_list_applies_visibility_and_enriches_materialized_records(ports: Ports) -> None:
    service, apps, access, _, _ = ports
    params = AppListParams(page=2, limit=5)
    result = service.list_apps(CONTEXT, params)
    _, context, filtered = apps.calls[0]
    assert context == CONTEXT
    assert isinstance(filtered, AppListParams)
    assert filtered.accessible_app_ids == ["app"]
    assert filtered.include_own_apps is True
    assert params.accessible_app_ids is None
    assert result.page == 2
    assert result.data[0].permission_keys == ["app.preview"]
    assert result.data[0].access_mode == "private"
    assert RECORD.access_mode is None
    assert access.calls == [("permissions", CONTEXT, None), ("modes", ["app"])]


def test_empty_list_skips_external_enrichment(ports: Ports) -> None:
    service, apps, access, _, _ = ports
    apps.records = []
    assert service.list_apps(CONTEXT, AppListParams()).data == []
    assert access.calls == [("permissions", CONTEXT, None)]


def test_starred_list_preserves_existing_visibility_contract(ports: Ports) -> None:
    service, _, access, _, _ = ports
    page = service.list_apps(CONTEXT, StarredAppListParams())
    assert page.data[0].permission_keys == []
    assert access.calls == [("modes", ["app"])]


def test_recent_uses_list_visibility_and_permission_keys(ports: Ports) -> None:
    service, apps, _, _, _ = ports
    assert service.recent(CONTEXT, 3)[0].permission_keys == ["app.preview"]
    params = apps.calls[0][2]
    assert isinstance(params, AppListParams)
    assert params.limit == 3
    assert params.accessible_app_ids == ["app"]


def test_detail_and_creation_have_distinct_permission_lookups(ports: Ports) -> None:
    service, _, access, _, _ = ports
    assert service.get(CONTEXT, "app").permission_keys == ["app.preview"]
    assert access.calls == [("permissions", CONTEXT, "app")]
    access.calls.clear()
    assert service.create(CONTEXT, CreateAppParams(name="Example", mode="chat")).permission_keys == ["app.edit"]
    assert access.calls == [("created_permissions", CONTEXT, "app"), ("initialize", CONTEXT, "app")]


@pytest.mark.parametrize("status", [ImportStatus.FAILED, ImportStatus.PENDING])
def test_copy_pending_or_failure_skips_created_permissions(ports: Ports, status: ImportStatus) -> None:
    service, apps, access, transfers, _ = ports
    transfers.status = status
    result, copied = service.copy(CONTEXT, "app", CopyAppParams())
    assert result.status == status
    assert copied is None
    assert apps.calls == []
    assert access.calls == []


def test_copy_success_requires_materialized_app_and_enriches_permissions(ports: Ports) -> None:
    service, apps, access, transfers, _ = ports
    params = CopyAppParams(name="Copy", description="Description", icon_type=IconType.EMOJI, icon="robot")
    _, copied = service.copy(CONTEXT, "app", params)
    assert copied is not None
    assert copied.permission_keys == ["app.edit"]
    assert access.calls == [("inherit", "app", "app"), ("created_permissions", CONTEXT, "app")]
    assert apps.calls == [("get", CONTEXT, "app")]
    assert transfers.calls == [
        ("dsl", CONTEXT, "app", AppExportOptions(include_secret=True)),
        (
            "import",
            CONTEXT,
            AppImportParams(mode="yaml-content", yaml_content="app: example", **params.model_dump()),
            True,
        ),
    ]
    transfers.copied_id = None
    with pytest.raises(ConsoleAppNotFoundError):
        service.copy(CONTEXT, "app", CopyAppParams())


def test_export_routes_yaml_ordinary_package_and_agent_package(ports: Ports) -> None:
    service, apps, _, transfers, _ = ports
    options = AppExportOptions(format="yaml", include_secret=True, workflow_id="workflow")
    assert service.export(CONTEXT, "app", options) == "app: example"
    assert transfers.calls[-1] == ("dsl", CONTEXT, "app", options)
    archive = service.export(CONTEXT, "app", AppExportOptions())
    assert transfers.calls[-1] == ("package", CONTEXT, "app", AppExportOptions())
    assert isinstance(archive, RosterAgentPackageExport)
    archive.close()
    apps.source = replace(apps.source, mode="agent", bound_agent_id="agent")
    version = uuid4()
    archive = service.export(CONTEXT, "app", AppExportOptions(version_id=version))
    assert transfers.calls[-1] == ("agent", "workspace", "agent", version)
    assert isinstance(archive, RosterAgentPackageExport)
    archive.close()


def test_export_rejects_invalid_or_unpaid_version_before_exporting(ports: Ports) -> None:
    service, apps, access, transfers, _ = ports
    options = AppExportOptions(version_id=uuid4())
    with pytest.raises(InvalidAppExportError):
        service.export(CONTEXT, "app", options)
    apps.source = replace(apps.source, mode="agent", bound_agent_id="agent")
    access.paid = False
    with pytest.raises(AppExportPaidPlanRequiredError):
        service.export(CONTEXT, "app", options)
    assert transfers.calls == []
    access.paid = True
    apps.source = replace(apps.source, bound_agent_id=None)
    with pytest.raises(ConsoleAppNotFoundError, match="Agent not found"):
        service.export(CONTEXT, "app", AppExportOptions())


def test_publish_orders_upload_authorization_and_redirect_without_secrets(ports: Ports) -> None:
    service, _, _, transfers, creators = ports
    assert service.publish(CONTEXT, "app") == "https://creators.example.com"
    assert transfers.calls == [("dsl", CONTEXT, "app", AppExportOptions(include_secret=False))]
    assert creators.calls == [("upload", "app: example"), ("authorize", "actor"), ("redirect", "claim", "code")]


def test_disabled_creators_has_no_export_or_external_effects(ports: Ports) -> None:
    service, _, _, transfers, creators = ports
    creators.enabled = False
    with pytest.raises(CreatorsPlatformDisabledError):
        service.publish(CONTEXT, "app")
    assert transfers.calls == creators.calls == []


@pytest.mark.parametrize(
    ("enabled", "provider"),
    [
        pytest.param(False, None, id="disabled-without-provider"),
        pytest.param(False, "langfuse", id="disabled-with-provider"),
        pytest.param(True, "langfuse", id="enabled"),
        pytest.param(True, "invalid", id="invalid"),
    ],
)
def test_trace_update_checks_ownership_and_provider_without_parsing_old_settings(
    ports: Ports, enabled: bool, provider: str | None
) -> None:
    service, apps, _, _, _ = ports
    settings = AppTraceSettings(enabled, provider)
    if provider == "invalid":
        with pytest.raises(ValueError, match="Invalid tracing provider"):
            service.set_trace(CONTEXT, "app", settings)
        assert apps.calls == [("get_reference", CONTEXT, "app")]
    else:
        service.set_trace(CONTEXT, "app", settings)
        assert apps.calls == [("get_reference", CONTEXT, "app"), ("set_trace", CONTEXT, "app", settings)]


class Lifecycle:
    def delete(self, context: RequestContext, app_id: str) -> AppDeletion:
        del context, app_id
        pytest.fail("Unexpected app deletion")

    def create(self, context: RequestContext, params: CreateAppParams, settings: AppCreationSettings) -> AppRecord:
        assert context is CONTEXT
        assert settings.app == {"mode": params.mode}
        return RECORD

    def prepare_creation(self, context: RequestContext, params: CreateAppParams) -> AppCreationSettings:
        assert context is CONTEXT
        return AppCreationSettings({"mode": params.mode}, None)

    def created(self, context: RequestContext, app: AppRecord) -> None:
        assert context is CONTEXT
        assert app.id == "app"

    def updated(self, context: RequestContext, app: AppRecord) -> None:
        assert context is CONTEXT
        assert app.id == "app"

    def deleted(self, context: RequestContext, deleted: AppDeletion) -> None:
        assert context is CONTEXT
        assert deleted.app.id == "app"

    def present(self, context: RequestContext, app: AppRecord, *, mask_credentials: bool = False) -> AppRecord:
        del mask_credentials
        assert context is CONTEXT
        return app


@pytest.mark.parametrize(
    ("provider_name", "expected_model"),
    [
        pytest.param(
            "langgenius/openai/openai",
            ("langgenius/openai", "langgenius/openai/openai", "gpt-4o"),
            id="workspace-default",
        ),
        pytest.param(None, None, id="no-default"),
        pytest.param("invalid/provider", None, id="invalid-provider"),
    ],
)
def test_lifecycle_agent_creation_seeds_workspace_default_model(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
    provider_name: str | None,
    expected_model: tuple[str, str, str] | None,
) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    with factory.begin() as session:
        account = Account(name="Creator", email=f"{uuid4()}@example.com")
        tenant = Tenant(name="Workspace")
        session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    current=True,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        if provider_name is not None:
            session.add(
                TenantDefaultModel(
                    tenant_id=tenant.id,
                    model_type=ModelType.LLM,
                    provider_name=provider_name,
                    model_name="gpt-4o",
                )
            )

    if provider_name is None:
        monkeypatch.setattr(
            ModelProviderService,
            "get_default_model_selection",
            lambda *_args, **_kwargs: None,
        )

    context = RequestContext("request", None, account.id, tenant.id)
    app = AppLifecycleGateway(session_factory=factory).create(
        context,
        CreateAppParams(name="Agent", mode=AppMode.AGENT.value),
        AppCreationSettings({"enable_site": False, "enable_api": False}, None),
    )

    with factory() as session:
        agent = session.scalar(select(Agent).where(Agent.app_id == app.id))
        assert agent is not None
        snapshot = session.get(AgentConfigSnapshot, agent.active_config_snapshot_id)
        assert snapshot is not None
        model = AgentSoulConfig.model_validate(snapshot.config_snapshot_dict).model
        if expected_model is None:
            assert model is None
            assert agent.active_config_has_model is False
        else:
            assert model is not None
            assert (model.plugin_id, model.model_provider, model.model) == expected_model
            assert agent.active_config_has_model is True


@pytest.mark.parametrize("failure", [None, "persist", "external"])
@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.AGENT])
def test_lifecycle_runs_after_atomic_creation_and_session_close(
    sqlite_engine: Engine, failure: str | None, mode: AppMode
) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    with factory.begin() as session:
        account = Account(name="Creator", email=f"{uuid4()}@example.com")
        tenant = Tenant(name="Workspace")
        session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    current=True,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
    context = RequestContext("request", None, account.id, tenant.id)
    effects: list[str] = []
    checked_out: set[object] = set()

    def checkout(connection: object, *_args: object) -> None:
        checked_out.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        checked_out.remove(connection)

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("persist failed")

    class LifecycleProbe(AppLifecycleGateway):
        @override
        def prepare_creation(self, context: RequestContext, params: CreateAppParams) -> AppCreationSettings:
            assert context.account_id == account.id
            assert not checked_out
            assert params.mode == mode
            return AppCreationSettings({"enable_site": True, "enable_api": True}, None)

        @override
        def present(self, context: RequestContext, app: AppRecord, *, mask_credentials: bool = False) -> AppRecord:
            assert context.account_id == account.id
            assert not mask_credentials
            return app

        @override
        def created(self, context: RequestContext, app: AppRecord) -> None:
            assert context.account_id == account.id
            assert not checked_out
            with factory() as read:
                assert read.get(App, app.id) is not None
                assert read.scalar(select(Site.id).where(Site.app_id == app.id)) is not None
                assert read.scalar(select(InstalledApp.id).where(InstalledApp.app_id == app.id)) is not None
                backing_agent = read.scalar(select(Agent).where(Agent.app_id == app.id))
                assert (backing_agent is not None) == (mode == AppMode.AGENT)
            effects.append("created")
            if failure == "external":
                raise RuntimeError("external failed")

        @override
        def updated(self, context: RequestContext, app: AppRecord) -> None:
            assert context.account_id == account.id
            assert not checked_out
            with factory() as read:
                persisted = read.get(App, app.id)
                assert persisted is not None
                assert persisted.name == "Renamed"
            effects.append("updated")

        @override
        def deleted(self, context: RequestContext, deleted: AppDeletion) -> None:
            assert context.account_id == account.id
            assert not checked_out
            with factory() as read:
                assert read.get(App, deleted.app.id) is None
                if mode == AppMode.AGENT:
                    assert (
                        read.scalar(select(Agent.status).where(Agent.app_id == deleted.app.id)) == AgentStatus.ARCHIVED
                    )
            effects.append("deleted")

    access = Access()
    service = ConsoleAppService(
        apps=ConsoleAppRepository(session_factory=factory),
        access=access,
        transfers=Transfers(),
        creators=Creators(),
        tracing=Tracing(),
        lifecycle=LifecycleProbe(session_factory=factory),
    )
    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    if failure == "persist":
        event.listen(factory, "before_commit", reject_commit)
    try:
        params = CreateAppParams.model_validate({"name": "Created", "mode": mode})
        if failure:
            with pytest.raises(RuntimeError, match=f"{failure} failed"):
                service.create(context, params)
            with factory() as read:
                expected = 0 if failure == "persist" else 1
                for model in (App, Site, InstalledApp):
                    assert read.scalar(select(func.count()).select_from(model)) == expected
                assert read.scalar(select(func.count()).select_from(Agent)) == (
                    expected if mode == AppMode.AGENT else 0
                )
            assert effects == ([] if failure == "persist" else ["created"])
            assert access.calls == []
        else:
            app = service.create(context, params)
            service.rename(context, app.id, "Renamed")
            service.delete(context, app.id)
            assert effects == ["created", "updated", "deleted"]
        assert not checked_out
    finally:
        if failure == "persist":
            event.remove(factory, "before_commit", reject_commit)
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_app_deletion_failure_rolls_back_backing_agent_changes(sqlite_engine: Engine) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    with factory.begin() as session:
        account = Account(name="Creator", email=f"{uuid4()}@example.com")
        tenant = Tenant(name="Workspace")
        session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(
                    tenant_id=tenant.id, account_id=account.id, current=True, role=TenantAccountRole.OWNER
                ),
            ]
        )
    context = RequestContext("request", None, account.id, tenant.id)
    gateway = AppLifecycleGateway(session_factory=factory)
    app = gateway.create(
        context,
        CreateAppParams(name="Agent", mode="agent"),
        AppCreationSettings({"enable_site": False, "enable_api": False}, None),
    )

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(factory, "before_commit", reject_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            gateway.delete(context, app.id)
    finally:
        event.remove(factory, "before_commit", reject_commit)

    with factory() as read:
        assert read.get(App, app.id) is not None
        agent = read.scalar(select(Agent).where(Agent.app_id == app.id))
        assert agent is not None
        assert agent.status == AgentStatus.ACTIVE
        assert agent.archived_at is None


@pytest.mark.parametrize("operation", ["get", "update", "create", "copy"])
@pytest.mark.parametrize("remote_fails", [False, True])
def test_detail_tool_enrichment_releases_database_before_plugin_io(
    sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch, operation: str, remote_fails: bool
) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    missing_api = str(uuid4())
    with factory.begin() as session:
        account = Account(name="Creator", email=f"{uuid4()}@example.com")
        tenant = Tenant(name="Workspace")
        session.add_all(
            [
                account,
                tenant,
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=account.id,
                    current=True,
                    role=TenantAccountRole.OWNER,
                ),
            ]
        )
        providers = [
            ApiToolProvider(
                name="API",
                icon="",
                schema="{}",
                schema_type_str=ApiProviderSchemaType.OPENAPI,
                user_id=account.id,
                tenant_id=workspace,
                description="",
                tools_str="[]",
                credentials_str="{}",
            )
            for workspace in (tenant.id, str(uuid4()))
        ]
        session.add_all(providers)
        tools = [
            {
                "provider_type": kind,
                "provider_id": provider_id,
                "tool_name": "tool",
                "tool_parameters": dict[str, str](),
            }
            for kind, provider_id in (
                ("api", providers[0].id),
                ("api", missing_api),
                ("api", providers[1].id),
                ("builtin", "vendor/missing/tool"),
                ("builtin", "vendor/installed/tool"),
                ("builtin", "local"),
            )
        ]
        config_values = {"agent_mode": json.dumps({"enabled": False, "tools": tools}), "model": "{}"}
        app = App(
            id=str(uuid4()), tenant_id=tenant.id, name="Example", mode=AppMode.CHAT, enable_site=True, enable_api=True
        )
        config = AppModelConfig(app_id=app.id, agent_mode=config_values["agent_mode"], model=config_values["model"])
        session.add_all([app, config])
        session.flush()
        app.app_model_config_id = config.id
    context = RequestContext("request", None, account.id, tenant.id)
    repository = ConsoleAppRepository(session_factory=factory)
    checked_out: set[object] = set()
    remote_calls: list[list[str]] = []

    def checkout(connection: object, *_args: object) -> None:
        checked_out.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        checked_out.remove(connection)

    def hardcoded(provider: str) -> object:
        assert not checked_out
        if provider == "local":
            return object()
        raise ValueError("Not a hardcoded provider")

    def check_plugins(_self: PluginInstaller, tenant_id: str, provider_ids: Sequence[GenericProviderID]) -> list[bool]:
        assert tenant_id == tenant.id
        assert not checked_out, "Plugin daemon I/O must run after returning the database connection"
        remote_calls.append([str(provider) for provider in provider_ids])
        if remote_fails:
            raise RuntimeError("Plugin daemon unavailable")
        return [False, True]

    class LifecycleGateway(AppLifecycleGateway):
        @override
        def prepare_creation(self, context: RequestContext, params: CreateAppParams) -> AppCreationSettings:
            assert context.account_id == account.id
            assert params.mode == "chat"
            return AppCreationSettings({"enable_site": True, "enable_api": True}, config_values)

        @override
        def created(self, context: RequestContext, app: AppRecord) -> None:
            assert context.account_id == account.id
            assert app.created_by == account.id
            assert not checked_out

    class CopyTransfer(Transfers):
        @override
        def import_dsl(
            self,
            context: RequestContext,
            params: AppImportParams,
            *,
            as_copy: bool = False,
            package: AppImportPackage | None = None,
        ) -> Import:
            assert package is None
            assert params.name is None
            assert as_copy
            return Import(id="import", status=ImportStatus.COMPLETED, app_id=app.id)

    service = ConsoleAppService(
        apps=repository,
        access=Access(),
        transfers=CopyTransfer(),
        creators=Creators(),
        tracing=Tracing(),
        lifecycle=LifecycleGateway(session_factory=factory),
    )
    monkeypatch.setattr(ToolManager, "get_hardcoded_provider", hardcoded)
    monkeypatch.setattr(PluginInstaller, "check_tools_existence", check_plugins)
    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)

    def read_result() -> AppRecord:
        if operation == "get":
            return service.get(context, app.id)
        if operation == "update":
            return service.update(context, app.id, UpdateAppParams(name="Updated"))
        if operation == "create":
            return service.create(context, CreateAppParams(name="Created", mode="chat"))
        _, copied = service.copy(context, app.id, CopyAppParams())
        assert copied is not None
        return copied

    try:
        snapshot = repository.get(context, app.id)
        assert remote_calls == []
        assert not checked_out
        assert [ref.exists for ref in snapshot.tool_references] == [True, False, False, None, None, None]
        if remote_fails:
            with pytest.raises(RuntimeError, match="Plugin daemon unavailable"):
                read_result()
            with factory() as read:
                if operation == "update":
                    assert read.scalar(select(App.name).where(App.id == app.id)) == "Updated"
                if operation == "create":
                    assert read.scalar(select(App.id).where(App.name == "Created")) is not None
        else:
            result = read_result()
            assert result.deleted_tools == [
                {"type": "api", "provider_id": missing_api, "tool_name": "tool"},
                {"type": "api", "provider_id": providers[1].id, "tool_name": "tool"},
                {"type": "builtin", "provider_id": "vendor/missing/tool", "tool_name": "tool"},
            ]
        assert remote_calls == [["vendor/missing/tool", "vendor/installed/tool"]]
        assert not checked_out
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


@pytest.mark.parametrize("operation", ["rename", "icon", "site"])
@pytest.mark.parametrize("commit_fails", [False, True])
def test_app_mutations_publish_only_after_commit(sqlite_engine: Engine, operation: str, commit_fails: bool) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False, close_resets_only=False)
    context = RequestContext("request", None, str(uuid4()), str(uuid4()))
    with factory.begin() as session:
        app = App(
            tenant_id=context.active_workspace_id,
            name="Before",
            mode=AppMode.COMPLETION,
            icon_type=IconType.IMAGE,
            icon="old",
            icon_background="#fff",
            enable_site=False,
            enable_api=False,
        )
        session.add(app)
    service = ConsoleAppService(
        apps=ConsoleAppRepository(session_factory=factory),
        access=Access(),
        transfers=Transfers(),
        creators=Creators(),
        tracing=Tracing(),
        lifecycle=AppLifecycleGateway(session_factory=factory),
    )
    signals: list[str] = []
    checked_out: set[object] = set()

    def checkout(connection: object, *_args: object) -> None:
        checked_out.add(connection)

    def checkin(connection: object, *_args: object) -> None:
        checked_out.remove(connection)

    def after_update(_sender: object) -> None:
        assert not checked_out
        with factory() as read:
            persisted = read.get(App, app.id)
            assert persisted is not None
            assert persisted.updated_by == context.account_id
            assert (persisted.name, persisted.icon, persisted.enable_site) == (
                "After" if operation == "rename" else "Before",
                "new" if operation == "icon" else "old",
                operation == "site",
            )
            assert persisted.icon_type == "image"
        signals.append("updated")

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    def update() -> AppRecord:
        if operation == "rename":
            return service.rename(context, app.id, "After")
        if operation == "icon":
            return service.update_icon(context, app.id, icon="new", icon_background="#000", icon_type=None)
        return service.set_site_enabled(context, app.id, True)

    app_was_updated.connect(after_update)
    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    if commit_fails:
        event.listen(factory, "before_commit", reject_commit)
    try:
        if commit_fails:
            with pytest.raises(RuntimeError, match="commit failed"):
                update()
            with factory() as read:
                persisted = read.get(App, app.id)
                assert persisted is not None
                assert (persisted.name, persisted.icon, persisted.enable_site) == ("Before", "old", False)
            assert signals == []
        else:
            result = update()
            assert result.updated_by == context.account_id
            if operation == "site":
                assert service.set_site_enabled(context, app.id, True).enable_site
            assert signals == ["updated"]
        assert not checked_out
    finally:
        if commit_fails:
            event.remove(factory, "before_commit", reject_commit)
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)
        app_was_updated.disconnect(after_update)


@pytest.mark.parametrize("surface", ["site", "api"])
def test_unpublished_agent_cannot_enable_access_through_console_service(sqlite_engine: Engine, surface: str) -> None:
    factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    context = RequestContext("request", None, str(uuid4()), str(uuid4()))
    with factory.begin() as session:
        app = App(
            id=str(uuid4()),
            tenant_id=context.active_workspace_id,
            name="Agent",
            mode=AppMode.AGENT,
            enable_site=False,
            enable_api=False,
        )
        session.add(app)
        session.flush()
        AgentRosterService(session).create_backing_agent_for_app(
            tenant_id=context.active_workspace_id,
            account_id=context.account_id,
            app_id=app.id,
            name="Agent",
        )
    service = ConsoleAppService(
        apps=ConsoleAppRepository(session_factory=factory),
        access=Access(),
        transfers=Transfers(),
        creators=Creators(),
        tracing=Tracing(),
        lifecycle=AppLifecycleGateway(session_factory=factory),
    )
    signals: list[object] = []

    def updated(sender: object) -> None:
        signals.append(sender)

    app_was_updated.connect(updated)
    set_enabled = service.set_site_enabled if surface == "site" else service.set_api_enabled
    try:
        with pytest.raises(AgentAccessNotReadyError):
            set_enabled(context, app.id, True)
        assert signals == []
        with factory() as read:
            persisted = read.get(App, app.id)
            assert persisted is not None
            assert not persisted.enable_site
            assert not persisted.enable_api
    finally:
        app_was_updated.disconnect(updated)
