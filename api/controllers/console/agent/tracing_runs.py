"""Authorized trace delivery status and explicit retries of frozen destinations."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator
from werkzeug.exceptions import NotFound

from controllers.common.rbac import AgentId, PlainApp, RBACCheck
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.agent.tracing import TraceProviderSupportResponse
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from repositories.application_trace_repository import TraceCollectionError
from services.app.agent_app_contracts import AgentAppNotFoundError
from services.tracing.service import application_tracing_service

type TraceSourceKind = Literal["message", "workflow", "node"]
_source_kind_adapter = TypeAdapter(TraceSourceKind)
_EDIT_ROLES = frozenset({TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR})


class TraceRunQuery(BaseModel):
    node_execution_id: UUID | None = Field(default=None, description="Select an Agent node invocation within this run")


class TraceRunRetryPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    acknowledge_possible_duplicates: bool = Field(
        default=False,
        strict=True,
        description="Acknowledge possible duplicate records when retrying an uncertain export",
    )


class TraceRunStatusResponse(ResponseModel):
    status: Literal["not_collected", "collecting", "ready", "exporting", "retrying", "accepted", "failed", "uncertain"]
    source_kind: TraceSourceKind
    source_id: str
    provider: str | None = None
    trace_id: str | None = None
    trace_url: str | None = None
    span_url: str | None = None
    config_revision: str | None = Field(default=None, description="Frozen destination configuration revision")
    capture_content: bool | None = None
    capture_agent: bool | None = None
    span_count: int | None = None
    attempts: int | None = None
    error_code: str | None = None
    accepted_at: datetime | None = Field(
        default=None, description="Ingestion acknowledgement time, not query visibility"
    )
    queryable: bool | None = Field(default=None, description="Null when third-party query visibility is not verified")
    capabilities: TraceProviderSupportResponse | None = None

    @field_validator("accepted_at")
    @classmethod
    def serialize_database_time_as_utc(cls, value: datetime | None) -> datetime | None:
        # Database timestamps are naive UTC. Emit a timezone so the generated
        # ISO datetime contract and browser parsing agree on the same instant.
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class TraceSourceNotFoundError(BaseHTTPException):
    error_code = "tracing_source_not_found"
    code = 404
    description = "The tracing source does not exist in this application."


class TraceNodeNotFoundError(BaseHTTPException):
    error_code = "tracing_node_not_found"
    code = 404
    description = "The Agent node invocation does not belong to this trace."


class TraceRunNotFoundError(BaseHTTPException):
    error_code = "tracing_run_not_found"
    code = 404
    description = "No collected trace is available to retry."


class TraceAlreadyAcceptedError(BaseHTTPException):
    error_code = "tracing_already_accepted"
    code = 409
    description = "An accepted trace cannot be exported again."


class TraceRetryNotAllowedError(BaseHTTPException):
    error_code = "tracing_retry_not_allowed"
    code = 409
    description = "This trace is not in a retryable state."


class TraceDuplicateAcknowledgementRequiredError(BaseHTTPException):
    error_code = "tracing_duplicate_acknowledgement_required"
    code = 409
    description = "Acknowledge possible duplicates before retrying an uncertain export."


_TRACE_ERRORS: dict[str, type[BaseHTTPException]] = {
    cls.error_code: cls
    for cls in (
        TraceSourceNotFoundError,
        TraceNodeNotFoundError,
        TraceRunNotFoundError,
        TraceAlreadyAcceptedError,
        TraceRetryNotAllowedError,
        TraceDuplicateAcknowledgementRequiredError,
    )
}

register_schema_models(console_ns, TraceRunQuery, TraceRunRetryPayload)
register_response_schema_models(console_ns, TraceRunStatusResponse)


def _run_call[T](call: Callable[[], T]) -> T:
    try:
        return call()
    except AgentAppNotFoundError as error:
        raise NotFound("Agent not found") from error
    except TraceCollectionError as error:
        if error_type := _TRACE_ERRORS.get(error.code):
            raise error_type() from error
        raise


def _query_node_id() -> str | None:
    query = TraceRunQuery.model_validate(request.args.to_dict(flat=True))
    return str(query.node_execution_id) if query.node_execution_id else None


def _agent_app_id(context: RequestContext, agent_id: UUID) -> str:
    return _run_call(lambda: application_services().agent_tracing_configs.resolve_app_id(context, str(agent_id)))


def _status(context: RequestContext, app_id: str, kind: TraceSourceKind, source_id: str):
    node_id = _query_node_id()
    result = _run_call(
        lambda: application_tracing_service().status(
            tenant_id=context.active_workspace_id,
            app_id=app_id,
            source_kind=kind,
            source_id=source_id,
            node_execution_id=node_id,
        )
    )
    return dump_response(TraceRunStatusResponse, result)


def _retry(context: RequestContext, app_id: str, kind: TraceSourceKind, source_id: str):
    node_id = _query_node_id()
    payload = TraceRunRetryPayload.model_validate(console_ns.payload or {})
    result = _run_call(
        lambda: application_tracing_service().retry(
            tenant_id=context.active_workspace_id,
            app_id=app_id,
            source_kind=kind,
            source_id=source_id,
            node_execution_id=node_id,
            acknowledge_possible_duplicates=payload.acknowledge_possible_duplicates,
        )
    )
    return dump_response(TraceRunStatusResponse, result)


@console_ns.route("/agent/<uuid:agent_id>/trace-runs/<uuid:message_id>")
class AgentTraceRunApi(Resource):
    @error_responses(TraceSourceNotFoundError, TraceNodeNotFoundError)
    @console_ns.doc("get_agent_trace_run", params=query_params_from_model(TraceRunQuery))
    @console_ns.response(
        200, "Frozen trace destination and export state", console_ns.models[TraceRunStatusResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.AGENT_LOG_MANAGE, AgentId())])
    def get(self, context: RequestContext, agent_id: UUID, message_id: UUID):
        return _status(context, _agent_app_id(context, agent_id), "message", str(message_id))


@console_ns.route("/agent/<uuid:agent_id>/trace-runs/<uuid:message_id>/retry")
class AgentTraceRunRetryApi(Resource):
    @error_responses(*_TRACE_ERRORS.values())
    @console_ns.doc("retry_agent_trace_run", params=query_params_from_model(TraceRunQuery))
    @console_ns.expect(console_ns.models[TraceRunRetryPayload.__name__])
    @console_ns.response(
        200, "Retry state for the same frozen destination", console_ns.models[TraceRunStatusResponse.__name__]
    )
    @console_account_admission(allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.AGENT_EDIT, AgentId())])
    def post(self, context: RequestContext, agent_id: UUID, message_id: UUID):
        return _retry(context, _agent_app_id(context, agent_id), "message", str(message_id))


@console_ns.route("/apps/<uuid:app_id>/trace-runs/<string:source_kind>/<uuid:source_id>")
class AppTraceRunApi(Resource):
    @error_responses(TraceSourceNotFoundError, TraceNodeNotFoundError)
    @console_ns.doc(
        "get_app_trace_run",
        params={
            **query_params_from_model(TraceRunQuery),
            "source_kind": {"enum": ["message", "workflow", "node"]},
        },
    )
    @console_ns.response(
        200, "Frozen trace destination and export state", console_ns.models[TraceRunStatusResponse.__name__]
    )
    @console_account_admission(rbac_checks=[RBACCheck(RBACPermission.APP_LOG_AND_ANNOTATION, PlainApp())])
    def get(self, context: RequestContext, app_id: UUID, source_kind: str, source_id: UUID):
        return _status(context, str(app_id), _source_kind_adapter.validate_python(source_kind), str(source_id))


@console_ns.route("/apps/<uuid:app_id>/trace-runs/<string:source_kind>/<uuid:source_id>/retry")
class AppTraceRunRetryApi(Resource):
    @error_responses(*_TRACE_ERRORS.values())
    @console_ns.doc(
        "retry_app_trace_run",
        params={
            **query_params_from_model(TraceRunQuery),
            "source_kind": {"enum": ["message", "workflow", "node"]},
        },
    )
    @console_ns.expect(console_ns.models[TraceRunRetryPayload.__name__])
    @console_ns.response(
        200, "Retry state for the same frozen destination", console_ns.models[TraceRunStatusResponse.__name__]
    )
    @console_account_admission(
        allowed_roles=_EDIT_ROLES, rbac_checks=[RBACCheck(RBACPermission.APP_TRACING_CONFIG, PlainApp())]
    )
    def post(self, context: RequestContext, app_id: UUID, source_kind: str, source_id: UUID):
        return _retry(context, str(app_id), _source_kind_adapter.validate_python(source_kind), str(source_id))
