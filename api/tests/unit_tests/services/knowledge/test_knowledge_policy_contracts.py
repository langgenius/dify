"""Pure invariants for additive knowledge policy contracts."""

import pytest

from services.knowledge.datasets.contracts import DatasetVisibility
from services.knowledge.documents.contracts import DocumentBatchCleanupJob, DocumentCleanupJob
from services.knowledge.entities.datasets import DatasetCleanupRecord
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.segments.contracts import (
    SegmentDatasetRecord,
    SegmentDocumentRecord,
    SegmentMutationScope,
)


def test_dataset_visibility_restricts_explicit_whitelist_before_role_grants() -> None:
    visibility = DatasetVisibility(
        workspace_permissions=("dataset.preview", "dataset.create_and_management"),
        overrides={"override": ("dataset.full_access",)},
        unrestricted=False,
        whitelist_ids=("allowed", "allowed"),
    )

    assert visibility.list_scope(rbac_enabled=True) == (["allowed"], False)
    assert visibility.list_scope(rbac_enabled=False) == (None, False)


def test_segment_mutation_scope_rejects_cross_dataset_document() -> None:
    dataset = SegmentDatasetRecord(
        id="dataset",
        workspace_id="workspace",
        indexing_technique="high_quality",
        embedding_model_provider="provider",
        embedding_model="embedding",
    )
    document = SegmentDocumentRecord(
        id="document",
        dataset_id="other-dataset",
        workspace_id="workspace",
        doc_form="text_model",
    )

    with pytest.raises(ValueError, match="does not belong"):
        SegmentMutationScope(dataset=dataset, document=document)


def test_resource_scope_builds_the_complete_owner_chain() -> None:
    dataset = DatasetRef("tenant", "dataset")

    segment = dataset.document("document").segment("segment")

    assert segment.document.dataset == dataset
    assert segment.document.document_id == "document"
    assert segment.segment_id == "segment"


def test_cleanup_contracts_capture_detached_delivery_values() -> None:
    document = DocumentCleanupJob(
        document_id="document",
        dataset_id="dataset",
        doc_form="text_model",
        file_id="source",
    )
    batch = DocumentBatchCleanupJob(
        document_ids=("one", "two"),
        dataset_id="dataset",
        doc_form="text_model",
        file_ids=("source-one", "source-two"),
    )
    dataset = DatasetCleanupRecord(
        id="dataset",
        workspace_id="tenant",
        indexing_technique="high_quality",
        index_struct="text_model",
        collection_binding_id=None,
        doc_form="text_model",
        pipeline_id="pipeline",
    )

    assert document == DocumentCleanupJob("document", "dataset", "text_model", "source")
    assert batch.document_ids == ("one", "two")
    assert batch.file_ids == ("source-one", "source-two")
    assert dataset.workspace_id == "tenant"
    assert dataset.pipeline_id == "pipeline"
