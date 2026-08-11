"""Idempotent durable worker orchestration for IM Contact synchronization."""

from __future__ import annotations

import logging
from typing import Protocol

from core.human_input_v2.im_integration import IMSyncRun
from core.human_input_v2.shared import DirectoryScope, IMSyncRunId

from .coordinator import IMSyncRetryableError
from .service import IMSyncRunNotFoundError

logger = logging.getLogger(__name__)


class _SyncRunReader(Protocol):
    def load_sync_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None: ...


class _SyncCoordinator(Protocol):
    def reconcile(self, sync_run_id: IMSyncRunId, organization_scope: DirectoryScope) -> IMSyncRun: ...


class IMContactSyncWorker:
    """Short-circuit terminal redelivery before constructing Provider resources."""

    def __init__(self, repository: _SyncRunReader, coordinator: _SyncCoordinator) -> None:
        self._repository = repository
        self._coordinator = coordinator

    def execute(self, sync_run_id: IMSyncRunId, organization_scope: DirectoryScope) -> IMSyncRun:
        persisted_run = self._repository.load_sync_run(sync_run_id)
        if persisted_run is None:
            raise IMSyncRunNotFoundError("IM synchronization run was not found")
        logger.info(
            "IM Contact sync worker delivery, sync_run_id=%s, integration_id=%s, status=%s",
            persisted_run.id,
            persisted_run.integration_revision.integration_id,
            persisted_run.status.value,
        )
        if not persisted_run.is_active:
            return persisted_run
        terminal_run = self._coordinator.reconcile(sync_run_id, organization_scope)
        if terminal_run.is_active:
            raise IMSyncRetryableError("IM synchronization did not reach a persisted terminal state")
        return terminal_run


__all__ = ["IMContactSyncWorker"]
