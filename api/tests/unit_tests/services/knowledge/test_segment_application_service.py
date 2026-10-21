from contextlib import nullcontext
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal
from unittest.mock import Mock, create_autospec

import pytest

from libs.helper import generate_text_hash
from machinery.context import RequestContext
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccess,
    DatasetAccessDeniedError,
    DatasetAccessRecord,
    DatasetAccessSnapshot,
)
from services.knowledge.entities.segments import (
    ChildChunkRecord,
    ChildChunkUpdateArgs,
    SegmentRecord,
    SegmentUpdateArgs,
)
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.segments.application import (
    ChildChunkIndexingApplicationError,
    ChildChunkNotFoundError,
    ChildChunkValidationError,
    DatasetSegmentApplicationService,
    SegmentBatchImportDispatcher,
    SegmentBatchImportDispatchError,
    SegmentBatchImportNotFoundError,
    SegmentDatasetModelUnavailableError,
    SegmentDatasetNotFoundError,
    SegmentDocumentDisabledError,
    SegmentDocumentIndexingError,
    SegmentDocumentNotCompletedError,
    SegmentDocumentNotFoundError,
    SegmentEmbeddingModelUnavailableError,
    SegmentIndex,
    SegmentIndexingState,
    SegmentInvalidFileTypeError,
    SegmentModelGuard,
    SegmentModelProviderError,
    SegmentMutationService,
    SegmentNotFoundError,
    SegmentPermissionDeniedError,
    SegmentPresenter,
    SegmentScopeReader,
    SegmentStatusUpdateError,
    SegmentStore,
    SegmentUploadCatalog,
    SegmentUploadFileNotFoundError,
)
from services.knowledge.segments.contracts import (
    ChildChunkListFilter,
    ChildChunkPage,
    ChildChunkState,
    SegmentDatasetRecord,
    SegmentDetail,
    SegmentDocumentCreationState,
    SegmentDocumentRecord,
    SegmentIndexingMutationError,
    SegmentListFilter,
    SegmentMutationScope,
    SegmentPage,
    SegmentScope,
    SegmentUpdateState,
)


@dataclass
class SegmentLimitsStub:
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int = 10
    DATASET_MAX_SEGMENTS_PER_REQUEST: int = 100


def _context() -> RequestContext:
    return RequestContext(
        request_id="request-1",
        trace_id=None,
        account_id="account-1",
        active_workspace_id="workspace-1",
    )


def _dataset(
    *,
    indexing_technique: str = "economy",
) -> SegmentDatasetRecord:
    return SegmentDatasetRecord(
        id="dataset-1",
        workspace_id="workspace-1",
        indexing_technique=indexing_technique,
        embedding_model_provider="provider",
        embedding_model="model",
    )


def _document() -> SegmentDocumentRecord:
    return SegmentDocumentRecord(
        id="document-1",
        dataset_id="dataset-1",
        workspace_id="workspace-1",
        doc_form="text_model",
    )


def _snapshot() -> DatasetAccessSnapshot:
    return DatasetAccessSnapshot(
        DatasetAccessRecord("dataset-1", "workspace-1", "account-1", "all_team_members"), False
    )


def _scope(
    *,
    dataset: SegmentDatasetRecord | None = None,
    document: SegmentDocumentRecord | None = None,
) -> SegmentScope:
    return SegmentScope(
        dataset=_dataset() if dataset is None else dataset,
        document=_document() if document is None else document,
        access_snapshot=_snapshot(),
    )


type ServiceFixture = tuple[DatasetSegmentApplicationService, Mock, Mock, Mock, Mock, Mock, Mock]


