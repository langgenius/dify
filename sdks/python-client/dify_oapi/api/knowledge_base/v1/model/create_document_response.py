from __future__ import annotations


from dify_oapi.core.model.base_response import BaseResponse
from .document import Document


class CreateDocumentResponse(BaseResponse):
    document: Document | None = None
    batch: str | None = None
