from dify_oapi.core.model.base_response import BaseResponse


class MessageFeedbackResponse(BaseResponse):
    result: str | None = None
