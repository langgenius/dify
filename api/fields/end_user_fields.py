from flask_restful import fields  # type: ignore
from libs.helper import TimestampField

simple_end_user_fields = {
    "id": fields.String,
    "type": fields.String,
    "is_anonymous": fields.Boolean,
    "session_id": fields.String,
}

detailed_end_user_fields = {
    "id": fields.String,
    "name": fields.String,
    "email": fields.String,
    "first_chat_at": TimestampField,
    "last_chat_at": TimestampField,
    "total_messages": fields.Integer,
    "active_days": fields.Integer,
    "health_status": fields.String,
    "topics": fields.List(fields.String),
    "summary": fields.String,
    "major": fields.String,
}

end_users_infinite_scroll_pagination_fields = {
    "total": fields.Integer,
    "data": fields.List(fields.Nested(detailed_end_user_fields)),
}

# Image generation fields definition
end_user_image_fields = {
    "id": fields.String,
    "status": fields.String,
    "image_url": fields.String,
    "content_type": fields.String,
    "text_content": fields.String,
    "error_message": fields.String,
    "created_at": TimestampField,
}

end_user_image_list_pagination_fields = {
    "total": fields.Integer,
    "data": fields.List(fields.Nested(end_user_image_fields)),
}
