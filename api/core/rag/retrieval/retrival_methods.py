from enum import Enum


class RetrievalMethod(str, Enum):
    SEMANTIC_SEARCH = 'semantic_search'
    FULL_TEXT_SEARCH = 'full_text_search'
    HYBRID_SEARCH = 'hybrid_search'

    @staticmethod
    def is_support_semantic_search(retrieval_method: str) -> bool:
        return retrieval_method in {RetrievalMethod.SEMANTIC_SEARCH, RetrievalMethod.HYBRID_SEARCH}

    @staticmethod
    def is_support_fulltext_search(retrieval_method: str) -> bool:
        return retrieval_method in {RetrievalMethod.FULL_TEXT_SEARCH, RetrievalMethod.HYBRID_SEARCH}
