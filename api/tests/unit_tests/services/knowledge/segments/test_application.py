from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import generate_text_hash
from machinery.context import RequestContext
from models.dataset import DocumentSegment
from models.enums import SegmentStatus
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.dataset_access import (
    AccessibleDataset,
    DatasetAccess,
    DatasetAccessDeniedError,
    DatasetAccessRecord,
    DatasetAccessSnapshot,
)
from services.knowledge.entities.segments import SegmentRecord, SegmentUpdateArgs
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.segments.application import (
    ChildChunkNotFoundError,
    DatasetSegmentApplicationService,
    SegmentBatchImportDispatcher,
    SegmentBatchImportDispatchError,
    SegmentBatchImportNotFoundError,
    SegmentDatasetModelUnavailableError,
    SegmentDatasetNotFoundError,
    SegmentDatasetRecord,
    SegmentDetail,
    SegmentDocumentIndexingError,
    SegmentDocumentNotFoundError,
    SegmentDocumentRecord,
    SegmentEmbeddingModelUnavailableError,
    SegmentIndex,
    SegmentIndexingState,
    SegmentIndexTarget,
    SegmentInvalidFileTypeError,
    SegmentListFilter,
    SegmentModelGuard,
    SegmentModelProviderError,
    SegmentMutationScope,
    SegmentNotFoundError,
    SegmentPage,
    SegmentPermissionDeniedError,
    SegmentScope,
    SegmentScopeReader,
    SegmentStatusUpdateError,
    SegmentStore,
    SegmentUpdateState,
    SegmentUploadCatalog,
    SegmentUploadFileNotFoundError,
)


@dataclass
class SegmentLimitsStub:
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int = 10


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


def _service(scope: SegmentScope | None = None, *, uploads: SegmentUploadCatalog | None = None) -> ServiceFixture:
    dataset_access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    dataset_access.check_access.return_value = AccessibleDataset(id="dataset-1", workspace_id="workspace-1")
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    scopes = create_autospec(SegmentScopeReader, instance=True, spec_set=True)
    scopes.get_segment_scope.return_value = scope or _scope()
    model_guard = create_autospec(SegmentModelGuard, instance=True, spec_set=True)
    indexing_state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    indexing_state.is_document_indexing.return_value = False
    indexing_state.is_segment_indexing.return_value = False
    dispatcher = create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True)
    service = DatasetSegmentApplicationService(
        dataset_access=dataset_access,
        store=store,
        limits=SegmentLimitsStub(),
        text_hash=generate_text_hash,
        index=create_autospec(SegmentIndex, instance=True, spec_set=True),
        uploads=uploads or create_autospec(SegmentUploadCatalog, instance=True, spec_set=True),
        scopes=scopes,
        model_guard=model_guard,
        indexing_state=indexing_state,
        batch_dispatcher=dispatcher,
        job_id_factory=lambda: "job-1",
    )
    return service, dataset_access, store, scopes, model_guard, indexing_state, dispatcher


def _service_with_index() -> tuple[DatasetSegmentApplicationService, Mock, Mock]:
    dataset_access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    dataset_access.check_access.return_value = AccessibleDataset(id="dataset-1", workspace_id="workspace-1")
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    scopes = create_autospec(SegmentScopeReader, instance=True, spec_set=True)
    scopes.get_segment_scope.return_value = _scope()
    indexing_state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    indexing_state.is_document_indexing.return_value = False
    indexing_state.is_segment_indexing.return_value = False
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    service = DatasetSegmentApplicationService(
        dataset_access=dataset_access,
        store=store,
        limits=SegmentLimitsStub(),
        text_hash=generate_text_hash,
        index=index,
        uploads=create_autospec(SegmentUploadCatalog, instance=True, spec_set=True),
        scopes=scopes,
        model_guard=create_autospec(SegmentModelGuard, instance=True, spec_set=True),
        indexing_state=indexing_state,
        batch_dispatcher=create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True),
        job_id_factory=lambda: "job-1",
    )
    return service, store, index


def test_list_segments_uses_complete_owner_scope() -> None:
    service, dataset_access, store, scopes, _, _, _ = _service()
    expected = SegmentPage(items=(), total=0, total_pages=0, page=1, limit=20)
    store.list_segments.return_value = expected

    result = service.list_segments(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        query=SegmentListFilter(keyword="needle"),
    )

    assert result is expected
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


