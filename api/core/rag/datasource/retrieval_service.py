import concurrent.futures
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from flask import Flask, current_app
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from configs import dify_config
from core.db.session_factory import session_factory
from core.model_manager import ModelManager
from core.model_runtime.entities.model_entities import ModelType
from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.embedding.retrieval import RetrievalChildChunk, RetrievalSegments
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

logger = logging.getLogger(__name__)


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

            if futures:
                for future in concurrent.futures.as_completed(futures, timeout=3600):
                    if exceptions:
                        for f in futures:
                            f.cancel()
                        break

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
        """Deduplicate documents in O(n) while preserving first-seen order.

        Rules:
        - For provider == "dify" and metadata["doc_id"] exists: keep the doc with the highest
          metadata["score"] among duplicates; if a later duplicate has no score, ignore it.
        - For non-dify documents (or dify without doc_id): deduplicate by content key
          (provider, page_content), keeping the first occurrence.
        """
        if not documents:
            return documents

        # Map of dedup key -> chosen Document
        chosen: dict[tuple, Document] = {}
        # Preserve the order of first appearance of each dedup key
        order: list[tuple] = []

        for doc in documents:
            is_dify = doc.provider == "dify"
            doc_id = (doc.metadata or {}).get("doc_id") if is_dify else None

            if is_dify and doc_id:
                key = ("dify", doc_id)
                if key not in chosen:
                    chosen[key] = doc
                    order.append(key)
                else:
                    # Only replace if the new one has a score and it's strictly higher
                    if "score" in doc.metadata:
                        new_score = float(doc.metadata.get("score", 0.0))
                        old_score = float(chosen[key].metadata.get("score", 0.0)) if chosen[key].metadata else 0.0
                        if new_score > old_score:
                            chosen[key] = doc
            else:
                # Content-based dedup for non-dify or dify without doc_id
                content_key = (doc.provider or "dify", doc.page_content)
                if content_key not in chosen:
                    chosen[content_key] = doc
                    order.append(content_key)
                # If duplicate content appears, we keep the first occurrence (no score comparison)

        return [chosen[k] for k in order]

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
                logger.error(e, exc_info=True)
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
                logger.error(e, exc_info=True)
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
                logger.error(e, exc_info=True)
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

            valid_dataset_documents = {}
            image_doc_ids: list[Any] = []
            child_index_node_ids = []
            index_node_ids = []
            doc_to_document_map = {}
            for document in documents:
                document_id = document.metadata.get("document_id")
                if document_id not in dataset_documents:
                    continue

                dataset_document = dataset_documents[document_id]
                if not dataset_document:
                    continue
                valid_dataset_documents[document_id] = dataset_document

                if dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                    doc_id = document.metadata.get("doc_id") or ""
                    doc_to_document_map[doc_id] = document
                    if document.metadata.get("doc_type") == DocType.IMAGE:
                        image_doc_ids.append(doc_id)
                    else:
                        child_index_node_ids.append(doc_id)
                else:
                    doc_id = document.metadata.get("doc_id") or ""
                    doc_to_document_map[doc_id] = document
                    if document.metadata.get("doc_type") == DocType.IMAGE:
                        image_doc_ids.append(doc_id)
                    else:
                        index_node_ids.append(doc_id)

            image_doc_ids = [i for i in image_doc_ids if i]
            child_index_node_ids = [i for i in child_index_node_ids if i]
            index_node_ids = [i for i in index_node_ids if i]

            segment_ids: list[str] = []
            index_node_segments: list[DocumentSegment] = []
            segments: list[DocumentSegment] = []
            attachment_map: dict[str, list[dict[str, Any]]] = {}
            child_chunk_map: dict[str, list[ChildChunk]] = {}
            doc_segment_map: dict[str, list[str]] = {}

            with session_factory.create_session() as session:
                attachments = cls.get_segment_attachment_infos(image_doc_ids, session)

                for attachment in attachments:
                    segment_ids.append(attachment["segment_id"])
                    if attachment["segment_id"] in attachment_map:
                        attachment_map[attachment["segment_id"]].append(attachment["attachment_info"])
                    else:
                        attachment_map[attachment["segment_id"]] = [attachment["attachment_info"]]
                    if attachment["segment_id"] in doc_segment_map:
                        doc_segment_map[attachment["segment_id"]].append(attachment["attachment_id"])
                    else:
                        doc_segment_map[attachment["segment_id"]] = [attachment["attachment_id"]]
                child_chunk_stmt = select(ChildChunk).where(ChildChunk.index_node_id.in_(child_index_node_ids))
                child_index_nodes = session.execute(child_chunk_stmt).scalars().all()

                for i in child_index_nodes:
                    segment_ids.append(i.segment_id)
                    if i.segment_id in child_chunk_map:
                        child_chunk_map[i.segment_id].append(i)
                    else:
                        child_chunk_map[i.segment_id] = [i]
                    if i.segment_id in doc_segment_map:
                        doc_segment_map[i.segment_id].append(i.index_node_id)
                    else:
                        doc_segment_map[i.segment_id] = [i.index_node_id]

                if index_node_ids:
                    document_segment_stmt = select(DocumentSegment).where(
                        DocumentSegment.enabled == True,
                        DocumentSegment.status == "completed",
                        DocumentSegment.index_node_id.in_(index_node_ids),
                    )
                    index_node_segments = session.execute(document_segment_stmt).scalars().all()  # type: ignore
                    for index_node_segment in index_node_segments:
                        doc_segment_map[index_node_segment.id] = [index_node_segment.index_node_id]
                if segment_ids:
                    document_segment_stmt = select(DocumentSegment).where(
                        DocumentSegment.enabled == True,
                        DocumentSegment.status == "completed",
                        DocumentSegment.id.in_(segment_ids),
                    )
                    segments = session.execute(document_segment_stmt).scalars().all()  # type: ignore

                if index_node_segments:
                    segments.extend(index_node_segments)

            for segment in segments:
                child_chunks: list[ChildChunk] = child_chunk_map.get(segment.id, [])
                attachment_infos: list[dict[str, Any]] = attachment_map.get(segment.id, [])
                ds_dataset_document: DatasetDocument | None = valid_dataset_documents.get(segment.document_id)

                if ds_dataset_document and ds_dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                    if segment.id not in include_segment_ids:
                        include_segment_ids.add(segment.id)
                        if child_chunks or attachment_infos:
                            child_chunk_details = []
                            max_score = 0.0
                            for child_chunk in child_chunks:
                                document = doc_to_document_map[child_chunk.index_node_id]
                                child_chunk_detail = {
                                    "id": child_chunk.id,
                                    "content": child_chunk.content,
                                    "position": child_chunk.position,
                                    "score": document.metadata.get("score", 0.0) if document else 0.0,
                                }
                                child_chunk_details.append(child_chunk_detail)
                                max_score = max(max_score, document.metadata.get("score", 0.0) if document else 0.0)
                            for attachment_info in attachment_infos:
                                file_document = doc_to_document_map[attachment_info["id"]]
                                max_score = max(
                                    max_score, file_document.metadata.get("score", 0.0) if file_document else 0.0
                                )

                            map_detail = {
                                "max_score": max_score,
                                "child_chunks": child_chunk_details,
                            }
                            segment_child_map[segment.id] = map_detail
                        record: dict[str, Any] = {
                            "segment": segment,
                        }
                        records.append(record)
                else:
                    if segment.id not in include_segment_ids:
                        include_segment_ids.add(segment.id)
                        max_score = 0.0
                        segment_document = doc_to_document_map.get(segment.index_node_id)
                        if segment_document:
                            max_score = max(max_score, segment_document.metadata.get("score", 0.0))
                        for attachment_info in attachment_infos:
                            file_doc = doc_to_document_map.get(attachment_info["id"])
                            if file_doc:
                                max_score = max(max_score, file_doc.metadata.get("score", 0.0))
                        record = {
                            "segment": segment,
                            "score": max_score,
                        }
                        records.append(record)

            # Add child chunks information to records
            for record in records:
                if record["segment"].id in segment_child_map:
                    record["child_chunks"] = segment_child_map[record["segment"].id].get("child_chunks")  # type: ignore
                    record["score"] = segment_child_map[record["segment"].id]["max_score"]  # type: ignore
                if record["segment"].id in attachment_map:
                    record["files"] = attachment_map[record["segment"].id]  # type: ignore[assignment]

            result: list[RetrievalSegments] = []
            for record in records:
                # Extract segment
                segment = record["segment"]

                # Extract child_chunks, ensuring it's a list or None
                raw_child_chunks = record.get("child_chunks")
                child_chunks_list: list[RetrievalChildChunk] | None = None
                if isinstance(raw_child_chunks, list):
                    # Sort by score descending
                    sorted_chunks = sorted(raw_child_chunks, key=lambda x: x.get("score", 0.0), reverse=True)
                    child_chunks_list = [
                        RetrievalChildChunk(
                            id=chunk["id"],
                            content=chunk["content"],
                            score=chunk.get("score", 0.0),
                            position=chunk["position"],
                        )
                        for chunk in sorted_chunks
                    ]

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
                    segment=segment, child_chunks=child_chunks_list, score=score, files=files
                )
                result.append(retrieval_segment)

            return sorted(result, key=lambda x: x.score if x.score is not None else 0.0, reverse=True)
        except Exception as e:
            db.session.rollback()
            raise e

    def _retrieve(
        self,
        flask_app: Flask,
        retrieval_method: RetrievalMethod,
        dataset: Dataset,
        all_documents: list[Document],
        exceptions: list[str],
        query: str | None = None,
        top_k: int = 4,
        score_threshold: float | None = 0.0,
        reranking_model: dict | None = None,
        reranking_mode: str = "reranking_model",
        weights: dict | None = None,
        document_ids_filter: list[str] | None = None,
        attachment_id: str | None = None,
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
                # Use as_completed for early error propagation - cancel remaining futures on first error
                if futures:
                    for future in concurrent.futures.as_completed(futures, timeout=300):
                        if future.exception():
                            # Cancel remaining futures to avoid unnecessary waiting
                            for f in futures:
                                f.cancel()
                            break

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

    @classmethod
    def get_segment_attachment_infos(cls, attachment_ids: list[str], session: Session) -> list[dict[str, Any]]:
        attachment_infos = []
        upload_files = session.query(UploadFile).where(UploadFile.id.in_(attachment_ids)).all()
        if upload_files:
            upload_file_ids = [upload_file.id for upload_file in upload_files]
            attachment_bindings = (
                session.query(SegmentAttachmentBinding)
                .where(SegmentAttachmentBinding.attachment_id.in_(upload_file_ids))
                .all()
            )
            attachment_binding_map = {binding.attachment_id: binding for binding in attachment_bindings}

            if attachment_bindings:
                for upload_file in upload_files:
                    attachment_binding = attachment_binding_map.get(upload_file.id)
                    attachment_info = {
                        "id": upload_file.id,
                        "name": upload_file.name,
                        "extension": "." + upload_file.extension,
                        "mime_type": upload_file.mime_type,
                        "source_url": sign_upload_file(upload_file.id, upload_file.extension),
                        "size": upload_file.size,
                    }
                    if attachment_binding:
                        attachment_infos.append(
                            {
                                "attachment_id": attachment_binding.attachment_id,
                                "attachment_info": attachment_info,
                                "segment_id": attachment_binding.segment_id,
                            }
                        )
        return attachment_infos
