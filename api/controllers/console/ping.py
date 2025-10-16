from flask.views import MethodView
from flask_restx import fields

from . import api, console_ns


@console_ns.route("/ping")
class PingApi(MethodView):
    @api.doc("health_check")
    @api.doc(description="Health check endpoint for connection testing")
    @api.response(
        200,
        "Success",
        api.model("PingResponse", {"result": fields.String(description="Health check result", example="pong")}),
    )
    def get(self):
        """Health check endpoint for connection testing"""
        return {"result": "pong"}
