from collections.abc import Generator
from contextlib import contextmanager, nullcontext
from dataclasses import dataclass
from unittest.mock import Mock, create_autospec

import pytest

from libs.helper import generate_text_hash
from machinery.context import RequestContext
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccess,
    DatasetAccessRecord,
    DatasetAccessSnapshot,
)
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.entities.segments import SegmentFileAccess, SegmentReadSnapshot, SegmentUpdateArgs
from services.knowledge.indexing.locks import document_index_lock_name
from services.knowledge.segments.application import (
    DatasetSegmentApplicationService,
    SegmentBatchImportDispatcher,
    SegmentBatchImportNotFoundError,
    SegmentDatasetNotFoundError,
    SegmentDocumentIndexingError,
    SegmentIndex,
    SegmentIndexingState,
    SegmentMutationService,
    SegmentPresenter,
    SegmentScopeReader,
    SegmentStore,
    SegmentUploadCatalog,
)
from services.knowledge.segments.contracts import (
    ChildChunkListFilter,
    ChildChunkPage,
    SegmentDatasetRecord,
    SegmentDetail,
    SegmentDocumentMutationBusyError,
    SegmentDocumentRecord,
    SegmentIndexTarget,
    SegmentListFilter,
    SegmentMutationScope,
    SegmentPageData,
    SegmentScope,
    SegmentStatusState,
    SegmentStatusTransition,
    SegmentUpdateState,
)


@dataclass
class _Limits:
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int = 10
    DATASET_MAX_SEGMENTS_PER_REQUEST: int = 100


class _NoopModelGuard:
    def check(self, dataset: SegmentDatasetRecord) -> None:
        del dataset


@dataclass
class _Fixture:
    service: DatasetSegmentApplicationService
    access: Mock
    store: Mock
    presenter: Mock
    index: Mock
    uploads: Mock
    scopes: Mock
    indexing_state: Mock
    dispatcher: Mock


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _dataset(*, indexing_technique: str = "economy") -> SegmentDatasetRecord:
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


def _access_snapshot() -> DatasetAccessSnapshot:
    return DatasetAccessSnapshot(
        DatasetAccessRecord("dataset-1", "workspace-1", "account-1", "all_team_members"),
        False,
    )


def _scope(
    *,
    dataset: SegmentDatasetRecord | None = None,
    document: SegmentDocumentRecord | None = None,
) -> SegmentScope:
    return SegmentScope(
        dataset=_dataset() if dataset is None else dataset,
        document=_document() if document is None else document,
        access_snapshot=_access_snapshot(),
    )


def _snapshot() -> SegmentReadSnapshot:
    return SegmentReadSnapshot(
        values={},
        child_chunks=(),
        attachments=(),
        summary=None,
        file_access=SegmentFileAccess(frozenset(), frozenset()),
    )


@pytest.fixture
def fixture() -> _Fixture:
    access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    access.check_access.return_value = AccessibleDataset("dataset-1", "workspace-1")
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    presenter = create_autospec(SegmentPresenter, instance=True, spec_set=True)
    presenter.present.side_effect = tuple
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    index.count_tokens_many.side_effect = lambda _dataset, texts: [0] * len(texts)
    uploads = create_autospec(SegmentUploadCatalog, instance=True, spec_set=True)
    scopes = create_autospec(SegmentScopeReader, instance=True, spec_set=True)
    scopes.get_segment_scope.return_value = _scope()
    indexing_state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    indexing_state.lock.return_value = nullcontext()
    indexing_state.is_document_indexing.return_value = False
    indexing_state.is_segment_indexing.return_value = False
    dispatcher = create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True)
    service = DatasetSegmentApplicationService(
        dataset_access=access,
        scopes=scopes,
        store=store,
        presenter=presenter,
        index=index,
        limits=_Limits(),
        text_hash=generate_text_hash,
        uploads=uploads,
        model_guard=_NoopModelGuard(),
        indexing_state=indexing_state,
        batch_dispatcher=dispatcher,
        job_id_factory=lambda: "job-1",
    )
    return _Fixture(service, access, store, presenter, index, uploads, scopes, indexing_state, dispatcher)


