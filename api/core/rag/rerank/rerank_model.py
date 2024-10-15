from typing import Optional

from core.model_manager import ModelInstance
from core.rag.models.document import Document


class RerankModelRunner:
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
        doc_id = []
        unique_documents = []
        dify_documents = [item for item in documents if item.provider == "dify"]
        external_documents = [item for item in documents if item.provider == "external"]
        for document in dify_documents:
            if document.metadata["doc_id"] not in doc_id:
                doc_id.append(document.metadata["doc_id"])
                docs.append(document.page_content)
                unique_documents.append(document)
        for document in external_documents:
            docs.append(document.page_content)
            unique_documents.append(document)

        documents = unique_documents

        rerank_result = self.rerank_model_instance.invoke_rerank(
            query=query, docs=docs, score_threshold=score_threshold, top_n=top_n, user=user
        )

        rerank_documents = []

        for result in rerank_result.docs:
            # format document
            rerank_document = Document(
                page_content=result.text,
                metadata=documents[result.index].metadata,
                provider=documents[result.index].provider,
            )
            rerank_document.metadata["score"] = result.score
            rerank_documents.append(rerank_document)

        return rerank_documents
