"""Snapshot and resumable orchestration for legacy Dataset upgrades."""

from __future__ import annotations

import json
import re
import uuid
from collections import defaultdict
from datetime import timedelta
from hashlib import sha256
from typing import Any, cast

import sqlalchemy as sa
from pydantic import TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from extensions.ext_storage import storage
from graphon.model_runtime.entities.model_entities import ModelType
from libs.datetime_utils import naive_utc_now
from models import Account, AccountStatus, TenantAccountJoin
from models.dataset import AppDatasetJoin, Dataset, DatasetMetadata, DatasetPermission, Document
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
from models.model import App, AppMode, Tag, TagBinding, UploadFile
from models.oauth import DatasourceProvider
from models.provider_ids import ModelProviderID
from services.dataset_knowledge_fs_upgrade_file_lease import release_upgrade_file_lease
from services.feature_service import FeatureService
from services.knowledge_fs.product_dto import (
    KnowledgeFSAppBindingPayload,
    KnowledgeFSDocumentAvailabilityPayload,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentStagedUploadPayload,
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSInitialSourcePayload,
    KnowledgeFSMemberBindingPayload,
    KnowledgeFSMetadataFieldCreatePayload,
    KnowledgeFSModelIntent,
    KnowledgeFSRerankIntent,
    KnowledgeFSRetrievalProfileIntent,
    KnowledgeFSScoreThresholdIntent,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSUpgradeDiscoveryResponse,
    KnowledgeFSUpgradeJobResponse,
)
from services.knowledge_fs.runtime import get_knowledge_fs_runtime
from services.knowledge_fs.staged_upload_service import KnowledgeFSStagedUploadService

_ACTIVE_JOB_STATUSES = (KnowledgeFSUpgradeJobStatus.QUEUED, KnowledgeFSUpgradeJobStatus.RUNNING)
_SOURCE_SELECTION_LIMIT = 200
_FILE_LEASE_TTL = timedelta(days=7)
_INITIAL_SOURCE_ADAPTER: TypeAdapter[KnowledgeFSInitialSourcePayload] = TypeAdapter(KnowledgeFSInitialSourcePayload)


class KnowledgeFSUpgradeError(RuntimeError):
    """A persisted upgrade cannot safely continue."""


class KnowledgeFSUpgradeNotFoundError(KnowledgeFSUpgradeError):
    pass


class KnowledgeFSUpgradeConflictError(KnowledgeFSUpgradeError):
    pass


class KnowledgeFSUpgradeNotReadyError(KnowledgeFSUpgradeError):
    """Provisioning is progressing and the dedicated worker should retry."""


