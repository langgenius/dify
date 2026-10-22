"""Knowledge hit-testing use case and its consumer-owned retrieval port."""

import json
import logging
from typing import Protocol

from core.rag.index_processor.constant.query_type import QueryType
from machinery.context import RequestContext
from services.errors.dataset import DatasetAccessError
from services.errors.knowledge_retrieval import HitTestingFailedError, HitTestingInvocationError
from services.knowledge.dataset_access import DatasetAccess
from services.knowledge.entities.hit_testing import (
    HitTestingQueryRecorder,
    HitTestingRequest,
    HitTestingResult,
    RetrieveResponseDict,
    validate_hit_testing_input,
)
from services.knowledge.entities.resource_scope import DatasetRef

logger = logging.getLogger(__name__)


class HitTestingRetrieval(Protocol):
    def retrieve(self, ref: DatasetRef, request: HitTestingRequest) -> HitTestingResult: ...


class HitTestingApplicationService:
    def __init__(
        self, *, dataset_access: DatasetAccess, retrieval: HitTestingRetrieval, queries: HitTestingQueryRecorder
    ) -> None:
        self._dataset_access = dataset_access
        self._retrieval = retrieval
        self._queries = queries

    def hit_testing(
        self, context: RequestContext, *, dataset_id: str, request: HitTestingRequest
    ) -> RetrieveResponseDict:
        dataset = self._dataset_access.require_accessible(context, dataset_id)
        validate_hit_testing_input(request.query, request.attachment_ids)
        ref = DatasetRef(dataset.workspace_id, dataset.id)
        try:
            result = self._retrieval.retrieve(ref, request)
            if result.record_query:
                queries = []
                if request.query:
                    queries.append({"content_type": QueryType.TEXT_QUERY, "content": request.query})
                for attachment_id in request.attachment_ids or []:
                    queries.append({"content_type": QueryType.IMAGE_QUERY, "content": attachment_id})
                self._queries.record_hit_testing_query(context, ref, json.dumps(queries))
            return result.response
        except (ValueError, DatasetAccessError, HitTestingInvocationError):
            raise
        except Exception as error:
            logger.exception("Hit testing failed.")
            raise HitTestingFailedError(str(error)) from error
