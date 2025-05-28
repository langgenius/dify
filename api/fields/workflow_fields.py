from flask_restful import fields

from core.helper import encrypter
from core.variables import SecretVariable, SegmentType, Variable
from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

ENVIRONMENT_VARIABLE_SUPPORTED_TYPES = (SegmentType.STRING, SegmentType.NUMBER, SegmentType.SECRET)


class EnvironmentVariableField(fields.Raw):
    def format(self, value):
        # Mask secret variables values in environment_variables
        if isinstance(value, SecretVariable):
            return {
                "id": value.id,
                "name": value.name,
                "value": encrypter.obfuscated_token(value.value),
                "value_type": value.value_type.value,
            }
        if isinstance(value, Variable):
            return {
                "id": value.id,
                "name": value.name,
                "value": value.value,
                "value_type": value.value_type.value,
            }
        if isinstance(value, dict):
            value_type = value.get("value_type")
            if value_type not in ENVIRONMENT_VARIABLE_SUPPORTED_TYPES:
                raise ValueError(f"Unsupported environment variable value type: {value_type}")
            return value


conversation_variable_fields = {
    "id": fields.String,
    "name": fields.String,
    "value_type": fields.String(attribute="value_type.value"),
    "value": fields.Raw,
    "description": fields.String,
}

workflow_fields = {
    "id": fields.String,
    "graph": fields.Raw(attribute="graph_dict"),
    "features": fields.Raw(attribute="features_dict"),
    "hash": fields.String(attribute="unique_hash"),
    "version": fields.String,
    "marked_name": fields.String,
    "marked_comment": fields.String,
    "created_by": fields.Nested(simple_account_fields, attribute="created_by_account"),
    "created_at": TimestampField,
    "updated_by": fields.Nested(simple_account_fields, attribute="updated_by_account", allow_null=True),
    "updated_at": TimestampField,
    "tool_published": fields.Boolean,
    "environment_variables": fields.List(EnvironmentVariableField()),
    "conversation_variables": fields.List(fields.Nested(conversation_variable_fields)),
}

workflow_partial_fields = {
    "id": fields.String,
    "created_by": fields.String,
    "created_at": TimestampField,
    "updated_by": fields.String,
    "updated_at": TimestampField,
}

workflow_pagination_fields = {
    "items": fields.List(fields.Nested(workflow_fields), attribute="items"),
    "page": fields.Integer,
    "limit": fields.Integer(attribute="limit"),
    "has_more": fields.Boolean(attribute="has_more"),
}
