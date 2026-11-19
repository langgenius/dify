"""Validated retry history shared by workflow persistence and tracing."""

from collections.abc import Mapping
from typing import Any, Final, Literal, NotRequired

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, ValidationError
from typing_extensions import TypedDict

RETRY_HISTORY_PROCESS_DATA_KEY: Final[Literal["__dify_retry_history"]] = "__dify_retry_history"


class WorkflowNodeRetryAttemptPayload(TypedDict):
    """JSON form of one persisted retry attempt.

    This is the exact shape written under :data:`RETRY_HISTORY_PROCESS_DATA_KEY`.
    Producers build it with :meth:`WorkflowNodeRetryAttempt.to_payload` and
    consumers parse it back with :meth:`WorkflowNodeRetryAttempt.model_validate`;
    both sides use this type instead of an untyped ``dict``.

    The variable mappings hold node-specific JSON that is opaque to this domain,
    so their values are pinned to :data:`pydantic.JsonValue` (JSON-serializable
    values) rather than ``Any``; no node-specific keys are invented here.
    """

    retry_index: int
    inputs: dict[str, JsonValue]
    process_data: dict[str, JsonValue]
    outputs: dict[str, JsonValue]
    error: str
    elapsed_time: float
    execution_metadata: dict[str, JsonValue]
    created_at: int
    finished_at: int


# Process Data carries node-specific keys alongside the retry history this domain
# owns, so only the history key is typed and every other key stays open.
# Individual history entries stay `Any`: Process Data is untrusted JSON read back
# from storage, so each entry is parsed into `WorkflowNodeRetryAttempt` where it
# is consumed and malformed entries are skipped rather than trusted here.
# The functional form is required: `RETRY_HISTORY_PROCESS_DATA_KEY` is a dunder
# name, which a class body would mangle to `_<Class>__dify_retry_history`.
# The key is optional and nullable because Process Data is written as free-form
# JSON by callers outside this module; a missing or null history means "no retries
# recorded yet", matching what the persistence layer writes before the first retry.
WorkflowNodeProcessDataPayload = TypedDict(
    "WorkflowNodeProcessDataPayload",
    {"__dify_retry_history": NotRequired[list[Any] | None]},
    extra_items=Any,  # type: ignore[call-arg]
)

_PROCESS_DATA_ADAPTER: Final[TypeAdapter[WorkflowNodeProcessDataPayload]] = TypeAdapter(WorkflowNodeProcessDataPayload)


def parse_process_data(raw: Mapping[str, Any] | None) -> WorkflowNodeProcessDataPayload:
    """Parse untrusted Process Data read back from storage.

    Precondition: ``raw`` is whatever was persisted, so it may be missing the
    history key or hold arbitrary JSON under it.
    Postcondition: the result is the typed Process Data mapping; key lookups on it
    no longer need isinstance checks.
    Raises ``pydantic.ValidationError`` when the history key is present but is not
    a list, which callers handle at their own boundary with the policy they need.
    """
    return _PROCESS_DATA_ADAPTER.validate_python(raw or {})


def read_retry_history(raw: Mapping[str, Any] | None) -> list[Any]:
    """Return the persisted retry entries, tolerating a malformed history key.

    Precondition: ``raw`` is untrusted Process Data.
    Postcondition: the returned list holds the raw entries to be validated one by
    one; a missing, null, or non-list history reads as "no retries recorded",
    which keeps a single corrupt write from failing the node execution.
    """
    try:
        payload = parse_process_data(raw)
    except ValidationError:
        return []
    return list(payload.get(RETRY_HISTORY_PROCESS_DATA_KEY) or [])


class WorkflowNodeRetryAttempt(BaseModel):
    """Complete data captured for one failed node attempt before a retry."""

    retry_index: int = Field(gt=0)
    inputs: Mapping[str, Any]
    process_data: Mapping[str, Any]
    outputs: Mapping[str, Any]
    error: str
    elapsed_time: float = Field(ge=0)
    execution_metadata: Mapping[str, Any]
    created_at: int
    finished_at: int

    model_config = ConfigDict(extra="forbid")

    def to_payload(self) -> WorkflowNodeRetryAttemptPayload:
        """Return the JSON-ready mapping persisted under the retry-history key."""
        return {
            "retry_index": self.retry_index,
            "inputs": dict(self.inputs),
            "process_data": dict(self.process_data),
            "outputs": dict(self.outputs),
            "error": self.error,
            "elapsed_time": self.elapsed_time,
            "execution_metadata": dict(self.execution_metadata),
            "created_at": self.created_at,
            "finished_at": self.finished_at,
        }
