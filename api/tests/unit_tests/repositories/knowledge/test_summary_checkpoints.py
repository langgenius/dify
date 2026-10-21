from dataclasses import replace

from repositories.knowledge.summary_checkpoints import (
    CurrentSummaryMaterialization,
    SummaryCheckpointIdentity,
    inherit_summary_checkpoints,
    summary_checkpoint_segment_ids,
    summary_content_fingerprint,
)


def _checkpoint(*, document_generation: str = "document-generation-1") -> dict[str, object]:
    return SummaryCheckpointIdentity(
        document_id="document-1",
        document_generation=document_generation,
        segment_generation="segment-generation-1",
        indexing_technique="high_quality",
        embedding_model_provider="provider-1",
        embedding_model="embedding-model-1",
        summary_index_setting={
            "prompt": {"variables": ["content"], "template": "summarize"},
            "enable": True,
        },
        summary_id="summary-1",
        summary_content_fingerprint=summary_content_fingerprint("summary content"),
        vector_node_id="summary-node-1",
        vector_content_hash="summary-hash-1",
    ).to_payload()


def _materialization(
    *,
    document_generation: str = "document-generation-1",
    segment_generation: str = "segment-generation-1",
) -> CurrentSummaryMaterialization:
    return CurrentSummaryMaterialization(
        document_id="document-1",
        document_generation=document_generation,
        segment_generation=segment_generation,
        summary_id="summary-1",
        summary_content_fingerprint=summary_content_fingerprint("summary content"),
        vector_node_id="summary-node-1",
        vector_content_hash="summary-hash-1",
        summary_status="completed",
        summary_enabled=True,
    )


def test_checkpoint_identity_normalizes_configuration_and_segment_order() -> None:
    checkpoint = _checkpoint()
    assert checkpoint["summary_index_setting"] == {
        "enable": True,
        "prompt": {"template": "summarize", "variables": ["content"]},
    }
    payload = {
        "summary_generated_segments": {"segment-2": checkpoint},
        "summary_completed_segments": {"segment-1": checkpoint},
    }
    assert summary_checkpoint_segment_ids(payload) == ("segment-1", "segment-2")


def test_checkpoint_inheritance_requires_current_document_and_segment_generations() -> None:
    checkpoint = _checkpoint()
    payload = {
        "summary_generated_segments": {"segment-1": checkpoint},
        "summary_completed_segments": {"segment-1": checkpoint},
    }
    assert (
        inherit_summary_checkpoints(
            payload,
            expected_indexing_technique="high_quality",
            expected_embedding_model_provider="provider-1",
            expected_embedding_model="embedding-model-1",
            expected_summary_index_setting={
                "enable": True,
                "prompt": {"variables": ["content"], "template": "summarize"},
            },
            document_generation_replacements={},
            current_materializations={"segment-1": _materialization()},
        )
        == payload
    )
    assert (
        inherit_summary_checkpoints(
            payload,
            expected_indexing_technique="high_quality",
            expected_embedding_model_provider="provider-1",
            expected_embedding_model="embedding-model-1",
            expected_summary_index_setting={
                "enable": True,
                "prompt": {"variables": ["content"], "template": "summarize"},
            },
            document_generation_replacements={},
            current_materializations={"segment-1": _materialization(segment_generation="segment-generation-2")},
        )
        == {}
    )


def test_checkpoint_inheritance_validates_resource_after_document_generation_remap() -> None:
    checkpoint = _checkpoint(document_generation="document-generation-old")
    inherited = inherit_summary_checkpoints(
        {"summary_generated_segments": {"segment-1": checkpoint}},
        expected_indexing_technique="high_quality",
        expected_embedding_model_provider="provider-1",
        expected_embedding_model="embedding-model-1",
        expected_summary_index_setting={
            "enable": True,
            "prompt": {"template": "summarize", "variables": ["content"]},
        },
        document_generation_replacements={"document-1": ("document-generation-old", "document-generation-new")},
        current_materializations={"segment-1": _materialization(document_generation="document-generation-new")},
    )
    expected_checkpoint = _checkpoint(document_generation="document-generation-new")
    assert inherited == {"summary_generated_segments": {"segment-1": expected_checkpoint}}


def test_checkpoint_inheritance_rejects_overwritten_summary_content() -> None:
    checkpoint = _checkpoint()
    inherited = inherit_summary_checkpoints(
        {
            "summary_generated_segments": {"segment-1": checkpoint},
            "summary_completed_segments": {"segment-1": checkpoint},
        },
        expected_indexing_technique="high_quality",
        expected_embedding_model_provider="provider-1",
        expected_embedding_model="embedding-model-1",
        expected_summary_index_setting={
            "enable": True,
            "prompt": {"template": "summarize", "variables": ["content"]},
        },
        document_generation_replacements={},
        current_materializations={
            "segment-1": replace(
                _materialization(),
                summary_content_fingerprint=summary_content_fingerprint("model B summary"),
            )
        },
    )
    assert inherited == {}


def test_checkpoint_inheritance_keeps_generated_but_rejects_replaced_vector() -> None:
    checkpoint = _checkpoint()
    current = _materialization()
    inherited = inherit_summary_checkpoints(
        {
            "summary_generated_segments": {"segment-1": checkpoint},
            "summary_completed_segments": {"segment-1": checkpoint},
        },
        expected_indexing_technique="high_quality",
        expected_embedding_model_provider="provider-1",
        expected_embedding_model="embedding-model-1",
        expected_summary_index_setting={
            "enable": True,
            "prompt": {"template": "summarize", "variables": ["content"]},
        },
        document_generation_replacements={},
        current_materializations={
            "segment-1": CurrentSummaryMaterialization(
                document_id=current.document_id,
                document_generation=current.document_generation,
                segment_generation=current.segment_generation,
                summary_id=current.summary_id,
                summary_content_fingerprint=current.summary_content_fingerprint,
                vector_node_id="model-b-node",
                vector_content_hash="model-b-hash",
                summary_status="completed",
                summary_enabled=True,
            )
        },
    )
    assert inherited == {"summary_generated_segments": {"segment-1": checkpoint}}


def test_checkpoint_inheritance_does_not_treat_a_disabled_vector_as_completed() -> None:
    checkpoint = _checkpoint()
    inherited = inherit_summary_checkpoints(
        {
            "summary_generated_segments": {"segment-1": checkpoint},
            "summary_completed_segments": {"segment-1": checkpoint},
        },
        expected_indexing_technique="high_quality",
        expected_embedding_model_provider="provider-1",
        expected_embedding_model="embedding-model-1",
        expected_summary_index_setting={
            "enable": True,
            "prompt": {"template": "summarize", "variables": ["content"]},
        },
        document_generation_replacements={},
        current_materializations={"segment-1": replace(_materialization(), summary_enabled=False)},
    )
    assert inherited == {"summary_generated_segments": {"segment-1": checkpoint}}
