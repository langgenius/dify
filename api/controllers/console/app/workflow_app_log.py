from dateutil.parser import isoparse
from flask_restx import Resource, marshal_with, reqparse
from flask_restx.inputs import int_range
from sqlalchemy.orm import Session

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.workflow.enums import WorkflowExecutionStatus
from extensions.ext_database import db
from fields.workflow_app_log_fields import workflow_app_log_pagination_fields
from libs.login import login_required
from models import App
from models.model import AppMode
from services.workflow_app_service import WorkflowAppService


@console_ns.route("/apps/<uuid:app_id>/workflow-app-logs")
class WorkflowAppLogApi(Resource):
    @api.doc("get_workflow_app_logs")
    @api.doc(description="Get workflow application execution logs")
    @api.doc(params={"app_id": "Application ID"})
    @api.doc(
        params={
            "keyword": "Search keyword for filtering logs",
            "status": "Filter by execution status (succeeded, failed, stopped, partial-succeeded)",
            "created_at__before": "Filter logs created before this timestamp",
            "created_at__after": "Filter logs created after this timestamp",
            "created_by_end_user_session_id": "Filter by end user session ID",
            "created_by_account": "Filter by account",
            "page": "Page number (1-99999)",
            "limit": "Number of items per page (1-100)",
        }
    )
    @api.response(200, "Workflow app logs retrieved successfully", workflow_app_log_pagination_fields)
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @marshal_with(workflow_app_log_pagination_fields)
    def get(self, app_model: App):
        """
        Get workflow app logs
        """
        parser = (
            reqparse.RequestParser()
            .add_argument("keyword", type=str, location="args")
            .add_argument(
                "status", type=str, choices=["succeeded", "failed", "stopped", "partial-succeeded"], location="args"
            )
            .add_argument(
                "created_at__before", type=str, location="args", help="Filter logs created before this timestamp"
            )
            .add_argument(
                "created_at__after", type=str, location="args", help="Filter logs created after this timestamp"
            )
            .add_argument(
                "created_by_end_user_session_id",
                type=str,
                location="args",
                required=False,
                default=None,
            )
            .add_argument(
                "created_by_account",
                type=str,
                location="args",
                required=False,
                default=None,
            )
            .add_argument("page", type=int_range(1, 99999), default=1, location="args")
            .add_argument("limit", type=int_range(1, 100), default=20, location="args")
        )
        args = parser.parse_args()

        args.status = WorkflowExecutionStatus(args.status) if args.status else None
        if args.created_at__before:
            args.created_at__before = isoparse(args.created_at__before)

        if args.created_at__after:
            args.created_at__after = isoparse(args.created_at__after)

        # get paginate workflow app logs
        workflow_app_service = WorkflowAppService()
        with Session(db.engine) as session:
            workflow_app_log_pagination = workflow_app_service.get_paginate_workflow_app_logs(
                session=session,
                app_model=app_model,
                keyword=args.keyword,
                status=args.status,
                created_at_before=args.created_at__before,
                created_at_after=args.created_at__after,
                page=args.page,
                limit=args.limit,
                created_by_end_user_session_id=args.created_by_end_user_session_id,
                created_by_account=args.created_by_account,
            )

            return workflow_app_log_pagination
