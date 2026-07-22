"""Operator commands for the independent KnowledgeFS control-plane."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime
from functools import partial
from pathlib import Path

import click
from pydantic import BaseModel, ValidationError

from core.db.session_factory import session_factory
from services.knowledge_fs.cleanup import (
    CleanupApprovalInput,
    CleanupCompletionEvidenceInput,
    CleanupReadinessEvidenceInput,
    CleanupStartInput,
    KnowledgeFSCleanupError,
    KnowledgeFSCleanupService,
)
from services.knowledge_fs.control_space_commands import KnowledgeFSControlSpaceCommandService
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSControlSpaceLifecycleError
from services.knowledge_fs.control_space_management import (
    KnowledgeFSControlSpaceManagementService,
    KnowledgeFSControlSpaceRegistration,
)
from services.knowledge_fs.cutover import (
    CutoverSmokeResultsInput,
    FinalDeltaInput,
    KnowledgeFSCutoverError,
    KnowledgeFSWorkspaceCutoverService,
    LegacyDependencyInput,
    QuarantineResolutionInput,
    ShadowAuthorizationObservationInput,
    ShadowCompletionInput,
    WorkspaceInventoryInput,
)
from services.knowledge_fs.orphan_reconciler import KnowledgeFSOrphanReconciler
from services.knowledge_fs.remote_registry import get_knowledge_fs_lifecycle_remote


@click.group("knowledge-fs-control-space")
def knowledge_fs_control_space() -> None:
    """Inspect and repair Dify-owned KnowledgeFS control-space state."""


@knowledge_fs_control_space.command("dry-run")
@click.option("--tenant-id", default=None)
def dry_run(tenant_id: str | None) -> None:
    report = _management_service().dry_run(tenant_id=tenant_id)
    click.echo(json.dumps(report._asdict(), sort_keys=True))


@knowledge_fs_control_space.command("inventory")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Create ledgers; omitted means read-only inventory.")
def inventory(input_path: Path, apply: bool) -> None:
    """Validate strict Workspace inventory JSONL and optionally create ledgers."""

    service = _cutover_service()
    for payload in _read_jsonl(input_path, WorkspaceInventoryInput):
        report = _operator_call(partial(service.inventory, payload, apply=apply))
        _echo_json(report._asdict())


@knowledge_fs_control_space.command("register")
@click.option("--tenant-id", required=True)
@click.option("--owner-account-id", required=True)
@click.option("--provisioning-key", required=True)
@click.option("--knowledge-space-id", required=True)
@click.option("--knowledge-space-revision", type=click.IntRange(min=0), required=True)
def register(
    tenant_id: str,
    owner_account_id: str,
    provisioning_key: str,
    knowledge_space_id: str,
    knowledge_space_revision: int,
) -> None:
    control_space, replayed = _management_service().register(
        KnowledgeFSControlSpaceRegistration(
            tenant_id,
            owner_account_id,
            provisioning_key,
            knowledge_space_id,
            knowledge_space_revision,
        )
    )
    click.echo(json.dumps({"control_space_id": control_space.id, "replayed": replayed}, sort_keys=True))


@knowledge_fs_control_space.command("backfill")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist registrations; omitted means dry-run.")
def backfill(input_path: Path, apply: bool) -> None:
    """Backfill strict Workspace inventory JSONL; dry-run unless --apply is explicit."""

    service = _cutover_service()
    for payload in _read_jsonl(input_path, WorkspaceInventoryInput):
        report = _operator_call(partial(service.backfill, payload, apply=apply))
        _echo_json(report._asdict())


@knowledge_fs_control_space.command("quarantine-resolve")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist resolutions; omitted means dry-run.")
def quarantine_resolve(input_path: Path, apply: bool) -> None:
    """Resolve strict tenant-scoped quarantine JSONL with immutable operator evidence."""

    service = _cutover_service()
    for payload in _read_jsonl(input_path, QuarantineResolutionInput):
        report = _operator_call(partial(service.resolve_quarantine, payload, apply=apply))
        _echo_json(report._asdict())


@knowledge_fs_control_space.command("shadow-start")
@click.option("--tenant-id", required=True)
@click.option("--expected-cas-version", type=click.IntRange(min=0), required=True)
@click.option("--at", "started_at", default=None, help="Optional explicit timezone-aware shadow start.")
def shadow_start(tenant_id: str, expected_cas_version: int, started_at: str | None) -> None:
    service = _cutover_service()
    _operator_call(
        lambda: service.begin_shadow(
            tenant_id=tenant_id,
            expected_cas_version=expected_cas_version,
            started_at=_parse_timestamp(started_at) if started_at is not None else None,
        )
    )
    _echo_json(service.status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("shadow-report")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist observations; omitted means dry-run.")
def shadow_report(input_path: Path, apply: bool) -> None:
    observations = _read_jsonl(input_path, ShadowAuthorizationObservationInput)
    report = _operator_call(lambda: _cutover_service().record_shadow_report(observations, apply=apply))
    _echo_json(report._asdict())


@knowledge_fs_control_space.command("shadow-complete")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist completion; omitted means dry-run.")
def shadow_complete(input_path: Path, apply: bool) -> None:
    payload = _read_one_jsonl(input_path, ShadowCompletionInput)
    report = _operator_call(lambda: _cutover_service().complete_shadow(payload, apply=apply))
    _echo_json(report._asdict())


@knowledge_fs_control_space.command("issue-approve")
@click.option("--tenant-id", required=True)
@click.option("--issue-key", required=True)
@click.option("--account-id", required=True)
@click.option("--at", "approved_at", required=True)
def issue_approve(tenant_id: str, issue_key: str, account_id: str, approved_at: str) -> None:
    _operator_call(
        lambda: _cutover_service().approve_issue_fail_closed(
            tenant_id=tenant_id,
            issue_key=issue_key,
            account_id=account_id,
            approved_at=_parse_timestamp(approved_at),
        )
    )
    _echo_json(_cutover_service().status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("issue-resolve")
@click.option("--tenant-id", required=True)
@click.option("--issue-key", required=True)
@click.option("--account-id", required=True)
@click.option("--at", "resolved_at", required=True)
def issue_resolve(tenant_id: str, issue_key: str, account_id: str, resolved_at: str) -> None:
    _operator_call(
        lambda: _cutover_service().resolve_issue(
            tenant_id=tenant_id,
            issue_key=issue_key,
            account_id=account_id,
            resolved_at=_parse_timestamp(resolved_at),
        )
    )
    _echo_json(_cutover_service().status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("shadow-approve")
@click.option("--tenant-id", required=True)
@click.option("--diff-key", required=True)
@click.option("--account-id", required=True)
@click.option("--at", "approved_at", required=True)
def shadow_approve(tenant_id: str, diff_key: str, account_id: str, approved_at: str) -> None:
    _operator_call(
        lambda: _cutover_service().approve_shadow_diff(
            tenant_id=tenant_id,
            diff_key=diff_key,
            account_id=account_id,
            approved_at=_parse_timestamp(approved_at),
        )
    )
    _echo_json(_cutover_service().status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("shadow-resolve")
@click.option("--tenant-id", required=True)
@click.option("--diff-key", required=True)
@click.option("--account-id", required=True)
@click.option("--at", "resolved_at", required=True)
def shadow_resolve(tenant_id: str, diff_key: str, account_id: str, resolved_at: str) -> None:
    _operator_call(
        lambda: _cutover_service().resolve_shadow_diff(
            tenant_id=tenant_id,
            diff_key=diff_key,
            account_id=account_id,
            resolved_at=_parse_timestamp(resolved_at),
        )
    )
    _echo_json(_cutover_service().status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("legacy-dashboard")
@click.option("--tenant-id", required=True)
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--checked-at", required=True)
@click.option("--expected-cas-version", type=click.IntRange(min=0), default=None)
@click.option("--apply", is_flag=True, default=False, help="Persist gate evidence; omitted means read-only report.")
def legacy_dashboard(
    tenant_id: str,
    input_path: Path,
    checked_at: str,
    expected_cas_version: int | None,
    apply: bool,
) -> None:
    dependencies = _read_jsonl(input_path, LegacyDependencyInput, allow_empty=True)
    report = _operator_call(
        lambda: _cutover_service().legacy_dependency_dashboard(
            tenant_id=tenant_id,
            dependencies=dependencies,
            expected_cas_version=expected_cas_version,
            checked_at=_parse_timestamp(checked_at),
            apply=apply,
        )
    )
    _echo_json(report._asdict())


@knowledge_fs_control_space.command("legacy-check")
@click.option("--tenant-id", required=True)
def legacy_check(tenant_id: str) -> None:
    status_report = _operator_call(lambda: _cutover_service().status(tenant_id=tenant_id))
    passed = (
        bool(status_report["legacy_dependency_ready"])
        and status_report["open_issues"] == 0
        and status_report["unresolved_cutover_quarantine"] == 0
    )
    _echo_json({"tenant_id": tenant_id, "passed": passed, "status": status_report})
    if not passed:
        raise click.exceptions.Exit(1)


@knowledge_fs_control_space.command("freeze")
@click.option("--tenant-id", required=True)
@click.option("--expected-cas-version", type=click.IntRange(min=0), required=True)
@click.option("--at", "freeze_at", required=True)
def freeze(tenant_id: str, expected_cas_version: int, freeze_at: str) -> None:
    service = _cutover_service()
    _operator_call(
        lambda: service.freeze(
            tenant_id=tenant_id,
            expected_cas_version=expected_cas_version,
            freeze_at=_parse_timestamp(freeze_at),
        )
    )
    _echo_json(service.status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("final-delta")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
def final_delta(input_path: Path) -> None:
    payload = _read_one_jsonl(input_path, FinalDeltaInput)
    service = _cutover_service()
    _operator_call(lambda: service.apply_final_delta(payload))
    _echo_json(service.status(tenant_id=str(payload.tenant_id)))


@knowledge_fs_control_space.command("cutover")
@click.option("--tenant-id", required=True)
@click.option("--expected-cas-version", type=click.IntRange(min=0), required=True)
@click.option("--at", "cutover_at", required=True)
@click.option("--rollback-cutoff-at", required=True)
def cutover(tenant_id: str, expected_cas_version: int, cutover_at: str, rollback_cutoff_at: str) -> None:
    service = _cutover_service()
    _operator_call(
        lambda: service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=expected_cas_version,
            cutover_at=_parse_timestamp(cutover_at),
            rollback_cutoff_at=_parse_timestamp(rollback_cutoff_at),
        )
    )
    _echo_json(service.status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("smoke")
@click.option("--tenant-id", required=True)
@click.option("--expected-cas-version", type=click.IntRange(min=0), required=True)
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
def smoke(tenant_id: str, expected_cas_version: int, input_path: Path) -> None:
    results = _read_one_jsonl(input_path, CutoverSmokeResultsInput)
    service = _cutover_service()
    _operator_call(
        lambda: service.record_smoke_results(
            tenant_id=tenant_id,
            expected_cas_version=expected_cas_version,
            results=results,
        )
    )
    _echo_json(service.status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("observe")
@click.option("--tenant-id", required=True)
@click.option("--expected-cas-version", type=click.IntRange(min=0), required=True)
@click.option("--started-at", default=None)
@click.option("--window-ends-at", default=None)
@click.option("--maximum-task-expires-at", default=None)
@click.option("--observed-at", default=None)
def observe(
    tenant_id: str,
    expected_cas_version: int,
    started_at: str | None,
    window_ends_at: str | None,
    maximum_task_expires_at: str | None,
    observed_at: str | None,
) -> None:
    service = _cutover_service()
    if observed_at is not None:
        if any(value is not None for value in (started_at, window_ends_at, maximum_task_expires_at)):
            raise click.UsageError("--observed-at cannot be combined with observation start options")
        _operator_call(
            lambda: service.complete_observation(
                tenant_id=tenant_id,
                expected_cas_version=expected_cas_version,
                observed_at=_parse_timestamp(observed_at),
            )
        )
    else:
        if started_at is None or window_ends_at is None or maximum_task_expires_at is None:
            raise click.UsageError(
                "observation start requires --started-at, --window-ends-at, and --maximum-task-expires-at"
            )
        _operator_call(
            lambda: service.begin_observation(
                tenant_id=tenant_id,
                expected_cas_version=expected_cas_version,
                started_at=_parse_timestamp(started_at),
                window_ends_at=_parse_timestamp(window_ends_at),
                maximum_task_expires_at=_parse_timestamp(maximum_task_expires_at),
            )
        )
    _echo_json(service.status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("rollback")
@click.option("--tenant-id", required=True)
@click.option("--expected-cas-version", type=click.IntRange(min=0), required=True)
@click.option("--at", "rolled_back_at", required=True)
def rollback(tenant_id: str, expected_cas_version: int, rolled_back_at: str) -> None:
    service = _cutover_service()
    _operator_call(
        lambda: service.rollback(
            tenant_id=tenant_id,
            expected_cas_version=expected_cas_version,
            rolled_back_at=_parse_timestamp(rolled_back_at),
        )
    )
    _echo_json(service.status(tenant_id=tenant_id))


@knowledge_fs_control_space.command("status")
@click.option("--tenant-id", required=True)
def status(tenant_id: str) -> None:
    _echo_json(_operator_call(lambda: _cutover_service().status(tenant_id=tenant_id)))


@knowledge_fs_control_space.command("cleanup-request")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist readiness evidence; omitted means dry-run.")
def cleanup_request(input_path: Path, apply: bool) -> None:
    payload = _read_one_jsonl(input_path, CleanupReadinessEvidenceInput)
    report = _cleanup_call(lambda: _cleanup_service().request_cleanup(payload, apply=apply))
    _echo_json(report._asdict())


@knowledge_fs_control_space.command("cleanup-approve")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist four-eyes approval; omitted means dry-run.")
def cleanup_approve(input_path: Path, apply: bool) -> None:
    payload = _read_one_jsonl(input_path, CleanupApprovalInput)
    report = _cleanup_call(lambda: _cleanup_service().approve_cleanup(payload, apply=apply))
    _echo_json(report._asdict())


@knowledge_fs_control_space.command("cleanup-start")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist the irreversible fence; never runs deletion.")
@click.option(
    "--acknowledge-irreversible",
    is_flag=True,
    default=False,
    help="Required with --apply; confirms rollback will be permanently closed.",
)
def cleanup_start(input_path: Path, apply: bool, acknowledge_irreversible: bool) -> None:
    payload = _read_one_jsonl(input_path, CleanupStartInput)
    if apply and not acknowledge_irreversible:
        raise click.UsageError("--apply requires --acknowledge-irreversible")
    report = _cleanup_call(lambda: _cleanup_service().start_cleanup(payload, apply=apply))
    _echo_json(report._asdict())


@knowledge_fs_control_space.command("cleanup-complete")
@click.option("--input", "input_path", type=click.Path(path_type=Path, exists=True, dir_okay=False), required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist externally verified cleanup completion.")
@click.option(
    "--acknowledge-executed",
    is_flag=True,
    default=False,
    help="Required with --apply; confirms the reviewed destructive bundle already executed.",
)
def cleanup_complete(input_path: Path, apply: bool, acknowledge_executed: bool) -> None:
    payload = _read_one_jsonl(input_path, CleanupCompletionEvidenceInput)
    if apply and not acknowledge_executed:
        raise click.UsageError("--apply requires --acknowledge-executed")
    report = _cleanup_call(lambda: _cleanup_service().complete_cleanup(payload, apply=apply))
    _echo_json(report._asdict())


@knowledge_fs_control_space.command("cleanup-status")
@click.option("--tenant-id", required=True)
@click.option("--request-id", required=True)
def cleanup_status(tenant_id: str, request_id: str) -> None:
    _echo_json(_cleanup_call(lambda: _cleanup_service().status(tenant_id=tenant_id, request_id=request_id)))


@knowledge_fs_control_space.command("repair")
@click.option("--tenant-id", required=True)
@click.option("--control-space-id", required=True)
@click.option("--expected-resource-version", type=click.IntRange(min=0), required=True)
@click.option("--knowledge-space-id", required=True)
@click.option("--knowledge-space-revision", type=click.IntRange(min=0), required=True)
def repair(
    tenant_id: str,
    control_space_id: str,
    expected_resource_version: int,
    knowledge_space_id: str,
    knowledge_space_revision: int,
) -> None:
    control_space = _management_service().repair_registration(
        tenant_id=tenant_id,
        control_space_id=control_space_id,
        expected_resource_version=expected_resource_version,
        knowledge_space_id=knowledge_space_id,
        knowledge_space_revision=knowledge_space_revision,
    )
    click.echo(json.dumps({"control_space_id": control_space.id, "state": control_space.state.value}, sort_keys=True))


@knowledge_fs_control_space.command("orphan-report")
@click.option("--limit", type=click.IntRange(min=1, max=10_000), default=500, show_default=True)
def orphan_report(limit: int) -> None:
    report = KnowledgeFSOrphanReconciler(
        session_factory.get_session_maker(),
        get_knowledge_fs_lifecycle_remote(),
    ).reconcile(limit=limit, apply_repairs=False)
    click.echo(json.dumps(report._asdict(), sort_keys=True))


@knowledge_fs_control_space.command("workspace-delete-request")
@click.option("--tenant-id", required=True)
@click.option("--apply", is_flag=True, default=False, help="Persist durable deletion intents; omitted means dry-run.")
def workspace_delete_request(tenant_id: str, apply: bool) -> None:
    """Route every KnowledgeFS Space through the canonical lifecycle deletion path."""

    if not apply:
        report = _management_service().dry_run(tenant_id=tenant_id)
        _echo_json(
            {
                "apply": False,
                "by_state": report.by_state,
                "tenant_id": tenant_id,
                "total": report.total,
            }
        )
        return
    results = _lifecycle_call(lambda: _lifecycle_service().request_workspace_cleanup(tenant_id=tenant_id))
    _echo_json(
        {
            "apply": True,
            "control_space_ids": [result.control_space.id for result in results],
            "operation_ids": [result.outbox.operation_id for result in results if result.outbox is not None],
            "tenant_id": tenant_id,
        }
    )


@knowledge_fs_control_space.command("workspace-delete-finalize")
@click.option("--tenant-id", required=True)
@click.option("--apply", is_flag=True, default=False, help="Purge terminal local control-plane rows.")
@click.option(
    "--acknowledge-control-plane-purge",
    is_flag=True,
    default=False,
    help="Required with --apply after every remote Space has reached deleted.",
)
def workspace_delete_finalize(tenant_id: str, apply: bool, acknowledge_control_plane_purge: bool) -> None:
    """Release the Workspace FK only after all remote deletions are terminal."""

    service = _lifecycle_service()
    if not apply:
        _lifecycle_call(lambda: service.assert_workspace_deletion_allowed(tenant_id=tenant_id))
        _echo_json({"apply": False, "ready": True, "tenant_id": tenant_id})
        return
    if not acknowledge_control_plane_purge:
        raise click.UsageError("--apply requires --acknowledge-control-plane-purge")
    deleted = _lifecycle_call(lambda: service.finalize_workspace_deletion(tenant_id=tenant_id))
    _echo_json({"apply": True, "purged_control_spaces": deleted, "tenant_id": tenant_id})


def _read_jsonl[InputT: BaseModel](
    input_path: Path, input_type: type[InputT], *, allow_empty: bool = False
) -> tuple[InputT, ...]:
    records: list[InputT] = []
    for line_number, line in enumerate(input_path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            records.append(input_type.model_validate_json(line))
        except ValidationError as exc:
            raise click.ClickException(f"invalid strict JSONL at line {line_number}: {exc}") from exc
    if not records and not allow_empty:
        raise click.ClickException("strict JSONL input must contain at least one record")
    return tuple(records)


def _read_one_jsonl[InputT: BaseModel](input_path: Path, input_type: type[InputT]) -> InputT:
    records = _read_jsonl(input_path, input_type)
    if len(records) != 1:
        raise click.ClickException("this command requires exactly one JSONL record")
    return records[0]


def _parse_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise click.ClickException(f"invalid ISO-8601 timestamp: {value}") from exc
    if parsed.tzinfo is None:
        raise click.ClickException("operator timestamps must include an explicit timezone")
    return parsed


def _operator_call[ResultT](operation: Callable[[], ResultT]) -> ResultT:
    try:
        return operation()
    except KnowledgeFSCutoverError as exc:
        raise click.ClickException(str(exc)) from exc


def _cleanup_call[ResultT](operation: Callable[[], ResultT]) -> ResultT:
    try:
        return operation()
    except KnowledgeFSCleanupError as exc:
        raise click.ClickException(str(exc)) from exc


def _lifecycle_call[ResultT](operation: Callable[[], ResultT]) -> ResultT:
    try:
        return operation()
    except KnowledgeFSControlSpaceLifecycleError as exc:
        raise click.ClickException(str(exc)) from exc


def _echo_json(payload: object) -> None:
    click.echo(json.dumps(payload, default=str, sort_keys=True))


def _management_service() -> KnowledgeFSControlSpaceManagementService:
    return KnowledgeFSControlSpaceManagementService(session_factory.get_session_maker())


def _cutover_service() -> KnowledgeFSWorkspaceCutoverService:
    return KnowledgeFSWorkspaceCutoverService(
        session_factory.get_session_maker(),
        remote_factory=get_knowledge_fs_lifecycle_remote,
    )


def _cleanup_service() -> KnowledgeFSCleanupService:
    return KnowledgeFSCleanupService(session_factory.get_session_maker())


def _lifecycle_service() -> KnowledgeFSControlSpaceCommandService:
    return KnowledgeFSControlSpaceCommandService(session_factory.get_session_maker())


__all__ = ["knowledge_fs_control_space"]
