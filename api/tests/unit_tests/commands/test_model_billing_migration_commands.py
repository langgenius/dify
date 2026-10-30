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


def test_free_prepare_uses_separate_policy_and_read_only_stable_intent(mocker: MockerFixture) -> None:
    cli = runner(mocker)
    post = mocker.patch.object(commands, "_post")
    free_args = args()
    free_args[1] = "prepare-free"
    first = cli.invoke(args=free_args)
    second = cli.invoke(args=free_args)
    assert first.exit_code == second.exit_code == 0
    assert json.loads(first.output) == json.loads(second.output)
    request = json.loads(first.output)["request"]
    assert request["eligibility_policy_version"] == "free-legacy-v1"
    assert not {"manifest", "free_grant_manifest", "amount", "invoice_id"} & request.keys()
    post.assert_not_called()
    applied = cli.invoke(args=[*free_args, "--apply"])
    assert applied.exit_code == 0
    post.assert_called_once_with(TENANT, "prepare-migration", request)


def test_free_claim_passes_only_identity_to_billing_and_requires_explicit_apply(mocker: MockerFixture) -> None:
    cli = runner(mocker)
    migration = "22222222-2222-4222-8222-222222222222"
    mocker.patch.object(
        commands.ModelBillingMigrationService, "status", return_value={"migration_id": migration, "phase": "prepared"}
    )
    post = mocker.patch.object(commands, "_post")
    argv = ["tokener-migration", "claim-free", "--tenant-id", TENANT]
    dry = cli.invoke(args=argv)
    assert dry.exit_code == 0
    assert json.loads(dry.output)["dry_run"] is True
    post.assert_not_called()
    applied = cli.invoke(args=[*argv, "--apply"])
    assert applied.exit_code == 0
    post.assert_called_once_with(
        TENANT, "claim-free-migration", {"api_version": 1, "tenant_id": TENANT, "migration_id": migration}
    )


def test_free_claim_rejects_unlisted_tenant_before_billing(mocker: MockerFixture) -> None:
    cli = runner(mocker, admitted=False)
    post = mocker.patch.object(commands, "_post")
    assert cli.invoke(args=["tokener-migration", "claim-free", "--tenant-id", TENANT, "--apply"]).exit_code == 1
    post.assert_not_called()


def test_free_resume_cannot_use_paid_window_manual_replan(mocker: MockerFixture) -> None:
    cli = runner(mocker)
    mocker.patch.object(
        commands.ModelBillingMigrationService,
        "status",
        return_value={
            "migration_id": "22222222-2222-4222-8222-222222222222",
            "free_grant_manifest": {"schema_version": 2},
        },
    )
    post = mocker.patch.object(commands, "_post")
    result = cli.invoke(
        args=[
            "tokener-migration",
            "resume",
            "--tenant-id",
            TENANT,
            "--manual",
            "--replan-unsent-operation-id",
            "33333333-3333-4333-8333-333333333333",
        ]
    )
    assert result.exit_code == 2
    post.assert_not_called()
