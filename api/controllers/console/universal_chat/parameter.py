# -*- coding:utf-8 -*-
from flask_restful import marshal_with, fields

from controllers.console import api
from controllers.console.universal_chat.wraps import UniversalChatResource

from models.model import App


class UniversalChatParameterApi(UniversalChatResource):
    """Resource for app variables."""
    parameters_fields = {
        'opening_statement': fields.String,
        'suggested_questions': fields.Raw,
        'suggested_questions_after_answer': fields.Raw,
        'speech_to_text': fields.Raw,
    }

    @marshal_with(parameters_fields)
    def get(self, universal_app: App):
        """Retrieve app parameters."""
        app_model = universal_app
        app_model_config = app_model.app_model_config

        return {
            'opening_statement': app_model_config.opening_statement,
            'suggested_questions': app_model_config.suggested_questions_list,
            'suggested_questions_after_answer': app_model_config.suggested_questions_after_answer_dict,
            'speech_to_text': app_model_config.speech_to_text_dict,
        }


api.add_resource(UniversalChatParameterApi, '/universal-chat/parameters')
