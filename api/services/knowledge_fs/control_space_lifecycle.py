"""Local CAS lifecycle rules for KnowledgeFS control-spaces.

P1A persists lifecycle intent only. This service deliberately has no
KnowledgeFS client or task dispatcher, so deploying it cannot emit P1B remote
traffic.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from datetime import datetime

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from repositories.knowledge_fs_control_space_repository import (
    KnowledgeFSControlSpaceCASUpdate,
    KnowledgeFSControlSpaceRepository,
)
from services.knowledge_fs.observability import (
    KnowledgeFSControlSpaceStateMetric,
    KnowledgeFSOperationalMetricsPort,
    get_knowledge_fs_operational_metrics,
)

logger = logging.getLogger(__name__)


class KnowledgeFSControlSpaceLifecycleError(RuntimeError):
    """Base error for a rejected local control-space lifecycle operation."""


class KnowledgeFSControlSpaceNotFoundError(KnowledgeFSControlSpaceLifecycleError):
    pass


class KnowledgeFSControlSpaceVersionConflictError(KnowledgeFSControlSpaceLifecycleError):
    pass


class KnowledgeFSInvalidLifecycleTransitionError(KnowledgeFSControlSpaceLifecycleError):
    pass


class KnowledgeFSSpaceRegistrationConflictError(KnowledgeFSControlSpaceLifecycleError):
    pass


class KnowledgeFSWorkspaceDeletionBlockedError(KnowledgeFSControlSpaceLifecycleError):
    def __init__(self, control_space_ids: tuple[str, ...]):
        self.control_space_ids = control_space_ids
        super().__init__("Workspace deletion is blocked by non-terminal KnowledgeFS control-spaces")


_ALLOWED_TRANSITIONS: Mapping[KnowledgeFSControlSpaceState, frozenset[KnowledgeFSControlSpaceState]] = {
    KnowledgeFSControlSpaceState.PROVISIONING: frozenset(
        {
            KnowledgeFSControlSpaceState.ACTIVE,
            KnowledgeFSControlSpaceState.DELETING,
            KnowledgeFSControlSpaceState.ERROR,
        }
    ),
    KnowledgeFSControlSpaceState.ACTIVE: frozenset(
        {KnowledgeFSControlSpaceState.DELETING, KnowledgeFSControlSpaceState.ERROR}
    ),
    KnowledgeFSControlSpaceState.DELETING: frozenset(
        {KnowledgeFSControlSpaceState.DELETED, KnowledgeFSControlSpaceState.ERROR}
    ),
    KnowledgeFSControlSpaceState.ERROR: frozenset(
        {
            KnowledgeFSControlSpaceState.PROVISIONING,
            KnowledgeFSControlSpaceState.ACTIVE,
            KnowledgeFSControlSpaceState.DELETING,
        }
    ),
    KnowledgeFSControlSpaceState.DELETED: frozenset(),
}


class KnowledgeFSControlSpaceLifecycleService:
    """Validate lifecycle invariants and persist transitions through a CAS."""

    def __init__(
        self,
        repository: KnowledgeFSControlSpaceRepository,
        *,
        metrics: KnowledgeFSOperationalMetricsPort | None = None,
    ) -> None:
        self._repository = repository
        self._metrics = metrics or get_knowledge_fs_operational_metrics()

    def transition(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        expected_resource_version: int,
        new_state: KnowledgeFSControlSpaceState,
        lifecycle_operation_id: str,
        knowledge_space_id: str | None = None,
        knowledge_space_revision: int | None = None,
        last_error_code: str | None = None,
        last_error_message: str | None = None,
    ) -> KnowledgeFSControlSpace:
        control_space = self._repository.get(tenant_id=tenant_id, control_space_id=control_space_id)
        if control_space is None:
            raise KnowledgeFSControlSpaceNotFoundError("KnowledgeFS control-space was not found in this tenant")
        if control_space.resource_version != expected_resource_version:
            raise KnowledgeFSControlSpaceVersionConflictError("KnowledgeFS control-space resource version changed")
        if control_space.deletion_irreversible_at is not None and new_state in {
            KnowledgeFSControlSpaceState.ACTIVE,
            KnowledgeFSControlSpaceState.PROVISIONING,
        }:
            raise KnowledgeFSInvalidLifecycleTransitionError(
                "KnowledgeFS control-space deletion is irreversible and cannot be recovered"
            )
        if new_state not in _ALLOWED_TRANSITIONS[control_space.state]:
            raise KnowledgeFSInvalidLifecycleTransitionError(
                f"Cannot transition KnowledgeFS control-space from {control_space.state} to {new_state}"
            )

        registered_space_id = control_space.knowledge_space_id
        if registered_space_id is not None and knowledge_space_id not in {None, registered_space_id}:
            raise KnowledgeFSSpaceRegistrationConflictError("KnowledgeFS Space registration is immutable")
        effective_space_id = knowledge_space_id or registered_space_id
        if new_state is KnowledgeFSControlSpaceState.ACTIVE and effective_space_id is None:
            raise KnowledgeFSSpaceRegistrationConflictError("An active control-space must have a KnowledgeFS Space ID")
        if knowledge_space_revision is not None and knowledge_space_revision < control_space.knowledge_space_revision:
            raise KnowledgeFSControlSpaceVersionConflictError("KnowledgeFS Space revision moved backwards")
        previous_state = control_space.state
        previous_updated_at = control_space.updated_at

        changed = self._repository.compare_and_set_lifecycle(
            KnowledgeFSControlSpaceCASUpdate(
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                expected_resource_version=expected_resource_version,
                expected_state=control_space.state,
                new_state=new_state,
                lifecycle_operation_id=lifecycle_operation_id,
                knowledge_space_id=knowledge_space_id,
                knowledge_space_revision=knowledge_space_revision,
                last_error_code=last_error_code,
                last_error_message=last_error_message,
            )
        )
        if not changed:
            raise KnowledgeFSControlSpaceVersionConflictError("KnowledgeFS control-space changed during transition")

        transitioned = self._repository.get(tenant_id=tenant_id, control_space_id=control_space_id)
        if transitioned is None:
            raise KnowledgeFSControlSpaceNotFoundError("KnowledgeFS control-space disappeared after transition")
        self._record_state_metric(
            previous_state=previous_state,
            previous_updated_at=previous_updated_at,
            transitioned=transitioned,
        )
        return transitioned

    def _record_state_metric(
        self,
        *,
        previous_state: KnowledgeFSControlSpaceState,
        previous_updated_at: datetime,
        transitioned: KnowledgeFSControlSpace,
    ) -> None:
        try:
            duration_seconds = max(0.0, (transitioned.updated_at - previous_updated_at).total_seconds())
            self._metrics.record_control_space_state(
                KnowledgeFSControlSpaceStateMetric(
                    duration_seconds,
                    previous_state.value,
                    transitioned.state.value,
                )
            )
        except Exception:
            logger.warning("KnowledgeFS control-space state metric export failed", exc_info=True)

    def mark_deletion_irreversible(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        lifecycle_operation_id: str,
        irreversible_at: datetime,
    ) -> None:
        """Persist the monotonic point after which product recovery is forbidden."""

        changed = self._repository.mark_deletion_irreversible(
            tenant_id=tenant_id,
            control_space_id=control_space_id,
            lifecycle_operation_id=lifecycle_operation_id,
            irreversible_at=irreversible_at,
        )
        if not changed:
            raise KnowledgeFSControlSpaceVersionConflictError(
                "KnowledgeFS control-space changed before deletion became irreversible"
            )

    def assert_workspace_deletion_allowed(self, *, tenant_id: str) -> None:
        """Fence tenant deletion until every control-space reaches ``deleted``."""

        blocking_ids = self._repository.list_workspace_deletion_blockers(tenant_id=tenant_id)
        if blocking_ids:
            raise KnowledgeFSWorkspaceDeletionBlockedError(blocking_ids)


__all__ = [
    "KnowledgeFSControlSpaceLifecycleError",
    "KnowledgeFSControlSpaceLifecycleService",
    "KnowledgeFSControlSpaceNotFoundError",
    "KnowledgeFSControlSpaceVersionConflictError",
    "KnowledgeFSInvalidLifecycleTransitionError",
    "KnowledgeFSSpaceRegistrationConflictError",
    "KnowledgeFSWorkspaceDeletionBlockedError",
]
