from dify_oapi.core.model.base_response import BaseResponse


class RenameConversationResponse(BaseResponse):
    id: str | None = None
    result: str | None = None
    inputs: dict | None = None
    status: str | None = None
    introduction: str | None = None
    created_at: int | None = None
    updated_at: int | None = None
