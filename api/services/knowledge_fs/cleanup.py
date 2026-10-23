"""Default-deny P9 cleanup readiness, approval, and irreversible-start fence.

This module never executes schema or data deletion. It validates operator-supplied
production evidence, persists four-eyes approval, and atomically closes rollback
before an external, separately controlled migration may begin.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable
from datetime import datetime, timedelta
from typing import Literal, NamedTuple
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from models.knowledge_fs_cleanup import (
    KnowledgeFSCleanupAuthorization,
    KnowledgeFSCleanupAuthorizationStatus,
    KnowledgeFSCleanupTarget,
)
from models.knowledge_fs_cutover import (
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
    knowledge_fs_cutover_smoke_results_passed,
)
from repositories.knowledge_fs_cleanup_repository import KnowledgeFSCleanupAuthorizationCASUpdate
from repositories.knowledge_fs_cutover_repository import KnowledgeFSCutoverCASUpdate
from repositories.sqlalchemy_knowledge_fs_cleanup_repository import (
    SQLAlchemyKnowledgeFSCleanupAuthorizationRepository,
)
from repositories.sqlalchemy_knowledge_fs_cutover_repository import SQLAlchemyKnowledgeFSCutoverRepository
from services.knowledge_fs.cutover import (
    knowledge_fs_remote_activation_evidence_consistent,
    knowledge_fs_remote_freeze_evidence_consistent,
)

_PLAN_SCHEMA_VERSION = "knowledge-fs-p9-cleanup/v1"
_START_CONFIRMATION = "START-KNOWLEDGE-FS-IRREVERSIBLE-CLEANUP"
_MAX_APPROVAL_LIFETIME = timedelta(hours=24)
_REQUIRED_TARGETS = frozenset(KnowledgeFSCleanupTarget)


def cleanup_workspace_cohort_digest(tenant_ids: Iterable[str | UUID]) -> str:
    """Return the canonical digest for the complete, sorted cleanup cohort."""

    canonical_ids = sorted(str(tenant_id) for tenant_id in tenant_ids)
    canonical = json.dumps(canonical_ids, ensure_ascii=False, separators=(",", ":")).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


class StrictCleanupInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CleanupReadinessEvidenceInput(StrictCleanupInput):
    schema_version: Literal["knowledge-fs-p9-cleanup/v1"]
    tenant_id: UUID
    request_id: UUID
    expected_cas_version: int = Field(ge=0)
    plan_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    targets: list[KnowledgeFSCleanupTarget] = Field(min_length=6, max_length=6)
    expected_workspace_count: int = Field(gt=0, le=100_000)
    workspace_tenant_ids: list[UUID] = Field(min_length=1, max_length=100_000)
    workspace_cohort_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    workspace_inventory_reference: str = Field(min_length=1, max_length=1024)
    evidence_environment: Literal["production"]
    observed_at: datetime
    requested_at: datetime
    legacy_route_zero_window_started_at: datetime
    legacy_route_zero_window_ends_at: datetime
    rollback_window_seconds: int = Field(gt=0)
    legacy_route_calls: int = Field(ge=0)
    legacy_access_route_calls: int = Field(ge=0)
    legacy_member_route_calls: int = Field(ge=0)
    legacy_api_key_route_calls: int = Field(ge=0)
    legacy_route_metric_reference: str = Field(min_length=1, max_length=1024)
    maximum_token_expires_at: datetime
    backup_reference: str = Field(min_length=1, max_length=1024)
    backup_verified_at: datetime
    restore_drill_reference: str = Field(min_length=1, max_length=1024)
    restore_drill_verified_at: datetime
    change_window_approval_reference: str = Field(min_length=1, max_length=1024)
    requested_by_account_id: UUID

    @field_validator(
        "observed_at",
        "requested_at",
        "legacy_route_zero_window_started_at",
        "legacy_route_zero_window_ends_at",
        "maximum_token_expires_at",
        "backup_verified_at",
        "restore_drill_verified_at",
    )
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("cleanup evidence timestamps require an explicit timezone")
        return value

    @model_validator(mode="after")
    def require_complete_unique_plan(self) -> CleanupReadinessEvidenceInput:
        if frozenset(self.targets) != _REQUIRED_TARGETS or len(set(self.targets)) != len(self.targets):
            raise ValueError("cleanup plan must contain every destructive target exactly once")
        tenant_ids = [str(tenant_id) for tenant_id in self.workspace_tenant_ids]
        if tenant_ids != sorted(tenant_ids) or len(tenant_ids) != len(set(tenant_ids)):
            raise ValueError("cleanup Workspace cohort must be unique and sorted")
        if str(self.tenant_id) not in tenant_ids:
            raise ValueError("cleanup authorization tenant must be in the Workspace cohort")
        if self.expected_workspace_count != len(tenant_ids):
            raise ValueError("cleanup Workspace count does not match the cohort")
        if self.workspace_cohort_digest != cleanup_workspace_cohort_digest(tenant_ids):
            raise ValueError("cleanup Workspace cohort digest does not match the canonical tenant list")
        if self.legacy_route_calls != (
            self.legacy_access_route_calls + self.legacy_member_route_calls + self.legacy_api_key_route_calls
        ):
            raise ValueError("legacy route total does not match access/member/API-key counts")
        return self


class CleanupApprovalInput(StrictCleanupInput):
    schema_version: Literal["knowledge-fs-p9-cleanup-approval/v1"]
    tenant_id: UUID
    request_id: UUID
    expected_cas_version: int = Field(ge=0)
    plan_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    approved_by_account_id: UUID
    approved_at: datetime
    approval_expires_at: datetime

    @field_validator("approved_at", "approval_expires_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("cleanup approval timestamps require an explicit timezone")
        return value


class CleanupStartInput(StrictCleanupInput):
    schema_version: Literal["knowledge-fs-p9-cleanup-start/v1"]
    tenant_id: UUID
    request_id: UUID
    expected_cas_version: int = Field(ge=0)
    plan_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    started_by_account_id: UUID
    started_at: datetime
    confirmation: Literal["START-KNOWLEDGE-FS-IRREVERSIBLE-CLEANUP"]

    @field_validator("started_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("cleanup start timestamp requires an explicit timezone")
        return value


class CleanupArchivedRowCounts(StrictCleanupInput):
    knowledge_space_members: int = Field(ge=0)
    knowledge_space_access_policies: int = Field(ge=0)
    knowledge_space_access_policy_members: int = Field(ge=0)
    knowledge_space_api_access: int = Field(ge=0)
    knowledge_space_api_keys: int = Field(ge=0)
    knowledge_space_permission_snapshots: int = Field(ge=0)


class CleanupCompletionChecks(StrictCleanupInput):
    legacy_foreign_keys_remaining: Literal[0]
    legacy_tables_remaining: Literal[0]
    legacy_routes_registered: Literal[0]
    legacy_v1_auth_acceptances: Literal[0]
    raw_proxy_routes_registered: Literal[0]
    post_cleanup_smoke_passed: Literal[True]
    recovery_material_verified: Literal[True]


class CleanupCompletionEvidenceInput(StrictCleanupInput):
    schema_version: Literal["knowledge-fs-p9-cleanup-completion/v1"]
    tenant_id: UUID
    request_id: UUID
    expected_cas_version: int = Field(ge=0)
    plan_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    migration_bundle_digest: str = Field(pattern=r"^sha256:[a-f0-9]{64}$")
    database_engine: Literal["postgresql", "tidb"]
    migration_revision: str = Field(min_length=1, max_length=255)
    archived_row_counts: CleanupArchivedRowCounts
    checks: CleanupCompletionChecks
    archive_reference: str = Field(min_length=1, max_length=1024)
    catalog_verification_reference: str = Field(min_length=1, max_length=1024)
    route_metric_reference: str = Field(min_length=1, max_length=1024)
    post_cleanup_smoke_reference: str = Field(min_length=1, max_length=1024)
    recovery_material_reference: str = Field(min_length=1, max_length=1024)
    completed_by_account_id: UUID
    completed_at: datetime

    @field_validator("completed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("cleanup completion timestamp requires an explicit timezone")
        return value

    @model_validator(mode="after")
    def require_reviewed_bundle(self) -> CleanupCompletionEvidenceInput:
        if self.migration_bundle_digest != self.plan_digest:
            raise ValueError("cleanup completion bundle digest must match the approved plan")
        return self


class CleanupReadinessReport(NamedTuple):
    tenant_id: str
    request_id: str
    ready: bool
    reasons: tuple[str, ...]
    status: str
    applied: bool
    replayed: bool
    operator_attested_evidence: bool


class CleanupApprovalReport(NamedTuple):
    tenant_id: str
    request_id: str
    approvable: bool
    reasons: tuple[str, ...]
    status: str
    applied: bool
    replayed: bool


class CleanupStartReport(NamedTuple):
    tenant_id: str
    request_id: str
    startable: bool
    reasons: tuple[str, ...]
    status: str
    applied: bool
    replayed: bool
    irreversible_cleanup_at: str | None
    destructive_actions_executed: bool


class CleanupCompletionReport(NamedTuple):
    tenant_id: str
    request_id: str
    completable: bool
    reasons: tuple[str, ...]
    status: str
    applied: bool
    replayed: bool
    destructive_actions_executed: bool


class KnowledgeFSCleanupError(RuntimeError):
    pass


class KnowledgeFSCleanupNotFoundError(KnowledgeFSCleanupError):
    pass


class KnowledgeFSCleanupConflictError(KnowledgeFSCleanupError):
    pass


class KnowledgeFSCleanupGateBlockedError(KnowledgeFSCleanupError):
    pass


class KnowledgeFSCleanupService:
    """Persist readiness and approval without executing destructive operations."""

    _session_maker: sessionmaker[Session]
    _clock: Callable[[], datetime]

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        clock: Callable[[], datetime] = naive_utc_now,
    ):
        self._session_maker = session_maker
        self._clock = clock

    def request_cleanup(
        self,
        payload: CleanupReadinessEvidenceInput,
        *,
        apply: bool,
    ) -> CleanupReadinessReport:
        tenant_id = str(payload.tenant_id)
        request_id = str(payload.request_id)
        with self._session_maker.begin() as session:
            cutover_repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            cleanup_repository = SQLAlchemyKnowledgeFSCleanupAuthorizationRepository(session)
            ledger = self._require_ledger(cutover_repository, tenant_id)
            reasons = self._readiness_reasons(cutover_repository, ledger, payload)
            existing = cleanup_repository.get(
                tenant_id=tenant_id,
                ledger_id=ledger.id,
                request_id=request_id,
            )
            if existing is not None:
                self._assert_request_replay(existing, payload)
                replay_payload = payload.model_copy(update={"expected_cas_version": ledger.cas_version})
                reasons = self._readiness_reasons(cutover_repository, ledger, replay_payload)
                return CleanupReadinessReport(
                    tenant_id,
                    request_id,
                    not reasons,
                    reasons,
                    existing.status.value,
                    apply,
                    True,
                    True,
                )
            if not apply:
                return CleanupReadinessReport(
                    tenant_id,
                    request_id,
                    not reasons,
                    reasons,
                    "dry_run",
                    False,
                    False,
                    True,
                )
            if reasons:
                raise KnowledgeFSCleanupGateBlockedError("; ".join(reasons))
            self._cas_ledger(
                cutover_repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=ledger.phase,
                ),
            )
            cleanup_repository.add(
                KnowledgeFSCleanupAuthorization(
                    tenant_id=tenant_id,
                    ledger_id=ledger.id,
                    request_id=request_id,
                    plan_schema_version=_PLAN_SCHEMA_VERSION,
                    plan_digest=payload.plan_digest,
                    targets=[target.value for target in payload.targets],
                    readiness_evidence=payload.model_dump(mode="json"),
                    requested_by_account_id=str(payload.requested_by_account_id),
                    requested_at=ensure_naive_utc(payload.requested_at),
                    readiness_ledger_cas_version=ledger.cas_version + 1,
                )
            )
            return CleanupReadinessReport(
                tenant_id,
                request_id,
                True,
                (),
                KnowledgeFSCleanupAuthorizationStatus.REQUESTED.value,
                True,
                False,
                True,
            )

    def approve_cleanup(self, payload: CleanupApprovalInput, *, apply: bool) -> CleanupApprovalReport:
        tenant_id = str(payload.tenant_id)
        request_id = str(payload.request_id)
        with self._session_maker.begin() as session:
            cutover_repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            cleanup_repository = SQLAlchemyKnowledgeFSCleanupAuthorizationRepository(session)
            ledger = self._require_ledger(cutover_repository, tenant_id)
            authorization = self._require_authorization(cleanup_repository, ledger, request_id)
            if authorization.status is KnowledgeFSCleanupAuthorizationStatus.APPROVED:
                self._assert_approval_replay(authorization, payload)
                return CleanupApprovalReport(tenant_id, request_id, True, (), "approved", apply, True)
            if authorization.status in {
                KnowledgeFSCleanupAuthorizationStatus.STARTED,
                KnowledgeFSCleanupAuthorizationStatus.COMPLETED,
            }:
                raise KnowledgeFSCleanupConflictError("Cleanup authorization has already started")
            reasons = self._approval_reasons(cutover_repository, ledger, authorization, payload)
            if not apply:
                return CleanupApprovalReport(
                    tenant_id,
                    request_id,
                    not reasons,
                    reasons,
                    authorization.status.value,
                    False,
                    False,
                )
            if reasons:
                raise KnowledgeFSCleanupGateBlockedError("; ".join(reasons))
            self._cas_ledger(
                cutover_repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=ledger.phase,
                ),
            )
            changed = cleanup_repository.compare_and_set(
                KnowledgeFSCleanupAuthorizationCASUpdate(
                    tenant_id=tenant_id,
                    ledger_id=ledger.id,
                    request_id=request_id,
                    expected_status=KnowledgeFSCleanupAuthorizationStatus.REQUESTED,
                    expected_row_version=authorization.row_version,
                    new_status=KnowledgeFSCleanupAuthorizationStatus.APPROVED,
                    approved_by_account_id=str(payload.approved_by_account_id),
                    approved_at=ensure_naive_utc(payload.approved_at),
                    approval_expires_at=ensure_naive_utc(payload.approval_expires_at),
                    approved_ledger_cas_version=ledger.cas_version + 1,
                )
            )
            if not changed:
                raise KnowledgeFSCleanupConflictError("Cleanup authorization changed during approval")
            return CleanupApprovalReport(tenant_id, request_id, True, (), "approved", True, False)

    def start_cleanup(self, payload: CleanupStartInput, *, apply: bool) -> CleanupStartReport:
        tenant_id = str(payload.tenant_id)
        request_id = str(payload.request_id)
        with self._session_maker.begin() as session:
            cutover_repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            cleanup_repository = SQLAlchemyKnowledgeFSCleanupAuthorizationRepository(session)
            ledger = self._require_ledger(cutover_repository, tenant_id)
            authorization = self._require_authorization(cleanup_repository, ledger, request_id)
            if authorization.status is KnowledgeFSCleanupAuthorizationStatus.STARTED:
                self._assert_start_replay(authorization, payload)
                return CleanupStartReport(
                    tenant_id,
                    request_id,
                    True,
                    (),
                    "started",
                    apply,
                    True,
                    _iso(ledger.irreversible_cleanup_at),
                    False,
                )
            if authorization.status is KnowledgeFSCleanupAuthorizationStatus.COMPLETED:
                raise KnowledgeFSCleanupConflictError("Cleanup authorization has already completed")
            reasons = self._start_reasons(cutover_repository, ledger, authorization, payload)
            if not apply:
                return CleanupStartReport(
                    tenant_id,
                    request_id,
                    not reasons,
                    reasons,
                    authorization.status.value,
                    False,
                    False,
                    _iso(ledger.irreversible_cleanup_at),
                    False,
                )
            if reasons:
                raise KnowledgeFSCleanupGateBlockedError("; ".join(reasons))
            started_at = ensure_naive_utc(payload.started_at)
            self._fence_cleanup_cohort(cutover_repository, started_at=started_at)
            changed = cleanup_repository.compare_and_set(
                KnowledgeFSCleanupAuthorizationCASUpdate(
                    tenant_id=tenant_id,
                    ledger_id=ledger.id,
                    request_id=request_id,
                    expected_status=KnowledgeFSCleanupAuthorizationStatus.APPROVED,
                    expected_row_version=authorization.row_version,
                    new_status=KnowledgeFSCleanupAuthorizationStatus.STARTED,
                    started_by_account_id=str(payload.started_by_account_id),
                    started_at=started_at,
                    started_ledger_cas_version=ledger.cas_version + 1,
                )
            )
            if not changed:
                raise KnowledgeFSCleanupConflictError("Cleanup authorization changed during start")
            return CleanupStartReport(
                tenant_id,
                request_id,
                True,
                (),
                "started",
                True,
                False,
                _iso(started_at),
                False,
            )

    def complete_cleanup(
        self,
        payload: CleanupCompletionEvidenceInput,
        *,
        apply: bool,
    ) -> CleanupCompletionReport:
        tenant_id = str(payload.tenant_id)
        request_id = str(payload.request_id)
        with self._session_maker.begin() as session:
            cutover_repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            cleanup_repository = SQLAlchemyKnowledgeFSCleanupAuthorizationRepository(session)
            ledger = self._require_ledger(cutover_repository, tenant_id)
            authorization = self._require_authorization(cleanup_repository, ledger, request_id)
            if authorization.status is KnowledgeFSCleanupAuthorizationStatus.COMPLETED:
                self._assert_completion_replay(authorization, payload)
                return CleanupCompletionReport(
                    tenant_id,
                    request_id,
                    True,
                    (),
                    "completed",
                    apply,
                    True,
                    True,
                )
            reasons = self._completion_reasons(cutover_repository, ledger, authorization, payload)
            if not apply:
                return CleanupCompletionReport(
                    tenant_id,
                    request_id,
                    not reasons,
                    reasons,
                    authorization.status.value,
                    False,
                    False,
                    False,
                )
            if reasons:
                raise KnowledgeFSCleanupGateBlockedError("; ".join(reasons))
            self._cas_ledger(
                cutover_repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=ledger.phase,
                ),
            )
            completed_at = ensure_naive_utc(payload.completed_at)
            changed = cleanup_repository.compare_and_set(
                KnowledgeFSCleanupAuthorizationCASUpdate(
                    tenant_id=tenant_id,
                    ledger_id=ledger.id,
                    request_id=request_id,
                    expected_status=KnowledgeFSCleanupAuthorizationStatus.STARTED,
                    expected_row_version=authorization.row_version,
                    new_status=KnowledgeFSCleanupAuthorizationStatus.COMPLETED,
                    completed_by_account_id=str(payload.completed_by_account_id),
                    completed_at=completed_at,
                    completion_evidence=payload.model_dump(mode="json"),
                    completed_ledger_cas_version=ledger.cas_version + 1,
                )
            )
            if not changed:
                raise KnowledgeFSCleanupConflictError("Cleanup authorization changed during completion")
            return CleanupCompletionReport(
                tenant_id,
                request_id,
                True,
                (),
                "completed",
                True,
                False,
                True,
            )

    def status(self, *, tenant_id: str, request_id: str) -> dict[str, object]:
        with self._session_maker() as session:
            cutover_repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            cleanup_repository = SQLAlchemyKnowledgeFSCleanupAuthorizationRepository(session)
            ledger = self._require_ledger(cutover_repository, tenant_id)
            authorization = self._require_authorization(cleanup_repository, ledger, request_id)
            return {
                "tenant_id": tenant_id,
                "request_id": request_id,
                "status": authorization.status.value,
                "plan_schema_version": authorization.plan_schema_version,
                "plan_digest": authorization.plan_digest,
                "targets": authorization.targets,
                "readiness_evidence": authorization.readiness_evidence,
                "requested_by_account_id": authorization.requested_by_account_id,
                "requested_at": _iso(authorization.requested_at),
                "readiness_ledger_cas_version": authorization.readiness_ledger_cas_version,
                "approved_by_account_id": authorization.approved_by_account_id,
                "approved_at": _iso(authorization.approved_at),
                "approval_expires_at": _iso(authorization.approval_expires_at),
                "approved_ledger_cas_version": authorization.approved_ledger_cas_version,
                "started_by_account_id": authorization.started_by_account_id,
                "started_at": _iso(authorization.started_at),
                "started_ledger_cas_version": authorization.started_ledger_cas_version,
                "completed_by_account_id": authorization.completed_by_account_id,
                "completed_at": _iso(authorization.completed_at),
                "completion_evidence": authorization.completion_evidence,
                "completed_ledger_cas_version": authorization.completed_ledger_cas_version,
                "row_version": authorization.row_version,
                "irreversible_cleanup_at": _iso(ledger.irreversible_cleanup_at),
                "destructive_actions_executed": (
                    authorization.status is KnowledgeFSCleanupAuthorizationStatus.COMPLETED
                ),
                "operator_attested_evidence": True,
            }

    def _readiness_reasons(
        self,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        payload: CleanupReadinessEvidenceInput,
        *,
        allow_irreversible: bool = False,
    ) -> tuple[str, ...]:
        reasons: list[str] = []
        now = ensure_naive_utc(self._clock())
        observed_at = ensure_naive_utc(payload.observed_at)
        requested_at = ensure_naive_utc(payload.requested_at)
        zero_window_start = ensure_naive_utc(payload.legacy_route_zero_window_started_at)
        zero_window_end = ensure_naive_utc(payload.legacy_route_zero_window_ends_at)
        maximum_token_expires_at = ensure_naive_utc(payload.maximum_token_expires_at)
        backup_verified_at = ensure_naive_utc(payload.backup_verified_at)
        restore_drill_verified_at = ensure_naive_utc(payload.restore_drill_verified_at)
        if observed_at > now or requested_at > now:
            reasons.append("cleanup evidence cannot be future-dated")
        if requested_at < observed_at:
            reasons.append("cleanup request predates its evidence observation")
        if payload.legacy_access_route_calls != 0:
            reasons.append("legacy access route calls are nonzero")
        if payload.legacy_member_route_calls != 0:
            reasons.append("legacy member route calls are nonzero")
        if payload.legacy_api_key_route_calls != 0:
            reasons.append("legacy API-key route calls are nonzero")
        if payload.legacy_route_calls != 0:
            reasons.append("legacy route calls are nonzero")
        if zero_window_end > observed_at or zero_window_end < zero_window_start:
            reasons.append("legacy route zero window is invalid")
        elif zero_window_end - zero_window_start < timedelta(seconds=payload.rollback_window_seconds):
            reasons.append("legacy route zero window is shorter than one rollback window")
        if maximum_token_expires_at > observed_at:
            reasons.append("maximum token TTL has not elapsed")
        if backup_verified_at > observed_at or restore_drill_verified_at > observed_at:
            reasons.append("backup or restore drill verification is future evidence")

        ledgers = repository.list_ledgers()
        expected_tenant_ids = tuple(str(tenant_id) for tenant_id in payload.workspace_tenant_ids)
        actual_tenant_ids = tuple(candidate.tenant_id for candidate in ledgers)
        if len(ledgers) != payload.expected_workspace_count:
            reasons.append("persisted Workspace count does not match the cleanup cohort")
        if actual_tenant_ids != expected_tenant_ids:
            reasons.append("persisted Workspace cohort does not exactly match the cleanup inventory")
        if cleanup_workspace_cohort_digest(actual_tenant_ids) != payload.workspace_cohort_digest:
            reasons.append("persisted Workspace cohort digest changed")

        for candidate in ledgers:
            workspace_reasons = self._workspace_readiness_reasons(
                repository,
                candidate,
                payload,
                allow_irreversible=allow_irreversible,
            )
            if candidate.tenant_id == ledger.tenant_id and candidate.cas_version != payload.expected_cas_version:
                workspace_reasons.insert(0, "cutover ledger CAS version changed")
            for reason in workspace_reasons:
                if candidate.tenant_id == ledger.tenant_id:
                    reasons.append(reason)
                else:
                    reasons.append(f"Workspace {candidate.tenant_id}: {reason}")
        return tuple(dict.fromkeys(reasons))

    def _workspace_readiness_reasons(
        self,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        payload: CleanupReadinessEvidenceInput,
        *,
        allow_irreversible: bool,
    ) -> list[str]:
        reasons: list[str] = []
        now = ensure_naive_utc(self._clock())
        observed_at = ensure_naive_utc(payload.observed_at)
        zero_window_start = ensure_naive_utc(payload.legacy_route_zero_window_started_at)
        backup_verified_at = ensure_naive_utc(payload.backup_verified_at)
        restore_drill_verified_at = ensure_naive_utc(payload.restore_drill_verified_at)
        if ledger.phase is not KnowledgeFSWorkspaceCutoverPhase.READY_FOR_CLEANUP:
            reasons.append("workspace is not ready_for_cleanup")
        if allow_irreversible:
            if ledger.irreversible_cleanup_at is None:
                reasons.append("irreversible cleanup fence is missing")
        elif ledger.irreversible_cleanup_at is not None:
            reasons.append("irreversible cleanup has already started")
        if ledger.observation_completed_at is None:
            reasons.append("production observation is not persisted as complete")
        if ledger.observation_window_ends_at is None or ledger.observation_completed_at is None:
            reasons.append("observation window evidence is incomplete")
        elif ledger.observation_completed_at < ledger.observation_window_ends_at:
            reasons.append("persisted observation window has not elapsed")
        if ledger.maximum_task_expires_at is None or ledger.observation_completed_at is None:
            reasons.append("maximum task TTL evidence is incomplete")
        elif ledger.observation_completed_at < ledger.maximum_task_expires_at:
            reasons.append("persisted maximum task TTL has not elapsed")
        if ledger.observation_completed_at is not None and observed_at < ledger.observation_completed_at:
            reasons.append("cleanup evidence predates completed observation")
        if (
            ledger.rollback_cutoff_at is None
            or observed_at < ledger.rollback_cutoff_at
            or now < ledger.rollback_cutoff_at
        ):
            reasons.append("rollback cutoff has not elapsed")
        if ledger.cutover_at is None or zero_window_start < ledger.cutover_at:
            reasons.append("legacy route zero window predates cutover")
        if ledger.observation_completed_at is not None and (
            backup_verified_at < ledger.observation_completed_at
            or restore_drill_verified_at < ledger.observation_completed_at
        ):
            reasons.append("backup and restore drill must be verified after observation completion")
        if not ledger.legacy_dependency_ready or ledger.legacy_dependency_checked_at is None:
            reasons.append("legacy snapshot/FK dependency dashboard is not ready")
        if repository.count_open_issues(tenant_id=ledger.tenant_id, ledger_id=ledger.id) > 0:
            reasons.append("open migration issues remain")
        if repository.count_unapproved_shadow_diffs(tenant_id=ledger.tenant_id, ledger_id=ledger.id) > 0:
            reasons.append("open shadow authorization differences remain")
        if (
            not knowledge_fs_cutover_smoke_results_passed(ledger.smoke_results)
            or ledger.smoke_results is None
            or ledger.smoke_results.get("tenant_id") != ledger.tenant_id
        ):
            reasons.append("cutover smoke evidence is incomplete")
        if not knowledge_fs_remote_freeze_evidence_consistent(ledger):
            reasons.append("remote Workspace freeze evidence is incomplete or inconsistent")
        if not knowledge_fs_remote_activation_evidence_consistent(ledger):
            reasons.append("remote Workspace activation evidence is incomplete or inconsistent")
        if (
            ledger.final_revision_watermark is None
            or ledger.final_revision_watermark != ledger.applied_revision_watermark
            or ledger.final_task_watermark is None
            or ledger.final_task_watermark != ledger.applied_task_watermark
        ):
            reasons.append("final delta watermarks are not fully applied")
        if not (
            ledger.product_routes_enabled
            and ledger.capability_v2_enabled
            and ledger.integrated_mode_enabled
            and ledger.legacy_acl_read_only
        ):
            reasons.append("atomic cutover feature state is not fully enabled")
        return reasons

    def _approval_reasons(
        self,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        authorization: KnowledgeFSCleanupAuthorization,
        payload: CleanupApprovalInput,
    ) -> tuple[str, ...]:
        reasons: list[str] = []
        approved_at = ensure_naive_utc(payload.approved_at)
        expires_at = ensure_naive_utc(payload.approval_expires_at)
        now = ensure_naive_utc(self._clock())
        if authorization.status is not KnowledgeFSCleanupAuthorizationStatus.REQUESTED:
            reasons.append("cleanup authorization is not requested")
        if ledger.cas_version != payload.expected_cas_version:
            reasons.append("cutover ledger CAS version changed")
        if authorization.plan_digest != payload.plan_digest:
            reasons.append("cleanup plan digest changed")
        if authorization.requested_by_account_id == str(payload.approved_by_account_id):
            reasons.append("cleanup requires a distinct approver")
        if approved_at > now:
            reasons.append("cleanup approval cannot be future-dated")
        if expires_at <= now or expires_at <= approved_at:
            reasons.append("cleanup approval must be currently valid")
        if expires_at - approved_at > _MAX_APPROVAL_LIFETIME:
            reasons.append("cleanup approval lifetime exceeds 24 hours")
        evidence = CleanupReadinessEvidenceInput.model_validate(authorization.readiness_evidence)
        evidence = evidence.model_copy(update={"expected_cas_version": ledger.cas_version})
        reasons.extend(self._readiness_reasons(repository, ledger, evidence))
        return tuple(dict.fromkeys(reasons))

    def _start_reasons(
        self,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        authorization: KnowledgeFSCleanupAuthorization,
        payload: CleanupStartInput,
    ) -> tuple[str, ...]:
        reasons: list[str] = []
        started_at = ensure_naive_utc(payload.started_at)
        now = ensure_naive_utc(self._clock())
        if authorization.status is not KnowledgeFSCleanupAuthorizationStatus.APPROVED:
            reasons.append("cleanup authorization is not approved")
        if ledger.cas_version != payload.expected_cas_version:
            reasons.append("cutover ledger CAS version changed")
        if authorization.plan_digest != payload.plan_digest:
            reasons.append("cleanup plan digest changed")
        if authorization.approved_at is None or started_at < authorization.approved_at:
            reasons.append("cleanup start predates approval")
        if started_at > now:
            reasons.append("cleanup start cannot be future-dated")
        if authorization.approval_expires_at is None or now >= authorization.approval_expires_at:
            reasons.append("cleanup approval has expired")
        evidence = CleanupReadinessEvidenceInput.model_validate(authorization.readiness_evidence)
        evidence = evidence.model_copy(update={"expected_cas_version": ledger.cas_version})
        reasons.extend(self._readiness_reasons(repository, ledger, evidence))
        return tuple(dict.fromkeys(reasons))

    def _completion_reasons(
        self,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        authorization: KnowledgeFSCleanupAuthorization,
        payload: CleanupCompletionEvidenceInput,
    ) -> tuple[str, ...]:
        reasons: list[str] = []
        completed_at = ensure_naive_utc(payload.completed_at)
        now = ensure_naive_utc(self._clock())
        if authorization.status is not KnowledgeFSCleanupAuthorizationStatus.STARTED:
            reasons.append("cleanup authorization is not started")
        if ledger.cas_version != payload.expected_cas_version:
            reasons.append("cutover ledger CAS version changed")
        if authorization.plan_digest != payload.plan_digest:
            reasons.append("cleanup plan digest changed")
        if payload.migration_bundle_digest != authorization.plan_digest:
            reasons.append("executed migration bundle does not match the approved plan")
        if authorization.started_at is None or completed_at < authorization.started_at:
            reasons.append("cleanup completion predates the irreversible start")
        if completed_at > now:
            reasons.append("cleanup completion cannot be future-dated")
        evidence = CleanupReadinessEvidenceInput.model_validate(authorization.readiness_evidence)
        evidence = evidence.model_copy(update={"expected_cas_version": ledger.cas_version})
        reasons.extend(
            self._readiness_reasons(
                repository,
                ledger,
                evidence,
                allow_irreversible=True,
            )
        )
        if authorization.started_at is not None:
            for candidate in repository.list_ledgers():
                if candidate.irreversible_cleanup_at != authorization.started_at:
                    reasons.append(f"Workspace {candidate.tenant_id}: irreversible cleanup fence changed")
        return tuple(dict.fromkeys(reasons))

    @staticmethod
    def _require_ledger(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        tenant_id: str,
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        ledger = repository.get_ledger(tenant_id=tenant_id)
        if ledger is None:
            raise KnowledgeFSCleanupNotFoundError("Workspace cutover ledger was not found")
        return ledger

    @staticmethod
    def _require_authorization(
        repository: SQLAlchemyKnowledgeFSCleanupAuthorizationRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        request_id: str,
    ) -> KnowledgeFSCleanupAuthorization:
        authorization = repository.get(
            tenant_id=ledger.tenant_id,
            ledger_id=ledger.id,
            request_id=request_id,
        )
        if authorization is None:
            raise KnowledgeFSCleanupNotFoundError("Cleanup authorization was not found")
        return authorization

    @staticmethod
    def _cas_ledger(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        update: KnowledgeFSCutoverCASUpdate,
    ) -> None:
        if not repository.compare_and_set(update):
            raise KnowledgeFSCleanupConflictError("Cutover ledger changed during cleanup authorization")

    @classmethod
    def _fence_cleanup_cohort(
        cls,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        *,
        started_at: datetime,
    ) -> None:
        ledgers = repository.list_ledgers()
        if not ledgers:
            raise KnowledgeFSCleanupConflictError("Cleanup Workspace cohort is empty")
        for candidate in ledgers:
            cls._cas_ledger(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=candidate.tenant_id,
                    expected_phase=candidate.phase,
                    expected_cas_version=candidate.cas_version,
                    new_phase=candidate.phase,
                    irreversible_cleanup_at=started_at,
                ),
            )

    @staticmethod
    def _assert_request_replay(
        authorization: KnowledgeFSCleanupAuthorization,
        payload: CleanupReadinessEvidenceInput,
    ) -> None:
        if (
            authorization.plan_digest != payload.plan_digest
            or authorization.targets != [target.value for target in payload.targets]
            or authorization.readiness_evidence != payload.model_dump(mode="json")
        ):
            raise KnowledgeFSCleanupConflictError("Cleanup request ID was reused with different evidence")

    @staticmethod
    def _assert_approval_replay(
        authorization: KnowledgeFSCleanupAuthorization,
        payload: CleanupApprovalInput,
    ) -> None:
        if (
            authorization.plan_digest != payload.plan_digest
            or authorization.approved_by_account_id != str(payload.approved_by_account_id)
            or authorization.approved_at != ensure_naive_utc(payload.approved_at)
            or authorization.approval_expires_at != ensure_naive_utc(payload.approval_expires_at)
        ):
            raise KnowledgeFSCleanupConflictError("Cleanup approval replay does not match persisted approval")

    @staticmethod
    def _assert_start_replay(
        authorization: KnowledgeFSCleanupAuthorization,
        payload: CleanupStartInput,
    ) -> None:
        if (
            authorization.plan_digest != payload.plan_digest
            or authorization.started_by_account_id != str(payload.started_by_account_id)
            or authorization.started_at != ensure_naive_utc(payload.started_at)
        ):
            raise KnowledgeFSCleanupConflictError("Cleanup start replay does not match persisted fence")

    @staticmethod
    def _assert_completion_replay(
        authorization: KnowledgeFSCleanupAuthorization,
        payload: CleanupCompletionEvidenceInput,
    ) -> None:
        if (
            authorization.plan_digest != payload.plan_digest
            or authorization.completed_by_account_id != str(payload.completed_by_account_id)
            or authorization.completed_at != ensure_naive_utc(payload.completed_at)
            or authorization.completion_evidence != payload.model_dump(mode="json")
        ):
            raise KnowledgeFSCleanupConflictError("Cleanup completion replay does not match persisted evidence")


def _iso(value: datetime | None) -> str | None:
    return f"{value.isoformat()}Z" if value is not None else None


__all__ = [
    "CleanupApprovalInput",
    "CleanupApprovalReport",
    "CleanupCompletionEvidenceInput",
    "CleanupCompletionReport",
    "CleanupReadinessEvidenceInput",
    "CleanupReadinessReport",
    "CleanupStartInput",
    "CleanupStartReport",
    "KnowledgeFSCleanupConflictError",
    "KnowledgeFSCleanupError",
    "KnowledgeFSCleanupGateBlockedError",
    "KnowledgeFSCleanupNotFoundError",
    "KnowledgeFSCleanupService",
    "cleanup_workspace_cohort_digest",
]
