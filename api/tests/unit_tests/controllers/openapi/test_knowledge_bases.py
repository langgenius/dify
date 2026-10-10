from controllers.openapi._models import KNOWLEDGE_TOP_K
from controllers.openapi.knowledge_bases import knowledge_base_row


def _record(**extra: object) -> dict[str, object]:
    return {
        "id": "ds-1",
        "name": "Docs",
        "description": None,
        "provider": "vendor",
        "indexing_technique": "high_quality",
        "document_count": 3,
        "embedding_available": True,
        **extra,
    }


def test_row_carries_a_retrieval_fragment() -> None:
    row = knowledge_base_row(_record())
    assert row.node_data.dataset_ids == ["ds-1"]
    assert row.node_data.retrieval_mode == "multiple"
    assert row.node_data.multiple_retrieval_config.top_k == KNOWLEDGE_TOP_K
    assert row.node_data.multiple_retrieval_config.reranking_enable is False


def test_unavailable_embedding_is_reported() -> None:
    assert knowledge_base_row(_record(embedding_available=False)).usable is False
    assert knowledge_base_row(_record(embedding_available=None, provider="external")).usable is True
