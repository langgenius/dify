"""Provider I/O and guarded reconciliation orchestration for one sync run."""

from __future__ import annotations

import logging
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from typing import Protocol

import sqlalchemy as sa
from pydantic import NaiveDatetime
from sqlalchemy import event
from sqlalchemy.orm import Session

from core.human_input_v2.im_integration import (
    ApplyReconciliationResult,
    ApplyReconciliationStatus,
    BlockedReconciliation,
    IMIntegration,
    IMSyncRepository,
    IMSyncRun,
    ReconciliationInput,
    ReconciliationPlan,
    ReconciliationRunRef,
    SyncReconciler,
)
from core.human_input_v2.im_integration.adapters import IMProviderAdapter
from core.human_input_v2.im_integration.adapters.entities import Directory, DirectoryEntry, DirectoryReadFailure
from core.human_input_v2.shared import (
    DeploymentScope,
    DirectoryScope,
    IMSyncRunId,
    TenantId,
    WorkspaceScope,
)
from libs.datetime_utils import naive_utc_now
from repositories.human_input_v2.organization_write_unit_of_work import OwnedOrganizationWriteLock
from services.human_input_v2.im_credential_codec import IMCredentialError

from .locking import OrganizationIMWriteLockLostError, OrganizationIMWriteLockUnavailableError
from .service import IMSyncRunNotFoundError

logger = logging.getLogger(__name__)

_CREDENTIAL_UNAVAILABLE_MESSAGE = "IM credential configuration is unavailable."


class IMSyncRetryableError(RuntimeError):
    """A transient serialization failure requires worker redelivery."""


class _ReconciliationPlanner(Protocol):
    def generate_plan(
        self, reconciliation_input: ReconciliationInput
    ) -> ReconciliationPlan | BlockedReconciliation: ...


class _ProtectedReconciliationRepository(Protocol):
    def load_reconciliation_input(
        self,
        run: ReconciliationRunRef,
        directory_entries: tuple[DirectoryEntry, ...],
        contact_scope: DirectoryScope,
    ) -> ReconciliationInput: ...

    def apply_plan(self, plan: ReconciliationPlan, *, now: NaiveDatetime) -> ApplyReconciliationResult: ...

    def fail_run(
        self,
        sync_run_id: IMSyncRunId,
        status: ApplyReconciliationStatus,
        *,
        now: NaiveDatetime,
        message: str,
    ) -> ApplyReconciliationResult: ...


type _ReconciliationSessionFactory = Callable[[], AbstractContextManager[Session]]
type _ReconciliationWriteLockFactory = Callable[[DirectoryScope], OwnedOrganizationWriteLock]
type _ReconciliationRepositoryFactory = Callable[
    [Session, OwnedOrganizationWriteLock],
    _ProtectedReconciliationRepository,
]


