"""Console transport for External Agent assets; credentials are write-only."""

from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.agent.external_errors import ExternalAgentVerificationHTTPError
from controllers.console.flask_admission import console_account_admission
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from services.external_agents.contracts import (
    ExternalAgentConflictError,
    ExternalAgentError,
    ExternalAgentForbiddenError,
    ExternalAgentNotFoundError,
    ExternalAgentVerificationFailedError,
)


class _Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class ExternalAgentListQuery(_Payload):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = Field(default=None, max_length=255)
    enabled: bool | None = None
    connected_by_me: bool = False
    sort_by: Literal["created_at", "updated_at"] = "updated_at"
    sort_order: Literal["asc", "desc"] = "desc"


class ExternalAgentVerifyPayload(_Payload):
    endpoint: str = Field(min_length=1, max_length=4096)
    auth_type: Literal["none", "bearer"]
    credential_action: Literal["keep", "replace", "remove"] = "remove"
    credential: str | None = Field(default=None, max_length=8192, repr=False)
    agent_id: UUID | None = None
    expected_connection_revision_id: UUID | None = None


class ExternalAgentCreatePayload(_Payload):
    verification_id: UUID
    metadata: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=1, max_length=255)


class ExternalAgentConnectionPayload(_Payload):
    verification_id: UUID
    expected_revision_id: UUID
    idempotency_key: str = Field(min_length=1, max_length=255)


class ExternalAgentInfoPayload(_Payload):
    expected_revision: int = Field(ge=1)
    changes: dict[str, Any]


class ExternalAgentSwitchPayload(_Payload):
    enabled: bool


class ExternalAgentAssetResponse(ResponseModel):
    id: str
    tenant_id: str
    name: str
    description: str
    role: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    enabled: bool
    tracing_enabled: bool
    active_connection_revision_id: str
    metadata_revision: int
    row_version: int
    test_display_generation: int
    overrides: tuple[str, ...]
    created_by: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    icon_url: str | None
    reference_count: int | None = Field(
        description="Distinct readable current App references on list rows; null withholds details."
    )


class ExternalAgentListResponse(ResponseModel):
    items: tuple[ExternalAgentAssetResponse, ...]
    total: int
    page: int
    limit: int
    enabled_count: int
    disabled_count: int


class ExternalAgentDetailResponse(ResponseModel):
    asset: ExternalAgentAssetResponse
    connection: dict[str, Any]


class ExternalAgentConnectionWarningsResponse(ResponseModel):
    technical: tuple[str, ...]
    business: tuple[str, ...]


class ExternalAgentVerificationResponse(ResponseModel):
    verification_id: str
    expires_at: datetime
    auth_check: str
    interface_url: str
    card: dict[str, Any]
    capabilities: dict[str, Any]
    warnings: ExternalAgentConnectionWarningsResponse


class ExternalAgentOperationResponse(ResponseModel):
    id: str
    resource_id: str
    kind: str
    result: dict[str, Any]


class ExternalAgentAppReferenceResponse(ResponseModel):
    app_id: str
    name: str
    mode: str
    node_ids: tuple[str, ...]


class ExternalAgentReferencesResponse(ResponseModel):
    apps: tuple[ExternalAgentAppReferenceResponse, ...]
    may_have_in_flight: bool


register_schema_models(
    console_ns,
    ExternalAgentListQuery,
    ExternalAgentVerifyPayload,
    ExternalAgentCreatePayload,
    ExternalAgentConnectionPayload,
    ExternalAgentInfoPayload,
    ExternalAgentSwitchPayload,
)
register_response_schema_models(
    console_ns,
    ExternalAgentAssetResponse,
    ExternalAgentListResponse,
    ExternalAgentDetailResponse,
    ExternalAgentVerificationResponse,
    ExternalAgentConnectionWarningsResponse,
    ExternalAgentOperationResponse,
    ExternalAgentAppReferenceResponse,
    ExternalAgentReferencesResponse,
)


