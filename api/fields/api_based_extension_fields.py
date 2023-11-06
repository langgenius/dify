from flask_restful import fields

from libs.helper import TimestampField


class HiddenAPIKey(fields.Raw):
    def output(self, key, obj):

        api_key = obj.api_key
        min_length = 5

        if len(api_key) < min_length:
            raise ValueError(f"api_key must be at least {min_length} characters long.")

        # If the length of the api_key is less than 8 characters, show the first and last characters
        if len(api_key) <= 8:
            return api_key[0] + '******' + api_key[-1]
        # If the api_key is greater than 8 characters, show the first three and the last three characters
        else:
            return api_key[:3] + '******' + api_key[-3:]


api_based_extension_fields = {
    'id': fields.String,
    'name': fields.String,
    'api_endpoint': fields.String,
    'api_key': HiddenAPIKey,
    'created_at': TimestampField
}
