from enum import StrEnum


class RetrievalMethod(StrEnum):
    SEMANTIC_SEARCH = "semantic_search"
    FULL_TEXT_SEARCH = "full_text_search"
    HYBRID_SEARCH = "hybrid_search"
    KEYWORD_SEARCH = "keyword_search"
    GRAPH_SEARCH = "graph_search"

    @staticmethod
    def is_support_semantic_search(retrieval_method: str) -> bool:
        return retrieval_method in {RetrievalMethod.SEMANTIC_SEARCH, RetrievalMethod.HYBRID_SEARCH}

    @staticmethod
    def is_support_fulltext_search(retrieval_method: str) -> bool:
        return retrieval_method in {RetrievalMethod.FULL_TEXT_SEARCH, RetrievalMethod.HYBRID_SEARCH}

    @staticmethod
    def is_support_graph_search(retrieval_method: str) -> bool:
        """Whether the method walks the knowledge graph.

        Hybrid search includes the graph so that vector, full-text and multi-hop
        results are merged and reranked together. Keyword search includes it too
        because economy-indexing datasets are force-routed to keyword search and
        would otherwise never reach their graph, even though a graph walk needs
        no embeddings.

        The graph leg is gated on the dataset opting in, so it never runs for a
        knowledge base that has no graph index.
        """
        return retrieval_method in {
            RetrievalMethod.GRAPH_SEARCH,
            RetrievalMethod.HYBRID_SEARCH,
            RetrievalMethod.KEYWORD_SEARCH,
        }
