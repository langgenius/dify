from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.model_runtime.entities.llm_entities import LLMUsage
from core.variables import StringSegment
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.entities.repositories import Repositories
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.knowledge_retrieval.exc import KnowledgeRetrievalNodeError
from core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node import KnowledgeRetrievalNode
from core.workflow.repositories.knowledge_repository import KnowledgeRepository


def _build_graph_runtime_state(query_text: str) -> MagicMock:
    graph_runtime_state = MagicMock()
    variable_pool = MagicMock()
    variable_pool.get.return_value = StringSegment(
        value=query_text,
        name="text",
        created_by_role="user",
        created_by_node_id="start",
    )
    graph_runtime_state.variable_pool = variable_pool
    return graph_runtime_state


def test_knowledge_retrieval_node_uses_repository() -> None:
    knowledge_repo = MagicMock(spec=KnowledgeRepository)
    repositories = Repositories(knowledge_repo=knowledge_repo)

    graph_init_params = GraphInitParams(
        tenant_id="tenant_1",
        app_id="app_1",
        workflow_id="workflow_1",
        graph_config={},
        user_id="user_1",
        user_from="account",
        invoke_from="service-api",
        call_depth=0,
        repositories=repositories,
    )

    knowledge_repo.get_datasets_with_available_documents.return_value = [
        SimpleNamespace(
            id="ds1",
            provider="dify",
            name="Dataset 1",
            description=None,
            indexing_technique="high_quality",
            retrieval_model=None,
            tenant_id="tenant_1",
        )
    ]
    knowledge_repo.get_dataset.return_value = SimpleNamespace(id="ds1", name="Dataset 1")
    knowledge_repo.get_document.return_value = SimpleNamespace(
        id="doc1",
        name="Doc 1",
        data_source_type="upload",
        doc_metadata={},
    )

    config = {
        "id": "node_1",
        "data": {
            "title": "Knowledge Retrieval",
            "dataset_ids": ["ds1"],
            "retrieval_mode": "single",
            "single_retrieval_config": {
                "model": {
                    "provider": "openai",
                    "name": "gpt-4",
                    "mode": "chat",
                    "completion_params": {},
                }
            },
            "query_variable_selector": ["query_node", "text"],
        },
    }

    graph_runtime_state = _build_graph_runtime_state("search query")

    node = KnowledgeRetrievalNode(
        id="node_1",
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )

    model_type_instance = MagicMock()
    model_type_instance.get_model_schema.return_value = SimpleNamespace(features=None)
    model_config = SimpleNamespace(
        provider_model_bundle=SimpleNamespace(model_type_instance=model_type_instance),
        model="gpt-4",
        credentials={},
    )

    with (
        patch("services.feature_service.FeatureService.get_knowledge_rate_limit") as mock_rate_limit,
        patch("core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node.DatasetRetrieval") as mock_dr_cls,
        patch.object(node, "get_model_config", return_value=(MagicMock(), model_config)),
        patch("core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node.RetrievalService") as mock_rs,
    ):
        mock_rate_limit.return_value = SimpleNamespace(enabled=False)

        mock_dr_instance = mock_dr_cls.return_value
        mock_retrieved_doc = SimpleNamespace(
            provider="dify",
            metadata={
                "dataset_id": "ds1",
                "document_id": "doc1",
                "score": 0.9,
                "title": "Doc 1",
            },
        )
        mock_dr_instance.single_retrieve.return_value = [mock_retrieved_doc]
        mock_dr_instance.llm_usage = LLMUsage.empty_usage()

        segment = SimpleNamespace(
            id="seg1",
            dataset_id="ds1",
            document_id="doc1",
            hit_count=1,
            word_count=10,
            position=0,
            index_node_hash="hash",
            answer=None,
            get_sign_content=lambda: "content",
        )
        mock_rs.format_retrieval_documents.return_value = [
            SimpleNamespace(
                segment=segment,
                score=0.9,
                child_chunks=[],
                files=None,
                summary=None,
            )
        ]

        result = node._run()

    knowledge_repo.get_datasets_with_available_documents.assert_called_once_with("tenant_1", ["ds1"])
    knowledge_repo.get_dataset.assert_called_once_with("tenant_1", "ds1")
    knowledge_repo.get_document.assert_called_once_with("tenant_1", "doc1")
    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED


def test_knowledge_retrieval_node_without_repository_fails_fast() -> None:
    graph_init_params = GraphInitParams(
        tenant_id="tenant_1",
        app_id="app_1",
        workflow_id="workflow_1",
        graph_config={},
        user_id="user_1",
        user_from="account",
        invoke_from="service-api",
        call_depth=0,
        repositories=None,
    )

    config = {
        "id": "node_1",
        "data": {
            "title": "Knowledge Retrieval",
            "dataset_ids": ["ds1"],
            "retrieval_mode": "single",
            "single_retrieval_config": {
                "model": {
                    "provider": "openai",
                    "name": "gpt-4",
                    "mode": "chat",
                    "completion_params": {},
                }
            },
            "query_variable_selector": ["query_node", "text"],
        },
    }

    graph_runtime_state = _build_graph_runtime_state("search query")

    node = KnowledgeRetrievalNode(
        id="node_1",
        config=config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
    )

    with pytest.raises(KnowledgeRetrievalNodeError):
        node._run()
