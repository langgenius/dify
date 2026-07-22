"""P8 inventory, backfill, shadow validation, and per-Workspace atomic cutover.

Inputs are strict operator-produced snapshots and remediation evidence. This module
never discovers or matches legacy product rows: opaque KnowledgeFS Space IDs are
registered directly into the independent control plane. Unknown access, unresolved
subjects, and unresolved cutover quarantine remain fail-closed and auditable.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Literal, NamedTuple, cast
from uuid import UUID

import sqlalchemy as sa
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError, field_validator, model_validator
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.knowledge_fs import (
    KnowledgeFSApiCredential,
    KnowledgeFSApiCredentialStatus,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSExternalAccessPolicy,
)
from models.knowledge_fs_cutover import (
    KnowledgeFSCutoverRevisionWatermark,
    KnowledgeFSCutoverSmokeResults,
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationIssueKind,
    KnowledgeFSMigrationIssueStatus,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSMigrationQuarantineDisposition,
    KnowledgeFSMigrationQuarantineKind,
    KnowledgeFSShadowAuthorizationDecision,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
    knowledge_fs_cutover_smoke_results_passed,
)
from repositories.knowledge_fs_cutover_repository import (
    KnowledgeFSCutoverCASUpdate,
    KnowledgeFSQuarantineCASUpdate,
    KnowledgeFSShadowDiffCASUpdate,
)
from repositories.sqlalchemy_knowledge_fs_cutover_repository import SQLAlchemyKnowledgeFSCutoverRepository
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSDifyIntegrationActivationAck,
    KnowledgeFSDifyIntegrationActivationRequest,
    KnowledgeFSDifyIntegrationFreezeAck,
    KnowledgeFSDifyIntegrationFreezeRequest,
    KnowledgeFSLifecycleRemoteError,
    KnowledgeFSLifecycleRemotePort,
)


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CutoverRevisionWatermarkInput(StrictInput):
    membership_epoch: int = Field(ge=0)
    space_acl_epoch: int = Field(ge=0)
    external_access_epoch: int = Field(ge=0)
    content_policy_revision: int = Field(ge=0)

    def to_record(self) -> KnowledgeFSCutoverRevisionWatermark:
        return cast(KnowledgeFSCutoverRevisionWatermark, self.model_dump())


class LegacyPermissionInventoryInput(StrictInput):
    subject_id: str = Field(min_length=1, max_length=255)
    account_id: UUID | None = None
    role: Literal["owner", "editor", "viewer"]


class LegacyTaskInventoryInput(StrictInput):
    task_id: str = Field(min_length=1, max_length=255)
    subject_id: str | None = Field(default=None, min_length=1, max_length=255)
    account_id: UUID | None = None
    state: Literal["queued", "running", "paused", "completed", "failed", "canceled"]
    expires_at: datetime | None = None


class LegacyApiKeyInventoryInput(StrictInput):
    key_id: str = Field(min_length=1, max_length=255)
    prefix: str = Field(min_length=1, max_length=32)
    last4: str = Field(min_length=4, max_length=4)


class LegacySpaceInventoryInput(StrictInput):
    knowledge_space_id: UUID
    knowledge_space_revision: int = Field(ge=0)
    provisioning_key: str = Field(min_length=1, max_length=255)
    owner_subject_id: str = Field(min_length=1, max_length=255)
    owner_account_id: UUID | None = None
    visibility: Literal["only_me", "all_members", "partial_members", "unknown"]
    external_access_enabled: bool | None = None
    permissions: list[LegacyPermissionInventoryInput] = Field(default_factory=list)
    legacy_api_keys: list[LegacyApiKeyInventoryInput] = Field(default_factory=list)
    tasks: list[LegacyTaskInventoryInput] = Field(default_factory=list)
    orphan_resource_ids: list[str] = Field(default_factory=list)


class WorkspaceInventoryInput(StrictInput):
    tenant_id: UUID
    source_revision_watermark: CutoverRevisionWatermarkInput
    task_watermark: int = Field(ge=0)
    spaces: list[LegacySpaceInventoryInput]


class ShadowAuthorizationObservationInput(StrictInput):
    schema_version: Literal["knowledge-fs-p8-shadow-observation/v1"]
    tenant_id: UUID
    diff_key: str = Field(min_length=1, max_length=255)
    control_space_id: UUID | None = None
    principal: str = Field(min_length=1, max_length=255)
    legacy_allowed: bool | None
    dify_allowed: bool
    reason: str = Field(min_length=1, max_length=4096)
    observed_revision: CutoverRevisionWatermarkInput
    observed_at: datetime
    producer: str = Field(min_length=1, max_length=255)

    @field_validator("observed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("shadow observation timestamps require an explicit timezone")
        return value


class ShadowCompletionInput(StrictInput):
    schema_version: Literal["knowledge-fs-p8-shadow-completion/v1"]
    tenant_id: UUID
    expected_cas_version: int = Field(ge=0)
    producer: str = Field(min_length=1, max_length=255)
    completed_by_operator: str = Field(min_length=1, max_length=255)
    completed_by_account_id: UUID
    completed_at: datetime
    traffic_zero: bool
    window_started_at: datetime | None = None
    window_ended_at: datetime | None = None
    traffic_zero_evidence: dict[str, JsonValue] | None = Field(default=None, min_length=1, max_length=32)

    @field_validator("completed_at", "window_started_at", "window_ended_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("shadow completion timestamps require an explicit timezone")
        return value

    @model_validator(mode="after")
    def require_window_or_traffic_zero_evidence(self) -> ShadowCompletionInput:
        if self.traffic_zero:
            if self.traffic_zero_evidence is None:
                raise ValueError("traffic-zero completion requires explicit evidence")
            if self.window_started_at is not None or self.window_ended_at is not None:
                raise ValueError("traffic-zero completion cannot also declare an observation window")
        elif self.window_started_at is None or self.window_ended_at is None or self.traffic_zero_evidence is not None:
            raise ValueError("nonzero shadow completion requires a window and no traffic-zero evidence")
        return self


class FinalDeltaInput(StrictInput):
    tenant_id: UUID
    expected_cas_version: int = Field(ge=0)
    final_revision_watermark: CutoverRevisionWatermarkInput
    applied_revision_watermark: CutoverRevisionWatermarkInput
    final_task_watermark: int = Field(ge=0)
    applied_task_watermark: int = Field(ge=0)


class GeneralQuarantineResolutionEvidence(StrictInput):
    schema_version: Literal["knowledge-fs-p8-general-resolution/v1"]
    reference: str = Field(min_length=1, max_length=2048)


class LegacyCredentialRotationEvidence(StrictInput):
    schema_version: Literal["knowledge-fs-p8-credential-rotation/v1"]
    legacy_key_id: str = Field(min_length=1, max_length=255)
    knowledge_space_id: UUID
    control_space_id: UUID
    dify_credential_id: UUID
    dify_credential_revision: int = Field(ge=0)
    legacy_revoked_at: datetime
    verification_reference: str = Field(min_length=1, max_length=2048)
    plaintext_migrated: Literal[False]

    @field_validator("legacy_revoked_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("credential rotation timestamp requires an explicit timezone")
        return value


class LegacyTaskResolutionEvidence(StrictInput):
    schema_version: Literal["knowledge-fs-p8-task-resolution/v1"]
    task_id: str = Field(min_length=1, max_length=255)
    action: Literal["migrate", "wait", "cancel", "isolate"]
    resulting_state: Literal["migrated", "completed", "failed", "canceled", "isolated"]
    final_task_watermark: int = Field(ge=0)
    verification_reference: str = Field(min_length=1, max_length=2048)


class QuarantineResolutionInput(StrictInput):
    """Operator-attested remediation evidence for one tenant-scoped quarantine row."""

    schema_version: Literal["knowledge-fs-p8-quarantine-resolution/v1"]
    tenant_id: UUID
    source_kind: KnowledgeFSMigrationQuarantineKind
    source_id: str = Field(min_length=1, max_length=255)
    expected_row_version: int = Field(ge=0)
    resolved_by_operator: str = Field(min_length=1, max_length=255)
    resolved_by_account_id: UUID
    evidence: GeneralQuarantineResolutionEvidence | LegacyCredentialRotationEvidence | LegacyTaskResolutionEvidence
    resolved_at: datetime

    @field_validator("resolved_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("quarantine resolution timestamps require an explicit timezone")
        return value

    @model_validator(mode="after")
    def require_source_specific_evidence(self) -> QuarantineResolutionInput:
        expected_type: type[StrictInput]
        if self.source_kind is KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY:
            expected_type = LegacyCredentialRotationEvidence
        elif self.source_kind is KnowledgeFSMigrationQuarantineKind.TASK:
            expected_type = LegacyTaskResolutionEvidence
        else:
            expected_type = GeneralQuarantineResolutionEvidence
        if not isinstance(self.evidence, expected_type):
            raise ValueError(f"{self.source_kind.value} requires its source-specific evidence schema")
        return self


class CutoverSmokeChecksInput(StrictInput):
    authorization: bool
    list_spaces: bool
    create_space: bool
    query: bool
    upload: bool
    stream: bool
    deletion: bool


class CutoverSmokeEvidenceReferencesInput(StrictInput):
    authorization: str = Field(min_length=1, max_length=2048)
    list_spaces: str = Field(min_length=1, max_length=2048)
    create_space: str = Field(min_length=1, max_length=2048)
    query: str = Field(min_length=1, max_length=2048)
    upload: str = Field(min_length=1, max_length=2048)
    stream: str = Field(min_length=1, max_length=2048)
    deletion: str = Field(min_length=1, max_length=2048)


class CutoverSmokeResultsInput(StrictInput):
    schema_version: Literal["knowledge-fs-p8-cutover-smoke/v1"]
    tenant_id: UUID
    environment: Literal["production"]
    operator: str = Field(min_length=1, max_length=255)
    operator_account_id: UUID
    observed_at: datetime
    checks: CutoverSmokeChecksInput
    evidence_references: CutoverSmokeEvidenceReferencesInput

    @field_validator("observed_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("smoke evidence timestamp requires an explicit timezone")
        return value

    def to_record(self) -> KnowledgeFSCutoverSmokeResults:
        return cast(KnowledgeFSCutoverSmokeResults, self.model_dump(mode="json"))

    @property
    def passed(self) -> bool:
        return all(self.checks.model_dump().values())


class LegacyDependencyInput(StrictInput):
    dependency_key: str = Field(min_length=1, max_length=255)
    kind: Literal["permission_snapshot", "foreign_key"]
    table_name: str = Field(min_length=1, max_length=255)
    column_name: str = Field(min_length=1, max_length=255)
    constraint_name: str | None = Field(default=None, min_length=1, max_length=255)
    active_rows: int = Field(ge=0)
    migrated_rows: int = Field(ge=0)


class CutoverInventoryReport(NamedTuple):
    tenant_id: str
    spaces: int
    permissions: int
    unresolved_subjects: int
    unknown_external_access: int
    legacy_keys_requiring_rotation: int
    tasks_by_disposition: dict[str, int]
    orphan_resources: int
    applied: bool
    replayed: bool


class CutoverBackfillReport(NamedTuple):
    tenant_id: str
    control_spaces_registered: int
    permissions_granted: int
    quarantined: int
    open_issues: int
    phase: str
    applied: bool


class ShadowAuthorizationReport(NamedTuple):
    tenant_id: str
    matches: int
    tightened: int
    expanded: int
    unknown: int
    open_diffs: int
    applied: bool
    recorded: int
    replayed: int


class ShadowCompletionReport(NamedTuple):
    tenant_id: str
    observation_count: int
    traffic_zero: bool
    evidence_digest: str
    latest_observed_revision: KnowledgeFSCutoverRevisionWatermark | None
    applied: bool
    replayed: bool


class LegacyDependencyDashboard(NamedTuple):
    tenant_id: str
    ready: bool
    permission_snapshot_dependencies: int
    foreign_key_dependencies: int
    active_rows: int
    dependencies: tuple[dict[str, object], ...]
    applied: bool


class QuarantineResolutionReport(NamedTuple):
    tenant_id: str
    source_kind: str
    source_id: str
    disposition: str
    row_version: int
    applied: bool
    replayed: bool


class KnowledgeFSCutoverError(RuntimeError):
    """Base error for an operator cutover request rejected before mutation."""


class KnowledgeFSCutoverNotFoundError(KnowledgeFSCutoverError):
    pass


class KnowledgeFSCutoverConflictError(KnowledgeFSCutoverError):
    pass


class KnowledgeFSCutoverGateBlockedError(KnowledgeFSCutoverError):
    pass


_VISIBILITY_MAP = {
    "only_me": KnowledgeFSControlSpaceVisibility.ONLY_ME,
    "all_members": KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS,
    "partial_members": KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
}

_CUTOVER_QUARANTINE_KINDS = (
    KnowledgeFSMigrationQuarantineKind.CONTROL_SPACE,
    KnowledgeFSMigrationQuarantineKind.TASK,
    KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY,
    KnowledgeFSMigrationQuarantineKind.ORPHAN_RESOURCE,
)
_DEFAULT_TRUSTED_SHADOW_PRODUCERS = frozenset({"dify-shadow-authorizer"})
_DEFAULT_TRUSTED_SHADOW_OPERATORS = frozenset({"knowledge-fs-cutover"})


class KnowledgeFSWorkspaceCutoverService:
    """Coordinate one Workspace through the strict P8 phase sequence."""

    _session_maker: sessionmaker[Session]
    _clock: Callable[[], datetime]
    _trusted_shadow_producers: frozenset[str]
    _trusted_shadow_operators: frozenset[str]
    _remote_factory: Callable[[], KnowledgeFSLifecycleRemotePort] | None

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        clock: Callable[[], datetime] = naive_utc_now,
        *,
        trusted_shadow_producers: frozenset[str] = _DEFAULT_TRUSTED_SHADOW_PRODUCERS,
        trusted_shadow_operators: frozenset[str] = _DEFAULT_TRUSTED_SHADOW_OPERATORS,
        remote_factory: Callable[[], KnowledgeFSLifecycleRemotePort] | None = None,
    ):
        self._session_maker = session_maker
        self._clock = clock
        self._trusted_shadow_producers = trusted_shadow_producers
        self._trusted_shadow_operators = trusted_shadow_operators
        self._remote_factory = remote_factory

    def inventory(self, payload: WorkspaceInventoryInput, *, apply: bool) -> CutoverInventoryReport:
        """Validate a read-only inventory and optionally create the initial CAS ledger."""

        tenant_id = str(payload.tenant_id)
        self._assert_unique_inventory(payload.spaces)
        dispositions = self._task_disposition_counts(payload.spaces)
        report = CutoverInventoryReport(
            tenant_id=tenant_id,
            spaces=len(payload.spaces),
            permissions=sum(len(space.permissions) for space in payload.spaces),
            unresolved_subjects=sum(space.owner_account_id is None for space in payload.spaces)
            + sum(permission.account_id is None for space in payload.spaces for permission in space.permissions),
            unknown_external_access=sum(space.external_access_enabled is None for space in payload.spaces),
            legacy_keys_requiring_rotation=sum(len(space.legacy_api_keys) for space in payload.spaces),
            tasks_by_disposition=dispositions,
            orphan_resources=sum(len(space.orphan_resource_ids) for space in payload.spaces),
            applied=apply,
            replayed=False,
        )
        if not apply:
            return report
        source_watermark = payload.source_revision_watermark.to_record()
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            current = repository.get_ledger(tenant_id=tenant_id)
            if current is not None:
                if (
                    current.source_revision_watermark != source_watermark
                    or current.source_task_watermark != payload.task_watermark
                ):
                    raise KnowledgeFSCutoverConflictError("Workspace inventory watermarks conflict with the ledger")
                return report._replace(replayed=True)
            repository.add_ledger(
                KnowledgeFSWorkspaceCutoverLedger(
                    tenant_id=tenant_id,
                    source_revision_watermark=source_watermark,
                    applied_revision_watermark=source_watermark,
                    source_task_watermark=payload.task_watermark,
                    applied_task_watermark=payload.task_watermark,
                )
            )
        return report

    def backfill(self, payload: WorkspaceInventoryInput, *, apply: bool) -> CutoverBackfillReport:
        """Backfill only independent control-plane rows; unresolved inputs stay quarantined."""

        tenant_id = str(payload.tenant_id)
        self._assert_unique_inventory(payload.spaces)
        if not apply:
            return self._project_backfill(payload)
        registered = 0
        granted = 0
        quarantined = 0
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            if ledger.phase not in {
                KnowledgeFSWorkspaceCutoverPhase.INVENTORY,
                KnowledgeFSWorkspaceCutoverPhase.BACKFILL,
            }:
                raise KnowledgeFSCutoverConflictError("Backfill is closed after shadow validation starts")
            if (
                ledger.source_revision_watermark != payload.source_revision_watermark.to_record()
                or ledger.source_task_watermark != payload.task_watermark
            ):
                raise KnowledgeFSCutoverConflictError("Backfill input does not match the inventoried watermarks")
            for space in payload.spaces:
                result = self._backfill_space(
                    session,
                    repository,
                    ledger,
                    space,
                    payload.source_revision_watermark.to_record(),
                )
                registered += result[0]
                granted += result[1]
                quarantined += result[2]
            session.flush()
            open_issues = repository.count_open_issues(tenant_id=tenant_id, ledger_id=ledger.id)
            if ledger.phase is KnowledgeFSWorkspaceCutoverPhase.INVENTORY and open_issues == 0:
                self._cas(
                    repository,
                    KnowledgeFSCutoverCASUpdate(
                        tenant_id=tenant_id,
                        expected_phase=ledger.phase,
                        expected_cas_version=ledger.cas_version,
                        new_phase=KnowledgeFSWorkspaceCutoverPhase.BACKFILL,
                    ),
                )
                phase = KnowledgeFSWorkspaceCutoverPhase.BACKFILL.value
            else:
                phase = ledger.phase.value
        return CutoverBackfillReport(tenant_id, registered, granted, quarantined, open_issues, phase, True)

    def begin_shadow(
        self,
        *,
        tenant_id: str,
        expected_cas_version: int,
        started_at: datetime | None = None,
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        shadow_started_at = _naive_utc(started_at or self._clock())
        if shadow_started_at > _naive_utc(self._clock()):
            raise KnowledgeFSCutoverConflictError("Shadow start timestamp cannot be in the future")
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.BACKFILL, expected_cas_version)
            self._assert_no_open_gates(repository, ledger)
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=KnowledgeFSWorkspaceCutoverPhase.SHADOW,
                    shadow_started_at=shadow_started_at,
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def record_shadow_report(
        self,
        observations: Iterable[ShadowAuthorizationObservationInput],
        *,
        apply: bool,
    ) -> ShadowAuthorizationReport:
        items = tuple(observations)
        if not items:
            raise KnowledgeFSCutoverConflictError("Shadow report requires at least one observation")
        tenant_ids = {str(item.tenant_id) for item in items}
        if len(tenant_ids) != 1:
            raise KnowledgeFSCutoverConflictError("Shadow report cannot mix Workspaces")
        tenant_id = tenant_ids.pop()
        if len({item.producer for item in items}) != 1:
            raise KnowledgeFSCutoverConflictError("Shadow report cannot mix producers")
        decisions = [self._shadow_decision(item) for item in items]
        counts = {decision: decisions.count(decision) for decision in KnowledgeFSShadowAuthorizationDecision}
        replayed = 0
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            if ledger.phase is not KnowledgeFSWorkspaceCutoverPhase.SHADOW:
                raise KnowledgeFSCutoverConflictError("Shadow observations require the shadow phase")
            for item, decision in zip(items, decisions, strict=True):
                self._validate_shadow_observation(ledger, item)
                replayed += self._record_shadow_observation(
                    repository,
                    ledger,
                    item,
                    decision,
                    apply=apply,
                )
            if apply:
                session.flush()
                open_diffs = repository.count_unapproved_shadow_diffs(tenant_id=tenant_id, ledger_id=ledger.id)
            else:
                open_diffs = sum(decision is not KnowledgeFSShadowAuthorizationDecision.MATCH for decision in decisions)
        return ShadowAuthorizationReport(
            tenant_id,
            counts[KnowledgeFSShadowAuthorizationDecision.MATCH],
            counts[KnowledgeFSShadowAuthorizationDecision.TIGHTENED],
            counts[KnowledgeFSShadowAuthorizationDecision.EXPANDED],
            counts[KnowledgeFSShadowAuthorizationDecision.UNKNOWN],
            open_diffs,
            apply,
            len(items) - replayed,
            replayed,
        )

    def complete_shadow(self, payload: ShadowCompletionInput, *, apply: bool) -> ShadowCompletionReport:
        """Close a trusted shadow window and persist an immutable digest of its evidence."""

        tenant_id = str(payload.tenant_id)
        completed_at = _naive_utc(payload.completed_at)
        now = _naive_utc(self._clock())
        if payload.producer not in self._trusted_shadow_producers:
            raise KnowledgeFSCutoverGateBlockedError("Shadow completion producer is not trusted")
        if payload.completed_by_operator not in self._trusted_shadow_operators:
            raise KnowledgeFSCutoverGateBlockedError("Shadow completion operator is not trusted")
        if completed_at > now:
            raise KnowledgeFSCutoverConflictError("Shadow completion timestamp cannot be in the future")
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            if ledger.phase is not KnowledgeFSWorkspaceCutoverPhase.SHADOW:
                raise KnowledgeFSCutoverConflictError("Shadow completion requires the shadow phase")
            if ledger.shadow_started_at is None:
                raise KnowledgeFSCutoverGateBlockedError("Shadow start evidence is missing")
            if completed_at < ledger.shadow_started_at:
                raise KnowledgeFSCutoverConflictError("Shadow completion predates shadow start")
            observations = repository.list_shadow_observations(tenant_id=tenant_id, ledger_id=ledger.id)
            latest_revision: KnowledgeFSCutoverRevisionWatermark | None
            if payload.traffic_zero:
                if observations:
                    raise KnowledgeFSCutoverConflictError(
                        "Traffic-zero completion conflicts with persisted observations"
                    )
                latest_revision = None
                evidence_digest = _shadow_traffic_zero_digest(payload)
            else:
                if not observations:
                    raise KnowledgeFSCutoverGateBlockedError(
                        "Shadow completion requires at least one observation or traffic-zero evidence"
                    )
                if any(item.producer != payload.producer for item in observations):
                    raise KnowledgeFSCutoverGateBlockedError(
                        "Shadow observations were not produced by the completing trusted producer"
                    )
                window_started_at = _naive_utc(cast(datetime, payload.window_started_at))
                window_ended_at = _naive_utc(cast(datetime, payload.window_ended_at))
                if window_started_at < ledger.shadow_started_at or window_ended_at <= window_started_at:
                    raise KnowledgeFSCutoverConflictError("Shadow observation window is invalid")
                if window_ended_at > completed_at:
                    raise KnowledgeFSCutoverConflictError("Shadow observation window ends after completion")
                if any(
                    item.observed_at < window_started_at or item.observed_at > window_ended_at for item in observations
                ):
                    raise KnowledgeFSCutoverGateBlockedError(
                        "Persisted shadow observations fall outside the completed window"
                    )
                latest_revision = _latest_shadow_revision(observations)
                required_revision = ledger.final_revision_watermark or ledger.source_revision_watermark
                if not _watermark_at_least(latest_revision, required_revision):
                    raise KnowledgeFSCutoverGateBlockedError(
                        "Shadow latest observed revision is below the applicable cutover watermark"
                    )
                evidence_digest = _shadow_observation_set_digest(observations)
            report = ShadowCompletionReport(
                tenant_id,
                len(observations),
                payload.traffic_zero,
                evidence_digest,
                latest_revision,
                apply,
                ledger.shadow_completed_at is not None,
            )
            if ledger.shadow_completed_at is not None:
                self._assert_shadow_completion_replay(ledger, payload, report)
                return report
            if ledger.cas_version != payload.expected_cas_version:
                raise KnowledgeFSCutoverConflictError("Cutover ledger version changed")
            if not apply:
                return report
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=ledger.phase,
                    shadow_completed_at=completed_at,
                    shadow_evidence_digest=evidence_digest,
                    shadow_observation_count=len(observations),
                    shadow_window_started_at=(
                        _naive_utc(payload.window_started_at) if payload.window_started_at is not None else None
                    ),
                    shadow_window_ended_at=(
                        _naive_utc(payload.window_ended_at) if payload.window_ended_at is not None else None
                    ),
                    shadow_traffic_zero=payload.traffic_zero,
                    shadow_traffic_zero_evidence=(
                        cast(dict[str, object], payload.traffic_zero_evidence)
                        if payload.traffic_zero_evidence is not None
                        else None
                    ),
                    shadow_latest_observed_revision=latest_revision,
                    shadow_producer=payload.producer,
                    shadow_completed_by_operator=payload.completed_by_operator,
                    shadow_completed_by_account_id=str(payload.completed_by_account_id),
                ),
            )
            return report

    def approve_shadow_diff(
        self,
        *,
        tenant_id: str,
        diff_key: str,
        account_id: str,
        approved_at: datetime,
    ) -> None:
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            diff = repository.get_shadow_diff(tenant_id=tenant_id, ledger_id=ledger.id, diff_key=diff_key)
            if diff is None:
                raise KnowledgeFSCutoverNotFoundError("Shadow authorization diff was not found")
            if diff.dify_allowed or diff.decision is KnowledgeFSShadowAuthorizationDecision.EXPANDED:
                raise KnowledgeFSCutoverGateBlockedError("Access-expanding diffs cannot be approved as fail-closed")
            changed = repository.set_shadow_diff_status(
                tenant_id=tenant_id,
                ledger_id=ledger.id,
                diff_key=diff_key,
                expected_status=KnowledgeFSMigrationIssueStatus.OPEN,
                new_status=KnowledgeFSMigrationIssueStatus.APPROVED_FAIL_CLOSED,
                account_id=account_id,
                changed_at=_naive_utc(approved_at),
            )
            if not changed and diff.status is not KnowledgeFSMigrationIssueStatus.APPROVED_FAIL_CLOSED:
                raise KnowledgeFSCutoverConflictError("Shadow authorization diff changed during approval")

    def approve_issue_fail_closed(
        self,
        *,
        tenant_id: str,
        issue_key: str,
        account_id: str,
        approved_at: datetime,
    ) -> None:
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            issue = repository.get_issue(tenant_id=tenant_id, ledger_id=ledger.id, issue_key=issue_key)
            if issue is None:
                raise KnowledgeFSCutoverNotFoundError("Migration issue was not found")
            approvable = issue.kind in {
                KnowledgeFSMigrationIssueKind.UNKNOWN_EXTERNAL_ACCESS,
                KnowledgeFSMigrationIssueKind.UNRESOLVED_SUBJECT,
            } and not issue.issue_key.startswith("owner:")
            if not approvable:
                raise KnowledgeFSCutoverGateBlockedError(
                    "Only unknown fail-closed authorization can be approved; this issue must be resolved"
                )
            changed = repository.set_issue_status(
                tenant_id=tenant_id,
                ledger_id=ledger.id,
                issue_key=issue_key,
                expected_status=KnowledgeFSMigrationIssueStatus.OPEN,
                new_status=KnowledgeFSMigrationIssueStatus.APPROVED_FAIL_CLOSED,
                account_id=account_id,
                changed_at=_naive_utc(approved_at),
            )
            if not changed and issue.status is not KnowledgeFSMigrationIssueStatus.APPROVED_FAIL_CLOSED:
                raise KnowledgeFSCutoverConflictError("Migration issue changed during approval")

    def resolve_issue(
        self,
        *,
        tenant_id: str,
        issue_key: str,
        account_id: str,
        resolved_at: datetime,
    ) -> None:
        """Resolve remediated non-unknown evidence; unknown authorization requires fail-closed approval."""

        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            issue = repository.get_issue(tenant_id=tenant_id, ledger_id=ledger.id, issue_key=issue_key)
            if issue is None:
                raise KnowledgeFSCutoverNotFoundError("Migration issue was not found")
            if issue.kind in {
                KnowledgeFSMigrationIssueKind.UNKNOWN_EXTERNAL_ACCESS,
                KnowledgeFSMigrationIssueKind.UNRESOLVED_SUBJECT,
            } and not issue.issue_key.startswith("owner:"):
                raise KnowledgeFSCutoverGateBlockedError(
                    "Unknown authorization evidence can only be approved as fail-closed"
                )
            if issue.status is KnowledgeFSMigrationIssueStatus.RESOLVED:
                return
            changed = repository.set_issue_status(
                tenant_id=tenant_id,
                ledger_id=ledger.id,
                issue_key=issue_key,
                expected_status=issue.status,
                new_status=KnowledgeFSMigrationIssueStatus.RESOLVED,
                account_id=account_id,
                changed_at=_naive_utc(resolved_at),
            )
            if not changed:
                raise KnowledgeFSCutoverConflictError("Migration issue changed during resolution")

    def resolve_shadow_diff(
        self,
        *,
        tenant_id: str,
        diff_key: str,
        account_id: str,
        resolved_at: datetime,
    ) -> None:
        """Resolve a remediated known diff; unknown evidence remains approval-only."""

        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            diff = repository.get_shadow_diff(tenant_id=tenant_id, ledger_id=ledger.id, diff_key=diff_key)
            if diff is None:
                raise KnowledgeFSCutoverNotFoundError("Shadow authorization diff was not found")
            if diff.decision is KnowledgeFSShadowAuthorizationDecision.UNKNOWN:
                raise KnowledgeFSCutoverGateBlockedError("Unknown shadow evidence can only be approved as fail-closed")
            if diff.decision is KnowledgeFSShadowAuthorizationDecision.EXPANDED:
                raise KnowledgeFSCutoverGateBlockedError(
                    "Expanded shadow evidence requires a safe shadow re-evaluation"
                )
            if diff.status is KnowledgeFSMigrationIssueStatus.RESOLVED:
                return
            changed = repository.set_shadow_diff_status(
                tenant_id=tenant_id,
                ledger_id=ledger.id,
                diff_key=diff_key,
                expected_status=diff.status,
                new_status=KnowledgeFSMigrationIssueStatus.RESOLVED,
                account_id=account_id,
                changed_at=_naive_utc(resolved_at),
            )
            if not changed:
                raise KnowledgeFSCutoverConflictError("Shadow authorization diff changed during resolution")

    def resolve_quarantine(
        self,
        payload: QuarantineResolutionInput,
        *,
        apply: bool,
    ) -> QuarantineResolutionReport:
        """Resolve one quarantined source with immutable evidence and row-version CAS."""

        tenant_id = str(payload.tenant_id)
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            item = repository.get_quarantine(
                tenant_id=tenant_id,
                ledger_id=ledger.id,
                source_kind=payload.source_kind,
                source_id=payload.source_id,
            )
            if item is None:
                raise KnowledgeFSCutoverNotFoundError("Quarantine item was not found")
            resolved_at = _naive_utc(payload.resolved_at)
            if resolved_at > _naive_utc(self._clock()):
                raise KnowledgeFSCutoverConflictError("Quarantine resolution timestamp cannot be in the future")
            evidence = cast(dict[str, object], payload.evidence.model_dump(mode="json"))
            if item.disposition is KnowledgeFSMigrationQuarantineDisposition.RESOLVED:
                if (
                    item.row_version != payload.expected_row_version + 1
                    or item.resolved_by_operator != payload.resolved_by_operator
                    or item.resolved_by_account_id != str(payload.resolved_by_account_id)
                    or item.evidence != evidence
                    or item.resolved_at != resolved_at
                ):
                    raise KnowledgeFSCutoverConflictError(
                        "Quarantine item was already resolved with different evidence"
                    )
                return QuarantineResolutionReport(
                    tenant_id,
                    item.source_kind.value,
                    item.source_id,
                    item.disposition.value,
                    item.row_version,
                    apply,
                    True,
                )
            if ledger.phase in {
                KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
                KnowledgeFSWorkspaceCutoverPhase.OBSERVING,
                KnowledgeFSWorkspaceCutoverPhase.READY_FOR_CLEANUP,
            }:
                raise KnowledgeFSCutoverConflictError("Quarantine resolution is closed after cutover")
            if item.row_version != payload.expected_row_version:
                raise KnowledgeFSCutoverConflictError("Quarantine item version changed")
            self._validate_quarantine_resolution(session, ledger, item, payload, resolved_at)
            if not apply:
                return QuarantineResolutionReport(
                    tenant_id,
                    item.source_kind.value,
                    item.source_id,
                    item.disposition.value,
                    item.row_version,
                    False,
                    False,
                )
            changed = repository.resolve_quarantine(
                KnowledgeFSQuarantineCASUpdate(
                    tenant_id=tenant_id,
                    ledger_id=ledger.id,
                    source_kind=item.source_kind,
                    source_id=item.source_id,
                    expected_disposition=item.disposition,
                    expected_row_version=item.row_version,
                    resolved_by_operator=payload.resolved_by_operator,
                    resolved_by_account_id=str(payload.resolved_by_account_id),
                    evidence=evidence,
                    resolved_at=resolved_at,
                )
            )
            if not changed:
                raise KnowledgeFSCutoverConflictError("Quarantine item changed during resolution")
            return QuarantineResolutionReport(
                tenant_id,
                item.source_kind.value,
                item.source_id,
                KnowledgeFSMigrationQuarantineDisposition.RESOLVED.value,
                item.row_version + 1,
                True,
                False,
            )

    def _validate_quarantine_resolution(
        self,
        session: Session,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        item: KnowledgeFSMigrationQuarantine,
        payload: QuarantineResolutionInput,
        resolved_at: datetime,
    ) -> None:
        if isinstance(payload.evidence, LegacyCredentialRotationEvidence):
            credential_evidence = payload.evidence
            if credential_evidence.legacy_key_id != item.source_id:
                raise KnowledgeFSCutoverConflictError("Credential rotation evidence names a different legacy key")
            knowledge_space_id = str(credential_evidence.knowledge_space_id)
            if item.details.get("knowledge_space_id") != knowledge_space_id:
                raise KnowledgeFSCutoverConflictError(
                    "Credential rotation evidence names a different KnowledgeFS Space"
                )
            if _naive_utc(credential_evidence.legacy_revoked_at) > resolved_at:
                raise KnowledgeFSCutoverConflictError("Legacy credential revocation occurred after resolution")
            control_space = session.scalar(
                sa.select(KnowledgeFSControlSpace).where(
                    KnowledgeFSControlSpace.id == str(credential_evidence.control_space_id),
                    KnowledgeFSControlSpace.tenant_id == ledger.tenant_id,
                    KnowledgeFSControlSpace.knowledge_space_id == knowledge_space_id,
                    KnowledgeFSControlSpace.state == KnowledgeFSControlSpaceState.ACTIVE,
                )
            )
            if control_space is None:
                raise KnowledgeFSCutoverGateBlockedError(
                    "Credential rotation requires the tenant-owned active control-space"
                )
            credential = session.scalar(
                sa.select(KnowledgeFSApiCredential).where(
                    KnowledgeFSApiCredential.id == str(credential_evidence.dify_credential_id),
                    KnowledgeFSApiCredential.tenant_id == ledger.tenant_id,
                    KnowledgeFSApiCredential.control_space_id == control_space.id,
                )
            )
            if (
                credential is None
                or credential.status is not KnowledgeFSApiCredentialStatus.ACTIVE
                or credential.revision != credential_evidence.dify_credential_revision
                or (credential.expires_at is not None and credential.expires_at <= resolved_at)
            ):
                raise KnowledgeFSCutoverGateBlockedError(
                    "Credential rotation requires a matching active Dify-managed credential"
                )
            if credential.credential_prefix == item.details.get(
                "prefix"
            ) and credential.credential_last4 == item.details.get("last4"):
                raise KnowledgeFSCutoverGateBlockedError("Credential rotation did not replace the legacy credential")
            return
        if isinstance(payload.evidence, LegacyTaskResolutionEvidence):
            task_evidence = payload.evidence
            expected_actions = {
                KnowledgeFSMigrationQuarantineDisposition.MIGRATABLE: "migrate",
                KnowledgeFSMigrationQuarantineDisposition.WAIT_FOR_COMPLETION: "wait",
                KnowledgeFSMigrationQuarantineDisposition.CANCEL: "cancel",
                KnowledgeFSMigrationQuarantineDisposition.ISOLATE: "isolate",
            }
            expected_results = {
                "migrate": {"migrated"},
                "wait": {"completed", "failed", "canceled"},
                "cancel": {"canceled"},
                "isolate": {"isolated"},
            }
            if task_evidence.task_id != item.source_id or task_evidence.action != expected_actions.get(
                item.disposition
            ):
                raise KnowledgeFSCutoverConflictError("Task evidence does not match its classified disposition")
            if task_evidence.resulting_state not in expected_results[task_evidence.action]:
                raise KnowledgeFSCutoverConflictError("Task evidence has an invalid resulting state")
            if task_evidence.final_task_watermark < ledger.source_task_watermark:
                raise KnowledgeFSCutoverGateBlockedError("Task evidence is below the inventoried task watermark")

    def legacy_dependency_dashboard(
        self,
        *,
        tenant_id: str,
        dependencies: Iterable[LegacyDependencyInput],
        expected_cas_version: int | None,
        checked_at: datetime,
        apply: bool,
    ) -> LegacyDependencyDashboard:
        items = tuple(dependencies)
        active_rows = sum(item.active_rows for item in items)
        ready = active_rows == 0
        report = LegacyDependencyDashboard(
            tenant_id,
            ready,
            sum(item.kind == "permission_snapshot" for item in items),
            sum(item.kind == "foreign_key" for item in items),
            active_rows,
            tuple(item.model_dump(mode="json") for item in items),
            apply,
        )
        if not apply:
            return report
        if expected_cas_version is None:
            raise KnowledgeFSCutoverConflictError("Applying a dependency dashboard requires expected_cas_version")
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            if ledger.cas_version != expected_cas_version:
                raise KnowledgeFSCutoverConflictError("Cutover ledger version changed")
            for item in items:
                if item.active_rows > 0:
                    kind = (
                        KnowledgeFSMigrationIssueKind.LEGACY_SNAPSHOT_DEPENDENCY
                        if item.kind == "permission_snapshot"
                        else KnowledgeFSMigrationIssueKind.LEGACY_FOREIGN_KEY_DEPENDENCY
                    )
                    self._ensure_issue(
                        repository,
                        ledger,
                        issue_key=f"legacy:{item.dependency_key}",
                        kind=kind,
                        resource_type="legacy_dependency",
                        resource_id=item.dependency_key,
                        details=item.model_dump(mode="json"),
                    )
            dependency_keys = {f"legacy:{item.dependency_key}" for item in items if item.active_rows > 0}
            for issue in repository.list_issues(tenant_id=tenant_id, ledger_id=ledger.id):
                if (
                    issue.kind
                    in {
                        KnowledgeFSMigrationIssueKind.LEGACY_SNAPSHOT_DEPENDENCY,
                        KnowledgeFSMigrationIssueKind.LEGACY_FOREIGN_KEY_DEPENDENCY,
                    }
                    and issue.issue_key not in dependency_keys
                    and issue.status is not KnowledgeFSMigrationIssueStatus.RESOLVED
                ):
                    repository.set_issue_status(
                        tenant_id=tenant_id,
                        ledger_id=ledger.id,
                        issue_key=issue.issue_key,
                        expected_status=issue.status,
                        new_status=KnowledgeFSMigrationIssueStatus.RESOLVED,
                        account_id=tenant_id,
                        changed_at=_naive_utc(checked_at),
                    )
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=ledger.phase,
                    legacy_dependency_report=[dict(dependency) for dependency in report.dependencies],
                    legacy_dependency_checked_at=_naive_utc(checked_at),
                    legacy_dependency_ready=ready,
                ),
            )
        return report

    def freeze(
        self, *, tenant_id: str, expected_cas_version: int, freeze_at: datetime
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        freeze_time = _naive_utc(freeze_at)
        if freeze_time > _naive_utc(self._clock()):
            raise KnowledgeFSCutoverConflictError("Freeze timestamp cannot be in the future")

        # Snapshot all gates and the control identity, then release the transaction before the
        # remote call. Local FROZEN state is not visible until KnowledgeFS durably acknowledges.
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.SHADOW, expected_cas_version)
            self._assert_shadow_evidence_complete(ledger)
            self._assert_no_open_gates(repository, ledger)
            self._assert_no_unresolved_quarantine(repository, ledger)
            if not ledger.legacy_dependency_ready or ledger.legacy_dependency_checked_at is None:
                raise KnowledgeFSCutoverGateBlockedError("Legacy snapshot/FK dependency dashboard is not ready")
            control_space = self._require_activation_control_space(session, tenant_id=tenant_id)
            freeze_request = _freeze_request(ledger, control_space_id=control_space.id)

        if self._remote_factory is None:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote freeze is not configured")
        try:
            remote = self._remote_factory()
        except RuntimeError as exc:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote freeze is not configured") from exc
        if remote is None:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote freeze is not configured")
        try:
            raw_ack = remote.freeze_dify_workspace_integration(freeze_request)
        except KnowledgeFSLifecycleRemoteError as exc:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote freeze was not acknowledged") from exc
        try:
            ack = (
                raw_ack
                if isinstance(raw_ack, KnowledgeFSDifyIntegrationFreezeAck)
                else KnowledgeFSDifyIntegrationFreezeAck.model_validate(raw_ack, from_attributes=True)
            )
        except (TypeError, ValueError, ValidationError) as exc:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote freeze acknowledgement was malformed") from exc
        _assert_exact_freeze_ack(freeze_request, ack)
        acknowledged_at = _naive_utc(self._clock())

        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.SHADOW, expected_cas_version)
            self._assert_shadow_evidence_complete(ledger)
            self._assert_no_open_gates(repository, ledger)
            self._assert_no_unresolved_quarantine(repository, ledger)
            if not ledger.legacy_dependency_ready or ledger.legacy_dependency_checked_at is None:
                raise KnowledgeFSCutoverGateBlockedError("Legacy snapshot/FK dependency dashboard is not ready")
            control_space = self._require_activation_control_space(
                session,
                tenant_id=tenant_id,
                control_space_id=freeze_request.control_space_id,
            )
            if _freeze_request(ledger, control_space_id=control_space.id) != freeze_request:
                raise KnowledgeFSCutoverConflictError("Freeze evidence changed after remote acknowledgement")
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=KnowledgeFSWorkspaceCutoverPhase.FROZEN,
                    freeze_at=freeze_time,
                    remote_freeze_id=ack.freeze_id,
                    remote_freeze_revision=ack.freeze_revision,
                    remote_freeze_digest=ack.source_revision_digest,
                    remote_freeze_task_watermark=ack.source_task_watermark,
                    remote_freeze_control_space_id=control_space.id,
                    remote_freeze_frozen_at=_naive_utc(ack.frozen_at),
                    remote_freeze_updated_at=_naive_utc(ack.updated_at),
                    remote_freeze_acknowledged_at=acknowledged_at,
                    remote_freeze_applied=ack.applied,
                    remote_freeze_replayed=ack.replayed,
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def apply_final_delta(self, payload: FinalDeltaInput) -> KnowledgeFSWorkspaceCutoverLedger:
        tenant_id = str(payload.tenant_id)
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.FROZEN, payload.expected_cas_version)
            final_watermark = payload.final_revision_watermark.to_record()
            applied_watermark = payload.applied_revision_watermark.to_record()
            if not _watermark_at_least(final_watermark, ledger.source_revision_watermark):
                raise KnowledgeFSCutoverConflictError("Final authorization watermark moved backwards")
            if payload.final_task_watermark < ledger.source_task_watermark:
                raise KnowledgeFSCutoverConflictError("Final task watermark moved backwards")
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=ledger.phase,
                    final_revision_watermark=final_watermark,
                    applied_revision_watermark=applied_watermark,
                    final_task_watermark=payload.final_task_watermark,
                    applied_task_watermark=payload.applied_task_watermark,
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def cutover(
        self,
        *,
        tenant_id: str,
        expected_cas_version: int,
        cutover_at: datetime,
        rollback_cutoff_at: datetime,
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        cutover_time = _naive_utc(cutover_at)
        cutoff = _naive_utc(rollback_cutoff_at)
        if cutoff <= cutover_time:
            raise KnowledgeFSCutoverConflictError("Rollback cutoff must be after cutover")

        # The first short transaction snapshots all gate and activation evidence. It
        # deliberately commits before capability issuance or any remote HTTP call.
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_cutover_ready(repository, ledger, expected_cas_version)
            control_space = self._require_activation_control_space(session, tenant_id=tenant_id)
            activation_request = _activation_request(ledger, control_space_id=control_space.id)

        if self._remote_factory is None:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote activation is not configured")
        try:
            remote = self._remote_factory()
        except RuntimeError as exc:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote activation is not configured") from exc
        if remote is None:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote activation is not configured")
        try:
            raw_ack = remote.activate_dify_workspace_integration(activation_request)
        except KnowledgeFSLifecycleRemoteError as exc:
            raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS remote activation was not acknowledged") from exc
        try:
            ack = (
                raw_ack
                if isinstance(raw_ack, KnowledgeFSDifyIntegrationActivationAck)
                else KnowledgeFSDifyIntegrationActivationAck.model_validate(raw_ack, from_attributes=True)
            )
        except (TypeError, ValueError, ValidationError) as exc:
            raise KnowledgeFSCutoverGateBlockedError(
                "KnowledgeFS remote activation acknowledgement was malformed"
            ) from exc
        _assert_exact_activation_ack(activation_request, ack)
        acknowledged_at = _naive_utc(self._clock())

        # Re-open a transaction only after the exact durable ACK. Re-evaluate every
        # gate and identity, then publish all switches and ACK evidence in one CAS.
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_cutover_ready(repository, ledger, expected_cas_version)
            control_space = self._require_activation_control_space(
                session,
                tenant_id=tenant_id,
                control_space_id=activation_request.control_space_id,
            )
            if _activation_request(ledger, control_space_id=control_space.id) != activation_request:
                raise KnowledgeFSCutoverConflictError(
                    "Cutover activation evidence changed after remote acknowledgement"
                )
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
                    cutover_at=cutover_time,
                    rollback_cutoff_at=cutoff,
                    product_routes_enabled=True,
                    capability_v2_enabled=True,
                    integrated_mode_enabled=True,
                    legacy_acl_read_only=True,
                    clear_smoke_results=True,
                    remote_activation_id=ack.activation_id,
                    remote_activation_revision=ack.activation_revision,
                    remote_activation_digest=ack.source_revision_digest,
                    remote_activation_control_space_id=control_space.id,
                    remote_activation_activated_at=_naive_utc(ack.activated_at),
                    remote_activation_updated_at=_naive_utc(ack.updated_at),
                    remote_activation_acknowledged_at=acknowledged_at,
                    remote_activation_applied=ack.applied,
                    remote_activation_replayed=ack.replayed,
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def record_smoke_results(
        self,
        *,
        tenant_id: str,
        expected_cas_version: int,
        results: CutoverSmokeResultsInput,
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        if str(results.tenant_id) != tenant_id:
            raise KnowledgeFSCutoverConflictError("Smoke evidence belongs to a different Workspace")
        observed_at = _naive_utc(results.observed_at)
        if observed_at > _naive_utc(self._clock()):
            raise KnowledgeFSCutoverConflictError("Smoke evidence timestamp cannot be in the future")
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.CUTOVER, expected_cas_version)
            if ledger.cutover_at is None or observed_at < ledger.cutover_at:
                raise KnowledgeFSCutoverConflictError("Smoke evidence predates Workspace cutover")
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=ledger.phase,
                    smoke_results=results.to_record(),
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def begin_observation(
        self,
        *,
        tenant_id: str,
        expected_cas_version: int,
        started_at: datetime,
        window_ends_at: datetime,
        maximum_task_expires_at: datetime,
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        started = _naive_utc(started_at)
        window_end = _naive_utc(window_ends_at)
        task_expiry = _naive_utc(maximum_task_expires_at)
        if window_end <= started:
            raise KnowledgeFSCutoverConflictError("Observation window must end after it starts")
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.CUTOVER, expected_cas_version)
            if not knowledge_fs_cutover_smoke_results_passed(ledger.smoke_results):
                raise KnowledgeFSCutoverGateBlockedError("All cutover smoke checks must pass before observation")
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=KnowledgeFSWorkspaceCutoverPhase.OBSERVING,
                    observation_started_at=started,
                    observation_window_ends_at=window_end,
                    maximum_task_expires_at=task_expiry,
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def complete_observation(
        self, *, tenant_id: str, expected_cas_version: int, observed_at: datetime
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        observed = _naive_utc(observed_at)
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.OBSERVING, expected_cas_version)
            if (
                ledger.observation_window_ends_at is None
                or observed < ledger.observation_window_ends_at
                or ledger.maximum_task_expires_at is None
                or observed < ledger.maximum_task_expires_at
            ):
                raise KnowledgeFSCutoverGateBlockedError(
                    "Observation window and maximum task TTL must both elapse before cleanup"
                )
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=KnowledgeFSWorkspaceCutoverPhase.READY_FOR_CLEANUP,
                    observation_completed_at=observed,
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def rollback(
        self, *, tenant_id: str, expected_cas_version: int, rolled_back_at: datetime
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        rollback_time = _naive_utc(rolled_back_at)
        now = _naive_utc(self._clock())
        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            if ledger.phase not in {
                KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
                KnowledgeFSWorkspaceCutoverPhase.OBSERVING,
                KnowledgeFSWorkspaceCutoverPhase.READY_FOR_CLEANUP,
            }:
                raise KnowledgeFSCutoverConflictError("Rollback is only available after cutover and before cleanup")
            if ledger.cas_version != expected_cas_version:
                raise KnowledgeFSCutoverConflictError("Cutover ledger version changed")
            if (
                ledger.rollback_cutoff_at is None
                or rollback_time >= ledger.rollback_cutoff_at
                or now >= ledger.rollback_cutoff_at
            ):
                raise KnowledgeFSCutoverGateBlockedError("Rollback cutoff has elapsed")
            if rollback_time > now:
                raise KnowledgeFSCutoverConflictError("Rollback timestamp cannot be in the future")
            if ledger.irreversible_cleanup_at is not None:
                raise KnowledgeFSCutoverGateBlockedError("Irreversible cleanup has already started")
            # Legacy ACL remains read-only: post-cutover rollback is a safe traffic stop,
            # never a return to the stale KnowledgeFS authorization source. Remote
            # activation and its acknowledgement are intentionally immutable here.
            self._cas(
                repository,
                KnowledgeFSCutoverCASUpdate(
                    tenant_id=tenant_id,
                    expected_phase=ledger.phase,
                    expected_cas_version=ledger.cas_version,
                    new_phase=KnowledgeFSWorkspaceCutoverPhase.FROZEN,
                    rolled_back_at=rollback_time,
                    product_routes_enabled=False,
                ),
            )
            return self._require_ledger(repository, tenant_id)

    def status(self, *, tenant_id: str) -> dict[str, object]:
        with self._session_maker() as session:
            repository = SQLAlchemyKnowledgeFSCutoverRepository(session)
            ledger = self._require_ledger(repository, tenant_id)
            issues = repository.list_issues(tenant_id=tenant_id, ledger_id=ledger.id)
            quarantine = repository.list_quarantine(tenant_id=tenant_id, ledger_id=ledger.id)
            shadow_diffs = repository.list_shadow_diffs(tenant_id=tenant_id, ledger_id=ledger.id)
            shadow_observations = repository.list_shadow_observations(tenant_id=tenant_id, ledger_id=ledger.id)
            return {
                "tenant_id": ledger.tenant_id,
                "phase": ledger.phase.value,
                "cas_version": ledger.cas_version,
                "source_revision_watermark": ledger.source_revision_watermark,
                "final_revision_watermark": ledger.final_revision_watermark,
                "applied_revision_watermark": ledger.applied_revision_watermark,
                "source_task_watermark": ledger.source_task_watermark,
                "final_task_watermark": ledger.final_task_watermark,
                "applied_task_watermark": ledger.applied_task_watermark,
                "feature_state": {
                    "product_routes_enabled": ledger.product_routes_enabled,
                    "capability_v2_enabled": ledger.capability_v2_enabled,
                    "integrated_mode_enabled": ledger.integrated_mode_enabled,
                    "legacy_acl_read_only": ledger.legacy_acl_read_only,
                },
                "smoke_results": ledger.smoke_results,
                "legacy_dependency_report": ledger.legacy_dependency_report,
                "legacy_dependency_ready": ledger.legacy_dependency_ready,
                "shadow_started_at": _iso(ledger.shadow_started_at),
                "shadow_completed_at": _iso(ledger.shadow_completed_at),
                "shadow_evidence_digest": ledger.shadow_evidence_digest,
                "shadow_observation_count": ledger.shadow_observation_count,
                "shadow_window_started_at": _iso(ledger.shadow_window_started_at),
                "shadow_window_ended_at": _iso(ledger.shadow_window_ended_at),
                "shadow_traffic_zero": ledger.shadow_traffic_zero,
                "shadow_traffic_zero_evidence": ledger.shadow_traffic_zero_evidence,
                "shadow_latest_observed_revision": ledger.shadow_latest_observed_revision,
                "shadow_producer": ledger.shadow_producer,
                "shadow_completed_by_operator": ledger.shadow_completed_by_operator,
                "shadow_completed_by_account_id": ledger.shadow_completed_by_account_id,
                "remote_freeze_id": ledger.remote_freeze_id,
                "remote_freeze_revision": ledger.remote_freeze_revision,
                "remote_freeze_digest": ledger.remote_freeze_digest,
                "remote_freeze_task_watermark": ledger.remote_freeze_task_watermark,
                "remote_freeze_control_space_id": ledger.remote_freeze_control_space_id,
                "remote_freeze_frozen_at": _iso(ledger.remote_freeze_frozen_at),
                "remote_freeze_updated_at": _iso(ledger.remote_freeze_updated_at),
                "remote_freeze_acknowledged_at": _iso(ledger.remote_freeze_acknowledged_at),
                "remote_freeze_applied": ledger.remote_freeze_applied,
                "remote_freeze_replayed": ledger.remote_freeze_replayed,
                "remote_activation_id": ledger.remote_activation_id,
                "remote_activation_revision": ledger.remote_activation_revision,
                "remote_activation_digest": ledger.remote_activation_digest,
                "remote_activation_control_space_id": ledger.remote_activation_control_space_id,
                "remote_activation_activated_at": _iso(ledger.remote_activation_activated_at),
                "remote_activation_updated_at": _iso(ledger.remote_activation_updated_at),
                "remote_activation_acknowledged_at": _iso(ledger.remote_activation_acknowledged_at),
                "remote_activation_applied": ledger.remote_activation_applied,
                "remote_activation_replayed": ledger.remote_activation_replayed,
                "open_issues": sum(issue.status is KnowledgeFSMigrationIssueStatus.OPEN for issue in issues),
                "open_shadow_diffs": sum(diff.status is KnowledgeFSMigrationIssueStatus.OPEN for diff in shadow_diffs),
                "quarantine_count": len(quarantine),
                "unresolved_cutover_quarantine": sum(
                    item.source_kind in _CUTOVER_QUARANTINE_KINDS
                    and item.disposition is not KnowledgeFSMigrationQuarantineDisposition.RESOLVED
                    for item in quarantine
                ),
                "issues": [
                    {
                        "issue_key": issue.issue_key,
                        "kind": issue.kind.value,
                        "status": issue.status.value,
                        "resource_type": issue.resource_type,
                        "resource_id": issue.resource_id,
                        "details": issue.details,
                        "approved_by_account_id": issue.approved_by_account_id,
                        "approved_at": _iso(issue.approved_at),
                        "resolved_by_account_id": issue.resolved_by_account_id,
                        "resolved_at": _iso(issue.resolved_at),
                    }
                    for issue in issues
                ],
                "quarantine": [
                    {
                        "source_kind": item.source_kind.value,
                        "source_id": item.source_id,
                        "reason_code": item.reason_code,
                        "disposition": item.disposition.value,
                        "details": item.details,
                        "resolved_by_operator": item.resolved_by_operator,
                        "resolved_by_account_id": item.resolved_by_account_id,
                        "evidence": item.evidence,
                        "resolved_at": _iso(item.resolved_at),
                        "row_version": item.row_version,
                    }
                    for item in quarantine
                ],
                "shadow_diffs": [
                    {
                        "diff_key": diff.diff_key,
                        "control_space_id": diff.control_space_id,
                        "principal": diff.principal,
                        "legacy_allowed": diff.legacy_allowed,
                        "dify_allowed": diff.dify_allowed,
                        "decision": diff.decision.value,
                        "reason": diff.reason,
                        "observed_revision": diff.observed_revision,
                        "status": diff.status.value,
                        "approved_by_account_id": diff.approved_by_account_id,
                        "approved_at": _iso(diff.approved_at),
                        "resolved_by_account_id": diff.resolved_by_account_id,
                        "resolved_at": _iso(diff.resolved_at),
                        "current_evidence_digest": diff.current_evidence_digest,
                        "last_observed_at": _iso(diff.last_observed_at),
                        "row_version": diff.row_version,
                    }
                    for diff in shadow_diffs
                ],
                "shadow_observations": [
                    {
                        "diff_key": item.diff_key,
                        "producer": item.producer,
                        "control_space_id": item.control_space_id,
                        "principal": item.principal,
                        "legacy_allowed": item.legacy_allowed,
                        "dify_allowed": item.dify_allowed,
                        "decision": item.decision.value,
                        "reason": item.reason,
                        "observed_revision": item.observed_revision,
                        "observed_at": _iso(item.observed_at),
                        "evidence_digest": item.evidence_digest,
                    }
                    for item in shadow_observations
                ],
                "freeze_at": _iso(ledger.freeze_at),
                "cutover_at": _iso(ledger.cutover_at),
                "rolled_back_at": _iso(ledger.rolled_back_at),
                "rollback_cutoff_at": _iso(ledger.rollback_cutoff_at),
                "observation_started_at": _iso(ledger.observation_started_at),
                "observation_window_ends_at": _iso(ledger.observation_window_ends_at),
                "maximum_task_expires_at": _iso(ledger.maximum_task_expires_at),
                "observation_completed_at": _iso(ledger.observation_completed_at),
                "legacy_dependency_checked_at": _iso(ledger.legacy_dependency_checked_at),
                "irreversible_cleanup_at": _iso(ledger.irreversible_cleanup_at),
            }

    @staticmethod
    def _task_disposition_counts(spaces: Iterable[LegacySpaceInventoryInput]) -> dict[str, int]:
        counts = {disposition.value: 0 for disposition in KnowledgeFSMigrationQuarantineDisposition}
        for space in spaces:
            for task in space.tasks:
                counts[_classify_task(task).value] += 1
        return {key: value for key, value in counts.items() if value > 0}

    @staticmethod
    def _assert_unique_inventory(spaces: Iterable[LegacySpaceInventoryInput]) -> None:
        knowledge_space_ids: set[UUID] = set()
        provisioning_keys: set[str] = set()
        for space in spaces:
            if space.knowledge_space_id in knowledge_space_ids:
                raise KnowledgeFSCutoverConflictError("Inventory contains a duplicate KnowledgeFS Space ID")
            if space.provisioning_key in provisioning_keys:
                raise KnowledgeFSCutoverConflictError("Inventory contains a duplicate provisioning key")
            knowledge_space_ids.add(space.knowledge_space_id)
            provisioning_keys.add(space.provisioning_key)
            resolved_permissions: set[UUID] = set()
            for permission in space.permissions:
                if permission.account_id is None:
                    continue
                if permission.account_id in resolved_permissions:
                    raise KnowledgeFSCutoverConflictError("Inventory contains duplicate resolved permission subjects")
                if permission.account_id == space.owner_account_id and permission.role != "owner":
                    raise KnowledgeFSCutoverConflictError("Inventory cannot downgrade the registered owner")
                resolved_permissions.add(permission.account_id)

    @staticmethod
    def _project_backfill(payload: WorkspaceInventoryInput) -> CutoverBackfillReport:
        registered = sum(space.owner_account_id is not None for space in payload.spaces)
        granted = sum(
            (1 if space.owner_account_id is not None else 0)
            + sum(permission.account_id is not None for permission in space.permissions)
            for space in payload.spaces
        )
        quarantined = sum(
            (space.owner_account_id is None)
            + sum(permission.account_id is None for permission in space.permissions)
            + len(space.legacy_api_keys)
            + sum(
                _classify_task(task) is not KnowledgeFSMigrationQuarantineDisposition.MIGRATABLE for task in space.tasks
            )
            + len(space.orphan_resource_ids)
            for space in payload.spaces
        )
        open_issues = sum(
            (space.owner_account_id is None)
            + sum(permission.account_id is None for permission in space.permissions)
            + (space.external_access_enabled is None or space.visibility == "unknown")
            for space in payload.spaces
        )
        return CutoverBackfillReport(
            str(payload.tenant_id),
            registered,
            granted,
            quarantined,
            open_issues,
            KnowledgeFSWorkspaceCutoverPhase.INVENTORY.value,
            False,
        )

    def _backfill_space(
        self,
        session: Session,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        space: LegacySpaceInventoryInput,
        revision_watermark: KnowledgeFSCutoverRevisionWatermark,
    ) -> tuple[int, int, int]:
        knowledge_space_id = str(space.knowledge_space_id)
        quarantined = self._backfill_auxiliary_inventory(repository, ledger, space, knowledge_space_id)
        if space.owner_account_id is None:
            self._ensure_issue(
                repository,
                ledger,
                issue_key=f"owner:{knowledge_space_id}",
                kind=KnowledgeFSMigrationIssueKind.UNRESOLVED_SUBJECT,
                resource_type="knowledge_space",
                resource_id=knowledge_space_id,
                details={"subject_id": space.owner_subject_id},
            )
            self._ensure_quarantine(
                repository,
                ledger,
                source_kind=KnowledgeFSMigrationQuarantineKind.CONTROL_SPACE,
                source_id=knowledge_space_id,
                reason_code="UNRESOLVED_OWNER",
                disposition=KnowledgeFSMigrationQuarantineDisposition.PENDING,
                details={"subject_id": space.owner_subject_id},
            )
            return 0, 0, quarantined + 1
        tenant_id = ledger.tenant_id
        owner_account_id = str(space.owner_account_id)
        existing = session.scalar(
            sa.select(KnowledgeFSControlSpace).where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                (KnowledgeFSControlSpace.knowledge_space_id == knowledge_space_id)
                | (KnowledgeFSControlSpace.provisioning_key == space.provisioning_key),
            )
        )
        registered = 0
        if existing is not None and (
            existing.knowledge_space_id != knowledge_space_id
            or existing.provisioning_key != space.provisioning_key
            or existing.owner_account_id != owner_account_id
        ):
            self._ensure_issue(
                repository,
                ledger,
                issue_key=f"registration:{knowledge_space_id}",
                kind=KnowledgeFSMigrationIssueKind.REGISTRATION_CONFLICT,
                resource_type="knowledge_space",
                resource_id=knowledge_space_id,
                details={"provisioning_key": space.provisioning_key},
            )
            return 0, 0, quarantined
        visibility = _VISIBILITY_MAP.get(space.visibility, KnowledgeFSControlSpaceVisibility.ONLY_ME)
        if existing is None:
            existing = KnowledgeFSControlSpace(
                tenant_id=tenant_id,
                owner_account_id=owner_account_id,
                provisioning_key=space.provisioning_key,
                knowledge_space_id=knowledge_space_id,
                knowledge_space_revision=space.knowledge_space_revision,
                visibility=visibility,
                state=KnowledgeFSControlSpaceState.ACTIVE,
                lifecycle_operation_id="migration-backfill",
            )
            session.add(existing)
            session.flush()
            registered = 1
        elif existing.knowledge_space_revision > space.knowledge_space_revision:
            self._ensure_issue(
                repository,
                ledger,
                issue_key=f"revision-drift:{knowledge_space_id}",
                kind=KnowledgeFSMigrationIssueKind.REVISION_DRIFT,
                resource_type="knowledge_space",
                resource_id=knowledge_space_id,
                details={
                    "existing_revision": existing.knowledge_space_revision,
                    "inventory_revision": space.knowledge_space_revision,
                },
            )
            return registered, 0, quarantined
        else:
            if (
                existing.knowledge_space_revision != space.knowledge_space_revision
                or existing.visibility is not visibility
            ):
                existing.resource_version += 1
            existing.knowledge_space_revision = space.knowledge_space_revision
            existing.visibility = visibility
        revision = session.scalar(
            sa.select(KnowledgeFSAuthorizationRevision).where(
                KnowledgeFSAuthorizationRevision.tenant_id == tenant_id,
                KnowledgeFSAuthorizationRevision.control_space_id == existing.id,
            )
        )
        if revision is None:
            revision = KnowledgeFSAuthorizationRevision(
                tenant_id=tenant_id,
                control_space_id=existing.id,
            )
            session.add(revision)
        revision.membership_epoch = revision_watermark["membership_epoch"]
        revision.space_acl_epoch = revision_watermark["space_acl_epoch"]
        revision.external_access_epoch = revision_watermark["external_access_epoch"]
        revision.content_policy_revision = revision_watermark["content_policy_revision"]
        granted = self._ensure_permission(
            session,
            tenant_id=tenant_id,
            control_space=existing,
            account_id=owner_account_id,
            role=KnowledgeFSControlSpacePermissionRole.OWNER,
        )
        for permission in space.permissions:
            if permission.account_id is None:
                continue
            granted += self._ensure_permission(
                session,
                tenant_id=tenant_id,
                control_space=existing,
                account_id=str(permission.account_id),
                role=KnowledgeFSControlSpacePermissionRole(permission.role),
            )
        external_enabled = space.external_access_enabled is True
        external = session.scalar(
            sa.select(KnowledgeFSExternalAccessPolicy).where(
                KnowledgeFSExternalAccessPolicy.tenant_id == tenant_id,
                KnowledgeFSExternalAccessPolicy.control_space_id == existing.id,
            )
        )
        if external is None:
            external = KnowledgeFSExternalAccessPolicy(
                tenant_id=tenant_id,
                control_space_id=existing.id,
            )
            session.add(external)
        elif any(
            (
                external.service_api_enabled != external_enabled,
                external.agent_enabled != external_enabled,
                external.workflow_enabled != external_enabled,
                external.mcp_enabled,
            )
        ):
            external.revision += 1
        external.service_api_enabled = external_enabled
        external.agent_enabled = external_enabled
        external.workflow_enabled = external_enabled
        external.mcp_enabled = False
        return registered, granted, quarantined

    def _backfill_auxiliary_inventory(
        self,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        space: LegacySpaceInventoryInput,
        knowledge_space_id: str,
    ) -> int:
        quarantined = 0
        visibility = _VISIBILITY_MAP.get(space.visibility, KnowledgeFSControlSpaceVisibility.ONLY_ME)
        for permission in space.permissions:
            if permission.account_id is not None:
                continue
            self._ensure_issue(
                repository,
                ledger,
                issue_key=f"subject:{knowledge_space_id}:{permission.subject_id}",
                kind=KnowledgeFSMigrationIssueKind.UNRESOLVED_SUBJECT,
                resource_type="subject",
                resource_id=permission.subject_id,
                details={"knowledge_space_id": knowledge_space_id},
            )
            self._ensure_quarantine(
                repository,
                ledger,
                source_kind=KnowledgeFSMigrationQuarantineKind.SUBJECT,
                source_id=f"{knowledge_space_id}:{permission.subject_id}",
                reason_code="UNRESOLVED_SUBJECT",
                disposition=KnowledgeFSMigrationQuarantineDisposition.ISOLATE,
                details={"role": permission.role},
            )
            quarantined += 1
        if space.external_access_enabled is None or space.visibility == "unknown":
            self._ensure_issue(
                repository,
                ledger,
                issue_key=f"unknown-access:{knowledge_space_id}",
                kind=KnowledgeFSMigrationIssueKind.UNKNOWN_EXTERNAL_ACCESS,
                resource_type="knowledge_space",
                resource_id=knowledge_space_id,
                details={"effective_external_access": False, "effective_visibility": visibility.value},
            )
        for legacy_key in space.legacy_api_keys:
            self._ensure_quarantine(
                repository,
                ledger,
                source_kind=KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY,
                source_id=legacy_key.key_id,
                reason_code="ROTATION_REQUIRED",
                disposition=KnowledgeFSMigrationQuarantineDisposition.ROTATE_CREDENTIAL,
                details={
                    "knowledge_space_id": knowledge_space_id,
                    "prefix": legacy_key.prefix,
                    "last4": legacy_key.last4,
                },
            )
            quarantined += 1
        for task in space.tasks:
            disposition = _classify_task(task)
            self._ensure_quarantine(
                repository,
                ledger,
                source_kind=KnowledgeFSMigrationQuarantineKind.TASK,
                source_id=task.task_id,
                reason_code="LEGACY_TASK_CLASSIFICATION",
                disposition=disposition,
                details={
                    "knowledge_space_id": knowledge_space_id,
                    "state": task.state,
                    "subject_id": task.subject_id,
                    "account_id": str(task.account_id) if task.account_id else None,
                    "expires_at": task.expires_at.isoformat() if task.expires_at else None,
                },
            )
            quarantined += disposition is not KnowledgeFSMigrationQuarantineDisposition.MIGRATABLE
        for orphan_id in space.orphan_resource_ids:
            self._ensure_quarantine(
                repository,
                ledger,
                source_kind=KnowledgeFSMigrationQuarantineKind.ORPHAN_RESOURCE,
                source_id=orphan_id,
                reason_code="ORPHAN_RESOURCE",
                disposition=KnowledgeFSMigrationQuarantineDisposition.PENDING,
                details={"knowledge_space_id": knowledge_space_id},
            )
            quarantined += 1
        return quarantined

    @staticmethod
    def _ensure_permission(
        session: Session,
        *,
        tenant_id: str,
        control_space: KnowledgeFSControlSpace,
        account_id: str,
        role: KnowledgeFSControlSpacePermissionRole,
    ) -> int:
        existing = session.scalar(
            sa.select(KnowledgeFSControlSpacePermission).where(
                KnowledgeFSControlSpacePermission.tenant_id == tenant_id,
                KnowledgeFSControlSpacePermission.control_space_id == control_space.id,
                KnowledgeFSControlSpacePermission.account_id == account_id,
            )
        )
        if existing is not None:
            if existing.role is not role:
                existing.role = role
                existing.revision += 1
            return 0
        session.add(
            KnowledgeFSControlSpacePermission(
                tenant_id=tenant_id,
                control_space_id=control_space.id,
                account_id=account_id,
                role=role,
                granted_by_account_id=control_space.owner_account_id,
            )
        )
        return 1

    @staticmethod
    def _ensure_issue(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        *,
        issue_key: str,
        kind: KnowledgeFSMigrationIssueKind,
        resource_type: str,
        resource_id: str,
        details: dict[str, object],
    ) -> None:
        if repository.get_issue(tenant_id=ledger.tenant_id, ledger_id=ledger.id, issue_key=issue_key) is None:
            repository.add_issue(
                KnowledgeFSMigrationIssue(
                    tenant_id=ledger.tenant_id,
                    ledger_id=ledger.id,
                    issue_key=issue_key,
                    kind=kind,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    details=details,
                )
            )

    @staticmethod
    def _ensure_quarantine(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        *,
        source_kind: KnowledgeFSMigrationQuarantineKind,
        source_id: str,
        reason_code: str,
        disposition: KnowledgeFSMigrationQuarantineDisposition,
        details: dict[str, object],
    ) -> None:
        if (
            repository.get_quarantine(
                tenant_id=ledger.tenant_id,
                ledger_id=ledger.id,
                source_kind=source_kind,
                source_id=source_id,
            )
            is None
        ):
            repository.add_quarantine(
                KnowledgeFSMigrationQuarantine(
                    tenant_id=ledger.tenant_id,
                    ledger_id=ledger.id,
                    source_kind=source_kind,
                    source_id=source_id,
                    reason_code=reason_code,
                    disposition=disposition,
                    details=details,
                )
            )

    def _validate_shadow_observation(
        self,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        item: ShadowAuthorizationObservationInput,
    ) -> None:
        if item.producer not in self._trusted_shadow_producers:
            raise KnowledgeFSCutoverGateBlockedError("Shadow observation producer is not trusted")
        if ledger.shadow_started_at is None:
            raise KnowledgeFSCutoverGateBlockedError("Shadow start evidence is missing")
        observed_at = _naive_utc(item.observed_at)
        if observed_at > _naive_utc(self._clock()):
            raise KnowledgeFSCutoverConflictError("Shadow observation timestamp cannot be in the future")
        if observed_at < ledger.shadow_started_at:
            raise KnowledgeFSCutoverConflictError("Shadow observation predates shadow start")
        required_revision = ledger.final_revision_watermark or ledger.source_revision_watermark
        if not _watermark_at_least(item.observed_revision.to_record(), required_revision):
            raise KnowledgeFSCutoverConflictError("Shadow observation revision is stale")

    @staticmethod
    def _record_shadow_observation(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        item: ShadowAuthorizationObservationInput,
        decision: KnowledgeFSShadowAuthorizationDecision,
        *,
        apply: bool,
    ) -> bool:
        evidence_digest = _shadow_observation_digest(item)
        replay = repository.get_shadow_observation(
            tenant_id=ledger.tenant_id,
            ledger_id=ledger.id,
            diff_key=item.diff_key,
            evidence_digest=evidence_digest,
        )
        if replay is not None:
            return True
        if ledger.shadow_completed_at is not None:
            raise KnowledgeFSCutoverConflictError("Shadow evidence is already complete")
        existing = repository.get_shadow_diff(
            tenant_id=ledger.tenant_id,
            ledger_id=ledger.id,
            diff_key=item.diff_key,
        )
        dify_allowed = False if item.legacy_allowed is None else item.dify_allowed
        if existing is not None:
            safe_reevaluation = (
                existing.decision
                in {
                    KnowledgeFSShadowAuthorizationDecision.EXPANDED,
                    KnowledgeFSShadowAuthorizationDecision.UNKNOWN,
                }
                and decision
                in {
                    KnowledgeFSShadowAuthorizationDecision.MATCH,
                    KnowledgeFSShadowAuthorizationDecision.TIGHTENED,
                }
                and _watermark_at_least(item.observed_revision.to_record(), existing.observed_revision)
            )
            if not safe_reevaluation:
                raise KnowledgeFSCutoverConflictError("Shadow diff key was reused with different evidence")
            if not apply:
                return False
            repository.add_shadow_observation(
                _shadow_observation_model(ledger=ledger, item=item, decision=decision, digest=evidence_digest)
            )
            changed = repository.reevaluate_shadow_diff(
                KnowledgeFSShadowDiffCASUpdate(
                    tenant_id=ledger.tenant_id,
                    ledger_id=ledger.id,
                    diff_key=item.diff_key,
                    expected_row_version=existing.row_version,
                    control_space_id=str(item.control_space_id) if item.control_space_id else None,
                    principal=item.principal,
                    legacy_allowed=item.legacy_allowed,
                    dify_allowed=dify_allowed,
                    decision=decision,
                    reason=item.reason,
                    observed_revision=item.observed_revision.to_record(),
                    status=KnowledgeFSMigrationIssueStatus.RESOLVED,
                    current_evidence_digest=evidence_digest,
                    last_observed_at=_naive_utc(item.observed_at),
                )
            )
            if not changed:
                raise KnowledgeFSCutoverConflictError("Shadow diff changed during re-evaluation")
            return False
        if not apply:
            return False
        repository.add_shadow_observation(
            _shadow_observation_model(ledger=ledger, item=item, decision=decision, digest=evidence_digest)
        )
        repository.add_shadow_diff(
            KnowledgeFSShadowAuthorizationDiff(
                tenant_id=ledger.tenant_id,
                ledger_id=ledger.id,
                diff_key=item.diff_key,
                control_space_id=str(item.control_space_id) if item.control_space_id else None,
                principal=item.principal,
                legacy_allowed=item.legacy_allowed,
                dify_allowed=dify_allowed,
                decision=decision,
                reason=item.reason,
                observed_revision=item.observed_revision.to_record(),
                current_evidence_digest=evidence_digest,
                last_observed_at=_naive_utc(item.observed_at),
                status=(
                    KnowledgeFSMigrationIssueStatus.RESOLVED
                    if decision is KnowledgeFSShadowAuthorizationDecision.MATCH
                    else KnowledgeFSMigrationIssueStatus.OPEN
                ),
            )
        )
        return False

    def _assert_shadow_completion_replay(
        self,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        payload: ShadowCompletionInput,
        report: ShadowCompletionReport,
    ) -> None:
        evidence = (
            cast(dict[str, object], payload.traffic_zero_evidence)
            if payload.traffic_zero_evidence is not None
            else None
        )
        if (
            ledger.shadow_completed_at != _naive_utc(payload.completed_at)
            or ledger.shadow_evidence_digest != report.evidence_digest
            or ledger.shadow_observation_count != report.observation_count
            or ledger.shadow_traffic_zero is not payload.traffic_zero
            or ledger.shadow_traffic_zero_evidence != evidence
            or ledger.shadow_latest_observed_revision != report.latest_observed_revision
            or ledger.shadow_producer != payload.producer
            or ledger.shadow_completed_by_operator != payload.completed_by_operator
            or ledger.shadow_completed_by_account_id != str(payload.completed_by_account_id)
            or ledger.shadow_window_started_at
            != (_naive_utc(payload.window_started_at) if payload.window_started_at is not None else None)
            or ledger.shadow_window_ended_at
            != (_naive_utc(payload.window_ended_at) if payload.window_ended_at is not None else None)
        ):
            raise KnowledgeFSCutoverConflictError("Shadow was already completed with different evidence")

    @staticmethod
    def _shadow_decision(item: ShadowAuthorizationObservationInput) -> KnowledgeFSShadowAuthorizationDecision:
        if item.legacy_allowed is None:
            return KnowledgeFSShadowAuthorizationDecision.UNKNOWN
        if item.legacy_allowed == item.dify_allowed:
            return KnowledgeFSShadowAuthorizationDecision.MATCH
        if item.legacy_allowed and not item.dify_allowed:
            return KnowledgeFSShadowAuthorizationDecision.TIGHTENED
        return KnowledgeFSShadowAuthorizationDecision.EXPANDED

    @staticmethod
    def _require_ledger(
        repository: SQLAlchemyKnowledgeFSCutoverRepository, tenant_id: str
    ) -> KnowledgeFSWorkspaceCutoverLedger:
        ledger = repository.get_ledger(tenant_id=tenant_id)
        if ledger is None:
            raise KnowledgeFSCutoverNotFoundError("Workspace cutover ledger was not found")
        return ledger

    @staticmethod
    def _assert_phase(
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        expected_phase: KnowledgeFSWorkspaceCutoverPhase,
        expected_cas_version: int,
    ) -> None:
        if ledger.phase is not expected_phase:
            raise KnowledgeFSCutoverConflictError(
                f"Expected cutover phase {expected_phase.value}, found {ledger.phase.value}"
            )
        if ledger.cas_version != expected_cas_version:
            raise KnowledgeFSCutoverConflictError("Cutover ledger version changed")

    @staticmethod
    def _assert_no_open_gates(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
    ) -> None:
        if repository.count_open_issues(tenant_id=ledger.tenant_id, ledger_id=ledger.id) > 0:
            raise KnowledgeFSCutoverGateBlockedError("Open migration issues block phase advancement")
        if repository.count_unapproved_shadow_diffs(tenant_id=ledger.tenant_id, ledger_id=ledger.id) > 0:
            raise KnowledgeFSCutoverGateBlockedError("Unapproved shadow differences block phase advancement")

    def _assert_shadow_evidence_complete(
        self,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        *,
        required_revision: KnowledgeFSCutoverRevisionWatermark | None = None,
    ) -> None:
        if (
            ledger.shadow_started_at is None
            or ledger.shadow_completed_at is None
            or ledger.shadow_evidence_digest is None
            or ledger.shadow_producer not in self._trusted_shadow_producers
            or ledger.shadow_completed_by_operator not in self._trusted_shadow_operators
            or ledger.shadow_completed_by_account_id is None
        ):
            raise KnowledgeFSCutoverGateBlockedError("Shadow evidence is not complete and trusted")
        if ledger.shadow_traffic_zero:
            if ledger.shadow_observation_count != 0 or ledger.shadow_traffic_zero_evidence is None:
                raise KnowledgeFSCutoverGateBlockedError("Traffic-zero shadow evidence is incomplete")
            return
        if (
            ledger.shadow_observation_count <= 0
            or ledger.shadow_window_started_at is None
            or ledger.shadow_window_ended_at is None
            or ledger.shadow_latest_observed_revision is None
        ):
            raise KnowledgeFSCutoverGateBlockedError("Shadow observation evidence is incomplete")
        applicable_revision = required_revision or ledger.final_revision_watermark or ledger.source_revision_watermark
        if not _watermark_at_least(ledger.shadow_latest_observed_revision, applicable_revision):
            raise KnowledgeFSCutoverGateBlockedError(
                "Shadow latest observed revision is below the applicable cutover watermark"
            )

    def _assert_cutover_ready(
        self,
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
        expected_cas_version: int,
    ) -> None:
        self._assert_phase(ledger, KnowledgeFSWorkspaceCutoverPhase.FROZEN, expected_cas_version)
        # Final delta is applied only after freeze. Revalidation therefore uses the
        # source watermark that was applicable to the frozen shadow gate.
        self._assert_shadow_evidence_complete(ledger, required_revision=ledger.source_revision_watermark)
        self._assert_no_open_gates(repository, ledger)
        self._assert_no_unresolved_quarantine(repository, ledger)
        if ledger.freeze_at is None:
            raise KnowledgeFSCutoverGateBlockedError("Workspace freeze evidence is missing")
        _assert_remote_freeze_evidence(ledger)
        if not ledger.legacy_dependency_ready or ledger.legacy_dependency_checked_at is None:
            raise KnowledgeFSCutoverGateBlockedError("Legacy snapshot/FK dependency dashboard is not ready")
        if (
            ledger.final_revision_watermark is None
            or ledger.final_revision_watermark != ledger.applied_revision_watermark
            or ledger.final_task_watermark is None
            or ledger.final_task_watermark != ledger.applied_task_watermark
        ):
            raise KnowledgeFSCutoverGateBlockedError("Final delta watermarks are not fully applied")

    @staticmethod
    def _require_activation_control_space(
        session: Session,
        *,
        tenant_id: str,
        control_space_id: str | None = None,
    ) -> KnowledgeFSControlSpace:
        statement = sa.select(KnowledgeFSControlSpace).where(
            KnowledgeFSControlSpace.tenant_id == tenant_id,
            KnowledgeFSControlSpace.state == KnowledgeFSControlSpaceState.ACTIVE,
            KnowledgeFSControlSpace.knowledge_space_id.is_not(None),
        )
        if control_space_id is not None:
            statement = statement.where(KnowledgeFSControlSpace.id == control_space_id)
        control_space = session.scalar(
            statement.order_by(KnowledgeFSControlSpace.created_at, KnowledgeFSControlSpace.id).limit(1)
        )
        if control_space is None:
            raise KnowledgeFSCutoverGateBlockedError(
                "A tenant-owned active control-space is required for activation audit"
            )
        return control_space

    @staticmethod
    def _assert_no_unresolved_quarantine(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        ledger: KnowledgeFSWorkspaceCutoverLedger,
    ) -> None:
        if (
            repository.count_unresolved_quarantine(
                tenant_id=ledger.tenant_id,
                ledger_id=ledger.id,
                source_kinds=_CUTOVER_QUARANTINE_KINDS,
            )
            > 0
        ):
            raise KnowledgeFSCutoverGateBlockedError("Unresolved migration quarantine blocks freeze and cutover")

    @staticmethod
    def _cas(
        repository: SQLAlchemyKnowledgeFSCutoverRepository,
        update: KnowledgeFSCutoverCASUpdate,
    ) -> None:
        if not repository.compare_and_set(update):
            raise KnowledgeFSCutoverConflictError("Cutover ledger changed during transition")


def _classify_task(task: LegacyTaskInventoryInput) -> KnowledgeFSMigrationQuarantineDisposition:
    if task.subject_id is None or task.subject_id.startswith("dify-workspace:") or task.account_id is None:
        return KnowledgeFSMigrationQuarantineDisposition.ISOLATE
    if task.state in {"running", "paused"}:
        return KnowledgeFSMigrationQuarantineDisposition.WAIT_FOR_COMPLETION
    if task.state == "queued":
        return KnowledgeFSMigrationQuarantineDisposition.MIGRATABLE
    if task.state in {"completed", "failed", "canceled"}:
        return KnowledgeFSMigrationQuarantineDisposition.CANCEL
    return KnowledgeFSMigrationQuarantineDisposition.CANCEL


def _shadow_observation_digest(item: ShadowAuthorizationObservationInput) -> str:
    canonical = json.dumps(
        item.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _shadow_observation_model(
    *,
    ledger: KnowledgeFSWorkspaceCutoverLedger,
    item: ShadowAuthorizationObservationInput,
    decision: KnowledgeFSShadowAuthorizationDecision,
    digest: str,
) -> KnowledgeFSShadowAuthorizationObservation:
    return KnowledgeFSShadowAuthorizationObservation(
        tenant_id=ledger.tenant_id,
        ledger_id=ledger.id,
        diff_key=item.diff_key,
        producer=item.producer,
        control_space_id=str(item.control_space_id) if item.control_space_id else None,
        principal=item.principal,
        legacy_allowed=item.legacy_allowed,
        dify_allowed=False if item.legacy_allowed is None else item.dify_allowed,
        decision=decision,
        reason=item.reason,
        observed_revision=item.observed_revision.to_record(),
        observed_at=_naive_utc(item.observed_at),
        evidence_digest=digest,
    )


def _shadow_observation_set_digest(
    observations: Iterable[KnowledgeFSShadowAuthorizationObservation],
) -> str:
    canonical = "\n".join(sorted(item.evidence_digest for item in observations)).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _shadow_traffic_zero_digest(payload: ShadowCompletionInput) -> str:
    canonical = json.dumps(
        {
            "completed_at": payload.completed_at.isoformat(),
            "completed_by_account_id": str(payload.completed_by_account_id),
            "completed_by_operator": payload.completed_by_operator,
            "producer": payload.producer,
            "traffic_zero_evidence": payload.traffic_zero_evidence,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _revision_digest(revision: KnowledgeFSCutoverRevisionWatermark) -> str:
    canonical = json.dumps(revision, sort_keys=True, separators=(",", ":")).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _canonical_freeze_id(
    *,
    freeze_revision: int,
    namespace_id: str,
    source_revision_digest: str,
    source_task_watermark: int,
) -> str:
    canonical = json.dumps(
        {
            "freezeRevision": freeze_revision,
            "namespaceId": namespace_id,
            "sourceRevisionDigest": source_revision_digest,
            "sourceTaskWatermark": source_task_watermark,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _freeze_request(
    ledger: KnowledgeFSWorkspaceCutoverLedger,
    *,
    control_space_id: str,
) -> KnowledgeFSDifyIntegrationFreezeRequest:
    freeze_revision = max(ledger.cas_version + 1, (ledger.remote_freeze_revision or 0) + 1)
    source_revision_digest = _revision_digest(ledger.source_revision_watermark)
    freeze_id = _canonical_freeze_id(
        freeze_revision=freeze_revision,
        namespace_id=ledger.tenant_id,
        source_revision_digest=source_revision_digest,
        source_task_watermark=ledger.source_task_watermark,
    )
    return KnowledgeFSDifyIntegrationFreezeRequest(
        namespace_id=ledger.tenant_id,
        control_space_id=control_space_id,
        freeze_id=freeze_id,
        freeze_revision=freeze_revision,
        source_revision_digest=source_revision_digest,
        source_task_watermark=ledger.source_task_watermark,
    )


def _assert_exact_freeze_ack(
    request: KnowledgeFSDifyIntegrationFreezeRequest,
    ack: KnowledgeFSDifyIntegrationFreezeAck,
) -> None:
    if (
        ack.namespace_id != request.namespace_id
        or ack.freeze_id != request.freeze_id
        or ack.freeze_revision != request.freeze_revision
        or ack.source_revision_digest != request.source_revision_digest
        or ack.source_task_watermark != request.source_task_watermark
    ):
        raise KnowledgeFSCutoverGateBlockedError(
            "KnowledgeFS remote freeze acknowledgement did not exactly match the request"
        )


def _assert_remote_freeze_evidence(ledger: KnowledgeFSWorkspaceCutoverLedger) -> None:
    fields = (
        ledger.remote_freeze_id,
        ledger.remote_freeze_revision,
        ledger.remote_freeze_digest,
        ledger.remote_freeze_task_watermark,
        ledger.remote_freeze_control_space_id,
        ledger.remote_freeze_frozen_at,
        ledger.remote_freeze_updated_at,
        ledger.remote_freeze_acknowledged_at,
        ledger.remote_freeze_applied,
        ledger.remote_freeze_replayed,
    )
    if any(value is None for value in fields):
        raise KnowledgeFSCutoverGateBlockedError("Remote Workspace freeze evidence is incomplete")
    freeze_revision = cast(int, ledger.remote_freeze_revision)
    digest = cast(str, ledger.remote_freeze_digest)
    task_watermark = cast(int, ledger.remote_freeze_task_watermark)
    if (
        digest != _revision_digest(ledger.source_revision_watermark)
        or task_watermark != ledger.source_task_watermark
        or ledger.remote_freeze_id
        != _canonical_freeze_id(
            freeze_revision=freeze_revision,
            namespace_id=ledger.tenant_id,
            source_revision_digest=digest,
            source_task_watermark=task_watermark,
        )
        or ledger.remote_freeze_applied is ledger.remote_freeze_replayed
    ):
        raise KnowledgeFSCutoverGateBlockedError("Remote Workspace freeze evidence is inconsistent")


def _activation_request(
    ledger: KnowledgeFSWorkspaceCutoverLedger,
    *,
    control_space_id: str,
) -> KnowledgeFSDifyIntegrationActivationRequest:
    final_revision = ledger.final_revision_watermark
    final_task_watermark = ledger.final_task_watermark
    if final_revision is None or final_task_watermark is None:
        raise KnowledgeFSCutoverGateBlockedError("Final delta evidence is missing")
    digest = _activation_source_revision_digest(final_revision, final_task_watermark)
    activation_revision = max(
        ledger.cas_version + 1,
        (ledger.remote_activation_revision or 0) + 1,
    )
    activation_id = _canonical_activation_id(
        activation_revision=activation_revision,
        namespace_id=ledger.tenant_id,
        source_revision_digest=digest,
    )
    return KnowledgeFSDifyIntegrationActivationRequest(
        namespace_id=ledger.tenant_id,
        control_space_id=control_space_id,
        activation_id=activation_id,
        activation_revision=activation_revision,
        source_revision_digest=digest,
    )


def _assert_exact_activation_ack(
    request: KnowledgeFSDifyIntegrationActivationRequest,
    ack: KnowledgeFSDifyIntegrationActivationAck,
) -> None:
    if (
        ack.namespace_id != request.namespace_id
        or ack.activation_id != request.activation_id
        or ack.activation_revision != request.activation_revision
        or ack.source_revision_digest != request.source_revision_digest
    ):
        raise KnowledgeFSCutoverGateBlockedError(
            "KnowledgeFS remote activation acknowledgement did not exactly match the request"
        )


def _activation_source_revision_digest(
    final_revision: KnowledgeFSCutoverRevisionWatermark,
    final_task_watermark: int,
) -> str:
    canonical = json.dumps(
        {
            "final_revision_watermark": final_revision,
            "final_task_watermark": final_task_watermark,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _canonical_activation_id(
    *,
    activation_revision: int,
    namespace_id: str,
    source_revision_digest: str,
) -> str:
    activation_envelope = json.dumps(
        {
            "activationRevision": activation_revision,
            "namespaceId": namespace_id,
            "sourceRevisionDigest": source_revision_digest,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    return f"sha256:{hashlib.sha256(activation_envelope).hexdigest()}"


def knowledge_fs_remote_freeze_evidence_consistent(ledger: KnowledgeFSWorkspaceCutoverLedger) -> bool:
    """Return whether persisted KFS freeze evidence exactly binds the source watermarks."""

    try:
        _assert_remote_freeze_evidence(ledger)
    except KnowledgeFSCutoverGateBlockedError:
        return False
    return True


def knowledge_fs_remote_activation_evidence_consistent(ledger: KnowledgeFSWorkspaceCutoverLedger) -> bool:
    """Return whether persisted KFS activation evidence exactly binds the final delta."""

    fields = (
        ledger.remote_activation_id,
        ledger.remote_activation_revision,
        ledger.remote_activation_digest,
        ledger.remote_activation_control_space_id,
        ledger.remote_activation_activated_at,
        ledger.remote_activation_updated_at,
        ledger.remote_activation_acknowledged_at,
        ledger.remote_activation_applied,
        ledger.remote_activation_replayed,
    )
    if any(value is None for value in fields):
        return False
    final_revision = ledger.final_revision_watermark
    final_task_watermark = ledger.final_task_watermark
    if final_revision is None or final_task_watermark is None:
        return False
    activation_revision = cast(int, ledger.remote_activation_revision)
    digest = _activation_source_revision_digest(final_revision, final_task_watermark)
    return (
        ledger.remote_activation_digest == digest
        and ledger.remote_activation_id
        == _canonical_activation_id(
            activation_revision=activation_revision,
            namespace_id=ledger.tenant_id,
            source_revision_digest=digest,
        )
        and ledger.remote_activation_control_space_id == ledger.remote_freeze_control_space_id
        and ledger.remote_activation_applied is not ledger.remote_activation_replayed
    )


def _latest_shadow_revision(
    observations: Iterable[KnowledgeFSShadowAuthorizationObservation],
) -> KnowledgeFSCutoverRevisionWatermark:
    values = tuple(observations)
    return {
        "membership_epoch": max(item.observed_revision["membership_epoch"] for item in values),
        "space_acl_epoch": max(item.observed_revision["space_acl_epoch"] for item in values),
        "external_access_epoch": max(item.observed_revision["external_access_epoch"] for item in values),
        "content_policy_revision": max(item.observed_revision["content_policy_revision"] for item in values),
    }


def _watermark_at_least(
    candidate: KnowledgeFSCutoverRevisionWatermark,
    baseline: KnowledgeFSCutoverRevisionWatermark,
) -> bool:
    return (
        candidate["membership_epoch"] >= baseline["membership_epoch"]
        and candidate["space_acl_epoch"] >= baseline["space_acl_epoch"]
        and candidate["external_access_epoch"] >= baseline["external_access_epoch"]
        and candidate["content_policy_revision"] >= baseline["content_policy_revision"]
    )


def _naive_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _iso(value: datetime | None) -> str | None:
    return value.replace(tzinfo=UTC).isoformat() if value is not None else None


__all__ = [
    "CutoverBackfillReport",
    "CutoverInventoryReport",
    "CutoverRevisionWatermarkInput",
    "CutoverSmokeResultsInput",
    "FinalDeltaInput",
    "KnowledgeFSCutoverConflictError",
    "KnowledgeFSCutoverError",
    "KnowledgeFSCutoverGateBlockedError",
    "KnowledgeFSCutoverNotFoundError",
    "KnowledgeFSWorkspaceCutoverService",
    "LegacyDependencyDashboard",
    "LegacyDependencyInput",
    "QuarantineResolutionInput",
    "QuarantineResolutionReport",
    "ShadowAuthorizationObservationInput",
    "ShadowAuthorizationReport",
    "ShadowCompletionInput",
    "ShadowCompletionReport",
    "WorkspaceInventoryInput",
    "knowledge_fs_remote_activation_evidence_consistent",
    "knowledge_fs_remote_freeze_evidence_consistent",
]