def _service(
    scope: SegmentScope | None = None,
    *,
    uploads: SegmentUploadCatalog | None = None,
    index: SegmentIndex | None = None,
) -> ServiceFixture:
    dataset_access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    dataset_access.check_access.return_value = AccessibleDataset(id="dataset-1", workspace_id="workspace-1")
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    store.create_segments.return_value = SegmentDocumentCreationState("completed", True)
    store.get_document_creation_state.return_value = SegmentDocumentCreationState("completed", True)
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None)
    scopes = create_autospec(SegmentScopeReader, instance=True, spec_set=True)
    scopes.get_segment_scope.return_value = scope or _scope()
    model_guard = create_autospec(SegmentModelGuard, instance=True, spec_set=True)
    indexing_state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    indexing_state.lock.return_value = nullcontext()
    indexing_state.is_document_indexing.return_value = False
    indexing_state.is_segment_indexing.return_value = False
    if index is None:
        segment_index_mock: Mock = create_autospec(SegmentIndex, instance=True, spec_set=True)
        segment_index_mock.count_tokens.return_value = 0
        segment_index_mock.count_tokens_many.side_effect = lambda _dataset, texts: [0] * len(texts)
        segment_index = segment_index_mock
    else:
        segment_index = index
    dispatcher = create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True)
    presenter = create_autospec(SegmentPresenter, instance=True, spec_set=True)
    presenter.present.side_effect = tuple
    service = DatasetSegmentApplicationService(
        dataset_access=dataset_access,
        store=store,
        presenter=presenter,
        limits=SegmentLimitsStub(),
        text_hash=generate_text_hash,
        index=segment_index,
        uploads=uploads or create_autospec(SegmentUploadCatalog, instance=True, spec_set=True),
        scopes=scopes,
        model_guard=model_guard,
        indexing_state=indexing_state,
        batch_dispatcher=dispatcher,
        job_id_factory=lambda: "job-1",
    )
    return service, dataset_access, store, scopes, model_guard, indexing_state, dispatcher


def test_list_segments_uses_complete_owner_scope() -> None:
    service, dataset_access, store, scopes, _, _, _ = _service()
    expected = SegmentPage(items=(), total=0, total_pages=0, page=1, limit=20, doc_form="text_model")
    store.list_segments.return_value = expected

    result = service.list_segments(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        query=SegmentListFilter(keyword="needle"),
    )

    assert result == expected
    assert scopes.get_segment_scope.call_args.kwargs == {
        "dataset_ref": DatasetRef("workspace-1", "dataset-1"),
        "document_id": "document-1",
        "actor_id": "account-1",
    }
    assert store.list_segments.call_args.args[0] == _document().ref
    dataset_access.check_access.assert_called_once_with(_context(), _snapshot())


@pytest.mark.parametrize(
    ("scope", "expected"),
    [
        (SegmentScope(None, None), SegmentDatasetNotFoundError),
        (SegmentScope(_dataset(), None, _snapshot()), SegmentDocumentNotFoundError),
    ],
)
def test_mutations_reject_invalid_scope_before_store_operation(
    scope: SegmentScope,
    expected: type[Exception],
) -> None:
    service, _, store, scopes, _, _, _ = _service(scope)

    with pytest.raises(expected):
        service.delete_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
        )

    store.delete_segments.assert_not_called()


@pytest.mark.parametrize(
    ("access_error", "expected"),
    [
        (DatasetAccessDeniedError(), SegmentPermissionDeniedError),
    ],
)
def test_dataset_access_errors_are_translated(
    access_error: Exception,
    expected: type[Exception],
) -> None:
    service, dataset_access, store, scopes, _, _, _ = _service()
    dataset_access.check_access.side_effect = access_error

    with pytest.raises(expected):
        service.delete_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
        )

    store.delete_segments.assert_not_called()


