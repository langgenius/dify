from typing import cast

from flask_restx import Resource, marshal_with, reqparse
from flask_restx.inputs import int_range

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from fields.workflow_run_fields import (
    advanced_chat_workflow_run_pagination_fields,
    workflow_run_count_fields,
    workflow_run_detail_fields,
    workflow_run_node_execution_list_fields,
    workflow_run_pagination_fields,
)
from libs.custom_inputs import time_duration
from libs.helper import uuid_value
from libs.login import current_user, login_required
from models import Account, App, AppMode, EndUser, WorkflowRunTriggeredFrom
from services.workflow_run_service import WorkflowRunService

# Workflow run status choices for filtering
WORKFLOW_RUN_STATUS_CHOICES = ["running", "succeeded", "failed", "stopped", "partial-succeeded"]


def _parse_workflow_run_list_args():
    """
    Parse common arguments for workflow run list endpoints.

    Returns:
        Parsed arguments containing last_id, limit, status, and triggered_from filters
    """
    parser = reqparse.RequestParser()
    parser.add_argument("last_id", type=uuid_value, location="args")
    parser.add_argument("limit", type=int_range(1, 100), required=False, default=20, location="args")
    parser.add_argument(
        "status",
        type=str,
        choices=WORKFLOW_RUN_STATUS_CHOICES,
        location="args",
        required=False,
    )
    parser.add_argument(
        "triggered_from",
        type=str,
        choices=["debugging", "app-run"],
        location="args",
        required=False,
        help="Filter by trigger source: debugging or app-run",
    )
    return parser.parse_args()


