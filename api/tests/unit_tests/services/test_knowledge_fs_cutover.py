from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID, uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from models.base import TypeBase
from models.knowledge_fs import (
    KnowledgeFSApiCredential,
    KnowledgeFSApiCredentialStatus,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
)
from models.knowledge_fs_cutover import (
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSMigrationQuarantineDisposition,
    KnowledgeFSMigrationQuarantineKind,
    KnowledgeFSShadowAuthorizationDecision,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)
from services.knowledge_fs.cutover import (
    CutoverSmokeResultsInput,
    FinalDeltaInput,
    KnowledgeFSCutoverConflictError,
    KnowledgeFSCutoverGateBlockedError,
    KnowledgeFSCutoverNotFoundError,
    KnowledgeFSWorkspaceCutoverService,
    LegacyDependencyInput,
    LegacyTaskInventoryInput,
    QuarantineResolutionInput,
    ShadowAuthorizationObservationInput,
    ShadowCompletionInput,
    WorkspaceInventoryInput,
)
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSDifyIntegrationActivationAck,
    KnowledgeFSDifyIntegrationActivationRequest,
    KnowledgeFSDifyIntegrationFreezeAck,
    KnowledgeFSDifyIntegrationFreezeRequest,
    KnowledgeFSLifecycleRemoteError,
    KnowledgeFSLifecycleRemotePort,
)

_MODELS = (
    KnowledgeFSControlSpace,
    KnowledgeFSApiCredential,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSMigrationIssue,
    KnowledgeFSMigrationQuarantine,
    KnowledgeFSShadowAuthorizationDiff,
    KnowledgeFSShadowAuthorizationObservation,
)
_SOURCE_REVISION = {
    "membership_epoch": 1,
    "space_acl_epoch": 1,
    "external_access_epoch": 1,
    "content_policy_revision": 1,
}
_FINAL_REVISION = {
    "membership_epoch": 2,
    "space_acl_epoch": 2,
    "external_access_epoch": 2,
    "content_policy_revision": 2,
}
_BASE_TIME = datetime(2026, 7, 21, 12, 0, tzinfo=UTC)
_TRUSTED_SHADOW_PRODUCER = "dify-shadow-authorizer"
_TRUSTED_SHADOW_OPERATOR = "knowledge-fs-cutover"


class FakeActivationRemote:
    def __init__(self) -> None:
        self.requests: list[KnowledgeFSDifyIntegrationActivationRequest] = []
        self.states: dict[str, KnowledgeFSDifyIntegrationActivationRequest] = {}
        self.freeze_requests: list[KnowledgeFSDifyIntegrationFreezeRequest] = []
        self.freeze_states: dict[str, KnowledgeFSDifyIntegrationFreezeRequest] = {}
        self.freeze_fail_after_persist = False
        self.freeze_response_override: object | None = None
        self.freeze_mismatch_ack = False
        self.fail_after_persist = False
        self.before_ack: Callable[[], None] | None = None
        self.response_override: object | None = None
        self.mismatch_ack = False

    def freeze_dify_workspace_integration(
        self,
        request: KnowledgeFSDifyIntegrationFreezeRequest,
    ) -> KnowledgeFSDifyIntegrationFreezeAck:
        self.freeze_requests.append(request)
        existing = self.freeze_states.get(request.namespace_id)
        if existing is not None and request.freeze_revision < existing.freeze_revision:
            raise KnowledgeFSLifecycleRemoteError("CONFLICT", "stale freeze")
        if existing is not None and request.freeze_revision == existing.freeze_revision and request != existing:
            raise KnowledgeFSLifecycleRemoteError("CONFLICT", "conflicting freeze")
        replayed = existing == request
        if not replayed:
            self.freeze_states[request.namespace_id] = request
        if self.freeze_fail_after_persist:
            self.freeze_fail_after_persist = False
            raise KnowledgeFSLifecycleRemoteError("LOST_ACK", "response was lost")
        if self.freeze_response_override is not None:
            return cast(KnowledgeFSDifyIntegrationFreezeAck, self.freeze_response_override)
        return KnowledgeFSDifyIntegrationFreezeAck(
            namespace_id="different-tenant" if self.freeze_mismatch_ack else request.namespace_id,
            freeze_id=request.freeze_id,
            freeze_revision=request.freeze_revision,
            source_revision_digest=request.source_revision_digest,
            source_task_watermark=request.source_task_watermark,
            frozen_at=_BASE_TIME,
            updated_at=_BASE_TIME + timedelta(seconds=request.freeze_revision),
            frozen=True,
            applied=not replayed,
            replayed=replayed,
        )

    def activate_dify_workspace_integration(
        self,
        request: KnowledgeFSDifyIntegrationActivationRequest,
    ) -> KnowledgeFSDifyIntegrationActivationAck:
        self.requests.append(request)
        existing = self.states.get(request.namespace_id)
        if existing is not None and request.activation_revision < existing.activation_revision:
            raise KnowledgeFSLifecycleRemoteError("CONFLICT", "stale activation")
        if existing is not None and request.activation_revision == existing.activation_revision and request != existing:
            raise KnowledgeFSLifecycleRemoteError("CONFLICT", "conflicting activation")
        replayed = existing == request
        if not replayed:
            self.states[request.namespace_id] = request
        if self.fail_after_persist:
            self.fail_after_persist = False
            raise KnowledgeFSLifecycleRemoteError("LOST_ACK", "response was lost")
        if self.before_ack is not None:
            callback, self.before_ack = self.before_ack, None
            callback()
        if self.response_override is not None:
            return cast(KnowledgeFSDifyIntegrationActivationAck, self.response_override)
        return KnowledgeFSDifyIntegrationActivationAck(
            namespace_id="different-tenant" if self.mismatch_ack else request.namespace_id,
            activation_id=request.activation_id,
            activation_revision=request.activation_revision,
            source_revision_digest=request.source_revision_digest,
            activated_at=_BASE_TIME,
            updated_at=_BASE_TIME + timedelta(seconds=request.activation_revision),
            active=True,
            applied=not replayed,
            replayed=replayed,
        )


def _service_with_remote(
    session_maker: sessionmaker[Session],
    remote: FakeActivationRemote,
) -> KnowledgeFSWorkspaceCutoverService:
    return KnowledgeFSWorkspaceCutoverService(
        session_maker,
        clock=lambda: _BASE_TIME + timedelta(hours=6),
        remote_factory=lambda: cast(KnowledgeFSLifecycleRemotePort, remote),
    )


@pytest.fixture
def cutover_context(sqlite_engine: Engine) -> tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]]:
    tables = [model.metadata.tables[model.__tablename__] for model in _MODELS]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    return (_service_with_remote(session_maker, FakeActivationRemote()), session_maker)


