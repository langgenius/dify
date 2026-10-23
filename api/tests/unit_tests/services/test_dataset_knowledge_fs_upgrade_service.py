from __future__ import annotations

import json
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import timedelta
from typing import cast
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetMetadata, DatasetPermissionEnum, Document
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.knowledge_fs import (
    KnowledgeFSAppSpaceJoinType,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSUpgradeDocument,
    KnowledgeFSUpgradeFileLease,
    KnowledgeFSUpgradeFileLeaseStatus,
    KnowledgeFSUpgradeItemStatus,
    KnowledgeFSUpgradeJob,
    KnowledgeFSUpgradeJobStatus,
    KnowledgeFSUpgradeSource,
    KnowledgeFSUpgradeStage,
)
from models.model import UploadFile
from models.oauth import DatasourceProvider
from services import dataset_knowledge_fs_upgrade_service as upgrade_module
from services.dataset_knowledge_fs_upgrade_service import (
    UPGRADE_DELIVERY_TIMEOUT,
    KnowledgeFSUpgradeBusyError,
    KnowledgeFSUpgradeConflictError,
    KnowledgeFSUpgradeDocumentReconciler,
    KnowledgeFSUpgradeError,
    KnowledgeFSUpgradeNotFoundError,
    KnowledgeFSUpgradeNotReadyError,
    KnowledgeFSUpgradeRunner,
    KnowledgeFSUpgradeSnapshotService,
)
from services.knowledge.datasets.upgrades import enqueue_upgrade_job
from services.knowledge_fs.initial_source_import import (
    KnowledgeFSInitialSourceNotReadyError,
    KnowledgeFSInitialSourceSubmission,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSAppBindingPayload,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBackgroundTaskResponse,
    KnowledgeFSDocumentAvailabilityPayload,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentStagedUploadAcceptedResponse,
    KnowledgeFSDurableDeletionJobResponse,
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSMetadataFieldCreatePayload,
    KnowledgeFSMetadataFieldListResponse,
    KnowledgeFSResolvedDocumentReferenceResponse,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSSpaceCreateResponse,
    KnowledgeFSStagedUploadResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSProductResourceNotFoundError
from tests.helpers.unit.services.knowledge_fs_services_a_fakes import CallRecorder, RecordedCall, UnusedSessionFactory

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_ACCOUNT_ID = "00000000-0000-0000-0000-000000000002"
_DATASET_ID = "00000000-0000-0000-0000-000000000003"
_CONTROL_SPACE_ID = "00000000-0000-0000-0000-000000000004"
_UPLOAD_FILE_ID = "00000000-0000-0000-0000-000000000005"
_DOCUMENT_ASSET_ID = "00000000-0000-0000-0000-000000000006"
_LOGICAL_DOCUMENT_ID = "00000000-0000-0000-0000-000000000007"


def _job(**overrides: object) -> KnowledgeFSUpgradeJob:
    values: dict[str, object] = {
        "tenant_id": _TENANT_ID,
        "old_dataset_id": _DATASET_ID,
        "requested_by_account_id": _ACCOUNT_ID,
        "owner_account_id": _ACCOUNT_ID,
        "idempotency_key": "upgrade-service-test",
        "snapshot_at": naive_utc_now(),
        "config_snapshot": {},
        "permission_snapshot": {},
        "app_binding_snapshot": [],
        "tag_ids_snapshot": [],
    }
    values.update(overrides)
    return KnowledgeFSUpgradeJob(**values)  # type: ignore[arg-type]


@dataclass
class FakeRuntime:
    """The subset of the KnowledgeFS runtime that the upgrade runner reaches through ``get_knowledge_fs_runtime``."""

    facade: object = None
    application: object = None
    control_plane: object = None
    app_bindings: object = None
    space_tags: object = None


@dataclass
class FakeUpgradeFacade:
    list_metadata_fields: CallRecorder = field(default_factory=CallRecorder)
    create_metadata_field: CallRecorder = field(default_factory=CallRecorder)
    list_logical_documents: CallRecorder = field(default_factory=CallRecorder)
    update_document_metadata: CallRecorder = field(default_factory=CallRecorder)
    update_logical_document_availability: CallRecorder = field(default_factory=CallRecorder)
    get_document: CallRecorder = field(default_factory=lambda: CallRecorder(result=_document_asset()))
    resolve_document_reference: CallRecorder = field(
        default_factory=lambda: CallRecorder(
            result=KnowledgeFSResolvedDocumentReferenceResponse(document_id=_LOGICAL_DOCUMENT_ID, revision=1)
        )
    )
    get_logical_document: CallRecorder = field(
        default_factory=lambda: CallRecorder(error=KnowledgeFSProductResourceNotFoundError("Document not found"))
    )
    list_background_tasks: CallRecorder = field(
        default_factory=lambda: CallRecorder(result=KnowledgeFSBackgroundTaskListResponse(data=[], next_cursor=None))
    )
    get_deletion_job: CallRecorder = field(default_factory=CallRecorder)


@dataclass
class FakeControlPlane:
    replace_members: CallRecorder = field(default_factory=CallRecorder)
    update_visibility: CallRecorder = field(default_factory=CallRecorder)
    update_external_access: CallRecorder = field(default_factory=CallRecorder)


@dataclass
class FakeAppBindings:
    upsert: CallRecorder = field(default_factory=CallRecorder)


@dataclass
class FakeSpaceTags:
    replace_tags: CallRecorder = field(default_factory=CallRecorder)


@dataclass
class FakeApplication:
    create_space: CallRecorder = field(default_factory=CallRecorder)


@dataclass
class FakeStagedUploads:
    staged: deque[KnowledgeFSStagedUploadResponse] = field(default_factory=deque)
    claimed: deque[KnowledgeFSDocumentStagedUploadAcceptedResponse] = field(default_factory=deque)
    stage_calls: list[dict[str, object]] = field(default_factory=list)
    claim_calls: list[dict[str, object]] = field(default_factory=list)

    def stage(self, **kwargs: object) -> KnowledgeFSStagedUploadResponse:
        self.stage_calls.append(kwargs)
        return self.staged.popleft()

    def claim(self, **kwargs: object) -> KnowledgeFSDocumentStagedUploadAcceptedResponse:
        self.claim_calls.append(kwargs)
        return self.claimed.popleft()


@dataclass(frozen=True)
class FakeModelProvider:
    provider: str


@dataclass(frozen=True)
class FakeActiveModel:
    provider: FakeModelProvider
    model: str


@dataclass
class FakeProviderConfigurations:
    models_by_type: Mapping[ModelType, list[FakeActiveModel]]

    def get_models(self, *, model_type: ModelType, only_active: bool) -> list[FakeActiveModel]:
        assert only_active is True
        return self.models_by_type[model_type]


@dataclass
class FakeProviderManager:
    configurations: FakeProviderConfigurations
    defaults: Mapping[ModelType, FakeActiveModel]
    default_requests: list[tuple[str, ModelType]] = field(default_factory=list)

    def get_configurations(self, tenant_id: str) -> FakeProviderConfigurations:
        assert tenant_id == _TENANT_ID
        return self.configurations

    def get_default_model(self, *, tenant_id: str, model_type: ModelType) -> FakeActiveModel | None:
        self.default_requests.append((tenant_id, model_type))
        return self.defaults.get(model_type)


def _staged_response(upload_id: str) -> KnowledgeFSStagedUploadResponse:
    return KnowledgeFSStagedUploadResponse.model_validate(
        {
            "id": upload_id,
            "fileName": "shared.txt",
            "contentType": "text/plain",
            "sizeBytes": 11,
            "status": "uploaded",
            "expiresAt": "2026-08-17T00:00:00Z",
        }
    )


def _claimed_response(asset_id: str, compilation_job_id: str) -> KnowledgeFSDocumentStagedUploadAcceptedResponse:
    return KnowledgeFSDocumentStagedUploadAcceptedResponse(
        upload_id=f"upload-{asset_id}",
        document_asset_id=asset_id,
        compilation_job_id=compilation_job_id,
    )


def _unused_runner() -> KnowledgeFSUpgradeRunner:
    return KnowledgeFSUpgradeRunner(cast("sessionmaker[Session]", UnusedSessionFactory()))


def _document_asset() -> KnowledgeFSDocumentResponse:
    return KnowledgeFSDocumentResponse.model_validate(
        {
            "id": _DOCUMENT_ASSET_ID,
            "knowledgeSpaceId": "00000000-0000-0000-0000-000000000008",
            "filename": "guide.txt",
            "metadata": {},
            "mimeType": "text/plain",
            "objectKey": "source.txt",
            "parserStatus": "failed",
            "sha256": "a" * 64,
            "sizeBytes": 12,
            "version": 1,
            "createdAt": "2026-08-17T00:00:00Z",
        }
    )


def _logical_document(*, enabled: bool, row_version: int = 1) -> KnowledgeFSLogicalDocumentResponse:
    return KnowledgeFSLogicalDocumentResponse.model_validate(
        {
            "active": {
                "contentHash": "a" * 64,
                "createdAt": "2026-08-17T00:00:00Z",
                "documentAssetId": _DOCUMENT_ASSET_ID,
                "documentAssetVersion": 1,
                "documentId": _LOGICAL_DOCUMENT_ID,
                "knowledgeSpaceId": "00000000-0000-0000-0000-000000000008",
                "mimeType": "text/plain",
                "revision": 1,
                "sizeBytes": 12,
                "state": "candidate",
            },
            "createdAt": "2026-08-17T00:00:00Z",
            "enabled": enabled,
            "id": _LOGICAL_DOCUMENT_ID,
            "knowledgeSpaceId": "00000000-0000-0000-0000-000000000008",
            "rowVersion": row_version,
            "status": "pending",
            "title": "guide.txt",
            "updatedAt": "2026-08-17T00:00:00Z",
            "userMetadata": {},
        }
    )


def test_retry_restores_failed_items_and_unreleased_file_lease(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.FAILED)
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        document = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000010",
            name="guide.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="error",
            status=KnowledgeFSUpgradeItemStatus.FAILED,
            old_upload_file_id=_UPLOAD_FILE_ID,
        )
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key="source-1",
            payload_snapshot={},
            status=KnowledgeFSUpgradeItemStatus.FAILED,
        )
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=_UPLOAD_FILE_ID,
            expires_at=naive_utc_now() - timedelta(days=1),
            status=KnowledgeFSUpgradeFileLeaseStatus.EXPIRED,
        )
        session.add_all([document, source, lease])

    retried = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).retry(
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        job_id=job.id,
    )

    assert retried.status is KnowledgeFSUpgradeJobStatus.QUEUED
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeItemStatus.PENDING
        persisted = session.get(KnowledgeFSUpgradeSource, source.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeItemStatus.PENDING
        persisted_lease = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted_lease is not None
        assert persisted_lease is not None
        assert persisted_lease.status is KnowledgeFSUpgradeFileLeaseStatus.ACTIVE
        assert persisted_lease.expires_at > naive_utc_now()


def test_failed_next_checkpoint_dispatch_leaves_a_recoverable_job(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.RUNNING, celery_task_id="task-1")
    with sqlite_session_factory.begin() as session:
        session.add(job)
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    snapshots = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory)

    assert runner.release_for_dispatch(job_id=job.id, celery_task_id="stale-task") is None
    assert runner.release_for_dispatch(job_id=job.id, celery_task_id="task-1") == _TENANT_ID
    with (
        patch("tasks.knowledge_fs_upgrade_tasks.run_knowledge_fs_upgrade.apply_async", side_effect=OSError("down")),
        pytest.raises(OSError, match="down"),
    ):
        enqueue_upgrade_job(snapshots, _TENANT_ID, job.id)

    retried = snapshots.retry(tenant_id=_TENANT_ID, dataset_id=_DATASET_ID, job_id=job.id)
    assert retried.status is KnowledgeFSUpgradeJobStatus.QUEUED
    assert retried.celery_task_id is None
    assert snapshots.claim_enqueue(tenant_id=_TENANT_ID, job_id=job.id, task_id="task-2") is True


