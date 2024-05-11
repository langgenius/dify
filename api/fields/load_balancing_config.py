from flask_restful import fields

load_balancing_config_fields = {
    'id': fields.String,
    'name': fields.String,
    'enabled': fields.Boolean
}


load_balancing_config_list_fields = {
    'data': fields.List(fields.Nested(load_balancing_config_fields))
}
