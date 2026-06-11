import pytest
import yaml

from models.tools import MCPToolProvider, WorkflowToolProvider
from services.app_dsl_service import Import
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


def test_package_target_tenant_id_ignores_invalid_uuid(monkeypatch):
    package = MigrationPackage.from_mapping(
        {"metadata": {"version": "1", "source_scope": "single", "target_tenant": {"id": "not-a-uuid"}}}
    )

    class StubSession:
        def get(self, model, identifier):
            raise AssertionError("invalid UUID should not be passed to session.get")

        def scalars(self, statement):
            class EmptyResult:
                def all(self):
                    return []

            return EmptyResult()

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())

    with pytest.raises(MigrationDataError, match="Target tenant not found"):
        ImportTargetResolver().resolve(ImportRequest(package=package))


def test_options_override_replaces_package_defaults():
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
        def resolve(self, request: ImportRequest) -> ImportTarget:
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
        ImportRequest(package=package, options_override=override)
    )

    assert captured_options == [override]


def test_only_preserve_id_strategy_reuses_source_app_id():
    service = MigrationImportService()

    assert service._should_preserve_source_app_id(ImportOptions(id_strategy=IdStrategy.PRESERVE_ID)) is True
    assert service._should_preserve_source_app_id(ImportOptions(id_strategy=IdStrategy.GENERATE_NEW_ID)) is False


def test_find_existing_app_ignores_invalid_uuid(monkeypatch):
    class StubSession:
        def scalar(self, statement):
            raise AssertionError("invalid UUID should not be queried against App.id")

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())

    assert MigrationImportService()._find_existing_app("not-a-uuid", "tenant-1") is None


def test_find_existing_workflow_tool_does_not_compare_invalid_uuid(monkeypatch):
    captured = []

    class StubSession:
        def scalar(self, statement):
            captured.append(statement)

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())

    MigrationImportService()._find_existing_workflow_tool("tenant-1", "not-a-uuid", "tool-name", "app-id")

    where_clause = str(captured[0].whereclause)
    assert f"{WorkflowToolProvider.__tablename__}.id" not in where_clause


def test_find_existing_mcp_tool_does_not_compare_invalid_uuid(monkeypatch):
    captured = []

    class StubSession:
        def scalar(self, statement):
            captured.append(statement)

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())

    MigrationImportService()._find_existing_mcp_tool("tenant-1", "my-test-mcp", "my-test-mcp")

    where_clause = str(captured[0].whereclause)
    assert f"{MCPToolProvider.__tablename__}.id" not in where_clause
    assert f"{MCPToolProvider.__tablename__}.name" not in where_clause


def test_workflow_app_import_does_not_wrap_app_dsl_import_in_nested_transaction(monkeypatch):
    class FailingNestedTransaction:
        def __enter__(self):
            raise AssertionError("nested transaction should not be opened")

        def __exit__(self, exc_type, exc_value, traceback):
            return False

    class StubSession:
        def begin_nested(self):
            return FailingNestedTransaction()

        def commit(self):
            return None

    class StubAppDslService:
        def __init__(self, session):
            self.session = session

        def import_app(self, **kwargs):
            return Import(id="import-id", status=ImportStatus.COMPLETED, app_id="imported-app-id")

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())
    monkeypatch.setattr(import_service, "AppDslService", StubAppDslService)

    imported_app_id = MigrationImportService()._import_workflow_app(
        account=object(),
        workflow_data={"name": "main_chatflow"},
        dsl_content="app:\n  mode: workflow\n",
        app_id="source-app-id",
        existing_app=None,
        options=ImportOptions(id_strategy=IdStrategy.PRESERVE_ID),
    )

    assert imported_app_id == "imported-app-id"


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


