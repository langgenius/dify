"""Console transport for owned external observations and asset tracing targets."""

from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, Gone, NotFound

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import RequestContext
from services.app_tracing_config_service import AppTracingConfigError
from services.external_agents.observability import (
    MonitoringQuery,
    ObservationAccessDeniedError,
    ObservationConflictError,
    ObservationExpiredError,
    ObservationNotFoundError,
    TraceQuery,
)


class ExternalTraceStepResponse(ResponseModel):
    key: str
    trace_path: tuple[str, ...]
    trace_id: str
    step_id: str
    parent_step_id: str | None
    resolved_parent_key: str | None
    kind: str | None
    name: str | None
    started_at: datetime | None
    ended_at: datetime | None
    duration_seconds: float | None
    status: str | None
    error: str | None
    total_tokens: int | None


class ExternalTraceResponse(ResponseModel):
    invocation_id: str
    state: str
    revision: int
    received_steps: int
    steps: tuple[ExternalTraceStepResponse, ...]
    next_offset: int | None
    diagnostics: tuple[str, ...]


class ExternalTraceRawResponse(ResponseModel):
    data: dict[str, Any]


class ExternalMetricValuesResponse(ResponseModel):
    calls: int
    average_call_duration: float | None
    reported_tokens: int | None
    token_reporting_numerator: int
    token_reporting_denominator: int
    token_reporting_coverage: float | None


class ExternalMetricDayResponse(ResponseModel):
    date: date
    metrics: ExternalMetricValuesResponse


class ExternalMonitoringResponse(ResponseModel):
    summary: ExternalMetricValuesResponse
    days: tuple[ExternalMetricDayResponse, ...]
    apps: tuple[dict[str, str], ...] | None = Field(default=None, exclude_if=lambda value: value is None)


class ExternalTracingConfigPayload(BaseModel):
    config: dict[str, Any]
    enabled: bool
    capture_content: bool
    expected_revision: int = Field(ge=0)

    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class ExternalTracingRevisionQuery(BaseModel):
    expected_revision: int = Field(ge=1)

    model_config = ConfigDict(extra="forbid")


class ExternalTracingConfigurationResponse(ResponseModel):
    provider: str
    revision: int
    enabled: bool
    capture_content: bool
    values: dict[str, Any]
    configured_secrets: tuple[str, ...]


class ExternalTracingConfigEnvelopeResponse(ResponseModel):
    configuration: ExternalTracingConfigurationResponse | None


class ExternalTracingProviderStateResponse(ResponseModel):
    provider: str
    revision: int
    enabled: bool
    capture_content: bool


class ExternalTracingProviderOverviewResponse(ResponseModel):
    enabled_provider: str | None
    providers: tuple[ExternalTracingProviderStateResponse, ...]


class ExternalTraceDeliveryStatusResponse(ResponseModel):
    id: str
    target_kind: str
    target_id: str
    provider: str
    config_revision: str
    payload_revision: int
    state: str
    attempts: int
    error_code: str | None
    trace_url: str | None


class ExternalTraceDeliveryListResponse(ResponseModel):
    data: tuple[ExternalTraceDeliveryStatusResponse, ...]


class ExternalTraceRetryPayload(BaseModel):
    acknowledge_possible_duplicates: bool = False

    model_config = ConfigDict(extra="forbid")


register_schema_models(
    console_ns,
    MonitoringQuery,
    TraceQuery,
    ExternalTracingConfigPayload,
    ExternalTracingRevisionQuery,
    ExternalTraceRetryPayload,
)
register_response_schema_models(
    console_ns,
    ExternalTraceResponse,
    ExternalTraceRawResponse,
    ExternalMonitoringResponse,
    ExternalTracingConfigurationResponse,
    ExternalTracingConfigEnvelopeResponse,
    ExternalTracingProviderOverviewResponse,
    ExternalTraceDeliveryListResponse,
)


def _call[T](operation: Callable[[], T]) -> T:
    try:
        return operation()
    except ObservationAccessDeniedError as error:
        raise Forbidden(str(error)) from error
    except ObservationNotFoundError as error:
        raise NotFound(str(error)) from error
    except ObservationExpiredError as error:
        raise Gone(str(error)) from error
    except ObservationConflictError as error:
        raise Conflict(str(error)) from error
    except AppTracingConfigError as error:
        raise BadRequest(str(error)) from error