def _inventory(
    *,
    tenant_id: str | None = None,
    external_access_enabled: bool | None = True,
    unresolved_subject: bool = False,
    with_legacy_key: bool = False,
    with_task_classes: bool = False,
) -> WorkspaceInventoryInput:
    tenant_id = tenant_id or str(uuid4())
    account_id = str(uuid4())
    knowledge_space_id = str(uuid4())
    permissions: list[dict[str, object]] = []
    if unresolved_subject:
        permissions.append({"subject_id": "unresolved-user", "account_id": None, "role": "viewer"})
    tasks: list[dict[str, object]] = []
    if with_task_classes:
        tasks = [
            {
                "task_id": "queued-task",
                "subject_id": "user-1",
                "account_id": account_id,
                "state": "queued",
            },
            {
                "task_id": "running-task",
                "subject_id": "user-1",
                "account_id": account_id,
                "state": "running",
            },
            {
                "task_id": "isolated-task",
                "subject_id": "dify-workspace:legacy",
                "account_id": account_id,
                "state": "queued",
            },
            {
                "task_id": "terminal-task",
                "subject_id": "user-1",
                "account_id": account_id,
                "state": "completed",
            },
        ]
    keys: list[dict[str, object]] = []
    if with_legacy_key:
        keys.append({"key_id": "legacy-key-1", "prefix": "kfs_", "last4": "1234"})
    return WorkspaceInventoryInput.model_validate(
        {
            "tenant_id": tenant_id,
            "source_revision_watermark": _SOURCE_REVISION,
            "task_watermark": 10,
            "spaces": [
                {
                    "knowledge_space_id": knowledge_space_id,
                    "knowledge_space_revision": 7,
                    "provisioning_key": f"provision-{knowledge_space_id}",
                    "owner_subject_id": "owner-1",
                    "owner_account_id": account_id,
                    "visibility": "all_members",
                    "external_access_enabled": external_access_enabled,
                    "permissions": permissions,
                    "legacy_api_keys": keys,
                    "tasks": tasks,
                }
            ],
        }
    )


def _cas(service: KnowledgeFSWorkspaceCutoverService, tenant_id: str) -> int:
    return cast(int, service.status(tenant_id=tenant_id)["cas_version"])


def _shadow_observation(
    *,
    tenant_id: str,
    diff_key: str,
    principal: str = "owner-1",
    legacy_allowed: bool | None = True,
    dify_allowed: bool = True,
    reason: str = "same decision",
    observed_revision: dict[str, int] | None = None,
    observed_at: datetime = _BASE_TIME + timedelta(hours=1),
    producer: str = _TRUSTED_SHADOW_PRODUCER,
) -> ShadowAuthorizationObservationInput:
    return ShadowAuthorizationObservationInput.model_validate(
        {
            "schema_version": "knowledge-fs-p8-shadow-observation/v1",
            "tenant_id": tenant_id,
            "diff_key": diff_key,
            "principal": principal,
            "legacy_allowed": legacy_allowed,
            "dify_allowed": dify_allowed,
            "reason": reason,
            "observed_revision": observed_revision or _SOURCE_REVISION,
            "observed_at": observed_at,
            "producer": producer,
        }
    )


def _shadow_completion(
    service: KnowledgeFSWorkspaceCutoverService,
    tenant_id: str,
    *,
    producer: str = _TRUSTED_SHADOW_PRODUCER,
    operator: str = _TRUSTED_SHADOW_OPERATOR,
    traffic_zero: bool = False,
) -> ShadowCompletionInput:
    payload: dict[str, object] = {
        "schema_version": "knowledge-fs-p8-shadow-completion/v1",
        "tenant_id": tenant_id,
        "expected_cas_version": _cas(service, tenant_id),
        "producer": producer,
        "completed_by_operator": operator,
        "completed_by_account_id": str(uuid4()),
        "completed_at": _BASE_TIME + timedelta(hours=4),
        "traffic_zero": traffic_zero,
    }
    if traffic_zero:
        payload["traffic_zero_evidence"] = {"reference": "metrics://legacy-acl/zero-traffic"}
    else:
        payload["window_started_at"] = _BASE_TIME
        payload["window_ended_at"] = _BASE_TIME + timedelta(hours=3)
    return ShadowCompletionInput.model_validate(payload)


def _complete_shadow(service: KnowledgeFSWorkspaceCutoverService, tenant_id: str) -> None:
    service.complete_shadow(_shadow_completion(service, tenant_id), apply=True)


def _advance_to_shadow(service: KnowledgeFSWorkspaceCutoverService, payload: WorkspaceInventoryInput) -> str:
    tenant_id = str(payload.tenant_id)
    service.inventory(payload, apply=True)
    service.backfill(payload, apply=True)
    service.begin_shadow(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        started_at=_BASE_TIME,
    )
    service.record_shadow_report(
        [_shadow_observation(tenant_id=tenant_id, diff_key="match-1")],
        apply=True,
    )
    return tenant_id


def _advance_to_frozen(service: KnowledgeFSWorkspaceCutoverService, payload: WorkspaceInventoryInput) -> str:
    tenant_id = _advance_to_shadow(service, payload)
    _complete_shadow(service, tenant_id)
    service.legacy_dependency_dashboard(
        tenant_id=tenant_id,
        dependencies=(),
        expected_cas_version=_cas(service, tenant_id),
        checked_at=_BASE_TIME,
        apply=True,
    )
    service.freeze(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        freeze_at=_BASE_TIME + timedelta(minutes=1),
    )
    return tenant_id


def _advance_to_activation_ready(
    service: KnowledgeFSWorkspaceCutoverService,
    payload: WorkspaceInventoryInput,
) -> str:
    tenant_id = _advance_to_frozen(service, payload)
    service.apply_final_delta(
        FinalDeltaInput.model_validate(
            {
                "tenant_id": tenant_id,
                "expected_cas_version": _cas(service, tenant_id),
                "final_revision_watermark": _FINAL_REVISION,
                "applied_revision_watermark": _FINAL_REVISION,
                "final_task_watermark": 12,
                "applied_task_watermark": 12,
            }
        )
    )
    return tenant_id


def _advance_to_cutover(service: KnowledgeFSWorkspaceCutoverService, payload: WorkspaceInventoryInput) -> str:
    tenant_id = _advance_to_activation_ready(service, payload)
    service.cutover(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        cutover_at=_BASE_TIME + timedelta(minutes=2),
        rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
    )
    return tenant_id