def test_list_segments_uses_authorized_owner_scope(fixture: _Fixture) -> None:
    fixture.store.list_segments.return_value = SegmentPageData(items=(), total=0, total_pages=0, page=1, limit=20)
    query = SegmentListFilter(keyword="needle")

    result = fixture.service.list_segments(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        query=query,
    )

    assert result.doc_form == "text_model"
    assert result.items == ()
    fixture.scopes.get_segment_scope.assert_called_once_with(
        dataset_ref=DatasetRef("workspace-1", "dataset-1"),
        document_id="document-1",
        actor_id="account-1",
    )
    fixture.access.check_access.assert_called_once_with(_context(), _access_snapshot())
    fixture.store.list_segments.assert_called_once_with(_document().ref, query)


def test_missing_dataset_stops_before_store_access(fixture: _Fixture) -> None:
    fixture.scopes.get_segment_scope.return_value = SegmentScope(None, None)

    with pytest.raises(SegmentDatasetNotFoundError):
        fixture.service.delete_segment(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id="segment-1",
        )

    fixture.store.get_segments.assert_not_called()


def test_create_segment_validates_and_delegates_to_current_mutation_contract(fixture: _Fixture) -> None:
    mutation = create_autospec(SegmentMutationService, instance=True, spec_set=True)
    fixture.service.mutations = mutation
    segment_ref = _document().ref.segment("segment-1")
    mutation.create_segment.return_value = segment_ref
    fixture.store.get_segment.return_value = SegmentDetail(_snapshot(), "text_model")
    fixture.presenter.present.side_effect = None
    fixture.presenter.present.return_value = ("presented",)

    result = fixture.service.create_segment(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        values={"content": "new content"},
    )

    assert result == SegmentDetail("presented", "text_model")
    assert mutation.create_segment.call_args.args[0].document == _document()
    assert mutation.create_segment.call_args.kwargs["actor_id"] == "account-1"
    assert mutation.create_segment.call_args.kwargs["args"].content == "new content"


def test_create_segments_persists_and_publishes_the_batch_under_the_document_lock(fixture: _Fixture) -> None:
    lock_held = False
    events: list[str] = []

    @contextmanager
    def hold_document_lock() -> Generator[object]:
        nonlocal lock_held
        lock_held = True
        try:
            yield object()
        finally:
            lock_held = False

    fixture.indexing_state.lock.return_value = hold_document_lock()
    fixture.index.count_tokens.return_value = 0
    fixture.store.create_segments.side_effect = lambda *_args: events.append(f"persist:{lock_held}")
    fixture.index.create_many.side_effect = lambda *_args, **_kwargs: events.append(f"publish:{lock_held}")

    refs = fixture.service.mutations.create_segments(
        SegmentMutationScope(_dataset(), _document()),
        actor_id="account-1",
        args=(SegmentUpdateArgs(content="first"), SegmentUpdateArgs(content="second")),
    )

    assert len(refs) == 2
    assert events == ["persist:True", "publish:True"]
    assert len(fixture.store.create_segments.call_args.args[1]) == 2
    fixture.index.create_many.assert_called_once()
    fixture.indexing_state.lock.assert_called_once_with(document_index_lock_name("document-1"), timeout=600)


def test_create_segments_maps_locked_rag_pipeline_state_to_document_indexing_error(fixture: _Fixture) -> None:
    fixture.indexing_state.lock.return_value = nullcontext()
    fixture.index.count_tokens.return_value = 0
    fixture.store.create_segments.side_effect = SegmentDocumentMutationBusyError("Document is being indexed")

    with pytest.raises(SegmentDocumentIndexingError, match="being indexed"):
        fixture.service.mutations.create_segments(
            SegmentMutationScope(_dataset(), _document()),
            actor_id="account-1",
            args=(SegmentUpdateArgs(content="content"),),
        )

    fixture.index.create_many.assert_not_called()


