from typing import Any, Literal
from uuid import UUID

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
    conversation_id: UUIDStrOrEmpty = Field(description="Conversation UUID")
    first_id: UUIDStrOrEmpty | None = Field(default=None, description="First message ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of messages to return (1-100)")


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


# --- Dataset schemas ---


DOCUMENT_BATCH_DOWNLOAD_ZIP_MAX_DOCS = 100


class ChildChunkCreatePayload(BaseModel):
    content: str


class ChildChunkUpdatePayload(BaseModel):
    content: str


class DocumentBatchDownloadZipPayload(BaseModel):
    """Request payload for bulk downloading documents as a zip archive."""

    document_ids: list[UUID] = Field(..., min_length=1, max_length=DOCUMENT_BATCH_DOWNLOAD_ZIP_MAX_DOCS)


class MetadataUpdatePayload(BaseModel):
    name: str


# --- Audio schemas ---


class TextToAudioPayload(BaseModel):
    message_id: str | None = Field(default=None, description="Message ID")
    voice: str | None = Field(default=None, description="Voice to use for TTS")
    text: str | None = Field(default=None, description="Text to convert to audio")
    streaming: bool | None = Field(default=None, description="Enable streaming response")
