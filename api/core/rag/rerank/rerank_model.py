from typing import Optional

from core.model_manager import ModelInstance
from core.rag.models.document import Document
from core.rag.rerank.rerank_base import BaseRerankRunner


class RerankModelRunner(BaseRerankRunner):
    def __init__(self, rerank_model_instance: ModelInstance) -> None:
        self.rerank_model_instance = rerank_model_instance

    def run(
        self,
        query: str,
        documents: list[Document],
        score_threshold: Optional[float] = None,
        top_n: Optional[int] = None,
        user: Optional[str] = None,
    ) -> list[Document]:
        """
        Run rerank model
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param user: unique user id if needed
        :return:
        """
        docs = []
        doc_ids = set()
        unique_documents = []
        for document in documents:
            if (
                document.provider == "dify"
                and document.metadata is not None
                and document.metadata["doc_id"] not in doc_ids
            ):
                doc_ids.add(document.metadata["doc_id"])
                docs.append(document.page_content)
                unique_documents.append(document)
            elif document.provider == "external":
                if document not in unique_documents:
                    docs.append(document.page_content)
                    unique_documents.append(document)

        documents = unique_documents

        rerank_result = self.rerank_model_instance.invoke_rerank(
            query=query, docs=docs, score_threshold=score_threshold, top_n=top_n, user=user
        )

        rerank_documents = []

        for result in rerank_result.docs:
            if score_threshold is None or result.score >= score_threshold:
                # format document
                rerank_document = Document(
                    page_content=result.text,
                    metadata=documents[result.index].metadata,
                    provider=documents[result.index].provider,
                )
                if rerank_document.metadata is not None:
                    rerank_document.metadata["score"] = result.score
                    rerank_documents.append(rerank_document)

        rerank_documents.sort(key=lambda x: x.metadata.get("score", 0.0), reverse=True)
        return rerank_documents[:top_n] if top_n else rerank_documents