def test_workflow_tool_import_publishes_referenced_app_before_create(monkeypatch):
    events = []
    account = type("Account", (), {"id": "account-1"})()

    class StubSession:
        def get(self, model, identifier):
            return account

    class PublishingImportService(MigrationImportService):
        def _find_existing_app(self, app_id, tenant_id):
            return object()

        def _find_existing_workflow_tool(self, tenant_id, workflow_tool_id, tool_name, app_id):
            if ("created", app_id) in events:
                return type("WorkflowToolProvider", (), {"id": workflow_tool_id or "created-workflow-tool-id"})()
            return None

        def _ensure_workflow_app_is_published(self, target, account, app_id):
            events.append(("published", app_id))

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())
    monkeypatch.setattr(
        import_service.WorkflowToolManageService,
        "create_workflow_tool",
        lambda **kwargs: events.append(("created", kwargs["workflow_app_id"])),
    )

    PublishingImportService()._import_workflow_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "workflow_tools": [
                    {
                        "id": "workflow-tool-1",
                        "name": "embedded_workflow_as_tool",
                        "app_id": "workflow-app-1",
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
        {},
        [],
        [],
    )

    assert events == [("published", "workflow-app-1"), ("created", "workflow-app-1")]


@pytest.mark.parametrize(
    ("id_strategy", "expected_import_id"),
    [
        (IdStrategy.PRESERVE_ID, "source-workflow-tool-id"),
        (IdStrategy.GENERATE_NEW_ID, ""),
    ],
)
def test_workflow_tool_import_id_follows_id_strategy(monkeypatch, id_strategy, expected_import_id):
    created_kwargs = []
    target_provider = type("WorkflowToolProvider", (), {"id": "target-workflow-tool-id"})()
    account = type("Account", (), {"id": "account-1"})()
    id_mapping = {"source-app-id": "target-app-id"}
    id_mapping_details = []

    class StubSession:
        def get(self, model, identifier):
            return account

    class StrategyImportService(MigrationImportService):
        def _find_existing_app(self, app_id, tenant_id):
            return object()

        def _find_existing_workflow_tool(self, tenant_id, workflow_tool_id, tool_name, app_id):
            return target_provider if created_kwargs else None

        def _ensure_workflow_app_is_published(self, target, account, app_id):
            return None

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())
    monkeypatch.setattr(
        import_service.WorkflowToolManageService,
        "create_workflow_tool",
        lambda **kwargs: created_kwargs.append(kwargs),
    )

    StrategyImportService()._import_workflow_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "workflow_tools": [
                    {
                        "id": "source-workflow-tool-id",
                        "name": "embedded_workflow_as_tool",
                        "app_id": "source-app-id",
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
        ImportOptions(id_strategy=id_strategy),
        id_mapping,
        id_mapping_details,
        [],
    )

    assert created_kwargs[0]["import_id"] == expected_import_id
    assert id_mapping["source-workflow-tool-id"] == "target-workflow-tool-id"
    assert id_mapping_details == [
        ResourceIdMapping(
            ResourceType.WORKFLOW_TOOL,
            "embedded_workflow_as_tool",
            "source-workflow-tool-id",
            "target-workflow-tool-id",
        )
    ]


def test_workflow_tool_skip_records_id_mapping(monkeypatch):
    account = type("Account", (), {"id": "account-1"})()
    existing_provider = type("WorkflowToolProvider", (), {"id": "existing-workflow-tool-id"})()
    id_mapping = {"source-app-id": "target-app-id"}

    class StubSession:
        def get(self, model, identifier):
            return account

    class SkipImportService(MigrationImportService):
        def _find_existing_app(self, app_id, tenant_id):
            return object()

        def _find_existing_workflow_tool(self, tenant_id, workflow_tool_id, tool_name, app_id):
            return existing_provider

        def _ensure_workflow_app_is_published(self, target, account, app_id):
            return None

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())

    SkipImportService()._import_workflow_tools(
        MigrationPackage.from_mapping(
            {
                "metadata": {"version": "1", "source_scope": "single"},
                "workflow_tools": [
                    {
                        "id": "source-workflow-tool-id",
                        "name": "embedded_workflow_as_tool",
                        "app_id": "source-app-id",
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
        ImportOptions(conflict_strategy=ConflictStrategy.SKIP, id_strategy=IdStrategy.GENERATE_NEW_ID),
        id_mapping,
        [],
        [],
    )

    assert id_mapping["source-workflow-tool-id"] == "existing-workflow-tool-id"


@pytest.mark.parametrize("conflict_strategy", [ConflictStrategy.SKIP, ConflictStrategy.UPDATE])
def test_api_tool_existing_provider_records_id_mapping(monkeypatch, conflict_strategy):
    target_provider = type("ApiToolProvider", (), {"id": "target-api-provider-id", "name": "weather"})()
    id_mapping = {}
    id_mapping_details = []
    report_items = []

    class ExistingApiImportService(MigrationImportService):
        def _find_api_tool_provider(self, tenant_id, provider_name):
            return target_provider

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db.session, "scalar", lambda statement: target_provider)
    monkeypatch.setattr(
        import_service.ApiToolManageService, "parser_api_schema", lambda schema: {"schema_type": "openapi"}
    )
    monkeypatch.setattr(import_service.ApiToolManageService, "update_api_tool_provider", lambda **kwargs: None)

    ExistingApiImportService()._import_api_tools(
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
    )

    assert id_mapping == {
        "source-api-provider-id": "target-api-provider-id",
        "source-api-provider-id-from-dsl": "target-api-provider-id",
    }
    assert (
        ResourceIdMapping(ResourceType.API_TOOL, "weather", "source-api-provider-id", "target-api-provider-id")
        in id_mapping_details
    )


def test_api_tool_create_records_id_mapping(monkeypatch):
    target_provider = type("ApiToolProvider", (), {"id": "target-api-provider-id", "name": "weather"})()
    id_mapping = {}

    class StubSession:
        def scalar(self, statement):
            return None

    class CreatedApiImportService(MigrationImportService):
        def _find_api_tool_provider(self, tenant_id, provider_name):
            return target_provider

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())
    monkeypatch.setattr(
        import_service.ApiToolManageService, "parser_api_schema", lambda schema: {"schema_type": "openapi"}
    )
    monkeypatch.setattr(import_service.ApiToolManageService, "create_api_tool_provider", lambda **kwargs: None)

    CreatedApiImportService()._import_api_tools(
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
    )

    assert id_mapping["source-api-provider-id"] == "target-api-provider-id"


def test_mcp_tool_import_restores_exported_tool_list(monkeypatch):
    provider = type(
        "Provider", (), {"id": "target-provider-id", "tools": "[]", "authed": False, "identity_mode": "off"}
    )()
    report_items = []

    class StubSession:
        def scalar(self, statement):
            return provider

        def commit(self):
            return None

    class StubMCPToolManageService:
        def __init__(self, session):
            self.session = session

        def update_provider(self, **kwargs):
            return None

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())
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
    )

    assert provider.tools == '[{"name": "echo"}]'
    assert provider.authed is True


