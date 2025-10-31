from flask_restx import marshal_with, reqparse
from flask_restx.inputs import int_range
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.console.explore.error import NotChatAppError
from controllers.console.explore.wraps import InstalledAppResource
from core.app.entities.app_invoke_entities import InvokeFrom
from extensions.ext_database import db
from fields.conversation_fields import conversation_infinite_scroll_pagination_fields, simple_conversation_fields
from libs.helper import uuid_value
from libs.login import current_user
from models import Account
from models.model import AppMode
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.web_conversation_service import WebConversationService

from .. import console_ns


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations",
    endpoint="installed_app_conversations",
)
class ConversationListApi(InstalledAppResource):
    @marshal_with(conversation_infinite_scroll_pagination_fields)
    def get(self, installed_app):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        parser = (
            reqparse.RequestParser()
            .add_argument("last_id", type=uuid_value, location="args")
            .add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
            .add_argument("pinned", type=str, choices=["true", "false", None], location="args")
        )
        args = parser.parse_args()

        pinned = None
        if "pinned" in args and args["pinned"] is not None:
            pinned = args["pinned"] == "true"

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            with Session(db.engine) as session:
                return WebConversationService.pagination_by_last_id(
                    session=session,
                    app_model=app_model,
                    user=current_user,
                    last_id=args["last_id"],
                    limit=args["limit"],
                    invoke_from=InvokeFrom.EXPLORE,
                    pinned=pinned,
                )
        except LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>",
    endpoint="installed_app_conversation",
)
class ConversationApi(InstalledAppResource):
    def delete(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            ConversationService.delete(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return {"result": "success"}, 204


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/name",
    endpoint="installed_app_conversation_rename",
)
class ConversationRenameApi(InstalledAppResource):
    @marshal_with(simple_conversation_fields)
    def post(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        parser = (
            reqparse.RequestParser()
            .add_argument("name", type=str, required=False, location="json")
            .add_argument("auto_generate", type=bool, required=False, default=False, location="json")
        )
        args = parser.parse_args()

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            return ConversationService.rename(
                app_model, conversation_id, current_user, args["name"], args["auto_generate"]
            )
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/pin",
    endpoint="installed_app_conversation_pin",
)
class ConversationPinApi(InstalledAppResource):
    def patch(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            if not isinstance(current_user, Account):
                raise ValueError("current_user must be an Account instance")
            WebConversationService.pin(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return {"result": "success"}


@console_ns.route(
    "/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/unpin",
    endpoint="installed_app_conversation_unpin",
)
class ConversationUnPinApi(InstalledAppResource):
    def patch(self, installed_app, c_id):
        app_model = installed_app.app
        app_mode = AppMode.value_of(app_model.mode)
        if app_mode not in {AppMode.CHAT, AppMode.AGENT_CHAT, AppMode.ADVANCED_CHAT}:
            raise NotChatAppError()

        conversation_id = str(c_id)
        if not isinstance(current_user, Account):
            raise ValueError("current_user must be an Account instance")
        WebConversationService.unpin(app_model, conversation_id, current_user)

        return {"result": "success"}