@pytest.mark.parametrize(
    ("kind", "method", "expected", "message"),
    [
        ("bad_request", "create_segment", SegmentEmbeddingModelUnavailableError, "No Embedding Model"),
        ("token", "create_segment", SegmentEmbeddingModelUnavailableError, "token missing"),
        ("bad_request", "delete_segment", SegmentDatasetModelUnavailableError, "No Embedding Model"),
        ("token", "delete_segment", SegmentDatasetModelUnavailableError, "dataset is unavailable"),
    ],
)
def test_model_failures_are_translated_per_use_case(
    kind: Literal["bad_request", "token"],
    method: str,
    expected: type[Exception],
    message: str,
) -> None:
    service, _, store, scopes, model_guard, _, _ = _service(_scope(dataset=_dataset(indexing_technique="high_quality")))
    model_guard.check.side_effect = SegmentModelProviderError(kind=kind, description="token missing")
    store.get_segment.return_value = None

    if method == "create_segment":

        def invoke() -> object:
            return service.create_segment(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                values={"content": "content"},
            )

    else:

        def invoke() -> object:
            return service.delete_segment(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
            )

    with pytest.raises(expected, match=message):
        invoke()


def test_status_change_is_fenced_by_document_indexing_state() -> None:
    service, _, store, scopes, _, state, _ = _service()
    state.is_document_indexing.return_value = True

    with pytest.raises(SegmentDocumentIndexingError):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=["segment-1"],
            action="disable",
        )

    store.save_segment.assert_not_called()


def test_status_change_translates_operation_failure() -> None:
    service, _, store, scopes, _, _, _ = _service()
    store.get_segments.side_effect = RuntimeError("failed")

    with pytest.raises(SegmentStatusUpdateError, match="failed"):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=["segment-1"],
            action="enable",
        )


def test_update_and_delete_segment_map_missing_segment() -> None:
    service, _, store, scopes, _, _, _ = _service()
    store.get_segment_update_state.return_value = None
    store.get_segments.return_value = ()

    with pytest.raises(SegmentNotFoundError):
        service.update_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            values={"content": "content"},
        )
    with pytest.raises(SegmentNotFoundError):
        service.delete_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
        )


@pytest.mark.parametrize(
    "values",
    [
        {"keywords": ["replacement"]},
        {"enabled": False},
        {"attachment_ids": ["file-1"]},
        {"summary": "manual summary"},
    ],
    ids=["keywords", "enabled", "attachments", "summary"],
)
def test_update_segment_accepts_partial_fields_without_content(values: dict[str, object]) -> None:
    service, _, store, _, _, _, _ = _service()
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None)
    store.get_segment.return_value = _segment_detail()

    result = service.update_segment(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        values=values,
    )

    assert result.data.id == "segment-1"


def test_qa_partial_update_preserves_omitted_content_and_answer() -> None:
    document = replace(_document(), doc_form="qa_model")
    service, _, store, _, _, _, _ = _service(
        _scope(dataset=_dataset(indexing_technique="high_quality"), document=document)
    )
    store.get_segment_update_state.return_value = SegmentUpdateState(
        content="question",
        enabled=True,
        keywords=("old",),
        answer="answer",
    )
    store.get_segment.return_value = _segment_detail()

    service.update_segment(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        values={"keywords": ["new"]},
    )

    changes = store.save_segment.call_args.args[1]
    assert changes["content"] == "question"
    assert changes["answer"] == "answer"
    assert changes["word_count"] == len("questionanswer")


def test_qa_answer_only_update_needs_no_model_or_index() -> None:
    document = replace(_document(), doc_form="qa_model")
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    service, _, store, _, model_guard, _, _ = _service(
        _scope(dataset=_dataset(indexing_technique="high_quality"), document=document),
        index=index,
    )
    model_guard.check.side_effect = SegmentModelProviderError(kind="token", description="provider unavailable")
    store.get_segment_update_state.return_value = SegmentUpdateState(
        content="question",
        enabled=True,
        keywords=("old",),
        answer="answer",
    )
    store.get_segment.return_value = _segment_detail()

    service.update_segment(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        values={"content": "question", "answer": "new answer", "regenerate_child_chunks": False},
    )

    changes = store.save_segment.call_args.args[1]
    assert changes["answer"] == "new answer"
    assert changes["word_count"] == len("questionnew answer")
    assert set(changes) == {"answer", "word_count", "updated_at", "updated_by"}
    model_guard.check.assert_not_called()
    index.count_tokens.assert_not_called()
    index.update.assert_not_called()