def test_retry_rejects_when_another_dataset_job_is_active(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    failed = _job(status=KnowledgeFSUpgradeJobStatus.FAILED, idempotency_key="failed-upgrade")
    active = _job(status=KnowledgeFSUpgradeJobStatus.RUNNING, idempotency_key="active-upgrade")
    with sqlite_session_factory.begin() as session:
        session.add_all([failed, active])

    with pytest.raises(KnowledgeFSUpgradeConflictError, match="already in progress"):
        KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).retry(
            tenant_id=_TENANT_ID,
            dataset_id=_DATASET_ID,
            job_id=failed.id,
        )


def test_create_starts_a_new_dataset_job_after_success(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant = Tenant(name="Once-only workspace")
    owner = Account(name="Owner", email="upgrade-once-only@example.com")
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, owner])
        session.flush()
        session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=owner.id,
                role=TenantAccountRole.OWNER,
            )
        )
        dataset = Dataset(
            tenant_id=tenant.id,
            name="Legacy once-only",
            description="Already upgraded",
            data_source_type=DataSourceType.UPLOAD_FILE,
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by=owner.id,
        )
        session.add(dataset)
        session.flush()
        succeeded = _job(
            tenant_id=tenant.id,
            old_dataset_id=dataset.id,
            requested_by_account_id=owner.id,
            owner_account_id=owner.id,
            idempotency_key="first-upgrade",
            status=KnowledgeFSUpgradeJobStatus.SUCCEEDED,
            stage=KnowledgeFSUpgradeStage.COMPLETED,
            new_control_space_id=None,
            completed_at=naive_utc_now(),
        )
        session.add(succeeded)
        tenant_id = tenant.id
        dataset_id = dataset.id
        owner_id = owner.id

    result = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).create(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        requested_by_account_id=owner_id,
        idempotency_key="second-upgrade-intent",
    )

    assert result.id != succeeded.id
    assert result.idempotency_key == "second-upgrade-intent"
    with sqlite_session_factory() as session:
        assert len(list(session.scalars(select(KnowledgeFSUpgradeJob)))) == 2


def test_create_reuses_an_active_dataset_job(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant = Tenant(name="Active upgrade workspace")
    owner = Account(name="Owner", email="active-upgrade@example.com")
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, owner])
        session.flush()
        dataset = Dataset(
            tenant_id=tenant.id,
            name="Legacy active upgrade",
            data_source_type=DataSourceType.UPLOAD_FILE,
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by=owner.id,
        )
        session.add(dataset)
        session.flush()
        active = _job(
            tenant_id=tenant.id,
            old_dataset_id=dataset.id,
            requested_by_account_id=owner.id,
            owner_account_id=owner.id,
            idempotency_key="active-upgrade",
            status=KnowledgeFSUpgradeJobStatus.RUNNING,
        )
        session.add(active)
        tenant_id = tenant.id
        dataset_id = dataset.id
        owner_id = owner.id

    result = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).create(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        requested_by_account_id=owner_id,
        idempotency_key="new-upgrade-intent",
    )

    assert result.id == active.id
    with sqlite_session_factory() as session:
        assert len(list(session.scalars(select(KnowledgeFSUpgradeJob)))) == 1


def test_latest_upgrade_lookup_batches_dataset_ids(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first = _job(old_dataset_id=_DATASET_ID, idempotency_key="latest-first")
    second_dataset_id = "00000000-0000-0000-0000-000000000098"
    second = _job(
        old_dataset_id=second_dataset_id,
        idempotency_key="latest-second",
        status=KnowledgeFSUpgradeJobStatus.FAILED,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all([first, second])

    service = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory)
    latest = service.get_latest_by_dataset_ids(
        tenant_id=_TENANT_ID,
        dataset_ids=[_DATASET_ID, second_dataset_id],
    )

    assert latest[_DATASET_ID].id == first.id
    assert latest[second_dataset_id].id == second.id
    assert service.get_latest(tenant_id=_TENANT_ID, dataset_id="00000000-0000-0000-0000-000000000099") is None


def test_upgrade_lookup_prefers_an_active_retry_over_newer_terminal_history(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    active_retry = _job(
        idempotency_key="older-active-retry",
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
    )
    newer_success = _job(
        idempotency_key="newer-success",
        status=KnowledgeFSUpgradeJobStatus.SUCCEEDED,
    )
    active_retry.created_at = naive_utc_now() - timedelta(hours=1)
    newer_success.created_at = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        session.add_all([active_retry, newer_success])

    result = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).get_latest(
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
    )

    assert result is not None
    assert result.id == active_retry.id


def test_list_upgrade_jobs_filters_tenant_and_status(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    older_running = _job(
        idempotency_key="older-running",
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
    )
    newer_failed = _job(
        idempotency_key="newer-failed",
        status=KnowledgeFSUpgradeJobStatus.FAILED,
    )
    succeeded = _job(
        idempotency_key="succeeded",
        status=KnowledgeFSUpgradeJobStatus.SUCCEEDED,
    )
    other_tenant = _job(
        idempotency_key="other-tenant",
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
    )
    other_tenant.tenant_id = "tenant-2"
    older_running.created_at = naive_utc_now() - timedelta(hours=1)
    newer_failed.created_at = naive_utc_now()
    with sqlite_session_factory.begin() as session:
        session.add_all([older_running, newer_failed, succeeded, other_tenant])

    jobs = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).list_by_statuses(
        tenant_id=_TENANT_ID,
        statuses=(KnowledgeFSUpgradeJobStatus.RUNNING, KnowledgeFSUpgradeJobStatus.FAILED),
    )

    assert [job.id for job in jobs] == [newer_failed.id, older_running.id]


@pytest.mark.parametrize(
    ("job_status", "feature_enabled", "provider", "can_upgrade", "can_retry", "reason"),
    [
        (None, True, "vendor", True, False, None),
        (KnowledgeFSUpgradeJobStatus.QUEUED, True, "vendor", False, False, "upgrade_in_progress"),
        (KnowledgeFSUpgradeJobStatus.RUNNING, True, "vendor", False, False, "upgrade_in_progress"),
        (KnowledgeFSUpgradeJobStatus.FAILED, True, "vendor", True, True, "retry_required"),
        (KnowledgeFSUpgradeJobStatus.SUCCEEDED, True, "vendor", True, False, None),
        (None, False, "vendor", False, False, "feature_disabled"),
        (None, True, "external", False, False, "unsupported_dataset_provider"),
    ],
)
def test_upgrade_discovery_exposes_allowed_action(
    job_status: KnowledgeFSUpgradeJobStatus | None,
    feature_enabled: bool,
    provider: str,
    can_upgrade: bool,
    can_retry: bool,
    reason: str | None,
) -> None:
    job = _job(status=job_status) if job_status else None

    response = upgrade_module.upgrade_discovery_response(
        job,
        feature_enabled=feature_enabled,
        dataset_provider=provider,
    )

    assert response.can_upgrade is can_upgrade
    assert response.can_retry is can_retry
    assert response.block_reason == reason
    assert (response.job is None) is (job is None)


def test_snapshot_is_immutable_after_the_legacy_dataset_changes(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant = Tenant(name="Upgrade workspace")
    owner = Account(name="Owner", email="upgrade-owner@example.com")
    with sqlite_session_factory.begin() as session:
        session.add_all([tenant, owner])
        session.flush()
        session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=owner.id,
                role=TenantAccountRole.OWNER,
            )
        )
        dataset = Dataset(
            tenant_id=tenant.id,
            name="Legacy handbook",
            description="Click-time description",
            data_source_type=DataSourceType.UPLOAD_FILE,
            permission=DatasetPermissionEnum.ONLY_ME,
            created_by=owner.id,
            embedding_model="text-embedding-3-large",
            embedding_model_provider="openai",
            retrieval_model={"top_k": 8, "reranking_enable": True},
            enable_api=True,
        )
        session.add(dataset)
        session.flush()
        upload_file = UploadFile(
            tenant_id=tenant.id,
            storage_type=StorageType.LOCAL,
            key=f"upload_files/{tenant.id}/handbook.txt",
            name="handbook.txt",
            size=12,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=owner.id,
            created_at=naive_utc_now(),
            used=False,
        )
        metadata = DatasetMetadata(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            type="string",
            name="department",
            created_by=owner.id,
        )
        document = Document(
            id="00000000-0000-0000-0000-000000000012",
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info=json.dumps({"upload_file_id": upload_file.id}),
            batch="batch-1",
            name="handbook.txt",
            created_from=DocumentCreatedFrom.WEB,
            created_by=owner.id,
            enabled=False,
            archived=True,
            indexing_status=IndexingStatus.COMPLETED,
            doc_metadata={"department": "support"},
        )
        session.add_all([upload_file, metadata, document])
        tenant_id = tenant.id
        owner_id = owner.id
        dataset_id = dataset.id

    job = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).create(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        requested_by_account_id=owner_id,
        idempotency_key="immutable-snapshot",
    )
    replayed = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).create(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        requested_by_account_id=owner_id,
        idempotency_key="immutable-snapshot",
    )
    assert replayed.id == job.id
    with sqlite_session_factory.begin() as session:
        persisted_dataset = session.get(Dataset, dataset_id)
        persisted_document = session.get(Document, document.id)
        assert persisted_dataset is not None
        assert persisted_document is not None
        persisted_dataset.name = "Changed after click"
        persisted_document.enabled = True
        persisted_document.archived = False

    with sqlite_session_factory() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        snapshot_document = session.scalar(
            select(KnowledgeFSUpgradeDocument).where(KnowledgeFSUpgradeDocument.job_id == job.id)
        )
        assert persisted_job is not None
        assert snapshot_document is not None
        assert persisted_job.config_snapshot["name"] == "Legacy handbook"
        assert persisted_job.config_snapshot["embedding_model"] == "text-embedding-3-large"
        assert persisted_job.config_snapshot["embedding_model_provider"] == "openai"
        assert persisted_job.config_snapshot["retrieval_model"] == {"top_k": 8, "reranking_enable": True}
        assert persisted_job.config_snapshot["enable_api"] is True
        assert persisted_job.config_snapshot["metadata_fields"] == [{"name": "department", "type": "string"}]
        assert snapshot_document.desired_enabled is False
        assert snapshot_document.legacy_archived is True
        assert snapshot_document.metadata_snapshot == {"department": "support"}