def _service_with_real_store(
    sqlite_session_factory: sessionmaker[Session],
) -> tuple[DatasetSegmentApplicationService, Mock]:
    """Wire the application service to the real SQLAlchemy store over a SQLite session."""
    dataset_access = create_autospec(DatasetAccess, instance=True, spec_set=True)
    dataset_access.check_access.return_value = AccessibleDataset(id="dataset-1", workspace_id="workspace-1")
    store = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    scopes = create_autospec(SegmentScopeReader, instance=True, spec_set=True)
    scopes.get_segment_scope.return_value = _scope()
    indexing_state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    indexing_state.is_document_indexing.return_value = False
    indexing_state.is_segment_indexing.return_value = False
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    service = DatasetSegmentApplicationService(
        dataset_access=dataset_access,
        store=store,
        limits=SegmentLimitsStub(),
        text_hash=generate_text_hash,
        index=index,
        uploads=create_autospec(SegmentUploadCatalog, instance=True, spec_set=True),
        scopes=scopes,
        model_guard=create_autospec(SegmentModelGuard, instance=True, spec_set=True),
        indexing_state=indexing_state,
        batch_dispatcher=create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True),
        job_id_factory=lambda: "job-1",
    )
    return service, index


def _sqlite_segment(
    segment_id: str,
    *,
    workspace_id: str = "workspace-1",
    enabled: bool = True,
    disabled_at: datetime | None = None,
    disabled_by: str | None = None,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=workspace_id,
        dataset_id="dataset-1",
        document_id="document-1",
        position=1,
        content="content",
        word_count=7,
        tokens=2,
        created_by="account-1",
        index_node_id="node-1",
        index_node_hash="hash-1",
        status=SegmentStatus.COMPLETED,
        enabled=enabled,
        disabled_at=disabled_at,
        disabled_by=disabled_by,
    )
    segment.id = segment_id
    return segment


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


def test_status_change_persists_state_before_dispatching() -> None:
    service, store, index = _service_with_index()
    store.get_segments.return_value = (SegmentIndexTarget(id="segment-1", index_node_id="node-1", enabled=True),)
    calls: list[str] = []
    index.change_status.side_effect = lambda *args, **kwargs: calls.append("dispatch")
    store.set_segments.side_effect = lambda *args, **kwargs: calls.append("persist")

    service.change_segment_status(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=["segment-1"],
        action="disable",
    )

    assert calls == ["persist", "dispatch"]
    store.set_segments.assert_called_once()
    persisted_ids, persisted_values = store.set_segments.call_args[0][1:3]
    assert persisted_ids == ["segment-1"]
    assert persisted_values["enabled"] is False
    index.change_status.assert_called_once()


def test_status_change_persists_state_when_dispatch_fails() -> None:
    """With the restored persist-then-schedule order the remaining failure window is a
    dispatch failure after the state was committed: the desired status stays persisted
    and the error is translated for the caller, so an explicit retry can reconcile."""
    service, store, index = _service_with_index()
    store.get_segments.return_value = (SegmentIndexTarget(id="segment-1", index_node_id="node-1", enabled=False),)
    index.change_status.side_effect = RuntimeError("broker unavailable")

    with pytest.raises(SegmentStatusUpdateError, match="broker unavailable"):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=["segment-1"],
            action="enable",
        )

    store.set_segments.assert_called_once()
    persisted_ids, persisted_values = store.set_segments.call_args[0][1:3]
    assert persisted_ids == ["segment-1"]
    assert persisted_values["enabled"] is True
    index.change_status.assert_called_once()


def test_status_change_retry_after_dispatch_failure_reconciles_index() -> None:
    """A retry whose persisted status already matches still re-dispatches the index
    change so a previous failed dispatch cannot leave DB state and the retrieval
    index permanently out of sync."""
    service, store, index = _service_with_index()
    store.get_segments.return_value = (SegmentIndexTarget(id="segment-1", index_node_id="node-1", enabled=False),)
    index.change_status.side_effect = RuntimeError("broker unavailable")

    with pytest.raises(SegmentStatusUpdateError):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=["segment-1"],
            action="enable",
        )
    assert store.set_segments.called
    assert index.change_status.call_count == 1

    index.change_status.side_effect = None
    store.get_segments.return_value = (SegmentIndexTarget(id="segment-1", index_node_id="node-1", enabled=True),)
    service.change_segment_status(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=["segment-1"],
        action="enable",
    )

    assert index.change_status.call_count == 2
    assert index.change_status.call_args[0][1] == ["segment-1"]
    assert index.change_status.call_args[0][2] == "enable"
    assert store.set_segments.call_count == 1


