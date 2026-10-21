"""Shared HTTP contract for retrieval while a vector target is unavailable."""

from typing import Literal

from pydantic import BaseModel

from libs.exception import BaseHTTPException


class KnowledgeIndexUnavailableDetails(BaseModel):
    reason: Literal["indexing", "failed"]


class KnowledgeIndexUnavailableError(BaseHTTPException):
    error_code = "knowledge_index_unavailable"
    code = 503
    description = "The knowledge index is unavailable. Retry after indexing completes."
    details_model = KnowledgeIndexUnavailableDetails

    def __init__(self, reason: Literal["indexing", "failed"]):
        super().__init__()
        assert self.data is not None
        self.data["details"] = self.details_model(reason=reason).model_dump(mode="json")