def test_finalize_requires_every_document_and_source_handoff(sqlite_session_factory: sessionmaker[Session]) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.FINALIZING,
        total_documents=2,
        completed_documents=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)

    with pytest.raises(KnowledgeFSUpgradeError, match="Not all Dataset documents"):
        KnowledgeFSUpgradeRunner(sqlite_session_factory)._finalize(job)


def test_shared_source_file_lease_is_released_after_every_document_handoff(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = Account(name="Upgrade owner", email="upgrade-shared-file@example.com")
    with sqlite_session_factory.begin() as session:
        session.add(account)
        session.flush()
        upload_file = UploadFile(
            tenant_id=_TENANT_ID,
            storage_type=StorageType.LOCAL,
            key=f"upload_files/{_TENANT_ID}/shared.txt",
            name="shared.txt",
            size=12,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=naive_utc_now(),
            used=False,
        )
        job = _job(
            owner_account_id=account.id,
            status=KnowledgeFSUpgradeJobStatus.RUNNING,
            stage=KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS,
            new_control_space_id=_CONTROL_SPACE_ID,
            total_documents=2,
        )
        session.add_all([upload_file, job])
        session.flush()
        for suffix in ("21", "22"):
            session.add(
                KnowledgeFSUpgradeDocument(
                    job_id=job.id,
                    tenant_id=_TENANT_ID,
                    old_document_id=f"00000000-0000-0000-0000-0000000000{suffix}",
                    name=f"guide-{suffix}.txt",
                    data_source_type="upload_file",
                    data_source_info={"upload_file_id": upload_file.id},
                    metadata_snapshot={},
                    desired_enabled=True,
                    legacy_archived=False,
                    legacy_indexing_status="completed",
                    old_upload_file_id=upload_file.id,
                )
            )
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=upload_file.id,
            expires_at=naive_utc_now() + timedelta(days=1),
        )
        session.add(lease)

    staged = FakeStagedUploads(
        staged=deque([_staged_response("staged-1"), _staged_response("staged-2")]),
        claimed=deque(
            [
                _claimed_response("asset-1", "compilation-1"),
                _claimed_response("asset-2", "compilation-2"),
            ]
        ),
    )
    monkeypatch.setattr(upgrade_module, "KnowledgeFSStagedUploadService", lambda *_args, **_kwargs: staged)
    facade = FakeUpgradeFacade(
        resolve_document_reference=CallRecorder(
            outcomes=deque(
                [
                    KnowledgeFSResolvedDocumentReferenceResponse(document_id="logical-1", revision=1),
                    KnowledgeFSResolvedDocumentReferenceResponse(document_id="logical-2", revision=1),
                ]
            )
        )
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))
    monkeypatch.setattr(upgrade_module.storage, "load", lambda _key: b"shared body")
    monkeypatch.setattr(
        upgrade_module.FeatureService,
        "get_knowledge_file_size_limit",
        lambda _tenant_id: 15,
    )

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert runner._submit_next_document(job) is True
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeFileLeaseStatus.ACTIVE

    assert runner._submit_next_document(job) is True
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeFileLeaseStatus.RELEASED
        assert persisted.released_at is not None
    assert [call["body"] for call in staged.stage_calls] == [b"shared body", b"shared body"]
    assert len(staged.claim_calls) == 2
    with sqlite_session_factory() as session:
        identities = {
            row[0]: row[1]
            for row in session.execute(
                select(
                    KnowledgeFSUpgradeDocument.new_document_asset_id, KnowledgeFSUpgradeDocument.new_logical_document_id
                ).where(KnowledgeFSUpgradeDocument.job_id == job.id)
            ).all()
        }
    assert identities == {"asset-1": "logical-1", "asset-2": "logical-2"}


@pytest.mark.parametrize(("metadata_fails", "availability_fails"), [(False, False), (True, False), (False, True)])
def test_reconciler_restores_availability_before_metadata_and_preserves_later_user_edits(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    metadata_fails: bool,
    availability_fails: bool,
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.SUCCEEDED,
        stage=KnowledgeFSUpgradeStage.COMPLETED,
        new_control_space_id=_CONTROL_SPACE_ID,
        config_snapshot={"metadata_fields": [{"name": "department", "type": "string"}]},
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        document = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000011",
            name="guide.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={"department": "support"},
            desired_enabled=False,
            legacy_archived=True,
            legacy_indexing_status="completed",
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            old_upload_file_id=_UPLOAD_FILE_ID,
            new_document_asset_id=_DOCUMENT_ASSET_ID,
        )
        session.add(document)

    initial = _logical_document(enabled=True, row_version=1)
    after_availability = initial.model_copy(update={"enabled": False, "row_version": 2})
    after_metadata = after_availability.model_copy(update={"row_version": 3})
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[initial], next_cursor=None)
        ),
        update_document_metadata=CallRecorder(
            result=after_metadata, error=RuntimeError("metadata rejected") if metadata_fails else None
        ),
        update_logical_document_availability=CallRecorder(
            result=after_availability, error=RuntimeError("availability rejected") if availability_fails else None
        ),
    )
    monkeypatch.setattr(
        upgrade_module,
        "get_knowledge_fs_runtime",
        lambda _: FakeRuntime(facade=facade),
    )

    reconciler = KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory)
    assert reconciler.reconcile(job_id=job.id) == int(metadata_fails or availability_fails)
    if availability_fails:
        assert facade.update_document_metadata.calls == []
        with sqlite_session_factory() as session:
            persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
            assert persisted is not None
            assert persisted.availability_reconciled_at is None
        facade.update_logical_document_availability.error = None
        assert reconciler.reconcile(job_id=job.id) == 0

    metadata_payload = facade.update_document_metadata.last.kwargs["payload"]
    assert isinstance(metadata_payload, KnowledgeFSDocumentMetadataPayload)
    assert metadata_payload.expected_row_version == 2
    assert metadata_payload.patch == {"department": "support"}
    availability_payload = facade.update_logical_document_availability.last.kwargs["payload"]
    assert isinstance(availability_payload, KnowledgeFSDocumentAvailabilityPayload)
    assert availability_payload.expected_row_version == 1
    assert availability_payload.enabled is False
    with sqlite_session_factory() as session:
        persisted = session.scalar(
            select(KnowledgeFSUpgradeDocument).where(KnowledgeFSUpgradeDocument.id == document.id)
        )
        assert persisted is not None
        assert persisted.new_logical_document_id == _LOGICAL_DOCUMENT_ID
        assert persisted.availability_reconciled_at is not None
        assert (persisted.state_reconciled_at is None) is metadata_fails

    if metadata_fails:
        # A subsequent metadata retry must not undo an owner's intentional re-enable.
        reenabled = after_metadata.model_copy(update={"enabled": True, "row_version": 4})
        facade.list_logical_documents.result = KnowledgeFSLogicalDocumentListResponse(
            data=[reenabled], next_cursor=None
        )
        facade.update_document_metadata.error = None
        facade.update_document_metadata.result = reenabled.model_copy(update={"row_version": 5})
        assert reconciler.reconcile(job_id=job.id) == 0
        assert len(facade.update_logical_document_availability.calls) == 1


def test_metadata_fields_are_created_idempotently() -> None:
    job = _job(
        new_control_space_id=_CONTROL_SPACE_ID,
        config_snapshot={
            "metadata_fields": [
                {"name": "department", "type": "string"},
                {"name": "priority", "type": "number"},
            ]
        },
    )
    facade = FakeUpgradeFacade()
    facade.list_metadata_fields.result = KnowledgeFSMetadataFieldListResponse(
        data=[
            {
                "id": "field-1",
                "name": "department",
                "type": "string",
                "count": 0,
                "rowVersion": 0,
                "createdAt": "2026-08-17T00:00:00Z",
                "updatedAt": "2026-08-17T00:00:00Z",
            }
        ],
        next_cursor=None,
    )

    upgrade_module._migrate_metadata_fields(job, facade)

    assert len(facade.create_metadata_field.calls) == 1
    created = facade.create_metadata_field.last.kwargs["payload"]
    assert isinstance(created, KnowledgeFSMetadataFieldCreatePayload)
    assert created.model_dump() == {
        "name": "priority",
        "type": "number",
    }


def _active_model(provider: str, model: str) -> FakeActiveModel:
    return FakeActiveModel(provider=FakeModelProvider(provider=provider), model=model)


