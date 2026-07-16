from collections.abc import Iterator
from dataclasses import dataclass

import pytest
import yaml
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.tools.entities.tool_entities import ApiProviderSchemaType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.model import App, AppMode
from models.tools import ApiToolProvider, MCPToolProvider, WorkflowToolProvider
from services.app_dsl_service import Import
from services.data_migration import import_service
from services.data_migration.entities import (
    ConflictStrategy,
    IdStrategy,
    ImportOptions,
    ImportTarget,
    MigrationDataError,
    MigrationPackage,
    ResourceIdMapping,
    ResourceReportItem,
    ResourceType,
)
from services.data_migration.import_service import ImportRequest, ImportTargetResolver, MigrationImportService
from services.entities.dsl_entities import ImportStatus


@dataclass(frozen=True)
class Database:
    """Typed database binding used by import code that still reads ``db.engine``."""

    engine: Engine
    session: Session


@pytest.fixture
def database(sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch) -> Iterator[Database]:
    tables = [
        Tenant.__table__,
        Account.__table__,
        TenantAccountJoin.__table__,
        App.__table__,
        ApiToolProvider.__table__,
        WorkflowToolProvider.__table__,
        MCPToolProvider.__table__,
    ]
    Tenant.metadata.create_all(sqlite_engine, tables=tables)
    session_factory = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with session_factory() as session:
        database = Database(engine=sqlite_engine, session=session)
        monkeypatch.setattr(import_service, "db", database)
        yield database


def _persist_tenant_account(
    session: Session,
    *,
    tenant_id: str = "tenant-1",
    tenant_name: str = "target",
    account_id: str = "account-1",
) -> tuple[Tenant, Account]:
    tenant = Tenant(name=tenant_name)
    tenant.id = tenant_id
    account = Account(name="Owner", email="owner@example.com")
    account.id = account_id
    join = TenantAccountJoin(
        tenant_id=tenant_id,
        account_id=account_id,
        current=True,
        role=TenantAccountRole.OWNER,
    )
    session.add_all([tenant, account, join])
    session.commit()
    return tenant, account


def _persist_app(
    session: Session,
    *,
    app_id: str,
    tenant_id: str = "tenant-1",
) -> App:
    app = App(
        id=app_id,
        tenant_id=tenant_id,
        name=f"App {app_id}",
        description="Migration fixture",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        icon="",
        icon_background=None,
        workflow_id=None,
        enable_site=False,
        enable_api=False,
        max_active_requests=None,
        created_by="account-1",
        maintainer="account-1",
    )
    session.add(app)
    session.commit()
    return app


def _persist_workflow_provider(
    session: Session,
    *,
    provider_id: str,
    app_id: str,
    name: str = "embedded_workflow_as_tool",
    tenant_id: str = "tenant-1",
) -> WorkflowToolProvider:
    provider = WorkflowToolProvider(
        name=name,
        label=name,
        icon="{}",
        app_id=app_id,
        version="",
        user_id="account-1",
        tenant_id=tenant_id,
        description="",
        parameter_configuration="[]",
    )
    provider.id = provider_id
    session.add(provider)
    session.commit()
    return provider


def _persist_api_provider(
    session: Session,
    *,
    provider_id: str,
    name: str = "weather",
    tenant_id: str = "tenant-1",
) -> ApiToolProvider:
    provider = ApiToolProvider(
        name=name,
        icon="{}",
        schema="openapi: 3.0.0",
        schema_type_str=ApiProviderSchemaType.OPENAPI,
        user_id="account-1",
        tenant_id=tenant_id,
        description="",
        tools_str="[]",
        credentials_str="{}",
    )
    provider.id = provider_id
    session.add(provider)
    session.commit()
    return provider


def _persist_mcp_provider(
    session: Session,
    *,
    provider_id: str,
    server_identifier: str = "my-test-mcp",
    name: str = "my-test-mcp",
    tenant_id: str = "tenant-1",
) -> MCPToolProvider:
    provider = MCPToolProvider(
        name=name,
        server_identifier=server_identifier,
        server_url="http://localhost:3000/mcp",
        server_url_hash=f"hash-{provider_id}",
        icon=None,
        tenant_id=tenant_id,
        user_id="account-1",
    )
    provider.id = provider_id
    session.add(provider)
    session.commit()
    return provider