def test_qa_create_and_content_update_count_only_question_tokens() -> None:
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    index.count_tokens.side_effect = lambda _dataset, text: len(text)
    index.count_tokens_many.side_effect = lambda _dataset, texts: [len(text) for text in texts]
    store.create_segments.return_value = SegmentDocumentCreationState("completed", True)
    state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    state.lock.return_value = nullcontext()
    state.is_segment_indexing.return_value = False
    mutation = SegmentMutationService(
        store=store,
        index=index,
        text_hash=generate_text_hash,
        indexing_state=state,
    )
    scope = SegmentMutationScope(_dataset(indexing_technique="high_quality"), replace(_document(), doc_form="qa_model"))

    mutation.create_segments(
        scope,
        actor_id="author",
        args=(SegmentUpdateArgs(content="batch question", answer="batch answer"),),
    )
    mutation.create_segment(
        scope,
        actor_id="author",
        args=SegmentUpdateArgs(content="single question", answer="single answer"),
    )
    store.get_segment_update_state.return_value = SegmentUpdateState(
        content="old question",
        enabled=True,
        keywords=(),
        answer="old answer",
    )
    mutation.update_segment(
        scope,
        actor_id="editor",
        segment_id="segment-1",
        args=SegmentUpdateArgs(content="updated question", answer="updated answer"),
    )

    assert [call.args[1] for call in index.count_tokens_many.call_args_list] == [
        ["batch question"],
        ["single question"],
    ]
    assert [call.args[1] for call in index.count_tokens.call_args_list] == ["updated question"]
    batch_values = store.create_segments.call_args_list[0].args[1]
    assert batch_values[0]["word_count"] == len("batch questionbatch answer")
    updated_values = store.save_segment.call_args_list[-1].args[1]
    assert updated_values["tokens"] == len("updated question")
    assert updated_values["word_count"] == len("updated questionupdated answer")


def test_content_update_persists_explicit_keywords_before_attachment_aware_summary() -> None:
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    index.count_tokens.return_value = 3
    events: list[str] = []
    index.update.side_effect = lambda *_args, **_kwargs: events.append("index")
    index.update_attachments.side_effect = lambda *_args, **_kwargs: events.append("attachments")
    index.update_summary.side_effect = lambda *_args, **_kwargs: events.append("summary")
    service, _, store, _, _, _, _ = _service(
        _scope(dataset=_dataset(indexing_technique="high_quality")),
        index=index,
    )
    store.get_segment_update_state.return_value = SegmentUpdateState(
        content="old content",
        enabled=True,
        keywords=("old",),
    )

    service.mutations.update_segment(
        SegmentMutationScope(_dataset(indexing_technique="high_quality"), _document()),
        actor_id="editor",
        segment_id="segment-1",
        args=SegmentUpdateArgs(
            content="new content",
            keywords=["new"],
            attachment_ids=["file-1"],
        ),
    )

    assert store.save_segment.call_args.args[1]["keywords"] == ["new"]
    assert events == ["index", "attachments", "summary"]


@pytest.mark.parametrize(
    "chunks",
    [
        [ChildChunkUpdateArgs(id="child-1", content="one"), ChildChunkUpdateArgs(id="child-1", content="two")],
        [ChildChunkUpdateArgs(content="   ")],
    ],
    ids=["duplicate-id", "blank-content"],
)
def test_child_batch_validation_precedes_reads_and_mutations(chunks: list[ChildChunkUpdateArgs]) -> None:
    service, _, store, _, _, _, _ = _service()

    with pytest.raises(ChildChunkValidationError):
        service.mutations.update_child_chunks(
            _document().ref.segment("segment-1"),
            chunks=chunks,
            actor_id="editor",
        )

    store.get_children.assert_not_called()
    store.save_children.assert_not_called()


