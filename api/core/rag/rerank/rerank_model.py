import base64
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.model_manager import ModelInstance, ModelManager
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_base import BaseRerankRunner
from extensions.ext_storage import storage
from extensions.otel import trace_span
from graphon.model_runtime.entities.model_entities import ModelType
from graphon.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from models.model import UploadFile


class RerankModelRunner(BaseRerankRunner):
    """Run model reranking with short, tenant-scoped multimodal file reads.

    Required upload-file keys are prefetched in one transaction. That
    transaction is committed before storage or model-provider I/O begins.
    """

    _session: Session

    def __init__(self, rerank_model_instance: ModelInstance, *, session: Session):
        self.rerank_model_instance = rerank_model_instance
        self._session = session

    @override
    @trace_span()
    def run(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
    ) -> list[Document]:
        """
        Run rerank model
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :return:
        """
        model_manager = ModelManager.for_tenant(
            tenant_id=self.rerank_model_instance.provider_model_bundle.configuration.tenant_id
        )
        is_support_vision = model_manager.check_model_support_vision(
            tenant_id=self.rerank_model_instance.provider_model_bundle.configuration.tenant_id,
            provider=self.rerank_model_instance.provider,
            model=self.rerank_model_instance.model_name,
            model_type=ModelType.RERANK,
        )
        if not is_support_vision:
            if query_type == QueryType.TEXT_QUERY:
                rerank_result, unique_documents = self.fetch_text_rerank(query, documents, score_threshold, top_n)
            else:
                return documents
        else:
            rerank_result, unique_documents = self.fetch_multimodal_rerank(
                query, documents, score_threshold, top_n, query_type
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
    ) -> tuple[RerankResult, list[Document]]:
        """
        Fetch text rerank
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n
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
            query=query, docs=docs, score_threshold=score_threshold, top_n=top_n
        )
        return rerank_result, unique_documents

    def fetch_multimodal_rerank(
        self,
        query: str,
        documents: list[Document],
        score_threshold: float | None = None,
        top_n: int | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
    ) -> tuple[RerankResult, list[Document]]:
        """
        Fetch multimodal rerank
        :param query: search query
        :param documents: documents for reranking
        :param score_threshold: score threshold
        :param top_n: top n
        :param query_type: query type
        :return: rerank result
        """
        if query_type == QueryType.TEXT_QUERY:
            return self.fetch_text_rerank(query, documents, score_threshold, top_n)
        if query_type != QueryType.IMAGE_QUERY:
            raise ValueError(f"Query type {query_type} is not supported")

        doc_ids: set[str] = set()
        unique_candidates: list[Document] = []
        image_file_ids: set[str] = set()
        for document in documents:
            metadata = document.metadata or {}
            if (
                document.provider == "dify"
                and metadata.get("doc_id") is not None
                and str(metadata["doc_id"]) not in doc_ids
            ):
                doc_id = str(metadata["doc_id"])
                doc_ids.add(doc_id)
                unique_candidates.append(document)
                if metadata.get("doc_type") == DocType.IMAGE:
                    image_file_ids.add(doc_id)
            elif document.provider == "external":
                if document not in unique_candidates:
                    unique_candidates.append(document)

        tenant_id = self.rerank_model_instance.provider_model_bundle.configuration.tenant_id
        upload_file_ids = [*image_file_ids, query]
        upload_files = self._session.scalars(
            select(UploadFile).where(
                UploadFile.id.in_(upload_file_ids),
                UploadFile.tenant_id == tenant_id,
            )
        ).all()
        upload_keys = {upload_file.id: upload_file.key for upload_file in upload_files}
        self._session.commit()

        query_key = upload_keys.get(query)
        if query_key is None:
            raise ValueError(f"Upload file not found for query: {query}")

        docs: list[MultimodalRerankInput] = []
        unique_documents: list[Document] = []
        for document in unique_candidates:
            metadata = document.metadata or {}
            if document.provider == "dify" and metadata.get("doc_type") == DocType.IMAGE:
                image_key = upload_keys.get(str(metadata["doc_id"]))
                if image_key is None:
                    continue
                blob = storage.load_once(image_key)
                docs.append(
                    MultimodalRerankInput(
                        content=base64.b64encode(blob).decode(),
                        content_type=DocType.IMAGE,
                    )
                )
            else:
                docs.append(
                    MultimodalRerankInput(
                        content=document.page_content,
                        content_type=metadata.get("doc_type") or DocType.TEXT,
                    )
                )
            unique_documents.append(document)

        query_blob = storage.load_once(query_key)
        file_query_input = MultimodalRerankInput(
            content=base64.b64encode(query_blob).decode(),
            content_type=DocType.IMAGE,
        )
        rerank_result = self.rerank_model_instance.invoke_multimodal_rerank(
            query=file_query_input,
            docs=docs,
            score_threshold=score_threshold,
            top_n=top_n,
        )
        return rerank_result, unique_documents