def test_configuration_prefers_active_legacy_models_and_uses_default_reasoning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    embedding = _active_model("langgenius/openai/openai", "text-embedding-3-large")
    rerank = _active_model("langgenius/cohere/cohere", "rerank-v3.5")
    reasoning = _active_model("langgenius/anthropic/anthropic", "claude-sonnet")
    models_by_type = {
        ModelType.TEXT_EMBEDDING: [embedding],
        ModelType.RERANK: [rerank],
        ModelType.LLM: [reasoning],
    }
    provider_manager = FakeProviderManager(
        configurations=FakeProviderConfigurations(models_by_type),
        defaults={ModelType.LLM: reasoning},
    )
    monkeypatch.setattr(upgrade_module, "create_plugin_provider_manager", lambda **_kwargs: provider_manager)
    job = _job(
        config_snapshot={
            "embedding_model_provider": "openai",
            "embedding_model": "text-embedding-3-large",
            "retrieval_model": {
                "top_k": 12,
                "score_threshold_enabled": True,
                "score_threshold": 0.72,
                "reranking_model": {
                    "reranking_provider_name": "cohere",
                    "reranking_model_name": "rerank-v3.5",
                },
            },
        }
    )

    resolved = upgrade_module._resolve_configuration(job)

    assert resolved["embedding"] == {
        "pluginId": "langgenius/openai",
        "provider": "openai",
        "model": "text-embedding-3-large",
    }
    retrieval = resolved["retrieval"]
    assert isinstance(retrieval, dict)
    assert retrieval["reasoningModel"] == {
        "pluginId": "langgenius/anthropic",
        "provider": "anthropic",
        "model": "claude-sonnet",
    }
    assert retrieval["rerank"] == {
        "enabled": True,
        "model": {
            "pluginId": "langgenius/cohere",
            "provider": "cohere",
            "model": "rerank-v3.5",
        },
    }
    assert retrieval["scoreThreshold"] == {"enabled": True, "stage": "mode-final", "value": 0.72}
    assert retrieval["topK"] == 12
    assert provider_manager.default_requests == [(_TENANT_ID, ModelType.LLM)]


def test_configuration_falls_back_to_active_workspace_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    defaults = {
        ModelType.TEXT_EMBEDDING: _active_model("langgenius/openai/openai", "embedding-default"),
        ModelType.RERANK: _active_model("langgenius/cohere/cohere", "rerank-default"),
        ModelType.LLM: _active_model("langgenius/anthropic/anthropic", "reasoning-default"),
    }
    provider_manager = FakeProviderManager(
        configurations=FakeProviderConfigurations({model_type: [model] for model_type, model in defaults.items()}),
        defaults=defaults,
    )
    monkeypatch.setattr(upgrade_module, "create_plugin_provider_manager", lambda **_kwargs: provider_manager)
    job = _job(
        config_snapshot={
            "embedding_model_provider": "openai",
            "embedding_model": "inactive-legacy-embedding",
            "retrieval_model": {
                "reranking_model": {
                    "reranking_provider_name": "cohere",
                    "reranking_model_name": "inactive-legacy-rerank",
                }
            },
        }
    )

    resolved = upgrade_module._resolve_configuration(job)

    embedding = resolved["embedding"]
    assert isinstance(embedding, dict)
    assert embedding["model"] == "embedding-default"
    retrieval = resolved["retrieval"]
    assert isinstance(retrieval, dict)
    assert retrieval["rerank"]["model"]["model"] == "rerank-default"
    retrieval = resolved["retrieval"]
    assert isinstance(retrieval, dict)
    assert retrieval["reasoningModel"]["model"] == "reasoning-default"
    retrieval = resolved["retrieval"]
    assert isinstance(retrieval, dict)
    assert retrieval["topK"] == 4


def test_configuration_fails_when_workspace_default_reasoning_model_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    embedding = _active_model("langgenius/openai/openai", "embedding")
    rerank = _active_model("langgenius/cohere/cohere", "rerank")
    models_by_type = {
        ModelType.TEXT_EMBEDDING: [embedding],
        ModelType.RERANK: [rerank],
        ModelType.LLM: list[FakeActiveModel](),
    }
    provider_manager = FakeProviderManager(configurations=FakeProviderConfigurations(models_by_type), defaults={})
    monkeypatch.setattr(upgrade_module, "create_plugin_provider_manager", lambda **_kwargs: provider_manager)
    job = _job(
        config_snapshot={
            "embedding_model_provider": "openai",
            "embedding_model": "embedding",
            "retrieval_model": {
                "reranking_model": {
                    "reranking_provider_name": "cohere",
                    "reranking_model_name": "rerank",
                }
            },
        }
    )

    with pytest.raises(KnowledgeFSUpgradeError, match="Workspace default llm model is unavailable"):
        upgrade_module._resolve_configuration(job)


def test_access_migration_maps_visibility_members_apps_api_and_tags(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    viewer_id = "00000000-0000-0000-0000-000000000030"
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.MIGRATING_ACCESS,
        new_control_space_id=_CONTROL_SPACE_ID,
        config_snapshot={"enable_api": True, "metadata_fields": []},
        permission_snapshot={
            "visibility": KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS.value,
            "member_account_ids": [_ACCOUNT_ID, viewer_id],
        },
        app_binding_snapshot=[
            {"app_id": "00000000-0000-0000-0000-000000000031", "caller_kind": "agent"},
            {"app_id": "00000000-0000-0000-0000-000000000032", "caller_kind": "workflow"},
        ],
        tag_ids_snapshot=["00000000-0000-0000-0000-000000000033"],
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)

    facade = FakeUpgradeFacade()
    control_plane = FakeControlPlane()
    app_bindings = FakeAppBindings()
    space_tags = FakeSpaceTags()
    runtime = FakeRuntime(
        facade=facade,
        control_plane=control_plane,
        app_bindings=app_bindings,
        space_tags=space_tags,
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: runtime)

    KnowledgeFSUpgradeRunner(sqlite_session_factory)._migrate_access(job)

    assert facade.list_metadata_fields.calls == []
    members = control_plane.replace_members.last.kwargs["members"]
    assert isinstance(members, list)
    assert len(members) == 1
    assert members[0].account_id == viewer_id
    assert members[0].role is KnowledgeFSControlSpacePermissionRole.VIEWER
    assert control_plane.update_visibility.last.kwargs["visibility"] is (
        KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS
    )
    external_access = control_plane.update_external_access.last.kwargs["payload"]
    assert isinstance(external_access, KnowledgeFSExternalAccessPayload)
    assert external_access.service_api_enabled is True
    assert external_access.agent_enabled is True
    assert external_access.workflow_enabled is True
    assert external_access.mcp_enabled is False
    binding_payloads = [call.kwargs["payload"] for call in app_bindings.upsert.calls]
    assert all(isinstance(payload, KnowledgeFSAppBindingPayload) for payload in binding_payloads)
    assert [cast(KnowledgeFSAppBindingPayload, payload).caller_kind for payload in binding_payloads] == [
        KnowledgeFSAppSpaceJoinType.AGENT,
        KnowledgeFSAppSpaceJoinType.WORKFLOW,
    ]
    assert space_tags.replace_tags.last.kwargs["tag_ids"] == job.tag_ids_snapshot
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.stage is KnowledgeFSUpgradeStage.FINALIZING


@pytest.mark.parametrize(
    ("stage", "method_name", "result", "expected"),
    [
        (KnowledgeFSUpgradeStage.WAITING_FOR_SPACE, "_advance_when_space_is_active", None, True),
        (KnowledgeFSUpgradeStage.CREATING_SOURCES, "_create_next_source", True, True),
        (KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS, "_submit_next_document", True, True),
        (KnowledgeFSUpgradeStage.MIGRATING_ACCESS, "_migrate_access", None, True),
        (KnowledgeFSUpgradeStage.FINALIZING, "_finalize", None, False),
    ],
)
def test_runner_dispatches_each_durable_stage(
    stage: KnowledgeFSUpgradeStage,
    method_name: str,
    result: bool | None,
    expected: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.QUEUED, stage=stage)
    runner = _unused_runner()
    mark_running = CallRecorder(result=job)
    stage_method = CallRecorder(result=result)
    monkeypatch.setattr(runner, "_mark_running", mark_running)
    monkeypatch.setattr(runner, method_name, stage_method)

    assert runner.run_next(job_id=job.id, celery_task_id="task-1") is expected

    assert mark_running.calls == [RecordedCall((), {"job_id": job.id, "celery_task_id": "task-1"})]
    assert stage_method.calls == [RecordedCall((job,), {})]


def test_runner_validation_creates_space_and_waits(monkeypatch: pytest.MonkeyPatch) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.QUEUED, stage=KnowledgeFSUpgradeStage.VALIDATING)
    runner = _unused_runner()
    create_space = CallRecorder()
    monkeypatch.setattr(runner, "_mark_running", CallRecorder(result=job))
    monkeypatch.setattr(runner, "_create_space", create_space)

    with pytest.raises(KnowledgeFSUpgradeNotReadyError, match="provisioning is pending"):
        runner.run_next(job_id=job.id, celery_task_id="task-1")

    assert create_space.calls == [RecordedCall((job,), {})]


def test_runner_skips_superseded_deliveries(monkeypatch: pytest.MonkeyPatch) -> None:
    runner = _unused_runner()
    monkeypatch.setattr(runner, "_mark_running", CallRecorder(result=None))
    assert runner.run_next(job_id="obsolete", celery_task_id="old-task") is None


