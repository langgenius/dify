"""
Field definitions for message log APIs.

Fix for issue #20759: Add interfaces for retrieving logs from text generation
applications and chat applications, and enable the retrieval of the total token
consumption for each log entry, similar to how workflow logs are retrieved.
"""

from flask_restx import Api, Namespace, fields

from fields.end_user_fields import build_simple_end_user_model, simple_end_user_fields
from fields.member_fields import build_simple_account_model, simple_account_fields
from libs.helper import TimestampField

# Message log fields that include token consumption information
message_log_fields = {
    "id": fields.String,
    "conversation_id": fields.String,
    "query": fields.String,
    "answer": fields.String(attribute="re_sign_file_url_answer"),
    # Token consumption fields - these are the key additions for issue #20759
    "message_tokens": fields.Integer(description="Number of tokens in the input message"),
    "answer_tokens": fields.Integer(description="Number of tokens in the answer"),
    "total_tokens": fields.Integer(
        attribute=lambda obj: obj.message_tokens + obj.answer_tokens,
        description="Total tokens consumed (message_tokens + answer_tokens)",
    ),
    "provider_response_latency": fields.Float(description="Response latency in seconds"),
    "from_source": fields.String(description="Source of the message (api, console, etc.)"),
    "status": fields.String(description="Message status"),
    "error": fields.String(description="Error message if any"),
    "created_by_role": fields.String(
        attribute=lambda obj: "end_user" if obj.from_end_user_id else "account" if obj.from_account_id else "unknown",
        description="Role of the creator (end_user or account)",
    ),
    # Note: created_by_account and created_by_end_user will be populated
    # by the service layer to avoid N+1 queries
    "created_by_account": fields.Nested(simple_account_fields, allow_null=True),
    "created_by_end_user": fields.Nested(simple_end_user_fields, allow_null=True),
    "created_at": TimestampField(description="Message creation timestamp"),
}


def build_message_log_model(api_or_ns: Api | Namespace):
    """Build the message log model for the API or Namespace."""
    simple_account_model = build_simple_account_model(api_or_ns)
    simple_end_user_model = build_simple_end_user_model(api_or_ns)

    copied_fields = message_log_fields.copy()
    copied_fields["created_by_account"] = fields.Nested(
        simple_account_model, attribute="created_by_account", allow_null=True
    )
    copied_fields["created_by_end_user"] = fields.Nested(
        simple_end_user_model, attribute="created_by_end_user", allow_null=True
    )
    return api_or_ns.model("MessageLog", copied_fields)


# Pagination fields for message logs
message_log_pagination_fields = {
    "page": fields.Integer(description="Current page number"),
    "limit": fields.Integer(description="Number of items per page"),
    "total": fields.Integer(description="Total number of messages"),
    "has_more": fields.Boolean(description="Whether there are more pages"),
    "data": fields.List(fields.Nested(message_log_fields), description="List of message logs"),
}


def build_message_log_pagination_model(api_or_ns: Api | Namespace):
    """Build the message log pagination model for the API or Namespace."""
    # Build the nested message log model first
    message_log_model = build_message_log_model(api_or_ns)

    copied_fields = message_log_pagination_fields.copy()
    copied_fields["data"] = fields.List(fields.Nested(message_log_model))
    return api_or_ns.model("MessageLogPagination", copied_fields)
