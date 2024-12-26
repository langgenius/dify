from flask_restful import fields  # type: ignore

from libs.helper import TimestampField

external_knowledge_api_query_detail_fields = {
    "id": fields.String,
    "name": fields.String,
    "setting": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
}
