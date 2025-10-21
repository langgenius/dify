from flask_restx import Api, Namespace, fields

from fields.end_user_fields import build_simple_end_user_model, simple_end_user_fields
from fields.member_fields import build_simple_account_model, simple_account_fields
from fields.workflow_run_fields import build_workflow_run_for_log_model, workflow_run_for_log_fields
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


def build_workflow_app_log_partial_model(api_or_ns: Api | Namespace):
    """Build the workflow app log partial model for the API or Namespace."""
    workflow_run_model = build_workflow_run_for_log_model(api_or_ns)
    simple_account_model = build_simple_account_model(api_or_ns)
    simple_end_user_model = build_simple_end_user_model(api_or_ns)

    copied_fields = workflow_app_log_partial_fields.copy()
    copied_fields["workflow_run"] = fields.Nested(workflow_run_model, attribute="workflow_run", allow_null=True)
    copied_fields["created_by_account"] = fields.Nested(
        simple_account_model, attribute="created_by_account", allow_null=True
    )
    copied_fields["created_by_end_user"] = fields.Nested(
        simple_end_user_model, attribute="created_by_end_user", allow_null=True
    )
    return api_or_ns.model("WorkflowAppLogPartial", copied_fields)


workflow_app_log_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(workflow_app_log_partial_fields)),
}


def build_workflow_app_log_pagination_model(api_or_ns: Api | Namespace):
    """Build the workflow app log pagination model for the API or Namespace."""
    # Build the nested partial model first
    workflow_app_log_partial_model = build_workflow_app_log_partial_model(api_or_ns)

    copied_fields = workflow_app_log_pagination_fields.copy()
    copied_fields["data"] = fields.List(fields.Nested(workflow_app_log_partial_model))
    return api_or_ns.model("WorkflowAppLogPagination", copied_fields)
