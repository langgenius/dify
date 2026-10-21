"""Pure invariants for additive knowledge policy contracts."""

import pytest

from services.knowledge.datasets.contracts import DatasetVisibility
from services.knowledge.entities.pipeline_workflows import PipelineInvocationScope
from services.knowledge.indexing.cleanup import (
    DeletionIndexCleanup,
    DocumentCleanupManifest,
    SegmentAttachmentCleanup,
    UploadFileCleanup,
)
from services.knowledge.resource_scope import DatasetRef
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


@pytest.mark.parametrize(
    ("dataset_id", "pipeline_id"),
    [(None, None), ("dataset", "pipeline")],
)
def test_pipeline_invocation_scope_requires_one_resource(dataset_id: str | None, pipeline_id: str | None) -> None:
    with pytest.raises(ValueError, match="Exactly one"):
        PipelineInvocationScope(
            workspace_id="workspace",
            actor_id="actor",
            dataset_id=dataset_id,
            pipeline_id=pipeline_id,
        )


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


def test_cleanup_contracts_round_trip_detached_payloads() -> None:
    manifest = DocumentCleanupManifest(
        document_files=(UploadFileCleanup(id="source", key="files/source"),),
        image_files=(UploadFileCleanup(id="image", key=None),),
        segment_attachments=(
            SegmentAttachmentCleanup(binding_id="binding", attachment_id="attachment", key="files/attachment"),
        ),
    )
    index_cleanup = DeletionIndexCleanup(
        tenant_id="tenant",
        dataset_id="dataset",
        indexing_technique="high_quality",
        index_struct="text_model",
        collection_binding_id=None,
        embedding_model_provider="provider",
        embedding_model="embedding",
        vector_type="vector",
        delete_all=False,
        vector_node_ids=("one", "two"),
        keyword_node_ids=("one",),
    )

    assert DocumentCleanupManifest.from_payload(manifest.to_payload()) == manifest
    assert DeletionIndexCleanup.from_payload(index_cleanup.to_payload()) == index_cleanup
    assert manifest.segment_attachments[0].file == UploadFileCleanup(
        id="attachment",
        key="files/attachment",
    )