def test_runner_failure_loading_and_running_state_are_persisted(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.QUEUED)
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        lease = KnowledgeFSUpgradeFileLease(
            job_id=job.id,
            old_upload_file_id=_UPLOAD_FILE_ID,
            expires_at=naive_utc_now() + timedelta(minutes=1),
        )
        session.add(lease)

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert KnowledgeFSUpgradeSnapshotService(sqlite_session_factory).claim_enqueue(
        tenant_id=_TENANT_ID, job_id=job.id, task_id="task-2"
    )
    runner._mark_running(job_id=job.id, celery_task_id="task-2")
    runner.fail(job_id=job.id, celery_task_id="task-2", error=ValueError("broken"))

    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        persisted_lease = session.get(KnowledgeFSUpgradeFileLease, lease.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeJobStatus.FAILED
        assert persisted.attempt_count == 1
        assert persisted.celery_task_id == "task-2"
        assert persisted.last_error_code == "ValueError"
        assert persisted.last_error_message == "broken"
        assert persisted.completed_at is not None
        assert persisted_lease is not None
        assert persisted_lease.expires_at > naive_utc_now() + timedelta(days=6)

    with pytest.raises(KnowledgeFSUpgradeNotFoundError):
        runner._mark_running(job_id="00000000-0000-0000-0000-000000000099", celery_task_id="missing-task")

    runner.fail(
        job_id="00000000-0000-0000-0000-000000000099", celery_task_id="missing-task", error=RuntimeError("ignored")
    )


def _resolved_configuration() -> dict[str, object]:
    return {
        "embedding": {"pluginId": "langgenius/openai", "provider": "openai", "model": "embedding"},
        "retrieval": {
            "defaultMode": "fast",
            "reasoningModel": {
                "pluginId": "langgenius/anthropic",
                "provider": "anthropic",
                "model": "reasoning",
            },
            "rerank": {
                "enabled": True,
                "model": {"pluginId": "langgenius/cohere", "provider": "cohere", "model": "rerank"},
            },
            "scoreThreshold": {"enabled": False, "stage": "mode-final", "value": None},
            "topK": 4,
        },
    }


def test_runner_creates_space_and_advances_after_activation(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.VALIDATING,
        total_sources=1,
        config_snapshot={"name": "Legacy", "description": "Description", "icon": "book"},
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)

    application = FakeApplication(
        create_space=CallRecorder(
            result=KnowledgeFSSpaceCreateResponse(
                control_space_id=_CONTROL_SPACE_ID,
                state=KnowledgeFSControlSpaceState.PROVISIONING,
                operation_id="operation-1",
                model_setup_required=False,
            )
        )
    )
    monkeypatch.setattr(upgrade_module, "_resolve_configuration", lambda _job: _resolved_configuration())
    monkeypatch.setattr(
        upgrade_module,
        "get_knowledge_fs_runtime",
        lambda _: FakeRuntime(application=application),
    )
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    runner._create_space(job)

    payload = application.create_space.last.kwargs["payload"]
    assert isinstance(payload, KnowledgeFSSpaceCreatePayload)
    assert payload.name == "Legacy"
    assert payload.idempotency_key == f"upgrade:{job.id}:space"
    with sqlite_session_factory.begin() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.stage is KnowledgeFSUpgradeStage.WAITING_FOR_SPACE
        control_space = KnowledgeFSControlSpace(
            tenant_id=_TENANT_ID,
            owner_account_id=_ACCOUNT_ID,
            provisioning_key="upgrade-test-space",
            knowledge_space_id="00000000-0000-0000-0000-000000000040",
            state=KnowledgeFSControlSpaceState.ACTIVE,
        )
        session.add(control_space)
        session.flush()
        persisted.new_control_space_id = control_space.id
        control_space_id = control_space.id

    job.new_control_space_id = control_space_id
    runner._advance_when_space_is_active(job)
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.stage is KnowledgeFSUpgradeStage.CREATING_SOURCES


def test_runner_waiting_for_space_reports_each_invalid_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.RUNNING, stage=KnowledgeFSUpgradeStage.WAITING_FOR_SPACE)
    with sqlite_session_factory.begin() as session:
        session.add(job)
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)

    with pytest.raises(KnowledgeFSUpgradeError, match="reference is missing"):
        runner._advance_when_space_is_active(job)

    job.new_control_space_id = _CONTROL_SPACE_ID
    with pytest.raises(KnowledgeFSUpgradeError, match="was not found"):
        runner._advance_when_space_is_active(job)

    with sqlite_session_factory.begin() as session:
        control_space = KnowledgeFSControlSpace(
            tenant_id=_TENANT_ID,
            owner_account_id=_ACCOUNT_ID,
            provisioning_key="upgrade-test-provisioning",
        )
        session.add(control_space)
        session.flush()
        job.new_control_space_id = control_space.id
        control_space_id = control_space.id

    with pytest.raises(KnowledgeFSUpgradeNotReadyError, match="provisioning is pending"):
        runner._advance_when_space_is_active(job)

    with sqlite_session_factory.begin() as session:
        control_space = session.get(KnowledgeFSControlSpace, control_space_id)
        assert control_space is not None
        control_space.state = KnowledgeFSControlSpaceState.ERROR
    with pytest.raises(KnowledgeFSUpgradeError, match="failed in error"):
        runner._advance_when_space_is_active(job)


def _website_source_payload() -> dict[str, object]:
    return {
        "kind": "website_crawl",
        "name": "Legacy Web",
        "provider": "firecrawl",
        "datasource": "crawl",
        "parameters": {"only_main_content": True},
        "root_url": "https://example.com",
        "crawl_options": {"include_subpages": False, "limit": 1},
        "selection": [{"source_url": "https://example.com/page", "title": "Page"}],
        "sync_policy": "manual",
    }


def test_runner_creates_source_and_marks_its_documents_handed_off(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    source_key = "website:firecrawl:job:1"
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.CREATING_SOURCES,
        new_control_space_id=_CONTROL_SPACE_ID,
        total_documents=2,
        total_sources=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key=source_key,
            payload_snapshot=_website_source_payload(),
        )
        documents = [
            KnowledgeFSUpgradeDocument(
                job_id=job.id,
                tenant_id=_TENANT_ID,
                old_document_id=f"00000000-0000-0000-0000-00000000005{index}",
                name=f"page-{index}",
                data_source_type="website_crawl",
                data_source_info={"url": f"https://example.com/{index}"},
                metadata_snapshot={},
                desired_enabled=True,
                legacy_archived=False,
                legacy_indexing_status="completed",
                source_key=source_key,
            )
            for index in range(2)
        ]
        session.add_all([source, *documents])

    submit = CallRecorder(
        result=KnowledgeFSInitialSourceSubmission(
            connection_id="connection-1",
            source_id="source-1",
            workflow_id="workflow-1",
            workflow_error="initial-sync-failed",
        )
    )
    monkeypatch.setattr(upgrade_module, "submit_initial_source_for_upgrade", submit)
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert runner._create_next_source(job) is True
    assert len(submit.calls) == 1

    with sqlite_session_factory() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        persisted_source = session.get(KnowledgeFSUpgradeSource, source.id)
        assert persisted_job is not None
        assert persisted_job.completed_documents == 2
        assert persisted_job.completed_sources == 1
        assert persisted_source is not None
        assert persisted_source.status is KnowledgeFSUpgradeItemStatus.SUCCEEDED
        assert persisted_source.last_error_code == "initial-sync-failed"
        assert all(
            item.status is KnowledgeFSUpgradeItemStatus.SUCCEEDED
            for item in session.scalars(
                select(KnowledgeFSUpgradeDocument).where(KnowledgeFSUpgradeDocument.job_id == job.id)
            )
        )

    assert runner._create_next_source(job) is True
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.stage is KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS


@pytest.mark.parametrize("not_ready", [True, False])
def test_runner_source_failure_is_retryable_or_persisted(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, not_ready: bool
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.CREATING_SOURCES,
        new_control_space_id=_CONTROL_SPACE_ID,
        total_sources=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key=f"source-failure-{not_ready}",
            payload_snapshot=_website_source_payload(),
        )
        session.add(source)

    error: Exception = KnowledgeFSInitialSourceNotReadyError("busy") if not_ready else RuntimeError("source failed")
    monkeypatch.setattr(upgrade_module, "submit_initial_source_for_upgrade", CallRecorder(error=error))
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)

    expected_error = KnowledgeFSUpgradeNotReadyError if not_ready else RuntimeError
    with pytest.raises(expected_error):
        runner._create_next_source(job)

    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeSource, source.id)
        assert persisted is not None
        expected_status = KnowledgeFSUpgradeItemStatus.PENDING if not_ready else KnowledgeFSUpgradeItemStatus.FAILED
        assert persisted.status is expected_status
        if not not_ready:
            assert persisted.last_error_code == "RuntimeError"
            assert persisted.last_error_message == "source failed"


def test_runner_document_boundaries_and_successful_finalize(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        stage=KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS,
        new_control_space_id=_CONTROL_SPACE_ID,
        total_documents=1,
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        document = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000060",
            name="missing.txt",
            data_source_type="upload_file",
            data_source_info={},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
        )
        session.add(document)

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    with pytest.raises(KnowledgeFSUpgradeError, match="no source file reference"):
        runner._submit_next_document(job)
    with sqlite_session_factory.begin() as session:
        persisted_document = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted_document is not None
        assert persisted_document.status is KnowledgeFSUpgradeItemStatus.FAILED
        persisted_document.status = KnowledgeFSUpgradeItemStatus.SUCCEEDED
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted_job is not None
        persisted_job.completed_documents = 1

    assert runner._submit_next_document(job) is True
    with sqlite_session_factory.begin() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted_job is not None
        assert persisted_job.stage is KnowledgeFSUpgradeStage.MIGRATING_ACCESS
        persisted_job.stage = KnowledgeFSUpgradeStage.FINALIZING

    runner._finalize(job)
    with sqlite_session_factory() as session:
        persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted_job is not None
        assert persisted_job.status is KnowledgeFSUpgradeJobStatus.SUCCEEDED
        assert persisted_job.stage is KnowledgeFSUpgradeStage.COMPLETED
        assert persisted_job.completed_at is not None


def _source_document(data_source_type: DataSourceType) -> Document:
    return Document(
        tenant_id=_TENANT_ID,
        dataset_id=_DATASET_ID,
        position=1,
        data_source_type=data_source_type,
        batch="batch-1",
        name="Page",
        created_from=DocumentCreatedFrom.WEB,
        created_by=_ACCOUNT_ID,
    )


def test_upgrade_helper_source_identities_payloads_and_validation() -> None:
    notion = KnowledgeFSUpgradeDocument(
        job_id="00000000-0000-0000-0000-000000000070",
        tenant_id=_TENANT_ID,
        old_document_id="00000000-0000-0000-0000-000000000071",
        name="Notion page",
        data_source_type="notion_import",
        data_source_info={"workspace_id": "workspace", "notion_page_id": "page"},
        metadata_snapshot={},
        desired_enabled=True,
        legacy_archived=False,
        legacy_indexing_status="completed",
    )
    website = KnowledgeFSUpgradeDocument(
        job_id="00000000-0000-0000-0000-000000000070",
        tenant_id=_TENANT_ID,
        old_document_id="00000000-0000-0000-0000-000000000072",
        name="Website page",
        data_source_type="website_crawl",
        data_source_info={"url": "https://example.com/page"},
        metadata_snapshot={},
        desired_enabled=True,
        legacy_archived=False,
        legacy_indexing_status="completed",
    )
    unsupported = KnowledgeFSUpgradeDocument(
        job_id="00000000-0000-0000-0000-000000000070",
        tenant_id=_TENANT_ID,
        old_document_id="00000000-0000-0000-0000-000000000073",
        name="Unsupported",
        data_source_type="upload_file",
        data_source_info={},
        metadata_snapshot={},
        desired_enabled=True,
        legacy_archived=False,
        legacy_indexing_status="completed",
    )

    assert upgrade_module._expected_provider_item_id(notion) == '["workspace","page"]'
    assert (
        upgrade_module._expected_provider_item_id(website)
        == upgrade_module.sha256(b"https://example.com/page").hexdigest()
    )
    with pytest.raises(KnowledgeFSUpgradeError, match="no provider item identity"):
        upgrade_module._expected_provider_item_id(unsupported)

    assert upgrade_module._notion_source_group_key({"workspace_id": "workspace", "credential_id": "cred"}) == (
        "notion:workspace:cred"
    )
    assert (
        upgrade_module._website_source_group_key(
            {"provider": " Firecrawl ", "job_id": "crawl", "url": "https://example.com"}
        )
        == "website:firecrawl:crawl"
    )
    with pytest.raises(KnowledgeFSUpgradeConflictError):
        upgrade_module._notion_source_group_key({})
    with pytest.raises(KnowledgeFSUpgradeConflictError):
        upgrade_module._website_source_group_key({"provider": "firecrawl"})

    notion_document = _source_document(DataSourceType.NOTION_IMPORT)
    notion_payload = upgrade_module._source_payload_snapshot(
        "Dataset",
        [(notion_document, {"workspace_id": "workspace", "notion_page_id": "page", "type": "page"})],
    )
    assert notion_payload["kind"] == "online_document"
    website_payload = upgrade_module._source_payload_snapshot(
        "Dataset",
        [(_source_document(DataSourceType.WEBSITE_CRAWL), {"provider": "firecrawl", "url": "u"})],
    )
    assert website_payload["kind"] == "website_crawl"
    assert upgrade_module._chunks([1, 2, 3], 2) == [[1, 2], [3]]
    with pytest.raises(KnowledgeFSUpgradeError, match="reference is missing"):
        upgrade_module._required_space_id(_job())