def test_child_batch_rejects_unknown_ids_before_index_or_sql_mutation() -> None:
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    service, _, store, _, _, _, _ = _service(index=index)
    store.get_children.return_value = ()

    with pytest.raises(ChildChunkNotFoundError):
        service.mutations.update_child_chunks(
            _document().ref.segment("segment-1"),
            chunks=[ChildChunkUpdateArgs(id="unknown", content="content")],
            actor_id="editor",
        )

    index.reconcile_children.assert_not_called()
    store.save_children.assert_not_called()


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        (None, SegmentUploadFileNotFoundError),
        ("segments.txt", SegmentInvalidFileTypeError),
    ],
)
def test_batch_import_validates_tenant_scoped_upload(filename: str | None, expected: type[Exception]) -> None:
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    uploads.get_file_name.return_value = filename
    service, _, store, scopes, _, state, dispatcher = _service(uploads=uploads)

    with pytest.raises(expected):
        service.start_batch_import(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            upload_file_id="file-1",
        )

    assert uploads.get_file_name.call_args.kwargs["workspace_id"] == "workspace-1"
    state.set_batch_waiting.assert_not_called()
    dispatcher.dispatch.assert_not_called()


def test_batch_import_requires_dataset_visibility_before_loading_upload() -> None:
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    service, dataset_access, _, scopes, _, state, dispatcher = _service(uploads=uploads)
    dataset_access.check_access.side_effect = DatasetAccessDeniedError()

    with pytest.raises(SegmentPermissionDeniedError):
        service.start_batch_import(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            upload_file_id="file-1",
        )

    assert scopes.get_segment_scope.call_args.kwargs["actor_id"] == "account-1"
    uploads.get_file_name.assert_not_called()
    state.set_batch_waiting.assert_not_called()
    dispatcher.dispatch.assert_not_called()


def test_batch_import_records_status_before_dispatch() -> None:
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    uploads.get_file_name.return_value = "segments.CSV"
    service, _, store, scopes, _, state, dispatcher = _service(uploads=uploads)
    calls: list[str] = []
    state.set_batch_waiting.side_effect = lambda _job_id: calls.append("status")
    dispatcher.dispatch.side_effect = lambda **_kwargs: calls.append("dispatch")

    result = service.start_batch_import(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        upload_file_id="file-1",
    )

    assert result.job_id == "job-1"
    assert calls == ["status", "dispatch"]
    dispatcher.dispatch.assert_called_once_with(
        job_id="job-1",
        upload_file_id="file-1",
        dataset_id="dataset-1",
        document_id="document-1",
        workspace_id="workspace-1",
        actor_id="account-1",
    )


def test_batch_import_translates_dispatch_failure() -> None:
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    uploads.get_file_name.return_value = "segments.csv"
    service, _, store, scopes, _, _, dispatcher = _service(uploads=uploads)
    dispatcher.dispatch.side_effect = RuntimeError("queue down")

    with pytest.raises(SegmentBatchImportDispatchError, match="queue down"):
        service.start_batch_import(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            upload_file_id="file-1",
        )


def test_batch_import_status_distinguishes_unknown_job() -> None:
    service, _, _, scopes, _, state, _ = _service()
    state.get_batch_status.return_value = None
    with pytest.raises(SegmentBatchImportNotFoundError):
        service.get_batch_import_status("missing")

    state.get_batch_status.return_value = "completed"
    assert service.get_batch_import_status("job-1").job_status == "completed"


def test_list_child_chunks_requires_dataset_visibility() -> None:
    service, dataset_access, store, scopes, _, _, _ = _service()
    dataset_access.check_access.side_effect = DatasetAccessDeniedError()
    store.list_child_chunks.return_value = ChildChunkPage(items=(), total=0, total_pages=0, page=1, limit=20)

    with pytest.raises(SegmentPermissionDeniedError):
        service.list_child_chunks(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            query=ChildChunkListFilter(),
        )

    assert scopes.get_segment_scope.call_args.kwargs["actor_id"] == "account-1"
    store.list_child_chunks.assert_not_called()


