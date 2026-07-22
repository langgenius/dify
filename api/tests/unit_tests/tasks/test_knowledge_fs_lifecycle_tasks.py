from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services.knowledge_fs.lifecycle_readiness import KnowledgeFSLifecycleWorkerReadiness
from tasks.knowledge_fs_lifecycle_tasks import run_knowledge_fs_lifecycle_worker


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


def test_ready_worker_dispatches_a_bounded_batch_then_repairs_orphans() -> None:
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
        patch("tasks.knowledge_fs_lifecycle_tasks.dify_config.KNOWLEDGE_FS_LIFECYCLE_BATCH_SIZE", 5),
        patch("tasks.knowledge_fs_lifecycle_tasks.dify_config.KNOWLEDGE_FS_LIFECYCLE_LEASE_SECONDS", 30),
        patch("tasks.knowledge_fs_lifecycle_tasks.dify_config.KNOWLEDGE_FS_ENABLED", True),
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
