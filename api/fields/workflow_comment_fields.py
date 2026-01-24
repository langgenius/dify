from flask_restx import fields

from libs.helper import AvatarUrlField, TimestampField

# basic account fields for comments
account_fields = {
    "id": fields.String,
    "name": fields.String,
    "email": fields.String,
    "avatar_url": AvatarUrlField,
}

# Comment mention fields
workflow_comment_mention_fields = {
    "mentioned_user_id": fields.String,
    "mentioned_user_account": fields.Nested(account_fields, allow_null=True),
    "reply_id": fields.String,
}

# Comment reply fields
workflow_comment_reply_fields = {
    "id": fields.String,
    "content": fields.String,
    "created_by": fields.String,
    "created_by_account": fields.Nested(account_fields, allow_null=True),
    "created_at": TimestampField,
}

# Basic comment fields (for list views)
workflow_comment_basic_fields = {
    "id": fields.String,
    "position_x": fields.Float,
    "position_y": fields.Float,
    "content": fields.String,
    "created_by": fields.String,
    "created_by_account": fields.Nested(account_fields, allow_null=True),
    "created_at": TimestampField,
    "updated_at": TimestampField,
    "resolved": fields.Boolean,
    "resolved_at": TimestampField,
    "resolved_by": fields.String,
    "resolved_by_account": fields.Nested(account_fields, allow_null=True),
    "reply_count": fields.Integer,
    "mention_count": fields.Integer,
    "participants": fields.List(fields.Nested(account_fields)),
}

# Detailed comment fields (for single comment view)
workflow_comment_detail_fields = {
    "id": fields.String,
    "position_x": fields.Float,
    "position_y": fields.Float,
    "content": fields.String,
    "created_by": fields.String,
    "created_by_account": fields.Nested(account_fields, allow_null=True),
    "created_at": TimestampField,
    "updated_at": TimestampField,
    "resolved": fields.Boolean,
    "resolved_at": TimestampField,
    "resolved_by": fields.String,
    "resolved_by_account": fields.Nested(account_fields, allow_null=True),
    "replies": fields.List(fields.Nested(workflow_comment_reply_fields)),
    "mentions": fields.List(fields.Nested(workflow_comment_mention_fields)),
}

# Comment creation response fields (simplified)
workflow_comment_create_fields = {
    "id": fields.String,
    "created_at": TimestampField,
}

# Comment update response fields (simplified)
workflow_comment_update_fields = {
    "id": fields.String,
    "updated_at": TimestampField,
}

# Comment resolve response fields
workflow_comment_resolve_fields = {
    "id": fields.String,
    "resolved": fields.Boolean,
    "resolved_at": TimestampField,
    "resolved_by": fields.String,
}

# Reply creation response fields (simplified)
workflow_comment_reply_create_fields = {
    "id": fields.String,
    "created_at": TimestampField,
}

# Reply update response fields
workflow_comment_reply_update_fields = {
    "id": fields.String,
    "updated_at": TimestampField,
}
