from typing import List, Optional
from core.rag.models.document import Document
from core.rerank.rerank import RerankRunner


class DataPostProcessor:
    """Interface for data post-processing document.
    """

    def __init__(self, rerank_runner: RerankRunner):
        self.rerank_runner = rerank_runner

    def rerank(self, query: str, documents: List[Document], score_threshold: Optional[float] = None,
               top_n: Optional[int] = None, user: Optional[str] = None) -> List[Document]:
        return self.rerank_runner.run(query, documents, score_threshold, top_n, user)
