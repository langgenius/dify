from flask_restx import Resource

from controllers.openapi import openapi_ns


@openapi_ns.route("/_health")
class HealthApi(Resource):
    def get(self):
        return {"ok": True}
