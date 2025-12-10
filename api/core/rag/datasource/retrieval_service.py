import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from flask import Flask, current_app
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from configs import dify_config
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.embedding.retrieval import RetrievalSegments
from core.rag.entities.metadata_entities import MetadataCondition
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.signature import sign_upload_file
from extensions.ext_database import db
from models.dataset import ChildChunk, Dataset, DocumentSegment, SegmentAttachmentBinding
from models.dataset import Document as DatasetDocument
from models.model import UploadFile
from services.external_knowledge_service import ExternalDatasetService

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class RetrievalService:
    # Cache precompiled regular expressions to avoid repeated compilation
    @classmethod
    def retrieve(
        cls,
        retrieval_method: RetrievalMethod,
        dataset_id: str,
        query: str,
        top_k: int = 4,
        score_threshold: float | None = 0.0,
        reranking_model: dict | None = None,
        reranking_mode: str = "reranking_model",
        weights: dict | None = None,
        document_ids_filter: list[str] | None = None,
        attachment_ids: list | None = None,
    ):
        if not query and not attachment_ids:
            return []
        dataset = cls._get_dataset(dataset_id)
        if not dataset:
            return []

        all_documents: list[Document] = []
        exceptions: list[str] = []

        # Optimize multithreading with thread pools
        with ThreadPoolExecutor(max_workers=dify_config.RETRIEVAL_SERVICE_EXECUTORS) as executor:  # type: ignore
            futures = []
            retrieval_service = RetrievalService()
            if query:
                futures.append(
                    executor.submit(
                        retrieval_service._retrieve,
                        flask_app=current_app._get_current_object(),  # type: ignore
                        retrieval_method=retrieval_method,
                        dataset=dataset,
                        query=query,
                        top_k=top_k,
                        score_threshold=score_threshold,
                        reranking_model=reranking_model,
                        reranking_mode=reranking_mode,
                        weights=weights,
                        document_ids_filter=document_ids_filter,
                        attachment_id=None,
                        all_documents=all_documents,
                        exceptions=exceptions,
                    )
                )
            if attachment_ids:
                for attachment_id in attachment_ids:
                    futures.append(
                        executor.submit(
                            retrieval_service._retrieve,
                            flask_app=current_app._get_current_object(),  # type: ignore
                            retrieval_method=retrieval_method,
                            dataset=dataset,
                            query=None,
                            top_k=top_k,
                            score_threshold=score_threshold,
                            reranking_model=reranking_model,
                            reranking_mode=reranking_mode,
                            weights=weights,
                            document_ids_filter=document_ids_filter,
                            attachment_id=attachment_id,
                            all_documents=all_documents,
                            exceptions=exceptions,
                        )
                    )

            concurrent.futures.wait(futures, timeout=3600, return_when=concurrent.futures.ALL_COMPLETED)

        if exceptions:
            raise ValueError(";\n".join(exceptions))

        return all_documents

    @classmethod
    def external_retrieve(
        cls,
        dataset_id: str,
        query: str,
        external_retrieval_model: dict | None = None,
        metadata_filtering_conditions: dict | None = None,
    ):
        stmt = select(Dataset).where(Dataset.id == dataset_id)
        dataset = db.session.scalar(stmt)
        if not dataset:
            return []
        metadata_condition = (
            MetadataCondition.model_validate(metadata_filtering_conditions) if metadata_filtering_conditions else None
        )
        all_documents = ExternalDatasetService.fetch_external_knowledge_retrieval(
            dataset.tenant_id,
            dataset_id,
            query,
            external_retrieval_model or {},
            metadata_condition=metadata_condition,
        )
        return all_documents

    @classmethod
    def _deduplicate_documents(cls, documents: list[Document]) -> list[Document]:
        """Deduplicate documents based on doc_id to avoid duplicate chunks in hybrid search."""
        if not documents:
            return documents

        unique_documents = []
        seen_doc_ids = set()

        for document in documents:
            # For dify provider documents, use doc_id for deduplication
            if document.provider == "dify" and document.metadata is not None and "doc_id" in document.metadata:
                doc_id = document.metadata["doc_id"]
                if doc_id not in seen_doc_ids:
                    seen_doc_ids.add(doc_id)
                    unique_documents.append(document)
                # If duplicate, keep the one with higher score
                elif "score" in document.metadata:
                    # Find existing document with same doc_id and compare scores
                    for i, existing_doc in enumerate(unique_documents):
                        if (
                            existing_doc.metadata
                            and existing_doc.metadata.get("doc_id") == doc_id
                            and existing_doc.metadata.get("score", 0) < document.metadata.get("score", 0)
                        ):
                            unique_documents[i] = document
                            break
            else:
                # For non-dify documents, use content-based deduplication
                if document not in unique_documents:
                    unique_documents.append(document)

        return unique_documents

    @classmethod
    def _get_dataset(cls, dataset_id: str) -> Dataset | None:
        with Session(db.engine) as session:
            return session.query(Dataset).where(Dataset.id == dataset_id).first()

    @classmethod
    def keyword_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        all_documents: list,
        exceptions: list,
        document_ids_filter: list[str] | None = None,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                keyword = Keyword(dataset=dataset)

                documents = keyword.search(
                    cls.escape_query_for_search(query), top_k=top_k, document_ids_filter=document_ids_filter
                )
                all_documents.extend(documents)
            except Exception as e:
                exceptions.append(str(e))

    @classmethod
    def embedding_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float | None,
        reranking_model: dict | None,
        all_documents: list,
        retrieval_method: RetrievalMethod,
        exceptions: list,
        document_ids_filter: list[str] | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                vector = Vector(dataset=dataset)
                documents = []
                if query_type == QueryType.TEXT_QUERY:
                    documents.extend(
                        vector.search_by_vector(
                            query,
                            search_type="similarity_score_threshold",
                            top_k=top_k,
                            score_threshold=score_threshold,
                            filter={"group_id": [dataset.id]},
                            document_ids_filter=document_ids_filter,
                        )
                    )
                if query_type == QueryType.IMAGE_QUERY:
                    if not dataset.is_multimodal:
                        return
                    documents.extend(
                        vector.search_by_file(
                            file_id=query,
                            top_k=top_k,
                            score_threshold=score_threshold,
                            filter={"group_id": [dataset.id]},
                            document_ids_filter=document_ids_filter,
                        )
                    )

                if documents:
                    if (
                        reranking_model
                        and reranking_model.get("reranking_model_name")
                        and reranking_model.get("reranking_provider_name")
                        and retrieval_method == RetrievalMethod.SEMANTIC_SEARCH
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id), str(RerankMode.RERANKING_MODEL), reranking_model, None, False
                        )
                        if dataset.is_multimodal:
                            model_manager = ModelManager()
                            is_support_vision = model_manager.check_model_support_vision(
                                tenant_id=dataset.tenant_id,
                                provider=reranking_model.get("reranking_provider_name") or "",
                                model=reranking_model.get("reranking_model_name") or "",
                                model_type=ModelType.RERANK,
                            )
                            if is_support_vision:
                                all_documents.extend(
                                    data_post_processor.invoke(
                                        query=query,
                                        documents=documents,
                                        score_threshold=score_threshold,
                                        top_n=len(documents),
                                        query_type=query_type,
                                    )
                                )
                            else:
                                # not effective, return original documents
                                all_documents.extend(documents)
                        else:
                            all_documents.extend(
                                data_post_processor.invoke(
                                    query=query,
                                    documents=documents,
                                    score_threshold=score_threshold,
                                    top_n=len(documents),
                                    query_type=query_type,
                                )
                            )
                    else:
                        all_documents.extend(documents)
            except Exception as e:
                exceptions.append(str(e))

    @classmethod
    def full_text_index_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float | None,
        reranking_model: dict | None,
        all_documents: list,
        retrieval_method: str,
        exceptions: list,
        document_ids_filter: list[str] | None = None,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                vector_processor = Vector(dataset=dataset)

                documents = vector_processor.search_by_full_text(
                    cls.escape_query_for_search(query), top_k=top_k, document_ids_filter=document_ids_filter
                )
                if documents:
                    if (
                        reranking_model
                        and reranking_model.get("reranking_model_name")
                        and reranking_model.get("reranking_provider_name")
                        and retrieval_method == RetrievalMethod.FULL_TEXT_SEARCH
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id), str(RerankMode.RERANKING_MODEL), reranking_model, None, False
                        )
                        all_documents.extend(
                            data_post_processor.invoke(
                                query=query,
                                documents=documents,
                                score_threshold=score_threshold,
                                top_n=len(documents),
                            )
                        )
                    else:
                        all_documents.extend(documents)
            except Exception as e:
                exceptions.append(str(e))

    @staticmethod
    def escape_query_for_search(query: str) -> str:
        return query.replace('"', '\\"')

    @classmethod
    def format_retrieval_documents(cls, documents: list[Document]) -> list[RetrievalSegments]:
        """Format retrieval documents with optimized batch processing"""
        if not documents:
            return []

        try:
            # Collect document IDs
            document_ids = {doc.metadata.get("document_id") for doc in documents if "document_id" in doc.metadata}
            if not document_ids:
                return []

            # Batch query dataset documents
            dataset_documents = {
                doc.id: doc
                for doc in db.session.query(DatasetDocument)
                .where(DatasetDocument.id.in_(document_ids))
                .options(load_only(DatasetDocument.id, DatasetDocument.doc_form, DatasetDocument.dataset_id))
                .all()
            }

            records = []
            include_segment_ids = set()
            segment_child_map = {}
            segment_file_map = {}
            with Session(bind=db.engine, expire_on_commit=False) as session:
                # Process documents
                for document in documents:
                    segment_id = None
                    attachment_info = None
                    child_chunk = None
                    document_id = document.metadata.get("document_id")
                    if document_id not in dataset_documents:
                        continue

                    dataset_document = dataset_documents[document_id]
                    if not dataset_document:
                        continue

                    if dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                        # Handle parent-child documents
                        if document.metadata.get("doc_type") == DocType.IMAGE:
                            attachment_info_dict = cls.get_segment_attachment_info(
                                dataset_document.dataset_id,
                                dataset_document.tenant_id,
                                document.metadata.get("doc_id") or "",
                                session,
                            )
                            if attachment_info_dict:
                                attachment_info = attachment_info_dict["attachment_info"]
                                segment_id = attachment_info_dict["segment_id"]
                        else:
                            child_index_node_id = document.metadata.get("doc_id")
                            child_chunk_stmt = select(ChildChunk).where(ChildChunk.index_node_id == child_index_node_id)
                            child_chunk = session.scalar(child_chunk_stmt)

                            if not child_chunk:
                                continue
                            segment_id = child_chunk.segment_id

                        if not segment_id:
                            continue

                        segment = (
                            session.query(DocumentSegment)
                            .where(
                                DocumentSegment.dataset_id == dataset_document.dataset_id,
                                DocumentSegment.enabled == True,
                                DocumentSegment.status == "completed",
                                DocumentSegment.id == segment_id,
                            )
                            .first()
                        )

                        if not segment:
                            continue

                        if segment.id not in include_segment_ids:
                            include_segment_ids.add(segment.id)
                            if child_chunk:
                                child_chunk_detail = {
                                    "id": child_chunk.id,
                                    "content": child_chunk.content,
                                    "position": child_chunk.position,
                                    "score": document.metadata.get("score", 0.0),
                                }
                                map_detail = {
                                    "max_score": document.metadata.get("score", 0.0),
                                    "child_chunks": [child_chunk_detail],
                                }
                                segment_child_map[segment.id] = map_detail
                            record = {
                                "segment": segment,
                            }
                            if attachment_info:
                                segment_file_map[segment.id] = [attachment_info]
                            records.append(record)
                        else:
                            if child_chunk:
                                child_chunk_detail = {
                                    "id": child_chunk.id,
                                    "content": child_chunk.content,
                                    "position": child_chunk.position,
                                    "score": document.metadata.get("score", 0.0),
                                }
                                segment_child_map[segment.id]["child_chunks"].append(child_chunk_detail)
                                segment_child_map[segment.id]["max_score"] = max(
                                    segment_child_map[segment.id]["max_score"], document.metadata.get("score", 0.0)
                                )
                            if attachment_info:
                                segment_file_map[segment.id].append(attachment_info)
                    else:
                        # Handle normal documents
                        segment = None
                        if document.metadata.get("doc_type") == DocType.IMAGE:
                            attachment_info_dict = cls.get_segment_attachment_info(
                                dataset_document.dataset_id,
                                dataset_document.tenant_id,
                                document.metadata.get("doc_id") or "",
                                session,
                            )
                            if attachment_info_dict:
                                attachment_info = attachment_info_dict["attachment_info"]
                                segment_id = attachment_info_dict["segment_id"]
                                document_segment_stmt = select(DocumentSegment).where(
                                    DocumentSegment.dataset_id == dataset_document.dataset_id,
                                    DocumentSegment.enabled == True,
                                    DocumentSegment.status == "completed",
                                    DocumentSegment.id == segment_id,
                                )
                                segment = session.scalar(document_segment_stmt)
                                if segment:
                                    segment_file_map[segment.id] = [attachment_info]
                        else:
                            index_node_id = document.metadata.get("doc_id")
                            if not index_node_id:
                                continue
                            document_segment_stmt = select(DocumentSegment).where(
                                DocumentSegment.dataset_id == dataset_document.dataset_id,
                                DocumentSegment.enabled == True,
                                DocumentSegment.status == "completed",
                                DocumentSegment.index_node_id == index_node_id,
                            )
                            segment = session.scalar(document_segment_stmt)

                        if not segment:
                            continue
                        if segment.id not in include_segment_ids:
                            include_segment_ids.add(segment.id)
                            record = {
                                "segment": segment,
                                "score": document.metadata.get("score"),  # type: ignore
                            }
                            if attachment_info:
                                segment_file_map[segment.id] = [attachment_info]
                            records.append(record)
                        else:
                            if attachment_info:
                                attachment_infos = segment_file_map.get(segment.id, [])
                                if attachment_info not in attachment_infos:
                                    attachment_infos.append(attachment_info)
                                segment_file_map[segment.id] = attachment_infos

            # Add child chunks information to records
            for record in records:
                if record["segment"].id in segment_child_map:
                    record["child_chunks"] = segment_child_map[record["segment"].id].get("child_chunks")  # type: ignore
                    record["score"] = segment_child_map[record["segment"].id]["max_score"]
                if record["segment"].id in segment_file_map:
                    record["files"] = segment_file_map[record["segment"].id]  # type: ignore[assignment]

            result = []
            for record in records:
                # Extract segment
                segment = record["segment"]

                # Extract child_chunks, ensuring it's a list or None
                child_chunks = record.get("child_chunks")
                if not isinstance(child_chunks, list):
                    child_chunks = None

                # Extract files, ensuring it's a list or None
                files = record.get("files")
                if not isinstance(files, list):
                    files = None

                # Extract score, ensuring it's a float or None
                score_value = record.get("score")
                score = (
                    float(score_value)
                    if score_value is not None and isinstance(score_value, int | float | str)
                    else None
                )

                # Create RetrievalSegments object
                retrieval_segment = RetrievalSegments(
                    segment=segment, child_chunks=child_chunks, score=score, files=files
                )
                result.append(retrieval_segment)

            return result
        except Exception as e:
            db.session.rollback()
            raise e

    def _retrieve(
        self,
        flask_app: Flask,
        retrieval_method: RetrievalMethod,
        dataset: Dataset,
        query: str | None = None,
        top_k: int = 4,
        score_threshold: float | None = 0.0,
        reranking_model: dict | None = None,
        reranking_mode: str = "reranking_model",
        weights: dict | None = None,
        document_ids_filter: list[str] | None = None,
        attachment_id: str | None = None,
        all_documents: list[Document] = [],
        exceptions: list[str] = [],
    ):
        if not query and not attachment_id:
            return
        with flask_app.app_context():
            all_documents_item: list[Document] = []
            # Optimize multithreading with thread pools
            with ThreadPoolExecutor(max_workers=dify_config.RETRIEVAL_SERVICE_EXECUTORS) as executor:  # type: ignore
                futures = []
                if retrieval_method == RetrievalMethod.KEYWORD_SEARCH and query:
                    futures.append(
                        executor.submit(
                            self.keyword_search,
                            flask_app=current_app._get_current_object(),  # type: ignore
                            dataset_id=dataset.id,
                            query=query,
                            top_k=top_k,
                            all_documents=all_documents_item,
                            exceptions=exceptions,
                            document_ids_filter=document_ids_filter,
                        )
                    )
                if RetrievalMethod.is_support_semantic_search(retrieval_method):
                    if query:
                        futures.append(
                            executor.submit(
                                self.embedding_search,
                                flask_app=current_app._get_current_object(),  # type: ignore
                                dataset_id=dataset.id,
                                query=query,
                                top_k=top_k,
                                score_threshold=score_threshold,
                                reranking_model=reranking_model,
                                all_documents=all_documents_item,
                                retrieval_method=retrieval_method,
                                exceptions=exceptions,
                                document_ids_filter=document_ids_filter,
                                query_type=QueryType.TEXT_QUERY,
                            )
                        )
                    if attachment_id:
                        futures.append(
                            executor.submit(
                                self.embedding_search,
                                flask_app=current_app._get_current_object(),  # type: ignore
                                dataset_id=dataset.id,
                                query=attachment_id,
                                top_k=top_k,
                                score_threshold=score_threshold,
                                reranking_model=reranking_model,
                                all_documents=all_documents_item,
                                retrieval_method=retrieval_method,
                                exceptions=exceptions,
                                document_ids_filter=document_ids_filter,
                                query_type=QueryType.IMAGE_QUERY,
                            )
                        )
                if RetrievalMethod.is_support_fulltext_search(retrieval_method) and query:
                    futures.append(
                        executor.submit(
                            self.full_text_index_search,
                            flask_app=current_app._get_current_object(),  # type: ignore
                            dataset_id=dataset.id,
                            query=query,
                            top_k=top_k,
                            score_threshold=score_threshold,
                            reranking_model=reranking_model,
                            all_documents=all_documents_item,
                            retrieval_method=retrieval_method,
                            exceptions=exceptions,
                            document_ids_filter=document_ids_filter,
                        )
                    )
                concurrent.futures.wait(futures, timeout=300, return_when=concurrent.futures.ALL_COMPLETED)

            if exceptions:
                raise ValueError(";\n".join(exceptions))

            # Deduplicate documents for hybrid search to avoid duplicate chunks
            if retrieval_method == RetrievalMethod.HYBRID_SEARCH:
                if attachment_id and reranking_mode == RerankMode.WEIGHTED_SCORE:
                    all_documents.extend(all_documents_item)
                all_documents_item = self._deduplicate_documents(all_documents_item)
                data_post_processor = DataPostProcessor(
                    str(dataset.tenant_id), reranking_mode, reranking_model, weights, False
                )

                query = query or attachment_id
                if not query:
                    return
                all_documents_item = data_post_processor.invoke(
                    query=query,
                    documents=all_documents_item,
                    score_threshold=score_threshold,
                    top_n=top_k,
                    query_type=QueryType.TEXT_QUERY if query else QueryType.IMAGE_QUERY,
                )

            all_documents.extend(all_documents_item)

    @classmethod
    def get_segment_attachment_info(
        cls, dataset_id: str, tenant_id: str, attachment_id: str, session: Session
    ) -> dict[str, Any] | None:
        upload_file = session.query(UploadFile).where(UploadFile.id == attachment_id).first()
        if upload_file:
            attachment_binding = (
                session.query(SegmentAttachmentBinding)
                .where(SegmentAttachmentBinding.attachment_id == upload_file.id)
                .first()
            )
            if attachment_binding:
                attachment_info = {
                    "id": upload_file.id,
                    "name": upload_file.name,
                    "extension": "." + upload_file.extension,
                    "mime_type": upload_file.mime_type,
                    "source_url": sign_upload_file(upload_file.id, upload_file.extension),
                    "size": upload_file.size,
                }
                return {"attachment_info": attachment_info, "segment_id": attachment_binding.segment_id}
        return None
