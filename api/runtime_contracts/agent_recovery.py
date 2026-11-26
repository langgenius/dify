"""Bounded durable identities shared by Agent recovery and workflow persistence."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

# The native declared-output contract permits at most ten intentional retries.
MAX_AGENT_CREATE_ATTEMPT = 10


class AgentCreateIntent(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)
    attempt: Annotated[int, Field(strict=True, ge=0, le=MAX_AGENT_CREATE_ATTEMPT)]
    key: Annotated[str, Field(strict=True, min_length=1, max_length=256)]
    digest: Annotated[str, Field(strict=True, pattern=r"^[0-9a-f]{64}$")]
    child_run_id: Annotated[str, Field(strict=True, min_length=1, max_length=256)] | None = None