def _quarantine_resolution(
    *,
    tenant_id: str,
    source_kind: KnowledgeFSMigrationQuarantineKind,
    source_id: str,
    expected_row_version: int = 0,
    evidence_reference: str | None = None,
    knowledge_space_id: str | None = None,
    control_space_id: str | None = None,
    credential_id: str | None = None,
) -> QuarantineResolutionInput:
    if source_kind is KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY:
        assert knowledge_space_id
        assert control_space_id
        assert credential_id
        evidence: dict[str, object] = {
            "schema_version": "knowledge-fs-p8-credential-rotation/v1",
            "legacy_key_id": source_id,
            "knowledge_space_id": knowledge_space_id,
            "control_space_id": control_space_id,
            "dify_credential_id": credential_id,
            "dify_credential_revision": 3,
            "legacy_revoked_at": _BASE_TIME.isoformat(),
            "verification_reference": evidence_reference or f"change://knowledge-fs/credential/{source_id}",
            "plaintext_migrated": False,
        }
    elif source_kind is KnowledgeFSMigrationQuarantineKind.TASK:
        action = "wait" if source_id == "running-task" else "migrate"
        evidence = {
            "schema_version": "knowledge-fs-p8-task-resolution/v1",
            "task_id": source_id,
            "action": action,
            "resulting_state": "completed" if action == "wait" else "migrated",
            "final_task_watermark": 10,
            "verification_reference": evidence_reference or f"change://knowledge-fs/task/{source_id}",
        }
    else:
        evidence = {
            "schema_version": "knowledge-fs-p8-general-resolution/v1",
            "reference": evidence_reference or f"change://knowledge-fs/{source_kind.value}/{source_id}",
        }
    return QuarantineResolutionInput.model_validate(
        {
            "schema_version": "knowledge-fs-p8-quarantine-resolution/v1",
            "tenant_id": tenant_id,
            "source_kind": source_kind,
            "source_id": source_id,
            "expected_row_version": expected_row_version,
            "resolved_by_operator": "migration-oncall",
            "resolved_by_account_id": str(uuid4()),
            "evidence": evidence,
            "resolved_at": _BASE_TIME,
        }
    )


def _add_rotated_credential(
    session_maker: sessionmaker[Session],
    *,
    tenant_id: str,
    knowledge_space_id: str,
) -> tuple[str, str]:
    with session_maker.begin() as session:
        control_space = session.scalar(
            select(KnowledgeFSControlSpace).where(
                KnowledgeFSControlSpace.tenant_id == tenant_id,
                KnowledgeFSControlSpace.knowledge_space_id == knowledge_space_id,
            )
        )
        assert control_space is not None
        credential = KnowledgeFSApiCredential(
            tenant_id=tenant_id,
            control_space_id=control_space.id,
            credential_hash=f"sha256:{uuid4().hex}",
            credential_prefix="dify_",
            credential_last4="9876",
            principal="dify-service:cutover",
            allowed_actions=["knowledge_spaces.read"],
            status=KnowledgeFSApiCredentialStatus.ACTIVE,
            revision=3,
        )
        session.add(credential)
        session.flush()
        return control_space.id, credential.id


def test_inventory_and_backfill_are_fail_closed_and_do_not_query_legacy_product_tables(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    payload = _inventory(
        external_access_enabled=None,
        unresolved_subject=True,
        with_legacy_key=True,
        with_task_classes=True,
    )
    tenant_id = str(payload.tenant_id)
    projected = service.backfill(payload, apply=False)
    assert projected == (
        tenant_id,
        1,
        1,
        5,
        2,
        KnowledgeFSWorkspaceCutoverPhase.INVENTORY.value,
        False,
    )
    inventory_report = service.inventory(payload, apply=True)
    statements: list[str] = []

    def capture_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement.lower())

    engine = cast(Engine, session_maker.kw["bind"])
    event.listen(engine, "before_cursor_execute", capture_statement)
    try:
        backfill_report = service.backfill(payload, apply=True)
    finally:
        event.remove(engine, "before_cursor_execute", capture_statement)

    assert inventory_report.tasks_by_disposition == {
        "migratable": 1,
        "wait_for_completion": 1,
        "cancel": 1,
        "isolate": 1,
    }
    assert backfill_report.phase == KnowledgeFSWorkspaceCutoverPhase.INVENTORY.value
    assert backfill_report.open_issues == 2
    assert not any(" from datasets" in statement or " from documents" in statement for statement in statements)
    with session_maker() as session:
        policy = session.scalar(select(KnowledgeFSExternalAccessPolicy))
        revision = session.scalar(select(KnowledgeFSAuthorizationRevision))
        control_space = session.scalar(select(KnowledgeFSControlSpace))
        permissions = tuple(session.scalars(select(KnowledgeFSControlSpacePermission)))
        quarantine = tuple(session.scalars(select(KnowledgeFSMigrationQuarantine)))
    assert policy is not None
    assert policy.service_api_enabled is False
    assert policy.agent_enabled is False
    assert policy.workflow_enabled is False
    assert revision is not None
    assert {
        "membership_epoch": revision.membership_epoch,
        "space_acl_epoch": revision.space_acl_epoch,
        "external_access_epoch": revision.external_access_epoch,
        "content_policy_revision": revision.content_policy_revision,
    } == _SOURCE_REVISION
    assert control_space is not None
    assert control_space.visibility.value == "all_team_members"
    assert len(permissions) == 1
    assert all("secret" not in item.details for item in quarantine)

    subject_issue = f"subject:{payload.spaces[0].knowledge_space_id}:unresolved-user"
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="only be approved"):
        service.resolve_issue(
            tenant_id=tenant_id,
            issue_key=subject_issue,
            account_id=str(uuid4()),
            resolved_at=_BASE_TIME,
        )
    for issue_key in (subject_issue, f"unknown-access:{payload.spaces[0].knowledge_space_id}"):
        service.approve_issue_fail_closed(
            tenant_id=tenant_id,
            issue_key=issue_key,
            account_id=str(uuid4()),
            approved_at=_BASE_TIME,
        )
    replay = service.backfill(payload, apply=True)
    assert replay.phase == KnowledgeFSWorkspaceCutoverPhase.BACKFILL.value
    assert replay.open_issues == 0


