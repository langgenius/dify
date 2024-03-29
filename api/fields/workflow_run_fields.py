from flask_restful import fields

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
    "finished_at": TimestampField
}

workflow_run_for_list_fields = {
    "id": fields.String,
    "sequence_number": fields.Integer,
    "version": fields.String,
    "status": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_steps": fields.Integer,
    "created_by_account": fields.Nested(simple_account_fields, attribute='created_by_account', allow_null=True),
    "created_at": TimestampField,
    "finished_at": TimestampField
}

advanced_chat_workflow_run_for_list_fields = {
    "id": fields.String,
    "conversation_id": fields.String,
    "message_id": fields.String,
    "sequence_number": fields.Integer,
    "version": fields.String,
    "status": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_steps": fields.Integer,
    "created_by_account": fields.Nested(simple_account_fields, attribute='created_by_account', allow_null=True),
    "created_at": TimestampField,
    "finished_at": TimestampField
}

advanced_chat_workflow_run_pagination_fields = {
    'limit': fields.Integer(attribute='limit'),
    'has_more': fields.Boolean(attribute='has_more'),
    'data': fields.List(fields.Nested(advanced_chat_workflow_run_for_list_fields), attribute='data')
}

workflow_run_pagination_fields = {
    'limit': fields.Integer(attribute='limit'),
    'has_more': fields.Boolean(attribute='has_more'),
    'data': fields.List(fields.Nested(workflow_run_for_list_fields), attribute='data')
}

workflow_run_detail_fields = {
    "id": fields.String,
    "sequence_number": fields.Integer,
    "version": fields.String,
    "graph": fields.Raw(attribute='graph_dict'),
    "inputs": fields.Raw(attribute='inputs_dict'),
    "status": fields.String,
    "outputs": fields.Raw(attribute='outputs_dict'),
    "error": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_steps": fields.Integer,
    "created_by_role": fields.String,
    "created_by_account": fields.Nested(simple_account_fields, attribute='created_by_account', allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute='created_by_end_user', allow_null=True),
    "created_at": TimestampField,
    "finished_at": TimestampField
}

workflow_run_node_execution_fields = {
    "id": fields.String,
    "index": fields.Integer,
    "predecessor_node_id": fields.String,
    "node_id": fields.String,
    "node_type": fields.String,
    "title": fields.String,
    "inputs": fields.Raw(attribute='inputs_dict'),
    "process_data": fields.Raw(attribute='process_data_dict'),
    "outputs": fields.Raw(attribute='outputs_dict'),
    "status": fields.String,
    "error": fields.String,
    "elapsed_time": fields.Float,
    "execution_metadata": fields.Raw(attribute='execution_metadata_dict'),
    "extras": fields.Raw,
    "created_at": TimestampField,
    "created_by_role": fields.String,
    "created_by_account": fields.Nested(simple_account_fields, attribute='created_by_account', allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute='created_by_end_user', allow_null=True),
    "finished_at": TimestampField
}

workflow_run_node_execution_list_fields = {
    'data': fields.List(fields.Nested(workflow_run_node_execution_fields)),
}
