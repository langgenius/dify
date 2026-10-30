from collections.abc import Callable, Generator, Mapping, Sequence
from contextlib import contextmanager, nullcontext
from dataclasses import replace
from datetime import datetime
from typing import Literal, cast
from unittest.mock import Mock, create_autospec

import pytest

from machinery.context import RequestContext
from models.enums import DocumentCreatedFrom
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.documents.adapters import DocumentResponsePresentationAdapter
from services.knowledge.documents.application import (
    DatasetCreatorAccess,
    DatasetDocumentApplicationService,
    DocumentArchivedError,
    DocumentDatasetRepository,
    DocumentIndexingStateError,
    DocumentInvalidActionError,
    DocumentLifecycleCache,
    DocumentModelConfigurationGateway,
    DocumentNotFoundError,
    DocumentOperations,
    DocumentProviderError,
    DocumentRepository,
    DocumentSourceAuthorization,
    DocumentTaskDispatcher,
    DocumentTaskDispatchError,
    DocumentUploads,
)
from services.knowledge.documents.contracts import (
    DocumentBatchCleanupJob,
    DocumentCleanupJob,
    DocumentCreationDataset,
    DocumentCreationDefaults,
    DocumentCreationEnvironment,
    DocumentCreationGateway,
    DocumentCreationLimits,
    DocumentCreationProjection,
    DocumentDatasetProjection,
    DocumentIndexingJobs,
    DocumentPersistenceArchivedError,
    DocumentPersistenceInvalidStateError,
    DocumentPersistenceNotFoundError,
    DocumentReadProjection,
    DocumentRetryBatch,
    DocumentState,
    DocumentStatusAction,
    DocumentStatusMutation,
    DocumentStatusRollback,
    DocumentSummaryConfiguration,
    DocumentWriteConfig,
)
from services.knowledge.documents.creation import build_document_write_config
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.knowledge_entities import KnowledgeConfig
from services.knowledge.entities.model_configuration import (
    DatasetModelConfiguration,
    EmbeddingModelConfiguration,
)
from services.knowledge.entities.resource_scope import DatasetRef, DocumentRef
from services.knowledge.indexing.locks import KnowledgeIndexingLease, KnowledgeIndexingLock, document_index_lock_name

CONTEXT = RequestContext("request-1", None, "actor-1", "tenant-1")
DATASET = DatasetRef("tenant-1", "dataset-1")
DOCUMENT = DATASET.document("document-1")
RETRY_STARTED_AT = datetime(2026, 10, 29, 12, 30, 45, 123456)
STATE = DocumentState(
    "document-1",
    False,
    "indexing",
    False,
    "website_crawl",
    "text_model",
    False,
    data_source_info={
        "provider": "firecrawl",
        "provider_instance_id": "a" * 64,
        "job_id": "job-1",
        "mode": "crawl",
        "url": "https://example.com",
    },
)


@pytest.fixture
def operations() -> Mock:
    return create_autospec(DocumentOperations, instance=True, spec_set=True)


@pytest.fixture
def access() -> Mock:
    result = create_autospec(DatasetAccess, instance=True, spec_set=True)
    result.require_accessible.return_value = AccessibleDataset("dataset-1", "tenant-1")
    return result