def test_target_tenant_precedence_cli_then_config_then_package():
    package = MigrationPackage.from_mapping(
        {
            "metadata": {
                "version": "1",
                "source_scope": "single",
                "source_tenants": [],
                "target_tenant": {"name": "from-package"},
            }
        }
    )

    resolver = ImportTargetResolver()

    assert (
        resolver.select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant="from-cli", config_target_tenant="from-config")
        )
        == "from-cli"
    )
    assert (
        resolver.select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant=None, config_target_tenant="from-config")
        )
        == "from-config"
    )
    assert (
        resolver.select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant=None, config_target_tenant=None)
        )
        == "from-package"
    )


def test_target_tenant_missing_fails_before_import():
    package = MigrationPackage.from_mapping({"metadata": {"version": "1", "source_scope": "single"}})

    with pytest.raises(MigrationDataError, match="Target tenant"):
        ImportTargetResolver().select_target_tenant_name(
            ImportRequest(package=package, cli_target_tenant=None, config_target_tenant=None)
        )


def test_package_target_tenant_id_can_be_used_without_name():
    package = MigrationPackage.from_mapping(
        {"metadata": {"version": "1", "source_scope": "single", "target_tenant": {"id": "tenant-id"}}}
    )

    assert ImportTargetResolver().select_target_tenant_name(ImportRequest(package=package)) == "tenant-id"


def test_target_tenant_name_is_not_treated_as_uuid():
    resolver = ImportTargetResolver()

    assert resolver._is_uuid("admin's Workspace") is False
    assert resolver._is_uuid("49a99e46-bc2c-4885-91fa-47615f6192b5") is True


def test_package_target_tenant_id_ignores_invalid_uuid(database: Database):
    package = MigrationPackage.from_mapping(
        {"metadata": {"version": "1", "source_scope": "single", "target_tenant": {"id": "not-a-uuid"}}}
    )

    with pytest.raises(MigrationDataError, match="Target tenant not found"):
        ImportTargetResolver().resolve(ImportRequest(package=package), session=database.session)

    assert database.session.query(Tenant).count() == 0


def test_options_override_replaces_package_defaults(database: Database):
    package = MigrationPackage.from_mapping(
        {
            "metadata": {
                "version": "1",
                "source_scope": "single",
                "target_tenant": {"name": "target"},
                "import_options": {
                    "create_app_api_token_on_import": True,
                    "conflict_strategy": "update",
                },
            }
        }
    )
    captured_options: list[ImportOptions] = []

    class StubResolver(ImportTargetResolver):
        def resolve(self, request: ImportRequest, session) -> ImportTarget:
            return ImportTarget(
                tenant_id="tenant-1",
                tenant_name="target",
                operator_id="account-1",
                operator_email="owner@example.com",
            )

    class CapturingImportService(MigrationImportService):
        def _import_workflows(
            self,
            package: MigrationPackage,
            target: ImportTarget,
            options: ImportOptions,
            report_items: list[ResourceReportItem],
            id_mapping: dict[str, str],
            **kwargs,
        ) -> None:
            captured_options.append(options)

    override = ImportOptions(create_app_api_token_on_import=False, conflict_strategy=ConflictStrategy.SKIP)

    CapturingImportService(target_resolver=StubResolver()).import_package(
        ImportRequest(package=package, options_override=override),
        session=database.session,
    )

    assert captured_options == [override]


def test_only_preserve_id_strategy_reuses_source_app_id():
    service = MigrationImportService()

    assert service._should_preserve_source_app_id(ImportOptions(id_strategy=IdStrategy.PRESERVE_ID)) is True
    assert service._should_preserve_source_app_id(ImportOptions(id_strategy=IdStrategy.GENERATE_NEW_ID)) is False


def test_find_existing_app_ignores_invalid_uuid(database: Database):
    _persist_app(database.session, app_id="app-other", tenant_id="tenant-2")
    assert MigrationImportService()._find_existing_app("not-a-uuid", "tenant-1", session=database.session) is None


