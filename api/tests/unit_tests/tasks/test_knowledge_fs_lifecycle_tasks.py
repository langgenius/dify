from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from services.knowledge_fs.lifecycle_readiness import KnowledgeFSLifecycleWorkerReadiness
from tasks.knowledge_fs_lifecycle_tasks import (
    cleanup_knowledge_fs_staged_uploads,
    run_knowledge_fs_lifecycle_worker,
)
from tests.unit_tests.config_override import apply_config_overrides


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
    runner = SimpleNamespace(
        dispatch_one=MagicMock(
            side_effect=(
                SimpleNamespace(claimed=True, completed=True),
                SimpleNamespace(claimed=True, completed=False),
                SimpleNamespace(claimed=False, completed=False),
            )
        )
    )
    reconciler = SimpleNamespace(
        reconcile=MagicMock(
            return_value=SimpleNamespace(
                repaired_control_space_ids=("control-1",),
                cleanup_control_space_ids=("control-2", "control-3"),
            )
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
    assert runner.dispatch_one.call_count == 3
    assert runner.dispatch_one.call_args.kwargs == {
        "worker_id": "worker-host:manual",
        "now": "now-1",
        "lease_duration": timedelta(seconds=30),
        "product_enabled": True,
    }
    reconciler.reconcile.assert_called_once_with(limit=5, apply_repairs=True)


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
    staged_uploads = MagicMock()
    staged_uploads.cleanup_expired.return_value = 4
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
            return_value=SimpleNamespace(facade="facade-1"),
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
    staged_uploads.cleanup_expired.assert_called_once_with(limit=25)