def test_unresolved_owner_still_audits_keys_tasks_and_orphans_without_registration(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    payload = _inventory(with_legacy_key=True, with_task_classes=True)
    space = payload.spaces[0].model_copy(
        update={
            "owner_account_id": None,
            "orphan_resource_ids": ["orphan-1"],
        }
    )
    payload = payload.model_copy(update={"spaces": [space]})
    service.inventory(payload, apply=True)

    report = service.backfill(payload, apply=True)

    assert report.control_spaces_registered == 0
    assert report.open_issues == 1
    with session_maker() as session:
        assert session.scalar(select(sa.func.count()).select_from(KnowledgeFSControlSpace)) == 0
        quarantine = tuple(session.scalars(select(KnowledgeFSMigrationQuarantine)))
    assert {item.source_kind.value for item in quarantine} == {
        "control_space",
        "legacy_api_key",
        "task",
        "orphan_resource",
    }
    assert len(quarantine) == 7


def test_legacy_dependency_dashboard_is_a_freeze_gate_and_reconciles_resolved_evidence(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    tenant_id = _advance_to_shadow(service, _inventory())
    _complete_shadow(service, tenant_id)
    dependency = LegacyDependencyInput.model_validate(
        {
            "dependency_key": "snapshot-space-1",
            "kind": "permission_snapshot",
            "table_name": "legacy_space_acl",
            "column_name": "snapshot_id",
            "constraint_name": "legacy_space_acl_snapshot_fk",
            "active_rows": 3,
            "migrated_rows": 7,
        }
    )
    blocked = service.legacy_dependency_dashboard(
        tenant_id=tenant_id,
        dependencies=(dependency,),
        expected_cas_version=_cas(service, tenant_id),
        checked_at=_BASE_TIME,
        apply=True,
    )
    assert blocked.ready is False
    assert (
        cast(list[dict[str, object]], service.status(tenant_id=tenant_id)["legacy_dependency_report"])[0]["active_rows"]
        == 3
    )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="Open migration issues"):
        service.freeze(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            freeze_at=_BASE_TIME + timedelta(minutes=1),
        )

    ready = service.legacy_dependency_dashboard(
        tenant_id=tenant_id,
        dependencies=(),
        expected_cas_version=_cas(service, tenant_id),
        checked_at=_BASE_TIME + timedelta(minutes=1),
        apply=True,
    )
    assert ready.ready is True
    assert service.status(tenant_id=tenant_id)["legacy_dependency_report"] == []
    ledger = service.freeze(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        freeze_at=_BASE_TIME + timedelta(minutes=2),
    )
    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.FROZEN


def test_key_running_task_and_orphan_quarantine_block_freeze_and_cutover_until_resolved(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    payload = _inventory(with_legacy_key=True)
    space = payload.spaces[0].model_copy(
        update={
            "tasks": [
                LegacyTaskInventoryInput.model_validate(
                    {
                        "task_id": "running-task",
                        "subject_id": "user-1",
                        "account_id": payload.spaces[0].owner_account_id,
                        "state": "running",
                    }
                )
            ],
            "orphan_resource_ids": ["orphan-1"],
        }
    )
    payload = payload.model_copy(update={"spaces": [space]})
    tenant_id = _advance_to_shadow(service, payload)
    _complete_shadow(service, tenant_id)
    service.legacy_dependency_dashboard(
        tenant_id=tenant_id,
        dependencies=(),
        expected_cas_version=_cas(service, tenant_id),
        checked_at=_BASE_TIME,
        apply=True,
    )

    assert service.status(tenant_id=tenant_id)["unresolved_cutover_quarantine"] == 3
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="Unresolved migration quarantine"):
        service.freeze(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            freeze_at=_BASE_TIME + timedelta(minutes=1),
        )

    control_space_id, credential_id = _add_rotated_credential(
        session_maker,
        tenant_id=tenant_id,
        knowledge_space_id=str(space.knowledge_space_id),
    )
    for source_kind, source_id in (
        (KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY, "legacy-key-1"),
        (KnowledgeFSMigrationQuarantineKind.TASK, "running-task"),
        (KnowledgeFSMigrationQuarantineKind.ORPHAN_RESOURCE, "orphan-1"),
    ):
        report = service.resolve_quarantine(
            _quarantine_resolution(
                tenant_id=tenant_id,
                source_kind=source_kind,
                source_id=source_id,
                knowledge_space_id=str(space.knowledge_space_id),
                control_space_id=control_space_id,
                credential_id=credential_id,
            ),
            apply=True,
        )
        assert report.disposition == KnowledgeFSMigrationQuarantineDisposition.RESOLVED.value
        assert report.applied is True

    service.freeze(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        freeze_at=_BASE_TIME + timedelta(minutes=1),
    )
    with session_maker.begin() as session:
        ledger = session.scalar(
            select(KnowledgeFSWorkspaceCutoverLedger).where(KnowledgeFSWorkspaceCutoverLedger.tenant_id == tenant_id)
        )
        assert ledger is not None
        session.add(
            KnowledgeFSMigrationQuarantine(
                tenant_id=tenant_id,
                ledger_id=ledger.id,
                source_kind=KnowledgeFSMigrationQuarantineKind.ORPHAN_RESOURCE,
                source_id="late-orphan",
                reason_code="ORPHAN_RESOURCE",
                disposition=KnowledgeFSMigrationQuarantineDisposition.PENDING,
                details={"knowledge_space_id": str(space.knowledge_space_id)},
            )
        )
    service.apply_final_delta(
        FinalDeltaInput.model_validate(
            {
                "tenant_id": tenant_id,
                "expected_cas_version": _cas(service, tenant_id),
                "final_revision_watermark": _FINAL_REVISION,
                "applied_revision_watermark": _FINAL_REVISION,
                "final_task_watermark": 12,
                "applied_task_watermark": 12,
            }
        )
    )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="Unresolved migration quarantine"):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )
    service.resolve_quarantine(
        _quarantine_resolution(
            tenant_id=tenant_id,
            source_kind=KnowledgeFSMigrationQuarantineKind.ORPHAN_RESOURCE,
            source_id="late-orphan",
        ),
        apply=True,
    )
    ledger = service.cutover(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        cutover_at=_BASE_TIME + timedelta(minutes=2),
        rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
    )
    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.CUTOVER


def test_control_space_quarantine_is_an_independent_freeze_gate(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    payload = _inventory()
    payload = payload.model_copy(update={"spaces": [payload.spaces[0].model_copy(update={"owner_account_id": None})]})
    tenant_id = str(payload.tenant_id)
    service.inventory(payload, apply=True)
    service.backfill(payload, apply=True)
    service.resolve_issue(
        tenant_id=tenant_id,
        issue_key=f"owner:{payload.spaces[0].knowledge_space_id}",
        account_id=str(uuid4()),
        resolved_at=_BASE_TIME,
    )
    service.backfill(payload, apply=True)
    service.begin_shadow(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        started_at=_BASE_TIME,
    )
    service.record_shadow_report(
        [
            _shadow_observation(
                tenant_id=tenant_id,
                diff_key="match-1",
                legacy_allowed=False,
                dify_allowed=False,
                reason="unregistered control-space remains fail-closed",
            )
        ],
        apply=True,
    )
    _complete_shadow(service, tenant_id)
    service.legacy_dependency_dashboard(
        tenant_id=tenant_id,
        dependencies=(),
        expected_cas_version=_cas(service, tenant_id),
        checked_at=_BASE_TIME,
        apply=True,
    )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="Unresolved migration quarantine"):
        service.freeze(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            freeze_at=_BASE_TIME + timedelta(minutes=1),
        )

    service.resolve_quarantine(
        _quarantine_resolution(
            tenant_id=tenant_id,
            source_kind=KnowledgeFSMigrationQuarantineKind.CONTROL_SPACE,
            source_id=str(payload.spaces[0].knowledge_space_id),
        ),
        apply=True,
    )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="tenant-owned active control-space"):
        service.freeze(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            freeze_at=_BASE_TIME + timedelta(minutes=1),
        )
    with session_maker.begin() as session:
        session.add(
            KnowledgeFSControlSpace(
                tenant_id=tenant_id,
                owner_account_id=str(uuid4()),
                provisioning_key=f"resolved-{uuid4()}",
                knowledge_space_id=str(payload.spaces[0].knowledge_space_id),
                knowledge_space_revision=1,
                state=KnowledgeFSControlSpaceState.ACTIVE,
            )
        )
    ledger = service.freeze(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        freeze_at=_BASE_TIME + timedelta(minutes=1),
    )
    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.FROZEN