def test_notion_credential_resolution_prefers_direct_then_workspace_match(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        direct = DatasourceProvider(
            tenant_id=_TENANT_ID,
            name="Direct",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
            auth_type="oauth2",
            encrypted_credentials={"workspace_id": "direct-workspace"},
        )
        fallback = DatasourceProvider(
            tenant_id=_TENANT_ID,
            name="Fallback",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
            auth_type="oauth2",
            encrypted_credentials={"workspace_id": "fallback-workspace"},
        )
        session.add_all([direct, fallback])
        session.flush()
        direct_id = direct.id
        fallback_id = fallback.id

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert (
        runner._resolve_notion_credential(
            tenant_id=_TENANT_ID,
            legacy_credential_id=direct_id,
            workspace_id="ignored",
        )
        == direct_id
    )
    assert (
        runner._resolve_notion_credential(
            tenant_id=_TENANT_ID,
            legacy_credential_id="00000000-0000-0000-0000-000000000090",
            workspace_id="fallback-workspace",
        )
        == fallback_id
    )


def test_notion_credential_resolution_handles_single_fallback_and_missing(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    single_tenant_id = "00000000-0000-0000-0000-000000000091"
    missing_tenant_id = "00000000-0000-0000-0000-000000000092"
    with sqlite_session_factory.begin() as session:
        only = DatasourceProvider(
            tenant_id=single_tenant_id,
            name="Only",
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
            auth_type="oauth2",
            encrypted_credentials={"workspace_id": "another-workspace"},
        )
        session.add(only)
        session.flush()
        only_id = only.id

    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert (
        runner._resolve_notion_credential(
            tenant_id=single_tenant_id,
            legacy_credential_id="",
            workspace_id="unmatched",
        )
        == only_id
    )
    with pytest.raises(KnowledgeFSUpgradeError, match="credential is unavailable"):
        runner._resolve_notion_credential(
            tenant_id=missing_tenant_id,
            legacy_credential_id="",
            workspace_id="missing",
        )


def test_document_submission_persists_missing_file_and_invalid_body_errors(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = Account(name="Upgrade owner", email="upgrade-errors@example.com")
    with sqlite_session_factory.begin() as session:
        session.add(account)
        session.flush()
        job = _job(
            owner_account_id=account.id,
            status=KnowledgeFSUpgradeJobStatus.RUNNING,
            stage=KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS,
            new_control_space_id=_CONTROL_SPACE_ID,
            total_documents=2,
        )
        session.add(job)
        session.flush()
        missing = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000093",
            name="missing.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            old_upload_file_id=_UPLOAD_FILE_ID,
        )
        session.add(missing)

    staged = FakeStagedUploads()
    monkeypatch.setattr(upgrade_module, "KnowledgeFSStagedUploadService", lambda *_args, **_kwargs: staged)
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=FakeUpgradeFacade()))
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    with pytest.raises(KnowledgeFSUpgradeError, match="source file is unavailable"):
        runner._submit_next_document(job)

    with sqlite_session_factory.begin() as session:
        persisted_missing = session.get(KnowledgeFSUpgradeDocument, missing.id)
        assert persisted_missing is not None
        assert persisted_missing.status is KnowledgeFSUpgradeItemStatus.FAILED
        upload_file = UploadFile(
            tenant_id=_TENANT_ID,
            storage_type=StorageType.LOCAL,
            key=f"upload_files/{_TENANT_ID}/invalid.txt",
            name="invalid.txt",
            size=12,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=account.id,
            created_at=naive_utc_now(),
            used=False,
        )
        session.add(upload_file)
        session.flush()
        invalid = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000094",
            name="invalid.txt",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": upload_file.id},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            old_upload_file_id=upload_file.id,
        )
        session.add(invalid)

    monkeypatch.setattr(upgrade_module.storage, "load", lambda _key: "not-bytes")
    with pytest.raises(KnowledgeFSUpgradeError, match="invalid body"):
        runner._submit_next_document(job)
    with sqlite_session_factory() as session:
        persisted_invalid = session.get(KnowledgeFSUpgradeDocument, invalid.id)
        assert persisted_invalid is not None
        assert persisted_invalid.status is KnowledgeFSUpgradeItemStatus.FAILED
    assert staged.stage_calls == []
    assert staged.claim_calls == []


def test_reconciler_records_missing_remote_document_and_remote_error(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    source_key = "website:firecrawl:job:1"
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.SUCCEEDED,
        stage=KnowledgeFSUpgradeStage.COMPLETED,
        new_control_space_id=_CONTROL_SPACE_ID,
        config_snapshot={"metadata_fields": [{"name": "department", "type": "string"}]},
    )
    with sqlite_session_factory.begin() as session:
        session.add(job)
        session.flush()
        source = KnowledgeFSUpgradeSource(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            source_key=source_key,
            payload_snapshot=_website_source_payload(),
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            new_source_id="source-1",
        )
        missing = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000095",
            name="missing-page",
            data_source_type="website_crawl",
            data_source_info={"url": "https://example.com/missing"},
            metadata_snapshot={},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            source_key=source_key,
        )
        remote_error = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=_TENANT_ID,
            old_document_id="00000000-0000-0000-0000-000000000096",
            name="remote-error",
            data_source_type="upload_file",
            data_source_info={"upload_file_id": _UPLOAD_FILE_ID},
            metadata_snapshot={"department": "support"},
            desired_enabled=True,
            legacy_archived=False,
            legacy_indexing_status="completed",
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            new_document_asset_id=_DOCUMENT_ASSET_ID,
        )
        session.add_all([source, missing, remote_error])

    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[_logical_document(enabled=True)], next_cursor=None)
        ),
        update_document_metadata=CallRecorder(error=RuntimeError("remote metadata failed")),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))

    assert KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory).reconcile(job_id=job.id) == 2
    with sqlite_session_factory() as session:
        persisted_missing = session.get(KnowledgeFSUpgradeDocument, missing.id)
        persisted_error = session.get(KnowledgeFSUpgradeDocument, remote_error.id)
        assert persisted_missing is not None
        assert persisted_missing.state_reconcile_attempt_count == 1
        assert persisted_missing.state_reconcile_error == "The new logical document is not visible yet"
        assert persisted_error is not None
        assert persisted_error.state_reconcile_attempt_count == 1
        assert persisted_error.state_reconcile_error == "remote metadata failed"


@pytest.mark.parametrize("status", [KnowledgeFSUpgradeJobStatus.RUNNING, KnowledgeFSUpgradeJobStatus.QUEUED])
@pytest.mark.parametrize("old_task_id", ["lost-task", None])
def test_retry_reclaims_abandoned_worker_and_publication_claims(
    sqlite_session_factory: sessionmaker[Session],
    status: KnowledgeFSUpgradeJobStatus,
    old_task_id: str | None,
) -> None:
    job = _job(status=status, celery_task_id=old_task_id, stage=KnowledgeFSUpgradeStage.FINALIZING)
    job.updated_at = naive_utc_now() - UPGRADE_DELIVERY_TIMEOUT - timedelta(seconds=1)
    with sqlite_session_factory.begin() as session:
        session.add(job)
    snapshots = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory)
    retried = snapshots.retry(tenant_id=_TENANT_ID, dataset_id=_DATASET_ID, job_id=job.id)
    assert retried.status is KnowledgeFSUpgradeJobStatus.QUEUED
    assert retried.celery_task_id is None
    with patch("tasks.knowledge_fs_upgrade_tasks.run_knowledge_fs_upgrade.apply_async") as publish:
        enqueue_upgrade_job(snapshots, _TENANT_ID, job.id)
    task_id = publish.call_args.kwargs["task_id"]
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert runner.run_next(job_id=job.id, celery_task_id="lost-task") is None
    assert runner.run_next(job_id=job.id, celery_task_id=task_id) is False
    # Redelivery after the final commit must still trigger document reconciliation.
    assert runner.run_next(job_id=job.id, celery_task_id=task_id) is False
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeJobStatus.SUCCEEDED
        assert persisted.attempt_count == 1


def test_live_checkpoint_cannot_be_stolen_by_retry_or_duplicate_delivery(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.RUNNING, celery_task_id="live-task")
    with sqlite_session_factory.begin() as session:
        session.add(job)
    snapshots = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory)
    retried = snapshots.retry(tenant_id=_TENANT_ID, dataset_id=_DATASET_ID, job_id=job.id)
    assert retried.status is KnowledgeFSUpgradeJobStatus.RUNNING
    assert not snapshots.claim_enqueue(tenant_id=_TENANT_ID, job_id=job.id, task_id="another-task")
    assert snapshots.recover_stalled_jobs() == []
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    with pytest.raises(KnowledgeFSUpgradeBusyError):
        runner.run_next(job_id=job.id, celery_task_id="live-task")
    runner.fail(job_id=job.id, celery_task_id="obsolete-task", error=ValueError("obsolete"))
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeJobStatus.RUNNING
        assert persisted.attempt_count == 0