def test_status_change_broker_failure_for_matching_batch_is_translated() -> None:
    """A dispatch failure is surfaced even when every requested segment already matches
    the requested status,     instead of being swallowed as a no-op."""
    service, store, index = _service_with_index()
    store.get_segments.return_value = (SegmentIndexTarget(id="segment-1", index_node_id="node-1", enabled=True),)
    index.change_status.side_effect = RuntimeError("broker unavailable")

    with pytest.raises(SegmentStatusUpdateError, match="broker unavailable"):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=["segment-1"],
            action="enable",
        )

    store.set_segments.assert_not_called()
    index.change_status.assert_called_once_with(_document().ref, ["segment-1"], "enable")


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("batch", ["single", "mixed"], ids=["single", "mixed-batch"])
def test_status_change_persists_changes_and_dispatches_full_scope(
    action: Literal["enable", "disable"],
    batch: Literal["single", "mixed"],
) -> None:
    """Persistence covers only actual status changes while the dispatch covers every
    non-indexing segment in scope; foreign ids never reach either call."""
    service, store, index = _service_with_index()
    targets = [
        SegmentIndexTarget(id="segment-1", index_node_id="node-1", enabled=action != "enable"),
        SegmentIndexTarget(id="already-target", index_node_id="node-2", enabled=action == "enable"),
    ]
    store.get_segments.return_value = tuple(targets) if batch == "mixed" else tuple(targets[:1])
    requested_ids = ["segment-1", "already-target", "foreign"] if batch == "mixed" else ["segment-1", "foreign"]

    service.change_segment_status(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=requested_ids,
        action=action,
    )

    store.set_segments.assert_called_once()
    persisted_ids, persisted_values = store.set_segments.call_args[0][1:3]
    assert persisted_ids == ["segment-1"]
    assert persisted_values["enabled"] == (action == "enable")
    if action == "disable":
        assert persisted_values["disabled_by"] == "account-1"
        assert persisted_values["disabled_at"] is not None
    else:
        assert persisted_values["disabled_at"] is None
        assert persisted_values["disabled_by"] is None

    index.change_status.assert_called_once()
    dispatched_ref, dispatched_ids, dispatched_action = index.change_status.call_args[0]
    assert dispatched_ref == _document().ref
    assert dispatched_action == action
    assert set(dispatched_ids) == {"segment-1"} | ({"already-target"} if batch == "mixed" else set())
    assert "foreign" not in dispatched_ids


