from datetime import UTC, datetime

from controllers.openapi.datasets import _dataset_row, _document_row, _indexing_status


def _dataset(**extra: object) -> dict[str, object]:
    return {
        "id": "ds-1",
        "name": "Docs",
        "description": "desc",
        "provider": "vendor",
        "permission": "only_me",
        "indexing_technique": "high_quality",
        "embedding_model": "text-embedding-3-small",
        "embedding_model_provider": "openai",
        "retrieval_model_dict": {"search_method": "semantic_search"},
        "external_knowledge_info": {},
        "created_at": datetime(2025, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2025, 1, 2, tzinfo=UTC),
        **extra,
    }


def _document(**extra: object) -> dict[str, object]:
    return {
        "id": "doc-1",
        "name": "guide.md",
        "data_source_type": "upload_file",
        "indexing_status": "completed",
        "error": None,
        "enabled": True,
        "archived": False,
        "doc_form": "text_model",
        "doc_language": "English",
        "document_process_rule": {"mode": "custom", "rules": {}},
        "created_at": datetime(2025, 1, 1, tzinfo=UTC),
        "updated_at": datetime(2025, 1, 2, tzinfo=UTC),
        "completed_at": datetime(2025, 1, 2, tzinfo=UTC),
        **extra,
    }


def test_dataset_row_maps_external_knowledge_fields() -> None:
    row = _dataset_row(
        _dataset(
            provider="external",
            external_knowledge_info={
                "external_knowledge_api_id": "api-1",
                "external_knowledge_id": "kb-9",
            },
        )
    )
    assert row.provider == "external"
    assert row.external_knowledge_api_id == "api-1"
    assert row.external_knowledge_id == "kb-9"
    assert row.retrieval_model == {"search_method": "semantic_search"}


def test_indexing_status_uses_public_vocabulary() -> None:
    assert _indexing_status({"indexing_status": "completed"}) == "available"
    assert _indexing_status({"indexing_status": "error"}) == "failed"
    assert _indexing_status({"indexing_status": "indexing"}) == "indexing"
    assert _indexing_status({}) == ""


def test_document_row_carries_dataset_id_and_mapped_status() -> None:
    row = _document_row(_document(), dataset_id="ds-1")
    assert row.dataset_id == "ds-1"
    assert row.indexing_status == "available"
    assert row.document_process_rule == {"mode": "custom", "rules": {}}
