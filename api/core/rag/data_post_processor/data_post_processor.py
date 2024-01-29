from typing import List, Optional

from core.rag.data_post_processor.reorder import ReorderRunner
from core.rag.models.document import Document
from core.rerank.rerank import RerankRunner


class DataPostProcessor:
    """Interface for data post-processing document.
    """

    def __init__(self, rerank_runner: Optional[RerankRunner] = None, reorder_runner: Optional[ReorderRunner] = None):
        self.rerank_runner = rerank_runner
        self.reorder_runner = reorder_runner

    def rerank(self, query: str, documents: List[Document], score_threshold: Optional[float] = None,
               top_n: Optional[int] = None, user: Optional[str] = None) -> List[Document]:
        if self.rerank_runner is None:
            return documents
        return self.rerank_runner.run(query, documents, score_threshold, top_n, user)

    def reorder(self, documents: List[Document]) -> List[Document]:
        if self.reorder_runner is None:
            return documents
        return self.reorder_runner.run(documents)
