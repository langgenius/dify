from dify_oapi.core.const import APPLICATION_JSON, CONTENT_TYPE
from dify_oapi.core.http.transport import ATransport, Transport
from dify_oapi.core.model.config import Config
from dify_oapi.core.model.request_option import RequestOption

from ..model.message_feedback_request import MessageFeedbackRequest
from ..model.message_feedback_response import MessageFeedbackResponse


class Message:
    def __init__(self, config: Config) -> None:
        self.config: Config = config

    def feedback(
        self, request: MessageFeedbackRequest, option: RequestOption | None = None
    ) -> MessageFeedbackResponse:
        # 添加 content-type
        if request.body is not None:
            option.headers[CONTENT_TYPE] = f"{APPLICATION_JSON}; charset=utf-8"

        # 发起请求
        return Transport.execute(
            self.config, request, unmarshal_as=MessageFeedbackResponse, option=option
        )

    async def afeedback(
        self, request: MessageFeedbackRequest, option: RequestOption | None = None
    ) -> MessageFeedbackResponse:
        # 发起请求
        return await ATransport.aexecute(
            self.config, request, unmarshal_as=MessageFeedbackResponse, option=option
        )
