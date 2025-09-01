from collections.abc import Sequence
from enum import StrEnum
from typing import Literal, Optional

from pydantic import BaseModel, Field

from core.workflow.nodes.base import BaseNodeData


class Method(StrEnum):
    GET = "get"
    POST = "post"
    HEAD = "head"
    PATCH = "patch"
    PUT = "put"
    DELETE = "delete"


class ContentType(StrEnum):
    JSON = "application/json"
    FORM_DATA = "multipart/form-data"
    FORM_URLENCODED = "application/x-www-form-urlencoded"
    TEXT = "text/plain"
    FORM = "form"


class WebhookParameter(BaseModel):
    """Parameter definition for headers, query params, or body."""

    name: str
    required: bool = False


class WebhookBodyParameter(BaseModel):
    """Body parameter with type information."""

    name: str
    type: Literal["string", "number", "boolean", "object", "array", "file"] = "string"
    required: bool = False


class WebhookData(BaseNodeData):
    """
    Webhook Node Data.
    """

    class SyncMode(StrEnum):
        SYNC = "async"  # only support

    method: Method = Method.GET
    content_type: ContentType = Field(default=ContentType.JSON)
    headers: Sequence[WebhookParameter] = Field(default_factory=list)
    params: Sequence[WebhookParameter] = Field(default_factory=list)  # query parameters
    body: Sequence[WebhookBodyParameter] = Field(default_factory=list)

    status_code: int = 200  # Expected status code for response
    response_body: str = ""  # Template for response body

    # Webhook specific fields (not from client data, set internally)
    webhook_id: Optional[str] = None  # Set when webhook trigger is created
    timeout: int = 30  # Timeout in seconds to wait for webhook response