class KnowledgeFSUpgradeSnapshotService:
    """Persist the exact click-time Dataset manifest without external I/O."""

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def create(
        self,
        *,
        tenant_id: str,
        dataset_id: str,
        requested_by_account_id: str,
        idempotency_key: str | None = None,
    ) -> KnowledgeFSUpgradeJob:
        snapshot_at = naive_utc_now()
        with self._session_maker(expire_on_commit=False) as session, session.begin():
            dataset = session.scalar(
                sa.select(Dataset).where(Dataset.id == dataset_id, Dataset.tenant_id == tenant_id).with_for_update()
            )
            if dataset is None:
                raise KnowledgeFSUpgradeNotFoundError("Dataset was not found")
            if dataset.provider == "external":
                raise KnowledgeFSUpgradeConflictError("External-provider Datasets cannot be upgraded")

            if idempotency_key:
                idempotent = session.scalar(
                    sa.select(KnowledgeFSUpgradeJob).where(
                        KnowledgeFSUpgradeJob.tenant_id == tenant_id,
                        KnowledgeFSUpgradeJob.idempotency_key == idempotency_key,
                    )
                )
                if idempotent is not None:
                    if idempotent.old_dataset_id != dataset_id:
                        raise KnowledgeFSUpgradeConflictError("Idempotency key belongs to another Dataset upgrade")
                    return idempotent

            existing = session.scalar(
                sa.select(KnowledgeFSUpgradeJob)
                .where(
                    KnowledgeFSUpgradeJob.tenant_id == tenant_id,
                    KnowledgeFSUpgradeJob.old_dataset_id == dataset_id,
                )
                .order_by(KnowledgeFSUpgradeJob.created_at.desc())
                .limit(1)
            )
            if existing is not None:
                return existing

            owner_account_id = str(dataset.maintainer or dataset.created_by)
            if (
                session.scalar(
                    sa.select(Account.id)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(
                        Account.id == owner_account_id,
                        Account.status != AccountStatus.BANNED,
                        TenantAccountJoin.tenant_id == tenant_id,
                    )
                    .limit(1)
                )
                is None
            ):
                raise KnowledgeFSUpgradeConflictError("Dataset maintainer is not an active account")

            permission_members = list(
                session.scalars(
                    sa.select(DatasetPermission.account_id)
                    .join(Account, Account.id == DatasetPermission.account_id)
                    .join(
                        TenantAccountJoin,
                        sa.and_(
                            TenantAccountJoin.account_id == DatasetPermission.account_id,
                            TenantAccountJoin.tenant_id == tenant_id,
                        ),
                    )
                    .where(
                        DatasetPermission.tenant_id == tenant_id,
                        DatasetPermission.dataset_id == dataset_id,
                        DatasetPermission.has_permission.is_(True),
                        Account.status != AccountStatus.BANNED,
                    )
                )
            )
            app_bindings = _app_binding_snapshot(session, tenant_id=tenant_id, dataset_id=dataset_id)
            tag_ids = list(
                session.scalars(
                    sa.select(TagBinding.tag_id)
                    .join(Tag, Tag.id == TagBinding.tag_id)
                    .where(
                        TagBinding.tenant_id == tenant_id,
                        TagBinding.target_id == dataset_id,
                        Tag.type == "knowledge",
                    )
                )
            )
            job = KnowledgeFSUpgradeJob(
                tenant_id=tenant_id,
                old_dataset_id=dataset_id,
                requested_by_account_id=requested_by_account_id,
                owner_account_id=owner_account_id,
                idempotency_key=idempotency_key or str(uuid.uuid4()),
                snapshot_at=snapshot_at,
                config_snapshot=_config_snapshot(session, dataset),
                permission_snapshot={
                    "visibility": _enum_value(dataset.permission),
                    "member_account_ids": permission_members,
                },
                app_binding_snapshot=app_bindings,
                tag_ids_snapshot=[str(tag_id) for tag_id in tag_ids if tag_id is not None],
            )
            session.add(job)
            session.flush()

            source_groups: dict[str, list[tuple[Document, dict[str, Any]]]] = defaultdict(list)
            document_snapshots: dict[str, KnowledgeFSUpgradeDocument] = {}
            upload_file_ids: set[str] = set()
            documents = list(
                session.scalars(
                    sa.select(Document)
                    .where(Document.tenant_id == tenant_id, Document.dataset_id == dataset_id)
                    .order_by(Document.position, Document.id)
                )
            )
            for document in documents:
                data_source_type = _enum_value(document.data_source_type)
                data_source_info = document.data_source_info_dict
                old_upload_file_id = None
                source_key = None
                if data_source_type == "upload_file":
                    raw_upload_file_id = data_source_info.get("upload_file_id")
                    if raw_upload_file_id:
                        old_upload_file_id = str(raw_upload_file_id)
                        upload_file_ids.add(old_upload_file_id)
                elif data_source_type == "notion_import":
                    source_key = _notion_source_group_key(data_source_info)
                    source_groups[source_key].append((document, data_source_info))
                elif data_source_type == "website_crawl":
                    source_key = _website_source_group_key(data_source_info)
                    source_groups[source_key].append((document, data_source_info))
                else:
                    raise KnowledgeFSUpgradeConflictError(
                        f"Unsupported legacy document source type: {data_source_type}"
                    )
                document_snapshot = KnowledgeFSUpgradeDocument(
                    job_id=job.id,
                    tenant_id=tenant_id,
                    old_document_id=str(document.id),
                    name=document.name,
                    data_source_type=data_source_type,
                    data_source_info=cast(dict[str, object], data_source_info),
                    metadata_snapshot=cast(dict[str, object], document.doc_metadata or {}),
                    desired_enabled=bool(document.enabled and not document.archived),
                    legacy_archived=bool(document.archived),
                    legacy_indexing_status=_enum_value(document.indexing_status),
                    legacy_display_status=document.display_status,
                    old_upload_file_id=old_upload_file_id,
                    source_key=source_key,
                )
                session.add(document_snapshot)
                document_snapshots[str(document.id)] = document_snapshot

            source_count = 0
            for base_source_key, group in source_groups.items():
                for chunk_number, chunk in enumerate(_chunks(group, _SOURCE_SELECTION_LIMIT), start=1):
                    source_key = f"{base_source_key}:{chunk_number}"
                    payload = _source_payload_snapshot(dataset.name, chunk)
                    session.add(
                        KnowledgeFSUpgradeSource(
                            job_id=job.id,
                            tenant_id=tenant_id,
                            source_key=source_key,
                            payload_snapshot=payload,
                        )
                    )
                    for document, _ in chunk:
                        document_snapshots[str(document.id)].source_key = source_key
                    source_count += 1

            for upload_file_id in sorted(upload_file_ids):
                session.add(
                    KnowledgeFSUpgradeFileLease(
                        job_id=job.id,
                        old_upload_file_id=upload_file_id,
                        expires_at=snapshot_at + _FILE_LEASE_TTL,
                    )
                )
            job.total_documents = len(documents)
            job.total_sources = source_count
            session.flush()
            return job

    def get(self, *, tenant_id: str, job_id: str) -> KnowledgeFSUpgradeJob:
        with self._session_maker() as session:
            job = session.scalar(
                sa.select(KnowledgeFSUpgradeJob).where(
                    KnowledgeFSUpgradeJob.id == job_id,
                    KnowledgeFSUpgradeJob.tenant_id == tenant_id,
                )
            )
            if job is None:
                raise KnowledgeFSUpgradeNotFoundError("Upgrade job was not found")
            session.expunge(job)
            return job

    def get_latest(self, *, tenant_id: str, dataset_id: str) -> KnowledgeFSUpgradeJob | None:
        jobs = self.get_latest_by_dataset_ids(tenant_id=tenant_id, dataset_ids=[dataset_id])
        return jobs.get(dataset_id)

    def get_latest_by_dataset_ids(
        self,
        *,
        tenant_id: str,
        dataset_ids: list[str],
        session: Session | None = None,
    ) -> dict[str, KnowledgeFSUpgradeJob]:
        if not dataset_ids:
            return {}
        if session is not None:
            return self._latest_jobs_from_session(session, tenant_id=tenant_id, dataset_ids=dataset_ids, detach=False)
        with self._session_maker() as owned_session:
            return self._latest_jobs_from_session(
                owned_session,
                tenant_id=tenant_id,
                dataset_ids=dataset_ids,
                detach=True,
            )

    @staticmethod
    def _latest_jobs_from_session(
        session: Session,
        *,
        tenant_id: str,
        dataset_ids: list[str],
        detach: bool,
    ) -> dict[str, KnowledgeFSUpgradeJob]:
        jobs = session.scalars(
            sa.select(KnowledgeFSUpgradeJob)
            .where(
                KnowledgeFSUpgradeJob.tenant_id == tenant_id,
                KnowledgeFSUpgradeJob.old_dataset_id.in_(dataset_ids),
            )
            .order_by(
                KnowledgeFSUpgradeJob.old_dataset_id,
                KnowledgeFSUpgradeJob.created_at.desc(),
                KnowledgeFSUpgradeJob.id.desc(),
            )
        )
        latest: dict[str, KnowledgeFSUpgradeJob] = {}
        for job in jobs:
            if job.old_dataset_id not in latest:
                if detach:
                    session.expunge(job)
                latest[job.old_dataset_id] = job
        return latest

    def retry(self, *, tenant_id: str, job_id: str) -> KnowledgeFSUpgradeJob:
        lease_expires_at = naive_utc_now() + _FILE_LEASE_TTL
        with self._session_maker(expire_on_commit=False) as session, session.begin():
            job = session.scalar(
                sa.select(KnowledgeFSUpgradeJob)
                .where(KnowledgeFSUpgradeJob.id == job_id, KnowledgeFSUpgradeJob.tenant_id == tenant_id)
                .with_for_update()
            )
            if job is None:
                raise KnowledgeFSUpgradeNotFoundError("Upgrade job was not found")
            if job.status is KnowledgeFSUpgradeJobStatus.SUCCEEDED:
                raise KnowledgeFSUpgradeConflictError("Successful upgrades cannot be retried")
            if job.status in _ACTIVE_JOB_STATUSES:
                return job
            job.status = KnowledgeFSUpgradeJobStatus.QUEUED
            job.last_error_code = None
            job.last_error_message = None
            job.completed_at = None
            job.celery_task_id = None
            session.execute(
                sa.update(KnowledgeFSUpgradeDocument)
                .where(
                    KnowledgeFSUpgradeDocument.job_id == job.id,
                    KnowledgeFSUpgradeDocument.status == KnowledgeFSUpgradeItemStatus.FAILED,
                )
                .values(status=KnowledgeFSUpgradeItemStatus.PENDING, last_error_code=None, last_error_message=None)
            )
            session.execute(
                sa.update(KnowledgeFSUpgradeSource)
                .where(
                    KnowledgeFSUpgradeSource.job_id == job.id,
                    KnowledgeFSUpgradeSource.status == KnowledgeFSUpgradeItemStatus.FAILED,
                )
                .values(status=KnowledgeFSUpgradeItemStatus.PENDING, last_error_code=None, last_error_message=None)
            )
            session.execute(
                sa.update(KnowledgeFSUpgradeFileLease)
                .where(
                    KnowledgeFSUpgradeFileLease.job_id == job.id,
                    KnowledgeFSUpgradeFileLease.released_at.is_(None),
                )
                .values(
                    status=KnowledgeFSUpgradeFileLeaseStatus.ACTIVE,
                    expires_at=lease_expires_at,
                )
            )
            return job

    def claim_enqueue(self, *, tenant_id: str, job_id: str, task_id: str) -> bool:
        with self._session_maker.begin() as session:
            job = session.scalar(
                sa.select(KnowledgeFSUpgradeJob)
                .where(KnowledgeFSUpgradeJob.id == job_id, KnowledgeFSUpgradeJob.tenant_id == tenant_id)
                .with_for_update()
            )
            if job is None:
                raise KnowledgeFSUpgradeNotFoundError("Upgrade job was not found")
            if job.status is not KnowledgeFSUpgradeJobStatus.QUEUED or job.celery_task_id is not None:
                return False
            job.celery_task_id = task_id
            return True

    def release_enqueue_claim(self, *, tenant_id: str, job_id: str, task_id: str) -> None:
        with self._session_maker.begin() as session:
            job = session.scalar(
                sa.select(KnowledgeFSUpgradeJob)
                .where(KnowledgeFSUpgradeJob.id == job_id, KnowledgeFSUpgradeJob.tenant_id == tenant_id)
                .with_for_update()
            )
            if job is not None and job.status is KnowledgeFSUpgradeJobStatus.QUEUED and job.celery_task_id == task_id:
                job.celery_task_id = None


