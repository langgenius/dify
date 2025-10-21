from flask_restx import Api, Namespace, fields

from fields.end_user_fields import simple_end_user_fields
from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

workflow_run_for_log_fields = {
    "id": fields.String,
    "version": fields.String,
    "status": fields.String,
    "error": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_steps": fields.Integer,
    "created_at": TimestampField,
    "finished_at": TimestampField,
    "exceptions_count": fields.Integer,
}


def build_workflow_run_for_log_model(api_or_ns: Api | Namespace):
    return api_or_ns.model("WorkflowRunForLog", workflow_run_for_log_fields)


workflow_run_for_list_fields = {
    "id": fields.String,
    "version": fields.String,
    "status": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_steps": fields.Integer,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_at": TimestampField,
    "finished_at": TimestampField,
    "exceptions_count": fields.Integer,
    "retry_index": fields.Integer,
}

advanced_chat_workflow_run_for_list_fields = {
    "id": fields.String,
    "conversation_id": fields.String,
    "message_id": fields.String,
    "version": fields.String,
    "status": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_steps": fields.Integer,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_at": TimestampField,
    "finished_at": TimestampField,
    "exceptions_count": fields.Integer,
    "retry_index": fields.Integer,
}

advanced_chat_workflow_run_pagination_fields = {
    "limit": fields.Integer(attribute="limit"),
    "has_more": fields.Boolean(attribute="has_more"),
    "data": fields.List(fields.Nested(advanced_chat_workflow_run_for_list_fields), attribute="data"),
}

workflow_run_pagination_fields = {
    "limit": fields.Integer(attribute="limit"),
    "has_more": fields.Boolean(attribute="has_more"),
    "data": fields.List(fields.Nested(workflow_run_for_list_fields), attribute="data"),
}

workflow_run_count_fields = {
    "total": fields.Integer,
    "running": fields.Integer,
    "succeeded": fields.Integer,
    "failed": fields.Integer,
    "stopped": fields.Integer,
    "partial_succeeded": fields.Integer(attribute="partial-succeeded"),
}

workflow_run_detail_fields = {
    "id": fields.String,
    "version": fields.String,
    "graph": fields.Raw(attribute="graph_dict"),
    "inputs": fields.Raw(attribute="inputs_dict"),
    "status": fields.String,
    "outputs": fields.Raw(attribute="outputs_dict"),
    "error": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_steps": fields.Integer,
    "created_by_role": fields.String,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute="created_by_end_user", allow_null=True),
    "created_at": TimestampField,
    "finished_at": TimestampField,
    "exceptions_count": fields.Integer,
}

retry_event_field = {
    "elapsed_time": fields.Float,
    "status": fields.String,
    "inputs": fields.Raw(attribute="inputs"),
    "process_data": fields.Raw(attribute="process_data"),
    "outputs": fields.Raw(attribute="outputs"),
    "metadata": fields.Raw(attribute="metadata"),
    "llm_usage": fields.Raw(attribute="llm_usage"),
    "error": fields.String,
    "retry_index": fields.Integer,
}


workflow_run_node_execution_fields = {
    "id": fields.String,
    "index": fields.Integer,
    "predecessor_node_id": fields.String,
    "node_id": fields.String,
    "node_type": fields.String,
    "title": fields.String,
    "inputs": fields.Raw(attribute="inputs_dict"),
    "process_data": fields.Raw(attribute="process_data_dict"),
    "outputs": fields.Raw(attribute="outputs_dict"),
    "status": fields.String,
    "error": fields.String,
    "elapsed_time": fields.Float,
    "execution_metadata": fields.Raw(attribute="execution_metadata_dict"),
    "extras": fields.Raw,
    "created_at": TimestampField,
    "created_by_role": fields.String,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute="created_by_end_user", allow_null=True),
    "finished_at": TimestampField,
    "inputs_truncated": fields.Boolean,
    "outputs_truncated": fields.Boolean,
    "process_data_truncated": fields.Boolean,
}

workflow_run_node_execution_list_fields = {
    "data": fields.List(fields.Nested(workflow_run_node_execution_fields)),
}
