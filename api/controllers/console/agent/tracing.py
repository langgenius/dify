"""Agent tracing settings address Agent resources, never hidden inline Apps."""

from collections.abc import Callable
from typing import Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import Field
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.rbac import AgentId, PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.console import console_ns
from controllers.console.app.app import AppTracePayload
from controllers.console.app.error import (
    AppNotFoundError,
    InvalidTracingConfigError,
    TracingConfigAlreadyExistsError,
    TracingConfigConflictError,
    TracingConfigNotFoundError,
    TracingConfigProcessingError,
    TracingConfigVerificationFailedError,
    TracingProviderUnavailableError,
    UnsupportedTracingProviderError,
)
from controllers.console.app.ops_trace import TraceAppConfigResponse, TraceConfigPayload, TraceProviderQuery
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission
from extensions.ext_application_services import application_services
from fields.app_fields import AppTraceResponse
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.app.console_service import ConsoleAppNotFoundError
from services.app_tracing_config_service import (
    AppTracingConfigAlreadyExistsError,
    AppTracingConfigAppNotFoundError,
    AppTracingConfigConflictError,
    AppTracingConfigInvalidConfigurationError,
    AppTracingConfigInvalidProviderError,
    AppTracingConfigNotFoundError,
    AppTracingConfigProcessingError,
    AppTracingConfigProviderUnavailableError,
    AppTracingConfigVerificationFailedError,
)
from services.entities.app_entities import AppTraceSettings

_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


class TraceProviderSupportResponse(ResponseModel):
    """Adapter support declarations, not successful-delivery or platform-verification results."""

    provider: str
    agent_spans: bool
    session: bool
    native_usage: bool
    native_cost: bool
    trace_url: bool
    span_url: bool
    export_ack: Literal["accepted"] = Field(description="Exporter acknowledgement does not confirm query visibility")


class TraceProviderCapabilitiesResponse(TraceProviderSupportResponse):
    api_collection_enabled: bool = Field(
        description="Current API collection gate only; does not probe Agent runtime or confirm delivery"
    )


register_response_schema_models(console_ns, TraceProviderSupportResponse, TraceProviderCapabilitiesResponse)


def _tracing_call[T](call: Callable[[], T]) -> T:
    """Translate configuration-domain failures without returning credentials or provider errors."""
    try:
        return call()
    except (AgentAppNotFoundError, ConsoleAppNotFoundError) as error:
        raise NotFound("Agent not found") from error
    except AppTracingConfigAppNotFoundError as error:
        raise AppNotFoundError() from error
    except AppTracingConfigAlreadyExistsError as error:
        raise TracingConfigAlreadyExistsError() from error
    except AppTracingConfigConflictError as error:
        raise TracingConfigConflictError() from error
    except AppTracingConfigNotFoundError as error:
        raise TracingConfigNotFoundError() from error
    except AppTracingConfigInvalidProviderError as error:
        raise UnsupportedTracingProviderError() from error
    except AppTracingConfigProviderUnavailableError as error:
        raise TracingProviderUnavailableError() from error
    except AppTracingConfigInvalidConfigurationError as error:
        raise InvalidTracingConfigError() from error
    except AppTracingConfigVerificationFailedError as error:
        raise TracingConfigVerificationFailedError() from error
    except AppTracingConfigProcessingError as error:
        raise TracingConfigProcessingError() from error


@console_ns.route("/agent/<uuid:agent_id>/trace")
class AgentTraceApi(Resource):
    @console_ns.doc("get_agent_trace")
    @console_ns.response(200, "Agent tracing settings", console_ns.models[AppTraceResponse.__name__])
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_MONITOR, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID):
        settings = _tracing_call(lambda: application_services().agent_tracing_configs.get_trace(context, str(agent_id)))
        return dump_response(AppTraceResponse, settings)

    @error_responses(
        TracingProviderUnavailableError,
        TracingConfigNotFoundError,
        TracingConfigConflictError,
        InvalidTracingConfigError,
        TracingConfigProcessingError,
        UnsupportedTracingProviderError,
    )
    @console_ns.doc("update_agent_trace")
    @console_ns.expect(console_ns.models[AppTracePayload.__name__])
    @console_ns.response(200, "Updated Agent tracing settings", console_ns.models[AppTraceResponse.__name__])
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def post(self, context: RequestContext, agent_id: UUID):
        payload = AppTracePayload.model_validate(console_ns.payload or {})
        settings = AppTraceSettings(**payload.model_dump())
        _tracing_call(lambda: application_services().agent_tracing_configs.set_trace(context, str(agent_id), settings))
        return dump_response(AppTraceResponse, settings)