def test_find_existing_workflow_tool_does_not_compare_invalid_uuid(database: Database):
    provider = _persist_workflow_provider(database.session, provider_id="provider-1", app_id="app-id", name="tool-name")
    statements = []

    def capture_statement(orm_execute_state) -> None:
        statements.append(orm_execute_state.statement)

    event.listen(database.session, "do_orm_execute", capture_statement)
    try:
        result = MigrationImportService()._find_existing_workflow_tool(
            "tenant-1", "not-a-uuid", "tool-name", "app-id", session=database.session
        )
    finally:
        event.remove(database.session, "do_orm_execute", capture_statement)

    assert result is provider
    where_clause = str(statements[0].whereclause)
    assert f"{WorkflowToolProvider.__tablename__}.id" not in where_clause


def test_find_existing_mcp_tool_does_not_compare_invalid_uuid(database: Database):
    provider = _persist_mcp_provider(database.session, provider_id="provider-1")
    statements = []

    def capture_statement(orm_execute_state) -> None:
        statements.append(orm_execute_state.statement)

    event.listen(database.session, "do_orm_execute", capture_statement)
    try:
        result = MigrationImportService()._find_existing_mcp_tool(
            "tenant-1", "my-test-mcp", "my-test-mcp", session=database.session
        )
    finally:
        event.remove(database.session, "do_orm_execute", capture_statement)

    assert result is provider
    where_clause = str(statements[0].whereclause)
    assert f"{MCPToolProvider.__tablename__}.id" not in where_clause
    assert f"{MCPToolProvider.__tablename__}.name" not in where_clause


def test_workflow_app_import_does_not_wrap_app_dsl_import_in_nested_transaction(
    monkeypatch: pytest.MonkeyPatch, database: Database
):
    class StubAppDslService:
        def __init__(self, session):
            self.session = session

        def import_app(self, **kwargs):
            return Import(id="import-id", status=ImportStatus.COMPLETED, app_id="imported-app-id")

    monkeypatch.setattr(import_service, "AppDslService", StubAppDslService)
    nested_transactions = []

    def capture_transaction(_session, transaction) -> None:
        if transaction.nested:
            nested_transactions.append(transaction)

    event.listen(database.session, "after_transaction_create", capture_transaction)

    try:
        imported_app_id = MigrationImportService()._import_workflow_app(
            account=object(),
            workflow_data={"name": "main_chatflow"},
            dsl_content="app:\n  mode: workflow\n",
            app_id="source-app-id",
            existing_app=None,
            options=ImportOptions(id_strategy=IdStrategy.PRESERVE_ID),
            session=database.session,
        )
    finally:
        event.remove(database.session, "after_transaction_create", capture_transaction)

    assert imported_app_id == "imported-app-id"
    assert nested_transactions == []


def test_rewrite_workflow_dsl_replaces_tool_provider_ids():
    dsl_content = yaml.safe_dump(
        {
            "app": {"mode": "workflow"},
            "workflow": {
                "graph": {
                    "nodes": [
                        {
                            "data": {
                                "type": "tool",
                                "provider_id": "source-api-provider-id",
                                "provider_name": "weather",
                            }
                        },
                        {
                            "data": {
                                "type": "agent",
                                "agent_parameters": {
                                    "tools": {
                                        "value": [
                                            {
                                                "provider_id": "source-agent-provider-id",
                                                "provider_name": "agent_weather",
                                            }
                                        ]
                                    }
                                },
                            }
                        },
                    ]
                }
            },
        }
    )

    rewritten = MigrationImportService()._rewrite_workflow_dsl_provider_ids(
        dsl_content,
        {
            "source-api-provider-id": "target-api-provider-id",
            "source-agent-provider-id": "target-agent-provider-id",
        },
    )
    graph = yaml.safe_load(rewritten)["workflow"]["graph"]

    assert graph["nodes"][0]["data"]["provider_id"] == "target-api-provider-id"
    assert (
        graph["nodes"][1]["data"]["agent_parameters"]["tools"]["value"][0]["provider_id"] == "target-agent-provider-id"
    )


