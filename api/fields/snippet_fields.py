from flask_restx import fields

from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

# Snippet list item fields (lightweight for list display)
snippet_list_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "type": fields.String,
    "version": fields.Integer,
    "use_count": fields.Integer,
    "is_published": fields.Boolean,
    "icon_info": fields.Raw,
    "created_at": TimestampField,
    "updated_at": TimestampField,
}

# Full snippet fields (includes creator info and graph data)
snippet_fields = {
    "id": fields.String,
    "name": fields.String,
    "description": fields.String,
    "type": fields.String,
    "version": fields.Integer,
    "use_count": fields.Integer,
    "is_published": fields.Boolean,
    "icon_info": fields.Raw,
    "graph": fields.Raw(attribute="graph_dict"),
    "input_fields": fields.Raw(attribute="input_fields_list"),
    "created_by": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_at": TimestampField,
    "updated_by": fields.Nested(simple_account_fields, attribute="updated_by_account", allow_null=True),
    "updated_at": TimestampField,
}

# Pagination response fields
snippet_pagination_fields = {
    "data": fields.List(fields.Nested(snippet_list_fields)),
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
    "has_more": fields.Boolean,
}
