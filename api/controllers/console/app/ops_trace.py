from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import BadRequest

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import TracingConfigCheckError, TracingConfigIsExist, TracingConfigNotExist
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    rbac_permission_required,
    setup_required,
)
from fields.base import ResponseModel
from libs.login import login_required
from models import App
from services.ops_service import OpsService


class TraceProviderQuery(BaseModel):
    tracing_provider: str = Field(..., description="Tracing provider name")


class TraceConfigPayload(BaseModel):
    tracing_provider: str = Field(..., description="Tracing provider name")
    tracing_config: dict[str, Any] = Field(
        ...,
        description="Tracing configuration data",
    )


class TraceAppConfigResponse(ResponseModel):
    result: str | None = None
    error: str | None = None
    has_not_configured: bool | None = None
    id: str | None = None
    app_id: str | None = None
    tracing_provider: str | None = None
    tracing_config: dict[str, Any] | None = Field(default=None)
    is_active: bool | None = None
    created_at: str | None = None
    updated_at: str | None = None


register_schema_models(console_ns, TraceProviderQuery, TraceConfigPayload)
register_response_schema_models(console_ns, TraceAppConfigResponse)


@console_ns.route("/apps/<uuid:app_id>/trace-config")
class TraceAppConfigApi(Resource):
    """
    Manage trace app configurations
    """

    @console_ns.doc("get_trace_app_config")
    @console_ns.doc(description="Get tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(TraceProviderQuery))
    @console_ns.response(
        200,
        "Tracing configuration retrieved successfully",
        console_ns.models[TraceAppConfigResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_MONITOR)
    @get_app_model
    def get(self, app_model: App):
        args = TraceProviderQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        try:
            trace_config = OpsService.get_tracing_app_config(
                app_id=app_model.id, tracing_provider=args.tracing_provider
            )
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
        201,
        "Tracing configuration created successfully",
        console_ns.models[TraceAppConfigResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters or configuration already exists")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def post(self, app_model: App):
        """Create a new trace app configuration"""
        args = TraceConfigPayload.model_validate(console_ns.payload)

        try:
            result = OpsService.create_tracing_app_config(
                app_id=app_model.id, tracing_provider=args.tracing_provider, tracing_config=args.tracing_config
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
    @console_ns.response(
        200,
        "Tracing configuration updated successfully",
        console_ns.models[TraceAppConfigResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters or configuration not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def patch(self, app_model: App):
        """Update an existing trace app configuration"""
        args = TraceConfigPayload.model_validate(console_ns.payload)

        try:
            result = OpsService.update_tracing_app_config(
                app_id=app_model.id, tracing_provider=args.tracing_provider, tracing_config=args.tracing_config
            )
            if not result:
                raise TracingConfigNotExist()
            return {"result": "success"}
        except Exception as e:
            raise BadRequest(str(e))

    @console_ns.doc("delete_trace_app_config")
    @console_ns.doc(description="Delete an existing tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(TraceProviderQuery))
    @console_ns.response(204, "Tracing configuration deleted successfully")
    @console_ns.response(400, "Invalid request parameters or configuration not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model
    def delete(self, app_model: App):
        """Delete an existing trace app configuration"""
        args = TraceProviderQuery.model_validate(request.args.to_dict(flat=True))

        try:
            result = OpsService.delete_tracing_app_config(app_id=app_model.id, tracing_provider=args.tracing_provider)
            if not result:
                raise TracingConfigNotExist()
            return "", 204
        except Exception as e:
            raise BadRequest(str(e))
