from flask_restx import Api, Namespace, fields

from libs.helper import AppIconUrlField

parameters__system_parameters = {
    "image_file_size_limit": fields.Integer,
    "video_file_size_limit": fields.Integer,
    "audio_file_size_limit": fields.Integer,
    "file_size_limit": fields.Integer,
    "workflow_file_upload_limit": fields.Integer,
}


def build_system_parameters_model(api_or_ns: Api | Namespace):
    """Build the system parameters model for the API or Namespace."""
    return api_or_ns.model("SystemParameters", parameters__system_parameters)


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
    "system_parameters": fields.Nested(parameters__system_parameters),
}


def build_parameters_model(api_or_ns: Api | Namespace):
    """Build the parameters model for the API or Namespace."""
    copied_fields = parameters_fields.copy()
    copied_fields["system_parameters"] = fields.Nested(build_system_parameters_model(api_or_ns))
    return api_or_ns.model("Parameters", copied_fields)


site_fields = {
    "title": fields.String,
    "chat_color_theme": fields.String,
    "chat_color_theme_inverted": fields.Boolean,
    "icon_type": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "icon_url": AppIconUrlField,
    "description": fields.String,
    "copyright": fields.String,
    "privacy_policy": fields.String,
    "custom_disclaimer": fields.String,
    "default_language": fields.String,
    "show_workflow_steps": fields.Boolean,
    "use_icon_as_answer_icon": fields.Boolean,
}


def build_site_model(api_or_ns: Api | Namespace):
    """Build the site model for the API or Namespace."""
    return api_or_ns.model("Site", site_fields)
