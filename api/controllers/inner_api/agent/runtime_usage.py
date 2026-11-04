"""Trusted ingestion for independently persisted E2B execution usage."""

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import agent_inner_api_only
from fields.base import ResponseModel
from libs.exception import BaseHTTPException
from libs.helper import dump_response
from services.agent.runtime_usage_service import SandboxUsageError, SandboxUsageEvent, SandboxUsageService


class SandboxUsageHttpError(BaseHTTPException):
    error_code = "sandbox_usage_invalid_request"
    description = "Invalid sandbox usage request."
    code = 400

    def __init__(self, error: SandboxUsageError | None = None) -> None:
        if error is not None:
            self.error_code = error.code
            self.description = error.code
            self.code = error.status_code
        super().__init__(self.description)


class SandboxUsagePayload(BaseModel):
    project_id: str = Field(min_length=1, max_length=128)
    events: list[SandboxUsageEvent] = Field(min_length=1, max_length=100)
    model_config = ConfigDict(extra="forbid")


class SandboxUsageQuery(BaseModel):
    project_id: str = Field(min_length=1, max_length=128)
    model_config = ConfigDict(extra="forbid")


class SandboxUsageResponse(ResponseModel):
    accepted: int
    duplicates: int
    conflicts: int
    ignored: int


class SandboxUsageDiagnosticsResponse(ResponseModel):
    unresolved_events: int = 0
    conflict_events: int = 0
    open_executions: int = 0
    unattributed_executions: int = 0


class SandboxUsageStateResponse(ResponseModel):
    enabled: bool
    project_id: str
    started_at: str | None
    checkpoint_at: str | None
    full_scan_at: str | None
    diagnostics: SandboxUsageDiagnosticsResponse


register_schema_models(inner_api_ns, SandboxUsagePayload, SandboxUsageQuery)
register_response_schema_models(inner_api_ns, SandboxUsageResponse, SandboxUsageStateResponse)


@inner_api_ns.route("/agent/sandbox-usage/events")
class SandboxUsageEventsApi(Resource):
    @agent_inner_api_only
    @inner_api_ns.doc("inner_agent_sandbox_usage_events")
    @inner_api_ns.expect(inner_api_ns.models[SandboxUsagePayload.__name__])
    @inner_api_ns.response(200, "Durably committed", inner_api_ns.models[SandboxUsageResponse.__name__])
    def post(self):
        request.max_content_length = 1024 * 1024
        try:
            payload = SandboxUsagePayload.model_validate(inner_api_ns.payload or {})
            result = SandboxUsageService.ingest(project_id=payload.project_id, events=payload.events)
        except ValidationError as exc:
            raise SandboxUsageHttpError() from exc
        except SandboxUsageError as exc:
            raise SandboxUsageHttpError(exc) from exc
        return dump_response(SandboxUsageResponse, result)


@inner_api_ns.route("/agent/sandbox-usage/state")
class SandboxUsageStateApi(Resource):
    @agent_inner_api_only
    @inner_api_ns.doc("inner_agent_sandbox_usage_state", params=query_params_from_model(SandboxUsageQuery))
    @inner_api_ns.response(
        200, "Persisted activation and completed scans", inner_api_ns.models[SandboxUsageStateResponse.__name__]
    )
    def get(self):
        try:
            query = SandboxUsageQuery.model_validate(request.args.to_dict(flat=True))
            result = SandboxUsageService.get_state(project_id=query.project_id)
        except ValidationError as exc:
            raise SandboxUsageHttpError() from exc
        except SandboxUsageError as exc:
            raise SandboxUsageHttpError(exc) from exc
        return dump_response(SandboxUsageStateResponse, result)
