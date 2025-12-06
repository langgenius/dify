import base64

from core.model_manager import ModelInstance, ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.rerank_entities import RerankResult
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_base import BaseRerankRunner
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import UploadFile


class RerankModelRunner(BaseRerankRunner):
    def __init__(self, rerank_model_instance: ModelInstance):
        self.rerank_model_instance = rerank_model_instance

    def run(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        user: str | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
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
        model_manager = ModelManager()
        is_support_vision = model_manager.check_model_support_vision(
            tenant_id=self.rerank_model_instance.provider_model_bundle.configuration.tenant_id,
            provider=self.rerank_model_instance.provider,
            model=self.rerank_model_instance.model,
            model_type=ModelType.RERANK,
        )
        if not is_support_vision:
            if query_type == QueryType.TEXT_QUERY:
                rerank_result, unique_documents = self.fetch_text_rerank(query, documents, score_threshold, top_n, user)
            else:
                return documents
        else:
            rerank_result, unique_documents = self.fetch_multimodal_rerank(
                query, documents, score_threshold, top_n, user, query_type
            )

        rerank_documents = []
        for result in rerank_result.docs:
            if score_threshold is None or result.score >= score_threshold:
                # format document
                rerank_document = Document(
                    page_content=result.text,
                    metadata=unique_documents[result.index].metadata,
                    provider=unique_documents[result.index].provider,
                )
                if rerank_document.metadata is not None:
                    rerank_document.metadata["score"] = result.score
                    rerank_documents.append(rerank_document)

        rerank_documents.sort(key=lambda x: x.metadata.get("score", 0.0), reverse=True)
        return rerank_documents[:top_n] if top_n else rerank_documents

    def fetch_text_rerank(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        user: str | None = None,
    ) -> tuple[RerankResult, list[Document]]:
        """
        Fetch text rerank
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
                if not document.metadata.get("doc_type") or document.metadata.get("doc_type") == DocType.TEXT:
                    doc_ids.add(document.metadata["doc_id"])
                    docs.append(document.page_content)
                    unique_documents.append(document)
            elif document.provider == "external":
                if document not in unique_documents:
                    docs.append(document.page_content)
                    unique_documents.append(document)

        rerank_result = self.rerank_model_instance.invoke_rerank(
            query=query, docs=docs, score_threshold=score_threshold, top_n=top_n, user=user
        )
        return rerank_result, unique_documents

    def fetch_multimodal_rerank(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        user: str | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
    ) -> tuple[RerankResult, list[Document]]:
        """
        Fetch multimodal rerank
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param user: unique user id if needed
        :param query_type: query type
        :return: rerank result
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
                if document.metadata.get("doc_type") == DocType.IMAGE:
                    # Query file info within db.session context to ensure thread-safe access
                    upload_file = (
                        db.session.query(UploadFile).where(UploadFile.id == document.metadata["doc_id"]).first()
                    )
                    if upload_file:
                        blob = storage.load_once(upload_file.key)
                        document_file_base64 = base64.b64encode(blob).decode()
                        document_file_dict = {
                            "content": document_file_base64,
                            "content_type": document.metadata["doc_type"],
                        }
                        docs.append(document_file_dict)
                else:
                    document_text_dict = {
                        "content": document.page_content,
                        "content_type": document.metadata.get("doc_type") or DocType.TEXT,
                    }
                    docs.append(document_text_dict)
                doc_ids.add(document.metadata["doc_id"])
                unique_documents.append(document)
            elif document.provider == "external":
                if document not in unique_documents:
                    docs.append(
                        {
                            "content": document.page_content,
                            "content_type": document.metadata.get("doc_type") or DocType.TEXT,
                        }
                    )
                    unique_documents.append(document)

        documents = unique_documents
        if query_type == QueryType.TEXT_QUERY:
            rerank_result, unique_documents = self.fetch_text_rerank(query, documents, score_threshold, top_n, user)
            return rerank_result, unique_documents
        elif query_type == QueryType.IMAGE_QUERY:
            # Query file info within db.session context to ensure thread-safe access
            upload_file = db.session.query(UploadFile).where(UploadFile.id == query).first()
            if upload_file:
                blob = storage.load_once(upload_file.key)
                file_query = base64.b64encode(blob).decode()
                file_query_dict = {
                    "content": file_query,
                    "content_type": DocType.IMAGE,
                }
                rerank_result = self.rerank_model_instance.invoke_multimodal_rerank(
                    query=file_query_dict, docs=docs, score_threshold=score_threshold, top_n=top_n, user=user
                )
                return rerank_result, unique_documents
            else:
                raise ValueError(f"Upload file not found for query: {query}")

        else:
            raise ValueError(f"Query type {query_type} is not supported")
