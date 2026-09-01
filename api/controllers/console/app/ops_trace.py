from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.error import (
    AppNotFoundError,
    InvalidTracingConfigError,
    TracingConfigAlreadyExistsError,
    TracingConfigNotFoundError,
    TracingConfigProcessingError,
    TracingConfigVerificationFailedError,
    UnsupportedTracingProviderError,
)
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app_tracing_config_service import (
    AppTracingConfigAlreadyExistsError,
    AppTracingConfigAppNotFoundError,
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigNotFoundError,
    AppTracingConfigProcessingError,
    AppTracingConfigRecord,
    AppTracingConfigVerificationFailedError,
)

_APP_TRACING_CONFIG_EDIT_ROLES = frozenset(
    {
        TenantAccountRole.OWNER,
        TenantAccountRole.ADMIN,
        TenantAccountRole.EDITOR,
    }
)


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

    @classmethod
    def from_record(cls, record: AppTracingConfigRecord) -> "TraceAppConfigResponse":
        return cls(
            id=record.id,
            app_id=record.app_id,
            tracing_provider=record.tracing_provider,
            tracing_config=record.tracing_config,
            is_active=record.is_active,
            created_at=str(record.created_at),
            updated_at=str(record.updated_at),
        )


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
    @console_ns.response(400, "Invalid request parameters or unsupported tracing provider")
    @console_ns.response(404, "Application not found")
    @console_ns.response(500, "Tracing configuration processing failed")
    @console_account_admission(
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_TRACING_CONFIG,
    )
    @model_validate(TraceProviderQuery)
    def get(
        self,
        req_data: TraceProviderQuery,
        request_context: RequestContext,
        app_id: UUID,
    ):
        try:
            trace_config = application_services().app_tracing_configs.get(
                context=request_context,
                app_id=str(app_id),
                tracing_provider=req_data.tracing_provider,
            )
        except AppTracingConfigAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppTracingConfigInvalidProviderError as error:
            raise UnsupportedTracingProviderError() from error
        except AppTracingConfigProcessingError as error:
            raise TracingConfigProcessingError() from error
        except ValueError as error:
            raise TracingConfigProcessingError() from error

        if trace_config is None:
            return dump_response(TraceAppConfigResponse, {"has_not_configured": True}, exclude_none=True)
        return dump_response(
            TraceAppConfigResponse,
            TraceAppConfigResponse.from_record(trace_config),
            exclude_none=True,
        )

    @console_ns.doc("create_trace_app_config")
    @console_ns.doc(description="Create a new tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[TraceConfigPayload.__name__])
    @console_ns.response(
        200,
        "Tracing configuration created successfully",
        console_ns.models[TraceAppConfigResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters or tracing configuration")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Application not found")
    @console_ns.response(409, "Tracing configuration already exists")
    @console_ns.response(500, "Tracing configuration processing failed")
    @console_account_admission(
        allowed_roles=_APP_TRACING_CONFIG_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_TRACING_CONFIG,
    )
    @model_validate(TraceConfigPayload)
    def post(
        self,
        req_data: TraceConfigPayload,
        request_context: RequestContext,
        app_id: UUID,
    ):
        """Create a new trace app configuration"""
        try:
            application_services().app_tracing_configs.create(
                context=request_context,
                app_id=str(app_id),
                tracing_provider=req_data.tracing_provider,
                tracing_config=req_data.tracing_config,
            )
        except AppTracingConfigAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppTracingConfigAlreadyExistsError as error:
            raise TracingConfigAlreadyExistsError() from error
        except AppTracingConfigInvalidProviderError as error:
            raise UnsupportedTracingProviderError() from error
        except AppTracingConfigInvalidConfigurationError as error:
            raise InvalidTracingConfigError() from error
        except AppTracingConfigVerificationFailedError as error:
            raise TracingConfigVerificationFailedError() from error
        except AppTracingConfigProcessingError as error:
            raise TracingConfigProcessingError() from error
        except ValueError as error:
            raise TracingConfigProcessingError() from error

        return dump_response(TraceAppConfigResponse, {"result": "success"}, exclude_none=True)

    @console_ns.doc("update_trace_app_config")
    @console_ns.doc(description="Update an existing tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[TraceConfigPayload.__name__])
    @console_ns.response(
        200,
        "Tracing configuration updated successfully",
        console_ns.models[TraceAppConfigResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters or tracing configuration")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Application or tracing configuration not found")
    @console_ns.response(500, "Tracing configuration processing failed")
    @console_account_admission(
        allowed_roles=_APP_TRACING_CONFIG_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_TRACING_CONFIG,
    )
    @model_validate(TraceConfigPayload)
    def patch(
        self,
        req_data: TraceConfigPayload,
        request_context: RequestContext,
        app_id: UUID,
    ):
        """Update an existing trace app configuration"""
        try:
            application_services().app_tracing_configs.update(
                context=request_context,
                app_id=str(app_id),
                tracing_provider=req_data.tracing_provider,
                tracing_config=req_data.tracing_config,
            )
        except AppTracingConfigAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppTracingConfigNotFoundError as error:
            raise TracingConfigNotFoundError() from error
        except AppTracingConfigInvalidProviderError as error:
            raise UnsupportedTracingProviderError() from error
        except AppTracingConfigInvalidConfigurationError as error:
            raise InvalidTracingConfigError() from error
        except AppTracingConfigVerificationFailedError as error:
            raise TracingConfigVerificationFailedError() from error
        except AppTracingConfigProcessingError as error:
            raise TracingConfigProcessingError() from error
        except ValueError as error:
            raise TracingConfigProcessingError() from error

        return dump_response(TraceAppConfigResponse, {"result": "success"}, exclude_none=True)

    @console_ns.doc("delete_trace_app_config")
    @console_ns.doc(description="Delete an existing tracing configuration for an application")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.doc(params=query_params_from_model(TraceProviderQuery))
    @console_ns.response(204, "Tracing configuration deleted successfully")
    @console_ns.response(400, "Invalid request parameters or unsupported tracing provider")
    @console_ns.response(403, "Insufficient permissions")
    @console_ns.response(404, "Application or tracing configuration not found")
    @console_ns.response(500, "Tracing configuration processing failed")
    @console_account_admission(
        allowed_roles=_APP_TRACING_CONFIG_EDIT_ROLES,
        rbac_resource_scope=RBACResourceScope.APP,
        rbac_permission=RBACPermission.APP_TRACING_CONFIG,
    )
    @model_validate(TraceProviderQuery)
    def delete(
        self,
        req_data: TraceProviderQuery,
        request_context: RequestContext,
        app_id: UUID,
    ):
        """Delete an existing trace app configuration"""
        try:
            application_services().app_tracing_configs.delete(
                context=request_context,
                app_id=str(app_id),
                tracing_provider=req_data.tracing_provider,
            )
        except AppTracingConfigAppNotFoundError as error:
            raise AppNotFoundError() from error
        except AppTracingConfigNotFoundError as error:
            raise TracingConfigNotFoundError() from error
        except AppTracingConfigInvalidProviderError as error:
            raise UnsupportedTracingProviderError() from error
        except AppTracingConfigProcessingError as error:
            raise TracingConfigProcessingError() from error
        except ValueError as error:
            raise TracingConfigProcessingError() from error

        return "", 204
