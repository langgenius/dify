from flask_restx import Resource

from controllers.openapi import openapi_ns
from controllers.openapi._contract import returns
from controllers.openapi._models import HealthResponse


@openapi_ns.route("/_health")
class HealthApi(Resource):
    @returns(200, HealthResponse, description="Health check")
    def get(self):
        return HealthResponse(ok=True)
