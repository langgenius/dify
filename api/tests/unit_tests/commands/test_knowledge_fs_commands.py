from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import click
import pytest
from click.testing import CliRunner

from commands import knowledge_fs as commands
from commands.knowledge_fs import _cutover_service, _read_jsonl, knowledge_fs_control_space
from services.knowledge_fs.cleanup import CleanupCompletionReport, CleanupStartReport
from services.knowledge_fs.cutover import (
    CutoverBackfillReport,
    QuarantineResolutionReport,
    ShadowCompletionReport,
    WorkspaceInventoryInput,
)


def test_control_space_command_exposes_all_p1a_management_operations() -> None:
    assert {
        "backfill",
        "dry-run",
        "orphan-report",
        "register",
        "repair",
        "workspace-delete-finalize",
        "workspace-delete-request",
    } <= set(knowledge_fs_control_space.commands)


def test_workspace_delete_request_is_dry_run_unless_apply_is_explicit() -> None:
    with (
        patch("commands.knowledge_fs._management_service") as management_factory,
        patch("commands.knowledge_fs._lifecycle_service") as lifecycle_factory,
    ):
        management_factory.return_value.dry_run.return_value = SimpleNamespace(
            total=2,
            by_state={"active": 2},
        )
        dry_run = CliRunner().invoke(
            knowledge_fs_control_space,
            ["workspace-delete-request", "--tenant-id", "tenant-1"],
        )
        lifecycle_factory.return_value.request_workspace_cleanup.return_value = (
            SimpleNamespace(
                control_space=SimpleNamespace(id="control-1"),
                outbox=SimpleNamespace(operation_id="operation-1"),
            ),
        )
        applied = CliRunner().invoke(
            knowledge_fs_control_space,
            ["workspace-delete-request", "--tenant-id", "tenant-1", "--apply"],
        )

    assert dry_run.exit_code == 0
    assert '"apply": false' in dry_run.output
    lifecycle_factory.return_value.request_workspace_cleanup.assert_called_once_with(tenant_id="tenant-1")
    assert applied.exit_code == 0
    assert '"operation-1"' in applied.output


def test_workspace_delete_finalize_requires_terminal_preflight_and_explicit_purge_ack() -> None:
    with patch("commands.knowledge_fs._lifecycle_service") as lifecycle_factory:
        lifecycle_factory.return_value.assert_workspace_deletion_allowed = MagicMock()
        lifecycle_factory.return_value.finalize_workspace_deletion.return_value = 2
        preflight = CliRunner().invoke(
            knowledge_fs_control_space,
            ["workspace-delete-finalize", "--tenant-id", "tenant-1"],
        )
        denied = CliRunner().invoke(
            knowledge_fs_control_space,
            ["workspace-delete-finalize", "--tenant-id", "tenant-1", "--apply"],
        )
        applied = CliRunner().invoke(
            knowledge_fs_control_space,
            [
                "workspace-delete-finalize",
                "--tenant-id",
                "tenant-1",
                "--apply",
                "--acknowledge-control-plane-purge",
            ],
        )

    assert preflight.exit_code == 0
    lifecycle_factory.return_value.assert_workspace_deletion_allowed.assert_called_once_with(tenant_id="tenant-1")
    assert denied.exit_code == 2
    assert "--acknowledge-control-plane-purge" in denied.output
    lifecycle_factory.return_value.finalize_workspace_deletion.assert_called_once_with(tenant_id="tenant-1")
    assert applied.exit_code == 0
    assert '"purged_control_spaces": 2' in applied.output


def test_control_space_command_exposes_p8_migration_and_cutover_operations() -> None:
    assert {
        "inventory",
        "backfill",
        "shadow-start",
        "shadow-report",
        "shadow-complete",
        "legacy-dashboard",
        "legacy-check",
        "freeze",
        "final-delta",
        "cutover",
        "smoke",
        "observe",
        "quarantine-resolve",
        "rollback",
        "status",
        "cleanup-request",
        "cleanup-approve",
        "cleanup-start",
        "cleanup-complete",
        "cleanup-status",
    } <= set(knowledge_fs_control_space.commands)


