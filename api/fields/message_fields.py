from flask_restful import fields

from fields.conversation_fields import message_file_fields
from libs.helper import TimestampField

from .raws import FilesContainedField

feedback_fields = {"rating": fields.String}

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

retriever_resource_fields = {
    "id": fields.String,
    "message_id": fields.String,
    "position": fields.Integer,
    "dataset_id": fields.String,
    "dataset_name": fields.String,
    "document_id": fields.String,
    "document_name": fields.String,
    "data_source_type": fields.String,
    "segment_id": fields.String,
    "score": fields.Float,
    "hit_count": fields.Integer,
    "word_count": fields.Integer,
    "segment_position": fields.Integer,
    "index_node_hash": fields.String,
    "content": fields.String,
    "created_at": TimestampField,
}

message_fields = {
    "id": fields.String,
    "conversation_id": fields.String,
    "parent_message_id": fields.String,
    "inputs": FilesContainedField,
    "query": fields.String,
    "answer": fields.String(attribute="re_sign_file_url_answer"),
    "feedback": fields.Nested(feedback_fields, attribute="user_feedback", allow_null=True),
    "retriever_resources": fields.List(fields.Nested(retriever_resource_fields)),
    "created_at": TimestampField,
    "agent_thoughts": fields.List(fields.Nested(agent_thought_fields)),
    "message_files": fields.List(fields.Nested(message_file_fields)),
    "status": fields.String,
    "error": fields.String,
}

message_infinite_scroll_pagination_fields = {
    "limit": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(message_fields)),
}