def test_source_api_provider_ids_are_discovered_from_workflow_dsl():
    package = MigrationPackage.from_mapping(
        {
            "metadata": {"version": "1", "source_scope": "single"},
            "workflows": [
                {
                    "dsl": yaml.safe_dump(
                        {
                            "workflow": {
                                "graph": {
                                    "nodes": [
                                        {
                                            "data": {
                                                "type": "tool",
                                                "provider_id": "source-api-provider-id",
                                                "provider_name": "weather",
                                                "provider_type": "api",
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    )
                }
            ],
        }
    )

    assert MigrationImportService()._source_api_provider_ids_by_name(package) == {"weather": {"source-api-provider-id"}}


def test_workflow_tool_import_publishes_referenced_app_before_create(
    monkeypatch: pytest.MonkeyPatch, database: Database
):
    events = []
    _persist_tenant_account(database.session)
    app_id = "00000000-0000-0000-0000-000000000001"
    _persist_app(database.session, app_id=app_id)

    class PublishingImportService(MigrationImportService):
        def _ensure_workflow_app_is_published(self, target, account, app_id, session):
            events.append(("published", app_id))

    def create_workflow_tool(**kwargs) -> None:
        events.append(("created", kwargs["workflow_app_id"]))
        _persist_workflow_provider(
            database.session,
            provider_id="00000000-0000-0000-0000-000000000010",
            app_id=kwargs["workflow_app_id"],
        )

    monkeypatch.setattr(import_service.WorkflowToolManageService, "create_workflow_tool", create_workflow_tool)
    PublishingImportService()._import_workflow_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "workflow_tools": [{"id": "workflow-tool-1", "name": "embedded_workflow_as_tool", "app_id": app_id}],
            }
        ),
        ImportTarget("tenant-1", "target", "account-1", "owner@example.com"),
        ImportOptions(),
        {},
        [],
        [],
        session=database.session,
    )

    assert events == [("published", app_id), ("created", app_id)]


@pytest.mark.parametrize("id_strategy", [IdStrategy.PRESERVE_ID, IdStrategy.GENERATE_NEW_ID])
def test_workflow_tool_import_id_follows_id_strategy(
    monkeypatch: pytest.MonkeyPatch, database: Database, id_strategy: IdStrategy
):
    created_kwargs = []
    _persist_tenant_account(database.session)
    source_app_id = "00000000-0000-0000-0000-000000000021"
    target_app_id = "00000000-0000-0000-0000-000000000022"
    source_provider_id = "00000000-0000-0000-0000-000000000020"
    generated_provider_id = "00000000-0000-0000-0000-000000000023"
    _persist_app(database.session, app_id=target_app_id)
    id_mapping = {source_app_id: target_app_id}
    id_mapping_details = []

    class StrategyImportService(MigrationImportService):
        def _ensure_workflow_app_is_published(self, target, account, app_id, session):
            return None

    def create_workflow_tool(**kwargs) -> None:
        created_kwargs.append(kwargs)
        _persist_workflow_provider(
            database.session,
            provider_id=kwargs["import_id"] or generated_provider_id,
            app_id=kwargs["workflow_app_id"],
        )

    monkeypatch.setattr(import_service.WorkflowToolManageService, "create_workflow_tool", create_workflow_tool)
    StrategyImportService()._import_workflow_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "workflow_tools": [
                    {"id": source_provider_id, "name": "embedded_workflow_as_tool", "app_id": source_app_id}
                ],
            }
        ),
        ImportTarget("tenant-1", "target", "account-1", "owner@example.com"),
        ImportOptions(id_strategy=id_strategy),
        id_mapping,
        id_mapping_details,
        [],
        session=database.session,
    )

    expected_import_id = source_provider_id if id_strategy == IdStrategy.PRESERVE_ID else ""
    target_id = expected_import_id or generated_provider_id
    assert created_kwargs[0]["import_id"] == expected_import_id
    assert id_mapping[source_provider_id] == target_id
    assert id_mapping_details == [
        ResourceIdMapping(ResourceType.WORKFLOW_TOOL, "embedded_workflow_as_tool", source_provider_id, target_id)
    ]


