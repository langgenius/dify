"""Focused tests for attachment-aware dataset retrieval entry behavior."""

from unittest.mock import patch

from sqlalchemy.orm import Session

from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from models.dataset import Dataset


def test_knowledge_retrieval_allows_attachment_only_requests(unbound_session: Session) -> None:
    retrieval = DatasetRetrieval()
    available_dataset = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        created_by="user-1",
    )

    request = KnowledgeRetrievalRequest(
        tenant_id="tenant-1",
        user_id="user-1",
        app_id="app-1",
        user_from="account",
        dataset_ids=["dataset-1"],
        query=None,
        retrieval_mode="multiple",
        top_k=4,
        score_threshold=0.0,
        reranking_mode="reranking_model",
        reranking_enable=True,
        attachment_ids=["attachment-1"],
    )

    with (
        patch.object(retrieval, "_check_knowledge_rate_limit"),
        patch.object(retrieval, "_get_available_datasets", return_value=[available_dataset]),
        patch.object(retrieval, "multiple_retrieve", return_value=[]) as mock_multiple,
    ):
        result = retrieval.knowledge_retrieval(unbound_session, request)

    assert result == []
    mock_multiple.assert_called_once()
