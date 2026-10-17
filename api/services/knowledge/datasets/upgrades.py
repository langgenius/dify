"""Classic-to-Agent knowledge base upgrade use cases behind the dataset console endpoints."""

from collections.abc import Callable
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models import Dataset
from models.knowledge_fs import KnowledgeFSUpgradeJob, KnowledgeFSUpgradeJobStatus
from services.dataset_knowledge_fs_upgrade_service import (
    KnowledgeFSUpgradeNotFoundError,
    KnowledgeFSUpgradeSnapshotService,
    upgrade_discovery_response,
)
from services.knowledge.dataset_access import DatasetAccess, DatasetAccessError
from services.knowledge.dataset_service import DatasetService
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations, load_actor
from services.knowledge_fs.product_dto import KnowledgeFSUpgradeDiscoveryResponse

_RECOVERABLE_STATUSES = (
    KnowledgeFSUpgradeJobStatus.QUEUED,
    KnowledgeFSUpgradeJobStatus.RUNNING,
    KnowledgeFSUpgradeJobStatus.FAILED,
)


class KnowledgeFSUpgradeUnavailableError(Exception):
    """The KnowledgeFS feature is disabled, so upgrades cannot start."""


class KnowledgeUpgradeApplicationService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        dataset_access: DatasetAccess,
        datasets: SQLAlchemyDatasetOperations,
        rbac_enabled: bool,
        feature_enabled: Callable[[], bool],
        enqueue: Callable[[KnowledgeFSUpgradeSnapshotService, str, str], None] | None = None,
    ) -> None:
        self._sessions = session_factory
        self._dataset_access = dataset_access
        self._datasets = datasets
        self._rbac_enabled = rbac_enabled
        self._feature_enabled = feature_enabled
        self._enqueue = enqueue or enqueue_upgrade_job

    def _snapshots(self) -> KnowledgeFSUpgradeSnapshotService:
        return KnowledgeFSUpgradeSnapshotService(self._sessions)

    def list_recoverable_jobs(self, context: RequestContext) -> list[KnowledgeFSUpgradeJob]:
        workspace_id = context.active_workspace_id
        jobs = self._snapshots().list_by_statuses(tenant_id=workspace_id, statuses=_RECOVERABLE_STATUSES)
        dataset_ids = list(dict.fromkeys(job.old_dataset_id for job in jobs))
        if not dataset_ids:
            return []
        accessible_ids, include_own = self._datasets.visibility(context).list_scope(rbac_enabled=self._rbac_enabled)
        with self._sessions() as session:
            datasets, _ = DatasetService.get_datasets_by_ids(
                dataset_ids,
                workspace_id,
                user=load_actor(session, context),
                accessible_dataset_ids=accessible_ids,
                include_own_datasets=include_own,
                session=session,
            )
            visible_ids = [str(dataset.id) for dataset in datasets]
        allowed_ids: set[str] = set()
        for dataset_id in visible_ids:
            try:
                self._dataset_access.require_accessible(context, dataset_id)
            except DatasetAccessError:
                continue
            allowed_ids.add(dataset_id)
        return [job for job in jobs if job.old_dataset_id in allowed_ids]

    def discovery(self, context: RequestContext, *, dataset_id: str) -> KnowledgeFSUpgradeDiscoveryResponse:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        with self._sessions() as session:
            provider = session.scalar(
                select(Dataset.provider).where(Dataset.id == dataset.id, Dataset.tenant_id == dataset.workspace_id)
            )
        job = self._snapshots().get_latest(tenant_id=dataset.workspace_id, dataset_id=dataset.id)
        return upgrade_discovery_response(
            job, feature_enabled=self._feature_enabled(), dataset_provider=str(provider or "")
        )

    def start(self, context: RequestContext, *, dataset_id: str, idempotency_key: str) -> KnowledgeFSUpgradeJob:
        if not self._feature_enabled():
            raise KnowledgeFSUpgradeUnavailableError()
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        snapshots = self._snapshots()
        job = snapshots.create(
            tenant_id=dataset.workspace_id,
            dataset_id=dataset.id,
            requested_by_account_id=context.account_id,
            idempotency_key=idempotency_key,
        )
        self._enqueue(snapshots, dataset.workspace_id, job.id)
        return job

    def get_job(self, context: RequestContext, *, dataset_id: str, job_id: str) -> KnowledgeFSUpgradeJob:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        job = self._snapshots().get(tenant_id=dataset.workspace_id, job_id=job_id)
        if job.old_dataset_id != dataset.id:
            raise KnowledgeFSUpgradeNotFoundError("Upgrade job was not found")
        return job

    def retry(self, context: RequestContext, *, dataset_id: str, job_id: str) -> KnowledgeFSUpgradeJob:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        snapshots = self._snapshots()
        job = snapshots.retry(tenant_id=dataset.workspace_id, job_id=job_id)
        if job.old_dataset_id != dataset.id:
            raise KnowledgeFSUpgradeNotFoundError("Upgrade job was not found")
        self._enqueue(snapshots, dataset.workspace_id, job.id)
        return job


def enqueue_upgrade_job(snapshots: KnowledgeFSUpgradeSnapshotService, tenant_id: str, job_id: str) -> None:
    from tasks.knowledge_fs_upgrade_tasks import run_knowledge_fs_upgrade

    task_id = str(uuid4())
    if not snapshots.claim_enqueue(tenant_id=tenant_id, job_id=job_id, task_id=task_id):
        return
    try:
        run_knowledge_fs_upgrade.apply_async(kwargs={"job_id": job_id}, task_id=task_id)
    except Exception:
        snapshots.release_enqueue_claim(tenant_id=tenant_id, job_id=job_id, task_id=task_id)
        raise
