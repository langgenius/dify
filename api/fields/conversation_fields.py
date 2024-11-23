from flask_restful import fields

from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

from .raws import FilesContainedField


class MessageTextField(fields.Raw):
    def format(self, value):
        return value[0]["text"] if value else ""


feedback_fields = {
    "rating": fields.String,
    "content": fields.String,
    "from_source": fields.String,
    "from_end_user_id": fields.String,
    "from_account": fields.Nested(simple_account_fields, allow_null=True),
}

annotation_fields = {
    "id": fields.String,
    "question": fields.String,
    "content": fields.String,
    "account": fields.Nested(simple_account_fields, allow_null=True),
    "created_at": TimestampField,
}

annotation_hit_history_fields = {
    "annotation_id": fields.String(attribute="id"),
    "annotation_create_account": fields.Nested(simple_account_fields, allow_null=True),
    "created_at": TimestampField,
}

message_file_fields = {
    "id": fields.String,
    "filename": fields.String,
    "type": fields.String,
    "url": fields.String,
    "mime_type": fields.String,
    "size": fields.Integer,
    "transfer_method": fields.String,
    "belongs_to": fields.String(default="user"),
}

agent_thought_fields = {
    "id": fields.String,
    "chain_id": fields.String,
    "message_id": fields.String,
    "position": fields.Integer,
    "thought": fields.String,
    "tool": fields.String,
    "tool_labels": fields.Raw,
    "tool_input": fields.String,
    "created_at": TimestampField,
    "observation": fields.String,
    "files": fields.List(fields.String),
}

message_detail_fields = {
    "id": fields.String,
    "conversation_id": fields.String,
    "inputs": FilesContainedField,
    "query": fields.String,
    "message": fields.Raw,
    "message_tokens": fields.Integer,
    "answer": fields.String(attribute="re_sign_file_url_answer"),
    "answer_tokens": fields.Integer,
    "provider_response_latency": fields.Float,
    "from_source": fields.String,
    "from_end_user_id": fields.String,
    "from_account_id": fields.String,
    "feedbacks": fields.List(fields.Nested(feedback_fields)),
    "workflow_run_id": fields.String,
    "annotation": fields.Nested(annotation_fields, allow_null=True),
    "annotation_hit_history": fields.Nested(annotation_hit_history_fields, allow_null=True),
    "created_at": TimestampField,
    "agent_thoughts": fields.List(fields.Nested(agent_thought_fields)),
    "message_files": fields.List(fields.Nested(message_file_fields)),
    "metadata": fields.Raw(attribute="message_metadata_dict"),
    "status": fields.String,
    "error": fields.String,
    "parent_message_id": fields.String,
}

feedback_stat_fields = {"like": fields.Integer, "dislike": fields.Integer}

model_config_fields = {
    "opening_statement": fields.String,
    "suggested_questions": fields.Raw,
    "model": fields.Raw,
    "user_input_form": fields.Raw,
    "pre_prompt": fields.String,
    "agent_mode": fields.Raw,
}

simple_configs_fields = {
    "prompt_template": fields.String,
}

simple_model_config_fields = {
    "model": fields.Raw(attribute="model_dict"),
    "pre_prompt": fields.String,
}

simple_message_detail_fields = {
    "inputs": FilesContainedField,
    "query": fields.String,
    "message": MessageTextField,
    "answer": fields.String,
}

conversation_fields = {
    "id": fields.String,
    "status": fields.String,
    "from_source": fields.String,
    "from_end_user_id": fields.String,
    "from_end_user_session_id": fields.String(),
    "from_account_id": fields.String,
    "from_account_name": fields.String,
    "read_at": TimestampField,
    "created_at": TimestampField,
    "updated_at": TimestampField,
    "annotation": fields.Nested(annotation_fields, allow_null=True),
    "model_config": fields.Nested(simple_model_config_fields),
    "user_feedback_stats": fields.Nested(feedback_stat_fields),
    "admin_feedback_stats": fields.Nested(feedback_stat_fields),
    "message": fields.Nested(simple_message_detail_fields, attribute="first_message"),
}

conversation_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer(attribute="per_page"),
    "total": fields.Integer,
    "has_more": fields.Boolean(attribute="has_next"),
    "data": fields.List(fields.Nested(conversation_fields), attribute="items"),
}

conversation_message_detail_fields = {
    "id": fields.String,
    "status": fields.String,
    "from_source": fields.String,
    "from_end_user_id": fields.String,
    "from_account_id": fields.String,
    "created_at": TimestampField,
    "model_config": fields.Nested(model_config_fields),
    "message": fields.Nested(message_detail_fields, attribute="first_message"),
}

conversation_with_summary_fields = {
    "id": fields.String,
    "status": fields.String,
    "from_source": fields.String,
    "from_end_user_id": fields.String,
    "from_end_user_session_id": fields.String,
    "from_account_id": fields.String,
    "from_account_name": fields.String,
    "name": fields.String,
    "summary": fields.String(attribute="summary_or_query"),
    "read_at": TimestampField,
    "created_at": TimestampField,
    "updated_at": TimestampField,
    "annotated": fields.Boolean,
    "model_config": fields.Nested(simple_model_config_fields),
    "message_count": fields.Integer,
    "user_feedback_stats": fields.Nested(feedback_stat_fields),
    "admin_feedback_stats": fields.Nested(feedback_stat_fields),
}

conversation_with_summary_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer(attribute="per_page"),
    "total": fields.Integer,
    "has_more": fields.Boolean(attribute="has_next"),
    "data": fields.List(fields.Nested(conversation_with_summary_fields), attribute="items"),
}

conversation_detail_fields = {
    "id": fields.String,
    "status": fields.String,
    "from_source": fields.String,
    "from_end_user_id": fields.String,
    "from_account_id": fields.String,
    "created_at": TimestampField,
    "updated_at": TimestampField,
    "annotated": fields.Boolean,
    "introduction": fields.String,
    "model_config": fields.Nested(model_config_fields),
    "message_count": fields.Integer,
    "user_feedback_stats": fields.Nested(feedback_stat_fields),
    "admin_feedback_stats": fields.Nested(feedback_stat_fields),
}

simple_conversation_fields = {
    "id": fields.String,
    "name": fields.String,
    "inputs": FilesContainedField,
    "status": fields.String,
    "introduction": fields.String,
    "created_at": TimestampField,
    "updated_at": TimestampField,
}

conversation_delete_fields = {
    "result": fields.String,
}

conversation_infinite_scroll_pagination_fields = {
    "limit": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(simple_conversation_fields)),
}

conversation_with_model_config_fields = {
    **simple_conversation_fields,
    "model_config": fields.Raw,
}

conversation_with_model_config_infinite_scroll_pagination_fields = {
    "limit": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(conversation_with_model_config_fields)),
}
