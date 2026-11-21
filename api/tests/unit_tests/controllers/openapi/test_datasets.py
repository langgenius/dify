from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from controllers.openapi._models import (
    DatasetCreatePayload,
    DocumentCreateByTextPayload,
    DocumentUpdateByTextPayload,
)
from controllers.openapi.datasets import _dataset_row, _display_status, _document_row


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
        "display_status": "available",
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


def test_display_status_uses_public_vocabulary() -> None:
    assert _display_status({"display_status": "available"}) == "available"
    assert _display_status({"display_status": "error"}) == "error"
    assert _display_status({}) is None


def test_document_row_carries_dataset_id_and_mapped_status() -> None:
    row = _document_row(_document(), dataset_id="ds-1")
    assert row.dataset_id == "ds-1"
    assert row.display_status == "available"
    assert row.document_process_rule == {"mode": "custom", "rules": {}}


def test_invalid_retrieval_model_is_rejected_by_the_payload() -> None:
    with pytest.raises(ValidationError, match="retrieval_model"):
        DatasetCreatePayload.model_validate({"name": "Docs", "retrieval_model": {"search_method": "nope"}})


def test_external_dataset_requires_binding_ids() -> None:
    with pytest.raises(ValidationError, match="external_knowledge_api_id and external_knowledge_id"):
        DatasetCreatePayload.model_validate({"name": "Docs", "provider": "external"})


def test_create_document_requires_name_and_text() -> None:
    with pytest.raises(ValidationError):
        DocumentCreateByTextPayload.model_validate({"name": "guide.md"})
    with pytest.raises(ValidationError):
        DocumentCreateByTextPayload.model_validate({"text": "hello"})


def test_update_document_requires_a_change() -> None:
    with pytest.raises(ValidationError, match="provide at least one of text, name, or process_rule"):
        DocumentUpdateByTextPayload.model_validate({})
