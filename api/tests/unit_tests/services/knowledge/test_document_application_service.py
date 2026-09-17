from dataclasses import replace
from typing import Literal
from unittest.mock import MagicMock, create_autospec

import pytest

from machinery.context import RequestContext
from services.knowledge.dataset_access import AccessibleDataset, DatasetAccess, DatasetAccessDeniedError
from services.knowledge.documents.application import (
    DatasetDocumentApplicationService,
    DocumentArchivedError,
    DocumentIndexingStateError,
    DocumentInvalidActionError,
    DocumentNotFoundError,
    DocumentOperations,
    DocumentState,
)
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request-1", None, "actor-1", "tenant-1")
DATASET = DatasetRef("tenant-1", "dataset-1")
DOCUMENT = DATASET.document("document-1")
STATE = DocumentState("document-1", False, "indexing", False, "website_crawl", "text_model", False)


@pytest.fixture
def operations() -> MagicMock:
    result = create_autospec(DocumentOperations, instance=True, spec_set=True)
    result.get_state.return_value = STATE
    return result


@pytest.fixture
def access() -> MagicMock:
    result = create_autospec(DatasetAccess, instance=True, spec_set=True)
    result.require_accessible.return_value = AccessibleDataset("dataset-1", "tenant-1")
    return result


@pytest.fixture
def service(access: MagicMock, operations: MagicMock) -> DatasetDocumentApplicationService:
    return DatasetDocumentApplicationService(
        dataset_access=access, operations=operations, metadata_schema={"book": {"title": str}, "others": {}}
    )