def test_recovery_sweep_only_releases_stale_nonterminal_jobs(sqlite_session_factory: sessionmaker[Session]) -> None:
    jobs = [
        _job(
            old_dataset_id=f"00000000-0000-0000-0000-{index:012d}",
            idempotency_key=f"job-{index}",
            status=status,
            celery_task_id=f"task-{index}",
        )
        for index, status in enumerate(KnowledgeFSUpgradeJobStatus)
    ]
    for job in jobs:
        job.updated_at = naive_utc_now() - UPGRADE_DELIVERY_TIMEOUT - timedelta(seconds=1)
    with sqlite_session_factory.begin() as session:
        session.add_all(jobs)
    snapshots = KnowledgeFSUpgradeSnapshotService(sqlite_session_factory)
    recovered = snapshots.recover_stalled_jobs()
    assert set(recovered) == {
        (_TENANT_ID, job.id)
        for job in jobs
        if job.status
        in {
            KnowledgeFSUpgradeJobStatus.QUEUED,
            KnowledgeFSUpgradeJobStatus.RUNNING,
        }
    }
    assert snapshots.recover_stalled_jobs() == []
    with sqlite_session_factory() as session:
        for _, job_id in recovered:
            persisted = session.get(KnowledgeFSUpgradeJob, job_id)
            assert persisted is not None
            assert persisted.status is KnowledgeFSUpgradeJobStatus.QUEUED
            assert persisted.celery_task_id is None


def test_broker_redelivery_resumes_the_expired_checkpoint(sqlite_session_factory: sessionmaker[Session]) -> None:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.RUNNING,
        celery_task_id="redelivered-task",
        stage=KnowledgeFSUpgradeStage.FINALIZING,
    )
    job.updated_at = naive_utc_now() - UPGRADE_DELIVERY_TIMEOUT - timedelta(seconds=1)
    with sqlite_session_factory.begin() as session:
        session.add(job)
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    assert runner.run_next(job_id=job.id, celery_task_id="redelivered-task") is False


def test_provisioning_retry_releases_execution_but_keeps_delivery_identity(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    job = _job(status=KnowledgeFSUpgradeJobStatus.RUNNING, celery_task_id="task-1")
    with sqlite_session_factory.begin() as session:
        session.add(job)
    runner = KnowledgeFSUpgradeRunner(sqlite_session_factory)
    runner.release_for_retry(job_id=job.id, celery_task_id="obsolete-task")
    with pytest.raises(KnowledgeFSUpgradeBusyError):
        runner._mark_running(job_id=job.id, celery_task_id="task-1")
    runner.release_for_retry(job_id=job.id, celery_task_id="task-1")
    assert runner._mark_running(job_id=job.id, celery_task_id="task-1") is not None


def _pending_reconciliation_job(
    sessions: sessionmaker[Session],
) -> tuple[KnowledgeFSUpgradeJob, KnowledgeFSUpgradeDocument]:
    job = _job(
        status=KnowledgeFSUpgradeJobStatus.QUEUED,
        stage=KnowledgeFSUpgradeStage.FINALIZING,
        celery_task_id="parent-task",
        new_control_space_id=_CONTROL_SPACE_ID,
        total_documents=1,
        completed_documents=1,
    )
    with sessions.begin() as session:
        session.add(job)
        session.flush()
        document = KnowledgeFSUpgradeDocument(
            job_id=job.id,
            tenant_id=job.tenant_id,
            old_document_id=_LOGICAL_DOCUMENT_ID,
            name="archived.txt",
            data_source_type="upload_file",
            data_source_info={},
            metadata_snapshot={},
            desired_enabled=False,
            legacy_archived=True,
            legacy_indexing_status="completed",
            status=KnowledgeFSUpgradeItemStatus.SUCCEEDED,
            new_document_asset_id=_DOCUMENT_ASSET_ID,
        )
        session.add(document)
    return job, document


@pytest.mark.parametrize("status", ["pending", "failed"])
@pytest.mark.parametrize("identity_saved", [False, True])
def test_reconciliation_disables_documents_without_an_active_revision(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    status: str,
    identity_saved: bool,
) -> None:
    job, document = _pending_reconciliation_job(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add_all([job, document])
        job.status = KnowledgeFSUpgradeJobStatus.SUCCEEDED
        if identity_saved:
            document.new_logical_document_id = _LOGICAL_DOCUMENT_ID
    initial = _logical_document(enabled=True).model_copy(update={"active": None, "status": status})
    disabled = initial.model_copy(update={"enabled": False, "row_version": 2})
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[initial], next_cursor=None)
        ),
        get_logical_document=CallRecorder(result=initial),
        update_logical_document_availability=CallRecorder(result=disabled),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))

    reconciler = KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory)
    assert reconciler.reconcile(job_id=job.id) == 0
    assert reconciler.reconcile(job_id=job.id) == 0
    assert len(facade.update_logical_document_availability.calls) == 1
    assert facade.update_logical_document_availability.last.kwargs["document_id"] == _LOGICAL_DOCUMENT_ID
    payload = facade.update_logical_document_availability.last.kwargs["payload"]
    assert isinstance(payload, KnowledgeFSDocumentAvailabilityPayload)
    assert payload.enabled is False
    if not identity_saved:
        assert facade.resolve_document_reference.last.kwargs == {
            "tenant_id": _TENANT_ID,
            "account_id": _ACCOUNT_ID,
            "control_space_id": _CONTROL_SPACE_ID,
            "document_asset_id": _DOCUMENT_ASSET_ID,
            "document_asset_version": 1,
        }
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted is not None
        assert persisted.new_logical_document_id == _LOGICAL_DOCUMENT_ID
        assert persisted.availability_reconciled_at is not None
        assert persisted.state_reconciled_at is not None


def _deletion_task() -> KnowledgeFSBackgroundTaskResponse:
    return KnowledgeFSBackgroundTaskResponse.model_validate(
        {
            "id": "deletion-job",
            "knowledgeSpaceId": "space-1",
            "documentId": _LOGICAL_DOCUMENT_ID,
            "operation": "document_delete",
            "taskKind": "document_bulk",
            "state": "completed",
            "canCancel": False,
            "canRetry": False,
            "progressCompleted": 1,
            "progressFailed": 0,
            "progressPercent": 100,
            "progressTotal": 1,
            "createdAt": "2026-10-21T00:00:00Z",
            "updatedAt": "2026-10-21T00:00:01Z",
        }
    )


def _deletion_receipt() -> KnowledgeFSDurableDeletionJobResponse:
    return KnowledgeFSDurableDeletionJobResponse.model_validate(
        {
            "id": "deletion-job",
            "knowledgeSpaceId": "space-1",
            "targetId": _LOGICAL_DOCUMENT_ID,
            "targetType": "logical_document",
            "runState": "completed",
            "checkpoint": "completed",
            "createdAt": "2026-10-21T00:00:00Z",
            "updatedAt": "2026-10-21T00:00:01Z",
        }
    )


@pytest.mark.parametrize("evidence", ["completed", "running", "wrong_document", "wrong_space", "wrong_type", "absent"])
def test_deleted_upgrade_document_requires_matching_completed_deletion_evidence(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, evidence: str
) -> None:
    job, document = _pending_reconciliation_job(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add_all([job, document])
        job.status = KnowledgeFSUpgradeJobStatus.SUCCEEDED
        document.new_logical_document_id = _LOGICAL_DOCUMENT_ID
    receipt = _deletion_receipt()
    if evidence == "running":
        receipt = receipt.model_copy(update={"run_state": "running", "checkpoint": "quiescing"})
    elif evidence == "wrong_document":
        receipt = receipt.model_copy(update={"target_id": "another-document"})
    elif evidence == "wrong_space":
        receipt = receipt.model_copy(update={"knowledge_space_id": "another-space"})
    elif evidence == "wrong_type":
        receipt = receipt.model_copy(update={"target_type": "document"})
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(result=KnowledgeFSLogicalDocumentListResponse(data=[], next_cursor=None)),
        list_background_tasks=CallRecorder(
            outcomes=deque(
                [
                    KnowledgeFSBackgroundTaskListResponse(data=[], next_cursor="second-page"),
                    KnowledgeFSBackgroundTaskListResponse(
                        data=[] if evidence == "absent" else [_deletion_task()], next_cursor=None
                    ),
                ]
            )
        ),
        get_deletion_job=CallRecorder(result=receipt),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))

    assert KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory).reconcile(job_id=job.id) == int(
        evidence != "completed"
    )
    assert facade.list_background_tasks.last.kwargs["cursor"] == "second-page"
    assert facade.update_logical_document_availability.calls == []
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted is not None
        assert (persisted.availability_reconciled_at is not None) is (evidence == "completed")
        assert (persisted.state_reconciled_at is not None) is (evidence == "completed")


def test_reconciliation_preserves_resolved_identity_when_availability_write_fails(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    job, document = _pending_reconciliation_job(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(job)
        job.status = KnowledgeFSUpgradeJobStatus.SUCCEEDED
    failed = _logical_document(enabled=True).model_copy(update={"active": None, "status": "failed"})
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[failed], next_cursor=None)
        ),
        get_logical_document=CallRecorder(result=failed),
        update_logical_document_availability=CallRecorder(error=RuntimeError("upstream unavailable")),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))
    reconciler = KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory)
    assert reconciler.reconcile(job_id=job.id) == 1
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted is not None
        assert persisted.new_logical_document_id == _LOGICAL_DOCUMENT_ID
        assert persisted.availability_reconciled_at is None
    # The owner deletes the failed document before the next delivery. Recovery can
    # still use the saved identity, even after all asset/revision rows disappear.
    facade.list_logical_documents.result = KnowledgeFSLogicalDocumentListResponse(data=[], next_cursor=None)
    facade.get_logical_document.error = KnowledgeFSProductResourceNotFoundError("Document not found")
    facade.list_background_tasks.result = KnowledgeFSBackgroundTaskListResponse(
        data=[_deletion_task()], next_cursor=None
    )
    facade.get_deletion_job.result = _deletion_receipt()
    assert reconciler.reconcile(job_id=job.id) == 0
    assert len(facade.resolve_document_reference.calls) == 1


@pytest.mark.parametrize("failure_at", ["get_document", "resolve_document_reference", "get_logical_document"])
def test_reconciliation_keeps_gate_closed_when_identity_resolution_is_unavailable(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, failure_at: str
) -> None:
    job, document = _pending_reconciliation_job(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(job)
        job.status = KnowledgeFSUpgradeJobStatus.SUCCEEDED
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(result=KnowledgeFSLogicalDocumentListResponse(data=[], next_cursor=None)),
    )
    recorder = {
        "get_document": facade.get_document,
        "resolve_document_reference": facade.resolve_document_reference,
        "get_logical_document": facade.get_logical_document,
    }[failure_at]
    recorder.error = RuntimeError("upstream unavailable")
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))
    assert KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory).reconcile(job_id=job.id) == 1
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted is not None
        assert persisted.availability_reconciled_at is None
        assert persisted.state_reconciled_at is None
        assert persisted.state_reconcile_error == "upstream unavailable"


