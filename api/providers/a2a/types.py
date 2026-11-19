"""Strict wire schema for the frozen A2A 1.0 HTTP+JSON v1 profile.

These are infrastructure DTOs. No application service imports this module.
Unknown core fields and 0.3 discriminators are rejected instead of guessed.
Extension-specific JSON remains under explicitly typed metadata/params.
"""

import json
import math
from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, JsonValue, model_validator


class WireModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, populate_by_name=False, allow_inf_nan=False, serialize_by_alias=True
    )


class AgentInterfaceV1(WireModel):
    url: str = Field(min_length=1)
    protocolBinding: str  # noqa: N815  # Public field name.
    protocolVersion: str  # noqa: N815  # Public field name.
    tenant: str | None = None


class ExtensionV1(WireModel):
    uri: str = Field(min_length=1)
    description: str | None = None
    required: bool = False
    params: dict[str, JsonValue] = Field(default_factory=dict)


class CapabilitiesV1(WireModel):
    streaming: bool = False
    pushNotifications: bool = False  # noqa: N815  # Public field name.
    extendedAgentCard: bool = False  # noqa: N815  # Public field name.
    extensions: list[ExtensionV1] = Field(default_factory=list)


class SkillV1(WireModel):
    id: str = Field(min_length=1)
    name: str
    description: str
    tags: list[str]
    examples: list[str] = Field(default_factory=list)
    inputModes: list[str] = Field(default_factory=list)  # noqa: N815  # Public field name.
    outputModes: list[str] = Field(default_factory=list)  # noqa: N815  # Public field name.
    securityRequirements: list[dict[str, JsonValue]] = Field(default_factory=list)  # noqa: N815  # Public field name.


class ProviderV1(WireModel):
    url: str
    organization: str


class ScopeListV1(WireModel):
    scopes: list[str] = Field(default_factory=list, alias="list")


class SecurityRequirementV1(WireModel):
    schemes: dict[str, ScopeListV1] = Field(default_factory=dict)


class AgentCardV1(WireModel):
    name: str = Field(min_length=1)
    description: str
    supportedInterfaces: list[AgentInterfaceV1] = Field(min_length=1)  # noqa: N815  # Public field name.
    version: str
    capabilities: CapabilitiesV1
    defaultInputModes: list[str]  # noqa: N815  # Public field name.
    defaultOutputModes: list[str]  # noqa: N815  # Public field name.
    skills: list[SkillV1]
    provider: ProviderV1 | None = None
    documentationUrl: str | None = None  # noqa: N815  # Public field name.
    iconUrl: str | None = None  # noqa: N815  # Public field name.
    securitySchemes: dict[str, dict[str, JsonValue]] = Field(default_factory=dict)  # noqa: N815  # Public field name.
    securityRequirements: list[SecurityRequirementV1] = Field(default_factory=list)  # noqa: N815  # Public field name.
    signatures: list[dict[str, JsonValue]] = Field(default_factory=list)


class PartV1(WireModel):
    text: str | None = None
    raw: str | None = None
    url: str | None = None
    data: JsonValue = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    filename: str | None = None
    mediaType: str | None = None  # noqa: N815  # Public field name.

    @model_validator(mode="after")
    def require_one_content(self) -> Self:
        """Accept exactly one content key; explicit data:null remains a valid Part."""
        content = self.model_fields_set & {"text", "raw", "url", "data"}
        null_content = (
            ("text" in content and self.text is None)
            or ("raw" in content and self.raw is None)
            or ("url" in content and self.url is None)
        )
        if len(content) != 1 or null_content:
            raise ValueError("A Part requires exactly one content value")
        return self


class MessageRoleV1(StrEnum):
    USER = "ROLE_USER"
    AGENT = "ROLE_AGENT"


def _message_role_from_wire(value: object) -> MessageRoleV1:
    """Accept a v1 role string; return its member or reject without coercion.

    Preconditions: value is untrusted wire data or an existing role member.
    Postconditions: only the frozen role strings succeed; bytes and other
    non-string values fail without changing strict validation of other fields.
    """
    if not isinstance(value, str):
        raise ValueError("A Message role must be a string.")
    return MessageRoleV1(value)