@console_ns.route("/agent/<uuid:agent_id>/trace-config")
class AgentTraceConfigApi(Resource):
    @error_responses(
        AppNotFoundError, TracingConfigProcessingError, TracingProviderUnavailableError, UnsupportedTracingProviderError
    )
    @console_ns.doc("get_agent_trace_config", params=query_params_from_model(TraceProviderQuery))
    @console_ns.response(200, "Masked Agent provider configuration", console_ns.models[TraceAppConfigResponse.__name__])
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID):
        query = TraceProviderQuery.model_validate(request.args.to_dict(flat=True))
        record = _tracing_call(
            lambda: application_services().agent_tracing_configs.get(context, str(agent_id), query.tracing_provider)
        )
        if record is None:
            return dump_response(TraceAppConfigResponse, {"has_not_configured": True}, exclude_none=True)
        return dump_response(TraceAppConfigResponse, TraceAppConfigResponse.from_record(record), exclude_none=True)

    @error_responses(
        AppNotFoundError,
        InvalidTracingConfigError,
        TracingConfigAlreadyExistsError,
        TracingConfigProcessingError,
        TracingConfigVerificationFailedError,
        TracingProviderUnavailableError,
        UnsupportedTracingProviderError,
    )
    @console_ns.doc("create_agent_trace_config")
    @console_ns.expect(console_ns.models[TraceConfigPayload.__name__])
    @console_ns.response(201, "Agent provider configured", console_ns.models[TraceAppConfigResponse.__name__])
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def post(self, context: RequestContext, agent_id: UUID):
        payload = TraceConfigPayload.model_validate(console_ns.payload or {})
        _tracing_call(
            lambda: application_services().agent_tracing_configs.create(
                context, str(agent_id), payload.tracing_provider, payload.tracing_config, activate=payload.activate
            )
        )
        return dump_response(TraceAppConfigResponse, {"result": "success"}, exclude_none=True), 201

    @error_responses(
        AppNotFoundError,
        InvalidTracingConfigError,
        TracingConfigNotFoundError,
        TracingConfigConflictError,
        TracingConfigProcessingError,
        TracingConfigVerificationFailedError,
        TracingProviderUnavailableError,
        UnsupportedTracingProviderError,
    )
    @console_ns.doc("update_agent_trace_config")
    @console_ns.expect(console_ns.models[TraceConfigPayload.__name__])
    @console_ns.response(200, "Agent provider updated", console_ns.models[TraceAppConfigResponse.__name__])
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def patch(self, context: RequestContext, agent_id: UUID):
        payload = TraceConfigPayload.model_validate(console_ns.payload or {})
        _tracing_call(
            lambda: application_services().agent_tracing_configs.update(
                context, str(agent_id), payload.tracing_provider, payload.tracing_config, activate=payload.activate
            )
        )
        return dump_response(TraceAppConfigResponse, {"result": "success"}, exclude_none=True)

    @error_responses(
        AppNotFoundError, TracingConfigNotFoundError, TracingConfigProcessingError, UnsupportedTracingProviderError
    )
    @console_ns.doc("delete_agent_trace_config", params=query_params_from_model(TraceProviderQuery))
    @console_ns.response(204, "Agent provider configuration deleted")
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def delete(self, context: RequestContext, agent_id: UUID):
        query = TraceProviderQuery.model_validate(request.args.to_dict(flat=True))
        _tracing_call(
            lambda: application_services().agent_tracing_configs.delete(context, str(agent_id), query.tracing_provider)
        )
        return "", 204


def _provider_capabilities():
    from services.tracing.provider_dispatch import provider_capabilities

    query = TraceProviderQuery.model_validate(request.args.to_dict(flat=True))
    try:
        capabilities = provider_capabilities(query.tracing_provider)
    except ValueError as error:
        raise UnsupportedTracingProviderError() from error
    return dump_response(
        TraceProviderCapabilitiesResponse,
        {**capabilities, "api_collection_enabled": dify_config.OPS_AGENT_TRACE_ENABLED},
    )


@console_ns.route("/agent/<uuid:agent_id>/trace-capabilities")
class AgentTraceCapabilitiesApi(Resource):
    @error_responses(UnsupportedTracingProviderError)
    @console_ns.doc("get_agent_trace_capabilities", params=query_params_from_model(TraceProviderQuery))
    @console_ns.response(
        200, "Provider support declarations", console_ns.models[TraceProviderCapabilitiesResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_MONITOR, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID):
        _tracing_call(lambda: application_services().agent_tracing_configs.get_trace(context, str(agent_id)))
        return _provider_capabilities()


@console_ns.route("/apps/<uuid:app_id>/trace-capabilities")
class AppTraceCapabilitiesApi(Resource):
    @error_responses(UnsupportedTracingProviderError)
    @console_ns.doc("get_app_trace_capabilities", params=query_params_from_model(TraceProviderQuery))
    @console_ns.response(
        200, "Provider support declarations", console_ns.models[TraceProviderCapabilitiesResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_MONITOR, PlainApp())])
    def get(self, context: RequestContext, app_id: UUID):
        try:
            application_services().apps.console.get_trace(context, str(app_id))
        except ConsoleAppNotFoundError as error:
            raise NotFound("App not found") from error
        return _provider_capabilities()
