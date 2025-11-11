"""
Console/Studio Human Input Form APIs.
"""

import json
import logging
from collections.abc import Generator

from flask import Response, jsonify
from flask_restx import Resource, reqparse
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from controllers.web.error import NotFoundError
from core.workflow.nodes.human_input.entities import FormDefinition
from extensions.ext_database import db
from libs.login import current_account_with_tenant, login_required
from models.human_input import HumanInputForm as HumanInputFormModel
from services.human_input_service import HumanInputService

logger = logging.getLogger(__name__)


class _FormDefinitionWithSite(FormDefinition):
    site: None


def _jsonify_pydantic_model(model: BaseModel) -> Response:
    return Response(model.model_dump_json(), mimetype="application/json")


class ConsoleHumanInputFormApi(Resource):
    """Console API for getting human input form definition."""

    @setup_required
    @login_required
    @account_initialization_required
    def get(self, form_id: str):
        """
        Get human input form definition by form ID.

        GET /console/api/form/human_input/<form_id>
        """
        service = HumanInputService(db.engine)
        form = service.get_form_definition_by_id(
            form_id=form_id,
        )
        if form is None:
            raise NotFoundError(f"form not found, id={form_id}")

        current_user, current_tenant_id = current_account_with_tenant()
        form_model = db.session.get(HumanInputFormModel, form_id)
        if form_model is None or form_model.tenant_id != current_tenant_id:
            raise NotFoundError(f"form not found, id={form_id}")

        from models import App
        from models.workflow import Workflow, WorkflowRun

        workflow_run = db.session.get(WorkflowRun, form_model.workflow_run_id)
        if workflow_run is None or workflow_run.tenant_id != current_tenant_id:
            raise NotFoundError("Workflow run not found")

        if workflow_run.app_id:
            app = db.session.get(App, workflow_run.app_id)
            if app is None or app.tenant_id != current_tenant_id:
                raise NotFoundError("App not found")
            owner_account_id = app.created_by
        else:
            workflow = db.session.get(Workflow, workflow_run.workflow_id)
            if workflow is None or workflow.tenant_id != current_tenant_id:
                raise NotFoundError("Workflow not found")
            owner_account_id = workflow.created_by

        if owner_account_id != current_user.id:
            raise Forbidden("You do not have permission to access this human input form.")

        return _jsonify_pydantic_model(form.get_definition())


class ConsoleHumanInputFormSubmissionApi(Resource):
    """Console API for submitting human input forms."""

    @account_initialization_required
    @login_required
    def post(self, form_id: str):
        """
        Submit human input form by form ID.

        POST /console/api/form/human_input/<form_id>

        Request body:
        {
            "inputs": {
                "content": "User input content"
            },
            "action": "Approve"
        }
        """
        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("action", type=str, required=True, location="json")
        args = parser.parse_args()

        # Submit the form
        service = HumanInputService(db.engine)
        service.submit_form_by_id(
            form_id=form_id,
            selected_action_id=args["action"],
            form_data=args["inputs"],
        )

        return jsonify({})


class ConsoleWorkflowEventsApi(Resource):
    """Console API for getting workflow execution events after resume."""

    @account_initialization_required
    @login_required
    def get(self, workflow_run_id: str):
        """
        Get workflow execution events stream after resume.

        GET /console/api/workflow/<task_id>/events

        Returns Server-Sent Events stream.
        """

        events = 

        def generate_events() -> Generator[str, None, None]:
            """Generate SSE events for workflow execution."""
            try:
                # TODO: Implement actual event streaming
                # This would connect to the workflow execution engine
                # and stream real-time events

                # For demo purposes, send a basic event
                yield f"data: {{'event': 'workflow_resumed', 'task_id': '{task_id}'}}\n\n"

                # In real implementation, this would:
                # 1. Connect to workflow execution engine
                # 2. Stream real-time execution events
                # 3. Handle client disconnection
                # 4. Clean up resources on completion

            except Exception as e:
                logger.exception("Error streaming events for task %s", task_id)
                yield f"data: {{'error': 'Stream error: {str(e)}'}}\n\n"

        return Response(
            generate_events(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )


class ConsoleWorkflowPauseDetailsApi(Resource):
    """Console API for getting workflow pause details."""

    @account_initialization_required
    @login_required
    def get(self, workflow_run_id: str):
        """
        Get workflow pause details.

        GET /console/api/workflow/<workflow_run_id>/pause-details

        Returns information about why and where the workflow is paused.
        """
        from models.workflow import WorkflowRun

        # Query WorkflowRun to determine if workflow is suspended
        workflow_run = db.session.get(WorkflowRun, workflow_run_id)
        if not workflow_run:
            raise NotFoundError("Workflow run not found")

        # Check if workflow is suspended
        is_suspended = workflow_run.status == "running" and workflow_run.pause_details is not None

        if not is_suspended:
            return {"is_suspended": False, "paused_at": None, "paused_nodes": [], "pending_human_inputs": []}, 200

        # Get pending Human Input forms for this workflow run
        service = HumanInputFormService(db.session())
        pending_forms = service.get_pending_forms_for_workflow_run(workflow_run_id)

        # Build response
        response = {
            "is_suspended": True,
            "paused_at": workflow_run.created_at.isoformat() + "Z" if workflow_run.created_at else None,
            "paused_nodes": [],
            "pending_human_inputs": [],
        }

        # Add pending human input forms
        for form in pending_forms:
            form_definition = json.loads(form.form_definition) if form.form_definition else {}
            response["pending_human_inputs"].append(
                {
                    "form_id": form.id,
                    "node_id": form_definition.get("node_id", "unknown"),
                    "node_title": form_definition.get("title", "Human Input"),
                    "created_at": form.created_at.isoformat() + "Z" if form.created_at else None,
                }
            )

            # Also add to paused_nodes for backward compatibility
            response["paused_nodes"].append(
                {
                    "node_id": form_definition.get("node_id", "unknown"),
                    "node_title": form_definition.get("title", "Human Input"),
                    "pause_type": {"type": "human_input", "form_id": form.id},
                }
            )

        return response, 200


# Register the APIs
api.add_resource(ConsoleHumanInputFormApi, "/form/human_input/<string:form_id>")
api.add_resource(ConsoleHumanInputFormSubmissionApi, "/form/human_input/<string:form_id>", methods=["POST"])
api.add_resource(ConsoleWorkflowEventsApi, "/workflow/<string:workflow_run_id>/events")
api.add_resource(ConsoleWorkflowPauseDetailsApi, "/workflow/<string:workflow_run_id>/pause-details")
