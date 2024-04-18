from flask_restful import fields

from libs.helper import TimestampField

app_fields = {
    'id': fields.String,
    'name': fields.String,
    'mode': fields.String,
    'icon': fields.String,
    'icon_background': fields.String
}

installed_app_fields = {
    'id': fields.String,
    'app': fields.Nested(app_fields),
    'app_owner_tenant_id': fields.String,
    'is_pinned': fields.Boolean,
    'last_used_at': TimestampField,
    'editable': fields.Boolean,
    'uninstallable': fields.Boolean
}

installed_app_list_fields = {
    'installed_apps': fields.List(fields.Nested(installed_app_fields))
}