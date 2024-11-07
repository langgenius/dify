from dify_oapi.core.model.base_response import BaseResponse


class StopChatResponse(BaseResponse):
    result: str | None = None
