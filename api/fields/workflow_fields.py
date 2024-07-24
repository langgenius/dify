from flask_restful import fields

from core.app.segments import SecretVariable, Variable
from core.helper import encrypter
from fields.member_fields import simple_account_fields
from libs.helper import TimestampField


class EnvironmentVariableField(fields.Raw):
    def format(self, value):
        # Mask secret variables values in environment_variables
        if isinstance(value, SecretVariable):
            return {
                'id': value.id,
                'name': value.name,
                'value': encrypter.obfuscated_token(value.value),
                'value_type': value.value_type.value,
            }
        elif isinstance(value, Variable):
            return {
                'id': value.id,
                'name': value.name,
                'value': value.value,
                'value_type': value.value_type.value,
            }
        return value


environment_variable_fields = {
    'id': fields.String,
    'name': fields.String,
    'value': fields.Raw,
    'value_type': fields.String(attribute='value_type.value'),
}

workflow_fields = {
    'id': fields.String,
    'graph': fields.Raw(attribute='graph_dict'),
    'features': fields.Raw(attribute='features_dict'),
    'hash': fields.String(attribute='unique_hash'),
    'created_by': fields.Nested(simple_account_fields, attribute='created_by_account'),
    'created_at': TimestampField,
    'updated_by': fields.Nested(simple_account_fields, attribute='updated_by_account', allow_null=True),
    'updated_at': TimestampField,
    'tool_published': fields.Boolean,
    'environment_variables': fields.List(EnvironmentVariableField()),
}
