"""Classic-to-Agent knowledge base upgrade use cases behind the dataset console endpoints."""

from collections.abc import Callable
from typing import Protocol
from uuid import uuid4

from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.knowledge_fs import KnowledgeFSUpgradeJob, KnowledgeFSUpgradeJobStatus
from services.dataset_knowledge_fs_upgrade_service import (
    KnowledgeFSUpgradeConflictError,
    KnowledgeFSUpgradeModelPreferences,
    KnowledgeFSUpgradeModelResolver,
    KnowledgeFSUpgradeNotFoundError,
    KnowledgeFSUpgradeSnapshotService,
    upgrade_discovery_response,
    upgrade_job_matches_model_choices,
)
from services.knowledge.dataset_access import DatasetAccess, DatasetAccessError
from services.knowledge.datasets.contracts import DatasetListFilter, DatasetVisibility
from services.knowledge.entities.datasets import DatasetDetailRecord, DatasetPage
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge_fs.product_dto import (
    KnowledgeFSUpgradeModelsPayload,
    KnowledgeFSUpgradePreparationResponse,
)

_RECOVERABLE_STATUSES = (
    KnowledgeFSUpgradeJobStatus.QUEUED,
    KnowledgeFSUpgradeJobStatus.RUNNING,
    KnowledgeFSUpgradeJobStatus.FAILED,
)


class KnowledgeFSUpgradeUnavailableError(Exception):
    """The KnowledgeFS feature is disabled, so upgrades cannot start or retry."""


class KnowledgeUpgradeDatasets(Protocol):
    def visibility(self, context: RequestContext) -> DatasetVisibility: ...

    def list_datasets(
        self,
        context: RequestContext,
        query: DatasetListFilter,
        accessible_ids: list[str] | None,
        include_own: bool,
    ) -> DatasetPage: ...

    def get_dataset(self, context: RequestContext, ref: DatasetRef) -> DatasetDetailRecord: ...

    def get_upgrade_model_preferences(self, ref: DatasetRef) -> tuple[str, KnowledgeFSUpgradeModelPreferences]:
        """Return models within ``ref``'s scope or fail when its dataset is absent."""
        ...


class KnowledgeUpgradeApplicationService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        dataset_access: DatasetAccess,
        datasets: KnowledgeUpgradeDatasets,
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

    def _load_model_preferences(
        self, *, tenant_id: str, dataset_id: str
    ) -> tuple[str, KnowledgeFSUpgradeModelPreferences]:
        """Return tenant-scoped model settings or propagate a missing-dataset error."""
        return self._datasets.get_upgrade_model_preferences(DatasetRef(tenant_id, dataset_id))

    def list_recoverable_jobs(self, context: RequestContext) -> list[KnowledgeFSUpgradeJob]:
        workspace_id = context.active_workspace_id
        jobs = self._snapshots().list_by_statuses(tenant_id=workspace_id, statuses=_RECOVERABLE_STATUSES)
        dataset_ids = list(dict.fromkeys(job.old_dataset_id for job in jobs))
        if not dataset_ids:
            return []
        accessible_ids, include_own = self._datasets.visibility(context).list_scope(rbac_enabled=self._rbac_enabled)
        visible_ids: list[str] = []
        for offset in range(0, len(dataset_ids), 100):
            page = self._datasets.list_datasets(
                context,
                DatasetListFilter(ids=dataset_ids[offset : offset + 100], limit=100),
                accessible_ids,
                include_own,
            )
            visible_ids.extend(str(dataset["id"]) for dataset in page["data"])
        allowed_ids: set[str] = set()
        for dataset_id in visible_ids:
            try:
                self._dataset_access.require_accessible(context, dataset_id)
            except DatasetAccessError:
                continue
            allowed_ids.add(dataset_id)
        return [job for job in jobs if job.old_dataset_id in allowed_ids]

    def discovery(self, context: RequestContext, *, dataset_id: str) -> KnowledgeFSUpgradePreparationResponse:
        """Return eligibility and recommendations for an admitted dataset.

        The context must identify the dataset's workspace and an authorized account.
        Ineligible datasets return ``models=None`` without model-provider I/O. Read,
        access, and provider-discovery failures propagate without changing state.
        """
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        details = self._datasets.get_dataset(context, DatasetRef(dataset.workspace_id, dataset.id))
        job = self._snapshots().get_latest(tenant_id=dataset.workspace_id, dataset_id=dataset.id)
        eligibility = upgrade_discovery_response(
            job,
            feature_enabled=self._feature_enabled(),
            dataset_provider=str(details["provider"]),
        )
        recommendations = None
        if eligibility.can_upgrade:
            _, preferences = self._load_model_preferences(tenant_id=dataset.workspace_id, dataset_id=dataset.id)
            recommendations = KnowledgeFSUpgradeModelResolver(tenant_id=dataset.workspace_id).recommend(preferences)
        return KnowledgeFSUpgradePreparationResponse.model_validate(
            {**eligibility.model_dump(mode="json"), "models": recommendations}
        )

    def start(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        idempotency_key: str,
        models: KnowledgeFSUpgradeModelsPayload | None = None,
    ) -> KnowledgeFSUpgradeJob:
        """Validate models, persist one workspace-scoped snapshot, and enqueue it.

        The context must admit ``dataset_id`` and the feature must be enabled.
        Replaying an idempotency key returns its job only when the dataset and any
        supplied model choices match. Invalid models, conflicts, inaccessible or
        external datasets, and persistence failures create and enqueue no new job.
        """
        if not self._feature_enabled():
            raise KnowledgeFSUpgradeUnavailableError()
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        snapshots = self._snapshots()
        idempotent = snapshots.get_by_idempotency_key(tenant_id=dataset.workspace_id, idempotency_key=idempotency_key)
        if idempotent is not None:
            if idempotent.old_dataset_id != dataset.id:
                raise KnowledgeFSUpgradeConflictError("Idempotency key belongs to another Dataset upgrade")
            if models is not None and not upgrade_job_matches_model_choices(idempotent, models):
                raise KnowledgeFSUpgradeConflictError("Idempotency key belongs to another model selection")
            self._enqueue(snapshots, dataset.workspace_id, idempotent.id)
            return idempotent
        provider, preferences = self._load_model_preferences(tenant_id=dataset.workspace_id, dataset_id=dataset.id)
        if provider == "external":
            raise KnowledgeFSUpgradeConflictError("External-provider Datasets cannot be upgraded")
        resolver = KnowledgeFSUpgradeModelResolver(tenant_id=dataset.workspace_id)
        resolved_models = (
            resolver.validate(models) if models is not None else resolver.resolve_recommendations(preferences)
        )
        job = snapshots.create(
            tenant_id=dataset.workspace_id,
            dataset_id=dataset.id,
            requested_by_account_id=context.account_id,
            idempotency_key=idempotency_key,
            models=resolved_models,
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
        if not self._feature_enabled():
            raise KnowledgeFSUpgradeUnavailableError()
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        snapshots = self._snapshots()
        job = snapshots.retry(tenant_id=dataset.workspace_id, dataset_id=dataset.id, job_id=job_id)
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
