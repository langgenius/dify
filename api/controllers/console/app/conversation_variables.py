from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator

from controllers.common.rbac import PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import AppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    validate_request,
)
from extensions.ext_application_services import application_services
from fields._value_type_serializer import serialize_value_type
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from machinery.context import RequestContext
from services.conversation_variable_query import CONVERSATION_VARIABLE_LIMIT, ConversationVariableAppNotFoundError


class ConversationVariablesQuery(BaseModel):
    conversation_id: str = Field(..., description="Conversation ID to filter variables")


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
        return to_timestamp(value)


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
    @console_ns.doc(params=query_params_from_model(ConversationVariablesQuery))
    @console_ns.response(
        200,
        "Conversation variables retrieved successfully",
        console_ns.models[PaginatedConversationVariableResponse.__name__],
    )
    @console_account_admission(
        rbac_checks=[RBACCheck(RBACPermission.APP_CREATE_AND_MANAGEMENT, PlainApp())],
    )
    def get(self, request_context: RequestContext, app_id: UUID):
        queries = application_services().conversation_variables
        # Preserve the legacy app-not-found/mode check before query validation.
        try:
            queries.require_app(request_context, str(app_id))
        except ConversationVariableAppNotFoundError as error:
            raise AppNotFoundError(str(error)) from error
        req_data = validate_request(ConversationVariablesQuery)
        rows = queries.list_variables(request_context, str(app_id), req_data.conversation_id)

        return dump_response(
            PaginatedConversationVariableResponse,
            {
                "page": 1,
                "limit": CONVERSATION_VARIABLE_LIMIT,
                "total": len(rows),
                "has_more": False,
                "data": [
                    ConversationVariableResponse.model_validate(
                        {
                            "created_at": row.created_at,
                            "updated_at": row.updated_at,
                            **row.variable.model_dump(),
                            "id": row.id,
                        }
                    )
                    for row in rows
                ],
            },
        )
