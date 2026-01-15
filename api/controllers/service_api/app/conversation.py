from typing import Any, Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, TypeAdapter, field_validator, model_validator
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

import services
from controllers.common.schema import register_schema_models
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    ConversationDelete,
    ConversationInfiniteScrollPagination,
    SimpleConversation,
)
from fields.conversation_variable_fields import (
    build_conversation_variable_infinite_scroll_pagination_model,
    build_conversation_variable_model,
)
from models.model import App, AppMode, EndUser
from services.conversation_service import ConversationService


class ConversationListQuery(BaseModel):
    last_id: UUID | None = Field(default=None, description="Last conversation ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of conversations to return")
    sort_by: Literal["created_at", "-created_at", "updated_at", "-updated_at"] = Field(
        default="-updated_at", description="Sort order for conversations"
    )


class ConversationRenamePayload(BaseModel):
    name: str | None = Field(default=None, description="New conversation name (required if auto_generate is false)")
    auto_generate: bool = Field(default=False, description="Auto-generate conversation name")

    @model_validator(mode="after")
    def validate_name_requirement(self):
        if not self.auto_generate:
            if self.name is None or not self.name.strip():
                raise ValueError("name is required when auto_generate is false")
        return self


class ConversationVariablesQuery(BaseModel):
    last_id: UUID | None = Field(default=None, description="Last variable ID for pagination")
    limit: int = Field(default=20, ge=1, le=100, description="Number of variables to return")
    variable_name: str | None = Field(
        default=None, description="Filter variables by name", min_length=1, max_length=255
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
    value: Any


register_schema_models(
    service_api_ns,
    ConversationListQuery,
    ConversationRenamePayload,
    ConversationVariablesQuery,
    ConversationVariableUpdatePayload,
)


@service_api_ns.route("/conversations")
class ConversationApi(Resource):
    @service_api_ns.expect(service_api_ns.models[ConversationListQuery.__name__])
    @service_api_ns.doc("list_conversations")
    @service_api_ns.doc(description="List all conversations for the current user")
    @service_api_ns.doc(
        responses={
            200: "Conversations retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Last conversation not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    def get(self, app_model: App, end_user: EndUser):
        """List all conversations for the current user.

        Supports pagination using last_id and limit parameters.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        query_args = ConversationListQuery.model_validate(request.args.to_dict())
        last_id = str(query_args.last_id) if query_args.last_id else None

        try:
            with Session(db.engine) as session:
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
                    limit=pagination.limit,
                    has_more=pagination.has_more,
                    data=conversations,
                ).model_dump(mode="json")
        except services.errors.conversation.LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>")
class ConversationDetailApi(Resource):
    @service_api_ns.doc("delete_conversation")
    @service_api_ns.doc(description="Delete a specific conversation")
    @service_api_ns.doc(params={"c_id": "Conversation ID"})
    @service_api_ns.doc(
        responses={
            204: "Conversation deleted successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def delete(self, app_model: App, end_user: EndUser, c_id):
        """Delete a specific conversation."""
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            ConversationService.delete(app_model, conversation_id, end_user)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        return ConversationDelete(result="success").model_dump(mode="json"), 204


@service_api_ns.route("/conversations/<uuid:c_id>/name")
class ConversationRenameApi(Resource):
    @service_api_ns.expect(service_api_ns.models[ConversationRenamePayload.__name__])
    @service_api_ns.doc("rename_conversation")
    @service_api_ns.doc(description="Rename a conversation or auto-generate a name")
    @service_api_ns.doc(params={"c_id": "Conversation ID"})
    @service_api_ns.doc(
        responses={
            200: "Conversation renamed successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    def post(self, app_model: App, end_user: EndUser, c_id):
        """Rename a conversation or auto-generate a name."""
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        payload = ConversationRenamePayload.model_validate(service_api_ns.payload or {})

        try:
            conversation = ConversationService.rename(
                app_model, conversation_id, end_user, payload.name, payload.auto_generate
            )
            return (
                TypeAdapter(SimpleConversation)
                .validate_python(conversation, from_attributes=True)
                .model_dump(mode="json")
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>/variables")
class ConversationVariablesApi(Resource):
    @service_api_ns.expect(service_api_ns.models[ConversationVariablesQuery.__name__])
    @service_api_ns.doc("list_conversation_variables")
    @service_api_ns.doc(description="List all variables for a conversation")
    @service_api_ns.doc(params={"c_id": "Conversation ID"})
    @service_api_ns.doc(
        responses={
            200: "Variables retrieved successfully",
            401: "Unauthorized - invalid API token",
            404: "Conversation not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.QUERY))
    @service_api_ns.marshal_with(build_conversation_variable_infinite_scroll_pagination_model(service_api_ns))
    def get(self, app_model: App, end_user: EndUser, c_id):
        """List all variables for a conversation.

        Conversational variables are only available for chat applications.
        """
        # conversational variable only for chat app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        query_args = ConversationVariablesQuery.model_validate(request.args.to_dict())
        last_id = str(query_args.last_id) if query_args.last_id else None

        try:
            return ConversationService.get_conversational_variable(
                app_model, conversation_id, end_user, query_args.limit, last_id, query_args.variable_name
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>/variables/<uuid:variable_id>")
class ConversationVariableDetailApi(Resource):
    @service_api_ns.expect(service_api_ns.models[ConversationVariableUpdatePayload.__name__])
    @service_api_ns.doc("update_conversation_variable")
    @service_api_ns.doc(description="Update a conversation variable's value")
    @service_api_ns.doc(params={"c_id": "Conversation ID", "variable_id": "Variable ID"})
    @service_api_ns.doc(
        responses={
            200: "Variable updated successfully",
            400: "Bad request - type mismatch",
            401: "Unauthorized - invalid API token",
            404: "Conversation or variable not found",
        }
    )
    @validate_app_token(fetch_user_arg=FetchUserArg(fetch_from=WhereisUserArg.JSON))
    @service_api_ns.marshal_with(build_conversation_variable_model(service_api_ns))
    def put(self, app_model: App, end_user: EndUser, c_id, variable_id):
        """Update a conversation variable's value.

        Allows updating the value of a specific conversation variable.
        The value must match the variable's expected type.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        variable_id = str(variable_id)

        payload = ConversationVariableUpdatePayload.model_validate(service_api_ns.payload or {})

        try:
            return ConversationService.update_conversation_variable(
                app_model, conversation_id, variable_id, end_user, payload.value
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationVariableNotExistsError:
            raise NotFound("Conversation Variable Not Exists.")
        except services.errors.conversation.ConversationVariableTypeMismatchError as e:
            raise BadRequest(str(e))
