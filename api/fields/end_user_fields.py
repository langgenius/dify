from __future__ import annotations

from flask_restx import fields
from pydantic import BaseModel, ConfigDict

simple_end_user_fields = {
    "id": fields.String,
    "type": fields.String,
    "is_anonymous": fields.Boolean,
    "session_id": fields.String,
}


class ResponseModel(BaseModel):
    model_config = ConfigDict(
        from_attributes=True,
        extra="ignore",
        populate_by_name=True,
        serialize_by_alias=True,
        protected_namespaces=(),
    )


class SimpleEndUser(ResponseModel):
    id: str
    type: str
    is_anonymous: bool
    session_id: str | None = None
