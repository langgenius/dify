from flask_restful import fields

from libs.helper import TimestampField


class HiddenAPIKey(fields.Raw):
    def output(self, key, obj):
        return obj.api_key[:3] + '***' + obj.api_key[-3:]


api_based_extension_fields = {
    'id': fields.String,
    'name': fields.String,
    'api_endpoint': fields.String,
    'api_key': HiddenAPIKey,
    'created_at': TimestampField
}
