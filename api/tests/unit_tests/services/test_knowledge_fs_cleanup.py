from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import cast
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from pydantic import ValidationError
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import ensure_naive_utc
from models.base import TypeBase
from models.knowledge_fs_cleanup import (
    KnowledgeFSCleanupAuthorization,
    KnowledgeFSCleanupAuthorizationStatus,
    KnowledgeFSCleanupTarget,
)
from models.knowledge_fs_cutover import (
    KnowledgeFSMigrationIssue,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)
from services.knowledge_fs.cleanup import (
    CleanupApprovalInput,
    CleanupCompletionEvidenceInput,
    CleanupReadinessEvidenceInput,
    CleanupStartInput,
    KnowledgeFSCleanupConflictError,
    KnowledgeFSCleanupGateBlockedError,
    KnowledgeFSCleanupService,
    cleanup_workspace_cohort_digest,
)
from services.knowledge_fs.cutover import KnowledgeFSCutoverGateBlockedError, KnowledgeFSWorkspaceCutoverService

_REQUESTER_ID = "00000000-0000-0000-0000-000000000001"
_APPROVER_ID = "00000000-0000-0000-0000-000000000002"
_STARTER_ID = "00000000-0000-0000-0000-000000000003"
_TENANT_ID = "00000000-0000-0000-0000-000000000004"
_REQUEST_ID = "00000000-0000-0000-0000-000000000005"
_CONTROL_SPACE_ID = "00000000-0000-0000-0000-000000000006"
_SECOND_TENANT_ID = "00000000-0000-0000-0000-000000000007"
_PLAN_DIGEST = f"sha256:{'a' * 64}"
_NOW = datetime(2026, 7, 10, 12, 0, tzinfo=UTC)
_WATERMARK = {
    "membership_epoch": 2,
    "space_acl_epoch": 2,
    "external_access_epoch": 2,
    "content_policy_revision": 2,
}


def _sha256(payload: object) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


_SOURCE_DIGEST = _sha256(_WATERMARK)
_FREEZE_REVISION = 7
_ACTIVATION_DIGEST = _sha256(
    {
        "final_revision_watermark": _WATERMARK,
        "final_task_watermark": 12,
    }
)
_ACTIVATION_REVISION = 8
_SMOKE = {
    "schema_version": "knowledge-fs-p8-cutover-smoke/v1",
    "tenant_id": _TENANT_ID,
    "environment": "production",
    "operator": "knowledge-fs-cutover",
    "operator_account_id": _REQUESTER_ID,
    "observed_at": "2026-07-01T10:05:00+00:00",
    "checks": {
        "authorization": True,
        "list_spaces": True,
        "create_space": True,
        "query": True,
        "upload": True,
        "stream": True,
        "deletion": True,
    },
    "evidence_references": {
        "authorization": "evidence://smoke/authorization",
        "list_spaces": "evidence://smoke/list-spaces",
        "create_space": "evidence://smoke/create-space",
        "query": "evidence://smoke/query",
        "upload": "evidence://smoke/upload",
        "stream": "evidence://smoke/stream",
        "deletion": "evidence://smoke/deletion",
    },
}
_MODELS = (
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSMigrationIssue,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSCleanupAuthorization,
)


