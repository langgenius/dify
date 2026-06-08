from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._models import HealthResponse


@openapi_ns.route("/_health")
class HealthApi(Resource):
    @openapi_ns.response(200, "Health check", openapi_ns.models[HealthResponse.__name__])
    def get(self):
        return {"ok": True}
