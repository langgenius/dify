from flask_restful import fields

from libs.helper import TimestampField

api_template_query_detail_fields = {
    "id": fields.String,
    "name": fields.String,
    "setting": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
}
