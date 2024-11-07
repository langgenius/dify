from dify_oapi.core.model.base_response import BaseResponse


class DeleteConversationResponse(BaseResponse):
    result: str | None = None