def test_delete_segments_removes_owned_rows_before_cleanup_dispatch(fixture: _Fixture) -> None:
    segments = (SegmentIndexTarget("segment-1", "node-1", True),)
    fixture.store.get_segments.return_value = segments
    fixture.store.get_children_for_segments.return_value = ()
    events: list[str] = []
    fixture.store.delete_segments.side_effect = lambda *_args: events.append("delete_rows")
    fixture.index.delete.side_effect = lambda *_args: events.append("dispatch_cleanup")

    fixture.service.delete_segments(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=("segment-1",),
    )

    assert events == ["delete_rows", "dispatch_cleanup"]
    fixture.index.delete.assert_called_once_with(_document().ref, segments, ())
    fixture.store.delete_segments.assert_called_once_with(_document().ref, ["segment-1"])


def test_delete_segment_removes_owned_row_before_cleanup_dispatch(fixture: _Fixture) -> None:
    segment = SegmentIndexTarget("segment-1", "node-1", True)
    fixture.store.get_segments.return_value = (segment,)
    fixture.store.get_children_for_segments.return_value = ()
    events: list[str] = []
    fixture.store.delete_segments.side_effect = lambda *_args: events.append("delete_rows")
    fixture.index.delete.side_effect = lambda *_args: events.append("dispatch_cleanup")

    fixture.service.delete_segment(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
    )

    assert events == ["delete_rows", "dispatch_cleanup"]
    fixture.store.delete_segments.assert_called_once_with(_document().ref, ("segment-1",))
    fixture.index.delete.assert_called_once_with(_document().ref, (segment,), ())


def test_delete_segment_serializes_owner_removal_with_segment_writers(fixture: _Fixture) -> None:
    segment = SegmentIndexTarget("segment-1", "node-1", True)
    fixture.store.get_segments.return_value = (segment,)
    fixture.store.get_children_for_segments.return_value = ()
    events: list[str] = []

    @contextmanager
    def hold(name: str, *, timeout: int) -> Generator[object]:
        assert timeout == 600
        events.append(f"acquire:{name}")
        try:
            yield object()
        finally:
            events.append(f"release:{name}")

    fixture.indexing_state.lock.side_effect = hold
    fixture.store.delete_segments.side_effect = lambda *_args: events.append("delete_rows")
    fixture.index.delete.side_effect = lambda *_args: events.append("dispatch_cleanup")

    fixture.service.delete_segment(_context(), dataset_id="dataset-1", document_id="document-1", segment_id="segment-1")

    assert events == [
        "acquire:document_document-1_is_retried",
        "acquire:knowledge:indexing:segment-mutation:segment-1",
        "delete_rows",
        "release:knowledge:indexing:segment-mutation:segment-1",
        "release:document_document-1_is_retried",
        "dispatch_cleanup",
    ]


def test_change_status_filters_already_matching_and_indexing_segments(fixture: _Fixture) -> None:
    fixture.store.get_segments.return_value = (
        SegmentIndexTarget("enabled", "node-1", True),
        SegmentIndexTarget("disabled", None, False),
        SegmentIndexTarget("busy", "node-2", True),
    )
    fixture.indexing_state.is_segment_indexing.side_effect = lambda segment_id: segment_id == "busy"
    previous = SegmentStatusState("enabled", True, None, None, None)
    applied = SegmentStatusState("enabled", False, None, "account-1", None)
    fixture.store.stage_segment_status.return_value = (SegmentStatusTransition(previous, applied),)

    fixture.service.change_segment_status(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=("enabled", "disabled", "busy"),
        action="disable",
    )

    fixture.store.stage_segment_status.assert_called_once_with(
        _document().ref,
        ("enabled", "disabled"),
        action="disable",
        actor_id="account-1",
    )
    fixture.index.change_status.assert_called_once_with(_document().ref, ("enabled",), "disable")


