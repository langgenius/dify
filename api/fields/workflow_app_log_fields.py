from flask_restful import fields

from fields.end_user_fields import simple_end_user_fields
from fields.member_fields import simple_account_fields
from fields.workflow_run_fields import workflow_run_for_log_fields
from libs.helper import TimestampField

workflow_app_log_partial_fields = {
    "id": fields.String,
    "workflow_run": fields.Nested(workflow_run_for_log_fields, attribute="workflow_run", allow_null=True),
    "created_from": fields.String,
    "created_by_role": fields.String,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute="created_by_end_user", allow_null=True),
    "created_at": TimestampField,
}

workflow_app_log_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(workflow_app_log_partial_fields)),
}
