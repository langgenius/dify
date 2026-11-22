"""What a caller sends to start a job or wait for it, and what it reads back."""

from __future__ import annotations

from typing import Any, Final, Self

from pydantic import BaseModel, Field

from services.run_job.contracts import JobStatus
from services.run_job.service import WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS, JobView

IDEMPOTENCY_KEY_MAX_LENGTH: Final = 128


class JobStartFields(BaseModel):
    wait_seconds: int = Field(
        default=WAIT_DEFAULT_SECONDS,
        ge=0,
        le=WAIT_MAX_SECONDS,
        description="How long to wait for the result before answering; 0 answers at once",
    )
    idempotency_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=IDEMPOTENCY_KEY_MAX_LENGTH,
        description="A repeated start with the same key returns the first job",
    )


class JobWaitQuery(BaseModel):
    wait_seconds: int = Field(
        default=WAIT_DEFAULT_SECONDS,
        ge=0,
        le=WAIT_MAX_SECONDS,
        description="How long to wait for a final state; 0 answers at once",
    )


class JobResult(BaseModel):
    id: str
    status: JobStatus
    run_id: str | None = None
    message_id: str | None = None
    conversation_id: str | None = None
    answer: str | None = None
    outputs: dict[str, Any] | None = None
    error: str | None = None

    @classmethod
    def of(cls, view: JobView) -> Self:
        """Postcondition: the view's job id, status, run ids and result, with every other field at its default."""
        record = view.record
        return cls(
            id=record.id,
            status=view.status,
            run_id=record.run_id,
            message_id=record.message_id,
            conversation_id=record.conversation_id,
            answer=view.answer,
            outputs=dict(view.outputs) if view.outputs is not None else None,
            error=view.error,
        )
