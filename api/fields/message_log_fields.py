"""
Field definitions for message log APIs.

Fix for issue #20759: Add interfaces for retrieving logs from text generation
applications and chat applications, and enable the retrieval of the total token
consumption for each log entry, similar to how workflow logs are retrieved.

This module defines Flask-RestX field models for message log API responses.
It includes token consumption fields (message_tokens, answer_tokens, total_tokens)
and supports pagination for efficient log retrieval.
"""

from flask_restx import Api, Namespace, fields

from fields.end_user_fields import build_simple_end_user_model, simple_end_user_fields
from fields.member_fields import build_simple_account_model, simple_account_fields
from libs.helper import TimestampField

# ============================================================================
# Message Log Field Definitions
# ============================================================================
# These fields define the structure of message log entries in API responses.
# Each field maps to a property of the Message model or a computed value.
#
# Key additions for issue #20759:
# - message_tokens: Token count for user input
# - answer_tokens: Token count for assistant response
# - total_tokens: Computed total (message_tokens + answer_tokens)
# ============================================================================
message_log_fields = {
    # Basic message identification fields
    "id": fields.String(description="Unique message identifier"),
    "conversation_id": fields.String(description="ID of the conversation this message belongs to"),
    "query": fields.String(description="User's input query or message"),
    "answer": fields.String(
        attribute="re_sign_file_url_answer",
        description="Assistant's response answer (with file URL re-signing if applicable)"
    ),

    # ========================================================================
    # Token Consumption Fields (Issue #20759)
    # ========================================================================
    # These fields provide detailed token usage information for each message.
    # This is essential for:
    # - Cost tracking and billing
    # - Usage analytics and reporting
    # - Performance monitoring
    # - Resource planning
    "message_tokens": fields.Integer(
        description="Number of tokens in the input message (user query)"
    ),
    "answer_tokens": fields.Integer(
        description="Number of tokens in the answer (assistant response)"
    ),
    "total_tokens": fields.Integer(
        attribute=lambda obj: obj.message_tokens + obj.answer_tokens,
        description="Total tokens consumed for this message (message_tokens + answer_tokens). "
                   "This is computed dynamically from the message and answer token counts."
    ),

    # Performance and metadata fields
    "provider_response_latency": fields.Float(
        description="Response latency in seconds (time taken to generate the response)"
    ),
    "from_source": fields.String(
        description="Source of the message (api, console, etc.). "
                   "Indicates where the message originated from."
    ),
    "status": fields.String(
        description="Message status (e.g., 'normal', 'error', etc.)"
    ),
    "error": fields.String(
        description="Error message if the message processing failed, null otherwise"
    ),

    # Creator information fields
    "created_by_role": fields.String(
        attribute=lambda obj: (
            "end_user" if obj.from_end_user_id
            else "account" if obj.from_account_id
            else "unknown"
        ),
        description="Role of the message creator (end_user, account, or unknown). "
                   "This is computed based on the presence of from_end_user_id or from_account_id."
    ),

    # ========================================================================
    # Related Entity Fields
    # ========================================================================
    # These fields reference related Account and EndUser entities.
    # Note: These are populated by the service layer (MessageService.get_paginate_message_logs)
    # to avoid N+1 query problems. The service batch-loads all accounts and end_users
    # in a single query, then attaches them to the message log view objects.
    "created_by_account": fields.Nested(
        simple_account_fields,
        allow_null=True,
        description="Account that created this message (for console-sourced messages). "
                   "Null for API-sourced messages."
    ),
    "created_by_end_user": fields.Nested(
        simple_end_user_fields,
        allow_null=True,
        description="End user that created this message (for API-sourced messages). "
                   "Null for console-sourced messages."
    ),

    # Timestamp field
    "created_at": TimestampField(
        description="Message creation timestamp (Unix timestamp in seconds)"
    ),
}


# ============================================================================
# Model Builder Functions
# ============================================================================

def build_message_log_model(api_or_ns: Api | Namespace):
    """
    Build the message log model for the API or Namespace.

    This function creates a Flask-RestX model from the message_log_fields
    dictionary, properly handling nested models for Account and EndUser.

    Args:
        api_or_ns: Flask-RestX Api or Namespace instance to register the model with

    Returns:
        Model: Flask-RestX model for message log entries
    """
    # Build nested models for Account and EndUser
    # These are required because Flask-RestX needs the models to be registered
    # before they can be used in Nested fields
    simple_account_model = build_simple_account_model(api_or_ns)
    simple_end_user_model = build_simple_end_user_model(api_or_ns)

    # Create a copy of the fields dictionary to avoid modifying the original
    copied_fields = message_log_fields.copy()

    # Replace the simple field references with properly nested models
    # This ensures the nested Account and EndUser data is properly serialized
    copied_fields["created_by_account"] = fields.Nested(
        simple_account_model,
        attribute="created_by_account",
        allow_null=True
    )
    copied_fields["created_by_end_user"] = fields.Nested(
        simple_end_user_model,
        attribute="created_by_end_user",
        allow_null=True
    )

    # Register and return the model
    return api_or_ns.model("MessageLog", copied_fields)


# ============================================================================
# Pagination Field Definitions
# ============================================================================
# These fields define the structure of paginated message log API responses.
# Pagination allows clients to retrieve logs in manageable chunks rather than
# loading all logs at once, which is essential for applications with many messages.
# ============================================================================
message_log_pagination_fields = {
    "page": fields.Integer(
        description="Current page number (1-indexed)"
    ),
    "limit": fields.Integer(
        description="Number of items per page"
    ),
    "total": fields.Integer(
        description="Total number of messages matching the filters (across all pages)"
    ),
    "has_more": fields.Boolean(
        description="Whether there are more pages available after the current page. "
                   "True if (page * limit) < total, False otherwise."
    ),
    "data": fields.List(
        fields.Nested(message_log_fields),
        description="List of message log entries for the current page"
    ),
}


def build_message_log_pagination_model(api_or_ns: Api | Namespace):
    """
    Build the message log pagination model for the API or Namespace.

    This function creates a Flask-RestX model for paginated message log responses.
    It includes pagination metadata (page, limit, total, has_more) and a list
    of message log entries.

    Args:
        api_or_ns: Flask-RestX Api or Namespace instance to register the model with

    Returns:
        Model: Flask-RestX model for paginated message log responses
    """
    # Build the nested message log model first
    # This ensures the nested Account and EndUser models are properly registered
    message_log_model = build_message_log_model(api_or_ns)

    # Create a copy of the pagination fields to avoid modifying the original
    copied_fields = message_log_pagination_fields.copy()

    # Replace the simple field reference with the properly built nested model
    # This ensures nested Account and EndUser data is properly serialized in paginated responses
    copied_fields["data"] = fields.List(fields.Nested(message_log_model))

    # Register and return the pagination model
    return api_or_ns.model("MessageLogPagination", copied_fields)
