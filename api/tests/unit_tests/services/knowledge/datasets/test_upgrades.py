from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import cast
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models import Dataset
from models.knowledge_fs import KnowledgeFSUpgradeJob, KnowledgeFSUpgradeJobStatus
from services.dataset_knowledge_fs_upgrade_service import (
    KnowledgeFSUpgradeNotFoundError,
    KnowledgeFSUpgradeSnapshotService,
)
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetVisibility
from services.knowledge.datasets.upgrades import KnowledgeFSUpgradeUnavailableError, KnowledgeUpgradeApplicationService
from tests.helpers.unit.services.knowledge_fs_services_a_fakes import UnusedSessionFactory, upgrade_job

CONTEXT = RequestContext("request", None, "account-1", "tenant-1")


def _grant_access(_context: RequestContext, dataset_id: str) -> AccessibleDataset:
    return AccessibleDataset(dataset_id, "tenant-1")


@dataclass
class FakeDatasetAccess:
    decide: Callable[[RequestContext, str], AccessibleDataset] = _grant_access
    requested: list[str] = field(default_factory=list)

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        self.requested.append(dataset_id)
        return self.decide(context, dataset_id)


class FakeDatasets:
    def visibility(self, _context: RequestContext) -> DatasetVisibility:
        return DatasetVisibility()


@dataclass
class FakeEnqueue:
    calls: list[tuple[object, str, str]] = field(default_factory=list)

    def __call__(self, snapshots: object, tenant_id: str, job_id: str) -> None:
        self.calls.append((snapshots, tenant_id, job_id))


@dataclass
class FakeSnapshots:
    job: KnowledgeFSUpgradeJob | None = None
    jobs: list[KnowledgeFSUpgradeJob] = field(default_factory=list)
    create_calls: list[dict[str, str]] = field(default_factory=list)
    list_calls: list[dict[str, object]] = field(default_factory=list)
    retry_calls: list[dict[str, str]] = field(default_factory=list)

    def create(
        self, *, tenant_id: str, dataset_id: str, requested_by_account_id: str, idempotency_key: str
    ) -> KnowledgeFSUpgradeJob:
        self.create_calls.append(
            {
                "tenant_id": tenant_id,
                "dataset_id": dataset_id,
                "requested_by_account_id": requested_by_account_id,
                "idempotency_key": idempotency_key,
            }
        )
        assert self.job is not None
        return self.job

    def retry(self, *, tenant_id: str, dataset_id: str, job_id: str) -> KnowledgeFSUpgradeJob:
        self.retry_calls.append({"tenant_id": tenant_id, "dataset_id": dataset_id, "job_id": job_id})
        assert self.job is not None
        return self.job

    def list_by_statuses(
        self, *, tenant_id: str, statuses: Sequence[KnowledgeFSUpgradeJobStatus]
    ) -> list[KnowledgeFSUpgradeJob]:
        self.list_calls.append({"tenant_id": tenant_id, "statuses": statuses})
        return self.jobs


def _service(
    *, feature_enabled: bool = True, access: FakeDatasetAccess | None = None, enqueue: FakeEnqueue | None = None
) -> KnowledgeUpgradeApplicationService:
    return KnowledgeUpgradeApplicationService(
        session_factory=cast("sessionmaker[Session]", UnusedSessionFactory()),
        dataset_access=cast(DatasetAccess, access or FakeDatasetAccess()),
        datasets=cast(SQLAlchemyDatasetOperations, FakeDatasets()),
        rbac_enabled=False,
        feature_enabled=lambda: feature_enabled,
        enqueue=enqueue or FakeEnqueue(),
    )


def _dataset(dataset_id: str) -> Dataset:
    dataset = Dataset()
    dataset.id = dataset_id
    return dataset


def test_start_is_unavailable_when_knowledge_fs_is_disabled() -> None:
    access = FakeDatasetAccess()
    service = _service(feature_enabled=False, access=access)

    with pytest.raises(KnowledgeFSUpgradeUnavailableError):
        service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")
    assert access.requested == []


