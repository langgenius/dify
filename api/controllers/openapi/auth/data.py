"""The two value types the subject layer publishes: what kind of caller a
subject speaks for, and the identity an external one carries.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict


class CallerKind(StrEnum):
    ACCOUNT = "account"
    END_USER = "end_user"


class ExternalIdentity(BaseModel):
    model_config = ConfigDict(frozen=True)

    email: str
    issuer: str | None = None
