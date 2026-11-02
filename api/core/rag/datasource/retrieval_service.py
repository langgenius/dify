import concurrent.futures
import logging
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from typing import Any, NotRequired, TypedDict

from flask import Flask, current_app
from sqlalchemy import select, tuple_
from sqlalchemy.orm import Session, load_only, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.model_manager import ModelManager
from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.index_processor.constant.query_type import QueryType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from extensions.otel import propagate_context, trace_span
from graphon.model_runtime.entities.model_entities import ModelType
from models.dataset import (
    ChildChunk,
    Dataset,
    DocumentSegment,
    DocumentSegmentSummary,
    SegmentAttachmentBinding,
)
from models.dataset import Document as DatasetDocument
from models.enums import SummaryStatus
from models.model import UploadFile
from repositories.knowledge.dataset_retrieval_repository import (
    get_dataset_retrieval_target,
    verify_dataset_retrieval_target,
)
from services.knowledge.entities.retrieval import AttachmentInfoDict
from services.knowledge.entities.retrieval_settings import RerankingModelDict, WeightsDict
from services.knowledge.retrieval.records import RetrievalChildChunk, RetrievalSegments


class SegmentAttachmentInfoResult(TypedDict):
    tenant_id: str
    dataset_id: str
    document_id: str
    attachment_id: str
    attachment_info: AttachmentInfoDict
    segment_id: str


class ChildChunkDetail(TypedDict):
    id: str
    content: str
    position: int
    score: float


class SegmentChildMapDetail(TypedDict):
    max_score: float
    child_chunks: list[ChildChunkDetail]


class SegmentRecord(TypedDict):
    segment: DocumentSegment
    score: NotRequired[float]
    child_chunks: NotRequired[list[ChildChunkDetail]]
    files: NotRequired[list[AttachmentInfoDict]]


class DefaultRetrievalModelDict(TypedDict):
    search_method: RetrievalMethod
    reranking_enable: bool
    reranking_model: RerankingModelDict
    reranking_mode: NotRequired[str]
    weights: NotRequired[WeightsDict | None]
    score_threshold: NotRequired[float]
    top_k: int
    score_threshold_enabled: bool


default_retrieval_model: DefaultRetrievalModelDict = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}

logger = logging.getLogger(__name__)
_file_access_controller = DatabaseFileAccessController()


