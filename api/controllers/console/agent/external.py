from __future__ import annotations

from time import perf_counter
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from clients.a2a import A2AAgentCard
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.common.session import with_session
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models import Account
from models.agent import AgentIconType, AgentKind, ExternalAgentAuthType
from services.agent.errors import AgentVersionConflictError, ExternalAgentConfigurationError
from services.agent.external_agent_service import ExternalAgentDiscovery, ExternalAgentService


class ExternalAgentConnectionPayload(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2048, description="A2A endpoint or Agent Card URL")
    auth_type: ExternalAgentAuthType = ExternalAgentAuthType.NONE
    bearer_token: str | None = Field(default=None, max_length=8192, description="Bearer token; never returned")

    @field_validator("endpoint")
    @classmethod
    def normalize_endpoint(cls, value: str) -> str:
        return value.strip()


class ExternalAgentCreatePayload(ExternalAgentConnectionPayload):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=400)
    role: str = Field(default="", max_length=255)
    icon_type: AgentIconType | None = None
    icon: str | None = Field(default=None, max_length=255)
    icon_background: str | None = Field(default=None, max_length=255)


class ExternalAgentUpdatePayload(BaseModel):
    expected_active_config_snapshot_id: str = Field(
        min_length=1,
        description="Active snapshot shown when the editor was opened; used for compare-and-swap",
    )
    endpoint: str | None = Field(default=None, min_length=1, max_length=2048)
    auth_type: ExternalAgentAuthType | None = None
    bearer_token: str | None = Field(default=None, max_length=8192, description="Omit to preserve the current token")
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=400)
    role: str | None = Field(default=None, max_length=255)
    icon_type: AgentIconType | None = None
    icon: str | None = Field(default=None, max_length=255)
    icon_background: str | None = Field(default=None, max_length=255)

    @field_validator("endpoint")
    @classmethod
    def normalize_endpoint(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class ExternalAgentDiscoveryResponse(ResponseModel):
    reachable: bool = True
    name: str
    description: str
    protocol_version: str
    remote_agent_id: str
    agent_card: A2AAgentCard


class ExternalAgentDetailResponse(ResponseModel):
    id: str
    app_id: str | None = None
    name: str
    description: str
    role: str = ""
    icon_type: AgentIconType | None = None
    icon: str | None = None
    icon_background: str | None = None
    agent_kind: AgentKind
    active_config_snapshot_id: str
    endpoint: str
    auth_type: ExternalAgentAuthType
    has_bearer_token: bool
    protocol_version: str
    remote_agent_id: str
    agent_card: A2AAgentCard
    last_verified_at: int | None = None
    created_at: int | None = None
    updated_at: int | None = None


class ExternalAgentTestResponse(ExternalAgentDiscoveryResponse):
    latency_ms: int = Field(ge=0)


register_schema_models(
    console_ns,
    ExternalAgentConnectionPayload,
    ExternalAgentCreatePayload,
    ExternalAgentUpdatePayload,
)
register_response_schema_models(
    console_ns,
    ExternalAgentDiscoveryResponse,
    ExternalAgentDetailResponse,
    ExternalAgentTestResponse,
)


def _serialize_discovery(discovery: ExternalAgentDiscovery) -> dict:
    return {
        "reachable": True,
        "name": discovery.agent_card.name,
        "description": discovery.agent_card.description,
        "protocol_version": discovery.protocol_version,
        "remote_agent_id": discovery.remote_agent_id,
        "agent_card": discovery.agent_card,
    }


@console_ns.route("/agent/external/discover")
class ExternalAgentDiscoverApi(Resource):
    @console_ns.expect(console_ns.models[ExternalAgentConnectionPayload.__name__])
    @console_ns.response(
        200,
        "External A2A Agent discovered",
        console_ns.models[ExternalAgentDiscoveryResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.AGENT_MANAGE, resource_required=False)
    @with_current_tenant_id
    def post(self, tenant_id: str):
        del tenant_id  # Authentication scope is enforced by the decorator; discovery is not persisted.
        payload = ExternalAgentConnectionPayload.model_validate(console_ns.payload or {})
        discovery = ExternalAgentService.discover(
            endpoint=payload.endpoint,
            auth_type=payload.auth_type,
            bearer_token=payload.bearer_token,
        )
        return dump_response(ExternalAgentDiscoveryResponse, _serialize_discovery(discovery))


@console_ns.route("/agent/external")
class ExternalAgentCreateApi(Resource):
    @console_ns.expect(console_ns.models[ExternalAgentCreatePayload.__name__])
    @console_ns.response(201, "External Agent connected", console_ns.models[ExternalAgentDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.AGENT_MANAGE, resource_required=False)
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(self, session: Session, tenant_id: str, current_user: Account):
        payload = ExternalAgentCreatePayload.model_validate(console_ns.payload or {})
        # No session query/write precedes this call: remote I/O completes before
        # the App, Agent, connection, and immutable card snapshot transaction.
        discovery = ExternalAgentService.discover(
            endpoint=payload.endpoint,
            auth_type=payload.auth_type,
            bearer_token=payload.bearer_token,
        )
        result = ExternalAgentService(session).create_external_agent(
            tenant_id=tenant_id,
            account_id=current_user.id,
            endpoint=payload.endpoint,
            auth_type=payload.auth_type,
            bearer_token=payload.bearer_token,
            discovery=discovery,
            name=payload.name,
            description=payload.description,
            role=payload.role,
            icon_type=payload.icon_type,
            icon=payload.icon,
            icon_background=payload.icon_background,
        )
        return dump_response(ExternalAgentDetailResponse, result), 201


@console_ns.route("/agent/<uuid:agent_id>/external")
class ExternalAgentDetailApi(Resource):
    @console_ns.response(200, "External Agent detail", console_ns.models[ExternalAgentDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.AGENT_MANAGE, resource_required=False)
    @with_current_tenant_id
    @with_session(write=False)
    def get(self, session: Session, tenant_id: str, agent_id: UUID):
        return dump_response(
            ExternalAgentDetailResponse,
            ExternalAgentService(session).get_detail(tenant_id=tenant_id, agent_id=str(agent_id)),
        )

    @console_ns.expect(console_ns.models[ExternalAgentUpdatePayload.__name__])
    @console_ns.response(200, "External Agent updated", console_ns.models[ExternalAgentDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.AGENT_MANAGE, resource_required=False)
    @with_current_user
    @with_current_tenant_id
    @with_session
    def put(self, session: Session, tenant_id: str, current_user: Account, agent_id: UUID):
        payload = ExternalAgentUpdatePayload.model_validate(console_ns.payload or {})
        service = ExternalAgentService(session)
        stored = service.get_connection_material(tenant_id=tenant_id, agent_id=str(agent_id))
        if stored.agent_config_snapshot_id != payload.expected_active_config_snapshot_id:
            raise AgentVersionConflictError()
        endpoint = payload.endpoint or stored.endpoint
        auth_type = payload.auth_type or stored.auth_type
        if auth_type == ExternalAgentAuthType.NONE:
            bearer_token = None
        else:
            if payload.bearer_token is not None:
                bearer_token = payload.bearer_token
            elif ExternalAgentService.endpoint_origins_match(stored.endpoint, endpoint):
                bearer_token = stored.bearer_token
            else:
                raise ExternalAgentConfigurationError(
                    description="Enter the bearer token again when changing the endpoint origin."
                )

        # End the read transaction before calling the user-controlled endpoint.
        session.rollback()
        discovery = ExternalAgentService.discover(
            endpoint=endpoint,
            auth_type=auth_type,
            bearer_token=bearer_token,
        )
        result = service.update_external_agent(
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
            endpoint=endpoint,
            auth_type=auth_type,
            bearer_token=bearer_token,
            discovery=discovery,
            expected_active_config_snapshot_id=payload.expected_active_config_snapshot_id,
            name=payload.name,
            description=payload.description,
            role=payload.role,
            icon_type=payload.icon_type,
            icon=payload.icon,
            icon_background=payload.icon_background,
        )
        return dump_response(ExternalAgentDetailResponse, result)


@console_ns.route("/agent/<uuid:agent_id>/external/test")
class ExternalAgentTestApi(Resource):
    @console_ns.response(
        200,
        "External Agent connection verified",
        console_ns.models[ExternalAgentTestResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.WORKSPACE, RBACPermission.AGENT_MANAGE, resource_required=False)
    @with_current_user
    @with_current_tenant_id
    @with_session
    def post(self, session: Session, tenant_id: str, current_user: Account, agent_id: UUID):
        service = ExternalAgentService(session)
        material = service.get_connection_material(tenant_id=tenant_id, agent_id=str(agent_id))
        session.rollback()

        started_at = perf_counter()
        discovery = ExternalAgentService.discover(
            endpoint=material.endpoint,
            auth_type=material.auth_type,
            bearer_token=material.bearer_token,
        )
        latency_ms = max(0, round((perf_counter() - started_at) * 1000))
        service.record_verified(
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            account_id=current_user.id,
            expected_active_config_snapshot_id=material.agent_config_snapshot_id or "",
        )
        response = _serialize_discovery(discovery)
        response["latency_ms"] = latency_ms
        return dump_response(ExternalAgentTestResponse, response)
