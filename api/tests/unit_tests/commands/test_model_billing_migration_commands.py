import json

from flask import Flask
from flask.testing import FlaskCliRunner
from pytest_mock import MockerFixture

import model_billing_migration_commands as commands

TENANT = "11111111-1111-4111-8111-111111111111"


def runner(mocker: MockerFixture, *, admitted: bool = True) -> FlaskCliRunner:
    mocker.patch.object(commands.ModelBillingMigrationService, "admitted", return_value=admitted)
    mocker.patch.object(commands, "migration_inventory", return_value={"inventory_hash": "sha256:" + "a" * 64})
    app = Flask(__name__)
    app.cli.add_command(commands.tokener_migration)
    return app.test_cli_runner()


def args(*extra: str) -> list[str]:
    return [
        "tokener-migration",
        "prepare",
        "--tenant-id",
        TENANT,
        "--batch-id",
        "test-batch",
        "--mapping-version",
        "v1",
        *extra,
    ]


def test_prepare_is_read_only_by_default_and_identity_does_not_drift(mocker: MockerFixture) -> None:
    cli = runner(mocker)
    post = mocker.patch.object(commands, "_post")
    first = cli.invoke(args=args())
    second = cli.invoke(args=args())
    assert first.exit_code == second.exit_code == 0
    assert json.loads(first.output) == json.loads(second.output)
    assert json.loads(first.output)["dry_run"]
    post.assert_not_called()


def test_apply_only_prepares_not_trial_or_activation(mocker: MockerFixture) -> None:
    cli = runner(mocker)
    post = mocker.patch.object(commands, "_post")
    result = cli.invoke(args=args("--apply"))
    assert result.exit_code == 0
    assert post.call_args.args[:2] == (TENANT, "prepare-migration")
    assert post.call_args.args[2]["expected_revision"] == 0
    assert "amount" not in result.output


def test_prepare_rejects_unlisted_tenant_before_external_work(mocker: MockerFixture) -> None:
    cli = runner(mocker, admitted=False)
    post = mocker.patch.object(commands, "_post")
    assert cli.invoke(args=args("--apply")).exit_code == 1
    post.assert_not_called()
