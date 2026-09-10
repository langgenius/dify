"""Unauthenticated health and version probes for the OpenAPI surface."""

from flask_restx import Resource

from configs import dify_config
from controllers.openapi import openapi_ns
from controllers.openapi._contract import returns
from controllers.openapi._models import HealthResponse, ServerVersionResponse


@openapi_ns.route("/_health")
class HealthApi(Resource):
    @returns(200, HealthResponse, description="Health check")
    def get(self):
        return HealthResponse(ok=True)


@openapi_ns.route("/_version")
class VersionApi(Resource):
    @returns(200, ServerVersionResponse, description="Server version")
    def get(self):
        return ServerVersionResponse(
            version=dify_config.project.version,
            edition=dify_config.DEPLOYMENT_EDITION,
        )
