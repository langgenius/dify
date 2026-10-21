from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import patch

import pytest
from celery.app.task import Context

from services.dataset_knowledge_fs_upgrade_service import KnowledgeFSUpgradeNotReadyError
from tasks.knowledge_fs_upgrade_tasks import (
    KNOWLEDGE_FS_UPGRADE_QUEUE,
    cleanup_deferred_knowledge_fs_upgrade_files,
    reconcile_knowledge_fs_upgrade_documents,
    run_knowledge_fs_upgrade,
)
from tests.unit_tests.tasks.task_options import task_options


@dataclass
class _UpgradeRunner:
    """Returns ``outcome`` from ``run_next`` or raises it, and records failure reports."""

    outcome: bool | Exception
    runs: list[dict[str, object]] = field(default_factory=list)
    failures: list[dict[str, object]] = field(default_factory=list)
    releases: list[tuple[str, str | None]] = field(default_factory=list)
    released_tenant_id: str | None = "tenant-1"

    def run_next(self, **kwargs: object) -> bool:
        self.runs.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome

    def fail(self, *, job_id: str, error: Exception) -> None:
        self.failures.append({"job_id": job_id, "error": error})

    def release_for_dispatch(self, *, job_id: str, celery_task_id: str | None) -> str | None:
        self.releases.append((job_id, celery_task_id))
        return self.released_tenant_id


def test_upgrade_tasks_are_pinned_to_the_dedicated_queue() -> None:
    assert task_options(run_knowledge_fs_upgrade)["queue"] == KNOWLEDGE_FS_UPGRADE_QUEUE
    assert task_options(reconcile_knowledge_fs_upgrade_documents)["queue"] == KNOWLEDGE_FS_UPGRADE_QUEUE
    assert task_options(cleanup_deferred_knowledge_fs_upgrade_files)["queue"] == KNOWLEDGE_FS_UPGRADE_QUEUE


def test_deferred_file_cleanup_uses_the_upgrade_session_factory() -> None:
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
        patch("tasks.knowledge_fs_upgrade_tasks.cleanup_deferred_upgrade_files", return_value=3) as cleanup,
    ):
        assert cleanup_deferred_knowledge_fs_upgrade_files.run() == 3

    cleanup.assert_called_once_with("maker")


@pytest.mark.parametrize("has_more", [True, False])
def test_worker_enqueues_only_the_expected_follow_up(has_more: bool) -> None:
    runner = _UpgradeRunner(outcome=has_more)
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
        patch("tasks.knowledge_fs_upgrade_tasks.KnowledgeFSUpgradeRunner", return_value=runner),
        patch("services.knowledge.datasets.upgrades.enqueue_upgrade_job") as continue_upgrade,
        patch.object(reconcile_knowledge_fs_upgrade_documents, "apply_async") as reconcile,
    ):
        run_knowledge_fs_upgrade.run(job_id="job-1")

    assert len(runner.runs) == 1
    assert runner.runs[0]["job_id"] == "job-1"
    if has_more:
        assert runner.releases == [("job-1", None)]
        continue_upgrade.assert_called_once()
        assert continue_upgrade.call_args.args[1:] == ("tenant-1", "job-1")
        reconcile.assert_not_called()
    else:
        assert runner.releases == []
        continue_upgrade.assert_not_called()
        reconcile.assert_called_once_with(kwargs={"job_id": "job-1"})


def test_worker_skips_dispatch_when_the_job_moved_on() -> None:
    runner = _UpgradeRunner(outcome=True, released_tenant_id=None)
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
        patch("tasks.knowledge_fs_upgrade_tasks.KnowledgeFSUpgradeRunner", return_value=runner),
        patch("services.knowledge.datasets.upgrades.enqueue_upgrade_job") as continue_upgrade,
    ):
        run_knowledge_fs_upgrade.run(job_id="job-1")

    continue_upgrade.assert_not_called()


def test_worker_marks_parent_failed_when_a_checkpoint_raises() -> None:
    error = RuntimeError("ordinary document upload failed")
    runner = _UpgradeRunner(outcome=error)
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
        patch("tasks.knowledge_fs_upgrade_tasks.KnowledgeFSUpgradeRunner", return_value=runner),
        pytest.raises(RuntimeError, match="ordinary document upload failed"),
    ):
        run_knowledge_fs_upgrade.run(job_id="job-1")

    assert runner.failures == [{"job_id": "job-1", "error": error}]


def test_worker_marks_parent_failed_when_provisioning_retries_are_exhausted() -> None:
    error = KnowledgeFSUpgradeNotReadyError("Space is still provisioning")
    runner = _UpgradeRunner(outcome=error)
    run_knowledge_fs_upgrade.request_stack.push(Context(retries=run_knowledge_fs_upgrade.max_retries))
    try:
        with (
            patch("tasks.knowledge_fs_upgrade_tasks.session_factory.get_session_maker", return_value="maker"),
            patch("tasks.knowledge_fs_upgrade_tasks.KnowledgeFSUpgradeRunner", return_value=runner),
            pytest.raises(KnowledgeFSUpgradeNotReadyError, match="still provisioning"),
        ):
            run_knowledge_fs_upgrade.run(job_id="job-1")
    finally:
        run_knowledge_fs_upgrade.pop_request()

    assert runner.failures == [{"job_id": "job-1", "error": error}]
