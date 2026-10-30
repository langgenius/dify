from collections.abc import Mapping, Sequence
from typing import override

from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict
from graphon.enums import NodeExecutionType
from graphon.graph import NodeFactory
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.nodes.base.node import Node
from graphon.runtime import RuntimeState
from services.knowledge.entities.retrieval import (
    KnowledgeRetrievalRequest,
    KnowledgeRetrievalResult,
    RetrievableDataset,
)
from services.knowledge.retrieval.retrieval import KnowledgeRetriever


class KnowledgeRetrievalTestNodeFactory:
    """NodeFactory capability for tests whose parent graph is already built."""

    def __init__(self, knowledge_retrieval: KnowledgeRetriever) -> None:
        self.knowledge_retrieval = knowledge_retrieval

    def with_runtime_state(self, runtime_state: RuntimeState) -> NodeFactory:
        del runtime_state
        raise AssertionError("The already-built parent graph must not recreate nodes")

    def with_graph_config(self, graph_config: Mapping[str, object]) -> NodeFactory:
        del graph_config
        raise AssertionError("The already-built parent graph must not recreate nodes")

    def validate_node(self, node_config: NodeConfigDict) -> NodeExecutionType:
        del node_config
        raise AssertionError("The already-built parent graph must not validate nodes")

    def create_node(self, node_config: NodeConfigDict) -> Node[BaseNodeData]:
        del node_config
        raise AssertionError("The already-built parent graph must not recreate nodes")


class EmptyKnowledgeRetriever:
    def list_datasets(self, *, tenant_id: str, dataset_ids: Sequence[str]) -> list[RetrievableDataset]:
        del tenant_id, dataset_ids
        return []

    def retrieve(
        self,
        request: KnowledgeRetrievalRequest,
        *,
        request_metadata: Mapping[str, object] | None,
    ) -> KnowledgeRetrievalResult:
        del request, request_metadata
        return KnowledgeRetrievalResult(sources=[], usage=LLMUsage.empty_usage())


class RecordingKnowledgeRetriever(EmptyKnowledgeRetriever):
    def __init__(self) -> None:
        self.requests: list[tuple[KnowledgeRetrievalRequest, Mapping[str, object] | None]] = []
        self.result = KnowledgeRetrievalResult(sources=[], usage=LLMUsage.empty_usage())
        self.error: Exception | None = None

    @override
    def retrieve(
        self,
        request: KnowledgeRetrievalRequest,
        *,
        request_metadata: Mapping[str, object] | None,
    ) -> KnowledgeRetrievalResult:
        self.requests.append((request, request_metadata))
        if self.error is not None:
            raise self.error
        return self.result


def make_knowledge_retriever() -> KnowledgeRetriever:
    return EmptyKnowledgeRetriever()
