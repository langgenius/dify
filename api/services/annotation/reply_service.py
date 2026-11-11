"""Retrieve annotation replies without holding a database transaction during search."""

import logging
from typing import Protocol

from models.annotation_reply import AnnotationMatch, AnnotationReply, AnnotationSearch
from models.enums import ConversationFromSource

logger = logging.getLogger(__name__)


class AnnotationRecords(Protocol):
    def prepare(self, *, tenant_id: str, app_id: str) -> AnnotationSearch | None: ...
    def record_hit(
        self,
        search: AnnotationSearch,
        match: AnnotationMatch,
        *,
        message_id: str,
        query: str,
        user_id: str,
        from_source: ConversationFromSource,
    ) -> AnnotationReply | None: ...


class AnnotationRetrieval(Protocol):
    def search(self, context: AnnotationSearch, query: str) -> AnnotationMatch | None: ...


class AnnotationReplyService:
    def __init__(self, records: AnnotationRecords, retrieval: AnnotationRetrieval) -> None:
        self._records = records
        self._retrieval = retrieval

    def query(
        self,
        *,
        tenant_id: str,
        app_id: str,
        message_id: str,
        query: str,
        user_id: str,
        from_source: ConversationFromSource,
    ) -> AnnotationReply | None:
        try:
            context = self._records.prepare(tenant_id=tenant_id, app_id=app_id)
            if context is None:
                return None
            match = self._retrieval.search(context, query)
            if match is None:
                return None
            return self._records.record_hit(
                context, match, message_id=message_id, query=query, user_id=user_id, from_source=from_source
            )
        except Exception:
            # Annotation lookup is optional; its transaction rolls back independently
            # so normal generation can proceed after a search or persistence failure.
            logger.warning("Query annotation failed for app %s.", app_id, exc_info=True)
            return None
