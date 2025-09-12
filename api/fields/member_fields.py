from flask_restx import Api, Namespace, fields

from libs.helper import AvatarUrlField, TimestampField

simple_account_fields = {
    "id": fields.String,
    "name": fields.String,
    "email": fields.String,
}


def build_simple_account_model(api_or_ns: Api | Namespace):
    return api_or_ns.model("SimpleAccount", simple_account_fields)


account_fields = {
    "id": fields.String,
    "name": fields.String,
    "avatar": fields.String,
    "avatar_url": AvatarUrlField,
    "email": fields.String,
    "is_password_set": fields.Boolean,
    "interface_language": fields.String,
    "interface_theme": fields.String,
    "timezone": fields.String,
    "last_login_at": TimestampField,
    "last_login_ip": fields.String,
    "created_at": TimestampField,
}

account_with_role_fields = {
    "id": fields.String,
    "name": fields.String,
    "avatar": fields.String,
    "avatar_url": AvatarUrlField,
    "email": fields.String,
    "last_login_at": TimestampField,
    "last_active_at": TimestampField,
    "created_at": TimestampField,
    "role": fields.String,
    "status": fields.String,
}

account_with_role_list_fields = {"accounts": fields.List(fields.Nested(account_with_role_fields))}
