from services.data_migration.entities import ReportContext, ResourceIdMapping, ResourceReportItem, ResourceType
from services.data_migration.report_service import MigrationReportService


def test_report_summarizes_by_resource_type_and_status():
    lines = MigrationReportService().render(
        [
            ResourceReportItem(ResourceType.WORKFLOW, "app-1", "App", "exported"),
            ResourceReportItem(ResourceType.API_TOOL, "weather", "Weather", "exported"),
            ResourceReportItem(ResourceType.DEPENDENCY, "mcp-1", "MCP", "dependency-only"),
        ]
    )

    assert "workflow exported: 1" in lines
    assert "api_tool exported: 1" in lines
    assert "dependency dependency-only: 1" in lines


def test_report_includes_actionable_lines_for_skipped_and_unresolved_items():
    lines = MigrationReportService().render(
        [
            ResourceReportItem(ResourceType.WORKFLOW, "app-1", "App", "skipped", "App already exists"),
            ResourceReportItem(ResourceType.DEPENDENCY, "mcp-1", None, "unresolved", "MCP provider not found"),
            ResourceReportItem(ResourceType.API_TOOL, "weather", "Weather", "exported"),
        ]
    )

    assert "workflow skipped: 1" in lines
    assert "dependency unresolved: 1" in lines
    assert "workflow app-1: App already exists" in lines
    assert "dependency mcp-1: MCP provider not found" in lines


def test_report_dependency_detail_uses_type_and_name_when_available():
    lines = MigrationReportService().render(
        [
            ResourceReportItem(
                ResourceType.DEPENDENCY,
                "785e52f1-06bf-483c-8dcf-712e59fd43b9",
                "workflow embedded_workflow",
                "dependency-only",
                "Dependency metadata only; ensure the resource exists in the target environment.",
            ),
            ResourceReportItem(
                ResourceType.DEPENDENCY,
                "my-test-mcp",
                "mcp_tool my-test-mcp",
                "dependency-only",
                "Configure MCP provider manually in the target tenant unless exporting with secrets enabled.",
            ),
        ]
    )

    assert (
        "dependency workflow embedded_workflow: 785e52f1-06bf-483c-8dcf-712e59fd43b9: "
        "Dependency metadata only; ensure the resource exists in the target environment."
    ) in lines
    assert (
        "dependency mcp_tool my-test-mcp: "
        "Configure MCP provider manually in the target tenant unless exporting with secrets enabled."
    ) in lines


def test_report_includes_dependency_only_detail_lines():
    lines = MigrationReportService().render(
        [
            ResourceReportItem(
                ResourceType.DEPENDENCY,
                "mcp-1",
                "MCP",
                "dependency-only",
                "Configure manually in target tenant.",
            ),
        ]
    )

    assert "dependency dependency-only: 1" in lines
    assert "dependency mcp-1: Configure manually in target tenant." in lines


def test_report_includes_export_and_import_context():
    lines = MigrationReportService().render(
        [],
        context=ReportContext(
            output_path="migration-data.json",
            source_scope="single",
            selected_app_count=2,
            include_secrets=False,
            target_tenant="prod",
            operator_email="admin@example.com",
            app_api_tokens_created=1,
            app_api_tokens_reused=2,
            id_mapping_count=3,
            id_mappings={"source-app": "target-app", "source-tool": "target-tool"},
            id_mapping_details=[
                ResourceIdMapping(ResourceType.WORKFLOW, "Main workflow", "source-app", "target-app"),
                ResourceIdMapping(ResourceType.API_TOOL, "weather", "source-tool", "target-tool"),
            ],
        ),
    )

    assert "output: migration-data.json" in lines
    assert "source scope: single" in lines
    assert "selected apps: 2" in lines
    assert "include secrets: false" in lines
    assert "target tenant: prod" in lines
    assert "operator: admin@example.com" in lines
    assert "app api tokens: 1 created, 2 reused" in lines
    assert "resource references resolved: 2" in lines
    assert "- workflow Main workflow: source-app -> target-app" in lines
    assert "- api_tool weather: source-tool -> target-tool" in lines
