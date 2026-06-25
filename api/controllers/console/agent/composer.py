from uuid import UUID

from flask_restx import Resource

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.agent.app_helpers import resolve_agent_app_model
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user_id,
)
from fields.agent_fields import (
    AgentAppComposerResponse,
    AgentComposerCandidatesResponse,
    AgentComposerImpactResponse,
    AgentComposerValidateResponse,
    WorkflowAgentComposerResponse,
)
from libs.helper import dump_response
from libs.login import login_required
from models.model import App, AppMode
from services.agent.composer_service import AgentComposerService
from services.agent.composer_validator import ComposerConfigValidator
from services.entities.agent_entities import ComposerSavePayload, WorkflowComposerCopyFromRosterPayload

register_schema_models(console_ns, ComposerSavePayload, WorkflowComposerCopyFromRosterPayload)
register_response_schema_models(
    console_ns,
    AgentAppComposerResponse,
    AgentComposerCandidatesResponse,
    AgentComposerImpactResponse,
    AgentComposerValidateResponse,
    WorkflowAgentComposerResponse,
)


def _resolve_agent_app_id(*, tenant_id: str, agent_id: UUID) -> str:
    return resolve_agent_app_model(tenant_id=tenant_id, agent_id=agent_id).id


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer")
class WorkflowAgentComposerApi(Resource):
    @console_ns.response(
        200, "Workflow agent composer state", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_tenant_id
    def get(self, tenant_id: str, app_model: App, node_id: str):
        return dump_response(
            WorkflowAgentComposerResponse,
            AgentComposerService.load_workflow_composer(
                tenant_id=tenant_id,
                app_id=app_model.id,
                node_id=node_id,
            ),
        )

    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        200, "Workflow agent composer saved", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_user_id
    @with_current_tenant_id
    def put(self, tenant_id: str, account_id: str, app_model: App, node_id: str):
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        return dump_response(
            WorkflowAgentComposerResponse,
            AgentComposerService.save_workflow_composer(
                tenant_id=tenant_id,
                app_id=app_model.id,
                node_id=node_id,
                account_id=account_id,
                payload=payload,
            ),
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/copy-from-roster")
class WorkflowAgentComposerCopyFromRosterApi(Resource):
    @console_ns.expect(console_ns.models[WorkflowComposerCopyFromRosterPayload.__name__])
    @console_ns.response(
        200,
        "Workflow roster agent copied to inline agent",
        console_ns.models[WorkflowAgentComposerResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, account_id: str, app_model: App, node_id: str):
        payload = WorkflowComposerCopyFromRosterPayload.model_validate(console_ns.payload or {})
        return dump_response(
            WorkflowAgentComposerResponse,
            AgentComposerService.copy_workflow_composer_from_roster(
                tenant_id=tenant_id,
                app_id=app_model.id,
                node_id=node_id,
                account_id=account_id,
                source_agent_id=payload.source_agent_id,
                source_snapshot_id=payload.source_snapshot_id,
                idempotency_key=payload.idempotency_key,
            ),
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/validate")
class WorkflowAgentComposerValidateApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        200, "Workflow agent composer validation result", console_ns.models[AgentComposerValidateResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_tenant_id
    def post(self, tenant_id: str, app_model: App, node_id: str):
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        ComposerConfigValidator.validate_publish_payload(payload)
        findings = AgentComposerService.collect_validation_findings(
            tenant_id=tenant_id,
            payload=payload,
            agent_id=AgentComposerService.resolve_workflow_node_agent_id(
                tenant_id=tenant_id, app_id=app_model.id, node_id=node_id
            ),
        )
        return dump_response(AgentComposerValidateResponse, {"result": "success", "errors": [], **findings})


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/candidates")
class WorkflowAgentComposerCandidatesApi(Resource):
    @console_ns.response(
        200, "Workflow agent composer candidates", console_ns.models[AgentComposerCandidatesResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_user_id
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user_id: str, app_model: App, node_id: str):
        return dump_response(
            AgentComposerCandidatesResponse,
            AgentComposerService.get_workflow_candidates(
                tenant_id=tenant_id,
                app_id=app_model.id,
                node_id=node_id,
                user_id=current_user_id,
            ),
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/impact")
class WorkflowAgentComposerImpactApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(200, "Workflow agent composer impact", console_ns.models[AgentComposerImpactResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_tenant_id
    def post(self, tenant_id: str, app_model: App, node_id: str):
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        current_snapshot_id = payload.binding.current_snapshot_id if payload.binding else None
        if not current_snapshot_id:
            return dump_response(
                AgentComposerImpactResponse, {"current_snapshot_id": None, "workflow_node_count": 0, "bindings": []}
            )
        return dump_response(
            AgentComposerImpactResponse,
            AgentComposerService.calculate_impact(tenant_id=tenant_id, current_snapshot_id=current_snapshot_id),
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/save-to-roster")
class WorkflowAgentComposerSaveToRosterApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        200, "Workflow agent composer saved to roster", console_ns.models[WorkflowAgentComposerResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    @with_current_user_id
    @with_current_tenant_id
    def post(self, tenant_id: str, account_id: str, app_model: App, node_id: str):
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        return dump_response(
            WorkflowAgentComposerResponse,
            AgentComposerService.save_workflow_composer(
                tenant_id=tenant_id,
                app_id=app_model.id,
                node_id=node_id,
                account_id=account_id,
                payload=payload,
            ),
        )


@console_ns.route("/agent/<uuid:agent_id>/composer")
class AgentComposerApi(Resource):
    @console_ns.response(200, "Agent app composer state", console_ns.models[AgentAppComposerResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def get(self, tenant_id: str, agent_id: UUID):
        app_id = _resolve_agent_app_id(tenant_id=tenant_id, agent_id=agent_id)
        return dump_response(
            AgentAppComposerResponse,
            AgentComposerService.load_agent_app_composer(tenant_id=tenant_id, app_id=app_id),
        )

    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(200, "Agent app composer saved", console_ns.models[AgentAppComposerResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_EDIT)
    @with_current_user_id
    @with_current_tenant_id
    def put(self, tenant_id: str, account_id: str, agent_id: UUID):
        app_id = _resolve_agent_app_id(tenant_id=tenant_id, agent_id=agent_id)
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        return dump_response(
            AgentAppComposerResponse,
            AgentComposerService.save_agent_app_composer(
                tenant_id=tenant_id,
                app_id=app_id,
                account_id=account_id,
                payload=payload,
            ),
        )


@console_ns.route("/agent/<uuid:agent_id>/composer/validate")
class AgentComposerValidateApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @console_ns.response(
        200, "Agent app composer validation result", console_ns.models[AgentComposerValidateResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_tenant_id
    def post(self, tenant_id: str, agent_id: UUID):
        _resolve_agent_app_id(tenant_id=tenant_id, agent_id=agent_id)
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        ComposerConfigValidator.validate_publish_payload(payload)
        findings = AgentComposerService.collect_validation_findings(
            tenant_id=tenant_id,
            payload=payload,
            agent_id=str(agent_id),
        )
        return dump_response(AgentComposerValidateResponse, {"result": "success", "errors": [], **findings})


@console_ns.route("/agent/<uuid:agent_id>/composer/candidates")
class AgentComposerCandidatesApi(Resource):
    @console_ns.response(
        200, "Agent app composer candidates", console_ns.models[AgentComposerCandidatesResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    def get(self, tenant_id: str, current_user_id: str, agent_id: UUID):
        app_id = _resolve_agent_app_id(tenant_id=tenant_id, agent_id=agent_id)
        return dump_response(
            AgentComposerCandidatesResponse,
            AgentComposerService.get_agent_app_candidates(
                tenant_id=tenant_id,
                app_id=app_id,
                user_id=current_user_id,
            ),
        )
