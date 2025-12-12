from flask_restx import Api, Namespace, fields

from fields.end_user_fields import build_simple_end_user_model, simple_end_user_fields
from fields.member_fields import build_simple_account_model, simple_account_fields
from libs.helper import TimestampField

chat_conversation_fields = {
    "id": fields.String,
    "name": fields.String,
    "status": fields.String,
}

chat_message_fields = {
    "id": fields.String,
    "conversation_id": fields.String,
    "query": fields.String,
    "answer": fields.String,
    "status": fields.String,
    "message_tokens": fields.Integer,
    "total_tokens": fields.Integer,
    "created_at": TimestampField,
    "error": fields.String,
    "provider_response_latency": fields.Float,
    "from_source": fields.String,
    "from_end_user_id": fields.String,
    "from_account_id": fields.String,
}

chat_app_log_partial_fields = {
    "id": fields.String,
    "conversation": fields.Nested(chat_conversation_fields, attribute="conversation", allow_null=True),
    "message": fields.Nested(chat_message_fields, attribute="message", allow_null=False),
    "created_from": fields.String,
    "created_by_role": fields.String,
    "created_by_account": fields.Nested(simple_account_fields, attribute="created_by_account", allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, attribute="created_by_end_user", allow_null=True),
    "created_at": TimestampField,
}


def build_chat_conversation_model(api_or_ns: Api | Namespace):
    """Build the chat conversation model for the API or Namespace."""
    return api_or_ns.model("ChatConversation", chat_conversation_fields)


def build_chat_message_model(api_or_ns: Api | Namespace):
    """Build the chat message model for the API or Namespace."""
    return api_or_ns.model("ChatMessage", chat_message_fields)


def build_chat_app_log_partial_model(api_or_ns: Api | Namespace):
    """Build the chat app log partial model for the API or Namespace."""
    simple_account_model = build_simple_account_model(api_or_ns)
    simple_end_user_model = build_simple_end_user_model(api_or_ns)
    chat_conversation_model = build_chat_conversation_model(api_or_ns)
    chat_message_model = build_chat_message_model(api_or_ns)

    copied_fields = chat_app_log_partial_fields.copy()
    copied_fields["conversation"] = fields.Nested(chat_conversation_model, attribute="conversation", allow_null=True)
    copied_fields["message"] = fields.Nested(chat_message_model, attribute="message", allow_null=False)
    copied_fields["created_by_account"] = fields.Nested(
        simple_account_model, attribute="created_by_account", allow_null=True
    )
    copied_fields["created_by_end_user"] = fields.Nested(
        simple_end_user_model, attribute="created_by_end_user", allow_null=True
    )
    return api_or_ns.model("ChatAppLogPartial", copied_fields)


chat_app_log_pagination_fields = {
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(chat_app_log_partial_fields)),
}


def build_chat_app_log_pagination_model(api_or_ns: Api | Namespace):
    """Build the chat app log pagination model for the API or Namespace."""
    # Build the nested partial model first
    chat_app_log_partial_model = build_chat_app_log_partial_model(api_or_ns)

    copied_fields = chat_app_log_pagination_fields.copy()
    copied_fields["data"] = fields.List(fields.Nested(chat_app_log_partial_model))
    return api_or_ns.model("ChatAppLogPagination", copied_fields)
