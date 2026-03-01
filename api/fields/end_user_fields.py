from __future__ import annotations

from datetime import datetime

from flask_restx import fields
from pydantic import BaseModel, ConfigDict, Field

simple_end_user_fields = {
    "id": fields.String,
    "type": fields.String,
    "is_anonymous": fields.Boolean,
    "session_id": fields.String,
}

end_user_detail_fields = {
    "id": fields.String,
    "tenant_id": fields.String,
    "app_id": fields.String,
    "type": fields.String,
    "external_user_id": fields.String,
    "name": fields.String,
    "is_anonymous": fields.Boolean,
    "session_id": fields.String,
    "created_at": fields.DateTime,
    "updated_at": fields.DateTime,
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


class EndUserDetail(ResponseModel):
    """Full EndUser record for API responses.

    Note: The SQLAlchemy model defines an `is_anonymous` property for Flask-Login semantics
    (always False). The database column is exposed as `_is_anonymous`, so this DTO maps
    `is_anonymous` from `_is_anonymous` to return the stored value.
    """

    id: str
    tenant_id: str
    app_id: str | None = None
    type: str
    external_user_id: str | None = None
    name: str | None = None
    is_anonymous: bool = Field(validation_alias="_is_anonymous")
    session_id: str
    created_at: datetime
    updated_at: datetime
