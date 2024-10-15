from flask_restful import fields, marshal_with

from configs import dify_config
from controllers.web import api
from controllers.web.error import AppUnavailableError
from controllers.web.wraps import WebApiResource
from models.model import App, AppMode
from services.app_service import AppService


class AppParameterApi(WebApiResource):
    """Resource for app variables."""

    variable_fields = {
        "key": fields.String,
        "name": fields.String,
        "description": fields.String,
        "type": fields.String,
        "default": fields.String,
        "max_length": fields.Integer,
        "options": fields.List(fields.String),
    }

    system_parameters_fields = {"image_file_size_limit": fields.String}

    parameters_fields = {
        "opening_statement": fields.String,
        "suggested_questions": fields.Raw,
        "suggested_questions_after_answer": fields.Raw,
        "speech_to_text": fields.Raw,
        "text_to_speech": fields.Raw,
        "retriever_resource": fields.Raw,
        "annotation_reply": fields.Raw,
        "more_like_this": fields.Raw,
        "user_input_form": fields.Raw,
        "sensitive_word_avoidance": fields.Raw,
        "file_upload": fields.Raw,
        "system_parameters": fields.Nested(system_parameters_fields),
    }

    @marshal_with(parameters_fields)
    def get(self, app_model: App, end_user):
        """Retrieve app parameters."""
        if app_model.mode in {AppMode.ADVANCED_CHAT.value, AppMode.WORKFLOW.value}:
            workflow = app_model.workflow
            if workflow is None:
                raise AppUnavailableError()

            features_dict = workflow.features_dict
            user_input_form = workflow.user_input_form(to_old_structure=True)
        else:
            app_model_config = app_model.app_model_config
            features_dict = app_model_config.to_dict()

            user_input_form = features_dict.get("user_input_form", [])

        return {
            "opening_statement": features_dict.get("opening_statement"),
            "suggested_questions": features_dict.get("suggested_questions", []),
            "suggested_questions_after_answer": features_dict.get(
                "suggested_questions_after_answer", {"enabled": False}
            ),
            "speech_to_text": features_dict.get("speech_to_text", {"enabled": False}),
            "text_to_speech": features_dict.get("text_to_speech", {"enabled": False}),
            "retriever_resource": features_dict.get("retriever_resource", {"enabled": False}),
            "annotation_reply": features_dict.get("annotation_reply", {"enabled": False}),
            "more_like_this": features_dict.get("more_like_this", {"enabled": False}),
            "user_input_form": user_input_form,
            "sensitive_word_avoidance": features_dict.get(
                "sensitive_word_avoidance", {"enabled": False, "type": "", "configs": []}
            ),
            "file_upload": features_dict.get(
                "file_upload",
                {
                    "image": {
                        "enabled": False,
                        "number_limits": 3,
                        "detail": "high",
                        "transfer_methods": ["remote_url", "local_file"],
                    }
                },
            ),
            "system_parameters": {"image_file_size_limit": dify_config.UPLOAD_IMAGE_FILE_SIZE_LIMIT},
        }


class AppMeta(WebApiResource):
    def get(self, app_model: App, end_user):
        """Get app meta"""
        return AppService().get_app_meta(app_model)


api.add_resource(AppParameterApi, "/parameters")
api.add_resource(AppMeta, "/meta")
