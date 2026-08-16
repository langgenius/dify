"""Idempotent worker and Celery-boundary tests for IM Contact sync."""

from __future__ import annotations

import logging
from dataclasses import replace
from datetime import datetime

import pytest

from core.human_input_v2.entities import IMProvider, IMSyncRunStatus
from core.human_input_v2.im_integration import IMSyncRun, IntegrationRevisionToken
from core.human_input_v2.shared import IMSyncRunId, IntegrationId, TenantId, WorkspaceScope
from services.human_input_v2.im_contact_sync.coordinator import IMSyncRetryableError
from services.human_input_v2.im_contact_sync.worker import IMContactSyncWorker
from tasks import im_contact_sync_tasks

_NOW = datetime(2026, 8, 11, 8)
_SCOPE = WorkspaceScope(id=TenantId("workspace-1"))


def _queued_run() -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=IntegrationRevisionToken(IntegrationId("integration-1"), 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=_NOW,
    )


def _terminal_run(status: IMSyncRunStatus = IMSyncRunStatus.SUCCEEDED) -> IMSyncRun:
    return replace(
        _queued_run(),
        status=status,
        started_at=_NOW,
        finished_at=_NOW,
        updated_at=_NOW,
    )


class _Repository:
    def __init__(self, run: IMSyncRun | None) -> None:
        self.run = run

    def load_sync_run(self, sync_run_id: IMSyncRunId) -> IMSyncRun | None:
        assert sync_run_id == IMSyncRunId("run-1")
        return self.run


class _Coordinator:
    def __init__(self, terminal_run: IMSyncRun) -> None:
        self.terminal_run = terminal_run
        self.calls: list[tuple[IMSyncRunId, WorkspaceScope]] = []
        self.error: Exception | None = None

    def reconcile(self, sync_run_id: IMSyncRunId, scope: WorkspaceScope) -> IMSyncRun:
        self.calls.append((sync_run_id, scope))
        if self.error is not None:
            raise self.error
        return self.terminal_run


def test_terminal_redelivery_returns_persisted_state_without_reconciliation(
    caplog: pytest.LogCaptureFixture,
) -> None:
    persisted_run = _terminal_run()
    repository = _Repository(persisted_run)
    coordinator = _Coordinator(persisted_run)
    worker = IMContactSyncWorker(repository, coordinator)

    with caplog.at_level(logging.INFO):
        result = worker.execute(persisted_run.id, _SCOPE)

    assert result is persisted_run
    assert coordinator.calls == []
    assert "run-1" in caplog.text
    assert "integration-1" in caplog.text


def test_active_delivery_reconciles_once_and_returns_terminal_state() -> None:
    terminal_run = _terminal_run()
    repository = _Repository(_queued_run())
    coordinator = _Coordinator(terminal_run)
    worker = IMContactSyncWorker(repository, coordinator)

    result = worker.execute(IMSyncRunId("run-1"), _SCOPE)

    assert result is terminal_run
    assert coordinator.calls == [(IMSyncRunId("run-1"), _SCOPE)]


def test_duplicate_delivery_returns_first_persisted_result_without_reconciliation() -> None:
    terminal_run = _terminal_run()
    repository = _Repository(_queued_run())

    class PersistingCoordinator(_Coordinator):
        def reconcile(self, sync_run_id: IMSyncRunId, scope: WorkspaceScope) -> IMSyncRun:
            result = super().reconcile(sync_run_id, scope)
            repository.run = result
            return result

    coordinator = PersistingCoordinator(terminal_run)
    worker = IMContactSyncWorker(repository, coordinator)

    first_result = worker.execute(IMSyncRunId("run-1"), _SCOPE)
    duplicate_result = worker.execute(IMSyncRunId("run-1"), _SCOPE)

    assert first_result is terminal_run
    assert duplicate_result is terminal_run
    assert coordinator.calls == [(IMSyncRunId("run-1"), _SCOPE)]


def test_retryable_coordinator_failure_remains_retryable() -> None:
    repository = _Repository(_queued_run())
    coordinator = _Coordinator(_terminal_run())
    coordinator.error = IMSyncRetryableError("lock unavailable")
    worker = IMContactSyncWorker(repository, coordinator)

    with pytest.raises(IMSyncRetryableError):
        worker.execute(IMSyncRunId("run-1"), _SCOPE)


def test_celery_entrypoint_reconstructs_scope_and_returns_persisted_terminal_status(monkeypatch) -> None:
    terminal_run = _terminal_run(IMSyncRunStatus.FAILED)

    class _Worker:
        def execute(self, sync_run_id: IMSyncRunId, scope: WorkspaceScope) -> IMSyncRun:
            assert sync_run_id == IMSyncRunId("run-1")
            assert scope == _SCOPE
            return terminal_run

    monkeypatch.setattr(im_contact_sync_tasks, "build_im_contact_sync_worker", lambda: _Worker())

    result = im_contact_sync_tasks.reconcile_im_contacts_task.run("run-1", "workspace", "workspace-1")

    assert result == IMSyncRunStatus.FAILED.value


def test_celery_entrypoint_rejects_invalid_scope_payload() -> None:
    with pytest.raises(ValueError, match="scope"):
        im_contact_sync_tasks.reconcile_im_contacts_task.run("run-1", "workspace", None)
