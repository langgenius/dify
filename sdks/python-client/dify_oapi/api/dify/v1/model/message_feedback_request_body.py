from __future__ import annotations

from pydantic import BaseModel


class MessageFeedbackRequestBody(BaseModel):
    rating: str | None = None
    user: str | None = None

    @staticmethod
    def builder() -> MessageFeedbackRequestBodyBuilder:
        return MessageFeedbackRequestBodyBuilder()


class MessageFeedbackRequestBodyBuilder:
    def __init__(self):
        self._message_feedback_request_body = MessageFeedbackRequestBody()

    def build(self) -> MessageFeedbackRequestBody:
        return self._message_feedback_request_body

    def rating(self, rating: str) -> MessageFeedbackRequestBodyBuilder:
        if rating not in ("like", "dislike", "null"):
            raise ValueError("Rating must be one of 'like', 'dislike', 'null'")
        self._message_feedback_request_body.rating = rating
        return self

    def user(self, user: str) -> MessageFeedbackRequestBodyBuilder:
        self._message_feedback_request_body.user = user
        return self
