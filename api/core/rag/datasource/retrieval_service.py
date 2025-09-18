import concurrent.futures
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor as StdThreadPoolExecutor

import greenlet as _greenlet  # type: ignore

try:
    from gevent.greenlet import Greenlet  # type: ignore
    from gevent.hub import Hub  # type: ignore

    def _is_gevent_context() -> bool:
        try:
            curr = _greenlet.getcurrent()
            return isinstance(curr, Greenlet) or isinstance(getattr(curr, "parent", None), Hub)
        except Exception:
            return False
except Exception:

    def _is_gevent_context() -> bool:
        return False


from flask import Flask, current_app
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from configs import dify_config
from core.rag.data_post_processor.data_post_processor import DataPostProcessor
from core.rag.datasource.keyword.keyword_factory import Keyword
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.embedding.retrieval import RetrievalSegments
from core.rag.entities.metadata_entities import MetadataCondition
from core.rag.index_processor.constant.index_type import IndexType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from extensions.ext_database import db
from models.dataset import ChildChunk, Dataset, DocumentSegment
from models.dataset import Document as DatasetDocument
from services.external_knowledge_service import ExternalDatasetService

default_retrieval_model = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH.value,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class RetrievalService:
    """Retrieval service with pluggable execution model.

    Introduces a tiny task-runner abstraction to separate gevent and
    non-gevent execution.
    """

    class _TaskRunner:
        def submit(self, fn: Callable[..., list], *args, **kwargs) -> None:  # pragma: no cover - thin wrapper
            raise NotImplementedError

        def gather(self, timeout: int) -> tuple[list[list], list[str]]:  # pragma: no cover - thin wrapper
            raise NotImplementedError

        def close(self) -> None:  # pragma: no cover - thin wrapper
            pass

    class _ThreadTaskRunner(_TaskRunner):
        def __init__(self, max_workers: int) -> None:
            self._executor = StdThreadPoolExecutor(max_workers=max_workers)
            self._futures: list[concurrent.futures.Future] = []

        def submit(self, fn: Callable[..., list], *args, **kwargs) -> None:
            self._futures.append(self._executor.submit(fn, *args, **kwargs))

        def gather(self, timeout: int) -> tuple[list[list], list[str]]:
            results: list[list] = []
            errors: list[str] = []
            done, not_done = concurrent.futures.wait(
                self._futures, timeout=timeout, return_when=concurrent.futures.ALL_COMPLETED
            )
            for f in done:
                try:
                    val = f.result()
                    if isinstance(val, list) and val:
                        results.append(val)
                except Exception as e:
                    errors.append(str(e))
            for f in not_done:
                try:
                    f.cancel()
                except Exception:
                    pass
            return results, errors

        def close(self) -> None:
            self._executor.shutdown(wait=False, cancel_futures=True)

    class _GeventTaskRunner(_TaskRunner):
        def __init__(self) -> None:
            from gevent import spawn  # type: ignore

            self._spawn = spawn
            self._greenlets: list[Greenlet] = []

        def submit(self, fn: Callable[..., list], *args, **kwargs) -> None:
            self._greenlets.append(self._spawn(fn, *args, **kwargs))

        def gather(self, timeout: int) -> tuple[list[list], list[str]]:
            from gevent import joinall  # type: ignore

            results: list[list] = []
            errors: list[str] = []
            if not self._greenlets:
                return results, errors
            joinall(self._greenlets, timeout=timeout, raise_error=False)
            for g in list(self._greenlets):
                try:
                    if getattr(g, "ready", lambda: False)():
                        val = getattr(g, "value", None)
                        if isinstance(val, list) and val:
                            # value is list[Document]
                            results.append(val)
                    else:
                        # Best-effort cancel
                        try:
                            g.kill()
                        except Exception:
                            pass
                except Exception as e:
                    errors.append(str(e))
            return results, errors

    @staticmethod
    def _make_task_runner() -> "RetrievalService._TaskRunner":
        if _is_gevent_context():
            try:
                return RetrievalService._GeventTaskRunner()
            except Exception:
                # Fallback to threads if gevent not importable
                return RetrievalService._ThreadTaskRunner(dify_config.RETRIEVAL_SERVICE_EXECUTORS)
        return RetrievalService._ThreadTaskRunner(dify_config.RETRIEVAL_SERVICE_EXECUTORS)

    # Cache precompiled regular expressions to avoid repeated compilation
    @classmethod
    def retrieve(
        cls,
        retrieval_method: str,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float | None = 0.0,
        reranking_model: dict | None = None,
        reranking_mode: str = "reranking_model",
        weights: dict | None = None,
        document_ids_filter: list[str] | None = None,
    ):
        if not query:
            return []
        dataset = cls._get_dataset(dataset_id)
        if not dataset:
            return []

        all_documents: list[Document] = []
        exceptions: list[str] = []

        timeout: int = dify_config.RETRIEVAL_SERVICE_TIMEOUT

        # Use task-runner abstraction to split gevent vs threads cleanly
        runner = cls._make_task_runner()
        try:
            if retrieval_method == "keyword_search":
                runner.submit(
                    cls.keyword_search,
                    flask_app=current_app._get_current_object(),  # type: ignore
                    dataset_id=dataset_id,
                    query=query,
                    top_k=top_k,
                    document_ids_filter=document_ids_filter,
                )
            if RetrievalMethod.is_support_semantic_search(retrieval_method):
                runner.submit(
                    cls.embedding_search,
                    flask_app=current_app._get_current_object(),  # type: ignore
                    dataset_id=dataset_id,
                    query=query,
                    top_k=top_k,
                    score_threshold=score_threshold,
                    reranking_model=reranking_model,
                    retrieval_method=retrieval_method,
                    document_ids_filter=document_ids_filter,
                )
            if RetrievalMethod.is_support_fulltext_search(retrieval_method):
                runner.submit(
                    cls.full_text_index_search,
                    flask_app=current_app._get_current_object(),  # type: ignore
                    dataset_id=dataset_id,
                    query=query,
                    top_k=top_k,
                    score_threshold=score_threshold,
                    reranking_model=reranking_model,
                    retrieval_method=retrieval_method,
                    document_ids_filter=document_ids_filter,
                )

            # Collect results uniformly across execution models
            results, errors = runner.gather(timeout)
            if results:
                for lst in results:
                    all_documents.extend(lst)
            if errors:
                exceptions.extend(errors)

        finally:
            # Ensure resources are released for thread runner
            try:
                runner.close()
            except Exception:
                pass

        if exceptions:
            raise ValueError(";\n".join(exceptions))

        if retrieval_method == RetrievalMethod.HYBRID_SEARCH.value:
            data_post_processor = DataPostProcessor(
                str(dataset.tenant_id), reranking_mode, reranking_model, weights, False
            )
            all_documents = data_post_processor.invoke(
                query=query,
                documents=all_documents,
                score_threshold=score_threshold,
                top_n=top_k,
            )

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
            MetadataCondition(**metadata_filtering_conditions) if metadata_filtering_conditions else None
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
        document_ids_filter: list[str] | None = None,
    ) -> list[Document]:
        with flask_app.app_context():
            dataset = cls._get_dataset(dataset_id)
            if not dataset:
                raise ValueError("dataset not found")

            keyword = Keyword(dataset=dataset)
            documents = keyword.search(
                cls.escape_query_for_search(query), top_k=top_k, document_ids_filter=document_ids_filter
            )
            return documents

    @classmethod
    def embedding_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float | None,
        reranking_model: dict | None,
        retrieval_method: str,
        document_ids_filter: list[str] | None = None,
    ) -> list[Document]:
        with flask_app.app_context():
            dataset = cls._get_dataset(dataset_id)
            if not dataset:
                raise ValueError("dataset not found")

            vector = Vector(dataset=dataset)
            documents = vector.search_by_vector(
                query,
                search_type="similarity_score_threshold",
                top_k=top_k,
                score_threshold=score_threshold,
                filter={"group_id": [dataset.id]},
                document_ids_filter=document_ids_filter,
            )

            if documents:
                if (
                    reranking_model
                    and reranking_model.get("reranking_model_name")
                    and reranking_model.get("reranking_provider_name")
                    and retrieval_method == RetrievalMethod.SEMANTIC_SEARCH.value
                ):
                    data_post_processor = DataPostProcessor(
                        str(dataset.tenant_id), str(RerankMode.RERANKING_MODEL.value), reranking_model, None, False
                    )
                    return data_post_processor.invoke(
                        query=query,
                        documents=documents,
                        score_threshold=score_threshold,
                        top_n=len(documents),
                    )
                else:
                    return documents
            return []

    @classmethod
    def full_text_index_search(
        cls,
        flask_app: Flask,
        dataset_id: str,
        query: str,
        top_k: int,
        score_threshold: float | None,
        reranking_model: dict | None,
        retrieval_method: str,
        document_ids_filter: list[str] | None = None,
    ) -> list[Document]:
        with flask_app.app_context():
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
                    and retrieval_method == RetrievalMethod.FULL_TEXT_SEARCH.value
                ):
                    data_post_processor = DataPostProcessor(
                        str(dataset.tenant_id), str(RerankMode.RERANKING_MODEL.value), reranking_model, None, False
                    )
                    return data_post_processor.invoke(
                        query=query,
                        documents=documents,
                        score_threshold=score_threshold,
                        top_n=len(documents),
                    )
                else:
                    return documents
            return []

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

            # Process documents
            for document in documents:
                document_id = document.metadata.get("document_id")
                if document_id not in dataset_documents:
                    continue

                dataset_document = dataset_documents[document_id]
                if not dataset_document:
                    continue

                if dataset_document.doc_form == IndexType.PARENT_CHILD_INDEX:
                    # Handle parent-child documents
                    child_index_node_id = document.metadata.get("doc_id")
                    child_chunk_stmt = select(ChildChunk).where(ChildChunk.index_node_id == child_index_node_id)
                    child_chunk = db.session.scalar(child_chunk_stmt)

                    if not child_chunk:
                        continue

                    segment = (
                        db.session.query(DocumentSegment)
                        .where(
                            DocumentSegment.dataset_id == dataset_document.dataset_id,
                            DocumentSegment.enabled == True,
                            DocumentSegment.status == "completed",
                            DocumentSegment.id == child_chunk.segment_id,
                        )
                        .options(
                            load_only(
                                DocumentSegment.id,
                                DocumentSegment.content,
                                DocumentSegment.answer,
                            )
                        )
                        .first()
                    )

                    if not segment:
                        continue

                    if segment.id not in include_segment_ids:
                        include_segment_ids.add(segment.id)
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
                        records.append(record)
                    else:
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
                else:
                    # Handle normal documents
                    index_node_id = document.metadata.get("doc_id")
                    if not index_node_id:
                        continue
                    document_segment_stmt = select(DocumentSegment).where(
                        DocumentSegment.dataset_id == dataset_document.dataset_id,
                        DocumentSegment.enabled == True,
                        DocumentSegment.status == "completed",
                        DocumentSegment.index_node_id == index_node_id,
                    )
                    segment = db.session.scalar(document_segment_stmt)

                    if not segment:
                        continue

                    include_segment_ids.add(segment.id)
                    record = {
                        "segment": segment,
                        "score": document.metadata.get("score"),  # type: ignore
                    }
                    records.append(record)

            # Add child chunks information to records
            for record in records:
                if record["segment"].id in segment_child_map:
                    record["child_chunks"] = segment_child_map[record["segment"].id].get("child_chunks")  # type: ignore
                    record["score"] = segment_child_map[record["segment"].id]["max_score"]

            result = []
            for record in records:
                # Extract segment
                segment = record["segment"]

                # Extract child_chunks, ensuring it's a list or None
                child_chunks = record.get("child_chunks")
                if not isinstance(child_chunks, list):
                    child_chunks = None

                # Extract score, ensuring it's a float or None
                score_value = record.get("score")
                score = (
                    float(score_value)
                    if score_value is not None and isinstance(score_value, int | float | str)
                    else None
                )

                # Create RetrievalSegments object
                retrieval_segment = RetrievalSegments(segment=segment, child_chunks=child_chunks, score=score)
                result.append(retrieval_segment)

            return result
        except Exception as e:
            db.session.rollback()
            raise e
