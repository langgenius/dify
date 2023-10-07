from flask_restful import fields

from libs.helper import TimestampField

integrate_icon_fields = {
    'type': fields.String,
    'url': fields.String,
    'emoji': fields.String
}

integrate_page_fields = {
    'page_name': fields.String,
    'page_id': fields.String,
    'page_icon': fields.Nested(integrate_icon_fields, allow_null=True),
    'is_bound': fields.Boolean,
    'parent_id': fields.String,
    'type': fields.String
}

integrate_workspace_fields = {
    'workspace_name': fields.String,
    'workspace_id': fields.String,
    'workspace_icon': fields.String,
    'pages': fields.List(fields.Nested(integrate_page_fields))
}

integrate_notion_info_list_fields = {
    'notion_info': fields.List(fields.Nested(integrate_workspace_fields)),
}

integrate_icon_fields = {
    'type': fields.String,
    'url': fields.String,
    'emoji': fields.String
}

integrate_page_fields = {
    'page_name': fields.String,
    'page_id': fields.String,
    'page_icon': fields.Nested(integrate_icon_fields, allow_null=True),
    'parent_id': fields.String,
    'type': fields.String
}

integrate_workspace_fields = {
    'workspace_name': fields.String,
    'workspace_id': fields.String,
    'workspace_icon': fields.String,
    'pages': fields.List(fields.Nested(integrate_page_fields)),
    'total': fields.Integer
}

integrate_fields = {
    'id': fields.String,
    'provider': fields.String,
    'created_at': TimestampField,
    'is_bound': fields.Boolean,
    'disabled': fields.Boolean,
    'link': fields.String,
    'source_info': fields.Nested(integrate_workspace_fields)
}

integrate_list_fields = {
    'data': fields.List(fields.Nested(integrate_fields)),
}