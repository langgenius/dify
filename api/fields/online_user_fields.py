from flask_restx import fields

online_user_partial_fields = {
    "user_id": fields.String,
    "username": fields.String,
    "avatar": fields.String,
    "sid": fields.String,
}

workflow_online_users_fields = {
    "workflow_id": fields.String,
    "users": fields.List(fields.Nested(online_user_partial_fields)),
}

online_user_list_fields = {
    "data": fields.List(fields.Nested(workflow_online_users_fields)),
}
