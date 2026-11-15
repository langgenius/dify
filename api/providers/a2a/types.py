"""Strict wire schema for the frozen A2A 1.0 HTTP+JSON v1 profile.

These are infrastructure DTOs. No application service imports this module.
Unknown core fields and 0.3 discriminators are rejected instead of guessed.
Extension-specific JSON remains under explicitly typed metadata/params.
"""

import json
import math
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, JsonValue, model_validator


class WireModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, populate_by_name=False, allow_inf_nan=False, serialize_by_alias=True
    )


class AgentInterfaceV1(WireModel):
    url: str = Field(min_length=1)
    protocolBinding: str
    protocolVersion: str
    tenant: str | None = None


class ExtensionV1(WireModel):
    uri: str = Field(min_length=1)
    description: str | None = None
    required: bool = False
    params: dict[str, JsonValue] = Field(default_factory=dict)


class CapabilitiesV1(WireModel):
    streaming: bool = False
    pushNotifications: bool = False
    extendedAgentCard: bool = False
    extensions: list[ExtensionV1] = Field(default_factory=list)


class SkillV1(WireModel):
    id: str = Field(min_length=1)
    name: str
    description: str
    tags: list[str]
    examples: list[str] = Field(default_factory=list)
    inputModes: list[str] = Field(default_factory=list)
    outputModes: list[str] = Field(default_factory=list)
    securityRequirements: list[dict[str, JsonValue]] = Field(default_factory=list)


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
    supportedInterfaces: list[AgentInterfaceV1] = Field(min_length=1)
    version: str
    capabilities: CapabilitiesV1
    defaultInputModes: list[str]
    defaultOutputModes: list[str]
    skills: list[SkillV1]
    provider: ProviderV1 | None = None
    documentationUrl: str | None = None
    iconUrl: str | None = None
    securitySchemes: dict[str, dict[str, JsonValue]] = Field(default_factory=dict)
    securityRequirements: list[SecurityRequirementV1] = Field(default_factory=list)
    signatures: list[dict[str, JsonValue]] = Field(default_factory=list)


class PartV1(WireModel):
    text: str | None = None
    raw: str | None = None
    url: str | None = None
    data: JsonValue = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    filename: str | None = None
    mediaType: str | None = None

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


class MessageV1(WireModel):
    messageId: str = Field(min_length=1)
    role: Literal["ROLE_USER", "ROLE_AGENT"]
    parts: list[PartV1] = Field(min_length=1)
    contextId: str | None = Field(default=None, min_length=1)
    taskId: str | None = Field(default=None, min_length=1)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    extensions: list[str] = Field(default_factory=list)
    referenceTaskIds: list[str] = Field(default_factory=list)


type TaskStateV1 = Literal[
    "TASK_STATE_SUBMITTED",
    "TASK_STATE_WORKING",
    "TASK_STATE_COMPLETED",
    "TASK_STATE_FAILED",
    "TASK_STATE_CANCELED",
    "TASK_STATE_REJECTED",
    "TASK_STATE_INPUT_REQUIRED",
    "TASK_STATE_AUTH_REQUIRED",
]


class StatusV1(WireModel):
    state: TaskStateV1
    message: MessageV1 | None = None
    timestamp: str | None = None


class ArtifactV1(WireModel):
    artifactId: str = Field(min_length=1)
    parts: list[PartV1] = Field(min_length=1)
    name: str | None = None
    description: str | None = None
    metadata: dict[str, JsonValue] = Field(default_factory=dict)
    extensions: list[str] = Field(default_factory=list)


class TaskV1(WireModel):
    id: str = Field(min_length=1)
    status: StatusV1
    contextId: str | None = Field(default=None, min_length=1)
    artifacts: list[ArtifactV1] = Field(default_factory=list)
    history: list[MessageV1] = Field(default_factory=list)
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class StatusUpdateV1(WireModel):
    taskId: str = Field(min_length=1)
    contextId: str = Field(min_length=1)
    status: StatusV1
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class ArtifactUpdateV1(WireModel):
    taskId: str = Field(min_length=1)
    contextId: str = Field(min_length=1)
    artifact: ArtifactV1
    append: bool = False
    lastChunk: bool = False
    metadata: dict[str, JsonValue] = Field(default_factory=dict)


class ResponseV1(WireModel):
    task: TaskV1 | None = None
    message: MessageV1 | None = None
    statusUpdate: StatusUpdateV1 | None = None
    artifactUpdate: ArtifactUpdateV1 | None = None

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
