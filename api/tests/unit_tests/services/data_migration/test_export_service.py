import pytest

from services.data_migration.dependency_discovery_service import DiscoveredDependency
from services.data_migration.entities import (
    ConflictStrategy,
    DependencyKind,
    IdStrategy,
    MigrationDataError,
    ResourceType,
)
from services.data_migration.export_service import ExportConfigParser, MigrationExportService


def test_export_config_parser_accepts_new_scripted_shape():
    selection = ExportConfigParser().parse(
        {
            "source_tenant": {"mode": "single", "name": "admin's Workspace"},
            "apps": {"modes": ["workflow", "advanced-chat"], "ids": ["app-1"], "all": False},
            "include_referenced_tools": True,
            "additional_tools": {
                "api_tools": ["weather"],
                "workflow_tools": ["workflow-tool-1"],
                "mcp_tools": ["mcp-1"],
            },
            "include_secrets": False,
            "import_options": {
                "create_app_api_token_on_import": True,
                "id_strategy": "preserve-id",
                "conflict_strategy": "fail",
            },
        }
    )

    assert selection.source_tenant_name == "admin's Workspace"
    assert selection.app_ids == ["app-1"]
    assert selection.export_all_apps is False
    assert selection.additional_api_tools == ["weather"]
    assert selection.additional_workflow_tools == ["workflow-tool-1"]
    assert selection.additional_mcp_tools == ["mcp-1"]
    assert selection.include_secrets is False
    assert selection.import_options.create_app_api_token_on_import is True
    assert selection.import_options.id_strategy == IdStrategy.PRESERVE_ID
    assert selection.import_options.conflict_strategy == ConflictStrategy.FAIL


def test_export_config_parser_defaults_to_secret_free_all_apps():
    selection = ExportConfigParser().parse(
        {
            "source_tenant": {"name": "source"},
            "apps": {"all": True},
        }
    )

    assert selection.export_all_apps is True
    assert selection.include_referenced_tools is True
    assert selection.include_secrets is False


def test_export_config_parser_requires_explicit_source_tenant_name_for_new_shape():
    with pytest.raises(MigrationDataError, match="source_tenant.name"):
        ExportConfigParser().parse({"source_tenant": {"mode": "single"}, "apps": {"all": True}})


def test_export_config_parser_accepts_limited_backwards_draft_shape():
    selection = ExportConfigParser().parse(
        {
            "tenant_name": "legacy-source",
            "workflows": ["app-1"],
            "tools": ["weather"],
            "workflow_tools": ["wf-tool-1"],
            "mcp_tools": ["mcp-1"],
            "export_all_workflows": False,
        }
    )

    assert selection.source_tenant_name == "legacy-source"
    assert selection.app_ids == ["app-1"]
    assert selection.additional_api_tools == ["weather"]
    assert selection.additional_workflow_tools == ["wf-tool-1"]
    assert selection.additional_mcp_tools == ["mcp-1"]
    assert selection.include_secrets is False


def test_export_config_parser_rejects_unsupported_app_modes():
    with pytest.raises(MigrationDataError, match="Unsupported app modes"):
        ExportConfigParser().parse(
            {
                "source_tenant": {"name": "source"},
                "apps": {"modes": ["chat"], "all": True},
            }
        )


def test_secret_free_api_tool_export_uses_masking_and_omits_credentials(monkeypatch):
    calls = []

    def fake_get_api_provider(provider: str, tenant_id: str, mask: bool = True):
        calls.append((provider, tenant_id, mask))
        return {"credentials": {"api_key": "masked"}, "schema": {"openapi": "3.0.0"}, "tools": ["unused"]}

    monkeypatch.setattr(
        "services.data_migration.export_service.ToolManager.user_get_api_provider",
        fake_get_api_provider,
    )
    service = MigrationExportService()
    tools: list[dict] = []
    report_items = []

    service._export_api_tools(
        "tenant-1",
        ["weather"],
        include_secrets=False,
        exported_tools=tools,
        report_items=report_items,
    )

    assert calls == [("weather", "tenant-1", True)]
    assert tools == [{"schema": {"openapi": "3.0.0"}, "provider_name": "weather", "source_tenant_id": "tenant-1"}]
    assert report_items[0].resource_type == ResourceType.API_TOOL


def test_secret_free_mcp_dependencies_are_dependency_only():
    service = MigrationExportService()
    dependencies: list[dict] = []
    mcp_tools: list[dict] = []
    report_items = []

    service._export_mcp_tools(
        object(),
        tenant_id="tenant-1",
        provider_ids=["mcp-1"],
        include_secrets=False,
        exported_mcp_tools=mcp_tools,
        dependencies=dependencies,
        report_items=report_items,
    )

    assert mcp_tools == []
    assert dependencies == [
        {
            "kind": DependencyKind.MCP_TOOL.value,
            "provider_id": "mcp-1",
            "provider_name": None,
            "source": "mcp_provider",
        }
    ]
    assert report_items[0].status == "dependency-only"
    assert report_items[0].name == "mcp_tool mcp-1"


def test_get_mcp_provider_does_not_compare_non_uuid_identifier_to_uuid_id():
    statements = []

    class StubSession:
        def scalar(self, statement):
            statements.append(str(statement))

    with pytest.raises(MigrationDataError, match="MCP provider not found"):
        MigrationExportService()._get_mcp_provider(StubSession(), "tenant-1", "my-test-mcp")

    assert len(statements) == 1
    assert "tool_mcp_providers.id =" not in statements[0]
    assert "tool_mcp_providers.server_identifier =" in statements[0]


def test_dependency_ids_are_deduplicated_with_manual_selection_first():
    service = MigrationExportService()
    provider_ids = service._provider_ids(
        manual_provider_ids=["weather", "weather", "manual"],
        discovered_dependencies=[
            DiscoveredDependency(DependencyKind.API_TOOL, "weather"),
            DiscoveredDependency(DependencyKind.API_TOOL, "forecast"),
            DiscoveredDependency(DependencyKind.WORKFLOW_TOOL, "workflow-tool"),
        ],
        kind=DependencyKind.API_TOOL,
    )

    assert provider_ids == ["weather", "manual", "forecast"]


def test_api_provider_ids_use_provider_name_from_discovered_dependencies():
    service = MigrationExportService()
    provider_ids = service._provider_ids(
        manual_provider_ids=[],
        discovered_dependencies=[
            DiscoveredDependency(DependencyKind.API_TOOL, "api-provider-id", provider_name="weather"),
        ],
        kind=DependencyKind.API_TOOL,
    )

    assert provider_ids == ["weather"]


def test_mcp_authentication_export_omits_runtime_header_shape():
    service = MigrationExportService()

    assert service._serialize_mcp_authentication({"Authorization": "Bearer token"}) is None
    assert service._serialize_mcp_authentication({"client_id": "id", "client_secret": "secret"}) == {
        "client_id": "id",
        "client_secret": "secret",
    }
