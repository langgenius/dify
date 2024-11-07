from dify_oapi.core.model.base_response import BaseResponse


class UploadFileResponse(BaseResponse):
    id: str | None = None
    name: str | None = None
    size: int | None = None
    extension: str | None = None
    mime_type: str | None = None
    created_by: str | None = None
    created_at: int | None = None