def test_quarantine_resolution_is_tenant_scoped_dry_run_idempotent_and_version_ordered(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    payload = _inventory(with_legacy_key=True)
    tenant_id = str(payload.tenant_id)
    service.inventory(payload, apply=True)
    service.backfill(payload, apply=True)
    other_payload = _inventory(with_legacy_key=False)
    other_tenant_id = str(other_payload.tenant_id)
    service.inventory(other_payload, apply=True)
    service.backfill(other_payload, apply=True)
    control_space_id, credential_id = _add_rotated_credential(
        session_maker,
        tenant_id=tenant_id,
        knowledge_space_id=str(payload.spaces[0].knowledge_space_id),
    )
    resolution = _quarantine_resolution(
        tenant_id=tenant_id,
        source_kind=KnowledgeFSMigrationQuarantineKind.LEGACY_API_KEY,
        source_id="legacy-key-1",
        knowledge_space_id=str(payload.spaces[0].knowledge_space_id),
        control_space_id=control_space_id,
        credential_id=credential_id,
    )

    with pytest.raises(KnowledgeFSCutoverNotFoundError, match="Quarantine item"):
        service.resolve_quarantine(
            resolution.model_copy(update={"tenant_id": UUID(other_tenant_id)}),
            apply=True,
        )
    with pytest.raises(KnowledgeFSCutoverConflictError, match="version changed"):
        service.resolve_quarantine(
            resolution.model_copy(update={"expected_row_version": 1}),
            apply=True,
        )

    dry_run = service.resolve_quarantine(resolution, apply=False)
    assert dry_run.applied is False
    assert dry_run.disposition == KnowledgeFSMigrationQuarantineDisposition.ROTATE_CREDENTIAL.value
    applied = service.resolve_quarantine(resolution, apply=True)
    assert applied.row_version == 1
    replay = service.resolve_quarantine(resolution, apply=True)
    assert replay.replayed is True
    assert replay.row_version == 1
    with pytest.raises(KnowledgeFSCutoverConflictError, match="different evidence"):
        service.resolve_quarantine(
            resolution.model_copy(
                update={
                    "evidence": resolution.evidence.model_copy(update={"verification_reference": "change://different"})
                }
            ),
            apply=True,
        )

    status = service.status(tenant_id=tenant_id)
    item = cast(list[dict[str, object]], status["quarantine"])[0]
    assert item["resolved_by_operator"] == "migration-oncall"
    assert item["resolved_by_account_id"] == str(resolution.resolved_by_account_id)
    assert item["evidence"] == resolution.evidence.model_dump(mode="json")
    assert item["row_version"] == 1


def test_state_machine_rejects_phase_skips_and_inventory_watermark_drift(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, _ = cutover_context
    payload = _inventory()
    tenant_id = str(payload.tenant_id)
    service.inventory(payload, apply=True)
    with pytest.raises(KnowledgeFSCutoverConflictError, match="inventoried watermarks"):
        service.backfill(payload.model_copy(update={"task_watermark": 11}), apply=True)
    with pytest.raises(KnowledgeFSCutoverConflictError, match="Expected cutover phase backfill"):
        service.begin_shadow(tenant_id=tenant_id, expected_cas_version=_cas(service, tenant_id))
    service.backfill(payload, apply=True)
    with pytest.raises(KnowledgeFSCutoverConflictError, match="Expected cutover phase shadow"):
        service.freeze(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            freeze_at=_BASE_TIME,
        )


def test_shadow_completion_requires_fresh_trusted_evidence_and_exact_replay(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    payload = _inventory()
    tenant_id = str(payload.tenant_id)
    service.inventory(payload, apply=True)
    service.backfill(payload, apply=True)
    service.begin_shadow(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        started_at=_BASE_TIME,
    )
    service.legacy_dependency_dashboard(
        tenant_id=tenant_id,
        dependencies=(),
        expected_cas_version=_cas(service, tenant_id),
        checked_at=_BASE_TIME,
        apply=True,
    )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="Shadow evidence is not complete"):
        service.freeze(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            freeze_at=_BASE_TIME + timedelta(hours=5),
        )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="at least one observation"):
        service.complete_shadow(_shadow_completion(service, tenant_id), apply=True)
    stale_revision = dict(_SOURCE_REVISION)
    stale_revision["membership_epoch"] = 0
    with pytest.raises(KnowledgeFSCutoverConflictError, match="revision is stale"):
        service.record_shadow_report(
            [
                _shadow_observation(
                    tenant_id=tenant_id,
                    diff_key="stale-1",
                    observed_revision=stale_revision,
                )
            ],
            apply=True,
        )
    with pytest.raises(KnowledgeFSCutoverConflictError, match="future"):
        service.record_shadow_report(
            [
                _shadow_observation(
                    tenant_id=tenant_id,
                    diff_key="future-1",
                    observed_at=_BASE_TIME + timedelta(hours=7),
                )
            ],
            apply=True,
        )
    with pytest.raises(KnowledgeFSCutoverConflictError, match="mix Workspaces"):
        service.record_shadow_report(
            [
                _shadow_observation(tenant_id=tenant_id, diff_key="match-1"),
                _shadow_observation(tenant_id=str(uuid4()), diff_key="match-2"),
            ],
            apply=True,
        )

    observation = _shadow_observation(tenant_id=tenant_id, diff_key="match-1")
    first = service.record_shadow_report([observation], apply=True)
    replay = service.record_shadow_report([observation], apply=True)
    assert first.recorded == 1
    assert first.replayed == 0
    assert replay.recorded == 0
    assert replay.replayed == 1
    with pytest.raises(KnowledgeFSCutoverConflictError, match="different evidence"):
        service.record_shadow_report(
            [observation.model_copy(update={"reason": "changed evidence"})],
            apply=True,
        )
    with session_maker() as session:
        assert session.scalar(select(sa.func.count()).select_from(KnowledgeFSShadowAuthorizationObservation)) == 1
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="trusted"):
        service.complete_shadow(
            _shadow_completion(service, tenant_id, operator="untrusted-operator"),
            apply=True,
        )

    completion_payload = _shadow_completion(service, tenant_id)
    completion = service.complete_shadow(completion_payload, apply=True)
    assert completion.observation_count == 1
    assert completion.evidence_digest.startswith("sha256:")
    assert completion.replayed is False
    replayed_completion = service.complete_shadow(completion_payload, apply=True)
    assert replayed_completion.replayed is True
    status = service.status(tenant_id=tenant_id)
    assert status["shadow_observation_count"] == 1
    assert status["shadow_evidence_digest"] == completion.evidence_digest
    with pytest.raises(KnowledgeFSCutoverConflictError, match="already complete"):
        service.record_shadow_report(
            [_shadow_observation(tenant_id=tenant_id, diff_key="late-1")],
            apply=True,
        )
    ledger = service.freeze(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        freeze_at=_BASE_TIME + timedelta(hours=5),
    )
    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.FROZEN