def test_workflow_tool_skip_records_id_mapping(database: Database):
    _persist_tenant_account(database.session)
    source_app_id = "00000000-0000-0000-0000-000000000031"
    target_app_id = "00000000-0000-0000-0000-000000000032"
    source_provider_id = "00000000-0000-0000-0000-000000000034"
    _persist_app(database.session, app_id=target_app_id)
    existing = _persist_workflow_provider(
        database.session, provider_id="00000000-0000-0000-0000-000000000033", app_id=target_app_id
    )
    id_mapping = {source_app_id: target_app_id}

    class SkipImportService(MigrationImportService):
        def _ensure_workflow_app_is_published(self, target, account, app_id, session):
            return None

    SkipImportService()._import_workflow_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "workflow_tools": [
                    {"id": source_provider_id, "name": "embedded_workflow_as_tool", "app_id": source_app_id}
                ],
            }
        ),
        ImportTarget("tenant-1", "target", "account-1", "owner@example.com"),
        ImportOptions(conflict_strategy=ConflictStrategy.SKIP, id_strategy=IdStrategy.GENERATE_NEW_ID),
        id_mapping,
        [],
        [],
        session=database.session,
    )

    assert id_mapping[source_provider_id] == existing.id


@pytest.mark.parametrize("conflict_strategy", [ConflictStrategy.SKIP, ConflictStrategy.UPDATE])
def test_api_tool_existing_provider_records_id_mapping(
    monkeypatch: pytest.MonkeyPatch, database: Database, conflict_strategy: ConflictStrategy
):
    target_provider = _persist_api_provider(database.session, provider_id="target-api-provider-id")
    _persist_api_provider(database.session, provider_id="other-tenant-provider-id", tenant_id="tenant-2")
    id_mapping = {}
    id_mapping_details = []
    report_items = []

    monkeypatch.setattr(
        import_service.ApiToolManageService, "parser_api_schema", lambda schema: {"schema_type": "openapi"}
    )
    monkeypatch.setattr(import_service.ApiToolManageService, "update_api_tool_provider", lambda **kwargs: None)

    MigrationImportService()._import_api_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "tools": [{"id": "source-api-provider-id", "provider_name": "weather", "schema": "openapi: 3.0.0"}],
            }
        ),
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        ImportOptions(conflict_strategy=conflict_strategy),
        report_items,
        id_mapping,
        id_mapping_details,
        {"weather": {"source-api-provider-id-from-dsl"}},
        session=database.session,
    )

    assert id_mapping == {
        "source-api-provider-id": "target-api-provider-id",
        "source-api-provider-id-from-dsl": "target-api-provider-id",
    }
    assert (
        ResourceIdMapping(ResourceType.API_TOOL, "weather", "source-api-provider-id", "target-api-provider-id")
        in id_mapping_details
    )


def test_api_tool_create_records_id_mapping(monkeypatch: pytest.MonkeyPatch, database: Database):
    id_mapping = {}

    monkeypatch.setattr(
        import_service.ApiToolManageService, "parser_api_schema", lambda schema: {"schema_type": "openapi"}
    )

    def create_api_tool_provider(**_kwargs) -> None:
        _persist_api_provider(database.session, provider_id="target-api-provider-id")

    monkeypatch.setattr(import_service.ApiToolManageService, "create_api_tool_provider", create_api_tool_provider)

    MigrationImportService()._import_api_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "tools": [{"id": "source-api-provider-id", "provider_name": "weather", "schema": "openapi: 3.0.0"}],
            }
        ),
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        ImportOptions(),
        [],
        id_mapping,
        [],
        {},
        session=database.session,
    )

    assert id_mapping["source-api-provider-id"] == "target-api-provider-id"


def test_mcp_tool_import_restores_exported_tool_list(monkeypatch: pytest.MonkeyPatch, database: Database):
    provider = _persist_mcp_provider(database.session, provider_id="target-provider-id")
    report_items = []

    class StubMCPToolManageService:
        def __init__(self, session):
            self.session = session

        def update_provider(self, **kwargs):
            return None

    monkeypatch.setattr(import_service, "MCPToolManageService", StubMCPToolManageService)

    MigrationImportService()._import_mcp_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "mcp_tools": [
                    {
                        "id": "source-provider-id",
                        "name": "my-test-mcp",
                        "server_identifier": "my-test-mcp",
                        "server_url": "http://localhost:3000/mcp",
                        "configuration": {},
                        "tools": [{"name": "echo"}],
                    }
                ],
            }
        ),
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        ImportOptions(conflict_strategy=ConflictStrategy.UPDATE),
        report_items,
        {},
        [],
        session=database.session,
    )

    database.session.refresh(provider)
    assert provider.tools == '[{"name": "echo"}]'
    assert provider.authed is True


