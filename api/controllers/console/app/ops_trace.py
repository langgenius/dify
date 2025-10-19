from flask_restx import Resource, fields, reqparse
from werkzeug.exceptions import BadRequest

from controllers.console import api, console_ns
from controllers.console.app.error import TracingConfigCheckError, TracingConfigIsExist, TracingConfigNotExist
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.ops_service import OpsService


@console_ns.route("/apps/<uuid:app_id>/trace-config")
class TraceAppConfigApi(Resource):
    """
    Manage trace app configurations
    """

    @api.doc("get_trace_app_config")
    @api.doc(description="Get tracing configuration for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.parser().add_argument(
            "tracing_provider", type=str, required=True, location="args", help="Tracing provider name"
        )
    )
    @api.response(
        200, "Tracing configuration retrieved successfully", fields.Raw(description="Tracing configuration data")
    )
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        parser = reqparse.RequestParser().add_argument("tracing_provider", type=str, required=True, location="args")
        args = parser.parse_args()

        try:
            trace_config = OpsService.get_tracing_app_config(app_id=app_id, tracing_provider=args["tracing_provider"])
            if not trace_config:
                return {"has_not_configured": True}
            return trace_config
        except Exception as e:
            raise BadRequest(str(e))

    @api.doc("create_trace_app_config")
    @api.doc(description="Create a new tracing configuration for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "TraceConfigCreateRequest",
            {
                "tracing_provider": fields.String(required=True, description="Tracing provider name"),
                "tracing_config": fields.Raw(required=True, description="Tracing configuration data"),
            },
        )
    )
    @api.response(
        201, "Tracing configuration created successfully", fields.Raw(description="Created configuration data")
    )
    @api.response(400, "Invalid request parameters or configuration already exists")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        """Create a new trace app configuration"""
        parser = (
            reqparse.RequestParser()
            .add_argument("tracing_provider", type=str, required=True, location="json")
            .add_argument("tracing_config", type=dict, required=True, location="json")
        )
        args = parser.parse_args()

        try:
            result = OpsService.create_tracing_app_config(
                app_id=app_id, tracing_provider=args["tracing_provider"], tracing_config=args["tracing_config"]
            )
            if not result:
                raise TracingConfigIsExist()
            if result.get("error"):
                raise TracingConfigCheckError()
            return result
        except Exception as e:
            raise BadRequest(str(e))

    @api.doc("update_trace_app_config")
    @api.doc(description="Update an existing tracing configuration for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "TraceConfigUpdateRequest",
            {
                "tracing_provider": fields.String(required=True, description="Tracing provider name"),
                "tracing_config": fields.Raw(required=True, description="Updated tracing configuration data"),
            },
        )
    )
    @api.response(200, "Tracing configuration updated successfully", fields.Raw(description="Success response"))
    @api.response(400, "Invalid request parameters or configuration not found")
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, app_id):
        """Update an existing trace app configuration"""
        parser = (
            reqparse.RequestParser()
            .add_argument("tracing_provider", type=str, required=True, location="json")
            .add_argument("tracing_config", type=dict, required=True, location="json")
        )
        args = parser.parse_args()

        try:
            result = OpsService.update_tracing_app_config(
                app_id=app_id, tracing_provider=args["tracing_provider"], tracing_config=args["tracing_config"]
            )
            if not result:
                raise TracingConfigNotExist()
            return {"result": "success"}
        except Exception as e:
            raise BadRequest(str(e))

    @api.doc("delete_trace_app_config")
    @api.doc(description="Delete an existing tracing configuration for an application")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.parser().add_argument(
            "tracing_provider", type=str, required=True, location="args", help="Tracing provider name"
        )
    )
    @api.response(204, "Tracing configuration deleted successfully")
    @api.response(400, "Invalid request parameters or configuration not found")
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, app_id):
        """Delete an existing trace app configuration"""
        parser = reqparse.RequestParser().add_argument("tracing_provider", type=str, required=True, location="args")
        args = parser.parse_args()

        try:
            result = OpsService.delete_tracing_app_config(app_id=app_id, tracing_provider=args["tracing_provider"])
            if not result:
                raise TracingConfigNotExist()
            return {"result": "success"}, 204
        except Exception as e:
            raise BadRequest(str(e))
