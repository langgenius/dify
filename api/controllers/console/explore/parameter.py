# -*- coding:utf-8 -*-
from flask_restful import marshal_with, fields

from controllers.console import api
from controllers.console.explore.wraps import InstalledAppResource


class AppParameterApi(InstalledAppResource):
    """Resource for app variables."""
    variable_fields = {
        'key': fields.String,
        'name': fields.String,
        'description': fields.String,
        'type': fields.String,
        'default': fields.String,
        'max_length': fields.Integer,
        'options': fields.List(fields.String)
    }

    parameters_fields = {
        'opening_statement': fields.String,
        'suggested_questions': fields.Raw,
        'suggested_questions_after_answer': fields.Raw,
        'more_like_this': fields.Raw,
        'user_input_form': fields.Raw,
    }

    @marshal_with(parameters_fields)
    def get(self, installed_app):
        """Retrieve app parameters."""
        app_model = installed_app.app
        app_model_config = app_model.app_model_config

        return {
            'opening_statement': app_model_config.opening_statement,
            'suggested_questions': app_model_config.suggested_questions_list,
            'suggested_questions_after_answer': app_model_config.suggested_questions_after_answer_dict,
            'more_like_this': app_model_config.more_like_this_dict,
            'user_input_form': app_model_config.user_input_form_list
        }


api.add_resource(AppParameterApi, '/installed-apps/<uuid:installed_app_id>/parameters', endpoint='installed_app_parameters')
