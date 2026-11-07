"""Retrieval execution and presentation after scoped repository reads complete."""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from operator import itemgetter
from typing import Any, Protocol, TypedDict

from sqlalchemy.orm import Session, sessionmaker

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
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.index_processor.constant.doc_type import DocType
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document
from core.rag.rerank.rerank_type import RerankMode
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from core.tools.signature import sign_upload_file_preview_url
from graphon.model_runtime.errors.invoke import InvokeError
from machinery.context import RequestContext
from repositories.knowledge.retrieval_source_repository import expand_attachment_document_filter
from services.knowledge.entities.metadata import MetadataFilteringCondition
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.entities.retrieval_settings import (
    RerankingModelDict,
    WeightedScoreConfig,
    WeightsDict,
)
from services.knowledge.hit_testing.application import ExternalHitTestingGateway
from services.knowledge.hit_testing.entities import (
    ExternalHitTestingRecord,
    HitTestingDatasetRecord,
    HitTestingRequest,
    HitTestingResult,
    RetrievalAttachmentRecord,
    RetrievalDocumentRecord,
    RetrievalSnapshot,
    external_hit_testing_response,
)
from services.knowledge.hit_testing.errors import (
    HitTestingInvocationError,
    HitTestingProviderError,
    HitTestingUnsupportedInputError,
)
from services.knowledge.retrieval.attachments import expand_retrieval_attachment_candidates

_MISSING_PROVIDER_MESSAGE = (
    "No Embedding Model or Reranking Model available. Please configure a valid provider "
    "in the Settings -> Model Provider."
)
_DEFAULT_RETRIEVAL_MODEL: dict[str, object] = {
    "search_method": RetrievalMethod.SEMANTIC_SEARCH,
    "reranking_enable": False,
    "reranking_model": {"reranking_provider_name": "", "reranking_model_name": ""},
    "top_k": 4,
    "score_threshold_enabled": False,
}


class _ChildRecord(TypedDict):
    id: str
    content: str
    position: int
    score: float


def _string_keyed_dict(value: object, *, setting: str) -> dict[str, object]:
    """Validate a JSON-like object.

    Preconditions: ``value`` comes from an untyped retrieval configuration.
    Postconditions: return a fresh string-keyed mapping or raise ``ValueError`` without mutating the input.
    """
    if not isinstance(value, dict):
        raise ValueError(f"{setting} must be an object")
    result: dict[str, object] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            raise ValueError(f"{setting} keys must be strings")
        result[key] = item
    return result


def _reranking_model(value: object) -> RerankingModelDict | None:
    """Normalize one enabled model-reranking configuration.

    Preconditions: callers invoke this only when model reranking is active.
    Postconditions: aliases are normalized to the internal names; invalid active configuration raises validation
    errors and ignored configuration is never passed here.
    """
    if value is None:
        return None
    raw = _string_keyed_dict(value, setting="reranking_model")
    provider = raw.get("reranking_provider_name", raw.get("provider"))
    model = raw.get("reranking_model_name", raw.get("model"))
    # The legacy rerank runner treats incomplete model selection as disabled.
    if not provider or not model:
        return None
    if not isinstance(provider, str) or not isinstance(model, str):
        raise ValueError("reranking model provider and name must be strings")
    return {
        "reranking_provider_name": provider,
        "reranking_model_name": model,
    }


