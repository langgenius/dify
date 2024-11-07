from dify_oapi.core.model.base_response import BaseResponse

from .document import Document


class ListDocumentResponse(BaseResponse):
    data: list[Document] | None = None
    has_more: bool | None = None
    limit: int | None = None
    total: int | None = None
    page: int | None = None
