from click.testing import CliRunner

from commands.data_migration import export_migration_data, import_migration_data


def test_export_command_requires_input_and_output():
    result = CliRunner().invoke(export_migration_data, [])

    assert result.exit_code != 0
    assert "--input" in result.output
    assert "--output" in result.output


def test_import_command_requires_input_and_target_tenant_or_package_metadata():
    result = CliRunner().invoke(import_migration_data, [])

    assert result.exit_code != 0
    assert "--input" in result.output