@pytest.mark.parametrize("conflict_strategy", [ConflictStrategy.SKIP, ConflictStrategy.UPDATE])
def test_mcp_tool_existing_provider_records_id_mapping(monkeypatch, conflict_strategy):
    provider = type(
        "Provider", (), {"id": "target-mcp-provider-id", "tools": "[]", "authed": False, "identity_mode": "off"}
    )()
    id_mapping = {}
    id_mapping_details = []

    class StubSession:
        def commit(self):
            return None

    class ExistingMCPImportService(MigrationImportService):
        def _find_existing_mcp_tool(self, tenant_id, provider_id, server_identifier):
            return provider

    class StubMCPToolManageService:
        def __init__(self, session):
            self.session = session

        def update_provider(self, **kwargs):
            return None

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())
    monkeypatch.setattr(import_service, "MCPToolManageService", StubMCPToolManageService)

    ExistingMCPImportService()._import_mcp_tools(
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
    )

    assert id_mapping["source-mcp-provider-id"] == "target-mcp-provider-id"
    assert "my-test-mcp" not in id_mapping
    assert id_mapping_details == [
        ResourceIdMapping(ResourceType.MCP_TOOL, "my-test-mcp", "source-mcp-provider-id", "target-mcp-provider-id")
    ]


def test_mcp_tool_create_records_id_mapping(monkeypatch):
    provider = type(
        "Provider", (), {"id": "target-mcp-provider-id", "tools": "[]", "authed": False, "identity_mode": "off"}
    )()
    id_mapping = {}
    provider_created = False

    class StubSession:
        def commit(self):
            return None

    class CreatedMCPImportService(MigrationImportService):
        def _find_existing_mcp_tool(self, tenant_id, provider_id, server_identifier):
            return provider if provider_created else None

    class StubMCPToolManageService:
        def __init__(self, session):
            self.session = session

        def create_provider(self, **kwargs):
            nonlocal provider_created
            provider_created = True

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())
    monkeypatch.setattr(import_service, "MCPToolManageService", StubMCPToolManageService)

    CreatedMCPImportService()._import_mcp_tools(
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
    )

    assert id_mapping["source-mcp-provider-id"] == "target-mcp-provider-id"


