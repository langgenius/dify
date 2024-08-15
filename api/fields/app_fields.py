from flask_restful import fields

from libs.helper import AppIconUrlField, TimestampField

app_detail_kernel_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "mode": fields.String(attribute="mode_compatible_with_agent"),
    "icon_type": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "icon_url": AppIconUrlField,
}

related_app_list = {
    "data": fields.List(fields.Nested(app_detail_kernel_fields)),
    "total": fields.Integer,
}

model_config_fields = {
    "opening_statement": fields.String,
    "suggested_questions": fields.Raw(attribute="suggested_questions_list"),
    "suggested_questions_after_answer": fields.Raw(attribute="suggested_questions_after_answer_dict"),
    "speech_to_text": fields.Raw(attribute="speech_to_text_dict"),
    "text_to_speech": fields.Raw(attribute="text_to_speech_dict"),
    "retriever_resource": fields.Raw(attribute="retriever_resource_dict"),
    "annotation_reply": fields.Raw(attribute="annotation_reply_dict"),
    "more_like_this": fields.Raw(attribute="more_like_this_dict"),
    "sensitive_word_avoidance": fields.Raw(attribute="sensitive_word_avoidance_dict"),
    "external_data_tools": fields.Raw(attribute="external_data_tools_list"),
    "model": fields.Raw(attribute="model_dict"),
    "user_input_form": fields.Raw(attribute="user_input_form_list"),
    "dataset_query_variable": fields.String,
    "pre_prompt": fields.String,
    "agent_mode": fields.Raw(attribute="agent_mode_dict"),
    "prompt_type": fields.String,
    "chat_prompt_config": fields.Raw(attribute="chat_prompt_config_dict"),
    "completion_prompt_config": fields.Raw(attribute="completion_prompt_config_dict"),
    "dataset_configs": fields.Raw(attribute="dataset_configs_dict"),
    "file_upload": fields.Raw(attribute="file_upload_dict"),
    "created_at": TimestampField,
}

app_detail_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "mode": fields.String(attribute="mode_compatible_with_agent"),
    "icon": fields.String,
    "icon_background": fields.String,
    "enable_site": fields.Boolean,
    "enable_api": fields.Boolean,
    "model_config": fields.Nested(model_config_fields, attribute="app_model_config", allow_null=True),
    "tracing": fields.Raw,
    "created_at": TimestampField,
}

prompt_config_fields = {
    "prompt_template": fields.String,
}

model_config_partial_fields = {
    "model": fields.Raw(attribute="model_dict"),
    "pre_prompt": fields.String,
}

tag_fields = {"id": fields.String, "name": fields.String, "type": fields.String}

app_partial_fields = {
    "id": fields.String,
    "name": fields.String,
    "max_active_requests": fields.Raw(),
    "description": fields.String(attribute="desc_or_prompt"),
    "mode": fields.String(attribute="mode_compatible_with_agent"),
    "icon_type": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "icon_url": AppIconUrlField,
    "model_config": fields.Nested(model_config_partial_fields, attribute="app_model_config", allow_null=True),
    "created_at": TimestampField,
    "tags": fields.List(fields.Nested(tag_fields)),
}


app_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer(attribute="per_page"),
    "total": fields.Integer,
    "has_more": fields.Boolean(attribute="has_next"),
    "data": fields.List(fields.Nested(app_partial_fields), attribute="items"),
}

template_fields = {
    "name": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "description": fields.String,
    "mode": fields.String,
    "model_config": fields.Nested(model_config_fields),
}

template_list_fields = {
    "data": fields.List(fields.Nested(template_fields)),
}

site_fields = {
    "access_token": fields.String(attribute="code"),
    "code": fields.String,
    "title": fields.String,
    "icon_type": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "icon_url": AppIconUrlField,
    "description": fields.String,
    "default_language": fields.String,
    "chat_color_theme": fields.String,
    "chat_color_theme_inverted": fields.Boolean,
    "customize_domain": fields.String,
    "copyright": fields.String,
    "privacy_policy": fields.String,
    "custom_disclaimer": fields.String,
    "customize_token_strategy": fields.String,
    "prompt_public": fields.Boolean,
    "app_base_url": fields.String,
    "show_workflow_steps": fields.Boolean,
}

app_detail_fields_with_site = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "mode": fields.String(attribute="mode_compatible_with_agent"),
    "icon_type": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "icon_url": AppIconUrlField,
    "enable_site": fields.Boolean,
    "enable_api": fields.Boolean,
    "model_config": fields.Nested(model_config_fields, attribute="app_model_config", allow_null=True),
    "site": fields.Nested(site_fields),
    "api_base_url": fields.String,
    "created_at": TimestampField,
    "deleted_tools": fields.List(fields.String),
}

app_site_fields = {
    "app_id": fields.String,
    "access_token": fields.String(attribute="code"),
    "code": fields.String,
    "title": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "description": fields.String,
    "default_language": fields.String,
    "customize_domain": fields.String,
    "copyright": fields.String,
    "privacy_policy": fields.String,
    "custom_disclaimer": fields.String,
    "customize_token_strategy": fields.String,
    "prompt_public": fields.Boolean,
    "show_workflow_steps": fields.Boolean,
}
