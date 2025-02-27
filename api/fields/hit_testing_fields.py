from flask_restful import fields  # type: ignore

from libs.helper import TimestampField

document_fields = {
    "id": fields.String,
    "data_source_type": fields.String,
    "name": fields.String,
    "doc_type": fields.String,
    "doc_metadata": fields.Raw,
}

segment_fields = {
    "id": fields.String,
    "position": fields.Integer,
    "document_id": fields.String,
    "content": fields.String,
    "sign_content": fields.String,
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
    "document": fields.Nested(document_fields),
}

child_chunk_fields = {
    "id": fields.String,
    "content": fields.String,
    "position": fields.Integer,
    "score": fields.Float,
}

hit_testing_record_fields = {
    "segment": fields.Nested(segment_fields),
    "child_chunks": fields.List(fields.Nested(child_chunk_fields)),
    "score": fields.Float,
    "tsne_position": fields.Raw,
}
