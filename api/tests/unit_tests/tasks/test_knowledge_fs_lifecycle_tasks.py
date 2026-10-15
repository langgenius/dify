from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from unittest.mock import patch

import pytest

from services.knowledge_fs.lifecycle_readiness import KnowledgeFSLifecycleWorkerReadiness
from services.knowledge_fs.lifecycle_saga import KnowledgeFSLifecycleDispatchResult
from services.knowledge_fs.orphan_reconciler import KnowledgeFSOrphanReport
from tasks.knowledge_fs_lifecycle_tasks import (
    cleanup_knowledge_fs_staged_uploads,
    run_knowledge_fs_lifecycle_worker,
)
from tests.unit_tests.config_override import apply_config_overrides


@dataclass
class _SagaRunner:
    results: list[KnowledgeFSLifecycleDispatchResult]
    dispatches: list[dict[str, object]] = field(default_factory=list)

    def dispatch_one(self, **kwargs: object) -> KnowledgeFSLifecycleDispatchResult:
        self.dispatches.append(kwargs)
        return self.results.pop(0)


@dataclass
class _OrphanReconciler:
    report: KnowledgeFSOrphanReport
    calls: list[dict[str, object]] = field(default_factory=list)

    def reconcile(self, *, limit: int, apply_repairs: bool) -> KnowledgeFSOrphanReport:
        self.calls.append({"limit": limit, "apply_repairs": apply_repairs})
        return self.report


@dataclass
class _StagedUploads:
    expired: int
    limits: list[int] = field(default_factory=list)

    def cleanup_expired(self, *, limit: int) -> int:
        self.limits.append(limit)
        return self.expired


@dataclass(frozen=True)
class _Runtime:
    facade: str


def test_worker_self_check_returns_before_assembling_remote_when_rollout_is_not_ready() -> None:
    with (
        patch(
            "tasks.knowledge_fs_lifecycle_tasks.get_configured_knowledge_fs_lifecycle_worker_readiness",
            return_value=KnowledgeFSLifecycleWorkerReadiness(False, ("legacy_acl_freeze",)),
        ),
        patch("tasks.knowledge_fs_lifecycle_tasks.get_knowledge_fs_lifecycle_remote") as remote,
    ):
        result = run_knowledge_fs_lifecycle_worker.run()

    assert result == {"status": "disabled", "dispatched": 0, "completed": 0, "reconciled": 0}
    remote.assert_not_called()


def test_ready_worker_dispatches_a_bounded_batch_then_repairs_orphans(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner = _SagaRunner(
        results=[
            KnowledgeFSLifecycleDispatchResult(claimed=True, completed=True, outbox_id="outbox-1"),
            KnowledgeFSLifecycleDispatchResult(claimed=True, completed=False, outbox_id="outbox-2"),
            KnowledgeFSLifecycleDispatchResult(claimed=False, completed=False, outbox_id=None),
        ]
    )
    reconciler = _OrphanReconciler(
        report=KnowledgeFSOrphanReport(
            repaired_control_space_ids=("control-1",),
            remote_orphan_space_ids=(),
            local_missing_remote_ids=(),
            cleanup_control_space_ids=("control-2", "control-3"),
        )
    )
    apply_config_overrides(
        monkeypatch,
        KNOWLEDGE_FS_LIFECYCLE_BATCH_SIZE=5,
        KNOWLEDGE_FS_LIFECYCLE_LEASE_SECONDS=30,
        KNOWLEDGE_FS_ENABLED=True,
    )
    with (
        patch(
            "tasks.knowledge_fs_lifecycle_tasks.get_configured_knowledge_fs_lifecycle_worker_readiness",
            return_value=KnowledgeFSLifecycleWorkerReadiness(True, ()),
        ),
        patch("tasks.knowledge_fs_lifecycle_tasks.get_knowledge_fs_lifecycle_remote", return_value="remote-1"),
        patch("tasks.knowledge_fs_lifecycle_tasks.session_factory.get_session_maker", return_value="maker-1"),
        patch("tasks.knowledge_fs_lifecycle_tasks.KnowledgeFSLifecycleSagaRunner", return_value=runner),
        patch("tasks.knowledge_fs_lifecycle_tasks.KnowledgeFSOrphanReconciler", return_value=reconciler),
        patch("tasks.knowledge_fs_lifecycle_tasks.socket.gethostname", return_value="worker-host"),
        patch("tasks.knowledge_fs_lifecycle_tasks.naive_utc_now", return_value="now-1"),
    ):
        result = run_knowledge_fs_lifecycle_worker.run()

    assert result == {"status": "ok", "dispatched": 2, "completed": 1, "reconciled": 3}
    assert len(runner.dispatches) == 3
    assert runner.dispatches[-1] == {
        "worker_id": "worker-host:manual",
        "now": "now-1",
        "lease_duration": timedelta(seconds=30),
        "product_enabled": True,
    }
    assert reconciler.calls == [{"limit": 5, "apply_repairs": True}]


def test_staged_upload_cleanup_returns_before_runtime_assembly_when_not_ready() -> None:
    with (
        patch(
            "tasks.knowledge_fs_lifecycle_tasks.get_configured_knowledge_fs_lifecycle_worker_readiness",
            return_value=KnowledgeFSLifecycleWorkerReadiness(False, ("worker_disabled",)),
        ),
        patch("tasks.knowledge_fs_lifecycle_tasks.get_knowledge_fs_runtime") as runtime,
    ):
        result = cleanup_knowledge_fs_staged_uploads.run()

    assert result == 0
    runtime.assert_not_called()


def test_staged_upload_cleanup_uses_the_configured_batch_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    staged_uploads = _StagedUploads(expired=4)
    apply_config_overrides(monkeypatch, KNOWLEDGE_FS_LIFECYCLE_BATCH_SIZE=25)
    with (
        patch(
            "tasks.knowledge_fs_lifecycle_tasks.get_configured_knowledge_fs_lifecycle_worker_readiness",
            return_value=KnowledgeFSLifecycleWorkerReadiness(True, ()),
        ),
        patch(
            "tasks.knowledge_fs_lifecycle_tasks.session_factory.get_session_maker",
            return_value="maker-1",
        ),
        patch(
            "tasks.knowledge_fs_lifecycle_tasks.get_knowledge_fs_runtime",
            return_value=_Runtime(facade="facade-1"),
        ) as runtime,
        patch(
            "tasks.knowledge_fs_lifecycle_tasks.KnowledgeFSStagedUploadService",
            return_value=staged_uploads,
        ) as service,
    ):
        result = cleanup_knowledge_fs_staged_uploads.run()

    assert result == 4
    runtime.assert_called_once_with("maker-1")
    service.assert_called_once_with("maker-1", facade="facade-1")
    assert staged_uploads.limits == [25]
