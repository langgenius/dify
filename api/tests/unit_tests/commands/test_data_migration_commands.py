from click.testing import CliRunner

from commands.data_migration import ID_STRATEGY_CHOICES, export_migration_data, import_migration_data


def test_export_command_requires_input_and_output():
    result = CliRunner().invoke(export_migration_data, [])

    assert result.exit_code != 0
    assert "--input" in result.output
    assert "--output" in result.output


def test_import_command_requires_input_and_target_tenant_or_package_metadata():
    result = CliRunner().invoke(import_migration_data, [])

    assert result.exit_code != 0
    assert "--input" in result.output


def test_import_command_does_not_expose_unimplemented_map_id_strategy():
    assert ID_STRATEGY_CHOICES == ["preserve-id", "generate-new-id"]