def test_child_read_and_delete_do_not_require_model_credentials() -> None:
    service, _, store, _, model_guard, _, _ = _service()
    model_guard.check.side_effect = SegmentModelProviderError(kind="token", description="provider unavailable")
    page = ChildChunkPage(items=(), total=0, total_pages=0, page=1, limit=20)
    store.list_child_chunks.return_value = page
    now = datetime(2026, 1, 1)
    store.get_children.return_value = (
        ChildChunkState(
            data=ChildChunkRecord(
                id="child-1",
                segment_id="segment-1",
                content="content",
                position=1,
                word_count=7,
                type="customized",
                created_at=now,
                updated_at=now,
            ),
            index_node_id="child-node-1",
            index_node_hash="hash",
            created_by="account-1",
        ),
    )

    assert (
        service.list_child_chunks(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            query=ChildChunkListFilter(),
        )
        is page
    )
    service.delete_child_chunk(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        child_chunk_id="child-1",
    )

    model_guard.check.assert_not_called()
    store.save_children.assert_called_once()


def test_child_chunk_update_distinguishes_missing_parent_and_child() -> None:
    service, _, store, scopes, _, _, _ = _service()
    store.get_children.return_value = None
    with pytest.raises(SegmentNotFoundError):
        service.update_child_chunk(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            child_chunk_id="child-1",
            content="content",
        )

    store.get_children.return_value = ()
    with pytest.raises(ChildChunkNotFoundError):
        service.update_child_chunk(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            child_chunk_id="child-1",
            content="content",
        )


def _segment_detail(*, enabled: bool = True) -> SegmentDetail:
    return SegmentDetail(
        data=SegmentRecord(
            id="segment-1",
            position=1,
            document_id="document-1",
            content="content",
            sign_content="content",
            answer=None,
            word_count=7,
            tokens=0,
            keywords=None,
            index_node_id=None,
            index_node_hash=None,
            hit_count=0,
            enabled=enabled,
            disabled_at=None,
            disabled_by=None,
            status="completed",
            created_by="account-1",
            created_at=datetime(2026, 1, 1),
            updated_at=datetime(2026, 1, 1),
            updated_by=None,
            indexing_at=None,
            completed_at=None,
            error=None,
            stopped_at=None,
            child_chunks=(),
            attachments=(),
            summary=None,
        ),
        doc_form="text_model",
    )


def test_create_segment_returns_store_detail() -> None:
    service, _, store, scopes, _, _, _ = _service()
    detail = _segment_detail()
    store.get_segment.return_value = detail

    result = service.create_segment(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "content"},
    )

    assert result == detail
    assert store.create_segments.call_args.args[1][0]["created_by"] == _context().account_id


@pytest.mark.parametrize(
    ("doc_form", "values", "message"),
    [
        ("text_model", {"content": "   "}, "Content is empty"),
        ("qa_model", {"content": "question"}, "Answer is required"),
    ],
)
def test_csv_import_uses_public_segment_validation(
    doc_form: str,
    values: dict[str, object],
    message: str,
) -> None:
    service, _, store, _, _, _, _ = _service(_scope(document=replace(_document(), doc_form=doc_form)))

    with pytest.raises(ValueError, match=message):
        service.create_imported_segments(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            values=(values,),
            job_id="job-1",
        )

    store.create_segments.assert_not_called()


@pytest.mark.parametrize(
    ("state", "expected"),
    [
        (SegmentDocumentCreationState("indexing", True), SegmentDocumentNotCompletedError),
        (SegmentDocumentCreationState("completed", False), SegmentDocumentDisabledError),
    ],
)
def test_create_segments_rejects_unavailable_document(
    state: SegmentDocumentCreationState,
    expected: type[Exception],
) -> None:
    service, _, store, _, _, _, _ = _service()
    store.get_document_creation_state.return_value = state

    with pytest.raises(expected):
        service.create_segments(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            values=({"content": "content"},),
        )

    store.create_segments.assert_not_called()