def test_operator_cutover_service_installs_remote_registry_lazily() -> None:
    with patch("commands.knowledge_fs.get_knowledge_fs_lifecycle_remote") as remote_factory:
        service = _cutover_service()

        remote_factory.assert_not_called()
        assert service._remote_factory is remote_factory


def test_shadow_complete_cli_reads_strict_jsonl_and_defaults_to_dry_run(tmp_path: Path) -> None:
    input_path = tmp_path / "shadow-completion.jsonl"
    input_path.write_text(
        json.dumps(
            {
                "schema_version": "knowledge-fs-p8-shadow-completion/v1",
                "tenant_id": "00000000-0000-0000-0000-000000000001",
                "expected_cas_version": 3,
                "producer": "dify-shadow-authorizer",
                "completed_by_operator": "knowledge-fs-cutover",
                "completed_by_account_id": "00000000-0000-0000-0000-000000000002",
                "completed_at": "2026-07-21T16:00:00Z",
                "traffic_zero": False,
                "window_started_at": "2026-07-21T12:00:00Z",
                "window_ended_at": "2026-07-21T15:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    with patch("commands.knowledge_fs._cutover_service") as service_factory:
        service_factory.return_value.complete_shadow.return_value = ShadowCompletionReport(
            "00000000-0000-0000-0000-000000000001",
            7,
            False,
            f"sha256:{'a' * 64}",
            {
                "membership_epoch": 1,
                "space_acl_epoch": 1,
                "external_access_epoch": 1,
                "content_policy_revision": 1,
            },
            False,
            False,
        )
        result = CliRunner().invoke(
            knowledge_fs_control_space,
            ["shadow-complete", "--input", str(input_path)],
        )

    assert result.exit_code == 0
    assert service_factory.return_value.complete_shadow.call_args.kwargs == {"apply": False}
    assert '"applied": false' in result.output

    invalid = json.loads(input_path.read_text(encoding="utf-8"))
    invalid["unknown"] = True
    input_path.write_text(json.dumps(invalid), encoding="utf-8")
    rejected = CliRunner().invoke(
        knowledge_fs_control_space,
        ["shadow-complete", "--input", str(input_path)],
    )
    assert rejected.exit_code == 1
    assert "invalid strict JSONL" in rejected.output


def test_quarantine_resolve_cli_reads_strict_jsonl_and_is_dry_run_without_apply(tmp_path: Path) -> None:
    input_path = tmp_path / "quarantine-resolution.jsonl"
    input_path.write_text(
        json.dumps(
            {
                "schema_version": "knowledge-fs-p8-quarantine-resolution/v1",
                "tenant_id": "00000000-0000-0000-0000-000000000001",
                "source_kind": "legacy_api_key",
                "source_id": "legacy-key-1",
                "expected_row_version": 0,
                "resolved_by_operator": "migration-oncall",
                "resolved_by_account_id": "00000000-0000-0000-0000-000000000002",
                "evidence": {
                    "schema_version": "knowledge-fs-p8-credential-rotation/v1",
                    "legacy_key_id": "legacy-key-1",
                    "knowledge_space_id": "00000000-0000-0000-0000-000000000003",
                    "control_space_id": "00000000-0000-0000-0000-000000000004",
                    "dify_credential_id": "00000000-0000-0000-0000-000000000005",
                    "dify_credential_revision": 1,
                    "legacy_revoked_at": "2026-07-21T11:00:00Z",
                    "verification_reference": "change://key-rotation/1",
                    "plaintext_migrated": False,
                },
                "resolved_at": "2026-07-21T12:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    with patch("commands.knowledge_fs._cutover_service") as service_factory:
        service_factory.return_value.resolve_quarantine.return_value = QuarantineResolutionReport(
            "00000000-0000-0000-0000-000000000001",
            "legacy_api_key",
            "legacy-key-1",
            "rotate_credential",
            0,
            False,
            False,
        )
        result = CliRunner().invoke(
            knowledge_fs_control_space,
            ["quarantine-resolve", "--input", str(input_path)],
        )

    assert result.exit_code == 0
    assert service_factory.return_value.resolve_quarantine.call_args.kwargs == {"apply": False}
    assert '"applied": false' in result.output

    invalid_path = tmp_path / "invalid-quarantine-resolution.jsonl"
    invalid_payload = json.loads(input_path.read_text(encoding="utf-8"))
    invalid_payload["unknown"] = True
    invalid_path.write_text(json.dumps(invalid_payload), encoding="utf-8")
    invalid = CliRunner().invoke(
        knowledge_fs_control_space,
        ["quarantine-resolve", "--input", str(invalid_path)],
    )
    assert invalid.exit_code == 1
    assert "invalid strict JSONL" in invalid.output


def test_strict_jsonl_rejects_unknown_credential_fields(tmp_path: Path) -> None:
    input_path = tmp_path / "inventory.jsonl"
    input_path.write_text(
        json.dumps(
            {
                "tenant_id": "00000000-0000-0000-0000-000000000001",
                "source_revision_watermark": {
                    "membership_epoch": 1,
                    "space_acl_epoch": 1,
                    "external_access_epoch": 1,
                    "content_policy_revision": 1,
                },
                "task_watermark": 1,
                "spaces": [
                    {
                        "knowledge_space_id": "00000000-0000-0000-0000-000000000002",
                        "knowledge_space_revision": 1,
                        "provisioning_key": "p-1",
                        "owner_subject_id": "owner-1",
                        "owner_account_id": "00000000-0000-0000-0000-000000000003",
                        "visibility": "only_me",
                        "legacy_api_keys": [
                            {
                                "key_id": "key-1",
                                "prefix": "kfs_",
                                "last4": "1234",
                                "secret": "must-not-be-accepted",
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(click.ClickException, match="invalid strict JSONL at line 1"):
        _read_jsonl(input_path, WorkspaceInventoryInput)


def test_backfill_cli_is_dry_run_without_explicit_apply(tmp_path: Path) -> None:
    input_path = tmp_path / "inventory.jsonl"
    input_path.write_text(
        json.dumps(
            {
                "tenant_id": "00000000-0000-0000-0000-000000000001",
                "source_revision_watermark": {
                    "membership_epoch": 1,
                    "space_acl_epoch": 1,
                    "external_access_epoch": 1,
                    "content_policy_revision": 1,
                },
                "task_watermark": 1,
                "spaces": [],
            }
        ),
        encoding="utf-8",
    )
    with patch("commands.knowledge_fs._cutover_service") as service_factory:
        service_factory.return_value.backfill.return_value = CutoverBackfillReport(
            "00000000-0000-0000-0000-000000000001",
            0,
            0,
            0,
            0,
            "inventory",
            False,
        )
        result = CliRunner().invoke(knowledge_fs_control_space, ["backfill", "--input", str(input_path)])

    assert result.exit_code == 0
    assert service_factory.return_value.backfill.call_args.kwargs == {"apply": False}


def test_cleanup_start_cli_defaults_to_no_mutation_and_requires_irreversible_ack_for_apply(
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "cleanup-start.jsonl"
    input_path.write_text(
        json.dumps(
            {
                "schema_version": "knowledge-fs-p9-cleanup-start/v1",
                "tenant_id": "00000000-0000-0000-0000-000000000001",
                "request_id": "00000000-0000-0000-0000-000000000002",
                "expected_cas_version": 7,
                "plan_digest": f"sha256:{'a' * 64}",
                "started_by_account_id": "00000000-0000-0000-0000-000000000003",
                "started_at": "2026-07-21T12:00:00Z",
                "confirmation": "START-KNOWLEDGE-FS-IRREVERSIBLE-CLEANUP",
            }
        ),
        encoding="utf-8",
    )
    with patch("commands.knowledge_fs._cleanup_service") as service_factory:
        service_factory.return_value.start_cleanup.return_value = CleanupStartReport(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
            True,
            (),
            "approved",
            False,
            False,
            None,
            False,
        )
        dry_run = CliRunner().invoke(
            knowledge_fs_control_space,
            ["cleanup-start", "--input", str(input_path)],
        )
        denied_apply = CliRunner().invoke(
            knowledge_fs_control_space,
            ["cleanup-start", "--input", str(input_path), "--apply"],
        )

    assert dry_run.exit_code == 0
    assert service_factory.return_value.start_cleanup.call_args.kwargs == {"apply": False}
    assert denied_apply.exit_code == 2
    assert "--acknowledge-irreversible" in denied_apply.output


def test_cleanup_complete_cli_requires_explicit_executed_ack_for_apply(tmp_path: Path) -> None:
    input_path = tmp_path / "cleanup-completion.jsonl"
    input_path.write_text(
        json.dumps(
            {
                "schema_version": "knowledge-fs-p9-cleanup-completion/v1",
                "tenant_id": "00000000-0000-0000-0000-000000000001",
                "request_id": "00000000-0000-0000-0000-000000000002",
                "expected_cas_version": 8,
                "plan_digest": f"sha256:{'a' * 64}",
                "migration_bundle_digest": f"sha256:{'a' * 64}",
                "database_engine": "postgresql",
                "migration_revision": "knowledge-fs-p9-removal/v1",
                "archived_row_counts": {
                    "knowledge_space_members": 0,
                    "knowledge_space_access_policies": 0,
                    "knowledge_space_access_policy_members": 0,
                    "knowledge_space_api_access": 0,
                    "knowledge_space_api_keys": 0,
                    "knowledge_space_permission_snapshots": 0,
                },
                "checks": {
                    "legacy_foreign_keys_remaining": 0,
                    "legacy_tables_remaining": 0,
                    "legacy_routes_registered": 0,
                    "legacy_v1_auth_acceptances": 0,
                    "raw_proxy_routes_registered": 0,
                    "post_cleanup_smoke_passed": True,
                    "recovery_material_verified": True,
                },
                "archive_reference": "archive://kfs/p9",
                "catalog_verification_reference": "catalog://kfs/p9",
                "route_metric_reference": "metrics://kfs/p9",
                "post_cleanup_smoke_reference": "smoke://kfs/p9",
                "recovery_material_reference": "recovery://kfs/p9",
                "completed_by_account_id": "00000000-0000-0000-0000-000000000003",
                "completed_at": "2026-07-21T12:00:00Z",
            }
        ),
        encoding="utf-8",
    )
    with patch("commands.knowledge_fs._cleanup_service") as service_factory:
        service_factory.return_value.complete_cleanup.return_value = CleanupCompletionReport(
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
            True,
            (),
            "started",
            False,
            False,
            False,
        )
        dry_run = CliRunner().invoke(
            knowledge_fs_control_space,
            ["cleanup-complete", "--input", str(input_path)],
        )
        denied_apply = CliRunner().invoke(
            knowledge_fs_control_space,
            ["cleanup-complete", "--input", str(input_path), "--apply"],
        )

    assert dry_run.exit_code == 0
    assert service_factory.return_value.complete_cleanup.call_args.kwargs == {"apply": False}
    assert denied_apply.exit_code == 2
    assert "--acknowledge-executed" in denied_apply.output


def _report(**values: object) -> SimpleNamespace:
    return SimpleNamespace(_asdict=lambda: values)


def test_operator_commands_delegate_cutover_mutations_with_validated_timestamps(
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "operator-input.jsonl"
    input_path.write_text("{}\n", encoding="utf-8")
    payload = SimpleNamespace(tenant_id="tenant-1")
    service = MagicMock()
    service.status.return_value = {
        "legacy_dependency_ready": True,
        "open_issues": 0,
        "unresolved_cutover_quarantine": 0,
    }
    for method_name in (
        "inventory",
        "record_shadow_report",
        "legacy_dependency_dashboard",
    ):
        getattr(service, method_name).return_value = _report(operation=method_name)
    runner = CliRunner()

    with (
        patch("commands.knowledge_fs._cutover_service", return_value=service),
        patch("commands.knowledge_fs._read_jsonl", return_value=(payload,)),
        patch("commands.knowledge_fs._read_one_jsonl", return_value=payload),
    ):
        invocations = [
            ["inventory", "--input", str(input_path)],
            [
                "shadow-start",
                "--tenant-id",
                "tenant-1",
                "--expected-cas-version",
                "2",
                "--at",
                "2026-07-21T12:00:00+00:00",
            ],
            ["shadow-report", "--input", str(input_path), "--apply"],
            [
                "issue-approve",
                "--tenant-id",
                "tenant-1",
                "--issue-key",
                "issue-1",
                "--account-id",
                "account-1",
                "--at",
                "2026-07-21T12:00:00+00:00",
            ],
            [
                "issue-resolve",
                "--tenant-id",
                "tenant-1",
                "--issue-key",
                "issue-1",
                "--account-id",
                "account-1",
                "--at",
                "2026-07-21T13:00:00+00:00",
            ],
            [
                "shadow-approve",
                "--tenant-id",
                "tenant-1",
                "--diff-key",
                "diff-1",
                "--account-id",
                "account-1",
                "--at",
                "2026-07-21T12:00:00+00:00",
            ],
            [
                "shadow-resolve",
                "--tenant-id",
                "tenant-1",
                "--diff-key",
                "diff-1",
                "--account-id",
                "account-1",
                "--at",
                "2026-07-21T13:00:00+00:00",
            ],
            [
                "legacy-dashboard",
                "--tenant-id",
                "tenant-1",
                "--input",
                str(input_path),
                "--checked-at",
                "2026-07-21T14:00:00+00:00",
            ],
            [
                "freeze",
                "--tenant-id",
                "tenant-1",
                "--expected-cas-version",
                "3",
                "--at",
                "2026-07-21T15:00:00+00:00",
            ],
            ["final-delta", "--input", str(input_path)],
            [
                "cutover",
                "--tenant-id",
                "tenant-1",
                "--expected-cas-version",
                "4",
                "--at",
                "2026-07-21T16:00:00+00:00",
                "--rollback-cutoff-at",
                "2026-07-21T18:00:00+00:00",
            ],
            [
                "smoke",
                "--tenant-id",
                "tenant-1",
                "--expected-cas-version",
                "5",
                "--input",
                str(input_path),
            ],
            [
                "rollback",
                "--tenant-id",
                "tenant-1",
                "--expected-cas-version",
                "6",
                "--at",
                "2026-07-21T17:00:00+00:00",
            ],
            ["status", "--tenant-id", "tenant-1"],
        ]
        results = [runner.invoke(knowledge_fs_control_space, arguments) for arguments in invocations]

    assert all(result.exit_code == 0 for result in results), [(result.output, result.exception) for result in results]
    service.inventory.assert_called_once_with(payload, apply=False)
    assert service.begin_shadow.call_args.kwargs["started_at"].utcoffset().total_seconds() == 0
    service.record_shadow_report.assert_called_once_with((payload,), apply=True)
    service.approve_issue_fail_closed.assert_called_once()
    service.resolve_issue.assert_called_once()
    service.approve_shadow_diff.assert_called_once()
    service.resolve_shadow_diff.assert_called_once()
    service.legacy_dependency_dashboard.assert_called_once()
    service.freeze.assert_called_once()
    service.apply_final_delta.assert_called_once_with(payload)
    service.cutover.assert_called_once()
    service.record_smoke_results.assert_called_once_with(
        tenant_id="tenant-1",
        expected_cas_version=5,
        results=payload,
    )
    service.rollback.assert_called_once()


def test_observation_command_enforces_mutually_exclusive_start_and_completion_modes() -> None:
    service = MagicMock()
    service.status.return_value = {"phase": "observing"}
    runner = CliRunner()
    base = ["observe", "--tenant-id", "tenant-1", "--expected-cas-version", "7"]

    with patch("commands.knowledge_fs._cutover_service", return_value=service):
        started = runner.invoke(
            knowledge_fs_control_space,
            [
                *base,
                "--started-at",
                "2026-07-21T12:00:00+00:00",
                "--window-ends-at",
                "2026-07-21T14:00:00+00:00",
                "--maximum-task-expires-at",
                "2026-07-21T13:00:00+00:00",
            ],
        )
        completed = runner.invoke(
            knowledge_fs_control_space,
            [*base, "--observed-at", "2026-07-21T14:00:00+00:00"],
        )
        conflicting = runner.invoke(
            knowledge_fs_control_space,
            [
                *base,
                "--observed-at",
                "2026-07-21T14:00:00+00:00",
                "--started-at",
                "2026-07-21T12:00:00+00:00",
            ],
        )
        incomplete = runner.invoke(
            knowledge_fs_control_space,
            [*base, "--started-at", "2026-07-21T12:00:00+00:00"],
        )

    assert started.exit_code == 0
    assert completed.exit_code == 0
    assert conflicting.exit_code == 2
    assert "cannot be combined" in conflicting.output
    assert incomplete.exit_code == 2
    assert "observation start requires" in incomplete.output
    service.begin_observation.assert_called_once()
    service.complete_observation.assert_called_once()


def test_legacy_check_returns_a_process_failure_when_any_cutover_gate_is_open() -> None:
    service = MagicMock()
    runner = CliRunner()
    passing = {
        "legacy_dependency_ready": True,
        "open_issues": 0,
        "unresolved_cutover_quarantine": 0,
    }
    failing_reports = (
        {**passing, "legacy_dependency_ready": False},
        {**passing, "open_issues": 1},
        {**passing, "unresolved_cutover_quarantine": 1},
    )

    with patch("commands.knowledge_fs._cutover_service", return_value=service):
        service.status.return_value = passing
        passed = runner.invoke(knowledge_fs_control_space, ["legacy-check", "--tenant-id", "tenant-1"])
        failed = []
        for report in failing_reports:
            service.status.return_value = report
            failed.append(runner.invoke(knowledge_fs_control_space, ["legacy-check", "--tenant-id", "tenant-1"]))

    assert passed.exit_code == 0
    assert '"passed": true' in passed.output
    assert all(result.exit_code == 1 for result in failed)
    assert all('"passed": false' in result.output for result in failed)


def test_management_cleanup_and_reconciliation_commands_preserve_apply_safety(
    tmp_path: Path,
) -> None:
    input_path = tmp_path / "operator-input.jsonl"
    input_path.write_text("{}\n", encoding="utf-8")
    payload = SimpleNamespace(tenant_id="tenant-1")
    management = MagicMock()
    management.dry_run.return_value = _report(total=1, by_state={"active": 1})
    management.register.return_value = (SimpleNamespace(id="control-1"), True)
    management.repair_registration.return_value = SimpleNamespace(
        id="control-1",
        state=SimpleNamespace(value="active"),
    )
    cleanup = MagicMock()
    cleanup.request_cleanup.return_value = _report(applied=False)
    cleanup.approve_cleanup.return_value = _report(applied=True)
    cleanup.status.return_value = {"state": "approved"}
    reconciler = MagicMock()
    reconciler.reconcile.return_value = _report(scanned=3, repaired=0)
    runner = CliRunner()

    with (
        patch("commands.knowledge_fs._management_service", return_value=management),
        patch("commands.knowledge_fs._cleanup_service", return_value=cleanup),
        patch("commands.knowledge_fs._read_one_jsonl", return_value=payload),
        patch("commands.knowledge_fs.KnowledgeFSOrphanReconciler", return_value=reconciler),
        patch("commands.knowledge_fs.session_factory.get_session_maker", return_value=object()),
        patch("commands.knowledge_fs.get_knowledge_fs_lifecycle_remote", return_value=object()),
    ):
        invocations = [
            ["dry-run", "--tenant-id", "tenant-1"],
            [
                "register",
                "--tenant-id",
                "tenant-1",
                "--owner-account-id",
                "account-1",
                "--provisioning-key",
                "provision-1",
                "--knowledge-space-id",
                "knowledge-space-1",
                "--knowledge-space-revision",
                "2",
            ],
            [
                "repair",
                "--tenant-id",
                "tenant-1",
                "--control-space-id",
                "control-1",
                "--expected-resource-version",
                "3",
                "--knowledge-space-id",
                "knowledge-space-1",
                "--knowledge-space-revision",
                "4",
            ],
            ["orphan-report", "--limit", "25"],
            ["cleanup-request", "--input", str(input_path)],
            ["cleanup-approve", "--input", str(input_path), "--apply"],
            ["cleanup-status", "--tenant-id", "tenant-1", "--request-id", "request-1"],
        ]
        results = [runner.invoke(knowledge_fs_control_space, arguments) for arguments in invocations]

    assert all(result.exit_code == 0 for result in results), [(result.output, result.exception) for result in results]
    registration = management.register.call_args.args[0]
    assert registration.tenant_id == "tenant-1"
    assert registration.knowledge_space_revision == 2
    management.repair_registration.assert_called_once_with(
        tenant_id="tenant-1",
        control_space_id="control-1",
        expected_resource_version=3,
        knowledge_space_id="knowledge-space-1",
        knowledge_space_revision=4,
    )
    reconciler.reconcile.assert_called_once_with(limit=25, apply_repairs=False)
    cleanup.request_cleanup.assert_called_once_with(payload, apply=False)
    cleanup.approve_cleanup.assert_called_once_with(payload, apply=True)
    cleanup.status.assert_called_once_with(tenant_id="tenant-1", request_id="request-1")


def test_jsonl_and_timestamp_helpers_reject_ambiguous_operator_input(tmp_path: Path) -> None:
    from pydantic import BaseModel, ConfigDict

    class StrictRecord(BaseModel):
        value: int

        model_config = ConfigDict(extra="forbid")

    input_path = tmp_path / "records.jsonl"
    input_path.write_text('\n{"value": 1}\n\n{"value": 2}\n', encoding="utf-8")

    records = commands._read_jsonl(input_path, StrictRecord)

    assert [record.value for record in records] == [1, 2]
    with pytest.raises(click.ClickException, match="exactly one"):
        commands._read_one_jsonl(input_path, StrictRecord)

    input_path.write_text("\n", encoding="utf-8")
    assert commands._read_jsonl(input_path, StrictRecord, allow_empty=True) == ()
    with pytest.raises(click.ClickException, match="at least one"):
        commands._read_jsonl(input_path, StrictRecord)

    with pytest.raises(click.ClickException, match="invalid ISO-8601"):
        commands._parse_timestamp("not-a-timestamp")
    with pytest.raises(click.ClickException, match="explicit timezone"):
        commands._parse_timestamp("2026-07-21T12:00:00")


def test_operator_error_adapters_preserve_domain_messages() -> None:
    from services.knowledge_fs.cleanup import KnowledgeFSCleanupError
    from services.knowledge_fs.control_space_lifecycle import KnowledgeFSControlSpaceLifecycleError
    from services.knowledge_fs.cutover import KnowledgeFSCutoverError

    adapters = (
        (commands._operator_call, KnowledgeFSCutoverError("cutover blocked"), "cutover blocked"),
        (commands._cleanup_call, KnowledgeFSCleanupError("approval missing"), "approval missing"),
        (commands._lifecycle_call, KnowledgeFSControlSpaceLifecycleError("space busy"), "space busy"),
    )

    for adapter, error, message in adapters:
        with pytest.raises(click.ClickException, match=message):
            adapter(lambda error=error: (_ for _ in ()).throw(error))

    assert commands._operator_call(lambda: "ok") == "ok"
    assert commands._cleanup_call(lambda: "ok") == "ok"
    assert commands._lifecycle_call(lambda: "ok") == "ok"


def test_operator_service_factories_share_the_configured_session_maker() -> None:
    session_maker = object()
    management = object()
    cutover = object()
    cleanup = object()
    lifecycle = object()

    with (
        patch("commands.knowledge_fs.session_factory.get_session_maker", return_value=session_maker),
        patch(
            "commands.knowledge_fs.KnowledgeFSControlSpaceManagementService", return_value=management
        ) as management_factory,
        patch("commands.knowledge_fs.KnowledgeFSWorkspaceCutoverService", return_value=cutover) as cutover_factory,
        patch("commands.knowledge_fs.KnowledgeFSCleanupService", return_value=cleanup) as cleanup_factory,
        patch(
            "commands.knowledge_fs.KnowledgeFSControlSpaceCommandService", return_value=lifecycle
        ) as lifecycle_factory,
        patch("commands.knowledge_fs.get_knowledge_fs_lifecycle_remote") as remote_factory,
    ):
        assert commands._management_service() is management
        assert commands._cutover_service() is cutover
        assert commands._cleanup_service() is cleanup
        assert commands._lifecycle_service() is lifecycle

    management_factory.assert_called_once_with(session_maker)
    cutover_factory.assert_called_once_with(session_maker, remote_factory=remote_factory)
    cleanup_factory.assert_called_once_with(session_maker)
    lifecycle_factory.assert_called_once_with(session_maker)
