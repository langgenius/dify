"""The identity an external subject carries."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ExternalIdentity(BaseModel):
    model_config = ConfigDict(frozen=True)

    email: str
    issuer: str | None = None
