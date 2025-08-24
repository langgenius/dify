from flask_restx import Api, Namespace, fields

from libs.helper import TimestampField

annotation_fields = {
    "id": fields.String,
    "question": fields.String,
    "answer": fields.Raw(attribute="content"),
    "hit_count": fields.Integer,
    "created_at": TimestampField,
    # 'account': fields.Nested(simple_account_fields, allow_null=True)
}


def build_annotation_model(api_or_ns: Api | Namespace):
    """Build the annotation model for the API or Namespace."""
    return api_or_ns.model("Annotation", annotation_fields)


annotation_list_fields = {
    "data": fields.List(fields.Nested(annotation_fields)),
}

annotation_hit_history_fields = {
    "id": fields.String,
    "source": fields.String,
    "score": fields.Float,
    "question": fields.String,
    "created_at": TimestampField,
    "match": fields.String(attribute="annotation_question"),
    "response": fields.String(attribute="annotation_content"),
}

annotation_hit_history_list_fields = {
    "data": fields.List(fields.Nested(annotation_hit_history_fields)),
}
