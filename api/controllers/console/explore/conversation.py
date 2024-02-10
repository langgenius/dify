from flask_login import current_user
from flask_restful import marshal_with, reqparse
from flask_restful.inputs import int_range
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.explore.error import NotChatAppError
from controllers.console.explore.wraps import InstalledAppResource
from fields.conversation_fields import conversation_infinite_scroll_pagination_fields, simple_conversation_fields
from libs.helper import uuid_value
from services.conversation_service import ConversationService
from services.errors.conversation import ConversationNotExistsError, LastConversationNotExistsError
from services.web_conversation_service import WebConversationService


class ConversationListApi(InstalledAppResource):

    @marshal_with(conversation_infinite_scroll_pagination_fields)
    def get(self, installed_app):
        app_model = installed_app.app
        if app_model.mode != 'chat':
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument('last_id', type=uuid_value, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        parser.add_argument('pinned', type=str, choices=['true', 'false', None], location='args')
        args = parser.parse_args()

        pinned = None
        if 'pinned' in args and args['pinned'] is not None:
            pinned = True if args['pinned'] == 'true' else False

        try:
            return WebConversationService.pagination_by_last_id(
                app_model=app_model,
                user=current_user,
                last_id=args['last_id'],
                limit=args['limit'],
                pinned=pinned,
                exclude_debug_conversation=True
            )
        except LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")


class ConversationApi(InstalledAppResource):
    def delete(self, installed_app, c_id):
        app_model = installed_app.app
        if app_model.mode != 'chat':
            raise NotChatAppError()

        conversation_id = str(c_id)
        try:
            ConversationService.delete(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        WebConversationService.unpin(app_model, conversation_id, current_user)

        return {"result": "success"}, 204


class ConversationRenameApi(InstalledAppResource):

    @marshal_with(simple_conversation_fields)
    def post(self, installed_app, c_id):
        app_model = installed_app.app
        if app_model.mode != 'chat':
            raise NotChatAppError()

        conversation_id = str(c_id)

        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=False, location='json')
        parser.add_argument('auto_generate', type=bool, required=False, default=False, location='json')
        args = parser.parse_args()

        try:
            return ConversationService.rename(
                app_model,
                conversation_id,
                current_user,
                args['name'],
                args['auto_generate']
            )
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


class ConversationPinApi(InstalledAppResource):

    def patch(self, installed_app, c_id):
        app_model = installed_app.app
        if app_model.mode != 'chat':
            raise NotChatAppError()

        conversation_id = str(c_id)

        try:
            WebConversationService.pin(app_model, conversation_id, current_user)
        except ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")

        return {"result": "success"}


class ConversationUnPinApi(InstalledAppResource):
    def patch(self, installed_app, c_id):
        app_model = installed_app.app
        if app_model.mode != 'chat':
            raise NotChatAppError()

        conversation_id = str(c_id)
        WebConversationService.unpin(app_model, conversation_id, current_user)

        return {"result": "success"}


api.add_resource(ConversationRenameApi, '/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/name', endpoint='installed_app_conversation_rename')
api.add_resource(ConversationListApi, '/installed-apps/<uuid:installed_app_id>/conversations', endpoint='installed_app_conversations')
api.add_resource(ConversationApi, '/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>', endpoint='installed_app_conversation')
api.add_resource(ConversationPinApi, '/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/pin', endpoint='installed_app_conversation_pin')
api.add_resource(ConversationUnPinApi, '/installed-apps/<uuid:installed_app_id>/conversations/<uuid:c_id>/unpin', endpoint='installed_app_conversation_unpin')
