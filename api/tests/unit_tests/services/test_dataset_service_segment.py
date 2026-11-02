from unittest.mock import create_autospec

import pytest
from sqlalchemy.orm import Session

from models.dataset import ChildChunk
from repositories.knowledge.segment_repository import query_child_chunks
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.segments.application import (
    SegmentIndex,
    SegmentIndexingState,
    SegmentMutationService,
    SegmentStore,
    SegmentUploadCatalog,
    validate_segment_update_values,
    validate_segment_values,
)
from services.knowledge.segments.contracts import (
    SegmentDatasetRecord,
    SegmentDocumentRecord,
    SegmentMutationScope,
)


def _identity_hash(value: str) -> str:
    return value


def _child(
    *,
    child_id: str,
    tenant_id: str = "tenant-1",
    dataset_id: str = "dataset-1",
    document_id: str = "document-1",
    segment_id: str = "segment-1",
    position: int = 1,
    content: str = "child content",
) -> ChildChunk:
    child = ChildChunk(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=document_id,
        segment_id=segment_id,
        position=position,
        index_node_id=f"node-{child_id}",
        index_node_hash=f"hash-{child_id}",
        content=content,
        word_count=len(content),
        created_by="actor-1",
    )
    child.id = child_id
    return child


def test_query_child_chunks_scopes_the_complete_owner_chain_and_keyword(sqlite_session: Session) -> None:
    sqlite_session.add_all(
        [
            _child(child_id="first", content="alpha first", position=1),
            _child(child_id="second", content="alpha second", position=2),
            _child(child_id="other-content", content="beta", position=3),
            _child(child_id="other-segment", segment_id="segment-2", content="alpha", position=4),
            _child(child_id="other-document", document_id="document-2", content="alpha", position=5),
            _child(child_id="other-dataset", dataset_id="dataset-2", content="alpha", position=6),
            _child(child_id="other-tenant", tenant_id="tenant-2", content="alpha", position=7),
        ]
    )
    sqlite_session.commit()
    segment_ref = DatasetRef("tenant-1", "dataset-1").document("document-1").segment("segment-1")

    page = query_child_chunks(sqlite_session, segment_ref, page=1, limit=1, keyword="alpha")

    assert page.total == 2
    assert [child.id for child in page.items] == ["first"]


@pytest.mark.parametrize(
    ("values", "doc_form", "message"),
    [
        ({"content": "question"}, "qa_model", "Answer is required"),
        ({"content": "   "}, "text_model", "Content is empty"),
        ({"content": "text", "attachment_ids": "file"}, "text_model", "Attachment IDs is invalid"),
    ],
)
def test_create_validation_uses_the_current_application_contract(
    values: dict[str, object], doc_form: str, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        validate_segment_values(values, doc_form=doc_form, attachment_limit=1)


def test_create_validation_enforces_attachment_limit_at_the_boundary() -> None:
    args = validate_segment_values(
        {"content": "text", "attachment_ids": ["one", "two"]},
        doc_form="text_model",
        attachment_limit=2,
    )
    assert args.attachment_ids == ["one", "two"]

    with pytest.raises(ValueError, match="Exceeded maximum attachment limit of 1"):
        validate_segment_values(
            {"content": "text", "attachment_ids": ["one", "two"]},
            doc_form="text_model",
            attachment_limit=1,
        )


def test_partial_update_validation_does_not_require_omitted_content() -> None:
    args = validate_segment_update_values(
        {"enabled": True},
        doc_form="text_model",
        attachment_limit=1,
    )

    assert args.enabled is True
    assert "content" not in args.model_fields_set


@pytest.mark.parametrize(
    ("document_dataset_id", "document_workspace_id"),
    [("dataset-2", "tenant-1"), ("dataset-1", "tenant-2")],
)
def test_mutation_scope_rejects_a_document_outside_the_dataset(
    document_dataset_id: str, document_workspace_id: str
) -> None:
    dataset = SegmentDatasetRecord("dataset-1", "tenant-1", "high_quality", "provider", "model")
    document = SegmentDocumentRecord(
        "document-1",
        document_dataset_id,
        document_workspace_id,
        "text_model",
    )

    with pytest.raises(ValueError, match="Document does not belong to the dataset"):
        SegmentMutationScope(dataset, document)


def test_batch_index_failure_records_errors_through_the_segment_store() -> None:
    store = create_autospec(SegmentStore, instance=True, spec_set=True)
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    index.create_many.side_effect = RuntimeError("vector unavailable")
    service = SegmentMutationService(
        store=store,
        index=index,
        text_hash=_identity_hash,
        uploads=create_autospec(SegmentUploadCatalog, instance=True, spec_set=True),
        indexing_state=create_autospec(SegmentIndexingState, instance=True, spec_set=True),
    )
    document_ref = DatasetRef("tenant-1", "dataset-1").document("document-1")

    with pytest.raises(RuntimeError, match="vector unavailable"):
        service.index_segments(document_ref, segment_ids=("segment-1", "segment-2"))

    store.set_segments.assert_called_once()
    assert store.set_segments.call_args.args[:2] == (document_ref, ("segment-1", "segment-2"))
    changes = store.set_segments.call_args.args[2]
    assert changes["enabled"] is False
    assert changes["status"] == "error"
    assert changes["error"] == "vector unavailable"


def test_batch_index_rejects_misaligned_keywords_before_external_io() -> None:
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    service = SegmentMutationService(
        store=create_autospec(SegmentStore, instance=True, spec_set=True),
        index=index,
        text_hash=_identity_hash,
        uploads=create_autospec(SegmentUploadCatalog, instance=True, spec_set=True),
        indexing_state=create_autospec(SegmentIndexingState, instance=True, spec_set=True),
    )

    with pytest.raises(ValueError, match="Keywords must correspond"):
        service.index_segments(
            DatasetRef("tenant-1", "dataset-1").document("document-1"),
            segment_ids=("segment-1", "segment-2"),
            keywords_list=(("only-one",),),
        )

    index.create_many.assert_not_called()
