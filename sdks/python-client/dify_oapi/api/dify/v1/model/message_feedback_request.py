from __future__ import annotations

from dify_oapi.core.enum import HttpMethod
from dify_oapi.core.model.base_request import BaseRequest

from ..model.message_feedback_request_body import MessageFeedbackRequestBody


class MessageFeedbackRequest(BaseRequest):
    def __init__(self):
        super().__init__()
        self.message_id: str | None = None
        self.request_body: MessageFeedbackRequestBody | None = None

    @staticmethod
    def builder() -> MessageFeedbackRequestBuilder:
        return MessageFeedbackRequestBuilder()


class MessageFeedbackRequestBuilder:
    def __init__(self):
        message_feedback_request = MessageFeedbackRequest()
        message_feedback_request.http_method = HttpMethod.POST
        message_feedback_request.uri = "/v1/messages/:message_id/feedbacks"
        self._message_feedback_request = message_feedback_request

    def build(self) -> MessageFeedbackRequest:
        return self._message_feedback_request

    def message_id(self, message_id: str) -> MessageFeedbackRequestBuilder:
        self._message_feedback_request.message_id = message_id
        self._message_feedback_request.paths["message_id"] = message_id
        return self

    def request_body(
        self, request_body: MessageFeedbackRequestBody
    ) -> MessageFeedbackRequestBuilder:
        self._message_feedback_request.request_body = request_body
        self._message_feedback_request.body = request_body.model_dump(exclude_none=True)
        return self
