from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
    with_current_tenant_id,
)
from extensions.ext_database import db
from fields.agent_fields import (
    AgentConfigSnapshotDetailResponse,
    AgentConfigSnapshotListResponse,
    AgentInviteOptionsResponse,
    AgentPublishedReferenceResponse,
    AgentRosterListResponse,
    AgentRosterResponse,
)
from libs.helper import dump_response
from libs.login import login_required
from services.agent.roster_service import AgentRosterService
from services.entities.agent_entities import RosterListQuery


class AgentInviteOptionsQuery(RosterListQuery):
    app_id: str | None = Field(default=None, description="Workflow app id for in-current-workflow markers")


class AgentIdPath(BaseModel):
    agent_id: str


register_schema_models(
    console_ns,
    AgentInviteOptionsQuery,
    AgentIdPath,
    RosterListQuery,
)
register_response_schema_models(
    console_ns,
    AgentConfigSnapshotDetailResponse,
    AgentConfigSnapshotListResponse,
    AgentInviteOptionsResponse,
    AgentPublishedReferenceResponse,
    AgentRosterListResponse,
    AgentRosterResponse,
)


def _agent_roster_service() -> AgentRosterService:
    return AgentRosterService(db.session)


@console_ns.route("/agents")
class AgentRosterListApi(Resource):
    @console_ns.doc(params=query_params_from_model(RosterListQuery))
    @console_ns.response(200, "Agent roster list", console_ns.models[AgentRosterListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        query = RosterListQuery.model_validate(request.args.to_dict(flat=True))
        return dump_response(
            AgentRosterListResponse,
            _agent_roster_service().list_roster_agents(
                tenant_id=tenant_id, page=query.page, limit=query.limit, keyword=query.keyword
            ),
        )


@console_ns.route("/agents/invite-options")
class AgentInviteOptionsApi(Resource):
    @console_ns.doc(params=query_params_from_model(AgentInviteOptionsQuery))
    @console_ns.response(200, "Agent invite options", console_ns.models[AgentInviteOptionsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str):
        query = AgentInviteOptionsQuery.model_validate(request.args.to_dict(flat=True))
        return dump_response(
            AgentInviteOptionsResponse,
            _agent_roster_service().list_invite_options(
                tenant_id=tenant_id,
                page=query.page,
                limit=query.limit,
                keyword=query.keyword,
                app_id=query.app_id,
            ),
        )


@console_ns.route("/agents/<uuid:agent_id>")
class AgentRosterDetailApi(Resource):
    @console_ns.response(200, "Agent detail", console_ns.models[AgentRosterResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        return dump_response(
            AgentRosterResponse,
            _agent_roster_service().get_roster_agent_detail(tenant_id=tenant_id, agent_id=str(agent_id)),
        )


@console_ns.route("/agents/<uuid:agent_id>/versions")
class AgentRosterVersionsApi(Resource):
    @console_ns.response(200, "Agent versions", console_ns.models[AgentConfigSnapshotListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        return dump_response(
            AgentConfigSnapshotListResponse,
            {"data": _agent_roster_service().list_agent_versions(tenant_id=tenant_id, agent_id=str(agent_id))},
        )


@console_ns.route("/agents/<uuid:agent_id>/versions/<uuid:version_id>")
class AgentRosterVersionDetailApi(Resource):
    @console_ns.response(200, "Agent version detail", console_ns.models[AgentConfigSnapshotDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID, version_id: UUID):
        return dump_response(
            AgentConfigSnapshotDetailResponse,
            _agent_roster_service().get_agent_version_detail(
                tenant_id=tenant_id,
                agent_id=str(agent_id),
                version_id=str(version_id),
            ),
        )
