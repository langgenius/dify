from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter, field_validator
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import BadRequest, NotFound

import services
from controllers.common.controller_schemas import ConversationRenamePayload
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.schema import expect_user_json, expect_with_user
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields._value_type_serializer import serialize_value_type
from fields.base import ResponseModel
from fields.conversation_fields import (
    ConversationInfiniteScrollPagination,
    SimpleConversation,
)
from graphon.variables.types import SegmentType
from libs.helper import UUIDStrOrEmpty, dump_response, to_timestamp
from models.model import App, AppMode, EndUser
from services.conversation_service import ConversationService


class ConversationListQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = Field(
        default=None,
        description="The ID of the last record on the current page. Used to fetch the next page.",
    )
    limit: int = Field(default=20, ge=1, le=100, description="Number of records to return.")
    sort_by: Literal["created_at", "-created_at", "updated_at", "-updated_at"] = Field(
        default="-updated_at",
        description="Sorting field. Use the `-` prefix for descending order.",
    )


class ConversationVariablesQuery(BaseModel):
    last_id: UUIDStrOrEmpty | None = Field(
        default=None,
        description="The ID of the last record on the current page. Used to fetch the next page.",
    )
    limit: int = Field(default=20, ge=1, le=100, description="Number of records to return.")
    variable_name: str | None = Field(
        default=None,
        description="Filter variables by a specific name.",
        min_length=1,
        max_length=255,
    )

    @field_validator("variable_name", mode="before")
    @classmethod
    def validate_variable_name(cls, v: str | None) -> str | None:
        """
        Validate variable_name to prevent injection attacks.
        """
        if v is None:
            return v

        # Only allow safe characters: alphanumeric, underscore, hyphen, period
        if not v.replace("-", "").replace("_", "").replace(".", "").isalnum():
            raise ValueError(
                "Variable name can only contain letters, numbers, hyphens (-), underscores (_), and periods (.)"
            )

        # Prevent SQL injection patterns
        dangerous_patterns = ["'", '"', ";", "--", "/*", "*/", "xp_", "sp_"]
        for pattern in dangerous_patterns:
            if pattern in v.lower():
                raise ValueError(f"Variable name contains invalid characters: {pattern}")

        return v


class ConversationVariableUpdatePayload(BaseModel):
    value: Any = Field(description="The new value for the variable. Must match the variable's expected type.")


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
    def normalize_value_type(cls, value: Any) -> str:
        exposed_type = getattr(value, "exposed_type", None)
        if callable(exposed_type):
            return str(exposed_type())
        if isinstance(value, str):
            try:
                return str(SegmentType(value).exposed_type())
            except ValueError:
                return value
        try:
            return serialize_value_type(value)
        except (AttributeError, TypeError, ValueError):
            pass

        try:
            return serialize_value_type({"value_type": value})
        except (AttributeError, TypeError, ValueError):
            value_attr = getattr(value, "value", None)
            if value_attr is not None:
                return str(value_attr)
            return str(value)

    @field_validator("value", mode="before")
    @classmethod
    def normalize_value(cls, value: Any | None) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(value)

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class ConversationVariableInfiniteScrollPaginationResponse(ResponseModel):
    limit: int
    has_more: bool
    data: list[ConversationVariableResponse]


register_schema_models(
    service_api_ns,
    ConversationListQuery,
    ConversationRenamePayload,
    ConversationVariablesQuery,
    ConversationVariableUpdatePayload,
)
register_response_schema_models(
    service_api_ns,
    ConversationVariableResponse,
    ConversationVariableInfiniteScrollPaginationResponse,
    ConversationInfiniteScrollPagination,
    SimpleConversation,
)


