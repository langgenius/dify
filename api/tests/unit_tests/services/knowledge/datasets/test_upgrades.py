from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import cast
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session, sessionmaker

from graphon.model_runtime.entities.model_entities import ModelType
from machinery.context import RequestContext
from models import Dataset
from models.knowledge_fs import KnowledgeFSUpgradeJob, KnowledgeFSUpgradeJobStatus
from models.provider import TenantDefaultModel
from services.dataset_knowledge_fs_upgrade_service import (
    KnowledgeFSUpgradeConflictError,
    KnowledgeFSUpgradeModelPreferences,
    KnowledgeFSUpgradeModelsUnavailableError,
    KnowledgeFSUpgradeNotFoundError,
    KnowledgeFSUpgradeResolvedModels,
    KnowledgeFSUpgradeSnapshotService,
)
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.datasets.adapters import SQLAlchemyDatasetOperations
from services.knowledge.datasets.application import DatasetVisibility
from services.knowledge.datasets.upgrades import KnowledgeFSUpgradeUnavailableError, KnowledgeUpgradeApplicationService
from services.knowledge_fs.product_dto import (
    KnowledgeFSModelIntent,
    KnowledgeFSUpgradeModelChoice,
    KnowledgeFSUpgradeModelIssueResponse,
    KnowledgeFSUpgradeModelRecommendationResponse,
    KnowledgeFSUpgradeModelRecommendationsResponse,
    KnowledgeFSUpgradeModelsPayload,
)
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
    create_calls: list[dict[str, object]] = field(default_factory=list)
    list_calls: list[dict[str, object]] = field(default_factory=list)
    retry_calls: list[dict[str, str]] = field(default_factory=list)

    def get_by_idempotency_key(self, *, tenant_id: str, idempotency_key: str) -> KnowledgeFSUpgradeJob | None:
        assert tenant_id == "tenant-1"
        assert idempotency_key == "upgrade-request-1"
        return None

    def create(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        requested_by_account_id: str,
        idempotency_key: str,
        models: KnowledgeFSUpgradeResolvedModels,
    ) -> KnowledgeFSUpgradeJob:
        self.create_calls.append(
            {
                "tenant_id": tenant_id,
                "dataset_id": dataset_id,
                "requested_by_account_id": requested_by_account_id,
                "idempotency_key": idempotency_key,
                "models": models,
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
    *,
    feature_enabled: bool = True,
    access: FakeDatasetAccess | None = None,
    enqueue: FakeEnqueue | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> KnowledgeUpgradeApplicationService:
    return KnowledgeUpgradeApplicationService(
        session_factory=session_factory or cast("sessionmaker[Session]", UnusedSessionFactory()),
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


def test_load_model_preferences_reads_tenant_defaults_and_handles_invalid_legacy_settings(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = Dataset(
            tenant_id="tenant-1",
            name="Legacy knowledge base",
            created_by="account-1",
            provider="vendor",
            embedding_model_provider="legacy-provider",
            embedding_model="legacy-embedding",
            retrieval_model={
                "reranking_model": {
                    "reranking_provider_name": "legacy-rerank-provider",
                    "reranking_model_name": "legacy-rerank",
                }
            },
        )
        session.add(dataset)
        session.flush()
        dataset_id = dataset.id
        session.add_all(
            [
                TenantDefaultModel(
                    tenant_id="tenant-1",
                    model_type=ModelType.TEXT_EMBEDDING,
                    provider_name="default-embedding-provider",
                    model_name="default-embedding",
                ),
                TenantDefaultModel(
                    tenant_id="tenant-1",
                    model_type=ModelType.RERANK,
                    provider_name="default-rerank-provider",
                    model_name="default-rerank",
                ),
                TenantDefaultModel(
                    tenant_id="tenant-1",
                    model_type=ModelType.LLM,
                    provider_name="default-llm-provider",
                    model_name="default-llm",
                ),
                TenantDefaultModel(
                    tenant_id="tenant-2",
                    model_type=ModelType.LLM,
                    provider_name="other-tenant-provider",
                    model_name="other-tenant-model",
                ),
            ]
        )

    service = _service(session_factory=sqlite_session_factory)
    provider, preferences = service._load_model_preferences(tenant_id="tenant-1", dataset_id=dataset_id)

    assert provider == "vendor"
    assert preferences.embedding == KnowledgeFSUpgradeModelChoice(provider="legacy-provider", model="legacy-embedding")
    assert preferences.rerank == KnowledgeFSUpgradeModelChoice(provider="legacy-rerank-provider", model="legacy-rerank")
    assert preferences.defaults == {
        ModelType.TEXT_EMBEDDING: KnowledgeFSUpgradeModelChoice(
            provider="default-embedding-provider", model="default-embedding"
        ),
        ModelType.RERANK: KnowledgeFSUpgradeModelChoice(provider="default-rerank-provider", model="default-rerank"),
        ModelType.LLM: KnowledgeFSUpgradeModelChoice(provider="default-llm-provider", model="default-llm"),
    }

    with sqlite_session_factory.begin() as session:
        persisted = session.get(Dataset, dataset_id)
        assert persisted is not None
        persisted.embedding_model_provider = None
        persisted.embedding_model = None
        persisted.retrieval_model = {"reranking_model": "invalid"}

    _, invalid_preferences = service._load_model_preferences(tenant_id="tenant-1", dataset_id=dataset_id)
    assert invalid_preferences.embedding is None
    assert invalid_preferences.rerank is None
    assert invalid_preferences.defaults == preferences.defaults
    with pytest.raises(KnowledgeFSUpgradeNotFoundError):
        service._load_model_preferences(tenant_id="tenant-2", dataset_id=dataset_id)


def test_discovery_includes_recommendations_only_for_eligible_datasets(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        dataset = Dataset(tenant_id="tenant-1", name="Legacy", created_by="account-1", provider="vendor")
        session.add(dataset)
        session.flush()
        dataset_id = dataset.id

    selection = KnowledgeFSUpgradeModelChoice(provider="default-provider", model="default-model")
    recommendation = KnowledgeFSUpgradeModelRecommendationResponse(
        value=selection, source="workspace_default", available=True
    )
    recommendations = KnowledgeFSUpgradeModelRecommendationsResponse(
        embedding=recommendation, rerank=recommendation, reasoning=recommendation
    )
    service = _service(session_factory=sqlite_session_factory)
    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService") as snapshots,
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeModelResolver") as resolver,
    ):
        snapshots.return_value.get_latest.return_value = None
        resolver.return_value.recommend.return_value = recommendations

        available = service.discovery(CONTEXT, dataset_id=dataset_id)
        assert available.can_upgrade is True
        assert available.models == recommendations
        resolver.return_value.recommend.assert_called_once()

        with sqlite_session_factory.begin() as session:
            persisted = session.get(Dataset, dataset_id)
            assert persisted is not None
            persisted.provider = "external"

        blocked = service.discovery(CONTEXT, dataset_id=dataset_id)
        assert blocked.can_upgrade is False
        assert blocked.models is None
        resolver.return_value.recommend.assert_called_once()


def test_start_rejects_reusing_an_idempotency_key_for_a_different_model_selection() -> None:
    enqueue = FakeEnqueue()
    service = _service(enqueue=enqueue)
    existing = upgrade_job(job_id="job-1", old_dataset_id="dataset-1")
    snapshots = FakeSnapshots(job=existing)
    choices = KnowledgeFSUpgradeModelsPayload(
        embedding=KnowledgeFSUpgradeModelChoice(provider="langgenius/openai/openai", model="embedding"),
        rerank=KnowledgeFSUpgradeModelChoice(provider="langgenius/cohere/cohere", model="rerank"),
        reasoning=KnowledgeFSUpgradeModelChoice(provider="langgenius/openai/openai", model="reasoning"),
    )

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots),
        patch.object(snapshots, "get_by_idempotency_key", return_value=existing),
    ):
        with pytest.raises(KnowledgeFSUpgradeConflictError, match="model selection"):
            service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1", models=choices)
        assert enqueue.calls == []
        assert snapshots.create_calls == []

        replay = service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")

    assert replay is existing
    assert len(enqueue.calls) == 1
    assert enqueue.calls[0][1:] == ("tenant-1", "job-1")


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
    model_intent = KnowledgeFSModelIntent(plugin_id="langgenius/openai", provider="openai", model="chosen")
    resolved = KnowledgeFSUpgradeResolvedModels(embedding=model_intent, rerank=model_intent, reasoning=model_intent)

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots),
        patch.object(
            service,
            "_load_model_preferences",
            return_value=("vendor", KnowledgeFSUpgradeModelPreferences(embedding=None, rerank=None, defaults={})),
        ),
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeModelResolver") as resolver,
    ):
        resolver.return_value.resolve_recommendations.return_value = resolved
        job = service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1")

    assert job.id == "job-1"
    assert snapshots.create_calls == [
        {
            "tenant_id": "tenant-1",
            "dataset_id": "dataset-1",
            "requested_by_account_id": "account-1",
            "idempotency_key": "upgrade-request-1",
            "models": resolved,
        }
    ]
    assert enqueue.calls == [(snapshots, "tenant-1", "job-1")]


