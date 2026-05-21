from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class SnippetListQuery(BaseModel):
    """Query parameters for listing snippets."""

    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = None
    is_published: bool | None = Field(default=None, description="Filter by published status")
    creators: list[str] | None = Field(default=None, description="Filter by creator account IDs")

    @field_validator("creators", mode="before")
    @classmethod
    def parse_creators(cls, value: object) -> list[str] | None:
        """Normalize creators filter from query string or list input."""
        if value is None:
            return None
        if isinstance(value, str):
            return [creator.strip() for creator in value.split(",") if creator.strip()] or None
        if isinstance(value, list):
            return [str(creator).strip() for creator in value if str(creator).strip()] or None
        return None


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
    conversation_variables: list[dict[str, Any]] | None = Field(
        default=None,
        description="Ignored. Snippet workflows do not persist conversation variables.",
    )
    input_fields: list[dict[str, Any]] | None = None


class SnippetWorkflowListQuery(BaseModel):
    """Query parameters for listing snippet published workflows."""

    page: int = Field(default=1, ge=1, le=99999)
    limit: int = Field(default=10, ge=1, le=100)


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


class SnippetImportPayload(BaseModel):
    """Payload for importing snippet from DSL."""

    mode: str = Field(..., description="Import mode: yaml-content or yaml-url")
    yaml_content: str | None = Field(default=None, description="YAML content (required for yaml-content mode)")
    yaml_url: str | None = Field(default=None, description="YAML URL (required for yaml-url mode)")
    name: str | None = Field(default=None, description="Override snippet name")
    description: str | None = Field(default=None, description="Override snippet description")
    snippet_id: str | None = Field(default=None, description="Snippet ID to update (optional)")


class IncludeSecretQuery(BaseModel):
    """Query parameter for including secret variables in export."""

    include_secret: str = Field(default="false", description="Whether to include secret variables")
