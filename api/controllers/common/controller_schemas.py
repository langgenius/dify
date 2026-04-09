from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from libs.helper import UUIDStrOrEmpty

# --- Conversation schemas ---


class ConversationRenamePayload(BaseModel):
    name: str | None = None
    auto_generate: bool = False

    @model_validator(mode="after")
    def validate_name_requirement(self):
        if not self.auto_generate:
            if self.name is None or not self.name.strip():
                raise ValueError("name is required when auto_generate is false")
        return self


# --- Message schemas ---


class MessageListQuery(BaseModel):
    conversation_id: UUIDStrOrEmpty
    first_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class MessageFeedbackPayload(BaseModel):
    rating: Literal["like", "dislike"] | None = None
    content: str | None = None


# --- Saved message schemas ---


class SavedMessageListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class SavedMessageCreatePayload(BaseModel):
    message_id: UUIDStrOrEmpty


# --- Workflow schemas ---


class DefaultBlockConfigQuery(BaseModel):
    q: str | None = None


class WorkflowListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=10, ge=1, le=100)
    user_id: str | None = None
    named_only: bool = False


class WorkflowRunPayload(BaseModel):
    inputs: dict[str, Any]
    files: list[dict[str, Any]] | None = None


class WorkflowUpdatePayload(BaseModel):
    marked_name: str | None = Field(default=None, max_length=20)
    marked_comment: str | None = Field(default=None, max_length=100)


# --- Audio schemas ---


class TextToAudioPayload(BaseModel):
    message_id: str | None = None
    voice: str | None = None
    text: str | None = None
    streaming: bool | None = None
