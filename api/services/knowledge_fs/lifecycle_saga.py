"""Lease-driven KnowledgeFS integrated provision and durable deletion saga."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Literal, NamedTuple, cast

from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSControlSpaceState,
    KnowledgeFSDeleteCommandPayload,
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSLifecycleOutboxStatus,
    KnowledgeFSProvisionCommandPayload,
    KnowledgeFSRevokeCommandPayload,
)
from repositories.knowledge_fs_control_space_repository import KnowledgeFSControlSpaceCASUpdate
from repositories.sqlalchemy_knowledge_fs_control_space_repository import (
    SQLAlchemyKnowledgeFSControlSpaceRepository,
)
from repositories.sqlalchemy_knowledge_fs_lifecycle_outbox_repository import (
    SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
)
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSControlSpaceLifecycleService
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeAck,
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSDeletionPhase,
    KnowledgeFSIntegratedDeletionRequest,
    KnowledgeFSIntegratedProvisionRequest,
    KnowledgeFSLifecycleRemoteError,
    KnowledgeFSLifecycleRemotePort,
    KnowledgeFSRemoteSpace,
)
from services.knowledge_fs.observability import (
    KnowledgeFSLifecycleTaskMetric,
    KnowledgeFSOperationalMetricsPort,
    get_knowledge_fs_operational_metrics,
)

logger = logging.getLogger(__name__)


class KnowledgeFSLifecycleDispatchResult(NamedTuple):
    claimed: bool
    completed: bool
    outbox_id: str | None


class KnowledgeFSLifecycleLeaseLostError(RuntimeError):
    """The command lease changed before the worker could settle its result."""


class KnowledgeFSLifecycleSagaRunner:
    """Claim, deliver, and settle one command without holding a DB transaction over HTTP."""

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        remote: KnowledgeFSLifecycleRemotePort,
        metrics: KnowledgeFSOperationalMetricsPort | None = None,
    ):
        self._session_maker = session_maker
        self._remote = remote
        self._metrics = metrics or get_knowledge_fs_operational_metrics()

    def dispatch_one(
        self,
        *,
        worker_id: str,
        now: datetime,
        lease_duration: timedelta,
        product_enabled: bool,
    ) -> KnowledgeFSLifecycleDispatchResult:
        allowed_operations = tuple(KnowledgeFSLifecycleOperation)
        if not product_enabled:
            allowed_operations = tuple(
                operation
                for operation in allowed_operations
                if operation is not KnowledgeFSLifecycleOperation.PROVISION
            )
        with self._session_maker.begin() as session:
            command = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session).claim_next(
                lease_owner=worker_id,
                now=now,
                lease_duration=lease_duration,
                allowed_operations=allowed_operations,
            )
            if command is None:
                return KnowledgeFSLifecycleDispatchResult(False, False, None)
            claimed = _ClaimedCommand.from_model(command)

        self._record_task(claimed, status="running")
        try:
            return self._dispatch_claimed(claimed=claimed, now=now, product_enabled=product_enabled)
        except Exception:
            self._record_task(claimed, status="dispatch_error")
            raise

    def _dispatch_claimed(
        self,
        *,
        claimed: _ClaimedCommand,
        now: datetime,
        product_enabled: bool,
    ) -> KnowledgeFSLifecycleDispatchResult:
        try:
            if claimed.operation is KnowledgeFSLifecycleOperation.PROVISION:
                if self._settle_provision_without_delivery(claimed=claimed, completed_at=now):
                    return self._result(claimed, completed=True, settled_at=now)
                remote_space = self._remote.provision_integrated_space(_provision_request(claimed))
                self._complete_provision(claimed=claimed, remote_space=remote_space, completed_at=now)
                return self._result(claimed, completed=True, settled_at=now)
            if claimed.operation is KnowledgeFSLifecycleOperation.DELETE:
                if self._already_deleted(claimed=claimed, completed_at=now):
                    return self._result(claimed, completed=True, settled_at=now)
                if not product_enabled and self._complete_never_provisioned_deletion(
                    claimed=claimed,
                    completed_at=now,
                ):
                    return self._result(claimed, completed=True, settled_at=now)
                request = self._prepare_deletion_request(claimed)
                if request is None:
                    if not product_enabled and self._complete_remote_absent_deletion(
                        claimed=claimed,
                        observed_at=now,
                    ):
                        return self._result(claimed, completed=True, settled_at=now)
                    raise KnowledgeFSLifecycleRemoteError(
                        "KNOWLEDGE_FS_SPACE_NOT_FOUND",
                        "KnowledgeFS deletion identity could not be recovered",
                    )
                progress = self._remote.request_integrated_deletion(request)
                completed = self._settle_deletion(claimed=claimed, progress=progress, settled_at=now)
                return self._result(claimed, completed=completed, settled_at=now)
            if claimed.operation is KnowledgeFSLifecycleOperation.REVOKE:
                acknowledgment = self._remote.revoke_capability_grant(_revoke_request(claimed))
                completed = self._settle_revoke(
                    claimed=claimed,
                    acknowledgment=acknowledgment,
                    settled_at=now,
                )
                return self._result(claimed, completed=completed, settled_at=now)
            self._retry(
                claimed=claimed,
                now=now,
                error_code="UNSUPPORTED_OPERATION",
                error_message=f"Lifecycle operation {claimed.operation} is not dispatched yet",
            )
        except KnowledgeFSLifecycleRemoteError as exc:
            self._retry(claimed=claimed, now=now, error_code=exc.code, error_message=str(exc))
        return self._result(claimed, completed=False, settled_at=now)

    def _result(
        self,
        claimed: _ClaimedCommand,
        *,
        completed: bool,
        settled_at: datetime,
    ) -> KnowledgeFSLifecycleDispatchResult:
        self._record_task(
            claimed,
            status="succeeded" if completed else "retry",
            settled_at=settled_at if completed else None,
        )
        return KnowledgeFSLifecycleDispatchResult(True, completed, claimed.outbox_id)

    def _record_task(
        self,
        claimed: _ClaimedCommand,
        *,
        status: Literal["dispatch_error", "retry", "running", "succeeded"],
        settled_at: datetime | None = None,
    ) -> None:
        try:
            duration_seconds = None
            if settled_at is not None:
                duration_seconds = max(0.0, (settled_at - claimed.created_at).total_seconds())
            self._metrics.record_lifecycle_task(
                KnowledgeFSLifecycleTaskMetric(duration_seconds, claimed.operation.value, status)
            )
        except Exception:
            logger.warning(
                "KnowledgeFS lifecycle metric export failed operation=%s status=%s",
                claimed.operation.value,
                status,
                exc_info=True,
            )

    def _settle_provision_without_delivery(self, *, claimed: _ClaimedCommand, completed_at: datetime) -> bool:
        """ACK a provision already applied or superseded before crossing the HTTP boundary."""

        with self._session_maker.begin() as session:
            control_space = SQLAlchemyKnowledgeFSControlSpaceRepository(session).get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            still_owned = (
                control_space is not None
                and control_space.lifecycle_operation_id == claimed.operation_id
                and control_space.state is KnowledgeFSControlSpaceState.PROVISIONING
            )
            if still_owned:
                return False
            self._ack(
                SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session),
                claimed=claimed,
                completed_at=completed_at,
            )
            return True

    def _complete_never_provisioned_deletion(self, *, claimed: _ClaimedCommand, completed_at: datetime) -> bool:
        """Terminally delete a local intent proven never to have crossed the remote boundary."""

        with self._session_maker.begin() as session:
            control_repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            outbox_repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
            control_space = control_repository.get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            if (
                control_space is None
                or control_space.state is not KnowledgeFSControlSpaceState.DELETING
                or control_space.lifecycle_operation_id != claimed.operation_id
                or control_space.knowledge_space_id is not None
            ):
                return False
            provision = outbox_repository.find_open_for_control_space(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
                operation=KnowledgeFSLifecycleOperation.PROVISION,
            )
            if (
                provision is None
                or provision.status is not KnowledgeFSLifecycleOutboxStatus.PENDING
                or provision.attempt_count != 0
            ):
                return False
            if not outbox_repository.supersede_unattempted(
                outbox_id=provision.id,
                completed_at=completed_at,
                error_code="SUPERSEDED_BY_DELETE",
                error_message="Provision was canceled before delivery by permanent cleanup",
            ):
                return False
            KnowledgeFSControlSpaceLifecycleService(control_repository).transition(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
                expected_resource_version=control_space.resource_version,
                new_state=KnowledgeFSControlSpaceState.DELETED,
                lifecycle_operation_id=claimed.operation_id,
            )
            self._ack(outbox_repository, claimed=claimed, completed_at=completed_at)
            return True

    def _complete_remote_absent_deletion(self, *, claimed: _ClaimedCommand, observed_at: datetime) -> bool:
        """Finish cleanup after an authoritative remote listing proves the target absent."""

        with self._session_maker.begin() as session:
            control_repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            outbox_repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
            control_space = control_repository.get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            if (
                control_space is None
                or control_space.state is not KnowledgeFSControlSpaceState.DELETING
                or control_space.lifecycle_operation_id != claimed.operation_id
                or control_space.knowledge_space_id is not None
            ):
                return False
            provision = outbox_repository.find_latest_for_control_space(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
                operation=KnowledgeFSLifecycleOperation.PROVISION,
            )
            if provision is None or not outbox_repository.supersede_after_remote_absence(
                outbox_id=provision.id,
                observed_at=observed_at,
                error_code="SUPERSEDED_BY_DELETE",
                error_message="Remote absence was confirmed by permanent cleanup",
            ):
                return False
            KnowledgeFSControlSpaceLifecycleService(control_repository).transition(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
                expected_resource_version=control_space.resource_version,
                new_state=KnowledgeFSControlSpaceState.DELETED,
                lifecycle_operation_id=claimed.operation_id,
            )
            self._ack(outbox_repository, claimed=claimed, completed_at=observed_at)
            return True

    def _prepare_deletion_request(self, claimed: _ClaimedCommand) -> KnowledgeFSIntegratedDeletionRequest | None:
        """Resolve and durably register a lost-ACK remote identity before deletion admission."""

        with self._session_maker() as session:
            control_space = SQLAlchemyKnowledgeFSControlSpaceRepository(session).get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            if (
                control_space is None
                or control_space.state is not KnowledgeFSControlSpaceState.DELETING
                or control_space.lifecycle_operation_id != claimed.operation_id
            ):
                raise KnowledgeFSLifecycleLeaseLostError("Delete command no longer owns the control-space")
            if control_space.knowledge_space_id is not None:
                return _resolved_deletion_request(
                    claimed,
                    knowledge_space_id=control_space.knowledge_space_id,
                    expected_revision=control_space.knowledge_space_revision,
                )

        payload = cast(KnowledgeFSDeleteCommandPayload, claimed.command_payload)
        recovered = self._remote.find_by_provisioning_key(
            provisioning_key=payload["provisioning_key"],
            control_space_id=claimed.control_space_id,
        )
        if recovered is None:
            return None
        if recovered.namespace_id != claimed.tenant_id:
            raise KnowledgeFSLifecycleRemoteError(
                "KNOWLEDGE_FS_SCOPE_MISMATCH",
                "KnowledgeFS recovered deletion identity crossed its namespace",
            )

        with self._session_maker.begin() as session:
            repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            control_space = repository.get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            if (
                control_space is None
                or control_space.state is not KnowledgeFSControlSpaceState.DELETING
                or control_space.lifecycle_operation_id != claimed.operation_id
            ):
                raise KnowledgeFSLifecycleLeaseLostError("Delete command lost ownership during identity recovery")
            if control_space.knowledge_space_id is None:
                changed = repository.compare_and_set_lifecycle(
                    KnowledgeFSControlSpaceCASUpdate(
                        tenant_id=claimed.tenant_id,
                        control_space_id=claimed.control_space_id,
                        expected_resource_version=control_space.resource_version,
                        expected_state=KnowledgeFSControlSpaceState.DELETING,
                        new_state=KnowledgeFSControlSpaceState.DELETING,
                        lifecycle_operation_id=claimed.operation_id,
                        knowledge_space_id=recovered.knowledge_space_id,
                        knowledge_space_revision=recovered.revision,
                    )
                )
                if not changed:
                    raise KnowledgeFSLifecycleLeaseLostError(
                        "Delete command lost ownership while registering its remote identity"
                    )
                knowledge_space_id = recovered.knowledge_space_id
                expected_revision = recovered.revision
            else:
                if control_space.knowledge_space_id != recovered.knowledge_space_id:
                    raise KnowledgeFSLifecycleLeaseLostError("Recovered deletion identity conflicts with registration")
                knowledge_space_id = control_space.knowledge_space_id
                expected_revision = control_space.knowledge_space_revision
        return _resolved_deletion_request(
            claimed,
            knowledge_space_id=knowledge_space_id,
            expected_revision=expected_revision,
        )

    def _complete_provision(
        self,
        *,
        claimed: _ClaimedCommand,
        remote_space: KnowledgeFSRemoteSpace,
        completed_at: datetime,
    ) -> None:
        with self._session_maker.begin() as session:
            control_repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            outbox_repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
            control_space = control_repository.get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            if control_space is None or remote_space.namespace_id != claimed.tenant_id:
                raise KnowledgeFSLifecycleLeaseLostError("Provision response did not match its Dify control-space")
            already_applied = (
                control_space.state is KnowledgeFSControlSpaceState.ACTIVE
                and control_space.lifecycle_operation_id == claimed.operation_id
                and control_space.knowledge_space_id == remote_space.knowledge_space_id
                and control_space.knowledge_space_revision >= remote_space.revision
            )
            if not already_applied:
                if control_space.lifecycle_operation_id != claimed.operation_id:
                    raise KnowledgeFSLifecycleLeaseLostError("Provision command no longer owns the control-space")
                KnowledgeFSControlSpaceLifecycleService(control_repository).transition(
                    tenant_id=claimed.tenant_id,
                    control_space_id=claimed.control_space_id,
                    expected_resource_version=control_space.resource_version,
                    new_state=KnowledgeFSControlSpaceState.ACTIVE,
                    lifecycle_operation_id=claimed.operation_id,
                    knowledge_space_id=remote_space.knowledge_space_id,
                    knowledge_space_revision=remote_space.revision,
                )
            self._ack(outbox_repository, claimed=claimed, completed_at=completed_at)

    def _already_deleted(self, *, claimed: _ClaimedCommand, completed_at: datetime) -> bool:
        with self._session_maker.begin() as session:
            control_space = SQLAlchemyKnowledgeFSControlSpaceRepository(session).get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            if control_space is None or control_space.state is not KnowledgeFSControlSpaceState.DELETED:
                return False
            self._ack(
                SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session),
                claimed=claimed,
                completed_at=completed_at,
            )
            return True

    def _settle_deletion(self, *, claimed: _ClaimedCommand, progress: object, settled_at: datetime) -> bool:
        from services.knowledge_fs.lifecycle_port import KnowledgeFSDeletionProgress

        if not isinstance(progress, KnowledgeFSDeletionProgress):
            raise TypeError("Deletion port returned an invalid progress value")
        with self._session_maker.begin() as session:
            control_repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            outbox_repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
            control_space = control_repository.get(
                tenant_id=claimed.tenant_id,
                control_space_id=claimed.control_space_id,
            )
            if control_space is None or control_space.lifecycle_operation_id != claimed.operation_id:
                raise KnowledgeFSLifecycleLeaseLostError("Delete command no longer owns the control-space")
            if progress.phase in {KnowledgeFSDeletionPhase.IRREVERSIBLE, KnowledgeFSDeletionPhase.COMPLETED}:
                irreversible_at = progress.irreversible_at or settled_at
                if control_space.deletion_irreversible_at is None:
                    KnowledgeFSControlSpaceLifecycleService(control_repository).mark_deletion_irreversible(
                        tenant_id=claimed.tenant_id,
                        control_space_id=claimed.control_space_id,
                        lifecycle_operation_id=claimed.operation_id,
                        irreversible_at=irreversible_at,
                    )
                    control_space = control_repository.get(
                        tenant_id=claimed.tenant_id,
                        control_space_id=claimed.control_space_id,
                    )
                    if control_space is None:
                        raise KnowledgeFSLifecycleLeaseLostError("Control-space disappeared during deletion")
            if progress.phase is KnowledgeFSDeletionPhase.COMPLETED:
                KnowledgeFSControlSpaceLifecycleService(control_repository).transition(
                    tenant_id=claimed.tenant_id,
                    control_space_id=claimed.control_space_id,
                    expected_resource_version=control_space.resource_version,
                    new_state=KnowledgeFSControlSpaceState.DELETED,
                    lifecycle_operation_id=claimed.operation_id,
                    knowledge_space_revision=max(control_space.knowledge_space_revision, progress.revision),
                )
                self._ack(outbox_repository, claimed=claimed, completed_at=settled_at)
                return True
            if not outbox_repository.schedule_retry(
                outbox_id=claimed.outbox_id,
                lease_owner=claimed.lease_owner,
                expected_lease_expires_at=claimed.lease_expires_at,
                next_attempt_at=settled_at + _retry_delay(claimed.attempt_count),
                error_code="REMOTE_DELETION_PENDING",
                error_message=f"KnowledgeFS deletion is {progress.phase}",
            ):
                raise KnowledgeFSLifecycleLeaseLostError("Delete command lease was lost before retry scheduling")
            return False

    def _settle_revoke(
        self,
        *,
        claimed: _ClaimedCommand,
        acknowledgment: object,
        settled_at: datetime,
    ) -> bool:
        if not isinstance(acknowledgment, KnowledgeFSCapabilityGrantRevokeAck):
            raise TypeError("Capability revoke port returned an invalid acknowledgment")
        payload = cast(KnowledgeFSRevokeCommandPayload, claimed.command_payload)
        if acknowledgment.state == "revoked" and acknowledgment.highest_revoke_sequence >= payload["revoke_sequence"]:
            with self._session_maker.begin() as session:
                self._ack(
                    SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session),
                    claimed=claimed,
                    completed_at=settled_at,
                )
            return True
        self._retry(
            claimed=claimed,
            now=settled_at,
            error_code="REMOTE_REVOKE_WATERMARK_LAG",
            error_message="KnowledgeFS grant revoke acknowledgment is below the command watermark",
        )
        return False

    def _retry(self, *, claimed: _ClaimedCommand, now: datetime, error_code: str, error_message: str) -> None:
        with self._session_maker.begin() as session:
            changed = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session).schedule_retry(
                outbox_id=claimed.outbox_id,
                lease_owner=claimed.lease_owner,
                expected_lease_expires_at=claimed.lease_expires_at,
                next_attempt_at=now + _retry_delay(claimed.attempt_count),
                error_code=error_code,
                error_message=error_message,
            )
            if not changed:
                raise KnowledgeFSLifecycleLeaseLostError("Lifecycle command lease was lost before retry scheduling")

    @staticmethod
    def _ack(
        repository: SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
        *,
        claimed: _ClaimedCommand,
        completed_at: datetime,
    ) -> None:
        if not repository.acknowledge(
            outbox_id=claimed.outbox_id,
            lease_owner=claimed.lease_owner,
            expected_lease_expires_at=claimed.lease_expires_at,
            completed_at=completed_at,
        ):
            raise KnowledgeFSLifecycleLeaseLostError("Lifecycle command lease was lost before ACK")


class _ClaimedCommand(NamedTuple):
    outbox_id: str
    tenant_id: str
    control_space_id: str
    operation_id: str
    idempotency_key: str
    operation: KnowledgeFSLifecycleOperation
    command_payload: dict[str, object]
    attempt_count: int
    lease_owner: str
    lease_expires_at: datetime
    created_at: datetime

    @classmethod
    def from_model(cls, command: KnowledgeFSLifecycleOutbox) -> _ClaimedCommand:
        if (
            command.status is not KnowledgeFSLifecycleOutboxStatus.PROCESSING
            or command.lease_owner is None
            or command.lease_expires_at is None
        ):
            raise KnowledgeFSLifecycleLeaseLostError("Claimed command did not carry a complete lease")
        return cls(
            command.id,
            command.tenant_id,
            command.control_space_id,
            command.operation_id,
            command.idempotency_key,
            command.operation,
            cast(dict[str, object], command.command_payload),
            command.attempt_count,
            command.lease_owner,
            command.lease_expires_at,
            command.created_at,
        )


def _provision_request(command: _ClaimedCommand) -> KnowledgeFSIntegratedProvisionRequest:
    payload = cast(KnowledgeFSProvisionCommandPayload, command.command_payload)
    return KnowledgeFSIntegratedProvisionRequest(
        namespace_id=command.tenant_id,
        control_space_id=command.control_space_id,
        operation_id=command.operation_id,
        idempotency_key=command.idempotency_key,
        provisioning_key=payload["provisioning_key"],
        name=payload["name"],
        slug=payload["slug"],
        icon=payload["icon"],
        description=payload["description"],
        model_intent=payload["model_intent"],
        profile_intent=payload["profile_intent"],
    )


def _resolved_deletion_request(
    command: _ClaimedCommand,
    *,
    knowledge_space_id: str,
    expected_revision: int,
) -> KnowledgeFSIntegratedDeletionRequest:
    payload = cast(KnowledgeFSDeleteCommandPayload, command.command_payload)
    return KnowledgeFSIntegratedDeletionRequest(
        namespace_id=command.tenant_id,
        control_space_id=command.control_space_id,
        operation_id=command.operation_id,
        idempotency_key=command.idempotency_key,
        knowledge_space_id=knowledge_space_id,
        provisioning_key=payload["provisioning_key"],
        expected_revision=expected_revision,
    )


def _revoke_request(command: _ClaimedCommand) -> KnowledgeFSCapabilityGrantRevokeRequest:
    payload = cast(KnowledgeFSRevokeCommandPayload, command.command_payload)
    return KnowledgeFSCapabilityGrantRevokeRequest(
        namespace_id=command.tenant_id,
        control_space_id=command.control_space_id,
        operation_id=command.operation_id,
        idempotency_key=command.idempotency_key,
        knowledge_space_id=payload["knowledge_space_id"],
        grant_id=payload["grant_id"],
        event_id=payload["event_id"],
        reason_code=payload["reason_code"],
        revoke_sequence=payload["revoke_sequence"],
        expected_revision=payload["expected_revision"],
    )


def _retry_delay(attempt_count: int) -> timedelta:
    return timedelta(seconds=min(300, 2 ** min(attempt_count, 8)))


__all__ = [
    "KnowledgeFSLifecycleDispatchResult",
    "KnowledgeFSLifecycleLeaseLostError",
    "KnowledgeFSLifecycleSagaRunner",
]