@pytest.mark.parametrize(
    "operation", ["get_document", "delete_document", "pause_document", "recover_document", "sync_website"]
)
def test_denied_dataset_never_loads_or_mutates_documents(
    service: DatasetDocumentApplicationService, access: MagicMock, operations: MagicMock, operation: str
) -> None:
    access.require_accessible.side_effect = DatasetAccessDeniedError()
    with pytest.raises(DatasetAccessDeniedError):
        getattr(service, operation)(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    assert operations.mock_calls == []


@pytest.mark.parametrize(
    "operation", ["get_document", "delete_document", "pause_document", "recover_document", "sync_website"]
)
def test_missing_document_stops_before_any_side_effect(
    service: DatasetDocumentApplicationService, access: MagicMock, operations: MagicMock, operation: str
) -> None:
    operations.get_state.return_value = None
    with pytest.raises(DocumentNotFoundError):
        getattr(service, operation)(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    access.require_accessible.assert_called_once_with(CONTEXT, "dataset-1")
    operations.get_state.assert_called_once_with(DOCUMENT)
    assert len(operations.mock_calls) == 1


@pytest.mark.parametrize("operation", ["pause_document", "recover_document", "sync_website"])
def test_archived_documents_cannot_be_reprocessed(
    service: DatasetDocumentApplicationService, operations: MagicMock, operation: str
) -> None:
    operations.get_state.return_value = replace(STATE, archived=True)
    with pytest.raises(DocumentArchivedError):
        getattr(service, operation)(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    assert len(operations.mock_calls) == 1


@pytest.mark.parametrize(
    ("action", "status", "paused"),
    [("pause", "indexing", True), ("resume", "paused", False), ("resume", "error", False)],
)
def test_processing_transition_records_explicit_actor(
    service: DatasetDocumentApplicationService,
    operations: MagicMock,
    action: Literal["pause", "resume"],
    status: str,
    paused: bool,
) -> None:
    operations.get_state.return_value = replace(STATE, indexing_status=status)
    service.update_processing(CONTEXT, dataset_id="dataset-1", document_id="document-1", action=action)
    ref, values = operations.update_document.call_args.args
    assert ref == DOCUMENT
    assert values["is_paused"] is paused
    assert values["paused_by"] == (CONTEXT.account_id if paused else None)
    assert (values["paused_at"] is not None) is paused


@pytest.mark.parametrize(
    ("action", "status"), [("pause", "completed"), ("resume", "indexing"), ("invalid", "indexing")]
)
def test_invalid_processing_transition_does_not_write(
    service: DatasetDocumentApplicationService, operations: MagicMock, action: Literal["pause", "resume"], status: str
) -> None:
    operations.get_state.return_value = replace(STATE, indexing_status=status)
    with pytest.raises(DocumentInvalidActionError):
        service.update_processing(CONTEXT, dataset_id="dataset-1", document_id="document-1", action=action)
    operations.update_document.assert_not_called()


@pytest.mark.parametrize(
    ("doc_type", "expected"), [("book", {"title": "Title"}), ("others", {"title": "Title", "unknown": 12})]
)
def test_metadata_policy_filters_schema_but_preserves_custom_fields(
    service: DatasetDocumentApplicationService, operations: MagicMock, doc_type: str | None, expected: dict[str, object]
) -> None:
    service.update_metadata(
        CONTEXT,
        dataset_id="dataset-1",
        document_id="document-1",
        doc_type=doc_type,
        doc_metadata={"title": "Title", "unknown": 12},
    )
    ref, values = operations.update_document.call_args.args
    assert ref == DOCUMENT
    assert values["doc_metadata"] == expected
    assert values["doc_type"] == doc_type


@pytest.mark.parametrize(("doc_type", "metadata"), [(None, {}), ("book", None), ("invalid", {})])
def test_invalid_metadata_never_writes(
    service: DatasetDocumentApplicationService,
    operations: MagicMock,
    doc_type: str | None,
    metadata: dict[str, object] | None,
) -> None:
    with pytest.raises(ValueError):
        service.update_metadata(
            CONTEXT, dataset_id="dataset-1", document_id="document-1", doc_type=doc_type, doc_metadata=metadata
        )
    operations.update_document.assert_not_called()


def test_retry_filters_missing_archived_completed_and_duplicate_documents(
    service: DatasetDocumentApplicationService, operations: MagicMock
) -> None:
    operations.get_states.return_value = [
        replace(STATE, id="error", indexing_status="error"),
        replace(STATE, id="archived", archived=True),
        replace(STATE, id="completed", indexing_status="completed"),
    ]
    service.retry_documents(
        CONTEXT, dataset_id="dataset-1", document_ids=["archived", "missing", "error", "error", "completed"]
    )
    operations.retry_documents.assert_called_once_with(DATASET, ["error"], actor_id="actor-1")


def test_summary_skips_qa_and_enables_summary_before_dispatch(
    service: DatasetDocumentApplicationService, operations: MagicMock
) -> None:
    operations.get_states.return_value = [
        STATE,
        replace(STATE, id="qa", doc_form="qa_model"),
        replace(STATE, id="ready", need_summary=True),
    ]
    service.generate_summary(CONTEXT, dataset_id="dataset-1", document_ids=["document-1", "qa", "ready"])
    operations.enable_summary.assert_called_once_with(DATASET, ["document-1"])
    assert [call.args[0] for call in operations.dispatch_summary.call_args_list] == [
        DOCUMENT,
        DATASET.document("ready"),
    ]
    names = [call[0] for call in operations.mock_calls]
    assert names.index("enable_summary") < names.index("dispatch_summary")


def test_summary_missing_document_cannot_partially_schedule(
    service: DatasetDocumentApplicationService, operations: MagicMock
) -> None:
    operations.get_states.return_value = [STATE]
    with pytest.raises(DocumentNotFoundError, match="missing"):
        service.generate_summary(CONTEXT, dataset_id="dataset-1", document_ids=["document-1", "missing"])
    operations.enable_summary.assert_not_called()
    operations.dispatch_summary.assert_not_called()


def test_process_rule_resolves_document_inside_active_workspace(
    service: DatasetDocumentApplicationService, operations: MagicMock, access: MagicMock
) -> None:
    operations.find_document.return_value = DOCUMENT
    service.get_process_rule(CONTEXT, document_id="document-1")
    operations.find_document.assert_called_once_with(workspace_id="tenant-1", document_id="document-1")
    access.require_accessible.assert_called_once_with(CONTEXT, "dataset-1")
    operations.get_process_rule.assert_called_once_with(DATASET)


def test_default_process_rule_does_not_load_a_dataset(
    service: DatasetDocumentApplicationService, operations: MagicMock, access: MagicMock
) -> None:
    service.get_process_rule(CONTEXT, document_id=None)
    access.require_accessible.assert_not_called()
    operations.get_process_rule.assert_called_once_with(None)


def test_pause_requires_indexing_state_and_recover_requires_pause(
    service: DatasetDocumentApplicationService, operations: MagicMock
) -> None:
    operations.get_state.return_value = replace(STATE, indexing_status="completed")
    with pytest.raises(DocumentIndexingStateError):
        service.pause_document(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    with pytest.raises(DocumentIndexingStateError):
        service.recover_document(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    operations.pause_document.assert_not_called()
    operations.recover_document.assert_not_called()


def test_website_sync_rejects_other_sources(service: DatasetDocumentApplicationService, operations: MagicMock) -> None:
    operations.get_state.return_value = replace(STATE, data_source_type="upload_file")
    with pytest.raises(ValueError, match="not a website"):
        service.sync_website(CONTEXT, dataset_id="dataset-1", document_id="document-1")
    operations.sync_website.assert_not_called()
