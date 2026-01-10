from flask_restx import fields

from core.helper import encrypter
from core.variables import SecretVariable, SegmentType, VariableBase
from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

from ._value_type_serializer import serialize_value_type

ENVIRONMENT_VARIABLE_SUPPORTED_TYPES = (SegmentType.STRING, SegmentType.NUMBER, SegmentType.SECRET)


class EnvironmentVariableField(fields.Raw):
    def format(self, value):
        # Mask secret variables values in environment_variables
        if isinstance(value, SecretVariable):
            return {
                "id": value.id,
                "name": value.name,
                "value": encrypter.full_mask_token(),
                "value_type": value.value_type.value,
                "description": value.description,
            }
        if isinstance(value, VariableBase):
            return {
                "id": value.id,
                "name": value.name,
                "value": value.value,
                "value_type": value.value_type.exposed_type().value,
                "description": value.description,
            }
        if isinstance(value, dict):
            value_type_str = value.get("value_type")
            if not isinstance(value_type_str, str):
                raise TypeError(
                    f"unexpected type for value_type field, value={value_type_str}, type={type(value_type_str)}"
                )
            value_type = SegmentType(value_type_str).exposed_type()
            if value_type not in ENVIRONMENT_VARIABLE_SUPPORTED_TYPES:
                raise ValueError(f"Unsupported environment variable value type: {value_type}")
            return value


conversation_variable_fields = {
    "id": fields.String,
    "name": fields.String,
    "value_type": fields.String(attribute=serialize_value_type),
    "value": fields.Raw,
    "description": fields.String,
}

pipeline_variable_fields = {
    "label": fields.String,
    "variable": fields.String,
    "type": fields.String,
    "belong_to_node_id": fields.String,
    "max_length": fields.Integer,
    "required": fields.Boolean,
    "unit": fields.String,
    "default_value": fields.Raw,
    "options": fields.List(fields.String),
    "placeholder": fields.String,
    "tooltips": fields.String,
    "allowed_file_types": fields.List(fields.String),
    "allow_file_extension": fields.List(fields.String),
    "allow_file_upload_methods": fields.List(fields.String),
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
    "rag_pipeline_variables": fields.List(fields.Nested(pipeline_variable_fields)),
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