def _ready_ledger(tenant_id: str, *, cas_version: int = 9) -> KnowledgeFSWorkspaceCutoverLedger:
    freeze_id = _sha256(
        {
            "freezeRevision": _FREEZE_REVISION,
            "namespaceId": tenant_id,
            "sourceRevisionDigest": _SOURCE_DIGEST,
            "sourceTaskWatermark": 10,
        }
    )
    activation_id = _sha256(
        {
            "activationRevision": _ACTIVATION_REVISION,
            "namespaceId": tenant_id,
            "sourceRevisionDigest": _ACTIVATION_DIGEST,
        }
    )
    return KnowledgeFSWorkspaceCutoverLedger(
        tenant_id=tenant_id,
        source_revision_watermark=_WATERMARK,
        applied_revision_watermark=_WATERMARK,
        phase=KnowledgeFSWorkspaceCutoverPhase.READY_FOR_CLEANUP,
        final_revision_watermark=_WATERMARK,
        source_task_watermark=10,
        final_task_watermark=12,
        applied_task_watermark=12,
        remote_freeze_id=freeze_id,
        remote_freeze_revision=_FREEZE_REVISION,
        remote_freeze_digest=_SOURCE_DIGEST,
        remote_freeze_task_watermark=10,
        remote_freeze_control_space_id=_CONTROL_SPACE_ID,
        remote_freeze_frozen_at=datetime(2026, 7, 1, 9, 0),
        remote_freeze_updated_at=datetime(2026, 7, 1, 9, 0),
        remote_freeze_acknowledged_at=datetime(2026, 7, 1, 9, 1),
        remote_freeze_applied=True,
        remote_freeze_replayed=False,
        remote_activation_id=activation_id,
        remote_activation_revision=_ACTIVATION_REVISION,
        remote_activation_digest=_ACTIVATION_DIGEST,
        remote_activation_control_space_id=_CONTROL_SPACE_ID,
        remote_activation_activated_at=datetime(2026, 7, 1, 10, 0),
        remote_activation_updated_at=datetime(2026, 7, 1, 10, 0),
        remote_activation_acknowledged_at=datetime(2026, 7, 1, 10, 1),
        remote_activation_applied=True,
        remote_activation_replayed=False,
        freeze_at=datetime(2026, 7, 1, 9, 0),
        cutover_at=datetime(2026, 7, 1, 10, 0),
        rollback_cutoff_at=datetime(2026, 7, 3, 10, 0),
        observation_started_at=datetime(2026, 7, 1, 11, 0),
        observation_window_ends_at=datetime(2026, 7, 4, 11, 0),
        maximum_task_expires_at=datetime(2026, 7, 5, 11, 0),
        observation_completed_at=datetime(2026, 7, 5, 11, 0),
        product_routes_enabled=True,
        capability_v2_enabled=True,
        integrated_mode_enabled=True,
        legacy_acl_read_only=True,
        smoke_results={**_SMOKE, "tenant_id": tenant_id},
        legacy_dependency_report=[],
        legacy_dependency_checked_at=datetime(2026, 7, 5, 11, 0),
        legacy_dependency_ready=True,
        cas_version=cas_version,
    )


class _Clock:
    def __init__(self, value: datetime):
        self.value = value

    def __call__(self) -> datetime:
        return self.value


@pytest.fixture
def cleanup_context(
    sqlite_engine: Engine,
) -> tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock]:
    tables = [model.metadata.tables[model.__tablename__] for model in _MODELS]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    clock = _Clock(_NOW)
    with session_maker.begin() as session:
        session.add(_ready_ledger(_TENANT_ID))
    return KnowledgeFSCleanupService(session_maker, clock=clock), session_maker, clock


def _readiness_payload(**updates: object) -> CleanupReadinessEvidenceInput:
    values: dict[str, object] = {
        "schema_version": "knowledge-fs-p9-cleanup/v1",
        "tenant_id": _TENANT_ID,
        "request_id": _REQUEST_ID,
        "expected_cas_version": 9,
        "plan_digest": _PLAN_DIGEST,
        "targets": [target.value for target in KnowledgeFSCleanupTarget],
        "expected_workspace_count": 1,
        "workspace_tenant_ids": [_TENANT_ID],
        "workspace_cohort_digest": cleanup_workspace_cohort_digest([_TENANT_ID]),
        "workspace_inventory_reference": "inventory://production/kfs/workspaces/2026-07-09",
        "evidence_environment": "production",
        "observed_at": datetime(2026, 7, 9, 12, 0, tzinfo=UTC),
        "requested_at": datetime(2026, 7, 9, 13, 0, tzinfo=UTC),
        "legacy_route_zero_window_started_at": datetime(2026, 7, 3, 10, 0, tzinfo=UTC),
        "legacy_route_zero_window_ends_at": datetime(2026, 7, 9, 12, 0, tzinfo=UTC),
        "rollback_window_seconds": 3 * 24 * 60 * 60,
        "legacy_route_calls": 0,
        "legacy_access_route_calls": 0,
        "legacy_member_route_calls": 0,
        "legacy_api_key_route_calls": 0,
        "legacy_route_metric_reference": "metrics://production/kfs-legacy-routes/window-17",
        "maximum_token_expires_at": datetime(2026, 7, 6, 12, 0, tzinfo=UTC),
        "backup_reference": "backup://production/kfs/2026-07-08",
        "backup_verified_at": datetime(2026, 7, 8, 10, 0, tzinfo=UTC),
        "restore_drill_reference": "restore-drill://production/kfs/2026-07-08",
        "restore_drill_verified_at": datetime(2026, 7, 8, 11, 0, tzinfo=UTC),
        "change_window_approval_reference": "change://CAB-2026-0710",
        "requested_by_account_id": _REQUESTER_ID,
    }
    values.update(updates)
    return CleanupReadinessEvidenceInput.model_validate(values)


