from flask_restx import fields

from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

workflow_alias_fields = {
    "id": fields.String,
    "app_id": fields.String,
    "workflow_id": fields.String,
    "name": fields.String,
    "created_by": fields.Nested(simple_account_fields, attribute="created_by_account"),
    "created_at": TimestampField,
    "updated_at": TimestampField,
    "is_transferred": fields.Boolean(attribute="_is_transferred", default=False),
    "old_workflow_id": fields.String(attribute="_old_workflow_id", default=None),
}

workflow_alias_list_fields = {
    "items": fields.List(fields.Nested(workflow_alias_fields)),
    "page": fields.Integer,
    "limit": fields.Integer,
    "has_more": fields.Boolean,
}

workflow_alias_create_fields = {
    "name": fields.String,
}

workflow_alias_update_fields = {
    "name": fields.String,
}
