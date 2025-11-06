"""
Console/Studio Human Input Form APIs.
"""

import json
import logging

from flask import g, jsonify
from flask_restx import Resource, reqparse

from controllers.console import api
from controllers.console.wraps import account_initialization_required
from controllers.web.error import NotFoundError
from extensions.ext_database import db
from libs.login import login_required
from models.human_input import HumanInputSubmissionType
from services.human_input_form_service import (
    HumanInputFormAlreadySubmittedError,
    HumanInputFormExpiredError,
    HumanInputFormNotFoundError,
    HumanInputFormService,
    InvalidFormDataError,
)

logger = logging.getLogger(__name__)


class ConsoleHumanInputFormApi(Resource):
    """Console API for getting human input form definition."""

    @account_initialization_required
    @login_required
    def get(self, form_id: str):
        """
        Get human input form definition by form ID.

        GET /console/api/form/human_input/<form_id>
        """
        try:
            service = HumanInputFormService(db.session())
            form_definition = service.get_form_definition(identifier=form_id, is_token=False, include_site_info=False)
            return form_definition, 200

        except HumanInputFormNotFoundError:
            raise NotFoundError("Form not found")
        except HumanInputFormExpiredError:
            return jsonify(
                {"error_code": "human_input_form_expired", "description": "Human input form has expired"}
            ), 400
        except HumanInputFormAlreadySubmittedError:
            return jsonify(
                {
                    "error_code": "human_input_form_submitted",
                    "description": "Human input form has already been submitted",
                }
            ), 400


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

        try:
            # Submit the form
            service = HumanInputFormService(db.session())
            service.submit_form(
                identifier=form_id,
                form_data=args["inputs"],
                action=args["action"],
                is_token=False,
                submission_type=HumanInputSubmissionType.web_form,
                submission_user_id=g.current_user.id,
            )

            return {}, 200

        except HumanInputFormNotFoundError:
            raise NotFoundError("Form not found")
        except HumanInputFormExpiredError:
            return jsonify(
                {"error_code": "human_input_form_expired", "description": "Human input form has expired"}
            ), 400
        except HumanInputFormAlreadySubmittedError:
            return jsonify(
                {
                    "error_code": "human_input_form_submitted",
                    "description": "Human input form has already been submitted",
                }
            ), 400
        except InvalidFormDataError as e:
            return jsonify({"error_code": "invalid_form_data", "description": e.message}), 400


class ConsoleWorkflowResumeWaitApi(Resource):
    """Console API for long-polling workflow resume wait."""

    @account_initialization_required
    @login_required
    def get(self, task_id: str):
        """
        Get workflow execution resume notification.

        GET /console/api/workflow/<task_id>/resume-wait

        This is a long-polling API that waits for workflow to resume from paused state.
        """
        import time

        # TODO: Implement actual workflow status checking
        # For now, return a basic response

        timeout = 30  # 30 seconds timeout for demo
        start_time = time.time()

        while time.time() - start_time < timeout:
            # TODO: Check workflow status from database/cache
            # workflow_status = workflow_service.get_status(task_id)

            # For demo purposes, simulate different states
            # In real implementation, this would check the actual workflow state
            workflow_status = "paused"  # or "running" or "ended"

            if workflow_status == "running":
                return {"status": "running"}, 200
            elif workflow_status == "ended":
                return {"status": "ended"}, 200

            time.sleep(1)  # Poll every second

        # Return paused status if timeout reached
        return {"status": "paused"}, 200


class ConsoleWorkflowEventsApi(Resource):
    """Console API for getting workflow execution events after resume."""

    @account_initialization_required
    @login_required
    def get(self, task_id: str):
        """
        Get workflow execution events stream after resume.

        GET /console/api/workflow/<task_id>/events

        Returns Server-Sent Events stream.
        """
        from collections.abc import Generator

        from flask import Response

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
api.add_resource(ConsoleWorkflowResumeWaitApi, "/workflow/<string:task_id>/resume-wait")
api.add_resource(ConsoleWorkflowEventsApi, "/workflow/<string:task_id>/events")
api.add_resource(ConsoleWorkflowPauseDetailsApi, "/workflow/<string:workflow_run_id>/pause-details")