@console_ns.route("/external-agents/<uuid:agent_id>/monitoring")
class ExternalAgentMonitoringApi(Resource):
    @console_ns.doc("external_agent_monitoring", params=query_params_from_model(MonitoringQuery))
    @console_ns.response(
        200,
        "Production dispatch metrics under one authorized scope",
        console_ns.models[ExternalMonitoringResponse.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext, agent_id: UUID):
        query = MonitoringQuery.model_validate(request.args.to_dict(flat=True))
        result = _call(
            lambda: application_services().external_agents.observability.monitoring(
                context, str(agent_id), query, now=datetime.now(UTC)
            )
        )
        return dump_response(ExternalMonitoringResponse, result)


@console_ns.route("/external-agent-invocations/<uuid:invocation_id>/trace")
class ExternalAgentInvocationTraceApi(Resource):
    @console_ns.doc("external_agent_invocation_trace", params=query_params_from_model(TraceQuery))
    @console_ns.response(200, "Owned nullable external steps", console_ns.models[ExternalTraceResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext, invocation_id: UUID):
        query = TraceQuery.model_validate(request.args.to_dict(flat=True))
        result = _call(
            lambda: application_services().external_agents.observability.trace(
                context, str(invocation_id), query, now=datetime.now(UTC)
            )
        )
        return dump_response(ExternalTraceResponse, result)


@console_ns.route("/external-agent-invocations/<uuid:invocation_id>/trace/steps/<string:step_key>")
class ExternalAgentInvocationTraceRawApi(Resource):
    @console_ns.doc("external_agent_invocation_trace_raw")
    @console_ns.response(
        200, "Same-record authorized redacted Raw data", console_ns.models[ExternalTraceRawResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, invocation_id: UUID, step_key: str):
        result = _call(
            lambda: application_services().external_agents.observability.raw_data(
                context, str(invocation_id), step_key, now=datetime.now(UTC)
            )
        )
        return dump_response(ExternalTraceRawResponse, {"data": result})


@console_ns.route("/external-agents/<uuid:agent_id>/tracing-config")
class ExternalAgentTracingProviderOverviewApi(Resource):
    @console_ns.doc("external_agent_tracing_provider_overview")
    @console_ns.response(
        200,
        "Owner-only configured provider states without configuration values or secrets",
        console_ns.models[ExternalTracingProviderOverviewResponse.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext, agent_id: UUID):
        result = _call(lambda: application_services().external_agents.tracing_configs.overview(context, str(agent_id)))
        return dump_response(ExternalTracingProviderOverviewResponse, result)


@console_ns.route("/external-agents/<uuid:agent_id>/tracing-config/<string:provider>")
class ExternalAgentTracingConfigApi(Resource):
    @console_ns.doc("external_agent_tracing_config")
    @console_ns.response(
        200,
        "Write-only-secret external asset target",
        console_ns.models[ExternalTracingConfigEnvelopeResponse.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext, agent_id: UUID, provider: str):
        result = _call(
            lambda: application_services().external_agents.tracing_configs.get(context, str(agent_id), provider)
        )
        return dump_response(ExternalTracingConfigEnvelopeResponse, {"configuration": result})

    @console_ns.doc("save_external_agent_tracing_config")
    @console_ns.expect(console_ns.models[ExternalTracingConfigPayload.__name__])
    @console_ns.response(
        200,
        "Verified target saved under owner and revision checks",
        console_ns.models[ExternalTracingConfigurationResponse.__name__],
    )
    @console_account_admission()
    def put(self, context: RequestContext, agent_id: UUID, provider: str):
        payload = ExternalTracingConfigPayload.model_validate(console_ns.payload or {})
        result = _call(
            lambda: application_services().external_agents.tracing_configs.save(
                context, str(agent_id), provider=provider, **payload.model_dump(), now=datetime.now(UTC)
            )
        )
        return dump_response(ExternalTracingConfigurationResponse, result)

    @console_ns.doc(
        "delete_external_agent_tracing_config", params=query_params_from_model(ExternalTracingRevisionQuery)
    )
    @console_ns.response(204, "Current external target configuration removed")
    @console_account_admission()
    def delete(self, context: RequestContext, agent_id: UUID, provider: str):
        query = ExternalTracingRevisionQuery.model_validate(request.args.to_dict(flat=True))
        _call(
            lambda: application_services().external_agents.tracing_configs.delete(
                context, str(agent_id), provider, query.expected_revision
            )
        )
        return "", 204


@console_ns.route("/external-agent-invocations/<uuid:invocation_id>/trace-deliveries")
class ExternalAgentTraceDeliveriesApi(Resource):
    @console_ns.doc("external_agent_trace_deliveries")
    @console_ns.response(
        200,
        "Independent frozen destination delivery states",
        console_ns.models[ExternalTraceDeliveryListResponse.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext, invocation_id: UUID):
        result = _call(
            lambda: application_services().external_agents.trace_delivery.statuses(
                context, str(invocation_id), now=datetime.now(UTC)
            )
        )
        return dump_response(ExternalTraceDeliveryListResponse, {"data": result})


@console_ns.route("/external-agent-invocations/<uuid:invocation_id>/trace-deliveries/<uuid:delivery_id>/retry")
class ExternalAgentTraceDeliveryRetryApi(Resource):
    @console_ns.doc("retry_external_agent_trace_delivery")
    @console_ns.expect(console_ns.models[ExternalTraceRetryPayload.__name__])
    @console_ns.response(204, "The same frozen delivery payload was requeued")
    @console_account_admission()
    def post(self, context: RequestContext, invocation_id: UUID, delivery_id: UUID):
        payload = ExternalTraceRetryPayload.model_validate(console_ns.payload or {})
        _call(
            lambda: application_services().external_agents.trace_delivery.retry(
                context,
                str(invocation_id),
                str(delivery_id),
                acknowledge_possible_duplicates=payload.acknowledge_possible_duplicates,
                now=datetime.now(UTC),
            )
        )
        return "", 204
