from flask_restx import Namespace, fields

from libs.helper import TimestampField

from ._value_type_serializer import serialize_value_type

conversation_variable_fields = {
    "id": fields.String,
    "name": fields.String,
    "value_type": fields.String(attribute=serialize_value_type),
    "value": fields.String,
    "description": fields.String,
    "created_at": TimestampField,
    "updated_at": TimestampField,
}

paginated_conversation_variable_fields = {
    "page": fields.Integer,
    "limit": fields.Integer,
    "total": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(conversation_variable_fields), attribute="data"),
}

conversation_variable_infinite_scroll_pagination_fields = {
    "limit": fields.Integer,
    "has_more": fields.Boolean,
    "data": fields.List(fields.Nested(conversation_variable_fields)),
}


def build_conversation_variable_model(api_or_ns: Namespace):
    """Build the conversation variable model for the API or Namespace."""
    return api_or_ns.model("ConversationVariable", conversation_variable_fields)


def build_conversation_variable_infinite_scroll_pagination_model(api_or_ns: Namespace):
    """Build the conversation variable infinite scroll pagination model for the API or Namespace."""
    # Build the nested variable model first
    conversation_variable_model = build_conversation_variable_model(api_or_ns)

    copied_fields = conversation_variable_infinite_scroll_pagination_fields.copy()
    copied_fields["data"] = fields.List(fields.Nested(conversation_variable_model))

    return api_or_ns.model("ConversationVariableInfiniteScrollPagination", copied_fields)
