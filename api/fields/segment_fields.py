from flask_restful import fields

from libs.helper import TimestampField

segment_fields = {
    "id": fields.String,
    "position": fields.Integer,
    "document_id": fields.String,
    "content": fields.String,
    "answer": fields.String,
    "word_count": fields.Integer,
    "tokens": fields.Integer,
    "keywords": fields.List(fields.String),
    "index_node_id": fields.String,
    "index_node_hash": fields.String,
    "hit_count": fields.Integer,
    "enabled": fields.Boolean,
    "disabled_at": TimestampField,
    "disabled_by": fields.String,
    "status": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
    "indexing_at": TimestampField,
    "completed_at": TimestampField,
    "error": fields.String,
    "stopped_at": TimestampField,
}

segment_list_response = {
    "data": fields.List(fields.Nested(segment_fields)),
    "has_more": fields.Boolean,
    "limit": fields.Integer,
}
