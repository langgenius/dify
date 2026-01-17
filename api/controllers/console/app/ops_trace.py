from typing import Any

from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field
from werkzeug.exceptions import BadRequest

from controllers.console import console_ns
from controllers.console.app.error import TracingConfigCheckError, TracingConfigIsExist, TracingConfigNotExist
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.ops_service import OpsService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class TraceProviderQuery(BaseModel):
    tracing_provider: str = Field(..., description="Tracing provider name")


class TraceConfigPayload(BaseModel):
    tracing_provider: str = Field(..., description="Tracing provider name")
    tracing_config: dict[str, Any] = Field(..., description="Tracing configuration data")


console_ns.schema_model(
    TraceProviderQuery.__name__,
    TraceProviderQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0),
)
console_ns.schema_model(
    TraceConfigPayload.__name__, TraceConfigPayload.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0)
)


@console_ns.route("/apps/<uuid:app_id>/trace-config")
class TraceAppConfigApi(Resource):
    """
    Manage trace app configurations
    """

    @console_ns.doc("get_trace_app_config")
    @console_ns.doc(description="Get tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[TraceProviderQuery.__name__])
    @console_ns.response(
        200, "Tracing configuration retrieved successfully", fields.Raw(description="Tracing configuration data")
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, app_id):
        args = TraceProviderQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            trace_config = OpsService.get_tracing_app_config(app_id=app_id, tracing_provider=args.tracing_provider)
            if not trace_config:
                return {"has_not_configured": True}
            return trace_config
        except Exception as e:
            raise BadRequest(str(e))

    @console_ns.doc("create_trace_app_config")
    @console_ns.doc(description="Create a new tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[TraceConfigPayload.__name__])
    @console_ns.response(
        201, "Tracing configuration created successfully", fields.Raw(description="Created configuration data")
    )
    @console_ns.response(400, "Invalid request parameters or configuration already exists")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, app_id):
        """Create a new trace app configuration"""
        args = TraceConfigPayload.model_validate(console_ns.payload)

        try:
            result = OpsService.create_tracing_app_config(
                app_id=app_id, tracing_provider=args.tracing_provider, tracing_config=args.tracing_config
            )
            if not result:
                raise TracingConfigIsExist()
            if result.get("error"):
                raise TracingConfigCheckError()
            return result
        except Exception as e:
            raise BadRequest(str(e))

    @console_ns.doc("update_trace_app_config")
    @console_ns.doc(description="Update an existing tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[TraceConfigPayload.__name__])
    @console_ns.response(200, "Tracing configuration updated successfully", fields.Raw(description="Success response"))
    @console_ns.response(400, "Invalid request parameters or configuration not found")
    @setup_required
    @login_required
    @account_initialization_required
    def patch(self, app_id):
        """Update an existing trace app configuration"""
        args = TraceConfigPayload.model_validate(console_ns.payload)

        try:
            result = OpsService.update_tracing_app_config(
                app_id=app_id, tracing_provider=args.tracing_provider, tracing_config=args.tracing_config
            )
            if not result:
                raise TracingConfigNotExist()
            return {"result": "success"}
        except Exception as e:
            raise BadRequest(str(e))

    @console_ns.doc("delete_trace_app_config")
    @console_ns.doc(description="Delete an existing tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[TraceProviderQuery.__name__])
    @console_ns.response(204, "Tracing configuration deleted successfully")
    @console_ns.response(400, "Invalid request parameters or configuration not found")
    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, app_id):
        """Delete an existing trace app configuration"""
        args = TraceProviderQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            result = OpsService.delete_tracing_app_config(app_id=app_id, tracing_provider=args.tracing_provider)
            if not result:
                raise TracingConfigNotExist()
            return {"result": "success"}, 204
        except Exception as e:
            raise BadRequest(str(e))