def test_shadow_completion_allows_trusted_traffic_zero_attestation(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, _ = cutover_context
    payload = _inventory()
    tenant_id = str(payload.tenant_id)
    service.inventory(payload, apply=True)
    service.backfill(payload, apply=True)
    service.begin_shadow(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        started_at=_BASE_TIME,
    )
    completion = service.complete_shadow(
        _shadow_completion(service, tenant_id, traffic_zero=True),
        apply=True,
    )
    assert completion.observation_count == 0
    assert completion.traffic_zero is True
    service.legacy_dependency_dashboard(
        tenant_id=tenant_id,
        dependencies=(),
        expected_cas_version=_cas(service, tenant_id),
        checked_at=_BASE_TIME,
        apply=True,
    )
    ledger = service.freeze(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        freeze_at=_BASE_TIME + timedelta(hours=5),
    )
    assert ledger.shadow_traffic_zero is True


def test_shadow_completion_requires_latest_observation_at_applicable_final_revision(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    tenant_id = _advance_to_shadow(service, _inventory())
    with session_maker.begin() as session:
        session.execute(
            sa.update(KnowledgeFSWorkspaceCutoverLedger)
            .where(KnowledgeFSWorkspaceCutoverLedger.tenant_id == tenant_id)
            .values(final_revision_watermark=_FINAL_REVISION)
        )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="latest observed revision"):
        service.complete_shadow(_shadow_completion(service, tenant_id), apply=True)

    service.record_shadow_report(
        [
            _shadow_observation(
                tenant_id=tenant_id,
                diff_key="final-match",
                observed_revision=_FINAL_REVISION,
                observed_at=_BASE_TIME + timedelta(hours=2),
            )
        ],
        apply=True,
    )
    completion = service.complete_shadow(_shadow_completion(service, tenant_id), apply=True)
    assert completion.latest_observed_revision == _FINAL_REVISION


def test_shadow_unknown_and_expanded_require_safe_reevaluation_not_bare_resolution(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    tenant_id = _advance_to_shadow(service, _inventory())
    observations = [
        _shadow_observation(
            tenant_id=tenant_id,
            diff_key="unknown-1",
            principal="unknown-principal",
            legacy_allowed=None,
            dify_allowed=True,
            reason="legacy evidence is unavailable",
        ),
        _shadow_observation(
            tenant_id=tenant_id,
            diff_key="expanded-1",
            principal="expanded-principal",
            legacy_allowed=False,
            dify_allowed=True,
            reason="new decision expands access",
        ),
    ]
    report = service.record_shadow_report(observations, apply=True)
    assert report.unknown == 1
    assert report.expanded == 1
    with session_maker() as session:
        unknown = session.scalar(
            select(KnowledgeFSShadowAuthorizationDiff).where(KnowledgeFSShadowAuthorizationDiff.diff_key == "unknown-1")
        )
    assert unknown is not None
    assert unknown.decision is KnowledgeFSShadowAuthorizationDecision.UNKNOWN
    assert unknown.dify_allowed is False
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="cannot be approved"):
        service.approve_shadow_diff(
            tenant_id=tenant_id,
            diff_key="expanded-1",
            account_id=str(uuid4()),
            approved_at=_BASE_TIME,
        )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="only be approved"):
        service.resolve_shadow_diff(
            tenant_id=tenant_id,
            diff_key="unknown-1",
            account_id=str(uuid4()),
            resolved_at=_BASE_TIME,
        )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="safe shadow re-evaluation"):
        service.resolve_shadow_diff(
            tenant_id=tenant_id,
            diff_key="expanded-1",
            account_id=str(uuid4()),
            resolved_at=_BASE_TIME,
        )
    with pytest.raises(KnowledgeFSCutoverConflictError, match="different evidence"):
        service.record_shadow_report(
            [
                _shadow_observation(
                    tenant_id=tenant_id,
                    diff_key="expanded-1",
                    principal="expanded-principal",
                    legacy_allowed=False,
                    dify_allowed=True,
                    reason="still expands access",
                    observed_revision=_FINAL_REVISION,
                )
            ],
            apply=True,
        )
    reevaluated = service.record_shadow_report(
        [
            _shadow_observation(
                tenant_id=tenant_id,
                diff_key="unknown-1",
                principal="unknown-principal",
                legacy_allowed=True,
                dify_allowed=False,
                reason="legacy source recovered; Dify is tighter",
                observed_revision=_FINAL_REVISION,
                observed_at=_BASE_TIME + timedelta(hours=2),
            ),
            _shadow_observation(
                tenant_id=tenant_id,
                diff_key="expanded-1",
                principal="expanded-principal",
                legacy_allowed=False,
                dify_allowed=False,
                reason="Dify policy remediated",
                observed_revision=_FINAL_REVISION,
                observed_at=_BASE_TIME + timedelta(hours=2),
            ),
        ],
        apply=True,
    )
    assert reevaluated.recorded == 2
    assert service.status(tenant_id=tenant_id)["open_shadow_diffs"] == 0
    with session_maker() as session:
        history = tuple(
            session.scalars(
                select(KnowledgeFSShadowAuthorizationObservation).where(
                    KnowledgeFSShadowAuthorizationObservation.diff_key.in_(("unknown-1", "expanded-1"))
                )
            )
        )
    assert len(history) == 4
    assert {item.decision for item in history} == {
        KnowledgeFSShadowAuthorizationDecision.UNKNOWN,
        KnowledgeFSShadowAuthorizationDecision.EXPANDED,
        KnowledgeFSShadowAuthorizationDecision.TIGHTENED,
        KnowledgeFSShadowAuthorizationDecision.MATCH,
    }


def test_final_delta_watermarks_must_be_fully_applied_before_cutover(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, _ = cutover_context
    tenant_id = _advance_to_frozen(service, _inventory())
    service.apply_final_delta(
        FinalDeltaInput.model_validate(
            {
                "tenant_id": tenant_id,
                "expected_cas_version": _cas(service, tenant_id),
                "final_revision_watermark": _FINAL_REVISION,
                "applied_revision_watermark": _SOURCE_REVISION,
                "final_task_watermark": 12,
                "applied_task_watermark": 10,
            }
        )
    )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="Final delta watermarks"):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )

    service.apply_final_delta(
        FinalDeltaInput.model_validate(
            {
                "tenant_id": tenant_id,
                "expected_cas_version": _cas(service, tenant_id),
                "final_revision_watermark": _FINAL_REVISION,
                "applied_revision_watermark": _FINAL_REVISION,
                "final_task_watermark": 12,
                "applied_task_watermark": 12,
            }
        )
    )
    ledger = service.cutover(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        cutover_at=_BASE_TIME + timedelta(minutes=2),
        rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
    )
    assert ledger.final_revision_watermark == ledger.applied_revision_watermark
    assert ledger.final_task_watermark == ledger.applied_task_watermark


