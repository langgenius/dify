from __future__ import annotations

from datetime import datetime
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields._value_type_serializer import serialize_value_type
from fields.base import ResponseModel
from libs.login import login_required
from models import ConversationVariable
from models.model import AppMode


class ConversationVariablesQuery(BaseModel):
    conversation_id: str = Field(..., description="Conversation ID to filter variables")


def _to_timestamp(value: datetime | int | None) -> int | None:
    if isinstance(value, datetime):
        return int(value.timestamp())
    return value


class ConversationVariableResponse(ResponseModel):
    id: str
    name: str
    value_type: str
    value: str | None = None
    description: str | None = None
    created_at: int | None = None
    updated_at: int | None = None

    @field_validator("value_type", mode="before")
    @classmethod
    def _normalize_value_type(cls, value: Any) -> str:
        exposed_type = getattr(value, "exposed_type", None)
        if callable(exposed_type):
            return str(exposed_type())
        if isinstance(value, str):
            return value
        try:
            return serialize_value_type(value)
        except Exception:
            return serialize_value_type({"value_type": value})

    @field_validator("value", mode="before")
    @classmethod
    def _normalize_value(cls, value: Any | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(value)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return _to_timestamp(value)


class PaginatedConversationVariableResponse(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[ConversationVariableResponse]


register_schema_models(
    console_ns,
    ConversationVariablesQuery,
    ConversationVariableResponse,
    PaginatedConversationVariableResponse,
)


@console_ns.route("/apps/<uuid:app_id>/conversation-variables")
class ConversationVariablesApi(Resource):
    @console_ns.doc("get_conversation_variables")
    @console_ns.doc(description="Get conversation variables for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ConversationVariablesQuery.__name__])
    @console_ns.response(
        200,
        "Conversation variables retrieved successfully",
        console_ns.models[PaginatedConversationVariableResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=AppMode.ADVANCED_CHAT)
    def get(self, app_model):
        args = ConversationVariablesQuery.model_validate(request.args.to_dict(flat=True))

        stmt = (
            select(ConversationVariable)
            .where(ConversationVariable.app_id == app_model.id)
            .order_by(ConversationVariable.created_at)
        )
        stmt = stmt.where(ConversationVariable.conversation_id == args.conversation_id)

        # NOTE: This is a temporary solution to avoid performance issues.
        page = 1
        page_size = 100
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)

        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            rows = session.scalars(stmt).all()

        response = PaginatedConversationVariableResponse.model_validate(
            {
                "page": page,
                "limit": page_size,
                "total": len(rows),
                "has_more": False,
                "data": [
                    ConversationVariableResponse.model_validate(
                        {
                            "created_at": row.created_at,
                            "updated_at": row.updated_at,
                            **row.to_variable().model_dump(),
                        }
                    )
                    for row in rows
                ],
            }
        )
        return response.model_dump(mode="json")