@pytest.fixture
def uploads() -> DocumentUploads:
    class StubUploads:
        def upload_text(self, context: RequestContext, *, name: str, text: str) -> str:
            del context, name, text
            return "upload-1"

        def upload_file(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str:
            del context, filename, content, mimetype
            return "upload-1"

    return StubUploads()


@pytest.fixture
def datasets() -> Mock:
    result = create_autospec(DocumentDatasetRepository, instance=True, spec_set=True)
    result.get_document_creation_defaults.return_value = DocumentCreationDefaults(
        "vendor", "hierarchical_model", "economy"
    )
    result.get_model_configuration.return_value = DatasetModelConfiguration("tenant-1", "economy", None, None)
    return result


@pytest.fixture
def documents() -> Mock:
    result = create_autospec(DocumentRepository, instance=True, spec_set=True)
    result.get_state.return_value = STATE
    result.get_summary_configuration.return_value = DocumentSummaryConfiguration("high_quality", True)
    result.delete_document.return_value = DocumentCleanupJob("document-1", "dataset-1", "text_model", "file-1")
    result.delete_documents.return_value = DocumentBatchCleanupJob(
        ("document-1",), "dataset-1", "text_model", ("file-1",)
    )
    return result


@pytest.fixture
def indexing_locks() -> Mock:
    result = create_autospec(KnowledgeIndexingLock, instance=True, spec_set=True)
    lease = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    lease.token = "retry-token"
    result.try_acquire.return_value = lease
    result.try_acquire_handoff.return_value = lease
    result.hold.return_value = nullcontext(lease)
    return result


@pytest.fixture
def lifecycle_cache() -> Mock:
    result = create_autospec(DocumentLifecycleCache, instance=True, spec_set=True)
    result.try_mark_syncing.return_value = True
    return result


@pytest.fixture
def model_configuration() -> Mock:
    return create_autospec(DocumentModelConfigurationGateway, instance=True, spec_set=True)


@pytest.fixture
def creation() -> Mock:
    result = create_autospec(DocumentCreationGateway, instance=True, spec_set=True)
    result.load_environment.return_value = DocumentCreationEnvironment(
        limits=DocumentCreationLimits(False, False, 0, 0, 0),
        priority_indexing=True,
        initial_permission="only_me",
    )
    return result


@pytest.fixture
def creator_access() -> Mock:
    return create_autospec(DatasetCreatorAccess, instance=True, spec_set=True)


@pytest.fixture
def source_authorization() -> Mock:
    return create_autospec(DocumentSourceAuthorization, instance=True, spec_set=True)


@pytest.fixture
def tasks() -> Mock:
    result = create_autospec(DocumentTaskDispatcher, instance=True, spec_set=True)
    result.change_status.return_value = ()
    return result


@pytest.fixture
def service(
    access: Mock,
    datasets: Mock,
    documents: Mock,
    operations: Mock,
    uploads: DocumentUploads,
    indexing_locks: Mock,
    lifecycle_cache: Mock,
    model_configuration: Mock,
    creation: Mock,
    creator_access: Mock,
    source_authorization: Mock,
    tasks: Mock,
) -> DatasetDocumentApplicationService:
    return DatasetDocumentApplicationService(
        dataset_access=access,
        datasets=datasets,
        documents=documents,
        operations=operations,
        uploads=uploads,
        indexing_locks=indexing_locks,
        lifecycle_cache=lifecycle_cache,
        model_configuration=model_configuration,
        creation=creation,
        creator_access=creator_access,
        source_authorization=source_authorization,
        tasks=tasks,
        presenter=DocumentResponsePresentationAdapter(),
    )


@pytest.mark.parametrize(
    "operation",
    [
        DatasetDocumentApplicationService.get_document,
        DatasetDocumentApplicationService.delete_document,
        DatasetDocumentApplicationService.pause_document,
        DatasetDocumentApplicationService.recover_document,
        DatasetDocumentApplicationService.sync_website,
    ],
)
def test_denied_dataset_never_loads_or_mutates_documents(
    service: DatasetDocumentApplicationService,
    access: Mock,
    operations: Mock,
    operation: Callable[..., object],
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        operation(service, CONTEXT, dataset_id="dataset-1", document_id="document-1")
    assert operations.mock_calls == []


@pytest.mark.parametrize(
    "operation",
    [
        DatasetDocumentApplicationService.get_document,
        DatasetDocumentApplicationService.delete_document,
        DatasetDocumentApplicationService.pause_document,
        DatasetDocumentApplicationService.recover_document,
        DatasetDocumentApplicationService.sync_website,
    ],
)
def test_missing_document_stops_before_any_side_effect(
    service: DatasetDocumentApplicationService,
    access: Mock,
    documents: Mock,
    operations: Mock,
    operation: Callable[..., object],
) -> None:
    documents.get_state.return_value = None
    with pytest.raises(DocumentNotFoundError):
        operation(service, CONTEXT, dataset_id="dataset-1", document_id="document-1")
    access.require_accessible.assert_called_once_with(CONTEXT, "dataset-1")
    documents.get_state.assert_called_once_with(DOCUMENT)
    assert operations.mock_calls == []


@pytest.mark.parametrize(
    "operation",
    [
        DatasetDocumentApplicationService.pause_document,
        DatasetDocumentApplicationService.recover_document,
        DatasetDocumentApplicationService.sync_website,
    ],
)
def test_archived_documents_cannot_be_reprocessed(
    service: DatasetDocumentApplicationService, documents: Mock, operations: Mock, operation: Callable[..., object]
) -> None:
    documents.get_state.return_value = replace(STATE, archived=True)
    with pytest.raises(DocumentArchivedError):
        operation(service, CONTEXT, dataset_id="dataset-1", document_id="document-1")
    assert operations.mock_calls == []


def test_archived_document_can_be_deleted(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    tasks: Mock,
) -> None:
    documents.get_state.return_value = replace(STATE, archived=True)

    service.delete_document(CONTEXT, dataset_id="dataset-1", document_id="document-1")

    documents.delete_document.assert_called_once_with(DOCUMENT)
    tasks.cleanup.assert_called_once_with(
        DATASET, DocumentCleanupJob("document-1", "dataset-1", "text_model", "file-1")
    )


def test_batch_delete_delegates_to_the_repository(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    tasks: Mock,
) -> None:
    service.delete_documents(CONTEXT, dataset_id="dataset-1", document_ids=["document-1"])

    documents.delete_documents.assert_called_once_with(DATASET, ["document-1"])
    tasks.cleanup.assert_called_once_with(
        DATASET, DocumentBatchCleanupJob(("document-1",), "dataset-1", "text_model", ("file-1",))
    )


@pytest.mark.parametrize(
    ("doc_type", "expected"), [("book", {"title": "Title"}), ("others", {"title": "Title", "unknown": 12})]
)
def test_metadata_policy_filters_schema_but_preserves_custom_fields(
    service: DatasetDocumentApplicationService, documents: Mock, doc_type: str | None, expected: dict[str, object]
) -> None:
    service.update_metadata(
        CONTEXT,
        dataset_id="dataset-1",
        document_id="document-1",
        doc_type=doc_type,
        doc_metadata={"title": "Title", "unknown": 12},
    )
    assert documents.update_metadata.call_args.args == (DOCUMENT,)
    assert documents.update_metadata.call_args.kwargs["doc_metadata"] == expected
    assert documents.update_metadata.call_args.kwargs["doc_type"] == doc_type


@pytest.mark.parametrize(("doc_type", "metadata"), [(None, {}), ("book", None), ("invalid", {})])
def test_invalid_metadata_never_writes(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    doc_type: str | None,
    metadata: dict[str, object] | None,
) -> None:
    with pytest.raises(ValueError, match="(?:Both doc_type and doc_metadata must be provided\\.|Invalid doc_type\\.)"):
        service.update_metadata(
            CONTEXT, dataset_id="dataset-1", document_id="document-1", doc_type=doc_type, doc_metadata=metadata
        )
    documents.update_metadata.assert_not_called()


def test_retry_accepts_disabled_errors_and_filters_missing_archived_non_error_and_duplicates(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    indexing_locks: Mock,
    tasks: Mock,
) -> None:
    documents.get_states.return_value = [
        replace(STATE, id="error", indexing_status="error"),
        replace(STATE, id="waiting", indexing_status="waiting"),
        replace(STATE, id="archived", archived=True, indexing_status="error"),
        replace(STATE, id="disabled", enabled=False, indexing_status="error"),
        replace(STATE, id="completed", indexing_status="completed"),
    ]
    documents.retry_documents.return_value = DocumentRetryBatch(("error", "disabled"), RETRY_STARTED_AT)
    service.retry_documents(
        CONTEXT,
        dataset_id="dataset-1",
        document_ids=["archived", "missing", "error", "error", "waiting", "disabled", "completed"],
    )
    assert documents.retry_documents.call_args.args == (DATASET, ["error", "disabled"])
    assert documents.retry_documents.call_args.kwargs["actor_id"] == "actor-1"
    tasks.retry.assert_called_once_with(
        DATASET,
        ("error", "disabled"),
        actor_id="actor-1",
    )
    assert indexing_locks.try_acquire_handoff.call_count == 2
    indexing_locks.try_acquire_handoff.assert_any_call(
        document_index_lock_name("error"), timeout=600, owner_id="actor-1"
    )
    indexing_locks.try_acquire_handoff.assert_any_call(
        document_index_lock_name("disabled"), timeout=600, owner_id="actor-1"
    )


def test_retry_releases_leases_for_documents_rejected_by_locked_revalidation(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    indexing_locks: Mock,
    tasks: Mock,
) -> None:
    documents.get_states.return_value = [
        replace(STATE, id="still-failed", indexing_status="error"),
        replace(STATE, id="changed", indexing_status="error"),
    ]
    documents.retry_documents.return_value = DocumentRetryBatch(("still-failed",), RETRY_STARTED_AT)
    retained = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    retained.token = "retained-token"
    released = create_autospec(KnowledgeIndexingLease, instance=True, spec_set=True)
    released.token = "released-token"
    indexing_locks.try_acquire_handoff.side_effect = [released, retained]

    service.retry_documents(
        CONTEXT,
        dataset_id="dataset-1",
        document_ids=["still-failed", "changed"],
    )

    retained.release.assert_not_called()
    released.release.assert_called_once_with()
    tasks.retry.assert_called_once_with(
        DATASET,
        ("still-failed",),
        actor_id="actor-1",
    )


def test_retry_releases_producer_leases_when_enqueue_fails(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    indexing_locks: Mock,
    tasks: Mock,
) -> None:
    documents.get_states.return_value = [replace(STATE, id="error", indexing_status="error")]
    documents.retry_documents.return_value = DocumentRetryBatch(("error",), RETRY_STARTED_AT)
    tasks.retry.side_effect = RuntimeError("broker unavailable")
    lease = indexing_locks.try_acquire_handoff.return_value

    with pytest.raises(RuntimeError, match="broker unavailable"):
        service.retry_documents(CONTEXT, dataset_id="dataset-1", document_ids=["error"])

    documents.fail_retry_dispatch.assert_called_once_with(
        DATASET,
        DocumentRetryBatch(("error",), RETRY_STARTED_AT),
    )
    lease.release.assert_called_once_with()


def test_summary_skips_qa_and_enables_summary_before_dispatch(
    service: DatasetDocumentApplicationService, documents: Mock
) -> None:
    documents.get_states.return_value = [
        STATE,
        replace(STATE, id="qa", doc_form="qa_model"),
        replace(STATE, id="ready", need_summary=True),
    ]
    service.generate_summary(CONTEXT, dataset_id="dataset-1", document_ids=["document-1", "qa", "ready"])
    documents.enable_summary.assert_called_once_with(DATASET, ["document-1", "ready"])


def test_summary_missing_document_cannot_partially_schedule(
    service: DatasetDocumentApplicationService, documents: Mock
) -> None:
    documents.get_states.return_value = [STATE]
    with pytest.raises(DocumentNotFoundError, match="missing"):
        service.generate_summary(CONTEXT, dataset_id="dataset-1", document_ids=["document-1", "missing"])
    documents.enable_summary.assert_not_called()


def test_process_rule_resolves_document_inside_active_workspace(
    service: DatasetDocumentApplicationService, operations: Mock, documents: Mock, access: Mock
) -> None:
    documents.find_ref.return_value = DOCUMENT
    service.get_process_rule(CONTEXT, document_id="document-1")
    documents.find_ref.assert_called_once_with(workspace_id="tenant-1", document_id="document-1")
    access.require_accessible.assert_called_once_with(CONTEXT, "dataset-1")
    operations.get_process_rule.assert_called_once_with(DATASET)


def test_default_process_rule_does_not_load_a_dataset(
    service: DatasetDocumentApplicationService, operations: Mock, access: Mock
) -> None:
    service.get_process_rule(CONTEXT, document_id=None)
    access.require_accessible.assert_not_called()
    operations.get_process_rule.assert_called_once_with(None)


def test_pause_requires_indexing_state_and_recover_requires_pause(
    service: DatasetDocumentApplicationService, documents: Mock
) -> None:
    documents.get_state.return_value = replace(STATE, indexing_status="completed")
    with pytest.raises(DocumentIndexingStateError):
        service.pause_document(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    with pytest.raises(DocumentIndexingStateError):
        service.recover_document(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    documents.pause_document.assert_not_called()
    documents.recover_document.assert_not_called()


def test_website_sync_rejects_other_sources(service: DatasetDocumentApplicationService, documents: Mock) -> None:
    documents.get_state.return_value = replace(STATE, data_source_type="upload_file")
    with pytest.raises(ValueError, match="not a website"):
        service.sync_website(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    documents.sync_website.assert_not_called()


def test_website_sync_uses_one_token_for_marker_and_dispatches_after_persistence(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    lifecycle_cache: Mock,
    tasks: Mock,
) -> None:
    service.sync_website(CONTEXT, dataset_id="dataset-1", document_id="document-1")

    documents.sync_website.assert_called_once_with(DOCUMENT)
    token = lifecycle_cache.try_mark_syncing.call_args.kwargs["token"]
    lifecycle_cache.try_mark_syncing.assert_called_once_with("document-1", token=token)
    tasks.sync_website.assert_called_once_with(DOCUMENT)
    lifecycle_cache.clear_syncing.assert_not_called()


def test_website_sync_rejects_unexecutable_source_before_state_mutation(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    lifecycle_cache: Mock,
    source_authorization: Mock,
    tasks: Mock,
) -> None:
    source_authorization.validate_stored_website.side_effect = ValueError(
        "Crawl job provider instance is not recorded; crawl the source again"
    )

    with pytest.raises(ValueError, match="provider instance is not recorded"):
        service.sync_website(CONTEXT, dataset_id="dataset-1", document_id="document-1")

    source_authorization.validate_stored_website.assert_called_once_with(CONTEXT, STATE.data_source_info)
    lifecycle_cache.try_mark_syncing.assert_not_called()
    documents.sync_website.assert_not_called()
    tasks.sync_website.assert_not_called()


def test_website_sync_releases_its_marker_when_persistence_fails(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    lifecycle_cache: Mock,
) -> None:
    documents.sync_website.side_effect = RuntimeError("commit failed")

    with pytest.raises(RuntimeError, match="commit failed"):
        service.sync_website(CONTEXT, dataset_id="dataset-1", document_id="document-1")

    token = lifecycle_cache.try_mark_syncing.call_args.kwargs["token"]
    lifecycle_cache.clear_syncing.assert_called_once_with("document-1", token=token)


@pytest.mark.parametrize(
    ("persistence_error", "application_error"),
    [
        (DocumentPersistenceNotFoundError("Document not found."), DocumentNotFoundError),
        (
            DocumentPersistenceInvalidStateError("Document is not a website document."),
            DocumentInvalidActionError,
        ),
        (DocumentPersistenceArchivedError("Document is archived."), DocumentArchivedError),
    ],
)
def test_website_sync_maps_second_read_errors_and_releases_its_marker(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    lifecycle_cache: Mock,
    persistence_error: Exception,
    application_error: type[Exception],
) -> None:
    documents.sync_website.side_effect = persistence_error

    with pytest.raises(application_error, match=str(persistence_error)):
        service.sync_website(CONTEXT, dataset_id="dataset-1", document_id="document-1")

    token = lifecycle_cache.try_mark_syncing.call_args.kwargs["token"]
    lifecycle_cache.clear_syncing.assert_called_once_with("document-1", token=token)


def test_busy_website_sync_preserves_the_current_owner_marker(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    lifecycle_cache: Mock,
) -> None:
    lifecycle_cache.try_mark_syncing.return_value = False

    with pytest.raises(DocumentInvalidActionError, match="being synced"):
        service.sync_website(CONTEXT, dataset_id="dataset-1", document_id="document-1")

    documents.sync_website.assert_not_called()
    lifecycle_cache.clear_syncing.assert_not_called()


class RecordingAccess:
    def __init__(self) -> None:
        self.dataset_ids: list[str] = []

    def require_accessible(self, context: RequestContext, dataset_id: str) -> AccessibleDataset:
        assert context == CONTEXT
        self.dataset_ids.append(dataset_id)
        return AccessibleDataset(dataset_id, context.active_workspace_id)


class RecordingDocumentOperations:
    pass


class RecordingDatasets:
    def __init__(self, defaults: DocumentCreationDefaults | None = None) -> None:
        self.defaults = defaults or DocumentCreationDefaults("vendor", "hierarchical_model", "economy")

    def get_document_creation_defaults(self, ref: DatasetRef) -> DocumentCreationDefaults:
        assert ref == DATASET
        return self.defaults

    def delete_with_relations(self, ref: DatasetRef) -> DatasetCleanupRecord:
        return DatasetCleanupRecord(ref.dataset_id, ref.tenant_id, "economy", None, None, "text_model", None)


class RecordingDocumentRefs:
    def __init__(self) -> None:
        self.creations: list[tuple[DatasetRef, DocumentWriteConfig, DocumentCreatedFrom]] = []

    def find_ref(self, *, workspace_id: str, document_id: str) -> DocumentRef | None:
        del workspace_id, document_id
        return None

    def get_state(self, ref: DocumentRef) -> DocumentState | None:
        del ref
        return STATE

    def get_states(self, ref: DatasetRef, document_ids: Sequence[str]) -> Sequence[DocumentState]:
        del ref, document_ids
        return []

    def get_creation_dataset(
        self,
        ref: DatasetRef,
        *,
        actor_id: str,
        doc_form: str,
        indexing_technique: str | None,
    ) -> DocumentCreationDataset:
        del actor_id, doc_form, indexing_technique
        return DocumentCreationDataset(ref.tenant_id, "economy", None, None)

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
        del actor_id, initialize, priority, initial_permission
        self.creations.append((ref, config, created_from))
        now = datetime(2024, 1, 1)
        return (
            DocumentCreationProjection(
                dataset=DocumentDatasetProjection(
                    id=ref.dataset_id,
                    name="Dataset",
                    description=None,
                    permission="only_me",
                    data_source_type="upload_file",
                    indexing_technique="economy",
                    created_by=CONTEXT.account_id,
                    created_at=now,
                ),
                documents=(
                    DocumentReadProjection(
                        id="document-1",
                        tenant_id=ref.tenant_id,
                        dataset_id=ref.dataset_id,
                        position=1,
                        data_source_type="upload_file",
                        data_source_info={},
                        dataset_process_rule_id=None,
                        name="Document",
                        created_from=created_from,
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
                    ),
                ),
                batch="batch-1",
            ),
            DocumentIndexingJobs(dataset=ref, created=("document-1",)),
        )


class RecordingSourceAuthorization:
    def authorize(self, context: RequestContext, config: KnowledgeConfig) -> DocumentWriteConfig:
        assert context == CONTEXT
        return build_document_write_config(config)

    def validate_stored_website(self, context: RequestContext, source_info: Mapping[str, object]) -> None:
        del source_info
        assert context == CONTEXT


class RecordingDocumentUploads:
    def __init__(self) -> None:
        self.texts: list[tuple[str, str]] = []
        self.files: list[tuple[str, bytes, str]] = []

    def upload_text(self, context: RequestContext, *, name: str, text: str) -> str:
        assert context == CONTEXT
        self.texts.append((name, text))
        return "upload-1"

    def upload_file(self, context: RequestContext, *, filename: str, content: bytes, mimetype: str) -> str:
        assert context == CONTEXT
        self.files.append((filename, content, mimetype))
        return "upload-1"


class UnusedIndexingLocks:
    def try_acquire(self, name: str, *, timeout: int) -> None:
        del name, timeout
        raise AssertionError("retry locks are not used by creation tests")

    @contextmanager
    def hold(
        self,
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[None]:
        assert name == "add_document_lock_dataset_id_dataset-1"
        assert timeout == 600
        assert expected_token is None
        assert blocking_timeout == 600
        yield


class RecordingLifecycleCache:
    def is_indexing(self, document_id: str) -> bool:
        del document_id
        return False

    def mark_indexing(self, document_ids: Sequence[str]) -> None:
        del document_ids

    def clear_indexing(self, document_ids: Sequence[str]) -> None:
        del document_ids

    def mark_paused(self, document_id: str) -> None:
        del document_id

    def clear_paused(self, document_id: str) -> None:
        del document_id

    def try_mark_syncing(self, document_id: str, *, token: str) -> bool:
        del document_id, token
        return True

    def clear_syncing(self, document_id: str, *, token: str) -> None:
        del document_id, token


class RecordingModelConfiguration:
    def __init__(self) -> None:
        self.embedding_validations: list[tuple[str, str, str]] = []
        self.reranking_validations: list[tuple[str, str, str]] = []

    def validate_dataset_model(
        self,
        *,
        configuration: DatasetModelConfiguration,
        dataset_unavailable: bool = True,
    ) -> None:
        del configuration, dataset_unavailable

    def resolve_default_embedding_model(self, *, tenant_id: str) -> EmbeddingModelConfiguration:
        del tenant_id
        return EmbeddingModelConfiguration("provider", "embedding", False)

    def validate_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        self.embedding_validations.append((tenant_id, provider, model))

    def validate_reranking_model(self, *, tenant_id: str, provider: str, model: str) -> None:
        self.reranking_validations.append((tenant_id, provider, model))

    def resolve_embedding_model(self, *, tenant_id: str, provider: str, model: str) -> EmbeddingModelConfiguration:
        del tenant_id
        return EmbeddingModelConfiguration(provider, model, False)


class RecordingCreation:
    def load_environment(self, tenant_id: str) -> DocumentCreationEnvironment:
        assert tenant_id == CONTEXT.active_workspace_id
        return DocumentCreationEnvironment(
            limits=DocumentCreationLimits(False, False, 0, 0, 0),
            priority_indexing=True,
            initial_permission="only_me",
        )

    def resolve_default_embedding_model(self, tenant_id: str) -> EmbeddingModelConfiguration:
        del tenant_id
        return EmbeddingModelConfiguration("provider", "embedding", False)

    def validate_dataset_model(self, dataset: DocumentCreationDataset) -> None:
        del dataset


class RecordingCreatorAccess:
    def initialize_creator_access(self, context: RequestContext, *, dataset_id: str) -> None:
        del context, dataset_id


def _recording_service(
    operations: RecordingDocumentOperations,
    uploads: RecordingDocumentUploads,
    access: RecordingAccess,
    datasets: RecordingDatasets | None = None,
    documents: RecordingDocumentRefs | None = None,
    model_configuration: RecordingModelConfiguration | None = None,
) -> tuple[DatasetDocumentApplicationService, RecordingDocumentRefs, RecordingModelConfiguration]:
    document_store = documents or RecordingDocumentRefs()
    models = model_configuration or RecordingModelConfiguration()
    service = DatasetDocumentApplicationService(
        dataset_access=cast(DatasetAccess, access),
        datasets=cast(DocumentDatasetRepository, datasets or RecordingDatasets()),
        documents=cast(DocumentRepository, document_store),
        operations=cast(DocumentOperations, operations),
        uploads=cast(DocumentUploads, uploads),
        indexing_locks=cast(KnowledgeIndexingLock, UnusedIndexingLocks()),
        lifecycle_cache=RecordingLifecycleCache(),
        model_configuration=models,
        creation=RecordingCreation(),
        creator_access=RecordingCreatorAccess(),
        source_authorization=RecordingSourceAuthorization(),
        tasks=create_autospec(DocumentTaskDispatcher, instance=True, spec_set=True),
        presenter=DocumentResponsePresentationAdapter(),
    )
    return service, document_store, models


def test_text_creation_uploads_source_before_persisting_document_settings() -> None:
    access = RecordingAccess()
    operations = RecordingDocumentOperations()
    uploads = RecordingDocumentUploads()
    service, documents, models = _recording_service(operations, uploads, access)

    result = service.create_by_text(
        CONTEXT,
        dataset_id="dataset-1",
        name="Guide",
        text="Contents",
        settings={"indexing_technique": "economy"},
    )

    assert result["batch"] == "batch-1"
    assert access.dataset_ids == ["dataset-1"]
    assert uploads.texts == [("Guide", "Contents")]
    assert models.embedding_validations == []
    ref, config, created_from = documents.creations[0]
    assert ref == DATASET
    assert created_from is DocumentCreatedFrom.API
    assert config.indexing_technique == "economy"
    assert config.data_source is not None
    assert config.data_source.file_ids == ("upload-1",)


def test_text_update_treats_an_empty_string_as_replacement_content() -> None:
    access = RecordingAccess()
    operations = RecordingDocumentOperations()
    uploads = RecordingDocumentUploads()
    service, documents, _ = _recording_service(operations, uploads, access)

    result = service.update_by_text(
        CONTEXT,
        dataset_id="dataset-1",
        document_id="document-1",
        settings={"name": "Empty guide", "text": ""},
    )

    assert result["batch"] == "batch-1"
    assert uploads.texts == [("Empty guide", "")]
    ref, config, created_from = documents.creations[0]
    assert ref == DATASET
    assert created_from is DocumentCreatedFrom.API
    assert config.original_document_id == "document-1"
    assert config.data_source is not None
    assert config.data_source.file_ids == ("upload-1",)


def test_console_creation_keeps_web_source() -> None:
    access = RecordingAccess()
    operations = RecordingDocumentOperations()
    service, documents, _ = _recording_service(operations, RecordingDocumentUploads(), access)

    service.create_documents(
        CONTEXT,
        dataset_id="dataset-1",
        settings={"indexing_technique": "economy", "process_rule": {"mode": "automatic"}},
    )

    assert documents.creations[0][0] == DATASET
    assert documents.creations[0][2] is DocumentCreatedFrom.WEB


def test_file_creation_persists_api_source() -> None:
    access = RecordingAccess()
    operations = RecordingDocumentOperations()
    uploads = RecordingDocumentUploads()
    service, documents, _ = _recording_service(operations, uploads, access)

    service.create_by_file(
        CONTEXT,
        dataset_id="dataset-1",
        filename="guide.txt",
        content=b"contents",
        mimetype="text/plain",
        settings={},
    )

    assert uploads.files == [("guide.txt", b"contents", "text/plain")]
    assert documents.creations[0][2] is DocumentCreatedFrom.API


def test_external_dataset_rejection_happens_before_file_upload() -> None:
    access = RecordingAccess()
    operations = RecordingDocumentOperations()
    uploads = RecordingDocumentUploads()
    service, documents, _ = _recording_service(
        operations,
        uploads,
        access,
        RecordingDatasets(DocumentCreationDefaults("external", None, "economy")),
    )

    with pytest.raises(ValueError, match="External datasets"):
        service.create_by_file(
            CONTEXT,
            dataset_id="dataset-1",
            filename="guide.txt",
            content=b"contents",
            mimetype="text/plain",
            settings={},
        )

    assert uploads.files == []
    assert documents.creations == []


def test_missing_indexing_technique_rejects_text_before_upload() -> None:
    access = RecordingAccess()
    operations = RecordingDocumentOperations()
    uploads = RecordingDocumentUploads()
    service, documents, _ = _recording_service(
        operations,
        uploads,
        access,
        RecordingDatasets(DocumentCreationDefaults("vendor", "text_model", None)),
    )

    with pytest.raises(ValueError, match="indexing_technique is required"):
        service.create_by_text(
            CONTEXT,
            dataset_id="dataset-1",
            name="Guide",
            text="Contents",
            settings={},
        )

    assert uploads.texts == []
    assert documents.creations == []


def test_change_status_checks_only_documents_owned_by_dataset(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    lifecycle_cache: Mock,
) -> None:
    documents.get_states.return_value = [replace(STATE, id="owned")]
    documents.change_status.return_value = DocumentStatusMutation()
    lifecycle_cache.is_indexing.side_effect = lambda document_id: document_id == "foreign"

    service.change_status(
        CONTEXT,
        dataset_id="dataset-1",
        document_ids=["foreign", "owned", "owned"],
        action="disable",
    )

    assert [entry.args for entry in documents.get_states.call_args_list] == [
        (DATASET, ("foreign", "owned")),
        (DATASET, ("owned",)),
    ]
    lifecycle_cache.is_indexing.assert_called_once_with("owned")
    assert documents.change_status.call_args.args == (DATASET, ("owned",))
    assert documents.change_status.call_args.kwargs == {"action": "disable", "actor_id": CONTEXT.account_id}


def test_change_status_rolls_back_only_failed_dispatches(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    indexing_locks: Mock,
    lifecycle_cache: Mock,
    tasks: Mock,
) -> None:
    documents.get_states.return_value = [
        replace(STATE, id="published", enabled=False),
        replace(STATE, id="failed", enabled=False),
    ]
    applied_at = datetime(2026, 1, 2)
    rollbacks = tuple(
        DocumentStatusRollback(
            document_id=document_id,
            applied_updated_at=applied_at,
            applied_enabled=True,
            applied_disabled_at=None,
            applied_disabled_by=None,
            applied_archived=False,
            applied_archived_at=None,
            applied_archived_by=None,
            enabled=False,
            disabled_at=datetime(2026, 1, 1),
            disabled_by="actor-1",
            archived=False,
            archived_at=None,
            archived_by=None,
            updated_at=datetime(2026, 1, 1),
        )
        for document_id in ("published", "failed")
    )
    documents.change_status.return_value = DocumentStatusMutation(
        indexing_document_ids=("published", "failed"),
        rollbacks=rollbacks,
    )
    tasks.change_status.return_value = ("failed",)
    lifecycle_cache.is_indexing.return_value = False
    lifecycle_cache.mark_indexing.side_effect = RuntimeError("redis unavailable")
    active_locks: set[str] = set()

    @contextmanager
    def hold(
        name: str,
        *,
        timeout: int,
        expected_token: str | None = None,
        blocking_timeout: float = 0,
    ) -> Generator[object]:
        assert timeout == 600
        assert expected_token is None
        assert blocking_timeout == 0
        active_locks.add(name)
        try:
            yield object()
        finally:
            active_locks.remove(name)

    def dispatch(_document_ids: Sequence[str], *, action: DocumentStatusAction) -> tuple[str, ...]:
        assert action == "enable"
        assert active_locks == {
            document_index_lock_name("published"),
            document_index_lock_name("failed"),
        }
        return ("failed",)

    def rollback(_ref: DatasetRef, _rollbacks: Sequence[DocumentStatusRollback]) -> tuple[str, ...]:
        assert active_locks == {
            document_index_lock_name("published"),
            document_index_lock_name("failed"),
        }
        return ("failed",)

    indexing_locks.hold.side_effect = hold
    tasks.change_status.side_effect = dispatch
    documents.rollback_status_change.side_effect = rollback

    with pytest.raises(DocumentTaskDispatchError, match="1 document"):
        service.change_status(
            CONTEXT,
            dataset_id="dataset-1",
            document_ids=["published", "failed"],
            action="enable",
        )

    tasks.change_status.assert_called_once_with(("published", "failed"), action="enable")
    documents.rollback_status_change.assert_called_once_with(DATASET, (rollbacks[1],))
    lifecycle_cache.clear_indexing.assert_called_once_with(("failed",))
    assert active_locks == set()


def test_change_status_with_no_owned_documents_has_no_side_effects(
    service: DatasetDocumentApplicationService,
    datasets: Mock,
    documents: Mock,
    lifecycle_cache: Mock,
    model_configuration: Mock,
) -> None:
    owned_states: list[DocumentState] = []
    documents.get_states.return_value = owned_states

    service.change_status(
        CONTEXT,
        dataset_id="dataset-1",
        document_ids=["foreign"],
        action="disable",
    )

    lifecycle_cache.is_indexing.assert_not_called()
    datasets.get_model_configuration.assert_not_called()
    model_configuration.validate_dataset_model.assert_not_called()
    documents.change_status.assert_not_called()


@pytest.mark.parametrize(
    ("action", "enabled", "archived", "validates_model"),
    [
        ("disable", True, False, False),
        ("archive", True, False, False),
        ("enable", True, False, False),
        ("enable", False, True, False),
        ("enable", False, False, True),
        ("un_archive", False, True, False),
        ("un_archive", True, False, False),
        ("un_archive", True, True, True),
    ],
)
def test_change_status_validates_model_only_when_restoring_the_index(
    service: DatasetDocumentApplicationService,
    datasets: Mock,
    documents: Mock,
    lifecycle_cache: Mock,
    model_configuration: Mock,
    action: Literal["enable", "disable", "archive", "un_archive"],
    enabled: bool,
    archived: bool,
    validates_model: bool,
) -> None:
    documents.get_states.return_value = [replace(STATE, enabled=enabled, archived=archived)]
    documents.change_status.return_value = DocumentStatusMutation()
    lifecycle_cache.is_indexing.return_value = False

    service.change_status(
        CONTEXT,
        dataset_id="dataset-1",
        document_ids=[STATE.id],
        action=action,
    )

    if validates_model:
        datasets.get_model_configuration.assert_called_once_with(DATASET)
        model_configuration.validate_dataset_model.assert_called_once_with(
            configuration=datasets.get_model_configuration.return_value
        )
    else:
        datasets.get_model_configuration.assert_not_called()
        model_configuration.validate_dataset_model.assert_not_called()
    documents.change_status.assert_called_once_with(
        DATASET,
        (STATE.id,),
        action=action,
        actor_id=CONTEXT.account_id,
    )


def test_change_status_reloads_state_under_lock_before_restore_validation(
    service: DatasetDocumentApplicationService,
    datasets: Mock,
    documents: Mock,
    lifecycle_cache: Mock,
    model_configuration: Mock,
) -> None:
    documents.get_states.side_effect = [
        [replace(STATE, enabled=True, archived=False)],
        [replace(STATE, enabled=False, archived=False)],
    ]
    documents.change_status.return_value = DocumentStatusMutation()
    lifecycle_cache.is_indexing.return_value = False

    service.change_status(
        CONTEXT,
        dataset_id="dataset-1",
        document_ids=[STATE.id],
        action="enable",
    )

    datasets.get_model_configuration.assert_called_once_with(DATASET)
    model_configuration.validate_dataset_model.assert_called_once_with(
        configuration=datasets.get_model_configuration.return_value
    )


def test_change_status_does_not_restore_index_when_model_validation_fails(
    service: DatasetDocumentApplicationService,
    documents: Mock,
    lifecycle_cache: Mock,
    model_configuration: Mock,
) -> None:
    documents.get_states.return_value = [replace(STATE, enabled=False, archived=False)]
    model_configuration.validate_dataset_model.side_effect = DocumentProviderError(
        "embedding credential is unavailable",
        kind="uninitialized",
    )

    with pytest.raises(DocumentProviderError, match="embedding credential is unavailable"):
        service.change_status(
            CONTEXT,
            dataset_id="dataset-1",
            document_ids=[STATE.id],
            action="enable",
        )

    lifecycle_cache.is_indexing.assert_not_called()
    documents.change_status.assert_not_called()
