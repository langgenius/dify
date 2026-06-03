from flask_restx import Resource
from pydantic import Field

from controllers.common.schema import register_response_schema_models
from fields.base import ResponseModel
from libs.helper import dump_response

from . import console_ns


class PingResponse(ResponseModel):
    result: str = Field(description="Health check result", examples=["pong"])


register_response_schema_models(console_ns, PingResponse)


def ping() -> PingResponse:
    """Health check endpoint for connection testing."""
    return PingResponse(result="pong")


@console_ns.route("/ping")
class PingApi(Resource):
    @console_ns.doc("health_check")
    @console_ns.doc(description="Health check endpoint for connection testing")
    @console_ns.response(200, "Success", console_ns.models[PingResponse.__name__])
    def get(self):
        """Health check endpoint for connection testing."""
        return dump_response(PingResponse, ping())
