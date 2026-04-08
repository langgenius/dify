from typing import Literal

from pydantic import BaseModel, Field

from libs.helper import UUIDStrOrEmpty


class MessageListQuery(BaseModel):
    conversation_id: UUIDStrOrEmpty
    first_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class MessageFeedbackPayload(BaseModel):
    rating: Literal["like", "dislike"] | None = None
    content: str | None = None
