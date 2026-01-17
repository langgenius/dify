from flask_restx import Resource, fields

from . import console_ns


@console_ns.route("/ping")
class PingApi(Resource):
    @console_ns.doc("health_check")
    @console_ns.doc(description="Health check endpoint for connection testing")
    @console_ns.response(
        200,
        "Success",
        console_ns.model("PingResponse", {"result": fields.String(description="Health check result", example="pong")}),
    )
    def get(self):
        """Health check endpoint for connection testing"""
        return {"result": "pong"}
