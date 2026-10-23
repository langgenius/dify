"""Keep migration command ownership and the public Flask CLI layout stable."""

import pytest

import commands
from dify_app import DifyApp
from extensions import ext_commands


@pytest.fixture
def migration_app() -> DifyApp:
    app = DifyApp(__name__)
    ext_commands.init_app(app)
    return app


def test_migration_commands_are_registered_from_consolidated_module(migration_app: DifyApp) -> None:
    expected_commands = {
        "data-migrate": commands.data_migrate,
        "app-migration-template": commands.export_migration_data_template,
        "export-app-migration": commands.export_migration_data,
        "import-app-migration": commands.import_migration_data,
        "app-migration-wizard": commands.migration_data_wizard,
    }

    for name, command in expected_commands.items():
        assert migration_app.cli.commands[name] is command
        assert command.callback is not None
        assert command.callback.__module__ == "commands.data_migration"

    assert commands.legacy_model_types.callback is not None
    assert commands.legacy_model_types.callback.__module__ == "commands.data_migration"
    assert "legacy-model-types" not in migration_app.cli.commands


def test_data_migrate_keeps_existing_subcommands_and_top_level_rbac_command(migration_app: DifyApp) -> None:
    assert commands.data_migrate.commands == {
        "legacy-model-types": commands.legacy_model_types,
        "rbac-migrate-dataset-permissions": commands.migrate_dataset_permissions_to_rbac,
        "rbac-migrate-resource-whitelist-scopes": (
            commands.migrate_only_me_resource_whitelist_scopes_to_automatic_include
        ),
    }
    assert (
        migration_app.cli.commands["rbac-migrate-dataset-permissions"] is commands.migrate_dataset_permissions_to_rbac
    )


@pytest.mark.parametrize(
    ("command_path", "expected_help"),
    [
        (
            ("data-migrate",),
            ("legacy-model-types", "rbac-migrate-dataset-permissions", "rbac-migrate-resource-whitelist-scopes"),
        ),
        (
            ("data-migrate", "legacy-model-types"),
            ("--apply", "--tables", "--model-types", "--tenant-id-file", "--output", "--concurrency"),
        ),
        (
            ("data-migrate", "rbac-migrate-dataset-permissions"),
            ("--tenant-id", "--batch-size", "--dry-run"),
        ),
        (
            ("data-migrate", "rbac-migrate-resource-whitelist-scopes"),
            ("--tenant-id", "--resource-type", "--batch-size", "--dry-run"),
        ),
        (("app-migration-template",), ("--output", "--overwrite")),
        (("export-app-migration",), ("--input", "--output", "--overwrite")),
        (
            ("import-app-migration",),
            (
                "--input",
                "--target-tenant",
                "--operator-email",
                "--id-strategy",
                "--conflict-strategy",
                "--create-app-api-token-on-import",
                "--no-create-app-api-token-on-import",
            ),
        ),
        (("app-migration-wizard",), ("Interactively export workflow migration data.",)),
    ],
)
def test_migration_command_help_remains_available(
    migration_app: DifyApp,
    command_path: tuple[str, ...],
    expected_help: tuple[str, ...],
) -> None:
    result = migration_app.test_cli_runner().invoke(args=[*command_path, "--help"])

    assert result.exit_code == 0, result.output
    for text in expected_help:
        assert text in result.output
