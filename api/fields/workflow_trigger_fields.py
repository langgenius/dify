from flask_restx import fields

trigger_fields = {
    "id": fields.String,
    "trigger_type": fields.String,
    "title": fields.String,
    "node_id": fields.String,
    "provider_name": fields.String,
    "icon": fields.String,
    "status": fields.String,
    "created_at": fields.DateTime(dt_format="iso8601"),
    "updated_at": fields.DateTime(dt_format="iso8601"),
}

triggers_list_fields = {"data": fields.List(fields.Nested(trigger_fields))}


webhook_trigger_fields = {
    "id": fields.String,
    "webhook_id": fields.String,
    "webhook_url": fields.String,
    "webhook_debug_url": fields.String,
    "node_id": fields.String,
    "created_at": fields.DateTime(dt_format="iso8601"),
}
