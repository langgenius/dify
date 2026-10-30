from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from typing import Never

import pytest

from enums.knowledge import DocumentCreatedFrom
from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset
from services.knowledge.documents.adapters import DocumentResponsePresentationAdapter
from services.knowledge.documents.application import DatasetDocumentApplicationService
from services.knowledge.documents.contracts import (
    DocumentBatchCleanupJob,
    DocumentCleanupJob,
    DocumentCreationDataset,
    DocumentCreationDefaults,
    DocumentCreationEnvironment,
    DocumentCreationLimits,
    DocumentCreationProjection,
    DocumentDatasetProjection,
    DocumentIndexingJobs,
    DocumentReadProjection,
    DocumentState,
    DocumentWriteConfig,
)
from services.knowledge.documents.creation import build_document_write_config
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.entities.model_configuration import EmbeddingModelConfiguration
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.indexing.locks import KnowledgeIndexingLease

CONTEXT = RequestContext("request-1", None, "actor-1", "tenant-1")
REF = DatasetRef("tenant-1", "dataset-1")


def _creation_projection() -> DocumentCreationProjection:
    now = datetime(2024, 1, 1)
    document = DocumentReadProjection(
        id="document-1",
        tenant_id=REF.tenant_id,
        dataset_id=REF.dataset_id,
        position=1,
        data_source_type="upload_file",
        data_source_info={},
        dataset_process_rule_id=None,
        name="Document",
        created_from="web",
        created_by=CONTEXT.account_id,
        created_at=now,
        updated_at=now,
        tokens=None,
        indexing_status="waiting",
        error=None,
        enabled=True,
        disabled_at=None,
        disabled_by=None,
        archived=False,
        display_status="queuing",
        word_count=None,
        doc_form="text_model",
        need_summary=False,
        completed_segments=None,
        total_segments=None,
        summary_index_status=None,
        hit_count=0,
        source_file=None,
        metadata=(),
        doc_metadata={},
        built_in_enabled=False,
        uploader_name=None,
        process_rule=None,
    )
    return DocumentCreationProjection(
        dataset=DocumentDatasetProjection(
            id=REF.dataset_id,
            name="Dataset",
            description=None,
            permission="only_me",
            data_source_type="upload_file",
            indexing_technique="economy",
            created_by=CONTEXT.account_id,
            created_at=now,
        ),
        documents=(document,),
        batch="batch-1",
    )


def _settings() -> dict[str, object]:
    return {
        "indexing_technique": "economy",
        "process_rule": {"mode": "automatic"},
        "data_source": {
            "info_list": {
                "data_source_type": "upload_file",
                "file_info_list": {"file_ids": ["file-1"]},
            }
        },
    }