def _approval_payload(**updates: object) -> CleanupApprovalInput:
    values: dict[str, object] = {
        "schema_version": "knowledge-fs-p9-cleanup-approval/v1",
        "tenant_id": _TENANT_ID,
        "request_id": _REQUEST_ID,
        "expected_cas_version": 10,
        "plan_digest": _PLAN_DIGEST,
        "approved_by_account_id": _APPROVER_ID,
        "approved_at": _NOW - timedelta(hours=1),
        "approval_expires_at": _NOW + timedelta(hours=1),
    }
    values.update(updates)
    return CleanupApprovalInput.model_validate(values)


def _start_payload(**updates: object) -> CleanupStartInput:
    values: dict[str, object] = {
        "schema_version": "knowledge-fs-p9-cleanup-start/v1",
        "tenant_id": _TENANT_ID,
        "request_id": _REQUEST_ID,
        "expected_cas_version": 11,
        "plan_digest": _PLAN_DIGEST,
        "started_by_account_id": _STARTER_ID,
        "started_at": _NOW,
        "confirmation": "START-KNOWLEDGE-FS-IRREVERSIBLE-CLEANUP",
    }
    values.update(updates)
    return CleanupStartInput.model_validate(values)


def _completion_payload(**updates: object) -> CleanupCompletionEvidenceInput:
    values: dict[str, object] = {
        "schema_version": "knowledge-fs-p9-cleanup-completion/v1",
        "tenant_id": _TENANT_ID,
        "request_id": _REQUEST_ID,
        "expected_cas_version": 12,
        "plan_digest": _PLAN_DIGEST,
        "migration_bundle_digest": _PLAN_DIGEST,
        "database_engine": "postgresql",
        "migration_revision": "knowledge-fs-p9-removal/v1",
        "archived_row_counts": {
            "knowledge_space_members": 10,
            "knowledge_space_access_policies": 2,
            "knowledge_space_access_policy_members": 4,
            "knowledge_space_api_access": 2,
            "knowledge_space_api_keys": 3,
            "knowledge_space_permission_snapshots": 12,
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
        "archive_reference": "archive://production/kfs/p9-2026-07-10",
        "catalog_verification_reference": "catalog://production/kfs/p9-2026-07-10",
        "route_metric_reference": "metrics://production/kfs/post-p9",
        "post_cleanup_smoke_reference": "smoke://production/kfs/post-p9",
        "recovery_material_reference": "recovery://production/kfs/p9-2026-07-10",
        "completed_by_account_id": _STARTER_ID,
        "completed_at": _NOW,
    }
    values.update(updates)
    return CleanupCompletionEvidenceInput.model_validate(values)


def _request_and_approve(service: KnowledgeFSCleanupService) -> None:
    service.request_cleanup(_readiness_payload(), apply=True)
    service.approve_cleanup(_approval_payload(), apply=True)


def test_cleanup_workflow_is_dry_run_by_default_and_never_executes_destructive_sql(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, session_maker, _ = cleanup_context
    readiness = _readiness_payload()

    dry_run = service.request_cleanup(readiness, apply=False)

    assert dry_run.ready is True
    assert dry_run.status == "dry_run"
    with session_maker() as session:
        assert session.scalar(select(sa.func.count()).select_from(KnowledgeFSCleanupAuthorization)) == 0
        ledger = session.scalar(select(KnowledgeFSWorkspaceCutoverLedger))
    assert ledger is not None
    assert ledger.cas_version == 9

    requested = service.request_cleanup(readiness, apply=True)
    assert requested.status == "requested"
    approval_dry_run = service.approve_cleanup(_approval_payload(), apply=False)
    assert approval_dry_run.approvable is True
    with session_maker() as session:
        authorization = session.scalar(select(KnowledgeFSCleanupAuthorization))
    assert authorization is not None
    assert authorization.status is KnowledgeFSCleanupAuthorizationStatus.REQUESTED

    approved = service.approve_cleanup(_approval_payload(), apply=True)
    assert approved.status == "approved"
    start_dry_run = service.start_cleanup(_start_payload(), apply=False)
    assert start_dry_run.startable is True
    assert start_dry_run.irreversible_cleanup_at is None

    statements: list[str] = []

    def capture_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement.strip().lower())

    engine = cast(Engine, session_maker.kw["bind"])
    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        started = service.start_cleanup(_start_payload(), apply=True)
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)

    assert started.status == "started"
    assert started.destructive_actions_executed is False
    assert not any(statement.startswith(("drop ", "delete ", "truncate ")) for statement in statements)
    status = service.status(tenant_id=_TENANT_ID, request_id=_REQUEST_ID)
    assert status["status"] == "started"
    assert status["destructive_actions_executed"] is False
    assert status["irreversible_cleanup_at"] is not None


