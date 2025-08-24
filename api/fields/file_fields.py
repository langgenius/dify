from flask_restx import Api, Namespace, fields

from libs.helper import TimestampField

upload_config_fields = {
    "file_size_limit": fields.Integer,
    "batch_count_limit": fields.Integer,
    "image_file_size_limit": fields.Integer,
    "video_file_size_limit": fields.Integer,
    "audio_file_size_limit": fields.Integer,
    "workflow_file_upload_limit": fields.Integer,
}

file_fields = {
    "id": fields.String,
    "name": fields.String,
    "size": fields.Integer,
    "extension": fields.String,
    "mime_type": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
    "preview_url": fields.String,
}


def build_file_model(api_or_ns: Api | Namespace):
    """Build the file model for the API or Namespace.

    Args:
        api_or_ns: Flask-RestX Api or Namespace instance

    Returns:
        The registered model
    """
    return api_or_ns.model("File", file_fields)


remote_file_info_fields = {
    "file_type": fields.String(attribute="file_type"),
    "file_length": fields.Integer(attribute="file_length"),
}


file_fields_with_signed_url = {
    "id": fields.String,
    "name": fields.String,
    "size": fields.Integer,
    "extension": fields.String,
    "url": fields.String,
    "mime_type": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
}
