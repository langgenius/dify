from flask import request
from flask_restx import Resource

from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, current_account_with_tenant, setup_required
from libs.login import login_required
from models import App
from models.model import AppMode
from services.skill_service import SkillService


@console_ns.route("/apps/<uuid:app_id>/workflows/draft/nodes/llm/skills")
class NodeSkillsApi(Resource):
    """Extract tool dependencies from an LLM node's skill prompts.

    The client sends the full node ``data`` object in the request body.
    The server real-time builds a ``SkillBundle`` from the current draft
    ``.md`` assets and resolves transitive tool dependencies — no cached
    bundle is used.
    """

    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    def post(self, app_model: App):
        current_user, _ = current_account_with_tenant()
        node_data = request.get_json(force=True)
        if not isinstance(node_data, dict):
            return {"tool_dependencies": []}

        tool_deps = SkillService.extract_tool_dependencies(
            app=app_model,
            node_data=node_data,
            user_id=current_user.id,
        )
        return {"tool_dependencies": [d.model_dump() for d in tool_deps]}
