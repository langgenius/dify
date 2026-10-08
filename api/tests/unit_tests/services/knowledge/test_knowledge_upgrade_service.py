from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from machinery.context import RequestContext
from models.knowledge_fs import KnowledgeFSUpgradeJobStatus
from services.dataset_knowledge_fs_upgrade_service import KnowledgeFSUpgradeNotFoundError
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccessDeniedError
from services.knowledge.datasets.application import DatasetVisibility
from services.knowledge.datasets.upgrades import KnowledgeFSUpgradeUnavailableError, KnowledgeUpgradeApplicationService

CONTEXT = RequestContext("request", None, "account-1", "tenant-1")


def _service(*, feature_enabled: bool = True, access=None, enqueue=None) -> KnowledgeUpgradeApplicationService:
    if access is None:
        access = MagicMock()
        access.require_accessible.side_effect = lambda _context, dataset_id: AccessibleDataset(dataset_id, "tenant-1")
    datasets = MagicMock()
    datasets.visibility.return_value = DatasetVisibility()
    return KnowledgeUpgradeApplicationService(
        session_factory=MagicMock(),
        dataset_access=access,
        datasets=datasets,
        rbac_enabled=False,
        feature_enabled=lambda: feature_enabled,
        enqueue=enqueue or MagicMock(),
    )


def test_start_is_unavailable_when_knowledge_fs_is_disabled() -> None:
    access = MagicMock()
    service = _service(feature_enabled=False, access=access)

    with pytest.raises(KnowledgeFSUpgradeUnavailableError):
        service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")
    access.require_accessible.assert_not_called()


def test_start_snapshots_and_enqueues_without_remote_work() -> None:
    enqueue = MagicMock()
    service = _service(enqueue=enqueue)
    snapshots = MagicMock()
    snapshots.create.return_value = SimpleNamespace(id="job-1", old_dataset_id="dataset-1")

    with patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots):
        job = service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")

    assert job.id == "job-1"
    snapshots.create.assert_called_once_with(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        requested_by_account_id="account-1",
        idempotency_key="upgrade-request-1",
    )
    enqueue.assert_called_once_with(snapshots, "tenant-1", "job-1")


def test_start_rejects_an_inaccessible_dataset() -> None:
    access = MagicMock()
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    service = _service(access=access)

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService") as snapshots,
        pytest.raises(DatasetAccessDeniedError),
    ):
        service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")
    snapshots.assert_not_called()


def test_retry_rejects_a_job_from_another_dataset() -> None:
    enqueue = MagicMock()
    service = _service(enqueue=enqueue)
    snapshots = MagicMock()
    snapshots.retry.return_value = SimpleNamespace(id="job-1", old_dataset_id="dataset-2")

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots),
        pytest.raises(KnowledgeFSUpgradeNotFoundError, match="Upgrade job was not found"),
    ):
        service.retry(CONTEXT, dataset_id="dataset-1", job_id="job-1")
    enqueue.assert_not_called()


def test_list_recoverable_jobs_returns_only_accessible_dataset_jobs() -> None:
    access = MagicMock()

    def require_accessible(_context, dataset_id):
        if dataset_id == "dataset-2":
            raise DatasetAccessDeniedError()
        return AccessibleDataset(dataset_id, "tenant-1")

    access.require_accessible.side_effect = require_accessible
    service = _service(access=access)
    snapshots = MagicMock()
    snapshots.list_by_statuses.return_value = [
        SimpleNamespace(id="job-1", old_dataset_id="dataset-1"),
        SimpleNamespace(id="job-2", old_dataset_id="dataset-2"),
    ]
    datasets = [SimpleNamespace(id="dataset-1"), SimpleNamespace(id="dataset-2")]

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots),
        patch("services.knowledge.datasets.upgrades.load_actor"),
        patch(
            "services.knowledge.datasets.upgrades.DatasetService.get_datasets_by_ids", return_value=(datasets, 2)
        ) as get_datasets,
    ):
        jobs = service.list_recoverable_jobs(CONTEXT)

    assert [job.id for job in jobs] == ["job-1"]
    snapshots.list_by_statuses.assert_called_once_with(
        tenant_id="tenant-1",
        statuses=(
            KnowledgeFSUpgradeJobStatus.QUEUED,
            KnowledgeFSUpgradeJobStatus.RUNNING,
            KnowledgeFSUpgradeJobStatus.FAILED,
        ),
    )
    assert get_datasets.call_args.args[:2] == (["dataset-1", "dataset-2"], "tenant-1")
