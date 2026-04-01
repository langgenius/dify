from collections.abc import Sequence
from enum import StrEnum

from graphon.entities.base_node_data import BaseNodeData
from graphon.enums import NodeType
from graphon.variables.types import SegmentType
from pydantic import BaseModel, Field, field_validator

from core.trigger.constants import TRIGGER_WEBHOOK_NODE_TYPE

_WEBHOOK_HEADER_ALLOWED_TYPES: frozenset[SegmentType] = frozenset((SegmentType.STRING,))

_WEBHOOK_QUERY_PARAMETER_ALLOWED_TYPES: frozenset[SegmentType] = frozenset(
    (
        SegmentType.STRING,
        SegmentType.NUMBER,
        SegmentType.BOOLEAN,
    )
)

_WEBHOOK_PARAMETER_ALLOWED_TYPES = _WEBHOOK_HEADER_ALLOWED_TYPES | _WEBHOOK_QUERY_PARAMETER_ALLOWED_TYPES

_WEBHOOK_BODY_ALLOWED_TYPES: frozenset[SegmentType] = frozenset(
    (
        SegmentType.STRING,
        SegmentType.NUMBER,
        SegmentType.BOOLEAN,
        SegmentType.OBJECT,
        SegmentType.ARRAY_STRING,
        SegmentType.ARRAY_NUMBER,
        SegmentType.ARRAY_BOOLEAN,
        SegmentType.ARRAY_OBJECT,
        SegmentType.FILE,
    )
)


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
    BINARY = "application/octet-stream"


class WebhookParameter(BaseModel):
    """Parameter definition for headers or query params."""

    name: str
    type: SegmentType = SegmentType.STRING
    required: bool = False

    @field_validator("type", mode="after")
    @classmethod
    def validate_type(cls, v: SegmentType) -> SegmentType:
        if v not in _WEBHOOK_PARAMETER_ALLOWED_TYPES:
            raise ValueError(f"Unsupported webhook parameter type: {v}")
        return v


class WebhookBodyParameter(BaseModel):
    """Body parameter with type information."""

    name: str
    type: SegmentType = SegmentType.STRING
    required: bool = False

    @field_validator("type", mode="after")
    @classmethod
    def validate_type(cls, v: SegmentType) -> SegmentType:
        if v not in _WEBHOOK_BODY_ALLOWED_TYPES:
            raise ValueError(f"Unsupported webhook body parameter type: {v}")
        return v


class WebhookData(BaseNodeData):
    """
    Webhook Node Data.
    """

    class SyncMode(StrEnum):
        SYNC = "async"  # only support

    type: NodeType = TRIGGER_WEBHOOK_NODE_TYPE
    method: Method = Method.GET
    content_type: ContentType = Field(default=ContentType.JSON)
    headers: Sequence[WebhookParameter] = Field(default_factory=list)
    params: Sequence[WebhookParameter] = Field(default_factory=list)  # query parameters
    body: Sequence[WebhookBodyParameter] = Field(default_factory=list)

    @field_validator("method", mode="before")
    @classmethod
    def normalize_method(cls, v) -> str:
        """Normalize HTTP method to lowercase to support both uppercase and lowercase input."""
        if isinstance(v, str):
            return v.lower()
        return v

    @field_validator("headers", mode="after")
    @classmethod
    def validate_header_types(cls, v: Sequence[WebhookParameter]) -> Sequence[WebhookParameter]:
        for param in v:
            if param.type not in _WEBHOOK_HEADER_ALLOWED_TYPES:
                raise ValueError(f"Unsupported webhook header parameter type: {param.type}")
        return v

    @field_validator("params", mode="after")
    @classmethod
    def validate_query_parameter_types(cls, v: Sequence[WebhookParameter]) -> Sequence[WebhookParameter]:
        for param in v:
            if param.type not in _WEBHOOK_QUERY_PARAMETER_ALLOWED_TYPES:
                raise ValueError(f"Unsupported webhook query parameter type: {param.type}")
        return v

    status_code: int = 200  # Expected status code for response
    response_body: str = ""  # Template for response body

    # Webhook specific fields (not from client data, set internally)
    webhook_id: str | None = None  # Set when webhook trigger is created
    timeout: int = 30  # Timeout in seconds to wait for webhook response