def test_batch_import_uses_scoped_upload_and_current_dispatch_contract(fixture: _Fixture) -> None:
    fixture.uploads.get_file_name.return_value = "segments.csv"

    result = fixture.service.start_batch_import(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        upload_file_id="file-1",
    )

    assert (result.job_id, result.job_status) == ("job-1", "waiting")
    fixture.scopes.get_segment_scope.assert_called_once_with(
        dataset_ref=DatasetRef("workspace-1", "dataset-1"),
        document_id="document-1",
        actor_id="account-1",
    )
    fixture.access.check_access.assert_called_once_with(_context(), _access_snapshot())
    fixture.indexing_state.set_batch_waiting.assert_called_once_with("job-1")
    fixture.dispatcher.dispatch.assert_called_once_with(
        job_id="job-1",
        upload_file_id="file-1",
        dataset_id="dataset-1",
        document_id="document-1",
        workspace_id="workspace-1",
        actor_id="account-1",
    )


def test_unknown_batch_import_status_is_distinct(fixture: _Fixture) -> None:
    fixture.indexing_state.get_batch_status.return_value = None

    with pytest.raises(SegmentBatchImportNotFoundError):
        fixture.service.get_batch_import_status("missing")


def test_list_child_chunks_uses_owner_scope_without_actor(fixture: _Fixture) -> None:
    query = ChildChunkListFilter(page=2, limit=10)
    expected = ChildChunkPage(items=(), total=0, total_pages=0, page=2, limit=10)
    fixture.store.list_child_chunks.return_value = expected

    result = fixture.service.list_child_chunks(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        query=query,
    )

    assert result == expected
    fixture.scopes.get_segment_scope.assert_called_once_with(
        dataset_ref=DatasetRef("workspace-1", "dataset-1"),
        document_id="document-1",
        actor_id=None,
    )
    fixture.store.list_child_chunks.assert_called_once_with(_document().ref.segment("segment-1"), query)


def test_segment_input_failure_keeps_previous_publication(fixture: _Fixture) -> None:
    from services.errors.file import UploadFileReferenceNotFoundError

    fixture.store.get_segment_update_state.return_value = SegmentUpdateState("previous", True, None)
    fixture.store.save_segment.side_effect = UploadFileReferenceNotFoundError(["missing"])
    fixture.index.count_tokens.return_value = 0
    with pytest.raises(UploadFileReferenceNotFoundError):
        fixture.service.mutations.update_segment(
            SegmentMutationScope(_dataset(), _document()),
            actor_id="account-1",
            segment_id="segment-1",
            args=SegmentUpdateArgs(content="changed"),
        )
    assert fixture.store.save_segment.call_count == 1
    fixture.index.update.assert_not_called()


def test_child_input_failure_precedes_all_vector_io(fixture: _Fixture) -> None:
    from services.errors.file import UploadFileReferenceNotFoundError

    fixture.store.get_children.return_value = ()
    fixture.store.child_mutation.side_effect = UploadFileReferenceNotFoundError(["missing"])
    with pytest.raises(UploadFileReferenceNotFoundError):
        fixture.service.mutations.create_child_chunk(
            _document().ref.segment("segment-1"),
            content="invalid file reference",
            actor_id="account-1",
        )
    fixture.index.update_children.assert_not_called()
    fixture.store.save_children.assert_not_called()


def test_child_commit_failure_restores_previous_vectors(fixture: _Fixture) -> None:
    fixture.store.get_children.return_value = ()

    @contextmanager
    def fail_commit() -> Generator[None]:
        yield
        raise RuntimeError("commit rolled back")

    fixture.store.child_mutation.return_value = fail_commit()
    from services.knowledge.segments.application import ChildChunkIndexingApplicationError

    with pytest.raises(ChildChunkIndexingApplicationError):
        fixture.service.mutations.create_child_chunk(
            _document().ref.segment("segment-1"),
            content="new",
            actor_id="account-1",
        )
    assert fixture.index.update_children.call_count == 2
    published = fixture.index.update_children.call_args_list[0].kwargs["added"]
    assert fixture.index.update_children.call_args_list[1].kwargs["deleted"] == published