@pytest.mark.parametrize("action", ["enable", "disable"])
@pytest.mark.parametrize("batch", ["single", "mixed"], ids=["single", "mixed-batch"])
def test_status_retry_reconciles_index_with_sqlite_persistence(
    sqlite_session_factory: sessionmaker[Session],
    action: Literal["enable", "disable"],
    batch: Literal["single", "mixed"],
) -> None:
    """End-to-end retry over a real SQLite session: a failed dispatch leaves the desired
    status persisted, the retry re-enqueues the index task for every non-indexing
    segment in scope (skipping out-of-scope ids) and never rewrites audit metadata."""
    service, index = _service_with_real_store(sqlite_session_factory)
    previous_disabled_at = datetime(2025, 1, 1)
    previous_disabled_by = "previous-editor"
    with sqlite_session_factory.begin() as session:
        session.add(
            _sqlite_segment(
                "segment-1",
                enabled=action != "enable",
                disabled_at=previous_disabled_at,
                disabled_by=previous_disabled_by,
            )
        )
        session.add(_sqlite_segment("foreign", workspace_id="workspace-2", enabled=action != "enable"))
        if batch == "mixed":
            session.add(
                _sqlite_segment(
                    "already-target",
                    enabled=action == "enable",
                    disabled_at=previous_disabled_at,
                    disabled_by=previous_disabled_by,
                )
            )

    requested_ids = ["segment-1", "foreign"] + (["already-target"] if batch == "mixed" else [])
    expected_ids = {"segment-1"} | ({"already-target"} if batch == "mixed" else set())
    index.change_status.side_effect = RuntimeError("broker unavailable")

    with pytest.raises(SegmentStatusUpdateError, match="broker unavailable"):
        service.change_segment_status(
            _context(),
            dataset_id="dataset-1",
            document_id="document-1",
            segment_ids=requested_ids,
            action=action,
        )

    assert index.change_status.call_count == 1
    assert set(index.change_status.call_args[0][1]) == expected_ids
    with sqlite_session_factory() as session:
        target = session.get(DocumentSegment, "segment-1")
        assert target is not None
        assert target.enabled == (action == "enable")
        if action == "disable":
            assert target.disabled_by == "account-1"
            assert target.disabled_at is not None
        else:
            assert (target.disabled_at, target.disabled_by) == (None, None)
        target_audit = (target.disabled_at, target.disabled_by)

    index.change_status.side_effect = None
    service.change_segment_status(
        _context(),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_ids=requested_ids,
        action=action,
    )

    assert index.change_status.call_count == 2
    assert index.change_status.call_args[0][0] == _document().ref
    assert set(index.change_status.call_args[0][1]) == expected_ids
    assert index.change_status.call_args[0][2] == action
    with sqlite_session_factory() as session:
        target = session.get(DocumentSegment, "segment-1")
        assert target is not None
        assert (target.disabled_at, target.disabled_by) == target_audit
        foreign = session.get(DocumentSegment, "foreign")
        assert foreign is not None
        assert foreign.enabled == (action != "enable")
        if batch == "mixed":
            matched = session.get(DocumentSegment, "already-target")
            assert matched is not None
            assert matched.enabled == (action == "enable")
            assert (matched.disabled_at, matched.disabled_by) == (previous_disabled_at, previous_disabled_by)


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

    assert result is detail
    assert store.save_segment.call_args.args[1]["created_by"] == _context().account_id


@pytest.mark.parametrize(
    ("enabled", "indexing", "message"),
    [(False, False, "Can't update disabled segment"), (True, True, "Segment is indexing")],
)
def test_shared_update_rejects_disabled_or_indexing_segments(enabled: bool, indexing: bool, message: str) -> None:
    service, _, store, _, _, state, _ = _service()
    store.get_segment_update_state.return_value = SegmentUpdateState("content", enabled, None, None)
    state.is_segment_indexing.return_value = indexing
    with pytest.raises(ValueError, match=message):
        service.mutations.update_segment(
            SegmentMutationScope(_dataset(), _document()),
            actor_id="editor",
            segment_id="segment-1",
            args=SegmentUpdateArgs(content="changed"),
        )
    store.save_segment.assert_not_called()


def test_shared_disable_patch_does_not_replace_content() -> None:
    service, _, store, _, _, state, _ = _service()
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None, None)
    service.mutations.update_segment(
        SegmentMutationScope(_dataset(), _document()),
        actor_id="editor",
        segment_id="segment-1",
        args=SegmentUpdateArgs(enabled=False),
    )
    changes = store.save_segment.call_args.args[1]
    assert changes["enabled"] is False
    assert changes["disabled_by"] == "editor"
    assert "content" not in changes
    state.mark_segment_indexing.assert_called_once_with("segment-1")
    store.get_segment.assert_not_called()


def test_shared_writes_do_not_build_segment_detail() -> None:
    service, _, store, _, _, _, _ = _service()
    store.get_segment.side_effect = RuntimeError("attachment URL signing unavailable")
    store.get_segment_update_state.return_value = SegmentUpdateState("content", True, None, None)
    scope = SegmentMutationScope(_dataset(), _document())

    created = service.mutations.create_segment(scope, actor_id="author", args=SegmentUpdateArgs(content="content"))
    service.mutations.update_segment(
        scope,
        actor_id="editor",
        segment_id=created.segment_id,
        args=SegmentUpdateArgs(content="updated"),
    )

    assert store.save_segment.call_count == 2
    assert store.save_segment.call_args.args[1]["content"] == "updated"
    store.get_segment.assert_not_called()