def test_retry_is_unavailable_when_knowledge_fs_is_disabled() -> None:
    access = FakeDatasetAccess()
    enqueue = FakeEnqueue()
    service = _service(feature_enabled=False, access=access, enqueue=enqueue)

    with (
        patch.object(service, "_snapshots") as snapshots,
        pytest.raises(KnowledgeFSUpgradeUnavailableError),
    ):
        service.retry(CONTEXT, dataset_id="dataset-1", job_id="job-1")

    assert access.requested == []
    snapshots.assert_not_called()
    assert enqueue.calls == []


def test_start_snapshots_and_enqueues_without_remote_work() -> None:
    enqueue = FakeEnqueue()
    service = _service(enqueue=enqueue)
    snapshots = FakeSnapshots(job=upgrade_job(job_id="job-1", old_dataset_id="dataset-1"))

    with patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots):
        job = service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")

    assert job.id == "job-1"
    assert snapshots.create_calls == [
        {
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "requested_by_account_id": "account-1",
            "idempotency_key": "upgrade-request-1",
        }
    ]
    assert enqueue.calls == [(snapshots, "tenant-1", "job-1")]


def test_start_rejects_an_inaccessible_dataset() -> None:
    def deny(_context: RequestContext, _dataset_id: str) -> AccessibleDataset:
        raise DatasetAccessDeniedError()

    service = _service(access=FakeDatasetAccess(decide=deny))

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService") as snapshots,
        pytest.raises(DatasetAccessDeniedError),
    ):
        service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")
    snapshots.assert_not_called()


def test_retry_rejects_a_job_from_another_dataset_without_committing_changes(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    enqueue = FakeEnqueue()
    service = _service(enqueue=enqueue)
    job = upgrade_job(job_id="job-1", old_dataset_id="dataset-2")
    job.status = KnowledgeFSUpgradeJobStatus.FAILED
    job.last_error_code = "original_failure"
    job.celery_task_id = "original-task"
    with sqlite_session_factory.begin() as session:
        session.add(job)
    snapshots = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory)

    with (
        patch.object(service, "_snapshots", return_value=snapshots),
        pytest.raises(KnowledgeFSUpgradeNotFoundError, match="Upgrade job was not found"),
    ):
        service.retry(CONTEXT, dataset_id="dataset-1", job_id="job-1")

    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, "job-1")
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeJobStatus.FAILED
        assert persisted.last_error_code == "original_failure"
        assert persisted.celery_task_id == "original-task"
    assert enqueue.calls == []


def test_list_recoverable_jobs_returns_only_accessible_dataset_jobs() -> None:
    def require_accessible(_context: RequestContext, dataset_id: str) -> AccessibleDataset:
        if dataset_id == "dataset-2":
            raise DatasetAccessDeniedError()
        return AccessibleDataset(dataset_id, "tenant-1")

    service = _service(access=FakeDatasetAccess(decide=require_accessible))
    snapshots = FakeSnapshots(
        jobs=[
            upgrade_job(job_id="job-1", old_dataset_id="dataset-1"),
            upgrade_job(job_id="job-2", old_dataset_id="dataset-2"),
        ]
    )
    datasets = [_dataset("dataset-1"), _dataset("dataset-2")]

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots),
        patch("services.knowledge.datasets.upgrades.load_actor"),
        patch(
            "services.knowledge.datasets.upgrades.DatasetService.get_datasets_by_ids", return_value=(datasets, 2)
        ) as get_datasets,
    ):
        jobs = service.list_recoverable_jobs(CONTEXT)

    assert [job.id for job in jobs] == ["job-1"]
    assert snapshots.list_calls == [
        {
            "tenant_id": "tenant-1",
            "statuses": (
                KnowledgeFSUpgradeJobStatus.QUEUED,
                KnowledgeFSUpgradeJobStatus.RUNNING,
                KnowledgeFSUpgradeJobStatus.FAILED,
            ),
        }
    ]
    assert get_datasets.call_args.args[:2] == (["dataset-1", "dataset-2"], "tenant-1")
