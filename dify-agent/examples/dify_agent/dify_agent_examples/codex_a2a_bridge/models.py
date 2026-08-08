"""Minimal A2A 1.0 request models used by the Codex bridge."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


A2A_MEDIA_TYPE = "application/a2a+json"
A2A_PROTOCOL_VERSION = "1.0"
TASK_STATE_SUBMITTED = "TASK_STATE_SUBMITTED"
TASK_STATE_WORKING = "TASK_STATE_WORKING"
TASK_STATE_COMPLETED = "TASK_STATE_COMPLETED"
TASK_STATE_FAILED = "TASK_STATE_FAILED"
TASK_STATE_CANCELED = "TASK_STATE_CANCELED"
TERMINAL_TASK_STATES = frozenset({TASK_STATE_COMPLETED, TASK_STATE_FAILED, TASK_STATE_CANCELED})


class A2AModel(BaseModel):
    """ProtoJSON-compatible base model with forward-compatible unknown fields."""

    model_config = ConfigDict(populate_by_name=True, extra="ignore")


class MessagePart(A2AModel):
    text: str | None = None
    raw: str | None = None
    url: str | None = None
    data: Any | None = None
    metadata: dict[str, Any] | None = None
    filename: str | None = None
    media_type: str | None = Field(default=None, alias="mediaType")


class A2AMessage(A2AModel):
    message_id: str = Field(alias="messageId", min_length=1, max_length=256)
    context_id: str | None = Field(default=None, alias="contextId", max_length=256)
    task_id: str | None = Field(default=None, alias="taskId", max_length=256)
    role: Literal["ROLE_USER"]
    parts: list[MessagePart] = Field(min_length=1)
    metadata: dict[str, Any] | None = None
    extensions: list[str] = Field(default_factory=list)
    reference_task_ids: list[str] = Field(default_factory=list, alias="referenceTaskIds")

    def prompt_text(self) -> str:
        """Return the text prompt while rejecting undeclared input modes."""
        if any(part.raw is not None or part.url is not None or part.data is not None for part in self.parts):
            raise UnsupportedInputError("The Codex bridge currently accepts text parts only")
        texts = [part.text for part in self.parts if part.text is not None]
        prompt = "\n".join(texts).strip()
        if not prompt:
            raise InvalidMessageError("The message must contain a non-empty text part")
        if len(prompt) > 100_000:
            raise InvalidMessageError("The combined text prompt exceeds 100000 characters")
        return prompt


class SendMessageConfiguration(A2AModel):
    accepted_output_modes: list[str] = Field(default_factory=list, alias="acceptedOutputModes")
    history_length: int | None = Field(default=None, alias="historyLength", ge=0)
    return_immediately: bool = Field(default=False, alias="returnImmediately")


class SendMessageRequest(A2AModel):
    tenant: str | None = None
    message: A2AMessage
    configuration: SendMessageConfiguration = Field(default_factory=SendMessageConfiguration)
    metadata: dict[str, Any] | None = None


class BridgeProblem(Exception):
    """A2A HTTP binding error rendered as a google.rpc.Status JSON envelope."""

    def __init__(
        self,
        *,
        status: int,
        status_name: str,
        reason: str,
        detail: str,
        metadata: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(detail)
        self.status = status
        self.status_name = status_name
        self.reason = reason
        self.detail = detail
        self.metadata = metadata or {}
        self.headers = headers or {}


class InvalidMessageError(BridgeProblem):
    def __init__(self, detail: str) -> None:
        super().__init__(
            status=400,
            status_name="INVALID_ARGUMENT",
            reason="INVALID_REQUEST",
            detail=detail,
        )


class UnsupportedInputError(BridgeProblem):
    def __init__(self, detail: str) -> None:
        super().__init__(
            status=400,
            status_name="INVALID_ARGUMENT",
            reason="CONTENT_TYPE_NOT_SUPPORTED",
            detail=detail,
        )


class TaskNotFoundError(BridgeProblem):
    def __init__(self, task_id: str) -> None:
        super().__init__(
            status=404,
            status_name="NOT_FOUND",
            reason="TASK_NOT_FOUND",
            detail=f"Task {task_id!r} does not exist",
            metadata={"taskId": task_id},
        )


class TaskNotCancelableError(BridgeProblem):
    def __init__(self, task_id: str) -> None:
        super().__init__(
            status=400,
            status_name="FAILED_PRECONDITION",
            reason="TASK_NOT_CANCELABLE",
            detail=f"Task {task_id!r} is already in a terminal state",
            metadata={"taskId": task_id},
        )


class ContextBusyError(BridgeProblem):
    def __init__(self, context_id: str) -> None:
        super().__init__(
            status=409,
            status_name="ABORTED",
            reason="CONTEXT_BUSY",
            detail=f"Context {context_id!r} already has a running Codex turn",
            metadata={"contextId": context_id},
        )


class TaskContinuationError(BridgeProblem):
    def __init__(self) -> None:
        super().__init__(
            status=400,
            status_name="FAILED_PRECONDITION",
            reason="UNSUPPORTED_OPERATION",
            detail="Start the next Codex turn with the prior contextId instead of a terminal taskId",
        )


class TaskNotSubscribableError(BridgeProblem):
    def __init__(self, task_id: str) -> None:
        super().__init__(
            status=400,
            status_name="FAILED_PRECONDITION",
            reason="UNSUPPORTED_OPERATION",
            detail=f"Task {task_id!r} is already in a terminal state and cannot be subscribed to",
            metadata={"taskId": task_id},
        )


class UnauthorizedError(BridgeProblem):
    def __init__(self) -> None:
        super().__init__(
            status=401,
            status_name="UNAUTHENTICATED",
            reason="UNAUTHENTICATED",
            detail="A valid bearer token is required",
            headers={"WWW-Authenticate": "Bearer"},
        )


class VersionNotSupportedError(BridgeProblem):
    def __init__(self, version: str) -> None:
        super().__init__(
            status=400,
            status_name="FAILED_PRECONDITION",
            reason="VERSION_NOT_SUPPORTED",
            detail=f"A2A protocol version {version!r} is not supported; use 1.0",
            metadata={"requestedVersion": version, "supportedVersion": A2A_PROTOCOL_VERSION},
        )
