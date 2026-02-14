from typing import Any, Literal

from pydantic import BaseModel, Field


class SnippetListQuery(BaseModel):
    """Query parameters for listing snippets."""

    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = None


class IconInfo(BaseModel):
    """Icon information model."""

    icon: str | None = None
    icon_type: Literal["emoji", "image"] | None = None
    icon_background: str | None = None
    icon_url: str | None = None


class InputFieldDefinition(BaseModel):
    """Input field definition for snippet parameters."""

    default: str | None = None
    hint: bool | None = None
    label: str | None = None
    max_length: int | None = None
    options: list[str] | None = None
    placeholder: str | None = None
    required: bool | None = None
    type: str | None = None  # e.g., "text-input"


class CreateSnippetPayload(BaseModel):
    """Payload for creating a new snippet."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    type: Literal["node", "group"] = "node"
    icon_info: IconInfo | None = None
    graph: dict[str, Any] | None = None
    input_fields: list[InputFieldDefinition] | None = Field(default_factory=list)


class UpdateSnippetPayload(BaseModel):
    """Payload for updating a snippet."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    icon_info: IconInfo | None = None


class SnippetDraftSyncPayload(BaseModel):
    """Payload for syncing snippet draft workflow."""

    graph: dict[str, Any]
    hash: str | None = None
    environment_variables: list[dict[str, Any]] | None = None
    conversation_variables: list[dict[str, Any]] | None = None
    input_variables: list[dict[str, Any]] | None = None


class WorkflowRunQuery(BaseModel):
    """Query parameters for workflow runs."""

    last_id: str | None = None
    limit: int = Field(default=20, ge=1, le=100)


class SnippetDraftRunPayload(BaseModel):
    """Payload for running snippet draft workflow."""

    inputs: dict[str, Any]
    files: list[dict[str, Any]] | None = None


class SnippetDraftNodeRunPayload(BaseModel):
    """Payload for running a single node in snippet draft workflow."""

    inputs: dict[str, Any]
    query: str = ""
    files: list[dict[str, Any]] | None = None


class SnippetIterationNodeRunPayload(BaseModel):
    """Payload for running an iteration node in snippet draft workflow."""

    inputs: dict[str, Any] | None = None


class SnippetLoopNodeRunPayload(BaseModel):
    """Payload for running a loop node in snippet draft workflow."""

    inputs: dict[str, Any] | None = None


class PublishWorkflowPayload(BaseModel):
    """Payload for publishing snippet workflow."""

    knowledge_base_setting: dict[str, Any] | None = None
