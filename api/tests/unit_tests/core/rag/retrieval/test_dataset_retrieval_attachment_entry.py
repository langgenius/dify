from extensions.application_services.retrieval import build_dataset_retrieval

"""Focused tests for attachment-aware dataset retrieval entry behavior."""

from unittest.mock import patch

from sqlalchemy.orm import Session, sessionmaker

from core.workflow.nodes.knowledge_retrieval.retrieval import KnowledgeRetrievalRequest
from models.dataset import Dataset
from repositories.knowledge.retrieval_repository import KnowledgeRetrievalRepository


def test_knowledge_retrieval_allows_attachment_only_requests(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    retrieval = build_dataset_retrieval(sqlite_session_factory)()
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
        patch.object(KnowledgeRetrievalRepository, "available_datasets", return_value=[available_dataset]),
        patch.object(retrieval, "multiple_retrieve", return_value=[]) as mock_multiple,
    ):
        result = retrieval.knowledge_retrieval(request)

    assert result == []
    mock_multiple.assert_called_once()
