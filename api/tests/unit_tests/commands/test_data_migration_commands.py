import json

from click.testing import CliRunner

from commands.data_migration import (
    ID_STRATEGY_CHOICES,
    export_migration_data,
    export_migration_data_template,
    import_migration_data,
)


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


def test_export_template_command_writes_output_file(tmp_path):
    output_file = tmp_path / "export-template.json"

    result = CliRunner().invoke(export_migration_data_template, ["--output", str(output_file)])

    assert result.exit_code == 0
    assert f"Output written to {output_file}" in result.output
    assert json.loads(output_file.read_text())["apps"]["all"] is True


def test_export_template_command_requires_overwrite_for_existing_output(tmp_path):
    output_file = tmp_path / "export-template.json"
    output_file.write_text("{}")

    result = CliRunner().invoke(export_migration_data_template, ["--output", str(output_file)])

    assert result.exit_code != 0
    assert "already exists" in result.output
