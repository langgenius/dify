"""Retrieval execution and presentation after scoped repository reads complete."""

from collections import defaultdict
from collections.abc import Sequence
from typing import Any, Protocol, cast

from core.app.file_access import (
    get_current_file_access_scope,
    grant_retriever_segment_access,
    grant_upload_file_access,
)
from core.errors.error import (
    LLMBadRequestError,
    ModelCurrentlyNotSupportError,
    ProviderTokenNotInitError,
    QuotaExceededError,
)
from core.rag.datasource.retrieval_service import DefaultRetrievalModelDict, RetrievalService
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.signature import sign_upload_file_preview_url
from graphon.model_runtime.errors.invoke import InvokeError
from machinery.context import RequestContext
from services.knowledge.hit_testing.application import ExternalHitTestingGateway
from services.knowledge.hit_testing.entities import (
    ExternalHitTestingRecord,
    HitTestingDatasetRecord,
    HitTestingRequest,
    HitTestingResponse,
    HitTestingResult,
    RetrievalAttachmentRecord,
    RetrievalDocumentRecord,
    RetrievalSnapshot,
)
from services.knowledge.hit_testing.errors import HitTestingInvocationError, HitTestingProviderError
from services.knowledge.resource_scope import DatasetRef

_MISSING_PROVIDER_MESSAGE = (
    "No Embedding Model or Reranking Model available. Please configure a valid provider "
    "in the Settings -> Model Provider."
)
_DEFAULT_RETRIEVAL_MODEL = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class HitTestingDatasetReader(Protocol):
    def get_hit_testing_dataset(self, dataset_ref: DatasetRef) -> HitTestingDatasetRecord: ...


class HitTestingDocumentReader(Protocol):
    def get_hit_testing_document_filter(self, ref: DatasetRef, conditions: dict[str, object]) -> list[str]: ...

    def get_retrieval_documents(
        self, ref: DatasetRef, document_ids: Sequence[str]
    ) -> dict[str, RetrievalDocumentRecord]: ...


class HitTestingSegmentReader(Protocol):
    def get_retrieval_snapshot(
        self,
        ref: DatasetRef,
        *,
        node_pairs: Sequence[tuple[str, str]],
        summary_pairs: Sequence[tuple[str, str]],
        attachment_pairs: Sequence[tuple[str, str]],
    ) -> RetrievalSnapshot: ...


def _score(value: object) -> float | None:
    if not isinstance(value, int | float | str):
        return None
    try:
        return float(value)
    except ValueError:
        return None


