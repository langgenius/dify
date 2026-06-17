from copy import deepcopy
from typing import Any, Literal, override
from uuid import UUID

from pydantic import BaseModel, Field, GetJsonSchemaHandler, model_validator

from libs.helper import UUIDStrOrEmpty

# --- Conversation schemas ---


class ConversationRenamePayload(BaseModel):
    name: str | None = None
    auto_generate: bool = False

    @classmethod
    @override
    def __get_pydantic_json_schema__(cls, core_schema: Any, handler: GetJsonSchemaHandler) -> dict[str, Any]:
        schema = handler.resolve_ref_schema(handler(core_schema))
        properties = schema.get("properties")
        if not isinstance(properties, dict):
            return schema

        auto_generate_schema = deepcopy(properties.get("auto_generate", {"type": "boolean"}))
        name_schema = deepcopy(properties.get("name", {"type": "string"}))
        non_blank_name_schema: dict[str, Any] = {"pattern": r".*\S.*", "type": "string"}
        if isinstance(name_schema, dict) and isinstance(name_schema.get("title"), str):
            non_blank_name_schema["title"] = name_schema["title"]

        auto_generate_true_schema = {**auto_generate_schema, "enum": [True]}
        auto_generate_true_schema.pop("default", None)

        return {
            **schema,
            "anyOf": [
                {
                    "properties": {
                        "auto_generate": auto_generate_true_schema,
                        "name": name_schema,
                    },
                    "required": ["auto_generate"],
                    "type": "object",
                },
                {
                    "properties": {
                        "auto_generate": {**auto_generate_schema, "enum": [False]},
                        "name": non_blank_name_schema,
                    },
                    "required": ["name"],
                    "type": "object",
                },
            ],
        }

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
    files: list[dict[str, Any]] | None = Field(default=None)


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