@pytest.mark.parametrize("conflict_strategy", [ConflictStrategy.SKIP, ConflictStrategy.UPDATE])
def test_mcp_tool_existing_provider_records_id_mapping(
    monkeypatch: pytest.MonkeyPatch, database: Database, conflict_strategy: ConflictStrategy
):
    provider = _persist_mcp_provider(database.session, provider_id="target-mcp-provider-id")
    _persist_mcp_provider(
        database.session,
        provider_id="other-mcp-provider-id",
        server_identifier="other-mcp",
        name="other-mcp",
        tenant_id="tenant-2",
    )
    id_mapping = {}
    id_mapping_details = []

    class StubMCPToolManageService:
        def __init__(self, session):
            self.session = session

        def update_provider(self, **kwargs):
            return None

    monkeypatch.setattr(import_service, "MCPToolManageService", StubMCPToolManageService)

    MigrationImportService()._import_mcp_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "mcp_tools": [
                    {
                        "id": "source-mcp-provider-id",
                        "name": "my-test-mcp",
                        "server_identifier": "my-test-mcp",
                        "server_url": "http://localhost:3000/mcp",
                        "configuration": {},
                        "tools": [{"name": "echo"}],
                    }
                ],
            }
        ),
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        ImportOptions(conflict_strategy=conflict_strategy),
        [],
        id_mapping,
        id_mapping_details,
        session=database.session,
    )

    assert id_mapping["source-mcp-provider-id"] == "target-mcp-provider-id"
    assert "my-test-mcp" not in id_mapping
    assert id_mapping_details == [
        ResourceIdMapping(ResourceType.MCP_TOOL, "my-test-mcp", "source-mcp-provider-id", "target-mcp-provider-id")
    ]


def test_mcp_tool_create_records_id_mapping(monkeypatch: pytest.MonkeyPatch, database: Database):
    id_mapping = {}

    class StubMCPToolManageService:
        def __init__(self, session):
            self.session = session

        def create_provider(self, **kwargs):
            _persist_mcp_provider(
                database.session,
                provider_id="target-mcp-provider-id",
                server_identifier=kwargs["server_identifier"],
                name=kwargs["name"],
                tenant_id=kwargs["tenant_id"],
            )

    monkeypatch.setattr(import_service, "MCPToolManageService", StubMCPToolManageService)

    MigrationImportService()._import_mcp_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "mcp_tools": [
                    {
                        "id": "source-mcp-provider-id",
                        "name": "my-test-mcp",
                        "server_identifier": "my-test-mcp",
                        "server_url": "http://localhost:3000/mcp",
                        "configuration": {},
                    }
                ],
            }
        ),
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        ImportOptions(),
        [],
        id_mapping,
        [],
        session=database.session,
    )

    assert id_mapping["source-mcp-provider-id"] == "target-mcp-provider-id"


def test_dependency_only_mcp_preflight_reports_missing_target_provider_with_workflow_context(database: Database):
    report_items = []
    package = MigrationPackage.from_mapping(
        {
            "metadata": {"version": "1", "source_scope": "single"},
            "dependencies": [
                {
                    "kind": "mcp_tool",
                    "provider_id": "my-test-mcp-server",
                    "provider_name": "my-test-mcp",
                }
            ],
            "workflows": [
                {
                    "name": "workflow2",
                    "dsl": yaml.safe_dump(
                        {
                            "workflow": {
                                "graph": {
                                    "nodes": [
                                        {
                                            "id": "node-1",
                                            "data": {
                                                "type": "tool",
                                                "provider_type": "mcp",
                                                "provider_id": "my-test-mcp-server",
                                                "tool_name": "echo",
                                            },
                                        }
                                    ]
                                }
                            }
                        }
                    ),
                }
            ],
        }
    )

    MigrationImportService()._preflight_dependency_only_mcp(
        package,
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        report_items,
        session=database.session,
    )

    assert report_items == [
        ResourceReportItem(
            ResourceType.DEPENDENCY,
            "my-test-mcp-server",
            "mcp_tool my-test-mcp",
            "skipped",
            "missing in target tenant; referenced by workflow2 / echo; "
            "configure it manually before running the workflow.",
        )
    ]


