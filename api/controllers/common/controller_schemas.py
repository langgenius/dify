from copy import deepcopy
from typing import Annotated, Any, Literal, override
from uuid import UUID

from pydantic import BaseModel, Field, GetJsonSchemaHandler, WithJsonSchema, model_validator

from libs.helper import UUIDStrOrEmpty

# --- Conversation schemas ---


class ConversationRenamePayload(BaseModel):
    name: str | None = Field(
        default=None,
        description="Conversation name. Required when `auto_generate` is `false`.",
    )
    auto_generate: bool = Field(
        default=False,
        description="Automatically generate the conversation name. When `true`, the `name` field is ignored.",
    )

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
    conversation_id: UUIDStrOrEmpty = Field(description="Conversation ID.")
    first_id: UUIDStrOrEmpty | None = Field(
        default=None,
        description=(
            "The ID of the first chat record on the current page. Omit this value to fetch the latest messages; "
            "for subsequent pages, use the first message ID from the current list to fetch older messages."
        ),
    )
    limit: int = Field(
        default=20,
        ge=1,
        le=100,
        description="Number of chat history messages to return per request.",
    )


class MessageFeedbackPayload(BaseModel):
    rating: Literal["like", "dislike"] | None = Field(
        default=None,
        description="Feedback rating. Set to `null` to revoke previously submitted feedback.",
    )
    content: str | None = Field(default=None, description="Optional text feedback providing additional detail.")


# --- Saved message schemas ---


class SavedMessageListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = None
    limit: int = Field(default=20, ge=1, le=100)


class SavedMessageCreatePayload(BaseModel):
    message_id: UUIDStrOrEmpty


# --- Workflow schemas ---

WORKFLOW_INPUT_FILE_ITEM_SCHEMA: dict[str, object] = {
    "type": "object",
    "required": ["type", "transfer_method"],
    "properties": {
        "type": {
            "description": "File type.",
            "enum": ["document", "image", "audio", "video", "custom"],
            "type": "string",
        },
        "transfer_method": {
            "description": "Transfer method: `remote_url` for file URL, `local_file` for uploaded file.",
            "enum": ["remote_url", "local_file"],
            "type": "string",
        },
        "url": {
            "description": "File URL when `transfer_method` is `remote_url`.",
            "format": "url",
            "type": "string",
        },
        "upload_file_id": {
            "description": (
                "Uploaded file ID obtained from the [Upload File](/api-reference/files/upload-file) API when "
                "`transfer_method` is `local_file`."
            ),
            "type": "string",
        },
    },
}
WORKFLOW_INPUT_FILE_LIST_SCHEMA: dict[str, object] = {
    "anyOf": [{"items": WORKFLOW_INPUT_FILE_ITEM_SCHEMA, "type": "array"}, {"type": "null"}]
}
WorkflowInputFileList = Annotated[list[dict[str, Any]] | None, WithJsonSchema(WORKFLOW_INPUT_FILE_LIST_SCHEMA)]


class DefaultBlockConfigQuery(BaseModel):
    q: str | None = None


class WorkflowListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=10, ge=1, le=100)
    user_id: str | None = None
    named_only: bool = False


class WorkflowRunPayload(BaseModel):
    inputs: dict[str, Any] = Field(
        description=(
            "Key-value pairs for workflow input variables. Values for file-type variables should be arrays of "
            "file objects with `type`, `transfer_method`, and either `url` or `upload_file_id`. Refer to the "
            "`user_input_form` field in the [Get App Parameters](/api-reference/applications/get-app-parameters) "
            "response to discover the variable names and types expected by your app."
        )
    )
    files: WorkflowInputFileList = Field(
        default=None,
        description=(
            "File list for workflow system file inputs. Available when file upload is enabled for the workflow. "
            "To attach a local file, first upload it via [Upload File](/api-reference/files/upload-file) and use "
            "the returned `id` as `upload_file_id` with `transfer_method: local_file`."
        ),
    )


class WorkflowUpdatePayload(BaseModel):
    marked_name: str | None = Field(default=None, max_length=20)
    marked_comment: str | None = Field(default=None, max_length=100)


# --- Dataset schemas ---


DOCUMENT_BATCH_DOWNLOAD_ZIP_MAX_DOCS = 100


class ChildChunkCreatePayload(BaseModel):
    content: str = Field(description="Child chunk text content.")


class ChildChunkUpdatePayload(BaseModel):
    content: str = Field(description="Child chunk text content.")


class DocumentBatchDownloadZipPayload(BaseModel):
    """Request payload for bulk downloading documents as a zip archive."""

    document_ids: list[UUID] = Field(
        ...,
        min_length=1,
        max_length=DOCUMENT_BATCH_DOWNLOAD_ZIP_MAX_DOCS,
        description="List of document IDs to include in the ZIP download.",
    )


class MetadataUpdatePayload(BaseModel):
    name: str = Field(description="New metadata field name.")


# --- Audio schemas ---


UUIDString = Annotated[str, WithJsonSchema({"format": "uuid", "type": "string"})]


class TextToAudioPayload(BaseModel):
    message_id: UUIDString | None = Field(
        default=None,
        description="Message ID. Takes priority over `text` when both are provided.",
    )
    voice: str | None = Field(
        default=None,
        description=(
            "Voice to use for text-to-speech. Available voices depend on the TTS provider configured for this app. "
            "Omit to use the app's configured voice when available; that value is exposed by "
            "[Get App Parameters](/api-reference/applications/get-app-parameters) as `text_to_speech.voice`."
        ),
    )
    text: str | None = Field(default=None, description="Speech content to convert.")
    streaming: bool | None = Field(
        default=None,
        description="Reserved for compatibility; TTS response streaming is determined by the provider output.",
    )