class DatasetHitTestingGateway:
    """Resolve owned rows in bounded reads and perform provider I/O without a checked-out connection."""

    def __init__(
        self,
        *,
        datasets: HitTestingDatasetReader,
        documents: HitTestingDocumentReader,
        segments: HitTestingSegmentReader,
        external_retrieval: ExternalHitTestingGateway,
    ) -> None:
        self._datasets = datasets
        self._documents = documents
        self._segments = segments
        self._external_retrieval = external_retrieval

    @staticmethod
    def _metadata_filters(request: HitTestingRequest) -> dict[str, Any] | None:
        retrieval_model = request.retrieval_model or {}
        metadata_filters = retrieval_model.get("metadata_filtering_conditions")
        return metadata_filters if isinstance(metadata_filters, dict) else None

    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        request: HitTestingRequest,
    ) -> HitTestingResult:
        try:
            dataset = self._datasets.get_hit_testing_dataset(ref)
            if dataset.provider == "external":
                response = cast(
                    HitTestingResponse,
                    self._external_retrieval.retrieve(
                        context,
                        ref,
                        query=request.query,
                        retrieval_model=request.external_retrieval_model,
                        metadata_filters=self._metadata_filters(request),
                    ),
                )
                return HitTestingResult(response=response, record_query=False)

            model = request.retrieval_model or dataset.retrieval_model or _DEFAULT_RETRIEVAL_MODEL
            document_filter = None
            has_metadata_matches = True
            conditions = model.get("metadata_filtering_conditions", {})
            if conditions and request.query:
                document_filter = self._documents.get_hit_testing_document_filter(
                    ref, cast(dict[str, object], conditions)
                )
                has_metadata_matches = bool(document_filter)
            documents = (
                self._retrieve_documents(
                    ref.dataset_id,
                    request.query,
                    cast(DefaultRetrievalModelDict, model),
                    request.attachment_ids,
                    document_filter,
                )
                if has_metadata_matches
                else []
            )
            return HitTestingResult(
                response={"query": {"content": request.query}, "records": self._format_records(ref, documents)},
                record_query=has_metadata_matches,
            )
        except ProviderTokenNotInitError as error:
            raise HitTestingProviderError(error.description, kind="uninitialized") from error
        except QuotaExceededError as error:
            raise HitTestingProviderError(str(error), kind="quota") from error
        except ModelCurrentlyNotSupportError as error:
            raise HitTestingProviderError(str(error), kind="unsupported") from error
        except LLMBadRequestError as error:
            raise HitTestingProviderError(_MISSING_PROVIDER_MESSAGE, kind="uninitialized") from error
        except InvokeError as error:
            raise HitTestingInvocationError(error.description) from error

    def _format_records(
        self, ref: DatasetRef, retrieved: list[Document]
    ) -> list[dict[str, Any] | ExternalHitTestingRecord]:
        scope = get_current_file_access_scope()
        if scope is not None and scope.tenant_id != ref.tenant_id:
            return []
        document_ids = {
            value for document in retrieved if isinstance(value := document.metadata.get("document_id"), str) and value
        }
        documents = self._documents.get_retrieval_documents(ref, tuple(document_ids))
        node_scores: dict[tuple[str, str], float] = {}
        image_scores: dict[tuple[str, str], float] = {}
        summary_scores: dict[tuple[str, str], float] = {}
        summary_pairs: set[tuple[str, str]] = set()
        for hit in retrieved:
            document_id = hit.metadata.get("document_id")
            if not isinstance(document_id, str) or document_id not in documents:
                continue
            score = _score(hit.metadata.get("score"))
            if hit.metadata.get("is_summary"):
                segment_id = hit.metadata.get("original_chunk_id")
                if isinstance(segment_id, str) and segment_id:
                    pair = (document_id, segment_id)
                    summary_pairs.add(pair)
                    if score is not None:
                        summary_scores[pair] = max(summary_scores.get(pair, score), score)
            elif isinstance(node_id := hit.metadata.get("doc_id"), str) and node_id:
                scores = image_scores if hit.metadata.get("doc_type") == DocType.IMAGE else node_scores
                scores[document_id, node_id] = score or 0.0
        snapshot = self._segments.get_retrieval_snapshot(
            ref,
            node_pairs=tuple(node_scores),
            summary_pairs=tuple(summary_pairs),
            attachment_pairs=tuple(image_scores),
        )
        children: dict[str, list[dict[str, object]]] = defaultdict(list)
        for child in snapshot.children:
            if child.index_node_id is None:
                continue
            pair = (child.document_id, child.index_node_id)
            if pair in node_scores:
                children[child.segment_id].append(
                    {
                        "id": child.id,
                        "content": child.content,
                        "position": child.position,
                        "score": node_scores[pair],
                    }
                )
        files: dict[str, list[RetrievalAttachmentRecord]] = defaultdict(list)
        for attachment in snapshot.attachments:
            files[attachment.segment_id].append(attachment)
        records: list[dict[str, Any] | ExternalHitTestingRecord] = []
        included_segment_ids: list[str] = []
        included_file_ids: list[str] = []
        for segment in snapshot.segments:
            document = documents.get(segment.document_id)
            if document is None:
                continue
            pair = (segment.document_id, segment.id)
            child_records = (
                children.get(segment.id, []) if document.doc_form == IndexStructureType.PARENT_CHILD_INDEX else []
            )
            attachments = files.get(segment.id, [])
            if document.doc_form == IndexStructureType.PARENT_CHILD_INDEX:
                if not (child_records or attachments or pair in summary_pairs):
                    continue
                score = max([summary_scores.get(pair, 0.0)] + [cast(float, child["score"]) for child in child_records])
            else:
                has_node_hit = (
                    segment.index_node_id is not None and (segment.document_id, segment.index_node_id) in node_scores
                )
                if not (has_node_hit or attachments or pair in summary_pairs):
                    continue
                node_score = (
                    node_scores.get((segment.document_id, segment.index_node_id), 0.0) if segment.index_node_id else 0.0
                )
                score = summary_scores.get(pair, node_score)
            score = max([score] + [image_scores[attachment.document_id, attachment.id] for attachment in attachments])
            records.append(
                {
                    "segment": {**segment.values, "document": document.values},
                    "score": score,
                    "child_chunks": sorted(child_records, key=lambda child: cast(float, child["score"]), reverse=True),
                    "files": self._file_values(attachments),
                    "summary": snapshot.summaries.get(segment.id) if pair in summary_pairs else None,
                }
            )
            included_segment_ids.append(segment.id)
            included_file_ids.extend(attachment.id for attachment in attachments)
        grant_upload_file_access(included_file_ids)
        grant_retriever_segment_access(included_segment_ids)
        return sorted(records, key=lambda record: cast(float, record["score"]), reverse=True)

    @staticmethod
    def _file_values(attachments: list[RetrievalAttachmentRecord]) -> list[dict[str, object]]:
        return [
            {
                "id": attachment.id,
                "name": attachment.name,
                "extension": "." + attachment.extension,
                "mime_type": attachment.mime_type or "application/octet-stream",
                "size": attachment.size,
                "source_url": sign_upload_file_preview_url(attachment.id, attachment.extension),
            }
            for attachment in attachments
        ]

    @staticmethod
    def _retrieve_documents(
        dataset_id: str,
        query: str,
        model: DefaultRetrievalModelDict,
        attachment_ids: list[str] | None,
        document_filter: list[str] | None,
    ) -> list[Document]:
        return RetrievalService.retrieve(
            retrieval_method=RetrievalMethod(model.get("search_method", RetrievalMethod.SEMANTIC_SEARCH)),
            dataset_id=dataset_id,
            query=query,
            attachment_ids=attachment_ids,
            top_k=model.get("top_k", 4),
            score_threshold=model.get("score_threshold", 0.0) if model["score_threshold_enabled"] else 0.0,
            reranking_model=model.get("reranking_model") if model["reranking_enable"] else None,
            reranking_mode=model.get("reranking_mode") or "reranking_model",
            weights=model.get("weights"),
            document_ids_filter=document_filter,
        )