def test_create_segment_rejects_unavailable_document_before_model_check() -> None:
    service, _, store, _, model_guard, _, _ = _service()
    store.get_document_creation_state.return_value = SegmentDocumentCreationState("indexing", True)

    with pytest.raises(SegmentDocumentNotCompletedError):
        service.create_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            values={"content": "content"},
        )

    model_guard.check.assert_not_called()
    store.create_segments.assert_not_called()


def test_create_segments_enforces_request_limit_before_persistence() -> None:
    service, _, store, scopes, _, _, _ = _service()
    store.get_document_creation_state.return_value = SegmentDocumentCreationState("completed", True)

    with pytest.raises(ValueError, match="maximum segments limit"):
        service.create_segments(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            values=tuple({"content": "content"} for _ in range(101)),
        )

    scopes.get_segment_scope.assert_called_once()
    store.create_segments.assert_not_called()


def test_batch_mutation_persists_indexing_intent_without_external_io() -> None:
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    index.count_tokens.return_value = 3
    index.count_tokens_many.side_effect = lambda _dataset, texts: [3] * len(texts)
    store.create_segments.return_value = SegmentDocumentCreationState("completed", True)
    state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    state.lock.return_value = nullcontext()
    mutation = SegmentMutationService(
        store=store,
        index=index,
        text_hash=generate_text_hash,
        indexing_state=state,
    )

    refs = mutation.create_segments(
        SegmentMutationScope(_dataset(), _document()),
        actor_id="account-1",
        args=(SegmentUpdateArgs(content="first"), SegmentUpdateArgs(content="second", keywords=["two"])),
    )

    assert len(refs) == 2
    store.create_segments.assert_called_once()
    values = store.create_segments.call_args.args[1]
    assert [value["content"] for value in values] == ["first", "second"]
    assert [value["tokens"] for value in values] == [3, 3]
    index.create_many.assert_not_called()
    create_kwargs = store.create_segments.call_args.kwargs
    assert create_kwargs["attachment_ids_list"] == [(), ()]
    assert create_kwargs["batch_job_id"] is None
    assert isinstance(create_kwargs["generation"], str)
    assert all(value["status"] == "indexing" for value in values)
    assert all(value["indexing_generation"] == create_kwargs["generation"] for value in values)
    batch_locks = [call.args[0] for call in state.lock.call_args_list]
    assert batch_locks == [
        "knowledge:indexing:dataset:dataset-1",
        "knowledge:indexing:document-retry:document-1",
    ]

    mutation.create_segment(
        SegmentMutationScope(_dataset(), _document()),
        actor_id="account-1",
        args=SegmentUpdateArgs(content="third"),
    )

    assert [call.args[0] for call in state.lock.call_args_list[-2:]] == batch_locks


def test_child_mutation_uses_dataset_then_parent_lock() -> None:
    service, _, store, _, _, state, _ = _service()
    store.get_children.return_value = ()

    service.mutations.create_child_chunk(
        _document().ref.segment("segment-1"),
        content="child",
        actor_id="editor",
    )

    assert [call.args[0] for call in state.lock.call_args_list] == [
        "knowledge:indexing:dataset:dataset-1",
        "knowledge:indexing:document-retry:document-1",
        "knowledge:indexing:segment-mutation:segment-1",
    ]


@pytest.mark.parametrize(
    ("enabled", "indexing", "expected", "message"),
    [
        (False, False, ValueError, "Can't update disabled segment"),
        (True, True, SegmentDocumentIndexingError, "Segment is indexing"),
    ],
)
def test_shared_update_rejects_disabled_or_indexing_segments(
    enabled: bool, indexing: bool, expected: type[Exception], message: str
) -> None:
    service, _, store, _, _, state, _ = _service()
    store.get_segment_update_state.return_value = SegmentUpdateState("content", enabled, None)
    state.is_segment_indexing.return_value = indexing
    with pytest.raises(expected, match=message):
        service.mutations.update_segment(
            SegmentMutationScope(_dataset(), _document()),
            actor_id="editor",
            segment_id="segment-1",
            args=SegmentUpdateArgs(content="changed"),
        )
    store.save_segment.assert_not_called()


