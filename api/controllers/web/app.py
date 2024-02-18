import json

from flask import current_app
from flask_restful import fields, marshal_with

from controllers.web import api
from controllers.web.wraps import WebApiResource
from extensions.ext_database import db
from models.model import App, AppModelConfig
from models.tools import ApiToolProvider


class AppParameterApi(WebApiResource):
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

    system_parameters_fields = {
        'image_file_size_limit': fields.String
    }

    parameters_fields = {
        'opening_statement': fields.String,
        'suggested_questions': fields.Raw,
        'suggested_questions_after_answer': fields.Raw,
        'speech_to_text': fields.Raw,
        'text_to_speech': fields.Raw,
        'retriever_resource': fields.Raw,
        'annotation_reply': fields.Raw,
        'more_like_this': fields.Raw,
        'user_input_form': fields.Raw,
        'sensitive_word_avoidance': fields.Raw,
        'file_upload': fields.Raw,
        'system_parameters': fields.Nested(system_parameters_fields)
    }

    @marshal_with(parameters_fields)
    def get(self, app_model: App, end_user):
        """Retrieve app parameters."""
        app_model_config = app_model.app_model_config

        return {
            'opening_statement': app_model_config.opening_statement,
            'suggested_questions': app_model_config.suggested_questions_list,
            'suggested_questions_after_answer': app_model_config.suggested_questions_after_answer_dict,
            'speech_to_text': app_model_config.speech_to_text_dict,
            'text_to_speech': app_model_config.text_to_speech_dict,
            'retriever_resource': app_model_config.retriever_resource_dict,
            'annotation_reply': app_model_config.annotation_reply_dict,
            'more_like_this': app_model_config.more_like_this_dict,
            'user_input_form': app_model_config.user_input_form_list,
            'sensitive_word_avoidance': app_model_config.sensitive_word_avoidance_dict,
            'file_upload': app_model_config.file_upload_dict,
            'system_parameters': {
                'image_file_size_limit': current_app.config.get('UPLOAD_IMAGE_FILE_SIZE_LIMIT')
            }
        }

class AppMeta(WebApiResource):
    def get(self, app_model: App, end_user):
        """Get app meta"""
        app_model_config: AppModelConfig = app_model.app_model_config

        agent_config = app_model_config.agent_mode_dict or {}
        meta = {
            'tool_icons': {}
        }

        # get all tools
        tools = agent_config.get('tools', [])
        url_prefix = (current_app.config.get("CONSOLE_API_URL")
                  + "/console/api/workspaces/current/tool-provider/builtin/")
        for tool in tools:
            keys = list(tool.keys())
            if len(keys) >= 4:
                # current tool standard
                provider_type = tool.get('provider_type')
                provider_id = tool.get('provider_id')
                tool_name = tool.get('tool_name')
                if provider_type == 'builtin':
                    meta['tool_icons'][tool_name] = url_prefix + provider_id + '/icon'
                elif provider_type == 'api':
                    try:
                        provider: ApiToolProvider = db.session.query(ApiToolProvider).filter(
                            ApiToolProvider.id == provider_id
                        )
                        meta['tool_icons'][tool_name] = json.loads(provider.icon)
                    except:
                        meta['tool_icons'][tool_name] =  {
                            "background": "#252525",
                            "content": "\ud83d\ude01"
                        }

        return meta

api.add_resource(AppParameterApi, '/parameters')
api.add_resource(AppMeta, '/meta')