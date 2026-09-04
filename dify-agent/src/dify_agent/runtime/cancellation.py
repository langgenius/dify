"""Private cancellation coordination types shared by schedulers and run stores."""

from datetime import datetime
from typing import ClassVar

from pydantic import BaseModel, ConfigDict


class RunCancellationIntent(BaseModel):
    """The first accepted request to cancel one running run."""

    reason: str | None = None
    message: str | None = None
    requested_at: datetime

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="forbid")


__all__ = ["RunCancellationIntent"]