class MessageV1(WireModel):
    messageId: str = Field(min_length=1)  # noqa: N815  # Public field name.
    role: Annotated[MessageRoleV1, BeforeValidator(_message_role_from_wire)]
    parts: list[PartV1] = Field(min_length=1)
    contextId: str | None = Field(default=None, min_length=1)  # noqa: N815  # Public field name.
    taskId: str | None = Field(default=None, min_length=1)  # noqa: N815  # Public field name.
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    extensions: list[str] = Field(default_factory=list)
    referenceTaskIds: list[str] = Field(default_factory=list)  # noqa: N815  # Public field name.


class TaskStateV1(StrEnum):
    SUBMITTED = "TASK_STATE_SUBMITTED"
    WORKING = "TASK_STATE_WORKING"
    COMPLETED = "TASK_STATE_COMPLETED"
    FAILED = "TASK_STATE_FAILED"
    CANCELED = "TASK_STATE_CANCELED"
    REJECTED = "TASK_STATE_REJECTED"
    INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED"
    AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED"


def _task_state_from_wire(value: object) -> TaskStateV1:
    """Accept a v1 state string; return its member or reject without coercion.

    Preconditions: value is untrusted wire data or an existing state member.
    Postconditions: only the eight frozen v1 states succeed; non-string and
    legacy 0.3 state values fail without changing the surrounding wire model.
    """
    if not isinstance(value, str):
        raise ValueError("A Task state must be a string.")
    return TaskStateV1(value)


class StatusV1(WireModel):
    state: Annotated[TaskStateV1, BeforeValidator(_task_state_from_wire)]
    message: MessageV1 | None = None
    timestamp: str | None = None


class ArtifactV1(WireModel):
    artifactId: str = Field(min_length=1)  # noqa: N815  # Public field name.
    parts: list[PartV1] = Field(min_length=1)
    name: str | None = None
    description: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    extensions: list[str] = Field(default_factory=list)


class TaskV1(WireModel):
    id: str = Field(min_length=1)
    status: StatusV1
    contextId: str | None = Field(default=None, min_length=1)  # noqa: N815  # Public field name.
    artifacts: list[ArtifactV1] = Field(default_factory=list)
    history: list[MessageV1] = Field(default_factory=list)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class StatusUpdateV1(WireModel):
    taskId: str = Field(min_length=1)  # noqa: N815  # Public field name.
    contextId: str = Field(min_length=1)  # noqa: N815  # Public field name.
    status: StatusV1
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class ArtifactUpdateV1(WireModel):
    taskId: str = Field(min_length=1)  # noqa: N815  # Public field name.
    contextId: str = Field(min_length=1)  # noqa: N815  # Public field name.
    artifact: ArtifactV1
    append: bool = False
    lastChunk: bool = False  # noqa: N815  # Public field name.
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class ResponseV1(WireModel):
    task: TaskV1 | None = None
    message: MessageV1 | None = None
    statusUpdate: StatusUpdateV1 | None = None  # noqa: N815  # Public field name.
    artifactUpdate: ArtifactUpdateV1 | None = None  # noqa: N815  # Public field name.

    @model_validator(mode="after")
    def require_one_response(self) -> Self:
        """Exactly one union member must be present, never a JSON-RPC envelope."""
        if sum(value is not None for value in (self.task, self.message, self.statusUpdate, self.artifactUpdate)) != 1:
            raise ValueError("Response requires one union member")
        return self


def strict_json(body: bytes | str) -> object:
    """Decode JSON while rejecting duplicate keys, non-finite values and invalid UTF-8."""

    def pairs(values: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in values:
            if key in result:
                raise ValueError("Duplicate JSON key")
            result[key] = value
        return result

    def invalid_constant(_value: str) -> object:
        raise ValueError("Non-finite JSON number")

    def finite_float(value: str) -> float:
        result = float(value)
        if not math.isfinite(result):
            raise ValueError("Non-finite JSON number")
        return result

    try:
        return json.loads(
            body.decode("utf-8") if isinstance(body, bytes) else body,
            object_pairs_hook=pairs,
            parse_constant=invalid_constant,
            parse_float=finite_float,
        )
    except RecursionError as error:
        raise ValueError("JSON nesting limit exceeded") from error