@service_api_ns.route("/conversations")
class ConversationApi(Resource):
    @service_api_ns.doc(
        summary="List Conversations",
        description="Retrieve the conversation list for the current user, ordered by most recently active.",
        tags=["Conversations"],
        responses={
            200: "Successfully retrieved conversations list.",
            400: "`not_chat_app` : App mode does not match the API route.",
            404: "`not_found` : Last conversation does not exist (invalid `last_id`).",
        },
    )
    @service_api_ns.doc("list_conversations")
    @service_api_ns.doc(description="List all conversations for the current user")
    @service_api_ns.doc(params=query_params_from_model(ConversationListQuery))
    @service_api_ns.doc(
        responses={
            200: "Conversations retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Last conversation not found",
        }
    )
    @service_api_ns.response(
        200,
        "Conversations retrieved successfully",
        service_api_ns.models[ConversationInfiniteScrollPagination.__name__],
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser):
        """List all conversations for the current user.

        Supports pagination using last_id and limit parameters.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        query_args = ConversationListQuery.model_validate(request.args.to_dict())
        last_id = query_args.last_id or None

        try:
            with sessionmaker(db.engine).begin() as session:
                pagination = ConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=end_user,
                    last_id=last_id,
                    limit=query_args.limit,
                    invoke_from=InvokeFrom.SERVICE_API,
                    sort_by=query_args.sort_by,
                )
                adapter = TypeAdapter(SimpleConversation)
                conversations = [adapter.validate_python(item, from_attributes=True) for item in pagination.data]
                return ConversationInfiniteScrollPagination(
                    limit=pagination.limit, has_more=pagination.has_more, data=conversations
                ).model_dump(mode="json")
        except services.errors.conversation.LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>")
class ConversationDetailApi(Resource):
    @service_api_ns.doc(
        summary="Delete Conversation",
        description="Delete a conversation.",
        tags=["Conversations"],
        responses={
            204: "Conversation deleted successfully.",
            400: "`not_chat_app` : App mode does not match the API route.",
            404: "`not_found` : Conversation does not exist.",
        },
    )
    @expect_user_json(service_api_ns)
    @service_api_ns.doc("delete_conversation")
    @service_api_ns.doc(description="Delete a specific conversation")
    @service_api_ns.doc(params={"c_id": "Conversation ID."})
    @service_api_ns.doc(
        responses={
            204: "Conversation deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def delete(self, app_model: App, end_user: EndUser, c_id: UUID):
        """Delete a specific conversation."""
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            ConversationService.delete(app_model, conversation_id, end_user)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        return "", 204


@service_api_ns.route("/conversations/<uuid:c_id>/name")
class ConversationRenameApi(Resource):
    @service_api_ns.doc(
        summary="Rename Conversation",
        description=(
            "Rename a conversation or auto-generate a name. The conversation name is used for display on "
            "clients that support multiple conversations."
        ),
        tags=["Conversations"],
        responses={
            200: "Conversation renamed successfully.",
            400: "`not_chat_app` : App mode does not match the API route.",
            404: "`not_found` : Conversation does not exist.",
        },
    )
    @expect_with_user(service_api_ns, ConversationRenamePayload)
    @service_api_ns.doc("rename_conversation")
    @service_api_ns.doc(description="Rename a conversation or auto-generate a name")
    @service_api_ns.doc(params={"c_id": "Conversation ID."})
    @service_api_ns.doc(
        responses={
            200: "Conversation renamed successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation not found",
        }
    )
    @service_api_ns.response(
        200,
        "Conversation renamed successfully",
        service_api_ns.models[SimpleConversation.__name__],
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def post(self, app_model: App, end_user: EndUser, c_id: UUID):
        """Rename a conversation or auto-generate a name."""
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT, AppMode.AGENT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        payload = ConversationRenamePayload.model_validate(service_api_ns.payload or {})

        try:
            conversation = ConversationService.rename(
                app_model, conversation_id, end_user, payload.name, payload.auto_generate
            )
            return dump_response(SimpleConversation, conversation)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>/variables")
class ConversationVariablesApi(Resource):
    @service_api_ns.doc(
        summary="List Conversation Variables",
        description="Retrieve variables from a specific conversation.",
        tags=["Conversations"],
        responses={
            200: "Successfully retrieved conversation variables.",
            400: "`not_chat_app` : App mode does not match the API route.",
            404: "`not_found` : Conversation does not exist.",
        },
    )
    @service_api_ns.doc("list_conversation_variables")
    @service_api_ns.doc(description="List all variables for a conversation")
    @service_api_ns.doc(params={"c_id": "Conversation ID.", **query_params_from_model(ConversationVariablesQuery)})
    @service_api_ns.doc(
        responses={
            200: "Variables retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation not found",
        }
    )
    @service_api_ns.response(
        200,
        "Variables retrieved successfully",
        service_api_ns.models[ConversationVariableInfiniteScrollPaginationResponse.__name__],
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser, c_id: UUID):
        """List all variables for a conversation.

        Conversational variables are only available for chat applications.
        """
        # conversational variable only for chat app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        query_args = ConversationVariablesQuery.model_validate(request.args.to_dict())
        last_id = query_args.last_id or None

        try:
            pagination = ConversationService.get_conversational_variable(
                app_model, conversation_id, end_user, query_args.limit, last_id, query_args.variable_name
            )
            return dump_response(ConversationVariableInfiniteScrollPaginationResponse, pagination)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>/variables/<uuid:variable_id>")
class ConversationVariableDetailApi(Resource):
    @service_api_ns.doc(
        summary="Update Conversation Variable",
        description="Update the value of a specific conversation variable. The value must match the expected type.",
        tags=["Conversations"],
        responses={
            200: "Variable updated successfully.",
            400: (
                "- `not_chat_app` : App mode does not match the API route.\n"
                "- `bad_request` : Variable value type mismatch."
            ),
            404: (
                "- `not_found` : Conversation does not exist.\n- `not_found` : Conversation variable does not exist."
            ),
        },
    )
    @expect_with_user(service_api_ns, ConversationVariableUpdatePayload)
    @service_api_ns.doc("update_conversation_variable")
    @service_api_ns.doc(description="Update a conversation variable's value")
    @service_api_ns.doc(params={"c_id": "Conversation ID.", "variable_id": "Variable ID."})
    @service_api_ns.doc(
        responses={
            200: "Variable updated successfully",
            400: "Bad request - type mismatch",
            401: "Unauthorized - invalid API token",
            404: "Conversation or variable not found",
        }
    )
    @service_api_ns.response(
        200,
        "Variable updated successfully",
        service_api_ns.models[ConversationVariableResponse.__name__],
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def put(self, app_model: App, end_user: EndUser, c_id: UUID, variable_id: UUID):
        """Update a conversation variable's value.

        Allows updating the value of a specific conversation variable.
        The value must match the variable's expected type.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        variable_id_str = str(variable_id)

        payload = ConversationVariableUpdatePayload.model_validate(service_api_ns.payload or {})

        try:
            variable = ConversationService.update_conversation_variable(
                app_model, conversation_id, variable_id_str, end_user, payload.value
            )
            return dump_response(ConversationVariableResponse, variable)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationVariableNotExistsError:
            raise NotFound("Conversation Variable Not Exists.")
        except services.errors.conversation.ConversationVariableTypeMismatchError as e:
            raise BadRequest(str(e))
