from enum import StrEnum, auto


class RetrievalMethod(StrEnum):
    SEMANTIC_SEARCH = auto()
    FULL_TEXT_SEARCH = auto()
    HYBRID_SEARCH = auto()

    @staticmethod
    def is_support_semantic_search(retrieval_method: str) -> bool:
        return retrieval_method in {RetrievalMethod.SEMANTIC_SEARCH.value, RetrievalMethod.HYBRID_SEARCH.value}

    @staticmethod
    def is_support_fulltext_search(retrieval_method: str) -> bool:
        return retrieval_method in {RetrievalMethod.FULL_TEXT_SEARCH.value, RetrievalMethod.HYBRID_SEARCH.value}