class IMContactSyncCoordinator:
    """Keep Directory I/O outside the Organization-serialized apply transaction."""

    def __init__(
        self,
        repository: IMSyncRepository,
        adapter_factory: Callable[[IMIntegration], IMProviderAdapter],
        session_factory: _ReconciliationSessionFactory,
        write_lock_factory: _ReconciliationWriteLockFactory,
        reconciliation_repository_factory: _ReconciliationRepositoryFactory,
        *,
        planner: _ReconciliationPlanner | None = None,
        clock: Callable[[], NaiveDatetime] = naive_utc_now,
    ) -> None:
        self._repository = repository
        self._adapter_factory = adapter_factory
        self._session_factory = session_factory
        self._write_lock_factory = write_lock_factory
        self._reconciliation_repository_factory = reconciliation_repository_factory
        self._planner = planner or SyncReconciler()
        self._clock = clock

    def reconcile(self, sync_run_id: IMSyncRunId, organization_scope: DirectoryScope) -> IMSyncRun:
        run = self._require_run(sync_run_id)
        if not run.is_active:
            return run
        integration = self._repository.load_current_integration(_tenant_id(organization_scope))
        if (
            integration is None
            or integration.revision != run.integration_revision
            or integration.provider_tenant.provider != run.provider
        ):
            return self._persist_failure(
                run.id,
                organization_scope,
                ApplyReconciliationStatus.STALE_REVISION,
                "IM Integration revision changed before synchronization.",
            )

        adapter: IMProviderAdapter | None = None
        try:
            adapter = self._adapter_factory(integration)
        except IMCredentialError:
            logger.warning(
                "IM Contact credentials are unavailable, sync_run_id=%s, integration_id=%s",
                run.id,
                run.integration_revision.integration_id,
            )
        if adapter is None:
            return self._persist_failure(
                run.id,
                organization_scope,
                ApplyReconciliationStatus.DIRECTORY_READ_FAILED,
                _CREDENTIAL_UNAVAILABLE_MESSAGE,
            )
        try:
            try:
                directory_result = adapter.directory.read_directory()
            except Exception:
                logger.exception(
                    "IM Contact directory read raised unexpectedly, sync_run_id=%s, integration_id=%s",
                    run.id,
                    run.integration_revision.integration_id,
                )
                return self._persist_failure(
                    run.id,
                    organization_scope,
                    ApplyReconciliationStatus.DIRECTORY_READ_FAILED,
                    "Provider directory could not be read.",
                )
            if isinstance(directory_result, DirectoryReadFailure):
                logger.warning(
                    "IM Contact directory read failed, sync_run_id=%s, integration_id=%s, reason=%s",
                    run.id,
                    run.integration_revision.integration_id,
                    directory_result.reason,
                )
                return self._persist_failure(
                    run.id,
                    organization_scope,
                    ApplyReconciliationStatus.DIRECTORY_READ_FAILED,
                    "Provider directory could not be read.",
                )
            return self._apply_directory(run, organization_scope, directory_result)
        finally:
            try:
                adapter.close()
            except Exception:
                logger.exception(
                    "IM Provider adapter close failed, sync_run_id=%s, integration_id=%s",
                    run.id,
                    run.integration_revision.integration_id,
                )

    def _apply_directory(
        self,
        run: IMSyncRun,
        organization_scope: DirectoryScope,
        directory: Directory,
    ) -> IMSyncRun:
        run_ref = ReconciliationRunRef(run.id, run.integration_revision, run.provider)
        try:
            with self._reconciliation_transaction(organization_scope) as protected_repository:
                reconciliation_input = protected_repository.load_reconciliation_input(
                    run_ref,
                    directory.entries,
                    organization_scope,
                )
                plan = self._planner.generate_plan(reconciliation_input)
                if isinstance(plan, BlockedReconciliation):
                    blocker_codes = ",".join(blocker.code.value for blocker in plan.blockers)
                    protected_repository.fail_run(
                        run.id,
                        ApplyReconciliationStatus.PLAN_BLOCKED,
                        now=self._clock(),
                        message=f"Reconciliation input was blocked: {blocker_codes}.",
                    )
                    apply_result = None
                else:
                    apply_result = protected_repository.apply_plan(plan, now=self._clock())
                    if apply_result.status in (
                        ApplyReconciliationStatus.LOCK_UNAVAILABLE,
                        ApplyReconciliationStatus.LOCK_LOST,
                    ):
                        raise IMSyncRetryableError(apply_result.status.value)
        except (OrganizationIMWriteLockUnavailableError, OrganizationIMWriteLockLostError) as error:
            raise IMSyncRetryableError("Organization IM write lock requires retry") from error
        except IMSyncRetryableError:
            raise
        except Exception:
            logger.exception(
                "IM Contact reconciliation apply failed unexpectedly, sync_run_id=%s, integration_id=%s",
                run.id,
                run.integration_revision.integration_id,
            )
            return self._persist_failure(
                run.id,
                organization_scope,
                ApplyReconciliationStatus.UNEXPECTED_APPLY_FAILURE,
                "IM reconciliation could not be applied.",
            )

        if apply_result is not None:
            self._log_collision_warnings(run, apply_result)
        return self._require_run(run.id)

    def _persist_failure(
        self,
        sync_run_id: IMSyncRunId,
        organization_scope: DirectoryScope,
        status: ApplyReconciliationStatus,
        message: str,
    ) -> IMSyncRun:
        try:
            with self._reconciliation_transaction(organization_scope) as protected_repository:
                protected_repository.fail_run(sync_run_id, status, now=self._clock(), message=message)
        except (OrganizationIMWriteLockUnavailableError, OrganizationIMWriteLockLostError) as error:
            raise IMSyncRetryableError("Organization IM write lock requires retry") from error
        return self._require_run(sync_run_id)

    @contextmanager
    def _reconciliation_transaction(
        self,
        organization_scope: DirectoryScope,
    ) -> Generator[_ProtectedReconciliationRepository]:
        """Acquire the Organization lock before opening one caller-owned transaction."""

        write_lock = self._write_lock_factory(organization_scope)
        with write_lock:
            with self._session_factory() as session:

                def ensure_lock_owned_before_commit(_session: Session) -> None:
                    write_lock.ensure_owned()

                event.listen(session, "before_commit", ensure_lock_owned_before_commit)
                try:
                    with session.begin():
                        if session.get_bind().dialect.name == "sqlite":
                            # SQLite SAVEPOINT does not start the outer transaction in
                            # legacy mode, so make the caller-owned rollback boundary real.
                            session.execute(sa.text("BEGIN"))
                        protected_repository = self._reconciliation_repository_factory(session, write_lock)
                        yield protected_repository
                        write_lock.ensure_owned()
                finally:
                    event.remove(session, "before_commit", ensure_lock_owned_before_commit)

    def _require_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun:
        run = self._repository.load_sync_run(sync_run_id)
        if run is None:
            raise IMSyncRunNotFoundError("IM synchronization run was not found")
        return run

    @staticmethod
    def _log_collision_warnings(run: IMSyncRun, apply_result: ApplyReconciliationResult) -> None:
        collision_group_count = len(apply_result.warnings)
        for warning in apply_result.warnings:
            logger.warning(
                "IM Contact email collision, sync_run_id=%s, integration_id=%s, collision_group_count=%d, "
                "warning_key=%s, im_identity_ids=%s, contact_ids=%s",
                run.id,
                run.integration_revision.integration_id,
                collision_group_count,
                warning.warning_key,
                tuple(str(identity_id) for identity_id in warning.identity_ids),
                tuple(str(contact_id) for contact_id in warning.contact_ids),
            )


def _tenant_id(organization_scope: DirectoryScope) -> TenantId | None:
    if isinstance(organization_scope, WorkspaceScope):
        return organization_scope.id
    if isinstance(organization_scope, DeploymentScope):
        return None
    raise TypeError("unsupported Organization scope")


__all__ = [
    "IMContactSyncCoordinator",
    "IMSyncRetryableError",
]