class _DatasetAccess:
    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        assert context == CONTEXT
        assert dataset_id == REF.dataset_id
        return AccessibleDataset(id=dataset_id, workspace_id=context.active_workspace_id)

    def check_access(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected access snapshot check: {args}, {kwargs}")


@dataclass
class _Datasets:
    defaults: DocumentCreationDefaults = field(
        default_factory=lambda: DocumentCreationDefaults(
            provider="vendor", chunk_structure="text_model", indexing_technique="economy"
        )
    )

    def get_document_creation_defaults(self, ref: DatasetRef) -> DocumentCreationDefaults:
        assert ref == REF
        return self.defaults

    def get_model_configuration(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected model configuration lookup: {args}, {kwargs}")

    def delete_with_relations(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected dataset deletion: {args}, {kwargs}")


@dataclass
class _Documents:
    events: list[str]
    fail_persistence: bool = False
    deleted_documents: list[DocumentRef] = field(default_factory=list)
    deleted_batches: list[tuple[DatasetRef, tuple[str, ...]]] = field(default_factory=list)

    def find_ref(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected document lookup: {args}, {kwargs}")

    def get_creation_dataset(
        self,
        ref: DatasetRef,
        *,
        actor_id: str,
        doc_form: str,
        indexing_technique: str | None,
    ) -> DocumentCreationDataset:
        assert (ref, actor_id, doc_form, indexing_technique) == (REF, "actor-1", "text_model", "economy")
        return DocumentCreationDataset(
            tenant_id=ref.tenant_id,
            indexing_technique="economy",
            embedding_model=None,
            embedding_model_provider=None,
        )

    def persist_creation(
        self,
        ref: DatasetRef,
        config: DocumentWriteConfig,
        *,
        actor_id: str,
        initialize: bool,
        created_from: DocumentCreatedFrom,
        priority: bool,
        initial_permission: str | None = None,
    ) -> tuple[DocumentCreationProjection, DocumentIndexingJobs]:
        del config
        assert ref == REF
        assert actor_id == "actor-1"
        del initialize, created_from, priority, initial_permission
        self.events.append("persist")
        if self.fail_persistence:
            raise RuntimeError("commit failed")
        return (
            _creation_projection(),
            DocumentIndexingJobs(dataset=ref, created=("document-1",)),
        )

    def get_state(self, ref: DocumentRef) -> DocumentState | None:
        if ref.dataset != REF:
            return None
        return DocumentState(
            id=ref.document_id,
            archived=False,
            indexing_status="completed",
            is_paused=False,
            data_source_type="upload_file",
            doc_form="text_model",
            need_summary=False,
        )

    def get_states(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected document state lookup: {args}, {kwargs}")

    def list_documents(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected document listing: {args}, {kwargs}")

    def get_indexing_status(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected indexing status lookup: {args}, {kwargs}")

    def get_batch_indexing_status(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected batch status lookup: {args}, {kwargs}")

    def get_execution_log(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected execution log lookup: {args}, {kwargs}")

    def get_upload_file_ids(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected upload lookup: {args}, {kwargs}")

    def resolve_file_document_actor(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected document actor lookup: {args}, {kwargs}")

    def delete_document(self, ref: DocumentRef) -> DocumentCleanupJob:
        self.deleted_documents.append(ref)
        return DocumentCleanupJob(ref.document_id, ref.dataset.dataset_id, "text_model", "file-1")

    def delete_documents(self, ref: DatasetRef, document_ids: Sequence[str]) -> DocumentBatchCleanupJob:
        self.deleted_batches.append((ref, tuple(document_ids)))
        return DocumentBatchCleanupJob(tuple(document_ids), ref.dataset_id, "text_model", ("file-2", "file-3"))

    def update_metadata(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected metadata update: {args}, {kwargs}")

    def rename_document(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected rename: {args}, {kwargs}")

    def pause_document(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected pause: {args}, {kwargs}")

    def recover_document(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected recovery: {args}, {kwargs}")

    def retry_documents(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected retry: {args}, {kwargs}")

    def fail_retry_dispatch(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected retry rollback: {args}, {kwargs}")

    def change_status(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected status change: {args}, {kwargs}")

    def rollback_status_change(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected status rollback: {args}, {kwargs}")

    def sync_website(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected website sync: {args}, {kwargs}")

    def get_summary_configuration(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected summary configuration lookup: {args}, {kwargs}")

    def enable_summary(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected summary enable: {args}, {kwargs}")


class _Creation:
    def load_environment(self, tenant_id: str) -> DocumentCreationEnvironment:
        assert tenant_id == "tenant-1"
        return DocumentCreationEnvironment(
            limits=DocumentCreationLimits(
                enabled=False,
                sandbox=False,
                batch_upload_limit=100,
                upload_quota_limit=0,
                upload_quota_size=0,
            ),
            priority_indexing=True,
            initial_permission="only_me",
        )

    def resolve_default_embedding_model(self, tenant_id: str) -> EmbeddingModelConfiguration:
        raise AssertionError(f"unexpected default embedding lookup for {tenant_id}")

    def validate_dataset_model(self, dataset: DocumentCreationDataset) -> None:
        raise AssertionError(f"unexpected dataset model validation for {dataset}")


class _SourceAuthorization:
    def authorize(self, context: RequestContext, config: KnowledgeConfig) -> DocumentWriteConfig:
        assert context == CONTEXT
        return build_document_write_config(config)

    def validate_stored_website(self, context: RequestContext, source_info: Mapping[str, object]) -> None:
        del context, source_info


@dataclass
class _Tasks:
    events: list[str]
    dispatched: list[tuple[DocumentIndexingJobs, bool]] = field(default_factory=list)
    cleanups: list[tuple[DatasetRef, DocumentCleanupJob | DocumentBatchCleanupJob]] = field(default_factory=list)
    dataset_cleanups: list[DatasetCleanupRecord] = field(default_factory=list)

    def dispatch_indexing(self, jobs: DocumentIndexingJobs, *, priority: bool) -> None:
        self.events.append("dispatch")
        self.dispatched.append((jobs, priority))

    def cleanup(self, ref: DatasetRef, cleanup: DocumentCleanupJob | DocumentBatchCleanupJob) -> None:
        self.cleanups.append((ref, cleanup))

    def cleanup_dataset(self, cleanup: DatasetCleanupRecord) -> None:
        self.dataset_cleanups.append(cleanup)

    def recover(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected recovery dispatch: {args}, {kwargs}")

    def retry(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected retry dispatch: {args}, {kwargs}")

    def change_status(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected status dispatch: {args}, {kwargs}")

    def sync_website(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected website sync dispatch: {args}, {kwargs}")

    def sync_notion(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected Notion sync dispatch: {args}, {kwargs}")

    def generate_summary(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected summary dispatch: {args}, {kwargs}")


class _Lease:
    @property
    def token(self) -> str:
        return "lease-token"

    def assert_owned(self) -> None:
        return None

    def renew(self) -> bool:
        return True

    def release(self) -> bool:
        return True


class _Lock:
    def try_acquire(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected non-blocking lock acquisition: {args}, {kwargs}")

    def try_acquire_handoff(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected handoff acquisition: {args}, {kwargs}")

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[KnowledgeIndexingLease]:
        del name, timeout, expected_token, blocking_timeout
        yield _Lease()

    def hold_handoff(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected handoff lock: {args}, {kwargs}")


@dataclass
class _Uploads:
    uploaded: list[tuple[str, str]] = field(default_factory=list)

    def upload_text(self, context: RequestContext, *, name: str, text: str) -> str:
        assert context == CONTEXT
        self.uploaded.append((name, text))
        return "uploaded-text"

    def upload_file(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected file upload: {args}, {kwargs}")


class _CreatorAccess:
    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> None:
        del context, dataset_id


class _Operations:
    def list_documents(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected document listing: {args}, {kwargs}")

    def get_detail(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected document detail: {args}, {kwargs}")

    def get_process_rule(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected process rule lookup: {args}, {kwargs}")

    def get_indexing_status(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected indexing status lookup: {args}, {kwargs}")

    def get_batch_indexing_status(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected batch status lookup: {args}, {kwargs}")

    def get_execution_log(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected execution log lookup: {args}, {kwargs}")

    def get_summary_status(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected summary status lookup: {args}, {kwargs}")

    def get_download_url(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected download URL lookup: {args}, {kwargs}")

    def build_download_zip(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected document archive request: {args}, {kwargs}")


class _LifecycleCache:
    def is_indexing(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected indexing cache lookup: {args}, {kwargs}")

    def mark_indexing(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected indexing cache update: {args}, {kwargs}")

    def clear_indexing(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected indexing cache clear: {args}, {kwargs}")

    def mark_paused(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected pause cache update: {args}, {kwargs}")

    def clear_paused(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected pause cache clear: {args}, {kwargs}")

    def try_mark_syncing(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected sync cache update: {args}, {kwargs}")

    def clear_syncing(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected sync cache clear: {args}, {kwargs}")


class _ModelConfiguration:
    def validate_dataset_model(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected dataset model validation: {args}, {kwargs}")

    def resolve_default_embedding_model(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected default embedding model lookup: {args}, {kwargs}")

    def validate_embedding_model(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected embedding validation: {args}, {kwargs}")

    def validate_reranking_model(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected reranking validation: {args}, {kwargs}")

    def resolve_embedding_model(self, *args: object, **kwargs: object) -> Never:
        raise AssertionError(f"unexpected embedding model lookup: {args}, {kwargs}")


def _service(
    *,
    documents: _Documents,
    tasks: _Tasks,
    uploads: _Uploads | None = None,
) -> DatasetDocumentApplicationService:
    upload_store = uploads or _Uploads()
    return DatasetDocumentApplicationService(
        dataset_access=_DatasetAccess(),
        datasets=_Datasets(),
        documents=documents,
        operations=_Operations(),
        uploads=upload_store,
        indexing_locks=_Lock(),
        lifecycle_cache=_LifecycleCache(),
        model_configuration=_ModelConfiguration(),
        creation=_Creation(),
        source_authorization=_SourceAuthorization(),
        creator_access=_CreatorAccess(),
        tasks=tasks,
        presenter=DocumentResponsePresentationAdapter(),
    )


def test_creation_dispatches_repository_jobs_only_after_persistence_returns() -> None:
    events: list[str] = []
    documents = _Documents(events)
    tasks = _Tasks(events)

    result = _service(documents=documents, tasks=tasks).create_documents(
        CONTEXT, dataset_id="dataset-1", settings=_settings()
    )

    assert result["documents"][0]["id"] == "document-1"
    assert result["batch"] == "batch-1"
    assert events == ["persist", "dispatch"]
    assert tasks.dispatched == [(DocumentIndexingJobs(dataset=REF, created=("document-1",)), True)]


def test_creation_does_not_dispatch_when_persistence_fails() -> None:
    events: list[str] = []
    documents = _Documents(events, fail_persistence=True)
    tasks = _Tasks(events)

    with pytest.raises(RuntimeError, match="commit failed"):
        _service(documents=documents, tasks=tasks).create_documents(
            CONTEXT, dataset_id="dataset-1", settings=_settings()
        )

    assert events == ["persist"]
    assert tasks.dispatched == []


def test_text_creation_uploads_first_then_dispatches_persisted_job() -> None:
    events: list[str] = []
    uploads = _Uploads()
    documents = _Documents(events)
    tasks = _Tasks(events)
    settings: Mapping[str, object] = {
        "indexing_technique": "economy",
        "process_rule": {"mode": "automatic"},
    }

    result = _service(documents=documents, tasks=tasks, uploads=uploads).create_by_text(
        CONTEXT,
        dataset_id="dataset-1",
        name="Guide",
        text="contents",
        settings=settings,
    )

    assert result["batch"] == "batch-1"
    assert uploads.uploaded == [("Guide", "contents")]
    assert events == ["persist", "dispatch"]


def test_deletion_dispatches_repository_cleanup_snapshots() -> None:
    events: list[str] = []
    documents = _Documents(events)
    tasks = _Tasks(events)
    service = _service(documents=documents, tasks=tasks)

    service.delete_document(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    service.delete_documents(CONTEXT, dataset_id="dataset-1", document_ids=["document-2", "document-3"])

    assert documents.deleted_documents == [REF.document("document-1")]
    assert documents.deleted_batches == [(REF, ("document-2", "document-3"))]
    assert tasks.dispatched == []
    assert tasks.cleanups == [
        (REF, DocumentCleanupJob("document-1", "dataset-1", "text_model", "file-1")),
        (
            REF,
            DocumentBatchCleanupJob(("document-2", "document-3"), "dataset-1", "text_model", ("file-2", "file-3")),
        ),
    ]
