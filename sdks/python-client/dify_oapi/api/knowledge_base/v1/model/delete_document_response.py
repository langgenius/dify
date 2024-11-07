from dify_oapi.core.model.base_response import BaseResponse


class DeleteDocumentResponse(BaseResponse):
    result: str | None = None
