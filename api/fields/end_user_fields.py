from flask_restx import Namespace, fields

simple_end_user_fields = {
    "id": fields.String,
    "type": fields.String,
    "is_anonymous": fields.Boolean,
    "session_id": fields.String,
}


def build_simple_end_user_model(api_or_ns: Namespace):
    return api_or_ns.model("SimpleEndUser", simple_end_user_fields)