def _parse_workflow_run_count_args():
    """
    Parse common arguments for workflow run count endpoints.

    Returns:
        Parsed arguments containing status, time_range, and triggered_from filters
    """
    parser = reqparse.RequestParser()
    parser.add_argument(
        "status",
        type=str,
        choices=WORKFLOW_RUN_STATUS_CHOICES,
        location="args",
        required=False,
    )
    parser.add_argument(
        "time_range",
        type=time_duration,
        location="args",
        required=False,
        help="Time range filter (e.g., 7d, 4h, 30m, 30s)",
    )
    parser.add_argument(
        "triggered_from",
        type=str,
        choices=["debugging", "app-run"],
        location="args",
        required=False,
        help="Filter by trigger source: debugging or app-run",
    )
    return parser.parse_args()


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflow-runs")
class AdvancedChatAppWorkflowRunListApi(Resource):
    @api.doc("get_advanced_chat_workflow_runs")
    @api.doc(description="Get advanced chat workflow run list")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"last_id": "Last run ID for pagination", "limit": "Number of items per page (1-100)"})
    @api.doc(params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"})
    @api.doc(params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"})
    @api.response(200, "Workflow runs retrieved successfully", advanced_chat_workflow_run_pagination_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @marshal_with(advanced_chat_workflow_run_pagination_fields)
    def get(self, app_model: App):
        """
        Get advanced chat app workflow run list
        """
        args = _parse_workflow_run_list_args()

        # Default to DEBUGGING if not specified
        triggered_from = (
            WorkflowRunTriggeredFrom(args.get("triggered_from"))
            if args.get("triggered_from")
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_paginate_advanced_chat_workflow_runs(
            app_model=app_model, args=args, triggered_from=triggered_from
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/advanced-chat/workflow-runs/count")
class AdvancedChatAppWorkflowRunCountApi(Resource):
    @api.doc("get_advanced_chat_workflow_runs_count")
    @api.doc(description="Get advanced chat workflow runs count statistics")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"})
    @api.doc(
        params={
            "time_range": (
                "Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), "
                "30m (30 minutes), 30s (30 seconds). Filters by created_at field."
            )
        }
    )
    @api.doc(params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"})
    @api.response(200, "Workflow runs count retrieved successfully", workflow_run_count_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT])
    @marshal_with(workflow_run_count_fields)
    def get(self, app_model: App):
        """
        Get advanced chat workflow runs count statistics
        """
        args = _parse_workflow_run_count_args()

        # Default to DEBUGGING if not specified
        triggered_from = (
            WorkflowRunTriggeredFrom(args.get("triggered_from"))
            if args.get("triggered_from")
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_runs_count(
            app_model=app_model,
            status=args.get("status"),
            time_range=args.get("time_range"),
            triggered_from=triggered_from,
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/workflow-runs")
class WorkflowRunListApi(Resource):
    @api.doc("get_workflow_runs")
    @api.doc(description="Get workflow run list")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"last_id": "Last run ID for pagination", "limit": "Number of items per page (1-100)"})
    @api.doc(params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"})
    @api.doc(params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"})
    @api.response(200, "Workflow runs retrieved successfully", workflow_run_pagination_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_pagination_fields)
    def get(self, app_model: App):
        """
        Get workflow run list
        """
        args = _parse_workflow_run_list_args()

        # Default to DEBUGGING for workflow if not specified (backward compatibility)
        triggered_from = (
            WorkflowRunTriggeredFrom(args.get("triggered_from"))
            if args.get("triggered_from")
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_paginate_workflow_runs(
            app_model=app_model, args=args, triggered_from=triggered_from
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/count")
class WorkflowRunCountApi(Resource):
    @api.doc("get_workflow_runs_count")
    @api.doc(description="Get workflow runs count statistics")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(params={"status": "Filter by status (optional): running, succeeded, failed, stopped, partial-succeeded"})
    @api.doc(
        params={
            "time_range": (
                "Filter by time range (optional): e.g., 7d (7 days), 4h (4 hours), "
                "30m (30 minutes), 30s (30 seconds). Filters by created_at field."
            )
        }
    )
    @api.doc(params={"triggered_from": "Filter by trigger source (optional): debugging or app-run. Default: debugging"})
    @api.response(200, "Workflow runs count retrieved successfully", workflow_run_count_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_count_fields)
    def get(self, app_model: App):
        """
        Get workflow runs count statistics
        """
        args = _parse_workflow_run_count_args()

        # Default to DEBUGGING for workflow if not specified (backward compatibility)
        triggered_from = (
            WorkflowRunTriggeredFrom(args.get("triggered_from"))
            if args.get("triggered_from")
            else WorkflowRunTriggeredFrom.DEBUGGING
        )

        workflow_run_service = WorkflowRunService()
        result = workflow_run_service.get_workflow_runs_count(
            app_model=app_model,
            status=args.get("status"),
            time_range=args.get("time_range"),
            triggered_from=triggered_from,
        )

        return result


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>")
class WorkflowRunDetailApi(Resource):
    @api.doc("get_workflow_run_detail")
    @api.doc(description="Get workflow run detail")
    @api.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @api.response(200, "Workflow run detail retrieved successfully", workflow_run_detail_fields)
    @api.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_detail_fields)
    def get(self, app_model: App, run_id):
        """
        Get workflow run detail
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        workflow_run = workflow_run_service.get_workflow_run(app_model=app_model, run_id=run_id)

        return workflow_run


@console_ns.route("/apps/<uuid:app_id>/workflow-runs/<uuid:run_id>/node-executions")
class WorkflowRunNodeExecutionListApi(Resource):
    @api.doc("get_workflow_run_node_executions")
    @api.doc(description="Get workflow run node execution list")
    @api.doc(params={"app_id": "Application ID", "run_id": "Workflow run ID"})
    @api.response(200, "Node executions retrieved successfully", workflow_run_node_execution_list_fields)
    @api.response(404, "Workflow run not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.ADVANCED_CHAT, AppMode.WORKFLOW])
    @marshal_with(workflow_run_node_execution_list_fields)
    def get(self, app_model: App, run_id):
        """
        Get workflow run node execution list
        """
        run_id = str(run_id)

        workflow_run_service = WorkflowRunService()
        user = cast("Account | EndUser", current_user)
        node_executions = workflow_run_service.get_workflow_run_node_executions(
            app_model=app_model,
            run_id=run_id,
            user=user,
        )

        return {"data": node_executions}
