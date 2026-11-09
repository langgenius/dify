from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import WithJsonSchema

from fields.base import ResponseModel

UUIDString = Annotated[str, WithJsonSchema({"format": "uuid", "type": "string"})]


class SimpleEndUser(ResponseModel):
    id: str
    type: str
    is_anonymous: bool
    session_id: str | None = None


class EndUserDetail(ResponseModel):
    """Full end-user detail returned by the Service API."""

    id: UUIDString
    tenant_id: UUIDString
    app_id: UUIDString | None = None
    type: str
    external_user_id: str | None = None
    name: str | None = None
    is_anonymous: bool
    session_id: str
    created_at: datetime
    updated_at: datetime
