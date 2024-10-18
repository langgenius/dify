from flask_restful import fields

from libs.helper import TimestampField

upload_config_fields = {
    "file_size_limit": fields.Integer,
    "batch_count_limit": fields.Integer,
    "image_file_size_limit": fields.Integer,
}

file_fields = {
    "id": fields.String,
    "name": fields.String,
    "size": fields.Integer,
    "extension": fields.String,
    "mime_type": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
}

remote_file_info_fields = {
    "file_type": fields.String(attribute="file_type"),
    "file_length": fields.Integer(attribute="file_length"),
}
