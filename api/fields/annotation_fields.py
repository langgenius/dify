from flask_restful import fields

from libs.helper import TimestampField

annotation_fields = {
    "id": fields.String,
    "question": fields.String,
    "answer": fields.Raw(attribute='content'),
    "hit_count": fields.Integer,
    "created_at": TimestampField,
    # 'account': fields.Nested(simple_account_fields, allow_null=True)
}

annotation_list_fields = {
    "data": fields.List(fields.Nested(annotation_fields)),
}

annotation_hit_history_fields = {
    "id": fields.String,
    "source": fields.String,
    "score": fields.Float,
    "question": fields.String,
    "created_at": TimestampField,
    "match": fields.String(attribute='annotation_question'),
    "response": fields.String(attribute='annotation_content')
}

annotation_hit_history_list_fields = {
    "data": fields.List(fields.Nested(annotation_hit_history_fields)),
}
