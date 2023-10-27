from flask_restful import fields

from libs.helper import TimestampField

api_based_extension_fields = {
    'id': fields.String,
    'name': fields.String,
    'api_endpoint': fields.String,
    'api_key': fields.String,
    'created_at': TimestampField
}