def test_reconciliation_converts_snapshot_time_metadata_and_omits_classic_builtin_fields(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    job, document = _pending_reconciliation_job(sqlite_session_factory)
    snapshot = {
        "department": "support",
        "due_date": 1609459200.125,
        "optional_date": None,
        "weight": 2.5,
        "document_name": "guide.txt",
        "uploader": "admin",
        "upload_date": 1609459200,
        "last_update_date": 1609459201,
        "source": "file_upload",
        "undeclared_legacy_field": "not a custom field",
    }
    with sqlite_session_factory.begin() as session:
        session.add_all([job, document])
        job.status = KnowledgeFSUpgradeJobStatus.SUCCEEDED
        job.config_snapshot = {
            "built_in_field_enabled": True,
            "metadata_fields": [
                {"name": "department", "type": "string"},
                {"name": "due_date", "type": "time"},
                {"name": "optional_date", "type": "time"},
                {"name": "weight", "type": "number"},
            ],
        }
        document.metadata_snapshot = dict(snapshot)
        # This also covers successful jobs stranded by the previous raw metadata patch.
        document.state_reconcile_error = "Metadata field due_date requires a time value"
    initial = _logical_document(enabled=True)
    disabled = initial.model_copy(update={"enabled": False, "row_version": 2})
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[initial], next_cursor=None)
        ),
        update_logical_document_availability=CallRecorder(result=disabled),
        update_document_metadata=CallRecorder(result=disabled.model_copy(update={"row_version": 3})),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))
    assert KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory).reconcile(job_id=job.id) == 0
    payload = facade.update_document_metadata.last.kwargs["payload"]
    assert isinstance(payload, KnowledgeFSDocumentMetadataPayload)
    assert payload.patch == {
        "department": "support",
        "due_date": "2021-01-01T00:00:00.125000Z",
        "optional_date": None,
        "weight": 2.5,
    }
    assert payload.expected_row_version == 2
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted is not None
        assert persisted.metadata_snapshot == snapshot
        assert persisted.state_reconciled_at is not None
        assert persisted.state_reconcile_error is None


@pytest.mark.parametrize("value", [True, "invalid-time", 10**20])
def test_invalid_legacy_metadata_does_not_block_restoring_document_availability(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, value: object
) -> None:
    job, document = _pending_reconciliation_job(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add_all([job, document])
        job.status = KnowledgeFSUpgradeJobStatus.SUCCEEDED
        job.config_snapshot = {"metadata_fields": [{"name": "due_date", "type": "time"}]}
        document.metadata_snapshot = {"due_date": value}
    initial = _logical_document(enabled=True)
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[initial], next_cursor=None)
        ),
        update_logical_document_availability=CallRecorder(result=initial.model_copy(update={"enabled": False})),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))
    assert KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory).reconcile(job_id=job.id) == 1
    assert facade.update_document_metadata.calls == []
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted is not None
        assert persisted.availability_reconciled_at is not None
        assert persisted.state_reconciled_at is None
        assert persisted.state_reconcile_error == "Metadata field 'due_date' has an invalid time value"


def test_recovery_sweep_finds_parent_success_without_a_reconciliation_claim(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from tasks.knowledge_fs_upgrade_tasks import (
        reconcile_knowledge_fs_upgrade_documents,
        recover_stalled_knowledge_fs_upgrades,
    )

    job, _ = _pending_reconciliation_job(sqlite_session_factory)
    # The parent commits success, then its process dies before claiming any follow-up.
    assert (
        KnowledgeFSUpgradeRunner(sqlite_session_factory).run_next(job_id=job.id, celery_task_id="parent-task") is False
    )
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeJobStatus.SUCCEEDED
        assert persisted.reconciliation_task_id is None
        assert persisted.reconciliation_lease_expires_at is None

    with patch.object(reconcile_knowledge_fs_upgrade_documents, "apply_async") as dispatch:
        assert recover_stalled_knowledge_fs_upgrades.run() == 1
        assert recover_stalled_knowledge_fs_upgrades.run() == 0
    dispatch.assert_called_once()
    assert dispatch.call_args.kwargs["kwargs"] == {"job_id": job.id}
    reconciler = KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory)
    assert reconciler.start_delivery(job_id=job.id, task_id=dispatch.call_args.kwargs["task_id"])


def test_final_reconciliation_publication_failure_is_recovered_after_parent_success(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    from celery.app.task import Context

    from tasks.knowledge_fs_upgrade_tasks import (
        reconcile_knowledge_fs_upgrade_documents,
        recover_stalled_knowledge_fs_upgrades,
        run_knowledge_fs_upgrade,
    )

    job, document = _pending_reconciliation_job(sqlite_session_factory)
    run_knowledge_fs_upgrade.request_stack.push(Context(id="parent-task", retries=0))
    try:
        with patch.object(reconcile_knowledge_fs_upgrade_documents, "apply_async", side_effect=OSError("broker down")):
            run_knowledge_fs_upgrade.run(job_id=job.id)
    finally:
        run_knowledge_fs_upgrade.pop_request()
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.status is KnowledgeFSUpgradeJobStatus.SUCCEEDED
        assert persisted.reconciliation_lease_expires_at is not None
        retry_at = persisted.reconciliation_lease_expires_at + timedelta(seconds=1)
    assert recover_stalled_knowledge_fs_upgrades.run() == 0
    monkeypatch.setattr(upgrade_module, "naive_utc_now", lambda: retry_at)
    with patch.object(reconcile_knowledge_fs_upgrade_documents, "apply_async") as dispatch:
        assert recover_stalled_knowledge_fs_upgrades.run() == 1
    assert dispatch.call_args.kwargs["kwargs"] == {"job_id": job.id}
    task_id = dispatch.call_args.kwargs["task_id"]

    initial = _logical_document(enabled=True)
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[initial], next_cursor=None)
        ),
        update_logical_document_availability=CallRecorder(result=initial.model_copy(update={"enabled": False})),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))
    reconcile_knowledge_fs_upgrade_documents.request_stack.push(Context(id=task_id))
    try:
        reconcile_knowledge_fs_upgrade_documents.run(job_id=job.id)
        # Duplicate delivery must not repeat writes after the durable checkpoint.
        reconcile_knowledge_fs_upgrade_documents.run(job_id=job.id)
    finally:
        reconcile_knowledge_fs_upgrade_documents.pop_request()
    with sqlite_session_factory() as session:
        persisted_document = session.get(KnowledgeFSUpgradeDocument, document.id)
        assert persisted_document is not None
        assert persisted_document.availability_reconciled_at is not None
        assert persisted_document.state_reconciled_at is not None
    assert len(facade.update_logical_document_availability.calls) == 1
    monkeypatch.setattr(upgrade_module, "naive_utc_now", lambda: retry_at + UPGRADE_DELIVERY_TIMEOUT)
    assert recover_stalled_knowledge_fs_upgrades.run() == 0


@pytest.mark.parametrize("started", [False, True])
def test_reconciliation_recovers_lost_deliveries_and_fences_stale_workers(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, started: bool
) -> None:
    job, _ = _pending_reconciliation_job(sqlite_session_factory)
    KnowledgeFSUpgradeRunner(sqlite_session_factory).run_next(job_id=job.id, celery_task_id="parent-task")
    reconciler = KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory)
    now = naive_utc_now()
    monkeypatch.setattr(upgrade_module, "naive_utc_now", lambda: now)
    [(tenant_id, job_id, old_task_id)] = reconciler.claim_deliveries()
    assert (tenant_id, job_id) == (job.tenant_id, job.id)
    if started:
        assert reconciler.start_delivery(job_id=job.id, task_id=old_task_id)
        assert not reconciler.start_delivery(job_id=job.id, task_id=old_task_id)
    assert reconciler.claim_deliveries() == []
    now += UPGRADE_DELIVERY_TIMEOUT + timedelta(seconds=1)
    [(tenant_id, job_id, task_id)] = reconciler.claim_deliveries()
    assert task_id != old_task_id
    assert not reconciler.start_delivery(job_id=job.id, task_id=old_task_id)
    assert reconciler.start_delivery(job_id=job.id, task_id=task_id)
    reconciler.finish_delivery(job_id=job.id, task_id=old_task_id)
    with sqlite_session_factory() as session:
        persisted = session.get(KnowledgeFSUpgradeJob, job.id)
        assert persisted is not None
        assert persisted.reconciliation_task_id == task_id
        assert persisted.reconciliation_started_at == now
    assert reconciler.claim_deliveries() == []


@pytest.mark.parametrize("raises", [False, True])
def test_reconciliation_sweep_retries_unfinished_documents_without_a_celery_retry_limit(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch, raises: bool
) -> None:
    from celery.app.task import Context

    from tasks.knowledge_fs_upgrade_tasks import reconcile_knowledge_fs_upgrade_documents

    job, _ = _pending_reconciliation_job(sqlite_session_factory)
    KnowledgeFSUpgradeRunner(sqlite_session_factory).run_next(job_id=job.id, celery_task_id="parent-task")
    reconciler = KnowledgeFSUpgradeDocumentReconciler(sqlite_session_factory)
    now = naive_utc_now()
    monkeypatch.setattr(upgrade_module, "naive_utc_now", lambda: now)
    [(_, _, task_id)] = reconciler.claim_deliveries()
    facade = FakeUpgradeFacade(
        list_logical_documents=CallRecorder(
            result=KnowledgeFSLogicalDocumentListResponse(data=[], next_cursor=None),
            error=RuntimeError("KFS unavailable") if raises else None,
        ),
    )
    monkeypatch.setattr(upgrade_module, "get_knowledge_fs_runtime", lambda _: FakeRuntime(facade=facade))
    reconcile_knowledge_fs_upgrade_documents.request_stack.push(Context(id=task_id, retries=20_000))
    try:
        reconcile_knowledge_fs_upgrade_documents.run(job_id=job.id)
    finally:
        reconcile_knowledge_fs_upgrade_documents.pop_request()
    assert reconciler.claim_deliveries() == []
    now += timedelta(seconds=61)
    [(_, recovered_job_id, next_task_id)] = reconciler.claim_deliveries()
    assert recovered_job_id == job.id
    assert next_task_id != task_id
