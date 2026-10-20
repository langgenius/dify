"""CLI migration tests using real command-owned SQLite sessions.

Migration services and package I/O remain fakes so these cases can focus on
CLI parsing and session lifecycle without fabricating the SQLAlchemy boundary.
"""

import json
from pathlib import Path
from unittest.mock import create_autospec

from click.testing import CliRunner
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from commands import data_migration
from commands.data_migration import (
    ID_STRATEGY_CHOICES,
    export_migration_data,
    export_migration_data_template,
    import_migration_data,
)
from extensions import ext_application_services
from services.data_migration.entities import (
    ConflictStrategy,
    ExportResult,
    ImportOptions,
    ImportResult,
    MigrationPackage,
    ReportContext,
)
from services.workflow.console_service import ConsoleWorkflowService


def test_export_command_requires_input_and_output():
    result = CliRunner().invoke(export_migration_data, [])

    assert result.exit_code != 0
    assert export_migration_data.name == "export-app-migration"
    assert "--input" in result.output
    assert "--output" in result.output


def test_import_command_requires_input_and_target_tenant_or_package_metadata():
    result = CliRunner().invoke(import_migration_data, [])

    assert result.exit_code != 0
    assert import_migration_data.name == "import-app-migration"
    assert "--input" in result.output


def test_import_command_does_not_expose_unimplemented_map_id_strategy():
    assert ID_STRATEGY_CHOICES == ["preserve-id", "generate-new-id"]


def test_export_template_command_prints_scripted_json_template():
    result = CliRunner().invoke(export_migration_data_template, [])

    assert result.exit_code == 0
    assert export_migration_data_template.name == "app-migration-template"
    template = json.loads(result.output)
    assert template == {
        "source_tenant": {"mode": "single", "id": "", "name": "admin's Workspace"},
        "apps": {"modes": ["workflow", "advanced-chat"], "ids": [], "all": True},
        "include_referenced_tools": True,
        "additional_tools": {"api_tools": [], "workflow_tools": [], "mcp_tools": []},
        "include_secrets": False,
        "import_options": {
            "create_app_api_token_on_import": False,
            "id_strategy": "preserve-id",
            "conflict_strategy": "fail",
        },
    }


def test_export_template_command_writes_output_file(tmp_path: Path):
    output_file = tmp_path / "export-template.json"

    result = CliRunner().invoke(export_migration_data_template, ["--output", str(output_file)])

    assert result.exit_code == 0
    assert f"Output written to {output_file}" in result.output
    assert json.loads(output_file.read_text())["apps"]["all"] is True


def test_export_template_command_requires_overwrite_for_existing_output(tmp_path: Path):
    output_file = tmp_path / "export-template.json"
    output_file.write_text("{}")

    result = CliRunner().invoke(export_migration_data_template, ["--output", str(output_file)])

    assert result.exit_code != 0
    assert "already exists" in result.output


def test_export_command_uses_cli_owned_session(
    monkeypatch, tmp_path: Path, sqlite_engine: Engine, workflow_application
):
    captured: dict[str, object] = {}
    input_file = tmp_path / "export-config.json"
    output_file = tmp_path / "migration-package.json"
    input_file.write_text(json.dumps({"source_tenant": {"name": "source"}, "apps": {"all": True}}))
    package = MigrationPackage.from_mapping({"metadata": {"version": "1", "source_scope": "single"}})

    class FakeMigrationExportService:
        def __init__(self, *, workflow_tools, tool_providers):
            assert tool_providers is workflow_application.tools.tool_providers
            assert workflow_tools is workflow_application.tools.workflows

        def export(self, selection, *, session):
            captured["session"] = session
            captured["selection"] = selection
            return ExportResult(package=package, report_items=[], report_context=ReportContext())

    class FakeMigrationPackageService:
        def save_package(self, package_to_save, path, *, overwrite):
            captured["package"] = package_to_save
            captured["path"] = path
            captured["overwrite"] = overwrite

    monkeypatch.setattr(data_migration, "MigrationExportService", FakeMigrationExportService)
    monkeypatch.setattr(data_migration, "MigrationPackageService", FakeMigrationPackageService)

    result = CliRunner().invoke(
        export_migration_data,
        ["--input", str(input_file), "--output", str(output_file)],
    )

    assert result.exit_code == 0
    captured_session = captured["session"]
    assert isinstance(captured_session, Session)
    assert captured_session.get_bind() is sqlite_engine
    assert captured_session.in_transaction() is False
    assert captured["package"] is package
    assert captured["path"] == str(output_file)
    assert captured["overwrite"] is False


def test_import_command_uses_cli_owned_session(
    monkeypatch, tmp_path: Path, sqlite_engine: Engine, workflow_application
):
    captured: dict[str, object] = {}
    input_file = tmp_path / "migration-package.json"
    input_file.write_text("{}")
    package = MigrationPackage.from_mapping(
        {
            "metadata": {
                "version": "1",
                "source_scope": "single",
                "target_tenant": {"name": "target"},
                "import_options": {"conflict_strategy": "fail"},
            }
        }
    )

    publisher = create_autospec(ConsoleWorkflowService, instance=True)
    services = create_autospec(ext_application_services.ApplicationServices, instance=True)
    services.console_workflows = publisher
    services.tools = workflow_application.tools
    monkeypatch.setattr(data_migration, "application_services", lambda: services)

    class FakeMigrationImportService:
        def __init__(self, *, workflows, app_dsl, workflow_tools):
            assert workflow_tools is services.tools.workflows
            from extensions.application_services.workflow import build_app_dsl_service

            assert workflows is publisher
            assert app_dsl is build_app_dsl_service

        def import_package(self, request, *, session):
            captured["session"] = session
            captured["request"] = request
            return ImportResult(report_items=[], report_context=ReportContext(target_tenant="target"))

    class FakeMigrationPackageService:
        def load_package(self, path):
            captured["path"] = path
            return package

    monkeypatch.setattr(data_migration, "MigrationImportService", FakeMigrationImportService)
    monkeypatch.setattr(data_migration, "MigrationPackageService", FakeMigrationPackageService)

    result = CliRunner().invoke(
        import_migration_data,
        ["--input", str(input_file), "--conflict-strategy", "skip"],
    )

    assert result.exit_code == 0
    captured_session = captured["session"]
    assert isinstance(captured_session, Session)
    assert captured_session.get_bind() is sqlite_engine
    assert captured_session.in_transaction() is False
    assert captured["path"] == str(input_file)
    request = captured["request"]
    assert request.package is package
    assert request.options_override == ImportOptions(conflict_strategy=ConflictStrategy.SKIP)
