from flask_restful import fields  # type: ignore

tag_fields = {"id": fields.String, "name": fields.String, "type": fields.String, "binding_count": fields.String}
