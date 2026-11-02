"""Classic-to-Agent knowledge base upgrade use cases behind the dataset console endpoints."""

from collections.abc import Callable
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from graphon.model_runtime.entities.model_entities import ModelType
from machinery.context import RequestContext
from models import Dataset
from models.knowledge_fs import KnowledgeFSUpgradeJob, KnowledgeFSUpgradeJobStatus
from models.provider import TenantDefaultModel
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
from services.knowledge.dataset_service import DatasetService
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations, load_actor
from services.knowledge_fs.product_dto import (
    KnowledgeFSUpgradeModelChoice,
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

    @staticmethod
    def _choice(provider: str | None, model: str | None) -> KnowledgeFSUpgradeModelChoice | None:
        if not provider or not model:
            return None
        return KnowledgeFSUpgradeModelChoice(provider=provider, model=model)

    def _load_model_preferences(
        self, *, tenant_id: str, dataset_id: str
    ) -> tuple[str, KnowledgeFSUpgradeModelPreferences]:
        """Read the legacy settings and saved defaults in a short, tenant-scoped session."""
        with self._sessions() as session:
            dataset = session.scalar(select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id))
            if dataset is None:
                raise KnowledgeFSUpgradeNotFoundError("Dataset was not found")
            defaults: dict[ModelType, KnowledgeFSUpgradeModelChoice] = {}
            for row in session.scalars(
                select(TenantDefaultModel).where(
                    TenantDefaultModel.tenant_id == tenant_id,
                    TenantDefaultModel.model_type.in_((ModelType.TEXT_EMBEDDING, ModelType.RERANK, ModelType.LLM)),
                )
            ):
                choice = self._choice(row.provider_name, row.model_name)
                if choice is not None:
                    defaults[row.model_type] = choice
            retrieval = dataset.retrieval_model if isinstance(dataset.retrieval_model, dict) else {}
            reranking = retrieval.get("reranking_model") or {}
            if not isinstance(reranking, dict):
                reranking = {}
            preferences = KnowledgeFSUpgradeModelPreferences(
                embedding=self._choice(dataset.embedding_model_provider, dataset.embedding_model),
                rerank=self._choice(reranking.get("reranking_provider_name"), reranking.get("reranking_model_name")),
                defaults=defaults,
            )
            return str(dataset.provider or ""), preferences

    def list_recoverable_jobs(self, context: RequestContext) -> list[KnowledgeFSUpgradeJob]:
        workspace_id = context.active_workspace_id
        jobs = self._snapshots().list_by_statuses(tenant_id=workspace_id, statuses=_RECOVERABLE_STATUSES)
        dataset_ids = list(dict.fromkeys(job.old_dataset_id for job in jobs))
        if not dataset_ids:
            return []
        accessible_ids = self._datasets.visibility(context).list_scope(rbac_enabled=self._rbac_enabled)
        with self._sessions() as session:
            datasets, _ = DatasetService.get_datasets_by_ids(
                dataset_ids,
                workspace_id,
                user=load_actor(session, context),
                accessible_dataset_ids=accessible_ids,
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

    def discovery(self, context: RequestContext, *, dataset_id: str) -> KnowledgeFSUpgradePreparationResponse:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        with self._sessions() as session:
            provider = session.scalar(
                select(Dataset.provider).where(Dataset.id == dataset.id, Dataset.tenant_id == dataset.workspace_id)
            )
        job = self._snapshots().get_latest(tenant_id=dataset.workspace_id, dataset_id=dataset.id)
        eligibility = upgrade_discovery_response(
            job, feature_enabled=self._feature_enabled(), dataset_provider=str(provider or "")
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