def test_cutover_lost_ack_keeps_routes_closed_and_exact_retry_replays_remote_activation(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    _, session_maker = cutover_context
    remote = FakeActivationRemote()
    service = _service_with_remote(session_maker, remote)
    tenant_id = _advance_to_activation_ready(service, _inventory())
    expected_version = _cas(service, tenant_id)
    remote.fail_after_persist = True

    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="not acknowledged"):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=expected_version,
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )

    failed_status = service.status(tenant_id=tenant_id)
    assert failed_status["phase"] == KnowledgeFSWorkspaceCutoverPhase.FROZEN.value
    assert failed_status["remote_activation_id"] is None
    assert all(enabled is False for enabled in cast(dict[str, bool], failed_status["feature_state"]).values())
    first_request = remote.requests[0]

    ledger = service.cutover(
        tenant_id=tenant_id,
        expected_cas_version=expected_version,
        cutover_at=_BASE_TIME + timedelta(minutes=2),
        rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
    )

    assert remote.requests == [first_request, first_request]
    assert ledger.remote_activation_applied is False
    assert ledger.remote_activation_replayed is True
    assert ledger.remote_activation_id == first_request.activation_id
    assert ledger.remote_activation_revision == first_request.activation_revision
    assert ledger.remote_activation_digest == first_request.source_revision_digest


@pytest.mark.parametrize("failure_mode", ["malformed", "mismatched"])
def test_cutover_rejects_malformed_or_mismatched_ack_without_local_mutation(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
    failure_mode: str,
) -> None:
    _, session_maker = cutover_context
    remote = FakeActivationRemote()
    service = _service_with_remote(session_maker, remote)
    tenant_id = _advance_to_activation_ready(service, _inventory())
    if failure_mode == "malformed":
        remote.response_override = {"active": True}
    else:
        remote.mismatch_ack = True

    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="acknowledgement"):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )

    status = service.status(tenant_id=tenant_id)
    assert status["phase"] == KnowledgeFSWorkspaceCutoverPhase.FROZEN.value
    assert status["remote_activation_id"] is None
    assert cast(dict[str, bool], status["feature_state"])["product_routes_enabled"] is False


def test_cutover_without_remote_is_fail_closed_and_status_does_not_resolve_remote(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    configured_service, session_maker = cutover_context
    tenant_id = _advance_to_activation_ready(configured_service, _inventory())
    service = KnowledgeFSWorkspaceCutoverService(
        session_maker,
        clock=lambda: _BASE_TIME + timedelta(hours=6),
    )

    assert service.status(tenant_id=tenant_id)["phase"] == KnowledgeFSWorkspaceCutoverPhase.FROZEN.value
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="not configured"):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )
    assert (
        cast(dict[str, bool], service.status(tenant_id=tenant_id)["feature_state"])["product_routes_enabled"] is False
    )


