from dateutil.parser import isoparse
from flask_restful import Resource, marshal_with, reqparse
from flask_restful.inputs import int_range
from sqlalchemy.orm import Session

from controllers.console import api
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from extensions.ext_database import db
from fields.workflow_app_log_fields import workflow_app_log_pagination_fields
from libs.login import login_required
from models import App
from models.model import AppMode
from models.workflow import WorkflowRunStatus
from services.workflow_app_service import WorkflowAppService


class WorkflowAppLogApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.WORKFLOW])
    @marshal_with(workflow_app_log_pagination_fields)
    def get(self, app_model: App):
        """
        Get workflow app logs
        """
        parser = reqparse.RequestParser()
        parser.add_argument("keyword", type=str, location="args")
        parser.add_argument("status", type=str, choices=["succeeded", "failed", "stopped"], location="args")
        parser.add_argument(
            "created_at__before", type=str, location="args", help="Filter logs created before this timestamp"
        )
        parser.add_argument(
            "created_at__after", type=str, location="args", help="Filter logs created after this timestamp"
        )
        parser.add_argument("page", type=int_range(1, 99999), default=1, location="args")
        parser.add_argument("limit", type=int_range(1, 100), default=20, location="args")
        args = parser.parse_args()

        args.status = WorkflowRunStatus(args.status) if args.status else None
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
            )

            return workflow_app_log_pagination


api.add_resource(WorkflowAppLogApi, "/apps/<uuid:app_id>/workflow-app-logs")
