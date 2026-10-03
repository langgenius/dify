import pytest

from core.rag.retrieval.retrieval_methods import RetrievalMethod


class TestIsSupportGraphSearch:
    @pytest.mark.parametrize(
        "retrieval_method",
        [
            RetrievalMethod.GRAPH_SEARCH,
            # Hybrid merges the graph leg with vector and full-text results.
            RetrievalMethod.HYBRID_SEARCH,
            # Economy datasets are force-routed here and have no embeddings, but
            # a graph walk does not need any.
            RetrievalMethod.KEYWORD_SEARCH,
        ],
    )
    def test_methods_that_walk_the_graph(self, retrieval_method: RetrievalMethod) -> None:
        assert RetrievalMethod.is_support_graph_search(retrieval_method)

    @pytest.mark.parametrize(
        "retrieval_method",
        [RetrievalMethod.SEMANTIC_SEARCH, RetrievalMethod.FULL_TEXT_SEARCH],
    )
    def test_single_mode_methods_stay_unchanged(self, retrieval_method: RetrievalMethod) -> None:
        # Picking a pure vector or full-text search must not silently add a leg.
        assert not RetrievalMethod.is_support_graph_search(retrieval_method)

    def test_graph_search_does_not_trigger_vector_or_fulltext_legs(self) -> None:
        assert not RetrievalMethod.is_support_semantic_search(RetrievalMethod.GRAPH_SEARCH)
        assert not RetrievalMethod.is_support_fulltext_search(RetrievalMethod.GRAPH_SEARCH)
