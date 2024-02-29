from flask_restful import fields

from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

workflow_fields = {
    'id': fields.String,
    'graph': fields.Nested(simple_account_fields, attribute='graph_dict'),
    'features': fields.Nested(simple_account_fields, attribute='features_dict'),
    'created_by': fields.Nested(simple_account_fields, attribute='created_by_account'),
    'created_at': TimestampField,
    'updated_by': fields.Nested(simple_account_fields, attribute='updated_by_account', allow_null=True),
    'updated_at': TimestampField
}
