from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _A2AModel(BaseModel):
    """ProtoJSON-compatible base model for the A2A 1.0 HTTP+JSON binding."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")


class A2ATaskState(StrEnum):
    UNSPECIFIED = "TASK_STATE_UNSPECIFIED"
    SUBMITTED = "TASK_STATE_SUBMITTED"
    WORKING = "TASK_STATE_WORKING"
    COMPLETED = "TASK_STATE_COMPLETED"
    FAILED = "TASK_STATE_FAILED"
    CANCELED = "TASK_STATE_CANCELED"
    INPUT_REQUIRED = "TASK_STATE_INPUT_REQUIRED"
    REJECTED = "TASK_STATE_REJECTED"
    AUTH_REQUIRED = "TASK_STATE_AUTH_REQUIRED"

    @property
    def terminal(self) -> bool:
        return self in {
            self.COMPLETED,
            self.FAILED,
            self.CANCELED,
            self.REJECTED,
            self.INPUT_REQUIRED,
            self.AUTH_REQUIRED,
        }


class A2AAgentInterface(_A2AModel):
    url: str
    protocol_binding: str = Field(alias="protocolBinding")
    protocol_version: str = Field(alias="protocolVersion")
    tenant: str | None = None


class A2AAgentCapabilities(_A2AModel):
    streaming: bool = False
    push_notifications: bool = Field(default=False, alias="pushNotifications")
    extended_agent_card: bool = Field(default=False, alias="extendedAgentCard")
    extensions: list[dict[str, Any]] = Field(default_factory=list)


class A2AAgentSkill(_A2AModel):
    id: str
    name: str
    description: str
    tags: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    input_modes: list[str] = Field(default_factory=list, alias="inputModes")
    output_modes: list[str] = Field(default_factory=list, alias="outputModes")


class A2AAgentCard(_A2AModel):
    name: str
    description: str
    supported_interfaces: list[A2AAgentInterface] = Field(alias="supportedInterfaces")
    version: str
    capabilities: A2AAgentCapabilities
    default_input_modes: list[str] = Field(default_factory=list, alias="defaultInputModes")
    default_output_modes: list[str] = Field(default_factory=list, alias="defaultOutputModes")
    skills: list[A2AAgentSkill] = Field(default_factory=list)
    icon_url: str | None = Field(default=None, alias="iconUrl")
    documentation_url: str | None = Field(default=None, alias="documentationUrl")
    provider: dict[str, Any] | None = None
    security_schemes: dict[str, Any] = Field(default_factory=dict, alias="securitySchemes")
    security_requirements: list[dict[str, Any]] = Field(default_factory=list, alias="securityRequirements")
    signatures: list[dict[str, Any]] = Field(default_factory=list)

    def preferred_http_interface(self) -> A2AAgentInterface:
        for interface in self.supported_interfaces:
            if interface.protocol_binding.upper() == "HTTP+JSON" and interface.protocol_version == "1.0":
                return interface
        raise ValueError("Agent Card does not advertise an A2A 1.0 HTTP+JSON interface")


class A2APart(_A2AModel):
    text: str | None = None
    raw: str | None = None
    url: str | None = None
    data: Any = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    filename: str | None = None
    media_type: str | None = Field(default=None, alias="mediaType")

    @model_validator(mode="after")
    def validate_single_content(self) -> A2APart:
        values = [self.text is not None, self.raw is not None, self.url is not None, self.data is not None]
        if sum(values) != 1:
            raise ValueError("A2A Part must contain exactly one of text, raw, url, or data")
        return self


class A2AMessage(_A2AModel):
    message_id: str = Field(alias="messageId")
    role: str
    parts: list[A2APart]
    context_id: str | None = Field(default=None, alias="contextId")
    task_id: str | None = Field(default=None, alias="taskId")
    metadata: dict[str, Any] = Field(default_factory=dict)
    extensions: list[str] = Field(default_factory=list)
    reference_task_ids: list[str] = Field(default_factory=list, alias="referenceTaskIds")


class A2AArtifact(_A2AModel):
    artifact_id: str = Field(alias="artifactId")
    parts: list[A2APart]
    name: str | None = None
    description: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    extensions: list[str] = Field(default_factory=list)


class A2ATaskStatus(_A2AModel):
    state: A2ATaskState
    message: A2AMessage | None = None
    timestamp: str | None = None


class A2ATask(_A2AModel):
    id: str
    status: A2ATaskStatus
    context_id: str | None = Field(default=None, alias="contextId")
    artifacts: list[A2AArtifact] = Field(default_factory=list)
    history: list[A2AMessage] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class A2ATaskStatusUpdate(_A2AModel):
    task_id: str = Field(alias="taskId")
    context_id: str = Field(alias="contextId")
    status: A2ATaskStatus
    metadata: dict[str, Any] = Field(default_factory=dict)


class A2ATaskArtifactUpdate(_A2AModel):
    task_id: str = Field(alias="taskId")
    context_id: str = Field(alias="contextId")
    artifact: A2AArtifact
    append: bool = False
    last_chunk: bool = Field(default=False, alias="lastChunk")
    metadata: dict[str, Any] = Field(default_factory=dict)


class A2AStreamResponse(_A2AModel):
    task: A2ATask | None = None
    message: A2AMessage | None = None
    status_update: A2ATaskStatusUpdate | None = Field(default=None, alias="statusUpdate")
    artifact_update: A2ATaskArtifactUpdate | None = Field(default=None, alias="artifactUpdate")

    @model_validator(mode="after")
    def validate_payload(self) -> A2AStreamResponse:
        payloads = [self.task, self.message, self.status_update, self.artifact_update]
        if sum(payload is not None for payload in payloads) != 1:
            raise ValueError("A2A StreamResponse must contain exactly one payload")
        return self


class A2ASendMessageResponse(_A2AModel):
    task: A2ATask | None = None
    message: A2AMessage | None = None

    @model_validator(mode="after")
    def validate_payload(self) -> A2ASendMessageResponse:
        if (self.task is None) == (self.message is None):
            raise ValueError("A2A SendMessageResponse must contain exactly one payload")
        return self
