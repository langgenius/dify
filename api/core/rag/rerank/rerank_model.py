import base64
from collections.abc import Mapping, Sequence
from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from core.credit_usage import CreditUsageCreatedBy
from core.model_context import with_credit_usage_created_by
from core.model_manager import ModelInstance
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_base import BaseRerankRunner
from extensions.ext_storage import storage
from extensions.otel import trace_span
from graphon.model_runtime.entities.model_entities import ModelFeature
from graphon.model_runtime.entities.rerank_entities import MultimodalRerankInput, RerankResult
from models.model import UploadFile
from repositories.knowledge.retrieval_source_repository import get_authorized_retrieval_attachment_file_keys

_file_access_controller = DatabaseFileAccessController()


class RerankModelRunner(BaseRerankRunner):
    def __init__(
        self,
        rerank_model_instance: ModelInstance,
        *,
        tenant_id: str,
        session_factory: sessionmaker[Session],
        dataset_document_filters: Mapping[str, Sequence[str] | None],
    ):
        self.rerank_model_instance = rerank_model_instance
        self._tenant_id = tenant_id
        self._sessions = session_factory
        self._dataset_document_filters = {
            str(dataset_id): None
            if document_ids is None
            else tuple(dict.fromkeys(str(document_id) for document_id in document_ids))
            for dataset_id, document_ids in dataset_document_filters.items()
        }

    def _resolve_multimodal_file_keys(
        self, *, query_file_id: str, candidate_attachment_ids: set[str]
    ) -> tuple[str | None, dict[str, str]]:
        with self._sessions() as session:
            query_file_stmt = select(UploadFile).where(
                UploadFile.tenant_id == self._tenant_id,
                UploadFile.id == query_file_id,
            )
            query_file = session.scalar(_file_access_controller.apply_upload_file_filters(query_file_stmt))
            if query_file is None:
                return None, {}
            candidate_file_keys = get_authorized_retrieval_attachment_file_keys(
                tenant_id=self._tenant_id,
                attachment_ids=tuple(candidate_attachment_ids),
                dataset_document_filters=self._dataset_document_filters,
                session=session,
            )
            return query_file.key, candidate_file_keys

    @override
    @trace_span()
    @with_credit_usage_created_by(CreditUsageCreatedBy.KNOWLEDGE_RETRIEVAL)
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
        is_support_vision = self._check_model_support_vision()
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
                representative = unique_documents[result.index]
                for source_document in self._source_documents(representative, documents):
                    rerank_document = source_document.model_copy(
                        deep=True,
                        update={
                            "page_content": result.text,
                            "metadata": {**source_document.metadata, "score": result.score},
                        },
                    )
                    rerank_documents.append(rerank_document)

        rerank_documents.sort(key=lambda x: x.metadata.get("score", 0.0), reverse=True)
        return rerank_documents[:top_n] if top_n else rerank_documents

    @staticmethod
    def _source_dataset_id(document: Document) -> str | None:
        source_dataset_id = document.metadata.get("_retrieval_source_dataset_id")
        if source_dataset_id is None:
            source_dataset_id = document.metadata.get("dataset_id")
        return str(source_dataset_id) if source_dataset_id is not None else None

    @classmethod
    def _source_documents(cls, representative: Document, documents: Sequence[Document]) -> list[Document]:
        if representative.provider != "dify" or not representative.metadata.get("doc_id"):
            return [representative]

        doc_id = str(representative.metadata["doc_id"])
        is_shared_attachment = representative.metadata.get("doc_type") == DocType.IMAGE
        source_documents: list[Document] = []
        source_dataset_ids: set[str | None] = set()
        for document in documents:
            if (
                document.provider != "dify"
                or str(document.metadata.get("doc_id")) != doc_id
                or (document.metadata.get("doc_type") == DocType.IMAGE) != is_shared_attachment
            ):
                continue
            source_dataset_id = cls._source_dataset_id(document)
            if not is_shared_attachment and source_dataset_id != cls._source_dataset_id(representative):
                continue
            if source_dataset_id in source_dataset_ids:
                continue
            source_dataset_ids.add(source_dataset_id)
            source_documents.append(document)
        return source_documents

    def _check_model_support_vision(self) -> bool:
        """Check capabilities on the model instance already resolved for this run."""
        model_schema = self.rerank_model_instance.get_model_schema()
        return ModelFeature.VISION in (model_schema.features or [])

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
        document_identities: set[tuple[str | None, str]] = set()
        unique_documents = []
        for document in documents:
            if document.provider == "dify" and document.metadata.get("doc_id"):
                if not document.metadata.get("doc_type") or document.metadata.get("doc_type") == DocType.TEXT:
                    identity = (self._source_dataset_id(document), str(document.metadata["doc_id"]))
                    if identity in document_identities:
                        continue
                    document_identities.add(identity)
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

        candidate_attachment_ids = {
            str(document.metadata["doc_id"])
            for document in documents
            if document.provider == "dify"
            and document.metadata is not None
            and document.metadata.get("doc_type") == DocType.IMAGE
        }
        query_file_key, candidate_file_keys = self._resolve_multimodal_file_keys(
            query_file_id=query,
            candidate_attachment_ids=candidate_attachment_ids,
        )

        docs: list[MultimodalRerankInput] = []
        document_identities: set[tuple[str | None, str]] = set()
        unique_documents = []
        for document in documents:
            if document.provider == "dify" and document.metadata.get("doc_id"):
                if document.metadata.get("doc_type") == DocType.IMAGE:
                    identity = (None, str(document.metadata["doc_id"]))
                    file_key = candidate_file_keys.get(str(document.metadata["doc_id"]))
                    if file_key is None:
                        continue
                    if identity in document_identities:
                        continue
                    blob = storage.load_once(file_key)
                    document_file_base64 = base64.b64encode(blob).decode()
                    docs.append(
                        MultimodalRerankInput(
                            content=document_file_base64,
                            content_type=document.metadata["doc_type"],
                        )
                    )
                else:
                    identity = (self._source_dataset_id(document), str(document.metadata["doc_id"]))
                    if identity in document_identities:
                        continue
                    docs.append(
                        MultimodalRerankInput(
                            content=document.page_content,
                            content_type=document.metadata.get("doc_type") or DocType.TEXT,
                        )
                    )
                document_identities.add(identity)
                unique_documents.append(document)
            elif document.provider == "external":
                if document not in unique_documents:
                    docs.append(
                        MultimodalRerankInput(
                            content=document.page_content,
                            content_type=document.metadata.get("doc_type") or DocType.TEXT,
                        )
                    )
                    unique_documents.append(document)

        if query_file_key is None:
            raise ValueError(f"Upload file not found for query: {query}")
        blob = storage.load_once(query_file_key)
        file_query = base64.b64encode(blob).decode()
        file_query_input = MultimodalRerankInput(
            content=file_query,
            content_type=DocType.IMAGE,
        )
        rerank_result = self.rerank_model_instance.invoke_multimodal_rerank(
            query=file_query_input, docs=docs, score_threshold=score_threshold, top_n=top_n
        )
        return rerank_result, unique_documents