def external_call[T](operation: Callable[[], T]) -> T:
    try:
        return operation()
    except ExternalAgentForbiddenError as error:
        raise Forbidden(str(error)) from error
    except ExternalAgentNotFoundError as error:
        raise NotFound(str(error)) from error
    except ExternalAgentConflictError as error:
        raise Conflict(str(error)) from error
    except ExternalAgentVerificationFailedError as error:
        raise ExternalAgentVerificationHTTPError(str(error), reason=error.reason) from error
    except ExternalAgentError as error:
        raise BadRequest(str(error)) from error


def require_external_execution() -> None:
    if not application_services().external_agents.enabled:
        raise ServiceUnavailable("External Agent execution is disabled in this deployment.")


@console_ns.route("/external-agents")
class ExternalAgentsApi(Resource):
    @console_ns.doc("list_external_agents", params=query_params_from_model(ExternalAgentListQuery))
    @console_ns.response(200, "Accessible external assets", console_ns.models[ExternalAgentListResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext):
        query = ExternalAgentListQuery.model_validate(request.args.to_dict(flat=True))
        result = external_call(
            lambda: application_services().external_agents.assets.list(context, **query.model_dump())
        )
        return dump_response(ExternalAgentListResponse, asdict(result))

    @console_ns.expect(console_ns.models[ExternalAgentCreatePayload.__name__])
    @console_ns.response(201, "Committed save operation", console_ns.models[ExternalAgentOperationResponse.__name__])
    @console_account_admission()
    def post(self, context: RequestContext):
        require_external_execution()
        payload = ExternalAgentCreatePayload.model_validate(request.get_json())
        result = external_call(
            lambda: application_services().external_agents.assets.create(
                context,
                verification_id=str(payload.verification_id),
                metadata=payload.metadata,
                operation_key=payload.idempotency_key,
            )
        )
        return dump_response(ExternalAgentOperationResponse, asdict(result)), 201


@console_ns.route("/external-agents/verify")
class ExternalAgentVerifyApi(Resource):
    @console_ns.expect(console_ns.models[ExternalAgentVerifyPayload.__name__])
    @console_ns.response(
        200, "Read-only verification scope", console_ns.models[ExternalAgentVerificationResponse.__name__]
    )
    @console_account_admission()
    @error_responses(ExternalAgentVerificationHTTPError)
    def post(self, context: RequestContext):
        require_external_execution()
        payload = ExternalAgentVerifyPayload.model_validate(request.get_json())
        values = payload.model_dump()
        for key in ("agent_id", "expected_connection_revision_id"):
            values[key] = str(values[key]) if values[key] is not None else None
        result = external_call(lambda: application_services().external_agents.assets.verify(context, **values))
        return dump_response(
            ExternalAgentVerificationResponse,
            {
                "verification_id": result.id,
                "expires_at": result.expires_at,
                "auth_check": result.auth_check,
                "interface_url": result.interface_url,
                "card": result.card,
                "capabilities": {k: v for k, v in result.capabilities.items() if k != "connection_change_warnings"},
                "warnings": result.capabilities.get("connection_change_warnings", {"technical": [], "business": []}),
            },
        )


@console_ns.route("/external-agents/<uuid:agent_id>")
class ExternalAgentApi(Resource):
    @console_ns.response(
        200, "Asset and safe saved connection", console_ns.models[ExternalAgentDetailResponse.__name__]
    )
    @console_account_admission()
    def get(self, context: RequestContext, agent_id: UUID):
        result = external_call(lambda: application_services().external_agents.assets.detail(context, str(agent_id)))
        return dump_response(ExternalAgentDetailResponse, result)

    @console_ns.response(204, "External asset deleted")
    @console_account_admission()
    def delete(self, context: RequestContext, agent_id: UUID):
        external_call(lambda: application_services().external_agents.assets.delete(context, str(agent_id)))
        return "", 204


@console_ns.route("/external-agents/<uuid:agent_id>/references")
class ExternalAgentReferencesApi(Resource):
    @console_ns.response(
        200,
        "Readable current App references and possible in-flight warning",
        console_ns.models[ExternalAgentReferencesResponse.__name__],
    )
    @console_account_admission()
    def get(self, context: RequestContext, agent_id: UUID):
        """Read advisory deletion impact; neither mutate nor cancel any work."""
        result = external_call(lambda: application_services().external_agents.assets.references(context, str(agent_id)))
        return dump_response(ExternalAgentReferencesResponse, asdict(result))


@console_ns.route("/external-agents/<uuid:agent_id>/info")
class ExternalAgentInfoApi(Resource):
    @console_ns.expect(console_ns.models[ExternalAgentInfoPayload.__name__])
    @console_ns.response(200, "Saved local display metadata", console_ns.models[ExternalAgentAssetResponse.__name__])
    @console_account_admission()
    def patch(self, context: RequestContext, agent_id: UUID):
        payload = ExternalAgentInfoPayload.model_validate(request.get_json())
        result = external_call(
            lambda: application_services().external_agents.assets.update_info(
                context, agent_id=str(agent_id), expected_revision=payload.expected_revision, changes=payload.changes
            )
        )
        return dump_response(ExternalAgentAssetResponse, asdict(result))


@console_ns.route("/external-agents/<uuid:agent_id>/connection")
class ExternalAgentConnectionApi(Resource):
    @console_ns.expect(console_ns.models[ExternalAgentConnectionPayload.__name__])
    @console_ns.response(200, "Saved immutable connection", console_ns.models[ExternalAgentOperationResponse.__name__])
    @console_account_admission()
    def put(self, context: RequestContext, agent_id: UUID):
        payload = ExternalAgentConnectionPayload.model_validate(request.get_json())
        result = external_call(
            lambda: application_services().external_agents.assets.update_connection(
                context,
                agent_id=str(agent_id),
                verification_id=str(payload.verification_id),
                expected_revision_id=str(payload.expected_revision_id),
                operation_key=payload.idempotency_key,
            )
        )
        return dump_response(ExternalAgentOperationResponse, asdict(result))


@console_ns.route("/external-agents/<uuid:agent_id>/enabled")
class ExternalAgentEnabledApi(Resource):
    @console_ns.expect(console_ns.models[ExternalAgentSwitchPayload.__name__])
    @console_ns.response(200, "Saved availability", console_ns.models[ExternalAgentAssetResponse.__name__])
    @console_account_admission()
    def put(self, context: RequestContext, agent_id: UUID):
        payload = ExternalAgentSwitchPayload.model_validate(request.get_json())
        result = external_call(
            lambda: application_services().external_agents.assets.set_enabled(context, str(agent_id), payload.enabled)
        )
        return dump_response(ExternalAgentAssetResponse, asdict(result))


@console_ns.route("/external-agents/<uuid:agent_id>/tracing")
class ExternalAgentTracingApi(Resource):
    @console_ns.expect(console_ns.models[ExternalAgentSwitchPayload.__name__])
    @console_ns.response(200, "Saved collection preference", console_ns.models[ExternalAgentAssetResponse.__name__])
    @console_account_admission()
    def put(self, context: RequestContext, agent_id: UUID):
        payload = ExternalAgentSwitchPayload.model_validate(request.get_json())
        result = external_call(
            lambda: application_services().external_agents.assets.set_tracing(context, str(agent_id), payload.enabled)
        )
        return dump_response(ExternalAgentAssetResponse, asdict(result))


@console_ns.route("/external-agent-operations/<uuid:operation_id>")
class ExternalAgentOperationApi(Resource):
    @console_ns.response(200, "Owned operation receipt", console_ns.models[ExternalAgentOperationResponse.__name__])
    @console_account_admission()
    def get(self, context: RequestContext, operation_id: UUID):
        result = external_call(
            lambda: application_services().external_agents.assets.operation(context, str(operation_id))
        )
        return dump_response(ExternalAgentOperationResponse, asdict(result))