def test_remote_activation_runs_without_db_transaction_and_persists_canonical_evidence(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    _, session_maker = cutover_context
    remote = FakeActivationRemote()
    service = _service_with_remote(session_maker, remote)
    tenant_id = _advance_to_activation_ready(service, _inventory())
    engine = cast(Engine, session_maker.kw["bind"])
    active_transactions = [0]

    def transaction_started(_connection: object) -> None:
        active_transactions[0] += 1

    def transaction_ended(_connection: object) -> None:
        active_transactions[0] -= 1

    def assert_no_transaction() -> None:
        if active_transactions[0] != 0:
            pytest.fail("remote call held a DB transaction")

    remote.before_ack = assert_no_transaction
    event.listen(engine, "begin", transaction_started)
    event.listen(engine, "commit", transaction_ended)
    event.listen(engine, "rollback", transaction_ended)
    try:
        ledger = service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )
    finally:
        event.remove(engine, "begin", transaction_started)
        event.remove(engine, "commit", transaction_ended)
        event.remove(engine, "rollback", transaction_ended)

    request = remote.requests[0]
    source_canonical = json.dumps(
        {
            "final_revision_watermark": _FINAL_REVISION,
            "final_task_watermark": 12,
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    expected_digest = f"sha256:{hashlib.sha256(source_canonical).hexdigest()}"
    activation_canonical = json.dumps(
        {
            "activationRevision": request.activation_revision,
            "namespaceId": tenant_id,
            "sourceRevisionDigest": expected_digest,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    assert request.activation_id == f"sha256:{hashlib.sha256(activation_canonical).hexdigest()}"
    assert request.namespace_id == tenant_id
    assert request.control_space_id == ledger.remote_activation_control_space_id
    assert request.activation_revision >= 1
    assert request.source_revision_digest == expected_digest
    assert ledger.product_routes_enabled is True
    assert ledger.remote_activation_applied is True
    assert ledger.remote_activation_acknowledged_at == (_BASE_TIME + timedelta(hours=6)).replace(tzinfo=None)


def test_remote_success_then_local_cas_race_keeps_routes_closed_and_retries_higher_revision(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    _, session_maker = cutover_context
    remote = FakeActivationRemote()
    service = _service_with_remote(session_maker, remote)
    tenant_id = _advance_to_activation_ready(service, _inventory())
    expected_version = _cas(service, tenant_id)

    def win_local_race() -> None:
        with session_maker.begin() as session:
            session.execute(
                sa.update(KnowledgeFSWorkspaceCutoverLedger)
                .where(KnowledgeFSWorkspaceCutoverLedger.tenant_id == tenant_id)
                .values(cas_version=KnowledgeFSWorkspaceCutoverLedger.cas_version + 1)
            )

    remote.before_ack = win_local_race
    with pytest.raises(KnowledgeFSCutoverConflictError, match="version changed"):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=expected_version,
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )

    raced_status = service.status(tenant_id=tenant_id)
    assert raced_status["remote_activation_id"] is None
    assert cast(dict[str, bool], raced_status["feature_state"])["product_routes_enabled"] is False
    first_revision = remote.requests[0].activation_revision

    ledger = service.cutover(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        cutover_at=_BASE_TIME + timedelta(minutes=2),
        rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
    )

    assert remote.requests[1].activation_revision > first_revision
    assert ledger.remote_activation_revision == remote.requests[1].activation_revision
    assert ledger.product_routes_enabled is True


def test_cutover_never_uses_a_cross_tenant_control_space_as_activation_anchor(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    _, session_maker = cutover_context
    remote = FakeActivationRemote()
    service = _service_with_remote(session_maker, remote)
    tenant_id = _advance_to_activation_ready(service, _inventory())
    with session_maker.begin() as session:
        session.execute(
            sa.update(KnowledgeFSControlSpace)
            .where(KnowledgeFSControlSpace.tenant_id == tenant_id)
            .values(state=KnowledgeFSControlSpaceState.ERROR)
        )
        session.add(
            KnowledgeFSControlSpace(
                tenant_id=str(uuid4()),
                owner_account_id=str(uuid4()),
                provisioning_key=f"other-tenant-{uuid4()}",
                knowledge_space_id=str(uuid4()),
                knowledge_space_revision=1,
                state=KnowledgeFSControlSpaceState.ACTIVE,
            )
        )

    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="tenant-owned active control-space"):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )
    assert remote.requests == []


def test_cutover_uses_one_cas_update_for_all_feature_switches_and_rejects_stale_version(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    tenant_id = _advance_to_frozen(service, _inventory())
    service.apply_final_delta(
        FinalDeltaInput.model_validate(
            {
                "tenant_id": tenant_id,
                "expected_cas_version": _cas(service, tenant_id),
                "final_revision_watermark": _FINAL_REVISION,
                "applied_revision_watermark": _FINAL_REVISION,
                "final_task_watermark": 12,
                "applied_task_watermark": 12,
            }
        )
    )
    expected_version = _cas(service, tenant_id)
    updates: list[str] = []

    def capture_update(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if statement.lstrip().lower().startswith("update knowledge_fs_workspace_cutover_ledgers"):
            updates.append(statement.lower())

    engine = cast(Engine, session_maker.kw["bind"])
    event.listen(engine, "before_cursor_execute", capture_update)
    try:
        ledger = service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=expected_version,
            cutover_at=_BASE_TIME + timedelta(minutes=2),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_update)

    assert len(updates) == 1
    for switch in (
        "product_routes_enabled",
        "capability_v2_enabled",
        "integrated_mode_enabled",
        "legacy_acl_read_only",
        "remote_activation_id",
        "remote_activation_revision",
        "remote_activation_digest",
        "remote_activation_acknowledged_at",
    ):
        assert switch in updates[0]
    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.CUTOVER
    assert ledger.product_routes_enabled is True
    assert ledger.capability_v2_enabled is True
    assert ledger.integrated_mode_enabled is True
    assert ledger.legacy_acl_read_only is True
    with pytest.raises(KnowledgeFSCutoverConflictError):
        service.cutover(
            tenant_id=tenant_id,
            expected_cas_version=expected_version,
            cutover_at=_BASE_TIME + timedelta(minutes=3),
            rollback_cutoff_at=_BASE_TIME + timedelta(days=2),
        )


def test_rollback_honors_cutoff_and_never_restores_legacy_authority(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, _ = cutover_context
    tenant_id = _advance_to_cutover(service, _inventory())
    activation_before_rollback = cast(str, service.status(tenant_id=tenant_id)["remote_activation_id"])

    ledger = service.rollback(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        rolled_back_at=_BASE_TIME + timedelta(hours=1),
    )

    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.FROZEN
    assert ledger.product_routes_enabled is False
    assert ledger.capability_v2_enabled is True
    assert ledger.integrated_mode_enabled is True
    assert ledger.legacy_acl_read_only is True
    assert ledger.remote_activation_id == activation_before_rollback
    assert ledger.remote_activation_revision is not None
    assert ledger.remote_activation_digest is not None
    assert ledger.remote_activation_acknowledged_at is not None


def test_rollback_rejects_cutoff_and_irreversible_cleanup(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, session_maker = cutover_context
    cutoff_tenant = _advance_to_cutover(service, _inventory())
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="cutoff"):
        service.rollback(
            tenant_id=cutoff_tenant,
            expected_cas_version=_cas(service, cutoff_tenant),
            rolled_back_at=_BASE_TIME + timedelta(days=2),
        )

    cleanup_tenant = _advance_to_cutover(service, _inventory())
    with session_maker.begin() as session:
        session.execute(
            sa.update(KnowledgeFSWorkspaceCutoverLedger)
            .where(KnowledgeFSWorkspaceCutoverLedger.tenant_id == cleanup_tenant)
            .values(irreversible_cleanup_at=_BASE_TIME + timedelta(hours=1))
        )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="Irreversible cleanup"):
        service.rollback(
            tenant_id=cleanup_tenant,
            expected_cas_version=_cas(service, cleanup_tenant),
            rolled_back_at=_BASE_TIME + timedelta(hours=2),
        )


def test_observation_requires_passing_smoke_full_window_and_maximum_task_ttl(
    cutover_context: tuple[KnowledgeFSWorkspaceCutoverService, sessionmaker[Session]],
) -> None:
    service, _ = cutover_context
    tenant_id = _advance_to_cutover(service, _inventory())
    failed_smoke = _smoke_results(tenant_id, stream=False)
    service.record_smoke_results(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        results=failed_smoke,
    )
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="smoke"):
        service.begin_observation(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            started_at=_BASE_TIME + timedelta(hours=1),
            window_ends_at=_BASE_TIME + timedelta(hours=2),
            maximum_task_expires_at=_BASE_TIME + timedelta(hours=3),
        )

    passed_smoke = _smoke_results(tenant_id, stream=True)
    service.record_smoke_results(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        results=passed_smoke,
    )
    ledger = service.begin_observation(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        started_at=_BASE_TIME + timedelta(hours=1),
        window_ends_at=_BASE_TIME + timedelta(hours=2),
        maximum_task_expires_at=_BASE_TIME + timedelta(hours=3),
    )
    assert ledger.phase is KnowledgeFSWorkspaceCutoverPhase.OBSERVING
    with pytest.raises(KnowledgeFSCutoverGateBlockedError, match="maximum task TTL"):
        service.complete_observation(
            tenant_id=tenant_id,
            expected_cas_version=_cas(service, tenant_id),
            observed_at=_BASE_TIME + timedelta(hours=2, minutes=30),
        )
    completed = service.complete_observation(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        observed_at=_BASE_TIME + timedelta(hours=3),
    )
    assert completed.phase is KnowledgeFSWorkspaceCutoverPhase.READY_FOR_CLEANUP
    rolled_back = service.rollback(
        tenant_id=tenant_id,
        expected_cas_version=_cas(service, tenant_id),
        rolled_back_at=_BASE_TIME + timedelta(hours=4),
    )
    assert rolled_back.phase is KnowledgeFSWorkspaceCutoverPhase.FROZEN


def _smoke_results(tenant_id: str, *, stream: bool) -> CutoverSmokeResultsInput:
    checks = {
        "authorization": True,
        "list_spaces": True,
        "create_space": True,
        "query": True,
        "upload": True,
        "stream": stream,
        "deletion": True,
    }
    return CutoverSmokeResultsInput.model_validate(
        {
            "schema_version": "knowledge-fs-p8-cutover-smoke/v1",
            "tenant_id": tenant_id,
            "environment": "production",
            "operator": "knowledge-fs-cutover",
            "operator_account_id": str(uuid4()),
            "observed_at": (_BASE_TIME + timedelta(minutes=10)).isoformat(),
            "checks": checks,
            "evidence_references": {name: f"evidence://smoke/{name}" for name in checks},
        }
    )
    assert rolled_back.legacy_acl_read_only is True