def test_cleanup_readiness_requires_persisted_production_windows_and_zero_legacy_calls(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, session_maker, _ = cleanup_context
    with session_maker.begin() as session:
        session.execute(
            sa.update(KnowledgeFSWorkspaceCutoverLedger).values(
                phase=KnowledgeFSWorkspaceCutoverPhase.OBSERVING,
                observation_completed_at=None,
            )
        )
    nonzero_calls = _readiness_payload(legacy_route_calls=4, legacy_access_route_calls=4)
    report = service.request_cleanup(nonzero_calls, apply=False)

    assert report.ready is False
    assert "workspace is not ready_for_cleanup" in report.reasons
    assert "production observation is not persisted as complete" in report.reasons
    assert "legacy route calls are nonzero" in report.reasons
    with pytest.raises(KnowledgeFSCleanupGateBlockedError):
        service.request_cleanup(nonzero_calls, apply=True)


def test_cleanup_schema_rejects_nonproduction_or_incomplete_target_evidence() -> None:
    with pytest.raises(ValidationError, match="production"):
        _readiness_payload(evidence_environment="local")
    with pytest.raises(ValidationError, match="every destructive target"):
        _readiness_payload(targets=[KnowledgeFSCleanupTarget.LEGACY_ACL_SCHEMA.value] * 6)
    with pytest.raises(ValidationError, match="explicit timezone"):
        _readiness_payload(observed_at=datetime(2026, 7, 9, 12, 0))


def test_cleanup_approval_requires_four_eyes_current_cas_and_bounded_expiry(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, _, _ = cleanup_context
    service.request_cleanup(_readiness_payload(), apply=True)

    same_actor = service.approve_cleanup(
        _approval_payload(approved_by_account_id=_REQUESTER_ID),
        apply=False,
    )
    assert same_actor.approvable is False
    assert "cleanup requires a distinct approver" in same_actor.reasons
    with pytest.raises(KnowledgeFSCleanupGateBlockedError, match="distinct approver"):
        service.approve_cleanup(
            _approval_payload(approved_by_account_id=_REQUESTER_ID),
            apply=True,
        )
    with pytest.raises(KnowledgeFSCleanupGateBlockedError, match="24 hours"):
        service.approve_cleanup(
            _approval_payload(approval_expires_at=_NOW + timedelta(days=2)),
            apply=True,
        )


def test_irreversible_start_closes_rollback_even_with_backdated_operator_timestamp(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, session_maker, clock = cleanup_context
    _request_and_approve(service)
    service.start_cleanup(_start_payload(), apply=True)
    cutover_service = KnowledgeFSWorkspaceCutoverService(session_maker, clock=clock)

    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="cutoff"):
        cutover_service.rollback(
            tenant_id=_TENANT_ID,
            expected_cas_version=12,
            rolled_back_at=datetime(2026, 7, 2, 12, 0, tzinfo=UTC),
        )


def test_cleanup_start_rejects_expired_approval_and_plan_digest_drift(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, _, clock = cleanup_context
    _request_and_approve(service)
    clock.value = _NOW + timedelta(hours=2)

    expired = service.start_cleanup(
        _start_payload(started_at=_NOW + timedelta(hours=2)),
        apply=False,
    )
    assert expired.startable is False
    assert "cleanup approval has expired" in expired.reasons
    with pytest.raises(KnowledgeFSCleanupGateBlockedError, match="expired"):
        service.start_cleanup(
            _start_payload(started_at=_NOW + timedelta(hours=2)),
            apply=True,
        )
    with pytest.raises(KnowledgeFSCleanupGateBlockedError, match="plan digest"):
        service.start_cleanup(
            _start_payload(
                plan_digest=f"sha256:{'b' * 64}",
                started_at=_NOW + timedelta(hours=2),
            ),
            apply=True,
        )


def test_cleanup_start_rolls_back_irreversible_fence_when_audit_cas_loses_race(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, session_maker, _ = cleanup_context
    _request_and_approve(service)

    with (
        patch(
            "services.knowledge_fs.cleanup.SQLAlchemyKnowledgeFSCleanupAuthorizationRepository.compare_and_set",
            return_value=False,
        ),
        pytest.raises(KnowledgeFSCleanupConflictError, match="changed during start"),
    ):
        service.start_cleanup(_start_payload(), apply=True)

    with session_maker() as session:
        ledger = session.scalar(select(KnowledgeFSWorkspaceCutoverLedger))
        authorization = session.scalar(select(KnowledgeFSCleanupAuthorization))
    assert ledger is not None
    assert ledger.irreversible_cleanup_at is None
    assert ledger.cas_version == 11
    assert authorization is not None
    assert authorization.status is KnowledgeFSCleanupAuthorizationStatus.APPROVED


def test_cleanup_requires_the_exact_global_workspace_cohort_and_fences_every_ledger(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, session_maker, _ = cleanup_context
    with session_maker.begin() as session:
        session.add(_ready_ledger(_SECOND_TENANT_ID))

    incomplete = service.request_cleanup(_readiness_payload(), apply=False)
    assert incomplete.ready is False
    assert "persisted Workspace count does not match the cleanup cohort" in incomplete.reasons
    assert "persisted Workspace cohort does not exactly match the cleanup inventory" in incomplete.reasons

    tenant_ids = [_TENANT_ID, _SECOND_TENANT_ID]
    readiness = _readiness_payload(
        expected_workspace_count=2,
        workspace_tenant_ids=tenant_ids,
        workspace_cohort_digest=cleanup_workspace_cohort_digest(tenant_ids),
    )
    service.request_cleanup(readiness, apply=True)
    service.approve_cleanup(_approval_payload(), apply=True)
    service.start_cleanup(_start_payload(), apply=True)

    with session_maker() as session:
        ledgers = tuple(
            session.scalars(
                select(KnowledgeFSWorkspaceCutoverLedger).order_by(KnowledgeFSWorkspaceCutoverLedger.tenant_id)
            )
        )
    assert len(ledgers) == 2
    assert {candidate.irreversible_cleanup_at for candidate in ledgers} == {ensure_naive_utc(_NOW)}
    assert {candidate.cas_version for candidate in ledgers} == {10, 12}


def test_cleanup_readiness_requires_exact_remote_freeze_and_activation_evidence(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, session_maker, _ = cleanup_context
    with session_maker.begin() as session:
        session.execute(
            sa.update(KnowledgeFSWorkspaceCutoverLedger).values(
                remote_activation_id=None,
                remote_activation_revision=None,
                remote_activation_digest=None,
                remote_activation_control_space_id=None,
                remote_activation_activated_at=None,
                remote_activation_updated_at=None,
                remote_activation_acknowledged_at=None,
                remote_activation_applied=None,
                remote_activation_replayed=None,
            )
        )

    report = service.request_cleanup(_readiness_payload(), apply=False)

    assert report.ready is False
    assert "remote Workspace activation evidence is incomplete or inconsistent" in report.reasons


def test_cleanup_completion_is_strict_replay_safe_and_marks_external_actions_executed(
    cleanup_context: tuple[KnowledgeFSCleanupService, sessionmaker[Session], _Clock],
) -> None:
    service, session_maker, _ = cleanup_context
    _request_and_approve(service)
    service.start_cleanup(_start_payload(), apply=True)

    dry_run = service.complete_cleanup(_completion_payload(), apply=False)
    assert dry_run.completable is True
    assert dry_run.destructive_actions_executed is False

    completed = service.complete_cleanup(_completion_payload(), apply=True)
    assert completed.status == "completed"
    assert completed.destructive_actions_executed is True
    replayed = service.complete_cleanup(_completion_payload(), apply=True)
    assert replayed.replayed is True
    assert replayed.destructive_actions_executed is True

    status = service.status(tenant_id=_TENANT_ID, request_id=_REQUEST_ID)
    assert status["status"] == "completed"
    assert status["destructive_actions_executed"] is True
    assert status["completion_evidence"] == _completion_payload().model_dump(mode="json")
    with session_maker() as session:
        authorization = session.scalar(select(KnowledgeFSCleanupAuthorization))
    assert authorization is not None
    assert authorization.status is KnowledgeFSCleanupAuthorizationStatus.COMPLETED
    assert authorization.completed_ledger_cas_version == 13


def test_cleanup_completion_schema_rejects_unapproved_bundle_or_incomplete_checks() -> None:
    with pytest.raises(ValidationError, match="must match the approved plan"):
        _completion_payload(migration_bundle_digest=f"sha256:{'b' * 64}")
    checks = _completion_payload().checks.model_dump()
    checks["legacy_tables_remaining"] = 1
    with pytest.raises(ValidationError, match="Input should be 0"):
        _completion_payload(checks=checks)
