import json

from flask_restful import fields

from fields.member_fields import simple_account_fields
from libs.helper import TimestampField

workflow_fields = {
    'id': fields.String,
    'graph': fields.Raw(attribute=lambda x: json.loads(x.graph) if hasattr(x, 'graph') else None),
    'created_by': fields.Nested(simple_account_fields, attribute='created_by_account'),
    'created_at': TimestampField,
    'updated_by': fields.Nested(simple_account_fields, attribute='updated_by_account', allow_null=True),
    'updated_at': TimestampField
}

workflow_run_fields = {
    "id": fields.String,
    "version": fields.String,
    "status": fields.String,
    "error": fields.String,
    "elapsed_time": fields.Float,
    "total_tokens": fields.Integer,
    "total_price": fields.Float,
    "currency": fields.String,
    "total_steps": fields.Integer,
    "finished_at": TimestampField
}