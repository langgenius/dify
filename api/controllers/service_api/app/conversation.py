from flask_restx import Resource, reqparse
from flask_restx._http import HTTPStatus
from flask_restx.inputs import int_range
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest, NotFound

import services
from controllers.service_api import service_api_ns
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.wraps import FetchUserArg, WhereisUserArg, validate_app_token
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import (
    build_conversation_delete_model,
    build_conversation_infinite_scroll_pagination_model,
    build_simple_conversation_model,
)
from fields.conversation_variable_fields import (
    build_conversation_variable_infinite_scroll_pagination_model,
    build_conversation_variable_model,
)
from libs.helper import uuid_value
from models.model import App, AppMode, EndUser
from services.conversation_service import ConversationService

# Define parsers for conversation APIs
conversation_list_parser = reqparse.RequestParser()
conversation_list_parser.add_argument(
    "last_id", type=uuid_value, location="args", help="Last conversation ID for pagination"
)
conversation_list_parser.add_argument(
    "limit",
    type=int_range(1, 100),
    required=False,
    default=20,
    location="args",
    help="Number of conversations to return",
)
conversation_list_parser.add_argument(
    "sort_by",
    type=str,
    choices=["created_at", "-created_at", "updated_at", "-updated_at"],
    required=False,
    default="-updated_at",
    location="args",
    help="Sort order for conversations",
)

conversation_rename_parser = reqparse.RequestParser()
conversation_rename_parser.add_argument("name", type=str, required=False, location="json", help="New conversation name")
conversation_rename_parser.add_argument(
    "auto_generate", type=bool, required=False, default=False, location="json", help="Auto-generate conversation name"
)

conversation_variables_parser = reqparse.RequestParser()
conversation_variables_parser.add_argument(
    "last_id", type=uuid_value, location="args", help="Last variable ID for pagination"
)
conversation_variables_parser.add_argument(
    "limit", type=int_range(1, 100), required=False, default=20, location="args", help="Number of variables to return"
)

conversation_variable_update_parser = reqparse.RequestParser()
# using lambda is for passing the already-typed value without modification
# if no lambda, it will be converted to string
# the string cannot be converted using json.loads
conversation_variable_update_parser.add_argument(
    "value", required=True, location="json", type=lambda x: x, help="New value for the conversation variable"
)


@service_api_ns.route("/conversations")
class ConversationApi(Resource):
    @service_api_ns.expect(conversation_list_parser)
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
    @service_api_ns.marshal_with(build_conversation_infinite_scroll_pagination_model(service_api_ns))
    def get(self, app_model: App, end_user: EndUser):
        """List all conversations for the current user.

        Supports pagination using last_id and limit parameters.
        """
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        args = conversation_list_parser.parse_args()

        try:
            with Session(db.engine) as session:
                return ConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=end_user,
                    last_id=args["last_id"],
                    limit=args["limit"],
                    invoke_from=InvokeFrom.SERVICE_API,
                    sort_by=args["sort_by"],
                )
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
    @service_api_ns.marshal_with(build_conversation_delete_model(service_api_ns), code=HTTPStatus.NO_CONTENT)
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
        return {"result": "success"}, 204


@service_api_ns.route("/conversations/<uuid:c_id>/name")
class ConversationRenameApi(Resource):
    @service_api_ns.expect(conversation_rename_parser)
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
    @service_api_ns.marshal_with(build_simple_conversation_model(service_api_ns))
    def post(self, app_model: App, end_user: EndUser, c_id):
        """Rename a conversation or auto-generate a name."""
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        args = conversation_rename_parser.parse_args()

        try:
            return ConversationService.rename(app_model, conversation_id, end_user, args["name"], args["auto_generate"])
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>/variables")
class ConversationVariablesApi(Resource):
    @service_api_ns.expect(conversation_variables_parser)
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

        args = conversation_variables_parser.parse_args()

        try:
            return ConversationService.get_conversational_variable(
                app_model, conversation_id, end_user, args["limit"], args["last_id"]
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@service_api_ns.route("/conversations/<uuid:c_id>/variables/<uuid:variable_id>")
class ConversationVariableDetailApi(Resource):
    @service_api_ns.expect(conversation_variable_update_parser)
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

        args = conversation_variable_update_parser.parse_args()

        try:
            return ConversationService.update_conversation_variable(
                app_model, conversation_id, variable_id, end_user, args["value"]
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        except services.errors.conversation.ConversationVariableNotExistsError:
            raise NotFound("Conversation Variable Not Exists.")
        except services.errors.conversation.ConversationVariableTypeMismatchError as e:
            raise BadRequest(str(e))
