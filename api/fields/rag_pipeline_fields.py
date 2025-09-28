from flask_restx import fields  # type: ignore

from fields.workflow_fields import workflow_partial_fields
from libs.helper import AppIconUrlField, TimestampField

pipeline_detail_kernel_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "icon_type": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "icon_url": AppIconUrlField,
}

related_app_list = {
    "data": fields.List(fields.Nested(pipeline_detail_kernel_fields)),
    "total": fields.Integer,
}

app_detail_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "mode": fields.String(attribute="mode_compatible_with_agent"),
    "icon": fields.String,
    "icon_background": fields.String,
    "workflow": fields.Nested(workflow_partial_fields, allow_null=True),
    "tracing": fields.Raw,
    "created_by": fields.String,
    "created_at": TimestampField,
    "updated_by": fields.String,
    "updated_at": TimestampField,
}


tag_fields = {"id": fields.String, "name": fields.String, "type": fields.String}

app_partial_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String(attribute="desc_or_prompt"),
    "icon_type": fields.String,
    "icon": fields.String,
    "icon_background": fields.String,
    "icon_url": AppIconUrlField,
    "workflow": fields.Nested(workflow_partial_fields, allow_null=True),
    "created_by": fields.String,
    "created_at": TimestampField,
    "updated_by": fields.String,
    "updated_at": TimestampField,
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
    "use_icon_as_answer_icon": fields.Boolean,
    "created_by": fields.String,
    "created_at": TimestampField,
    "updated_by": fields.String,
    "updated_at": TimestampField,
}

deleted_tool_fields = {
    "type": fields.String,
    "tool_name": fields.String,
    "provider_id": fields.String,
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
    "workflow": fields.Nested(workflow_partial_fields, allow_null=True),
    "site": fields.Nested(site_fields),
    "api_base_url": fields.String,
    "use_icon_as_answer_icon": fields.Boolean,
    "created_by": fields.String,
    "created_at": TimestampField,
    "updated_by": fields.String,
    "updated_at": TimestampField,
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
    "use_icon_as_answer_icon": fields.Boolean,
}

leaked_dependency_fields = {"type": fields.String, "value": fields.Raw, "current_identifier": fields.String}

pipeline_import_fields = {
    "id": fields.String,
    "status": fields.String,
    "pipeline_id": fields.String,
    "dataset_id": fields.String,
    "current_dsl_version": fields.String,
    "imported_dsl_version": fields.String,
    "error": fields.String,
}

pipeline_import_check_dependencies_fields = {
    "leaked_dependencies": fields.List(fields.Nested(leaked_dependency_fields)),
}