class RetrievalService:
    # Cache precompiled regular expressions to avoid repeated compilation
    @classmethod
    @trace_span()
    def retrieve(
        cls,
        retrieval_method: RetrievalMethod,
        dataset_id: str,
        query: str,
        top_k: int = 4,
        score_threshold: float | None = 0.0,
        reranking_model: RerankingModelDict | None = None,
        reranking_mode: str = "reranking_model",
        weights: WeightsDict | None = None,
        document_ids_filter: list[str] | None = None,
        allowed_document_ids_filter: Sequence[str] | None = None,
        attachment_ids: list[str] | None = None,
    ):
        if not query and not attachment_ids:
            return []
        dataset = cls._get_dataset(dataset_id)
        if not dataset:
            return []

        target = None
        if dataset.provider != "external" and dataset.indexing_technique == "high_quality":
            target = get_dataset_retrieval_target(dataset)

        allowed_document_ids = (
            tuple(dict.fromkeys(str(document_id) for document_id in allowed_document_ids_filter))
            if allowed_document_ids_filter is not None
            else None
        )
        all_documents: list[Document] = []
        exceptions: list[str] = []

        # Optimize multithreading with thread pools
        with ThreadPoolExecutor(max_workers=dify_config.RETRIEVAL_SERVICE_EXECUTORS) as executor:  # type: ignore
            futures = []
            retrieval_service = RetrievalService()
            if query:
                futures.append(
                    executor.submit(
                        propagate_context(retrieval_service._retrieve),
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
                        allowed_document_ids_filter=allowed_document_ids,
                        attachment_id=None,
                        all_documents=all_documents,
                        exceptions=exceptions,
                    )
                )
            if attachment_ids:
                for attachment_id in attachment_ids:
                    futures.append(
                        executor.submit(
                            propagate_context(retrieval_service._retrieve),
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
                            allowed_document_ids_filter=allowed_document_ids,
                            attachment_id=attachment_id,
                            all_documents=all_documents,
                            exceptions=exceptions,
                        )
                    )

            if futures:
                for future in concurrent.futures.as_completed(futures, timeout=3600):
                    try:
                        future.result()
                    except Exception:
                        for pending_future in futures:
                            if pending_future is not future:
                                pending_future.cancel()
                        raise

        if exceptions:
            raise ValueError(";\n".join(exceptions))

        if target is not None:
            with Session(db.engine) as readiness_session:
                verify_dataset_retrieval_target(readiness_session, target)

        for document in all_documents:
            # These values are stamped after provider retrieval and therefore
            # describe the trusted query scope, not provider-owned metadata.
            document.metadata["_retrieval_source_dataset_id"] = dataset_id
            if allowed_document_ids is not None:
                document.metadata["_retrieval_allowed_document_ids"] = allowed_document_ids
            else:
                document.metadata.pop("_retrieval_allowed_document_ids", None)

        all_documents = cls._deduplicate_documents(all_documents)
        all_documents.sort(
            key=lambda document: float((document.metadata or {}).get("score") or 0.0),
            reverse=True,
        )
        # Keep the bounded per-backend candidate pool intact until persisted
        # eligibility is known. A stale high-scoring vector must not evict a
        # current lower-scoring hit before canonical retrieval finalization.
        return all_documents

    @classmethod
    def _filter_documents_by_vector_score_threshold(
        cls, documents: list[Document], score_threshold: float | None
    ) -> list[Document]:
        """Keep documents whose stored retrieval score meets the threshold.

        Used when hybrid search skips early vector thresholding but no rerank
        runner applies a threshold afterward (same rule as ``calculate_vector_score``).
        """
        if score_threshold is None:
            return documents
        return [
            document
            for document in documents
            if document.metadata and document.metadata.get("score", 0) >= score_threshold
        ]

    @classmethod
    def _deduplicate_documents(cls, documents: list[Document]) -> list[Document]:
        """Deduplicate documents in O(n) while preserving first-seen order.

        Rules:
        - If metadata["doc_id"] exists (any provider): deduplicate by (provider, doc_id) key;
          keep the doc with the highest metadata["score"] among duplicates. If a later duplicate
          has no score, ignore it.
        - If metadata["doc_id"] is absent: deduplicate by content key (provider, page_content),
          keeping the first occurrence.
        """
        if not documents:
            return documents

        # Map of dedup key -> chosen Document
        chosen: dict[tuple, Document] = {}
        # Preserve the order of first appearance of each dedup key
        order: list[tuple] = []

        for doc in documents:
            doc_id = (doc.metadata or {}).get("doc_id")

            if doc_id:
                key = (doc.provider or "dify", doc_id)
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
            return session.scalar(select(Dataset).where(Dataset.id == dataset_id).limit(1))

    @classmethod
    @trace_span()
    def keyword_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        all_documents: list[Document],
        exceptions: list[str],
        document_ids_filter: list[str] | None = None,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                keyword = Keyword(dataset=dataset)

                with Session(db.engine) as session:
                    documents = keyword.search(
                        cls.escape_query_for_search(query),
                        session=session,
                        top_k=top_k,
                        document_ids_filter=document_ids_filter,
                    )
                all_documents.extend(documents)
            except Exception as e:
                logger.error(e, exc_info=True)
                exceptions.append(str(e))

    @classmethod
    @trace_span()
    def embedding_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float | None,
        reranking_model: RerankingModelDict | None,
        all_documents: list[Document],
        retrieval_method: RetrievalMethod,
        exceptions: list[str],
        document_ids_filter: list[str] | None = None,
        allowed_document_ids_filter: Sequence[str] | None = None,
        query_type: QueryType = QueryType.TEXT_QUERY,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                documents = []
                # Hybrid search merges keyword / full-text / vector hits and then reranks
                # (weighted fusion or reranking model). Applying the user score threshold at
                # vector retrieval time uses embedding similarity, which is not comparable to
                # reranked or fused scores and incorrectly drops high-quality chunks (#35233).
                embedding_score_threshold = (
                    0.0 if retrieval_method == RetrievalMethod.HYBRID_SEARCH else score_threshold
                )
                if query_type == QueryType.IMAGE_QUERY and not dataset.is_multimodal:
                    return

                query_file_key: str | None = None
                with Session(db.engine) as session:
                    vector_type = Vector.resolve_vector_type(dataset, session=session)
                    if query_type == QueryType.IMAGE_QUERY:
                        query_file_stmt = select(UploadFile).where(
                            UploadFile.id == query,
                            UploadFile.tenant_id == dataset.tenant_id,
                        )
                        query_file = session.scalar(_file_access_controller.apply_upload_file_filters(query_file_stmt))
                        if query_file is None:
                            raise ValueError("Attachment file is not accessible")
                        query_file_key = query_file.key

                vector = Vector(dataset=dataset, session=None, vector_type=vector_type)
                if query_type == QueryType.TEXT_QUERY:
                    documents.extend(
                        vector.search_by_vector(
                            query,
                            search_type="similarity_score_threshold",
                            top_k=top_k,
                            score_threshold=embedding_score_threshold,
                            filter={"group_id": [dataset.id]},
                            document_ids_filter=document_ids_filter,
                        )
                    )
                if query_type == QueryType.IMAGE_QUERY:
                    assert query_file_key is not None
                    documents.extend(
                        vector.search_by_file(
                            file_id=query,
                            file_key=query_file_key,
                            top_k=top_k,
                            score_threshold=embedding_score_threshold,
                            filter={"group_id": [dataset.id]},
                            document_ids_filter=document_ids_filter,
                        )
                    )

                if documents:
                    if (
                        reranking_model
                        and reranking_model["reranking_model_name"]
                        and reranking_model["reranking_provider_name"]
                        and retrieval_method == RetrievalMethod.SEMANTIC_SEARCH
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id),
                            str(RerankMode.RERANKING_MODEL),
                            reranking_model,
                            None,
                            False,
                            session_factory=sessionmaker(bind=db.engine),
                            dataset_document_filters={dataset.id: allowed_document_ids_filter},
                        )
                        if dataset.is_multimodal:
                            model_manager = ModelManager.for_tenant(tenant_id=dataset.tenant_id)
                            is_support_vision = model_manager.check_model_support_vision(
                                tenant_id=dataset.tenant_id,
                                provider=reranking_model["reranking_provider_name"],
                                model=reranking_model["reranking_model_name"],
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
    @trace_span()
    def full_text_index_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float | None,
        reranking_model: RerankingModelDict | None,
        all_documents: list[Document],
        retrieval_method: str,
        exceptions: list[str],
        document_ids_filter: list[str] | None = None,
        allowed_document_ids_filter: Sequence[str] | None = None,
    ):
        with flask_app.app_context():
            try:
                dataset = cls._get_dataset(dataset_id)
                if not dataset:
                    raise ValueError("dataset not found")

                with Session(db.engine) as session:
                    vector_type = Vector.resolve_vector_type(dataset, session=session)

                vector_processor = Vector(dataset=dataset, session=None, vector_type=vector_type)
                documents = vector_processor.search_by_full_text(
                    cls.escape_query_for_search(query), top_k=top_k, document_ids_filter=document_ids_filter
                )
                if documents:
                    if (
                        reranking_model
                        and reranking_model["reranking_model_name"]
                        and reranking_model["reranking_provider_name"]
                        and retrieval_method == RetrievalMethod.FULL_TEXT_SEARCH
                    ):
                        data_post_processor = DataPostProcessor(
                            str(dataset.tenant_id),
                            str(RerankMode.RERANKING_MODEL),
                            reranking_model,
                            None,
                            False,
                            session_factory=sessionmaker(bind=db.engine),
                            dataset_document_filters={dataset.id: allowed_document_ids_filter},
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
    def format_retrieval_documents(
        cls,
        session: Session,
        documents: list[Document],
    ) -> list[RetrievalSegments]:
        """Purely resolve raw candidates to their current persisted segments."""
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
                for doc in session.scalars(
                    select(DatasetDocument)
                    .where(DatasetDocument.id.in_(document_ids))
                    .options(
                        load_only(
                            DatasetDocument.id,
                            DatasetDocument.tenant_id,
                            DatasetDocument.doc_form,
                            DatasetDocument.dataset_id,
                        )
                    )
                ).all()
            }

            valid_dataset_documents = {}
            image_doc_ids: list[Any] = []
            child_index_node_ids = []
            index_node_ids = []
            doc_to_document_map = {}
            attachment_candidate_map: dict[tuple[str, str, str, str], Document] = {}
            summary_segment_ids = set()  # Track segments retrieved via summary
            summary_score_map: dict[str, float] = {}  # Map original_chunk_id to summary score
            segment_summary_map: dict[str, str] = {}  # Map segment_id to summary content
            summary_candidates: list[tuple[str, str, str, str, str, Any]] = []

            # First pass: collect all document IDs and identify summary documents
            for document in documents:
                document_id = document.metadata.get("document_id")
                if document_id not in dataset_documents:
                    continue

                dataset_document = dataset_documents[document_id]
                if not dataset_document:
                    continue
                valid_dataset_documents[document_id] = dataset_document

                doc_id = document.metadata.get("doc_id") or ""
                doc_to_document_map[doc_id] = document

                if document.metadata.get("doc_type") == DocType.IMAGE:
                    source_dataset_id = document.metadata.get("_retrieval_source_dataset_id")
                    if source_dataset_id != dataset_document.dataset_id:
                        continue
                    attachment_candidate_map[
                        (
                            dataset_document.tenant_id,
                            dataset_document.dataset_id,
                            dataset_document.id,
                            str(doc_id),
                        )
                    ] = document

                # Check if this is a summary document
                is_summary = document.metadata.get("is_summary", False)
                if is_summary:
                    original_chunk_id = document.metadata.get("original_chunk_id")
                    if original_chunk_id and doc_id:
                        summary_candidates.append(
                            (
                                dataset_document.tenant_id,
                                dataset_document.dataset_id,
                                dataset_document.id,
                                original_chunk_id,
                                doc_id,
                                document.metadata.get("score"),
                            )
                        )
                    continue  # Skip adding to other lists for summary documents

                if dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                    if document.metadata.get("doc_type") == DocType.IMAGE:
                        image_doc_ids.append(doc_id)
                    else:
                        child_index_node_ids.append(doc_id)
                else:
                    if document.metadata.get("doc_type") == DocType.IMAGE:
                        image_doc_ids.append(doc_id)
                    else:
                        index_node_ids.append(doc_id)

            # A vector can remain queryable while deletion is being retried.
            # Accept summary hits only when their node is still the exact node
            # published by the current, owned summary generation.
            if summary_candidates:
                candidate_chunk_ids = {candidate[3] for candidate in summary_candidates}
                candidate_dataset_ids = {candidate[1] for candidate in summary_candidates}
                candidate_document_ids = {candidate[2] for candidate in summary_candidates}
                candidate_tenant_ids = {candidate[0] for candidate in summary_candidates}
                current_summaries = session.execute(
                    select(DocumentSegmentSummary, Dataset.tenant_id)
                    .join(Dataset, Dataset.id == DocumentSegmentSummary.dataset_id)
                    .where(
                        Dataset.tenant_id.in_(candidate_tenant_ids),
                        DocumentSegmentSummary.dataset_id.in_(candidate_dataset_ids),
                        DocumentSegmentSummary.document_id.in_(candidate_document_ids),
                        DocumentSegmentSummary.chunk_id.in_(candidate_chunk_ids),
                        DocumentSegmentSummary.status == SummaryStatus.COMPLETED,
                        DocumentSegmentSummary.enabled.is_(True),
                        DocumentSegmentSummary.summary_index_node_id.is_not(None),
                    )
                ).all()
                current_summary_by_node = {
                    (
                        tenant_id,
                        summary.dataset_id,
                        summary.document_id,
                        summary.chunk_id,
                        summary.summary_index_node_id,
                    ): summary
                    for summary, tenant_id in current_summaries
                }
                for tenant_id, dataset_id, document_id, chunk_id, node_id, score in summary_candidates:
                    summary = current_summary_by_node.get((tenant_id, dataset_id, document_id, chunk_id, node_id))
                    if summary is None:
                        continue
                    summary_segment_ids.add(chunk_id)
                    if summary.summary_content:
                        segment_summary_map[chunk_id] = summary.summary_content
                    if score is not None:
                        try:
                            summary_score = float(score)
                            summary_score_map[chunk_id] = max(
                                summary_score_map.get(chunk_id, summary_score), summary_score
                            )
                        except (ValueError, TypeError):
                            pass

            image_doc_ids = [i for i in image_doc_ids if i]
            child_index_node_ids = [i for i in child_index_node_ids if i]
            index_node_ids = [i for i in index_node_ids if i]

            segment_ids: list[str] = []
            index_node_segments: Sequence[DocumentSegment] = []
            segments: list[DocumentSegment] = []
            attachment_map: dict[str, list[AttachmentInfoDict]] = {}
            attachment_score_map: dict[str, float] = {}
            child_chunk_map: dict[str, list[ChildChunk]] = {}
            doc_segment_map: dict[str, list[str]] = {}

            dataset_refs = tuple(
                {(document.tenant_id, document.dataset_id) for document in valid_dataset_documents.values()}
            )
            attachments = cls.get_segment_attachment_infos(
                image_doc_ids,
                dataset_refs=dataset_refs,
                session=session,
            )

            for attachment in attachments:
                candidate_key = (
                    attachment["tenant_id"],
                    attachment["dataset_id"],
                    attachment["document_id"],
                    attachment["attachment_id"],
                )
                attachment_candidate = attachment_candidate_map.get(candidate_key)
                if attachment_candidate is None:
                    continue
                attachment_score = attachment_candidate.metadata.get("score", 0.0)
                with suppress(TypeError, ValueError):
                    attachment_score_map[attachment["segment_id"]] = max(
                        attachment_score_map.get(attachment["segment_id"], 0.0),
                        float(attachment_score),
                    )
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
                assert i.index_node_id
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
                    DocumentSegment.enabled.is_(True),
                    DocumentSegment.status == "completed",
                    DocumentSegment.index_node_id.in_(index_node_ids),
                )
                index_node_segments = session.execute(document_segment_stmt).scalars().all()
                for index_node_segment in index_node_segments:
                    assert index_node_segment.index_node_id
                    doc_segment_map[index_node_segment.id] = [index_node_segment.index_node_id]

            if segment_ids:
                document_segment_stmt = select(DocumentSegment).where(
                    DocumentSegment.enabled.is_(True),
                    DocumentSegment.status == "completed",
                    DocumentSegment.id.in_(segment_ids),
                )
                segments = session.execute(document_segment_stmt).scalars().all()  # type: ignore

            if index_node_segments:
                segments.extend(index_node_segments)

            # Handle summary documents: query segments by original_chunk_id
            if summary_segment_ids:
                summary_segment_ids_list = list(summary_segment_ids)
                summary_segment_stmt = select(DocumentSegment).where(
                    DocumentSegment.enabled.is_(True),
                    DocumentSegment.status == "completed",
                    DocumentSegment.id.in_(summary_segment_ids_list),
                )
                summary_segments = session.execute(summary_segment_stmt).scalars().all()  # type: ignore
                segments.extend(summary_segments)
                # Add summary segment IDs to segment_ids for summary query
                for seg in summary_segments:
                    if seg.id not in segment_ids:
                        segment_ids.append(seg.id)

            include_segment_ids = set()
            segment_child_map: dict[str, SegmentChildMapDetail] = {}
            records: list[SegmentRecord] = []

            for segment in segments:
                child_chunks: list[ChildChunk] = child_chunk_map.get(segment.id, [])
                attachment_infos: list[AttachmentInfoDict] = attachment_map.get(segment.id, [])
                ds_dataset_document: DatasetDocument | None = valid_dataset_documents.get(segment.document_id)

                if ds_dataset_document and ds_dataset_document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                    if segment.id not in include_segment_ids:
                        include_segment_ids.add(segment.id)
                        # Check if this segment was retrieved via summary
                        # Use summary score as base score if available, otherwise 0.0
                        max_score = summary_score_map.get(segment.id, 0.0)

                        if child_chunks or attachment_infos:
                            child_chunk_details: list[ChildChunkDetail] = []
                            for child_chunk in child_chunks:
                                child_document: Document | None = doc_to_document_map.get(child_chunk.index_node_id)
                                child_score = child_document.metadata.get("score", 0.0) if child_document else 0.0
                                child_chunk_detail: ChildChunkDetail = {
                                    "id": child_chunk.id,
                                    "content": child_chunk.content,
                                    "position": child_chunk.position,
                                    "score": child_score,
                                }
                                child_chunk_details.append(child_chunk_detail)
                                max_score = max(max_score, child_score)
                            if attachment_infos:
                                max_score = max(max_score, attachment_score_map.get(segment.id, 0.0))

                            map_detail: SegmentChildMapDetail = {
                                "max_score": max_score,
                                "child_chunks": child_chunk_details,
                            }
                            segment_child_map[segment.id] = map_detail
                        else:
                            # No child chunks or attachments, use summary score if available
                            summary_score = summary_score_map.get(segment.id)
                            if summary_score is not None:
                                segment_child_map[segment.id] = {
                                    "max_score": summary_score,
                                    "child_chunks": [],
                                }
                        record: SegmentRecord = {
                            "segment": segment,
                        }
                        records.append(record)
                else:
                    if segment.id not in include_segment_ids:
                        include_segment_ids.add(segment.id)

                        # Check if this segment was retrieved via summary
                        # Use summary score if available (summary retrieval takes priority)
                        max_score = summary_score_map.get(segment.id, 0.0)

                        # If not retrieved via summary, use original segment's score
                        if segment.id not in summary_score_map:
                            segment_document = doc_to_document_map.get(segment.index_node_id)
                            if segment_document:
                                max_score = max(max_score, segment_document.metadata.get("score", 0.0))

                        # Also consider attachment scores
                        if attachment_infos:
                            max_score = max(max_score, attachment_score_map.get(segment.id, 0.0))

                        another_record: SegmentRecord = {
                            "segment": segment,
                            "score": max_score,
                        }
                        records.append(another_record)

            # Add child chunks information to records
            for record in records:
                if record["segment"].id in segment_child_map:
                    record["child_chunks"] = segment_child_map[record["segment"].id]["child_chunks"]
                    record["score"] = segment_child_map[record["segment"].id]["max_score"]
                if record["segment"].id in attachment_map:
                    record["files"] = attachment_map[record["segment"].id]

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

                # Extract summary if this segment was retrieved via summary
                summary_content = segment_summary_map.get(segment.id)

                # Create RetrievalSegments object
                retrieval_segment = RetrievalSegments(
                    segment=segment,
                    child_chunks=child_chunks_list,
                    score=score,
                    files=files,
                    summary=summary_content,
                )
                result.append(retrieval_segment)

            return sorted(result, key=lambda x: x.score if x.score is not None else 0.0, reverse=True)
        except Exception as e:
            session.rollback()
            raise e

    @trace_span()
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
        reranking_model: RerankingModelDict | None = None,
        reranking_mode: str = "reranking_model",
        weights: WeightsDict | None = None,
        document_ids_filter: list[str] | None = None,
        allowed_document_ids_filter: Sequence[str] | None = None,
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
                            propagate_context(self.keyword_search),
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
                                propagate_context(self.embedding_search),
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
                                allowed_document_ids_filter=allowed_document_ids_filter,
                                query_type=QueryType.TEXT_QUERY,
                            )
                        )
                    if attachment_id:
                        futures.append(
                            executor.submit(
                                propagate_context(self.embedding_search),
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
                                allowed_document_ids_filter=allowed_document_ids_filter,
                                query_type=QueryType.IMAGE_QUERY,
                            )
                        )
                if RetrievalMethod.is_support_fulltext_search(retrieval_method) and query:
                    futures.append(
                        executor.submit(
                            propagate_context(self.full_text_index_search),
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
                            allowed_document_ids_filter=allowed_document_ids_filter,
                        )
                    )
                # Use as_completed for early error propagation - cancel remaining futures on first error
                if futures:
                    for future in concurrent.futures.as_completed(futures, timeout=300):
                        try:
                            future.result()
                        except Exception:
                            for pending_future in futures:
                                if pending_future is not future:
                                    pending_future.cancel()
                            raise

            if exceptions:
                raise ValueError(";\n".join(exceptions))

            # Deduplicate documents for hybrid search to avoid duplicate chunks
            if retrieval_method == RetrievalMethod.HYBRID_SEARCH:
                if attachment_id and reranking_mode == RerankMode.WEIGHTED_SCORE:
                    all_documents.extend(all_documents_item)
                all_documents_item = self._deduplicate_documents(all_documents_item)

                if query:
                    rerank_query = query
                    query_type = QueryType.TEXT_QUERY
                elif attachment_id:
                    rerank_query = attachment_id
                    query_type = QueryType.IMAGE_QUERY
                else:
                    return
                data_post_processor = DataPostProcessor(
                    str(dataset.tenant_id),
                    reranking_mode,
                    reranking_model,
                    weights,
                    False,
                    session_factory=sessionmaker(bind=db.engine),
                    dataset_document_filters={dataset.id: allowed_document_ids_filter},
                )
                all_documents_item = data_post_processor.invoke(
                    query=rerank_query,
                    documents=all_documents_item,
                    score_threshold=score_threshold,
                    top_n=len(all_documents_item),
                    query_type=query_type,
                )
                if not data_post_processor.rerank_runner and score_threshold:
                    all_documents_item = self._filter_documents_by_vector_score_threshold(
                        all_documents_item, score_threshold
                    )

            all_documents.extend(all_documents_item)

    @classmethod
    def get_segment_attachment_infos(
        cls,
        attachment_ids: list[str],
        *,
        dataset_refs: Sequence[tuple[str, str]],
        session: Session,
    ) -> list[SegmentAttachmentInfoResult]:
        if not attachment_ids or not dataset_refs:
            return []
        binding_files = session.execute(
            select(SegmentAttachmentBinding, UploadFile)
            .join(
                UploadFile,
                (UploadFile.id == SegmentAttachmentBinding.attachment_id)
                & (UploadFile.tenant_id == SegmentAttachmentBinding.tenant_id),
            )
            .where(
                SegmentAttachmentBinding.attachment_id.in_(attachment_ids),
                tuple_(SegmentAttachmentBinding.tenant_id, SegmentAttachmentBinding.dataset_id).in_(dataset_refs),
            )
            .order_by(
                SegmentAttachmentBinding.tenant_id,
                SegmentAttachmentBinding.dataset_id,
                SegmentAttachmentBinding.document_id,
                SegmentAttachmentBinding.segment_id,
                SegmentAttachmentBinding.attachment_id,
            )
        ).all()
        attachment_infos: list[SegmentAttachmentInfoResult] = []
        for attachment_binding, upload_file in binding_files:
            info: AttachmentInfoDict = {
                "id": upload_file.id,
                "name": upload_file.name,
                "extension": "." + upload_file.extension,
                "mime_type": upload_file.mime_type,
                "source_url": "",
                "size": upload_file.size,
            }
            attachment_infos.append(
                {
                    "tenant_id": attachment_binding.tenant_id,
                    "dataset_id": attachment_binding.dataset_id,
                    "document_id": attachment_binding.document_id,
                    "attachment_id": attachment_binding.attachment_id,
                    "attachment_info": info,
                    "segment_id": attachment_binding.segment_id,
                }
            )
        return attachment_infos