def test_start_rejects_unavailable_models_before_snapshot_or_enqueue() -> None:
    enqueue = FakeEnqueue()
    service = _service(enqueue=enqueue)
    snapshots = FakeSnapshots()
    choices = KnowledgeFSUpgradeModelsPayload(
        embedding=KnowledgeFSUpgradeModelChoice(provider="openai", model="missing-embedding"),
        rerank=KnowledgeFSUpgradeModelChoice(provider="cohere", model="rerank"),
        reasoning=KnowledgeFSUpgradeModelChoice(provider="anthropic", model="reasoning"),
    )
    issue = KnowledgeFSUpgradeModelIssueResponse(
        field="embedding", reason="not_found", provider="openai", model="missing-embedding"
    )

    with (
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeSnapshotService", return_value=snapshots),
        patch.object(
            service,
            "_load_model_preferences",
            return_value=("vendor", KnowledgeFSUpgradeModelPreferences(embedding=None, rerank=None, defaults={})),
        ),
        patch("services.knowledge.datasets.upgrades.KnowledgeFSUpgradeModelResolver") as resolver,
    ):
        resolver.return_value.validate.side_effect = KnowledgeFSUpgradeModelsUnavailableError([issue])
        with pytest.raises(KnowledgeFSUpgradeModelsUnavailableError):
            service.start(CONTEXT, dataset_id="dataset-1", idempotency_key="upgrade-request-1", models=choices)

    assert snapshots.create_calls == []
    assert enqueue.calls == []


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
