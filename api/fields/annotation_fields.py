from flask_restful import fields
from libs.helper import TimestampField

annotation_fields = {
    "id": fields.String,
    "question": fields.String,
    "content": fields.String,
    "hit_count": fields.Integer,
    "created_at": TimestampField
}

annotation_list_fields = {
    "data": fields.List(fields.Nested(annotation_fields)),
}

annotation_hit_history_fields = {
    "id": fields.String,
    "source": fields.String,
    "question": fields.String,
    "created_at": TimestampField
}

annotation_hit_history_list_fields = {
    "data": fields.List(fields.Nested(annotation_hit_history_fields)),
}