def _weights(value: object) -> WeightsDict | None:
    """Normalize one enabled weighted-reranking configuration.

    Preconditions: callers invoke this only for weighted-score reranking.
    Postconditions: return the canonical nested shape consumed by ``RetrievalService`` or raise validation errors;
    the caller-owned object is not mutated.
    """
    if value is None:
        return None
    if value == {}:
        return None
    weights = WeightedScoreConfig.model_validate(value)
    return {
        "vector_setting": {
            "vector_weight": weights.vector_setting.vector_weight,
            "embedding_provider_name": weights.vector_setting.embedding_provider_name,
            "embedding_model_name": weights.vector_setting.embedding_model_name,
        },
        "keyword_setting": {"keyword_weight": weights.keyword_setting.keyword_weight},
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
        summary_pairs: Sequence[tuple[str, str, str]],
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
        session_factory: sessionmaker[Session],
        external_retrieval: ExternalHitTestingGateway,
    ) -> None:
        self._datasets = datasets
        self._documents = documents
        self._segments = segments
        self._session_factory = session_factory
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
        """Execute hit testing for an admitted dataset reference.

        Preconditions: ``ref`` and ``context`` were admitted by the application layer; request shape validation has
        completed. Postconditions: only effective settings reach provider I/O, provider failures retain their domain
        error mapping, and the result records whether query history should be written.
        """
        try:
            dataset = self._datasets.get_hit_testing_dataset(ref)
            if dataset.provider == "external":
                if not request.query:
                    raise HitTestingUnsupportedInputError(
                        "External knowledge bases do not support attachment-only retrieval."
                    )
                metadata_filters = self._metadata_filters(request)
                documents = self._external_retrieval.retrieve(
                    tenant_id=ref.tenant_id,
                    dataset_id=ref.dataset_id,
                    query=request.query,
                    retrieval_model=request.external_retrieval_model,
                    metadata_filters=(
                        MetadataFilteringCondition.model_validate(metadata_filters)
                        if metadata_filters is not None
                        else None
                    ),
                )
                return HitTestingResult(
                    response=external_hit_testing_response(request.query, documents),
                    record_query=False,
                )

            model = dict(request.retrieval_model or dataset.retrieval_model or _DEFAULT_RETRIEVAL_MODEL)
            if dataset.indexing_technique == IndexTechniqueType.ECONOMY:
                model = {**model, "search_method": RetrievalMethod.KEYWORD_SEARCH}
            document_filter = None
            has_metadata_matches = True
            conditions = model.get("metadata_filtering_conditions", {})
            if conditions:
                document_filter = self._documents.get_hit_testing_document_filter(
                    ref,
                    _string_keyed_dict(conditions, setting="metadata_filtering_conditions"),
                )
                has_metadata_matches = bool(document_filter)
            provider_document_filter = document_filter
            if document_filter:
                with self._session_factory() as session:
                    provider_document_filter = list(
                        expand_attachment_document_filter(
                            session=session,
                            tenant_id=ref.tenant_id,
                            dataset_id=ref.dataset_id,
                            document_ids=document_filter,
                        )
                    )
            documents = (
                self._retrieve_documents(
                    ref.dataset_id,
                    request.query,
                    model,
                    request.attachment_ids,
                    provider_document_filter,
                    document_filter,
                )
                if has_metadata_matches
                else []
            )
            configured_top_k = model.get("top_k", 4)
            top_k = (
                configured_top_k if isinstance(configured_top_k, int) and not isinstance(configured_top_k, bool) else 4
            )
            return HitTestingResult(
                response={
                    "query": {"content": request.query},
                    "records": self._format_records(ref, documents, top_k=top_k),
                },
                # An empty metadata match has always skipped the query history write.
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
        self, ref: DatasetRef, retrieved: list[Document], *, top_k: int
    ) -> list[dict[str, Any] | ExternalHitTestingRecord]:
        """Reconcile provider hits with current rows and publish final access grants.

        Preconditions: candidates belong to the requested retrieval execution but remain untrusted until current
        ownership is loaded. Postconditions: return at most ``top_k`` eligible records and grant access only to files
        and segments present in those final records.
        """
        scope = get_current_file_access_scope()
        if scope is not None and scope.tenant_id != ref.tenant_id:
            return []
        with self._session_factory() as session:
            retrieved = list(
                expand_retrieval_attachment_candidates(
                    retrieved,
                    tenant_id=ref.tenant_id,
                    dataset_ids=(ref.dataset_id,),
                    session=session,
                ).candidates
            )
        document_ids = {
            value for document in retrieved if isinstance(value := document.metadata.get("document_id"), str) and value
        }
        documents = self._documents.get_retrieval_documents(ref, tuple(document_ids))
        node_scores: dict[tuple[str, str], float] = {}
        image_scores: dict[tuple[str, str], float] = {}
        summary_scores: dict[tuple[str, str, str], float] = {}
        summary_pairs: set[tuple[str, str, str]] = set()
        for hit in retrieved:
            document_id = hit.metadata.get("document_id")
            if not isinstance(document_id, str) or document_id not in documents:
                continue
            score = _score(hit.metadata.get("score"))
            if hit.metadata.get("is_summary"):
                segment_id = hit.metadata.get("original_chunk_id")
                node_id = hit.metadata.get("doc_id")
                if isinstance(segment_id, str) and segment_id and isinstance(node_id, str) and node_id:
                    pair = (document_id, segment_id, node_id)
                    summary_pairs.add(pair)
                    summary_score = score or 0.0
                    summary_scores[pair] = max(summary_scores.get(pair, summary_score), summary_score)
            elif isinstance(node_id := hit.metadata.get("doc_id"), str) and node_id:
                scores = image_scores if hit.metadata.get("doc_type") == DocType.IMAGE else node_scores
                scores[document_id, node_id] = score or 0.0
        snapshot = self._segments.get_retrieval_snapshot(
            ref,
            node_pairs=tuple(node_scores),
            summary_pairs=tuple(summary_pairs),
            attachment_pairs=tuple(image_scores),
        )
        valid_summary_scores: dict[tuple[str, str], float] = {}
        valid_summary_content: dict[tuple[str, str], str] = {}
        for identity, content in snapshot.summaries.items():
            score = summary_scores.get(identity)
            if score is None:
                continue
            pair = identity[:2]
            valid_summary_scores[pair] = max(valid_summary_scores.get(pair, score), score)
            valid_summary_content[pair] = content
        children: dict[str, list[_ChildRecord]] = defaultdict(list)
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
        attachment_pairs: set[tuple[str, str]] = set()
        for attachment in snapshot.attachments:
            pair = (attachment.segment_id, attachment.id)
            if pair in attachment_pairs:
                continue
            attachment_pairs.add(pair)
            files[attachment.segment_id].append(attachment)
        eligible_records: list[tuple[float, dict[str, object], str, list[RetrievalAttachmentRecord]]] = []
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
                if not (child_records or attachments or pair in valid_summary_scores):
                    continue
                score = max([valid_summary_scores.get(pair, 0.0)] + [child["score"] for child in child_records])
            else:
                has_node_hit = (
                    segment.index_node_id is not None and (segment.document_id, segment.index_node_id) in node_scores
                )
                if not (has_node_hit or attachments or pair in valid_summary_scores):
                    continue
                node_score = (
                    node_scores.get((segment.document_id, segment.index_node_id), 0.0) if segment.index_node_id else 0.0
                )
                score = valid_summary_scores.get(pair, node_score)
            score = max([score] + [image_scores[attachment.document_id, attachment.id] for attachment in attachments])
            eligible_records.append(
                (
                    score,
                    {
                        "segment": {
                            **segment.values,
                            "sign_content": None,
                            "keywords": [] if segment.values["keywords"] is None else segment.values["keywords"],
                            "document": document.values,
                        },
                        "score": score,
                        "child_chunks": sorted(child_records, key=itemgetter("score"), reverse=True),
                        "tsne_position": None,
                        "files": [],
                        "summary": valid_summary_content.get(pair),
                    },
                    segment.id,
                    attachments,
                )
            )
        eligible_records.sort(key=itemgetter(0), reverse=True)
        selected_records = eligible_records[:top_k] if top_k else eligible_records
        included_segment_ids = [segment_id for _, _, segment_id, _ in selected_records]
        included_file_ids = [attachment.id for _, _, _, attachments in selected_records for attachment in attachments]
        records: list[dict[str, Any] | ExternalHitTestingRecord] = []
        for _, record, _, attachments in selected_records:
            record["files"] = self._file_values(attachments)
            records.append(record)
        grant_upload_file_access(included_file_ids)
        grant_retriever_segment_access(included_segment_ids)
        return records

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
        model: Mapping[str, object],
        attachment_ids: list[str] | None,
        document_filter: list[str] | None,
        allowed_document_filter: list[str] | None,
    ) -> list[Document]:
        """Execute one internal retrieval using only effective configuration.

        Preconditions: ``model`` is the selected request, dataset, or default configuration.
        Postconditions: fields that affect this invocation are narrowed or validated before provider I/O; malformed
        fields for disabled reranking or threshold features remain ignored as they were historically.
        """
        raw_search_method = model.get("search_method", RetrievalMethod.SEMANTIC_SEARCH)
        if not isinstance(raw_search_method, str):
            raise ValueError("search_method must be a string")
        retrieval_method = RetrievalMethod(raw_search_method)

        raw_top_k = model.get("top_k", 4)
        top_k = raw_top_k if isinstance(raw_top_k, int) and not isinstance(raw_top_k, bool) else 4

        threshold_enabled = model.get("score_threshold_enabled", False)
        if not isinstance(threshold_enabled, bool):
            raise ValueError("score_threshold_enabled must be a boolean")
        raw_threshold = model.get("score_threshold", 0.0) if threshold_enabled else 0.0
        if not isinstance(raw_threshold, int | float) or isinstance(raw_threshold, bool):
            raise ValueError("score_threshold must be numeric")

        reranking_enabled = model.get("reranking_enable", False)
        if not isinstance(reranking_enabled, bool):
            raise ValueError("reranking_enable must be a boolean")
        reranking_mode: str = "reranking_model"
        if reranking_enabled:
            raw_reranking_mode = model.get("reranking_mode", "reranking_model") or "reranking_model"
            if not isinstance(raw_reranking_mode, str):
                raise ValueError("reranking_mode must be a string")
            reranking_mode = raw_reranking_mode

        model_reranking = reranking_enabled and reranking_mode == RerankMode.RERANKING_MODEL
        weighted_reranking = reranking_enabled and reranking_mode == RerankMode.WEIGHTED_SCORE

        return RetrievalService.retrieve(
            retrieval_method=retrieval_method,
            dataset_id=dataset_id,
            query=query,
            attachment_ids=attachment_ids,
            top_k=top_k,
            score_threshold=float(raw_threshold) if threshold_enabled else 0.0,
            reranking_model=_reranking_model(model.get("reranking_model")) if model_reranking else None,
            reranking_mode=reranking_mode,
            weights=_weights(model.get("weights")) if weighted_reranking else None,
            document_ids_filter=document_filter,
            allowed_document_ids_filter=allowed_document_filter,
        )
