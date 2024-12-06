from __future__ import annotations


from dify_oapi.core.model.base_response import BaseResponse
# Important: Import the definition of Document type and its attribute types
from .document import *  # noqa F403
from .document import Document


class CreateDocumentResponse(BaseResponse):
    document: Document | None = None
    batch: str | None = None
