from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.knowledge_fs.upgrade_service import KnowledgeFSUpgradeNotReadyError
from tasks.knowledge_fs_upgrade_tasks import (
    KNOWLEDGE_FS_UPGRADE_QUEUE,
    cleanup_deferred_knowledge_fs_upgrade_files,
    reconcile_knowledge_fs_upgrade_documents,
    run_knowledge_fs_upgrade,
)


def test_upgrade_tasks_are_pinned_to_the_dedicated_queue() -> None:
    assert run_knowledge_fs_upgrade._get_exec_options()["queue"] == KNOWLEDGE_FS_UPGRADE_QUEUE
    assert reconcile_knowledge_fs_upgrade_documents._get_exec_options()["queue"] == KNOWLEDGE_FS_UPGRADE_QUEUE
    assert cleanup_deferred_knowledge_fs_upgrade_files._get_exec_options()["queue"] == KNOWLEDGE_FS_UPGRADE_QUEUE


def test_deferred_file_cleanup_uses_the_upgrade_session_factory() -> None:
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
        patch("tasks.knowledge_fs_upgrade_tasks.cleanup_deferred_upgrade_files", return_value=3) as cleanup,
    ):
        assert cleanup_deferred_knowledge_fs_upgrade_files.run() == 3

    cleanup.assert_called_once_with("maker")


@pytest.mark.parametrize("has_more", [True, False])
def test_worker_enqueues_only_the_expected_follow_up(has_more: bool) -> None:
    runner = MagicMock()
    runner.run_next.return_value = has_more
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
        patch("tasks.knowledge_fs_upgrade_tasks.KnowledgeFSUpgradeRunner", return_value=runner),
        patch.object(run_knowledge_fs_upgrade, "apply_async") as continue_upgrade,
        patch.object(reconcile_knowledge_fs_upgrade_documents, "apply_async") as reconcile,
    ):
        run_knowledge_fs_upgrade.run(job_id="job-1")

    runner.run_next.assert_called_once()
    if has_more:
        continue_upgrade.assert_called_once_with(kwargs={"job_id": "job-1"})
        reconcile.assert_not_called()
    else:
        continue_upgrade.assert_not_called()
        reconcile.assert_called_once_with(kwargs={"job_id": "job-1"})


def test_worker_marks_parent_failed_when_a_checkpoint_raises() -> None:
    runner = MagicMock()
    error = RuntimeError("ordinary document upload failed")
    runner.run_next.side_effect = error
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
        patch("tasks.knowledge_fs_upgrade_tasks.KnowledgeFSUpgradeRunner", return_value=runner),
        pytest.raises(RuntimeError, match="ordinary document upload failed"),
    ):
        run_knowledge_fs_upgrade.run(job_id="job-1")

    runner.fail.assert_called_once_with(job_id="job-1", error=error)


def test_worker_marks_parent_failed_when_provisioning_retries_are_exhausted() -> None:
    runner = MagicMock()
    error = KnowledgeFSUpgradeNotReadyError("Space is still provisioning")
    runner.run_next.side_effect = error
    run_knowledge_fs_upgrade.push_request(retries=run_knowledge_fs_upgrade.max_retries)
    try:
        with (
            patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
            patch("tasks.knowledge_fs_upgrade_tasks.KnowledgeFSUpgradeRunner", return_value=runner),
            pytest.raises(KnowledgeFSUpgradeNotReadyError, match="still provisioning"),
        ):
            run_knowledge_fs_upgrade.run(job_id="job-1")
    finally:
        run_knowledge_fs_upgrade.pop_request()

    runner.fail.assert_called_once_with(job_id="job-1", error=error)
