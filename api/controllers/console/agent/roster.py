from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from services.agent.roster_service import AgentRosterService
from services.entities.agent_entities import RosterAgentCreatePayload, RosterAgentUpdatePayload, RosterListQuery


class AgentInviteOptionsQuery(RosterListQuery):
    app_id: str | None = Field(default=None, description="Workflow app id for in-current-workflow markers")


class AgentIdPath(BaseModel):
    agent_id: str


register_schema_models(
    console_ns,
    AgentInviteOptionsQuery,
    AgentIdPath,
    RosterAgentCreatePayload,
    RosterAgentUpdatePayload,
    RosterListQuery,
)


def _agent_roster_service() -> AgentRosterService:
    return AgentRosterService(db.session)


@console_ns.route("/agents")
class AgentRosterListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()
        query = RosterListQuery.model_validate(request.args.to_dict(flat=True))
        return _agent_roster_service().list_roster_agents(
            tenant_id=tenant_id, page=query.page, limit=query.limit, keyword=query.keyword
        )

    @console_ns.expect(console_ns.models[RosterAgentCreatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def post(self):
        account, tenant_id = current_account_with_tenant()
        payload = RosterAgentCreatePayload.model_validate(console_ns.payload or {})
        service = _agent_roster_service()
        agent = service.create_roster_agent(tenant_id=tenant_id, account_id=account.id, payload=payload)
        return service.get_roster_agent_detail(tenant_id=tenant_id, agent_id=agent.id), 201


@console_ns.route("/agents/invite-options")
class AgentInviteOptionsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        _, tenant_id = current_account_with_tenant()
        query = AgentInviteOptionsQuery.model_validate(request.args.to_dict(flat=True))
        return _agent_roster_service().list_invite_options(
            tenant_id=tenant_id,
            page=query.page,
            limit=query.limit,
            keyword=query.keyword,
            app_id=query.app_id,
        )


@console_ns.route("/agents/<uuid:agent_id>")
class AgentRosterDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, agent_id: UUID):
        _, tenant_id = current_account_with_tenant()
        return _agent_roster_service().get_roster_agent_detail(tenant_id=tenant_id, agent_id=str(agent_id))

    @console_ns.expect(console_ns.models[RosterAgentUpdatePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def patch(self, agent_id: UUID):
        account, tenant_id = current_account_with_tenant()
        payload = RosterAgentUpdatePayload.model_validate(console_ns.payload or {})
        return _agent_roster_service().update_roster_agent(
            tenant_id=tenant_id, agent_id=str(agent_id), account_id=account.id, payload=payload
        )

    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    def delete(self, agent_id: UUID):
        account, tenant_id = current_account_with_tenant()
        _agent_roster_service().archive_roster_agent(tenant_id=tenant_id, agent_id=str(agent_id), account_id=account.id)
        return "", 204


@console_ns.route("/agents/<uuid:agent_id>/versions")
class AgentRosterVersionsApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, agent_id: UUID):
        _, tenant_id = current_account_with_tenant()
        return {"data": _agent_roster_service().list_agent_versions(tenant_id=tenant_id, agent_id=str(agent_id))}


@console_ns.route("/agents/<uuid:agent_id>/versions/<uuid:version_id>")
class AgentRosterVersionDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, agent_id: UUID, version_id: UUID):
        _, tenant_id = current_account_with_tenant()
        return _agent_roster_service().get_agent_version_detail(
            tenant_id=tenant_id,
            agent_id=str(agent_id),
            version_id=str(version_id),
        )
