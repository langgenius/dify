"""Idempotent durable worker orchestration for IM Contact synchronization."""

from __future__ import annotations

from collections.abc import Callable

from core.human_input_v2.im_integration import IMSyncRun
from core.human_input_v2.shared import DirectoryScope, IMSyncRunId

from .coordinator import IMChannelReconciliationService, IMSyncRetryableError
from .service import IMSyncRunNotFoundError, IMSyncService

type ReconciliationServiceFactory = Callable[[DirectoryScope], IMChannelReconciliationService]


class IMContactSyncWorker:
    """Resolve owner context before entering Channel-bound reconciliation."""

    def __init__(self, sync_service: IMSyncService, reconciliation_factory: ReconciliationServiceFactory) -> None:
        self._sync_service = sync_service
        self._reconciliation_factory = reconciliation_factory

    def execute(self, sync_run_id: IMSyncRunId, owner_scope: DirectoryScope) -> IMSyncRun:
        persisted_run = self._sync_service.load_run(sync_run_id)
        if persisted_run is None:
            raise IMSyncRunNotFoundError("IM synchronization run was not found")
        if not persisted_run.is_active:
            return persisted_run
        terminal_run = self._reconciliation_factory(owner_scope).reconcile(sync_run_id)
        if terminal_run.is_active:
            raise IMSyncRetryableError("IM synchronization did not reach a persisted terminal state")
        return terminal_run


__all__ = ["IMContactSyncWorker", "ReconciliationServiceFactory"]