def test_dependency_only_mcp_lookup_does_not_compare_non_uuid_identifier_to_uuid_id(database: Database):
    provider = _persist_mcp_provider(database.session, provider_id="provider-1", server_identifier="my-test-mcp-server")
    statements = []

    def capture_statement(orm_execute_state) -> None:
        statements.append(orm_execute_state.statement)

    event.listen(database.session, "do_orm_execute", capture_statement)
    try:
        result = MigrationImportService()._find_dependency_only_mcp_provider(
            "tenant-1",
            "my-test-mcp-server",
            "my-test-mcp",
            session=database.session,
        )
    finally:
        event.remove(database.session, "do_orm_execute", capture_statement)

    assert result is provider
    where_clause = str(statements[0].whereclause)
    assert f"{MCPToolProvider.__tablename__}.id" not in where_clause


def test_dependency_only_mcp_preflight_reports_available_target_provider(database: Database):
    report_items = []
    package = MigrationPackage.from_mapping(
        {
            "metadata": {"version": "1", "source_scope": "single"},
            "dependencies": [{"kind": "mcp_tool", "provider_id": "my-test-mcp-server"}],
        }
    )
    _persist_mcp_provider(
        database.session,
        provider_id="target-provider-id",
        server_identifier="my-test-mcp-server",
    )
    _persist_mcp_provider(
        database.session,
        provider_id="other-provider-id",
        server_identifier="other-server",
        name="other-provider",
        tenant_id="tenant-2",
    )

    MigrationImportService()._preflight_dependency_only_mcp(
        package,
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        report_items,
        session=database.session,
    )

    assert report_items == [
        ResourceReportItem(
            ResourceType.DEPENDENCY,
            "my-test-mcp-server",
            "mcp_tool my-test-mcp",
            "available",
            "MCP provider exists in target tenant.",
        )
    ]


def test_import_package_imports_workflow_tool_provider_apps_before_consumers(database: Database):
    events = []

    class StubResolver(ImportTargetResolver):
        def resolve(self, request, session):
            return ImportTarget(
                tenant_id="tenant-1",
                tenant_name="target",
                operator_id="account-1",
                operator_email="owner@example.com",
            )

    class OrderedImportService(MigrationImportService):
        def _import_api_tools(
            self,
            package,
            target,
            options,
            report_items,
            id_mapping,
            id_mapping_details,
            source_provider_ids_by_name,
            *,
            session=None,
        ):
            events.append(("api_tools", "imported"))

        def _import_workflows(
            self,
            package,
            target,
            options,
            report_items,
            id_mapping,
            id_mapping_details,
            *,
            imported_workflow_ids=None,
            only_app_ids=None,
            skip_app_ids=None,
            session=None,
        ):
            only_app_ids = set(only_app_ids or [])
            skip_app_ids = set(skip_app_ids or [])
            for workflow_data in package.workflows:
                app_id = workflow_data["id"]
                if only_app_ids and app_id not in only_app_ids:
                    continue
                if app_id in skip_app_ids:
                    continue
                events.append(("workflow", app_id))
                id_mapping[app_id] = app_id
                if imported_workflow_ids is not None:
                    imported_workflow_ids.add(app_id)

        def _import_workflow_tools(
            self, package, target, options, id_mapping, id_mapping_details, report_items, *, session=None
        ):
            events.append(("workflow_tool", package.workflow_tools[0]["id"]))

        def _import_mcp_tools(
            self, package, target, options, report_items, id_mapping, id_mapping_details, *, session=None
        ):
            events.append(("mcp_tools", "imported"))

    package = MigrationPackage.from_mapping(
        {
            "metadata": {"version": "1", "source_scope": "single"},
            "workflows": [
                {"id": "provider-app", "name": "embedded", "dsl": "app:\n  mode: workflow\n"},
                {"id": "consumer-app", "name": "main", "dsl": "app:\n  mode: advanced-chat\n"},
            ],
            "workflow_tools": [{"id": "workflow-tool", "name": "embedded_tool", "app_id": "provider-app"}],
        }
    )

    OrderedImportService(target_resolver=StubResolver()).import_package(
        ImportRequest(package=package), session=database.session
    )

    assert events == [
        ("api_tools", "imported"),
        ("mcp_tools", "imported"),
        ("workflow", "provider-app"),
        ("workflow_tool", "workflow-tool"),
        ("workflow", "consumer-app"),
    ]
