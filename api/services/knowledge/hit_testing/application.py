"""Application orchestration for testing retrieval against an owned dataset."""

import json
import logging
from collections.abc import Mapping
from typing import Any, Protocol

from core.rag.index_processor.constant.query_type import QueryType
from machinery.context import RequestContext
from services.errors.index import IndexNotInitializedError
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.dataset_access import DatasetAccess, DatasetAccessError
from services.knowledge.hit_testing.entities import (
    HitTestingQueryRecorder,
    HitTestingRequest,
    HitTestingResponse,
    HitTestingResult,
    validate_hit_testing_request,
)
from services.knowledge.hit_testing.errors import HitTestingError, HitTestingFailedError, HitTestingUpstreamError
from services.knowledge.resource_scope import DatasetRef

logger = logging.getLogger(__name__)


class HitTestingGateway(Protocol):
    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        request: HitTestingRequest,
    ) -> HitTestingResult: ...


class ExternalHitTestingGateway(Protocol):
    """Retrieve records from a dataset backed by an external knowledge API."""

    def retrieve(
        self,
        context: RequestContext,
        ref: DatasetRef,
        *,
        query: str,
        retrieval_model: dict[str, Any] | None,
        metadata_filters: dict[str, Any] | None,
    ) -> Mapping[str, object]: ...


class HitTestingApplicationService:
    def __init__(
        self,
        *,
        dataset_access: DatasetAccess,
        retrieval: HitTestingGateway,
        queries: HitTestingQueryRecorder,
    ) -> None:
        self._dataset_access = dataset_access
        self._retrieval = retrieval
        self._queries = queries

    def retrieve(
        self,
        context: RequestContext,
        *,
        dataset_id: str,
        request: HitTestingRequest,
    ) -> HitTestingResponse:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        validate_hit_testing_request(request)
        try:
            result = self._retrieval.retrieve(
                context,
                DatasetRef(dataset.workspace_id, dataset.id),
                request,
            )
            if result.record_query:
                queries: list[dict[str, str]] = []
                if request.query:
                    queries.append({"content_type": QueryType.TEXT_QUERY, "content": request.query})
                for attachment_id in request.attachment_ids or ():
                    queries.append({"content_type": QueryType.IMAGE_QUERY, "content": attachment_id})
                self._queries.record_hit_testing_query(
                    context,
                    DatasetRef(dataset.workspace_id, dataset.id),
                    json.dumps(queries),
                )
            return result.response
        except ExternalKnowledgeRetrievalError as error:
            raise HitTestingUpstreamError(str(error)) from error
        except (ValueError, DatasetAccessError, IndexNotInitializedError, HitTestingError):
            raise
        except Exception as error:
            logger.exception("Hit testing failed.")
            raise HitTestingFailedError(str(error)) from error
