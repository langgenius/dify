from flask import request
from flask_restful import marshal_with, reqparse
from flask_restful.inputs import int_range
from werkzeug.exceptions import NotFound

import services
from controllers.service_api import api
from controllers.service_api.app import create_or_update_end_user_for_user_id
from controllers.service_api.app.error import NotChatAppError
from controllers.service_api.wraps import AppApiResource
from fields.conversation_fields import conversation_infinite_scroll_pagination_fields, simple_conversation_fields
from libs.helper import uuid_value
from services.conversation_service import ConversationService


class ConversationApi(AppApiResource):

    @marshal_with(conversation_infinite_scroll_pagination_fields)
    def get(self, app_model, end_user):
        if app_model.mode != 'chat':
            raise NotChatAppError()

        parser = reqparse.RequestParser()
        parser.add_argument('last_id', type=uuid_value, location='args')
        parser.add_argument('limit', type=int_range(1, 100), required=False, default=20, location='args')
        parser.add_argument('user', type=str, location='args')
        args = parser.parse_args()

        if end_user is None and args['user'] is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, args['user'])

        try:
            return ConversationService.pagination_by_last_id(app_model, end_user, args['last_id'], args['limit'])
        except services.errors.conversation.LastConversationNotExistsError:
            raise NotFound("Last Conversation Not Exists.")

class ConversationDetailApi(AppApiResource):
    @marshal_with(simple_conversation_fields)
    def delete(self, app_model, end_user, c_id):
        if app_model.mode != 'chat':
            raise NotChatAppError()

        conversation_id = str(c_id)

        user = request.get_json().get('user')

        if end_user is None and user is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, user)

        try:
            ConversationService.delete(app_model, conversation_id, end_user)
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")
        return {"result": "success"}, 204


class ConversationRenameApi(AppApiResource):

    @marshal_with(simple_conversation_fields)
    def post(self, app_model, end_user, c_id):
        if app_model.mode != 'chat':
            raise NotChatAppError()

        conversation_id = str(c_id)

        parser = reqparse.RequestParser()
        parser.add_argument('name', type=str, required=False, location='json')
        parser.add_argument('user', type=str, location='json')
        parser.add_argument('auto_generate', type=bool, required=False, default=False, location='json')
        args = parser.parse_args()

        if end_user is None and args['user'] is not None:
            end_user = create_or_update_end_user_for_user_id(app_model, args['user'])

        try:
            return ConversationService.rename(
                app_model,
                conversation_id,
                end_user,
                args['name'],
                args['auto_generate']
            )
        except services.errors.conversation.ConversationNotExistsError:
            raise NotFound("Conversation Not Exists.")


api.add_resource(ConversationRenameApi, '/conversations/<uuid:c_id>/name', endpoint='conversation_name')
api.add_resource(ConversationApi, '/conversations')
api.add_resource(ConversationDetailApi, '/conversations/<uuid:c_id>', endpoint='conversation_detail')
