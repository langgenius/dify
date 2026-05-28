from flask_restx import Resource

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, edit_permission_required, setup_required
from libs.login import current_account_with_tenant, login_required
from models.model import AppMode
from services.agent.composer_service import AgentComposerService
from services.agent.composer_validator import ComposerConfigValidator
from services.entities.agent_entities import ComposerSavePayload

register_schema_models(console_ns, ComposerSavePayload)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer")
class WorkflowAgentComposerApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    def get(self, app_model, node_id: str):
        _, tenant_id = current_account_with_tenant()
        return AgentComposerService.load_workflow_composer(
            tenant_id=tenant_id,
            app_id=app_model.id,
            node_id=node_id,
        )

    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    def put(self, app_model, node_id: str):
        account, tenant_id = current_account_with_tenant()
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        return AgentComposerService.save_workflow_composer(
            tenant_id=tenant_id,
            app_id=app_model.id,
            node_id=node_id,
            account_id=account.id,
            payload=payload,
        )


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/validate")
class WorkflowAgentComposerValidateApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    def post(self, app_model, node_id: str):
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        ComposerConfigValidator.validate_save_payload(payload)
        return {"result": "success", "errors": []}


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/candidates")
class WorkflowAgentComposerCandidatesApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    def get(self, app_model, node_id: str):
        return AgentComposerService.get_workflow_candidates(app_id=app_model.id)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/impact")
class WorkflowAgentComposerImpactApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    def post(self, app_model, node_id: str):
        _, tenant_id = current_account_with_tenant()
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        current_snapshot_id = payload.binding.current_snapshot_id if payload.binding else None
        if not current_snapshot_id:
            return {"current_snapshot_id": None, "workflow_node_count": 0, "bindings": []}
        return AgentComposerService.calculate_impact(tenant_id=tenant_id, current_snapshot_id=current_snapshot_id)


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/<string:node_id>/agent-composer/save-to-roster")
class WorkflowAgentComposerSaveToRosterApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_app_model(mode=[AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
    def post(self, app_model, node_id: str):
        account, tenant_id = current_account_with_tenant()
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        return AgentComposerService.save_workflow_composer(
            tenant_id=tenant_id,
            app_id=app_model.id,
            node_id=node_id,
            account_id=account.id,
            payload=payload,
        )


@console_ns.route("/apps/<uuid:app_id>/agent-composer")
class AgentAppComposerApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model()
    def get(self, app_model):
        _, tenant_id = current_account_with_tenant()
        return AgentComposerService.load_agent_app_composer(tenant_id=tenant_id, app_id=app_model.id)

    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @get_app_model()
    def put(self, app_model):
        account, tenant_id = current_account_with_tenant()
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        return AgentComposerService.save_agent_app_composer(
            tenant_id=tenant_id,
            app_id=app_model.id,
            account_id=account.id,
            payload=payload,
        )


@console_ns.route("/apps/<uuid:app_id>/agent-composer/validate")
class AgentAppComposerValidateApi(Resource):
    @console_ns.expect(console_ns.models[ComposerSavePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model()
    def post(self, app_model):
        payload = ComposerSavePayload.model_validate(console_ns.payload or {})
        ComposerConfigValidator.validate_save_payload(payload)
        return {"result": "success", "errors": []}


@console_ns.route("/apps/<uuid:app_id>/agent-composer/candidates")
class AgentAppComposerCandidatesApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model()
    def get(self, app_model):
        return AgentComposerService.get_agent_app_candidates(app_id=app_model.id)