class KnowledgeFSUpgradeRunner:
    """Execute one durable stage or item per dedicated-worker delivery."""

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def run_next(self, *, job_id: str, celery_task_id: str | None = None) -> bool:
        job = self._load_job(job_id)
        if job.status in {KnowledgeFSUpgradeJobStatus.SUCCEEDED, KnowledgeFSUpgradeJobStatus.FAILED}:
            return False
        self._mark_running(job_id=job_id, celery_task_id=celery_task_id)
        if job.stage is KnowledgeFSUpgradeStage.VALIDATING:
            self._create_space(job)
            raise KnowledgeFSUpgradeNotReadyError("KnowledgeFS Space provisioning is pending")
        if job.stage is KnowledgeFSUpgradeStage.WAITING_FOR_SPACE:
            self._advance_when_space_is_active(job)
            return True
        if job.stage is KnowledgeFSUpgradeStage.CREATING_SOURCES:
            return self._create_next_source(job)
        if job.stage is KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS:
            return self._submit_next_document(job)
        if job.stage is KnowledgeFSUpgradeStage.MIGRATING_ACCESS:
            self._migrate_access(job)
            return True
        if job.stage is KnowledgeFSUpgradeStage.FINALIZING:
            self._finalize(job)
            return False
        return False

    def fail(self, *, job_id: str, error: Exception) -> None:
        with self._session_maker.begin() as session:
            job = session.get(KnowledgeFSUpgradeJob, job_id)
            if job is None or job.status is KnowledgeFSUpgradeJobStatus.SUCCEEDED:
                return
            job.status = KnowledgeFSUpgradeJobStatus.FAILED
            job.last_error_code = type(error).__name__[:128]
            job.last_error_message = str(error)[:4000]
            job.completed_at = naive_utc_now()

    def _load_job(self, job_id: str) -> KnowledgeFSUpgradeJob:
        with self._session_maker() as session:
            job = session.get(KnowledgeFSUpgradeJob, job_id)
            if job is None:
                raise KnowledgeFSUpgradeNotFoundError("Upgrade job was not found")
            session.expunge(job)
            return job

    def _mark_running(self, *, job_id: str, celery_task_id: str | None) -> None:
        lease_expires_at = naive_utc_now() + _FILE_LEASE_TTL
        with self._session_maker.begin() as session:
            job = session.get(KnowledgeFSUpgradeJob, job_id)
            if job is None:
                raise KnowledgeFSUpgradeNotFoundError("Upgrade job was not found")
            job.status = KnowledgeFSUpgradeJobStatus.RUNNING
            job.attempt_count += 1
            job.celery_task_id = celery_task_id
            session.execute(
                sa.update(KnowledgeFSUpgradeFileLease)
                .where(
                    KnowledgeFSUpgradeFileLease.job_id == job_id,
                    KnowledgeFSUpgradeFileLease.status == KnowledgeFSUpgradeFileLeaseStatus.ACTIVE,
                )
                .values(expires_at=lease_expires_at)
            )

    def _create_space(self, job: KnowledgeFSUpgradeJob) -> None:
        resolved = _resolve_configuration(job)
        runtime = get_knowledge_fs_runtime(self._session_maker)
        response = runtime.application.create_space(
            tenant_id=job.tenant_id,
            account_id=job.owner_account_id,
            payload=KnowledgeFSSpaceCreatePayload(
                name=str(job.config_snapshot["name"])[:40],
                slug=f"legacy-{job.old_dataset_id[:12]}-{job.id[:8]}",
                description=str(job.config_snapshot.get("description") or "")[:2000] or None,
                icon=cast(str | None, job.config_snapshot.get("icon")),
                visibility=KnowledgeFSControlSpaceVisibility.ONLY_ME,
                embedding=KnowledgeFSModelIntent.model_validate(resolved["embedding"]),
                retrieval=KnowledgeFSRetrievalProfileIntent.model_validate(resolved["retrieval"]),
                idempotency_key=f"upgrade:{job.id}:space",
            ),
        )
        with self._session_maker.begin() as session:
            persisted = session.get(KnowledgeFSUpgradeJob, job.id)
            if persisted is None:
                raise KnowledgeFSUpgradeNotFoundError("Upgrade job disappeared")
            persisted.new_control_space_id = response.control_space_id
            persisted.resolved_configuration = resolved
            persisted.stage = KnowledgeFSUpgradeStage.WAITING_FOR_SPACE

    def _advance_when_space_is_active(self, job: KnowledgeFSUpgradeJob) -> None:
        if job.new_control_space_id is None:
            raise KnowledgeFSUpgradeError("Upgrade Space reference is missing")
        with self._session_maker.begin() as session:
            control_space = session.scalar(
                sa.select(KnowledgeFSControlSpace).where(
                    KnowledgeFSControlSpace.id == job.new_control_space_id,
                    KnowledgeFSControlSpace.tenant_id == job.tenant_id,
                )
            )
            if control_space is None:
                raise KnowledgeFSUpgradeError("Upgrade Space was not found")
            if control_space.state is KnowledgeFSControlSpaceState.PROVISIONING:
                raise KnowledgeFSUpgradeNotReadyError("KnowledgeFS Space provisioning is pending")
            if control_space.state is not KnowledgeFSControlSpaceState.ACTIVE:
                raise KnowledgeFSUpgradeError(f"KnowledgeFS Space provisioning failed in {control_space.state.value}")
            persisted = session.get(KnowledgeFSUpgradeJob, job.id)
            assert persisted is not None
            persisted.stage = (
                KnowledgeFSUpgradeStage.CREATING_SOURCES
                if persisted.total_sources
                else KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS
            )

    def _create_next_source(self, job: KnowledgeFSUpgradeJob) -> bool:
        with self._session_maker.begin() as session:
            source = session.scalar(
                sa.select(KnowledgeFSUpgradeSource)
                .where(
                    KnowledgeFSUpgradeSource.job_id == job.id,
                    KnowledgeFSUpgradeSource.status.in_(
                        (KnowledgeFSUpgradeItemStatus.PENDING, KnowledgeFSUpgradeItemStatus.PROCESSING)
                    ),
                )
                .order_by(KnowledgeFSUpgradeSource.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if source is None:
                persisted = session.get(KnowledgeFSUpgradeJob, job.id)
                assert persisted is not None
                persisted.stage = KnowledgeFSUpgradeStage.SUBMITTING_DOCUMENTS
                return True
            source.status = KnowledgeFSUpgradeItemStatus.PROCESSING
            source_id = source.id
            source_payload = dict(source.payload_snapshot)
        payload = self._resolve_initial_source_payload(job, source_payload)
        from tasks.knowledge_fs_initial_source_tasks import submit_initial_source_for_upgrade

        try:
            result = submit_initial_source_for_upgrade(
                tenant_id=job.tenant_id,
                account_id=job.owner_account_id,
                control_space_id=_required_space_id(job),
                operation_id=f"upgrade:{job.id}:{source_id}",
                payload=payload,
            )
        except KnowledgeFSUpgradeNotReadyError:
            raise
        except Exception as error:
            from tasks.knowledge_fs_initial_source_tasks import KnowledgeFSInitialSourceNotReadyError

            if isinstance(error, KnowledgeFSInitialSourceNotReadyError):
                with self._session_maker.begin() as session:
                    persisted_source = session.get(KnowledgeFSUpgradeSource, source_id)
                    if persisted_source is not None:
                        persisted_source.status = KnowledgeFSUpgradeItemStatus.PENDING
                raise KnowledgeFSUpgradeNotReadyError(str(error)) from error
            self._fail_source(source_id=source_id, error=error)
            raise
        with self._session_maker.begin() as session:
            persisted_source = session.get(KnowledgeFSUpgradeSource, source_id)
            persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
            assert persisted_source is not None
            assert persisted_job is not None
            persisted_source.status = KnowledgeFSUpgradeItemStatus.SUCCEEDED
            persisted_source.new_connection_id = result.connection_id
            persisted_source.new_source_id = result.source_id
            persisted_source.initial_sync_task_id = result.workflow_id
            if result.workflow_error:
                persisted_source.last_error_code = result.workflow_error
                persisted_source.last_error_message = "The Source exists; retry its first import in KnowledgeFS"
            source_documents = list(
                session.scalars(
                    sa.select(KnowledgeFSUpgradeDocument).where(
                        KnowledgeFSUpgradeDocument.job_id == job.id,
                        KnowledgeFSUpgradeDocument.source_key == persisted_source.source_key,
                    )
                )
            )
            for document in source_documents:
                if document.status is not KnowledgeFSUpgradeItemStatus.SUCCEEDED:
                    document.status = KnowledgeFSUpgradeItemStatus.SUCCEEDED
                    persisted_job.completed_documents += 1
            persisted_job.completed_sources += 1
        return True

    def _resolve_initial_source_payload(
        self, job: KnowledgeFSUpgradeJob, payload_snapshot: dict[str, object]
    ) -> KnowledgeFSInitialSourcePayload:
        payload = dict(payload_snapshot)
        legacy_credential_id = payload.pop("legacy_credential_id", None)
        workspace_id = payload.pop("legacy_workspace_id", None)
        if payload.get("kind") == "online_document":
            payload["credential_id"] = self._resolve_notion_credential(
                tenant_id=job.tenant_id,
                legacy_credential_id=str(legacy_credential_id or ""),
                workspace_id=str(workspace_id or ""),
            )
        return _INITIAL_SOURCE_ADAPTER.validate_python(payload)

    def _resolve_notion_credential(self, *, tenant_id: str, legacy_credential_id: str, workspace_id: str) -> str:
        with self._session_maker() as session:
            direct = session.scalar(
                sa.select(DatasourceProvider).where(
                    DatasourceProvider.id == legacy_credential_id,
                    DatasourceProvider.tenant_id == tenant_id,
                    DatasourceProvider.plugin_id == "langgenius/notion_datasource",
                    DatasourceProvider.provider == "notion_datasource",
                )
            )
            if direct is not None:
                return direct.id
            candidates = list(
                session.scalars(
                    sa.select(DatasourceProvider)
                    .where(
                        DatasourceProvider.tenant_id == tenant_id,
                        DatasourceProvider.plugin_id == "langgenius/notion_datasource",
                        DatasourceProvider.provider == "notion_datasource",
                    )
                    .order_by(DatasourceProvider.is_default.desc(), DatasourceProvider.created_at)
                )
            )
            for candidate in candidates:
                if str(candidate.encrypted_credentials.get("workspace_id") or "") == workspace_id:
                    return candidate.id
            if len(candidates) == 1:
                return candidates[0].id
        raise KnowledgeFSUpgradeError("A matching Notion datasource credential is unavailable")

    def _fail_source(self, *, source_id: str, error: Exception) -> None:
        with self._session_maker.begin() as session:
            source = session.get(KnowledgeFSUpgradeSource, source_id)
            if source is not None:
                source.status = KnowledgeFSUpgradeItemStatus.FAILED
                source.last_error_code = type(error).__name__[:128]
                source.last_error_message = str(error)[:4000]

    def _submit_next_document(self, job: KnowledgeFSUpgradeJob) -> bool:
        with self._session_maker.begin() as session:
            document = session.scalar(
                sa.select(KnowledgeFSUpgradeDocument)
                .where(
                    KnowledgeFSUpgradeDocument.job_id == job.id,
                    KnowledgeFSUpgradeDocument.data_source_type == "upload_file",
                    KnowledgeFSUpgradeDocument.status.in_(
                        (KnowledgeFSUpgradeItemStatus.PENDING, KnowledgeFSUpgradeItemStatus.PROCESSING)
                    ),
                )
                .order_by(KnowledgeFSUpgradeDocument.id)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            if document is None:
                persisted = session.get(KnowledgeFSUpgradeJob, job.id)
                assert persisted is not None
                persisted.stage = KnowledgeFSUpgradeStage.MIGRATING_ACCESS
                return True
            document.status = KnowledgeFSUpgradeItemStatus.PROCESSING
            document_id = document.id
            upload_file_id = document.old_upload_file_id
            staged_upload_id = document.staged_upload_id
        if not upload_file_id:
            error = KnowledgeFSUpgradeError("Legacy upload document has no source file reference")
            self._fail_document(document_id=document_id, error=error)
            raise error
        try:
            staged = KnowledgeFSStagedUploadService(
                self._session_maker,
                facade=get_knowledge_fs_runtime(self._session_maker).facade,
            )
            if staged_upload_id is None:
                with self._session_maker() as session:
                    upload_file = session.scalar(
                        sa.select(UploadFile).where(
                            UploadFile.id == upload_file_id,
                            UploadFile.tenant_id == job.tenant_id,
                        )
                    )
                    account = session.get(Account, job.owner_account_id)
                    if upload_file is None or account is None:
                        raise KnowledgeFSUpgradeError("Legacy source file is unavailable")
                    storage_key = upload_file.key
                    file_name = upload_file.name
                    content_type = upload_file.mime_type or "application/octet-stream"
                    session.expunge(account)
                body = storage.load(storage_key)
                if not isinstance(body, bytes):
                    raise KnowledgeFSUpgradeError("Legacy source file returned an invalid body")
                staged_response = staged.stage(
                    tenant_id=job.tenant_id,
                    account=account,
                    file_name=file_name,
                    content_type=content_type,
                    body=body,
                    file_size_limit_mb=FeatureService.get_knowledge_file_size_limit(job.tenant_id),
                )
                staged_upload_id = staged_response.id
                with self._session_maker.begin() as session:
                    persisted_document = session.get(KnowledgeFSUpgradeDocument, document_id)
                    assert persisted_document is not None
                    persisted_document.staged_upload_id = staged_upload_id
            claimed = staged.claim(
                tenant_id=job.tenant_id,
                account_id=job.owner_account_id,
                control_space_id=_required_space_id(job),
                payload=KnowledgeFSDocumentStagedUploadPayload(upload_id=staged_upload_id),
            )
        except Exception as error:
            self._fail_document(document_id=document_id, error=error)
            raise
        with self._session_maker.begin() as session:
            persisted_document = session.get(KnowledgeFSUpgradeDocument, document_id)
            persisted_job = session.get(KnowledgeFSUpgradeJob, job.id)
            assert persisted_document is not None
            assert persisted_job is not None
            persisted_document.status = KnowledgeFSUpgradeItemStatus.SUCCEEDED
            persisted_document.new_document_asset_id = claimed.document_asset_id
            persisted_document.compilation_job_id = claimed.compilation_job_id
            persisted_job.completed_documents += 1
            remaining_references = session.scalar(
                sa.select(sa.func.count(KnowledgeFSUpgradeDocument.id)).where(
                    KnowledgeFSUpgradeDocument.job_id == job.id,
                    KnowledgeFSUpgradeDocument.old_upload_file_id == upload_file_id,
                    KnowledgeFSUpgradeDocument.status != KnowledgeFSUpgradeItemStatus.SUCCEEDED,
                )
            )
            if remaining_references == 0:
                release_upgrade_file_lease(
                    session,
                    job_id=job.id,
                    upload_file_id=upload_file_id,
                )
        return True

    def _fail_document(self, *, document_id: str, error: Exception) -> None:
        with self._session_maker.begin() as session:
            document = session.get(KnowledgeFSUpgradeDocument, document_id)
            if document is not None:
                document.status = KnowledgeFSUpgradeItemStatus.FAILED
                document.last_error_code = type(error).__name__[:128]
                document.last_error_message = str(error)[:4000]

    def _migrate_access(self, job: KnowledgeFSUpgradeJob) -> None:
        control_space_id = _required_space_id(job)
        runtime = get_knowledge_fs_runtime(self._session_maker)
        _migrate_metadata_fields(job, runtime.facade)
        members = [
            KnowledgeFSMemberBindingPayload(
                account_id=str(account_id),
                role=KnowledgeFSControlSpacePermissionRole.VIEWER,
            )
            for account_id in cast(list[str], job.permission_snapshot.get("member_account_ids", []))
            if str(account_id) != job.owner_account_id
        ]
        runtime.control_plane.replace_members(
            tenant_id=job.tenant_id,
            actor_account_id=job.owner_account_id,
            control_space_id=control_space_id,
            members=members,
        )
        runtime.control_plane.update_visibility(
            tenant_id=job.tenant_id,
            actor_account_id=job.owner_account_id,
            control_space_id=control_space_id,
            visibility=KnowledgeFSControlSpaceVisibility(str(job.permission_snapshot["visibility"])),
        )
        has_agent = any(binding["caller_kind"] == "agent" for binding in job.app_binding_snapshot)
        has_workflow = any(binding["caller_kind"] == "workflow" for binding in job.app_binding_snapshot)
        runtime.control_plane.update_external_access(
            tenant_id=job.tenant_id,
            actor_account_id=job.owner_account_id,
            control_space_id=control_space_id,
            payload=KnowledgeFSExternalAccessPayload(
                service_api_enabled=bool(job.config_snapshot.get("enable_api")),
                agent_enabled=has_agent,
                workflow_enabled=has_workflow,
                mcp_enabled=False,
            ),
        )
        for binding in job.app_binding_snapshot:
            runtime.app_bindings.upsert(
                tenant_id=job.tenant_id,
                actor_account_id=job.owner_account_id,
                control_space_id=control_space_id,
                payload=KnowledgeFSAppBindingPayload(
                    app_id=str(binding["app_id"]),
                    caller_kind=KnowledgeFSAppSpaceJoinType(str(binding["caller_kind"])),
                ),
            )
        runtime.space_tags.replace_tags(
            tenant_id=job.tenant_id,
            account_id=job.owner_account_id,
            control_space_id=control_space_id,
            tag_ids=list(job.tag_ids_snapshot),
        )
        with self._session_maker.begin() as session:
            persisted = session.get(KnowledgeFSUpgradeJob, job.id)
            assert persisted is not None
            persisted.stage = KnowledgeFSUpgradeStage.FINALIZING

    def _finalize(self, job: KnowledgeFSUpgradeJob) -> None:
        with self._session_maker.begin() as session:
            persisted = session.scalar(
                sa.select(KnowledgeFSUpgradeJob).where(KnowledgeFSUpgradeJob.id == job.id).with_for_update()
            )
            if persisted is None:
                raise KnowledgeFSUpgradeNotFoundError("Upgrade job disappeared")
            if persisted.completed_documents != persisted.total_documents:
                raise KnowledgeFSUpgradeError("Not all Dataset documents were handed off")
            if persisted.completed_sources != persisted.total_sources:
                raise KnowledgeFSUpgradeError("Not all Dataset Sources were created")
            persisted.status = KnowledgeFSUpgradeJobStatus.SUCCEEDED
            persisted.stage = KnowledgeFSUpgradeStage.COMPLETED
            persisted.completed_at = naive_utc_now()
            persisted.last_error_code = None
            persisted.last_error_message = None


class KnowledgeFSUpgradeDocumentReconciler:
    """Apply snapshot metadata and availability after new logical documents appear.

    This is deliberately separate from parent-job success: KnowledgeFS owns parsing and
    indexing task outcomes, while this best-effort loop preserves the legacy document's
    click-time availability once the new logical document can be addressed.
    """

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def reconcile(self, *, job_id: str) -> int:
        with self._session_maker() as session:
            job = session.get(KnowledgeFSUpgradeJob, job_id)
            if job is None or job.status is not KnowledgeFSUpgradeJobStatus.SUCCEEDED:
                return 0
            documents = list(
                session.scalars(
                    sa.select(KnowledgeFSUpgradeDocument)
                    .where(
                        KnowledgeFSUpgradeDocument.job_id == job_id,
                        KnowledgeFSUpgradeDocument.status == KnowledgeFSUpgradeItemStatus.SUCCEEDED,
                        KnowledgeFSUpgradeDocument.state_reconciled_at.is_(None),
                    )
                    .order_by(KnowledgeFSUpgradeDocument.id)
                )
            )
            sources = {
                source.source_key: source.new_source_id
                for source in session.scalars(
                    sa.select(KnowledgeFSUpgradeSource).where(KnowledgeFSUpgradeSource.job_id == job_id)
                )
            }
            session.expunge(job)
            for document in documents:
                session.expunge(document)

        if not documents:
            return 0
        runtime = get_knowledge_fs_runtime(self._session_maker)
        logical_documents = _list_all_logical_documents(job, runtime.facade)
        by_asset_id = {
            logical_document.active.document_asset_id: logical_document
            for logical_document in logical_documents
            if logical_document.active is not None
        }
        by_source_item = {
            (logical_document.source_id, logical_document.provider_item_id): logical_document
            for logical_document in logical_documents
            if logical_document.source_id and logical_document.provider_item_id
        }
        remaining = 0
        for document in documents:
            logical_document = None
            if document.new_document_asset_id:
                logical_document = by_asset_id.get(document.new_document_asset_id)
            elif document.source_key:
                logical_document = by_source_item.get(
                    (sources.get(document.source_key), _expected_provider_item_id(document))
                )
            if logical_document is None:
                self._record_reconcile_wait(document.id, "The new logical document is not visible yet")
                remaining += 1
                continue
            try:
                current = logical_document
                if document.metadata_snapshot:
                    current = runtime.facade.update_document_metadata(
                        tenant_id=job.tenant_id,
                        account_id=job.owner_account_id,
                        control_space_id=_required_space_id(job),
                        document_id=current.id,
                        payload=KnowledgeFSDocumentMetadataPayload(
                            expectedRowVersion=current.row_version,
                            patch=dict(document.metadata_snapshot),
                        ),
                    )
                if current.enabled != document.desired_enabled:
                    current = runtime.facade.update_logical_document_availability(
                        tenant_id=job.tenant_id,
                        account_id=job.owner_account_id,
                        control_space_id=_required_space_id(job),
                        document_id=current.id,
                        payload=KnowledgeFSDocumentAvailabilityPayload(
                            enabled=document.desired_enabled,
                            expectedRowVersion=current.row_version,
                        ),
                    )
            except Exception as error:
                self._record_reconcile_wait(document.id, str(error))
                remaining += 1
                continue
            with self._session_maker.begin() as session:
                persisted = session.get(KnowledgeFSUpgradeDocument, document.id)
                if persisted is not None and persisted.state_reconciled_at is None:
                    persisted.new_logical_document_id = current.id
                    persisted.state_reconciled_at = naive_utc_now()
                    persisted.state_reconcile_error = None
                    persisted.state_reconcile_attempt_count += 1
        return remaining

    def _record_reconcile_wait(self, document_id: str, message: str) -> None:
        with self._session_maker.begin() as session:
            document = session.get(KnowledgeFSUpgradeDocument, document_id)
            if document is not None and document.state_reconciled_at is None:
                document.state_reconcile_attempt_count += 1
                document.state_reconcile_error = message[:4000]


def upgrade_job_response(job: KnowledgeFSUpgradeJob) -> KnowledgeFSUpgradeJobResponse:
    return KnowledgeFSUpgradeJobResponse(
        id=job.id,
        old_dataset_id=job.old_dataset_id,
        new_control_space_id=job.new_control_space_id,
        status=job.status,
        stage=job.stage,
        snapshot_at=job.snapshot_at,
        total_documents=job.total_documents,
        completed_documents=job.completed_documents,
        total_sources=job.total_sources,
        completed_sources=job.completed_sources,
        last_error_code=job.last_error_code,
        last_error_message=job.last_error_message,
        completed_at=job.completed_at,
    )


def upgrade_discovery_response(
    job: KnowledgeFSUpgradeJob | None,
    *,
    feature_enabled: bool,
    dataset_provider: str,
) -> KnowledgeFSUpgradeDiscoveryResponse:
    if not feature_enabled:
        return KnowledgeFSUpgradeDiscoveryResponse(
            job=upgrade_job_response(job) if job else None,
            can_upgrade=False,
            can_retry=False,
            block_reason="feature_disabled",
        )
    if dataset_provider == "external":
        return KnowledgeFSUpgradeDiscoveryResponse(
            job=upgrade_job_response(job) if job else None,
            can_upgrade=False,
            can_retry=False,
            block_reason="unsupported_dataset_provider",
        )
    if job is None:
        return KnowledgeFSUpgradeDiscoveryResponse(can_upgrade=True, can_retry=False)
    if job.status in _ACTIVE_JOB_STATUSES:
        return KnowledgeFSUpgradeDiscoveryResponse(
            job=upgrade_job_response(job),
            can_upgrade=False,
            can_retry=False,
            block_reason="upgrade_in_progress",
        )
    if job.status is KnowledgeFSUpgradeJobStatus.FAILED:
        return KnowledgeFSUpgradeDiscoveryResponse(
            job=upgrade_job_response(job),
            can_upgrade=False,
            can_retry=True,
            block_reason="retry_required",
        )
    return KnowledgeFSUpgradeDiscoveryResponse(
        job=upgrade_job_response(job),
        can_upgrade=False,
        can_retry=False,
        block_reason="already_upgraded",
    )


def _migrate_metadata_fields(job: KnowledgeFSUpgradeJob, facade: Any) -> None:
    expected_fields = cast(list[dict[str, str]], job.config_snapshot.get("metadata_fields") or [])
    if not expected_fields:
        return
    existing_by_name: dict[str, str] = {}
    cursor = None
    while True:
        page = facade.list_metadata_fields(
            tenant_id=job.tenant_id,
            account_id=job.owner_account_id,
            control_space_id=_required_space_id(job),
            cursor=cursor,
            limit=100,
        )
        existing_by_name.update({field.name: field.type for field in page.data})
        cursor = page.next_cursor
        if cursor is None:
            break
    for field in expected_fields:
        name = str(field["name"])
        field_type = str(field["type"])
        existing_type = existing_by_name.get(name)
        if existing_type is not None:
            if existing_type != field_type:
                raise KnowledgeFSUpgradeError(f"Metadata field {name!r} has an incompatible type")
            continue
        facade.create_metadata_field(
            tenant_id=job.tenant_id,
            account_id=job.owner_account_id,
            control_space_id=_required_space_id(job),
            payload=KnowledgeFSMetadataFieldCreatePayload.model_validate({"name": name, "type": field_type}),
        )
        existing_by_name[name] = field_type


def _list_all_logical_documents(job: KnowledgeFSUpgradeJob, facade: Any) -> list[Any]:
    documents: list[Any] = []
    cursor = None
    while True:
        page = facade.list_logical_documents(
            tenant_id=job.tenant_id,
            account_id=job.owner_account_id,
            control_space_id=_required_space_id(job),
            cursor=cursor,
        )
        documents.extend(page.data)
        cursor = page.next_cursor
        if cursor is None:
            return documents


def _expected_provider_item_id(document: KnowledgeFSUpgradeDocument) -> str:
    info = document.data_source_info
    if document.data_source_type == "notion_import":
        workspace_id = str(info.get("notion_workspace_id") or info.get("workspace_id") or "")
        page_id = str(info.get("notion_page_id") or "")
        return json.dumps([workspace_id, page_id], separators=(",", ":"))
    if document.data_source_type == "website_crawl":
        return sha256(str(info.get("url") or "").encode()).hexdigest()
    raise KnowledgeFSUpgradeError(f"Document {document.old_document_id} has no provider item identity")


def _resolve_configuration(job: KnowledgeFSUpgradeJob) -> dict[str, object]:
    provider_manager = create_plugin_provider_manager(tenant_id=job.tenant_id)
    embedding = _resolve_model(
        provider_manager,
        tenant_id=job.tenant_id,
        model_type=ModelType.TEXT_EMBEDDING,
        preferred_provider=cast(str | None, job.config_snapshot.get("embedding_model_provider")),
        preferred_model=cast(str | None, job.config_snapshot.get("embedding_model")),
    )
    retrieval = cast(dict[str, Any], job.config_snapshot.get("retrieval_model") or {})
    reranking_model = cast(dict[str, Any], retrieval.get("reranking_model") or {})
    rerank = _resolve_model(
        provider_manager,
        tenant_id=job.tenant_id,
        model_type=ModelType.RERANK,
        preferred_provider=cast(str | None, reranking_model.get("reranking_provider_name")),
        preferred_model=cast(str | None, reranking_model.get("reranking_model_name")),
    )
    reasoning = _resolve_model(
        provider_manager,
        tenant_id=job.tenant_id,
        model_type=ModelType.LLM,
        preferred_provider=None,
        preferred_model=None,
    )
    threshold_enabled = bool(retrieval.get("score_threshold_enabled"))
    threshold_value = retrieval.get("score_threshold")
    profile = KnowledgeFSRetrievalProfileIntent(
        default_mode="fast",
        reasoning_model=reasoning,
        rerank=KnowledgeFSRerankIntent(enabled=True, model=rerank),
        score_threshold=KnowledgeFSScoreThresholdIntent(
            enabled=threshold_enabled,
            stage="mode-final",
            value=float(threshold_value) if threshold_enabled and threshold_value is not None else None,
        ),
        top_k=max(1, min(100, int(retrieval.get("top_k") or 4))),
    )
    return {
        "embedding": embedding.model_dump(mode="json", by_alias=True),
        "retrieval": profile.model_dump(mode="json", by_alias=True),
    }


def _resolve_model(
    provider_manager,
    *,
    tenant_id: str,
    model_type: ModelType,
    preferred_provider: str | None,
    preferred_model: str | None,
) -> KnowledgeFSModelIntent:
    active_models = provider_manager.get_configurations(tenant_id).get_models(model_type=model_type, only_active=True)
    if preferred_provider and preferred_model:
        preferred_provider_id = str(ModelProviderID(preferred_provider))
        for active_model in active_models:
            active_provider_id = str(ModelProviderID(active_model.provider.provider))
            if active_model.model == preferred_model and active_provider_id == preferred_provider_id:
                return _model_intent(active_model.provider.provider, active_model.model)
    default = provider_manager.get_default_model(tenant_id=tenant_id, model_type=model_type)
    if default is None:
        raise KnowledgeFSUpgradeError(f"Workspace default {model_type.value} model is unavailable")
    default_provider_id = str(ModelProviderID(default.provider.provider))
    for active_model in active_models:
        if (
            active_model.model == default.model
            and str(ModelProviderID(active_model.provider.provider)) == default_provider_id
        ):
            return _model_intent(active_model.provider.provider, active_model.model)
    raise KnowledgeFSUpgradeError(f"Workspace default {model_type.value} model is not active")


def _model_intent(provider: str, model: str) -> KnowledgeFSModelIntent:
    provider_id = ModelProviderID(provider)
    return KnowledgeFSModelIntent(plugin_id=provider_id.plugin_id, provider=provider_id.provider_name, model=model)


def _config_snapshot(session: Session, dataset: Dataset) -> dict[str, object]:
    icon = None
    if isinstance(dataset.icon_info, dict):
        candidate = dataset.icon_info.get("icon")
        if isinstance(candidate, str) and re.fullmatch(r"(?:builtin:)?[+a-z0-9_-]{1,64}", candidate):
            icon = candidate
    return {
        "name": dataset.name,
        "description": dataset.description,
        "icon": icon,
        "indexing_technique": _enum_value(dataset.indexing_technique) if dataset.indexing_technique else None,
        "embedding_model": dataset.embedding_model,
        "embedding_model_provider": dataset.embedding_model_provider,
        "retrieval_model": dataset.retrieval_model or {},
        "summary_index_setting": dataset.summary_index_setting or {},
        "built_in_field_enabled": dataset.built_in_field_enabled,
        "enable_api": dataset.enable_api,
        "metadata_fields": [
            {"name": metadata.name, "type": _enum_value(metadata.type)}
            for metadata in session.scalars(
                sa.select(DatasetMetadata)
                .where(
                    DatasetMetadata.tenant_id == dataset.tenant_id,
                    DatasetMetadata.dataset_id == dataset.id,
                )
                .order_by(DatasetMetadata.created_at, DatasetMetadata.id)
            )
        ],
    }


def _app_binding_snapshot(session: Session, *, tenant_id: str, dataset_id: str) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    rows = session.execute(
        sa.select(AppDatasetJoin.app_id, App.mode)
        .join(App, App.id == AppDatasetJoin.app_id)
        .where(AppDatasetJoin.dataset_id == dataset_id, App.tenant_id == tenant_id)
        .order_by(AppDatasetJoin.app_id)
    )
    for app_id, mode in rows:
        if mode in {AppMode.AGENT, AppMode.AGENT_CHAT}:
            caller_kind = KnowledgeFSAppSpaceJoinType.AGENT
        elif mode in {AppMode.ADVANCED_CHAT, AppMode.WORKFLOW}:
            caller_kind = KnowledgeFSAppSpaceJoinType.WORKFLOW
        else:
            continue
        result.append({"app_id": str(app_id), "caller_kind": caller_kind.value})
    return result


def _notion_source_group_key(info: dict[str, Any]) -> str:
    workspace_id = str(info.get("notion_workspace_id") or info.get("workspace_id") or "")
    credential_id = str(info.get("credential_id") or "")
    if not workspace_id:
        raise KnowledgeFSUpgradeConflictError("Notion document has no workspace identity")
    return f"notion:{workspace_id}:{credential_id}"


def _website_source_group_key(info: dict[str, Any]) -> str:
    provider = str(info.get("provider") or "").strip().lower()
    job_id = str(info.get("job_id") or "")
    if not provider or not info.get("url"):
        raise KnowledgeFSUpgradeConflictError("Website document has incomplete source identity")
    return f"website:{provider}:{job_id}"


def _source_payload_snapshot(dataset_name: str, group: list[tuple[Document, dict[str, Any]]]) -> dict[str, object]:
    first_document, first_info = group[0]
    if _enum_value(first_document.data_source_type) == "notion_import":
        workspace_id = str(first_info.get("notion_workspace_id") or first_info.get("workspace_id") or "")
        return {
            "kind": "online_document",
            "name": f"{dataset_name} Notion"[:200],
            "plugin_id": "langgenius/notion_datasource",
            "provider": "notion_datasource",
            "datasource": "notion_datasource",
            "parameters": {},
            "sync_policy": "manual",
            "legacy_credential_id": str(first_info.get("credential_id") or ""),
            "legacy_workspace_id": workspace_id,
            "selection": [
                {
                    "name": document.name,
                    "page_id": str(info.get("notion_page_id") or ""),
                    "provider_item_id": json.dumps(
                        [workspace_id, str(info.get("notion_page_id") or "")], separators=(",", ":")
                    ),
                    "type": str(info.get("type") or "page"),
                    "workspace_id": workspace_id,
                }
                for document, info in group
            ],
        }
    provider = str(first_info.get("provider") or "")
    return {
        "kind": "website_crawl",
        "name": f"{dataset_name} Web"[:200],
        "provider": provider,
        "datasource": "crawl",
        "parameters": {"only_main_content": bool(first_info.get("only_main_content", True))},
        "root_url": str(first_info.get("url")),
        "crawl_options": {"include_subpages": False, "limit": min(200, len(group))},
        "selection": [{"source_url": str(info.get("url")), "title": document.name} for document, info in group],
        "sync_policy": "manual",
    }


def _chunks[T](items: list[T], size: int) -> list[list[T]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _enum_value(value: object) -> str:
    return str(getattr(value, "value", value))


def _required_space_id(job: KnowledgeFSUpgradeJob) -> str:
    if job.new_control_space_id is None:
        raise KnowledgeFSUpgradeError("Upgrade Space reference is missing")
    return job.new_control_space_id


__all__ = [
    "KnowledgeFSUpgradeConflictError",
    "KnowledgeFSUpgradeDocumentReconciler",
    "KnowledgeFSUpgradeError",
    "KnowledgeFSUpgradeNotFoundError",
    "KnowledgeFSUpgradeNotReadyError",
    "KnowledgeFSUpgradeRunner",
    "KnowledgeFSUpgradeSnapshotService",
    "upgrade_discovery_response",
    "upgrade_job_response",
]