def test_parent_update_translates_repository_indexing_guard() -> None:
    service, _, store, _, _, _, _ = _service()
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None)
    store.save_segment.side_effect = SegmentIndexingMutationError("Segment is indexing, please try again later")

    with pytest.raises(SegmentDocumentIndexingError, match="Segment is indexing"):
        service.mutations.update_segment(
            SegmentMutationScope(_dataset(), _document()),
            actor_id="editor",
            segment_id="segment-1",
            args=SegmentUpdateArgs(content="changed"),
        )

    store.save_segment.assert_called_once()


def test_parent_update_rejects_indexing_segment_before_provider_access() -> None:
    service, _, store, _, model_guard, _, _ = _service(_scope(dataset=_dataset(indexing_technique="high_quality")))
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None, status="indexing")

    with pytest.raises(SegmentDocumentIndexingError, match="Segment is indexing"):
        service.update_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
            values={"content": "changed"},
        )

    model_guard.check.assert_not_called()
    store.save_segment.assert_not_called()


@pytest.mark.parametrize("operation", ["create", "batch_update", "delete", "update"])
def test_child_writes_reject_indexing_parent_before_provider_access(operation: str) -> None:
    service, _, store, _, model_guard, _, _ = _service(_scope(dataset=_dataset(indexing_technique="high_quality")))
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None, status="indexing")

    def mutate() -> None:
        if operation == "create":
            service.create_child_chunk(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
                content="child",
            )
        elif operation == "batch_update":
            service.update_child_chunks(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
                chunks=(ChildChunkUpdateArgs(content="child"),),
            )
        elif operation == "delete":
            service.delete_child_chunk(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
                child_chunk_id="child-1",
            )
        else:
            service.update_child_chunk(
                _context(),
                dataset_id="dataset-1",
                document_id="document-1",
                segment_id="segment-1",
                child_chunk_id="child-1",
                content="child",
            )

    with pytest.raises(ChildChunkIndexingApplicationError, match="Segment is indexing"):
        mutate()

    model_guard.check.assert_not_called()
    store.get_children.assert_not_called()
    store.save_children.assert_not_called()


def test_shared_disable_patch_does_not_replace_content() -> None:
    service, _, store, _, _, state, _ = _service()
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None)
    service.mutations.update_segment(
        SegmentMutationScope(_dataset(), _document()),
        actor_id="editor",
        segment_id="segment-1",
        args=SegmentUpdateArgs(enabled=False),
    )
    store.set_segment_status.assert_called_once_with(
        _document().ref,
        ["segment-1"],
        action="disable",
        actor_id="editor",
    )
    store.save_segment.assert_not_called()
    assert state.lock.call_args.args[0] == "knowledge:indexing:segment-status:document-1"
    state.mark_segment_indexing.assert_not_called()
    store.get_segment.assert_not_called()


def test_shared_writes_do_not_build_segment_detail() -> None:
    service, _, store, _, _, _, _ = _service()
    store.get_segment.side_effect = RuntimeError("attachment URL signing unavailable")
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None)
    scope = SegmentMutationScope(_dataset(), _document())

    created = service.mutations.create_segment(scope, actor_id="author", args=SegmentUpdateArgs(content="content"))
    service.mutations.update_segment(
        scope,
        actor_id="editor",
        segment_id=created.segment_id,
        args=SegmentUpdateArgs(content="updated"),
    )

    assert store.create_segments.call_count == 1
    assert store.save_segment.call_count == 1
    assert store.save_segment.call_args.args[1]["content"] == "updated"
    store.get_segment.assert_not_called()