def test_dependency_only_mcp_preflight_reports_missing_target_provider_with_workflow_context(monkeypatch):
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

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db.session, "scalar", lambda statement: None)

    MigrationImportService()._preflight_dependency_only_mcp(
        package,
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        report_items,
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


def test_dependency_only_mcp_lookup_does_not_compare_non_uuid_identifier_to_uuid_id(monkeypatch):
    captured = []

    class StubSession:
        def scalar(self, statement):
            captured.append(statement)

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db, "session", StubSession())

    MigrationImportService()._find_dependency_only_mcp_provider(
        "tenant-1",
        "my-test-mcp-server",
        "my-test-mcp",
    )

    where_clause = str(captured[0].whereclause)
    assert f"{MCPToolProvider.__tablename__}.id" not in where_clause


def test_dependency_only_mcp_preflight_reports_available_target_provider(monkeypatch):
    report_items = []
    package = MigrationPackage.from_mapping(
        {
            "metadata": {"version": "1", "source_scope": "single"},
            "dependencies": [{"kind": "mcp_tool", "provider_id": "my-test-mcp-server"}],
        }
    )
    provider = type(
        "Provider",
        (),
        {"id": "target-provider-id", "name": "my-test-mcp", "server_identifier": "my-test-mcp-server"},
    )()

    from services.data_migration import import_service

    monkeypatch.setattr(import_service.db.session, "scalar", lambda statement: provider)

    MigrationImportService()._preflight_dependency_only_mcp(
        package,
        ImportTarget(
            tenant_id="tenant-1",
            tenant_name="target",
            operator_id="account-1",
            operator_email="owner@example.com",
        ),
        report_items,
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


def test_import_package_imports_workflow_tool_provider_apps_before_consumers():
    events = []

    class StubResolver(ImportTargetResolver):
        def resolve(self, request):
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

        def _import_workflow_tools(self, package, target, options, id_mapping, id_mapping_details, report_items):
            events.append(("workflow_tool", package.workflow_tools[0]["id"]))

        def _import_mcp_tools(self, package, target, options, report_items, id_mapping, id_mapping_details):
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

    OrderedImportService(target_resolver=StubResolver()).import_package(ImportRequest(package=package))

    assert events == [
        ("api_tools", "imported"),
        ("mcp_tools", "imported"),
        ("workflow", "provider-app"),
        ("workflow_tool", "workflow-tool"),
        ("workflow", "consumer-app"),
    ]
