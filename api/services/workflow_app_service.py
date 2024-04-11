from flask_sqlalchemy.pagination import Pagination
from sqlalchemy import and_, or_

from extensions.ext_database import db
from models import CreatedByRole
from models.model import App, EndUser
from models.workflow import WorkflowAppLog, WorkflowRun, WorkflowRunStatus


class WorkflowAppService:

    def get_paginate_workflow_app_logs(self, app_model: App, args: dict) -> Pagination:
        """
        Get paginate workflow app logs
        :param app: app model
        :param args: request args
        :return:
        """
        query = (
            db.select(WorkflowAppLog)
            .where(
                WorkflowAppLog.tenant_id == app_model.tenant_id,
                WorkflowAppLog.app_id == app_model.id
            )
        )

        status = WorkflowRunStatus.value_of(args.get('status')) if args.get('status') else None
        if args['keyword'] or status:
            query = query.join(
                WorkflowRun, WorkflowRun.id == WorkflowAppLog.workflow_run_id
            )

        if args['keyword']:
            keyword_val = f"%{args['keyword'][:30]}%"
            keyword_conditions = [
                WorkflowRun.inputs.ilike(keyword_val),
                WorkflowRun.outputs.ilike(keyword_val),
                # filter keyword by end user session id if created by end user role
                and_(WorkflowRun.created_by_role == 'end_user', EndUser.session_id.ilike(keyword_val))
            ]

            query = query.outerjoin(
                EndUser,
                and_(WorkflowRun.created_by == EndUser.id, WorkflowRun.created_by_role == CreatedByRole.END_USER.value)
            ).filter(or_(*keyword_conditions))

        if status:
            # join with workflow_run and filter by status
            query = query.filter(
                WorkflowRun.status == status.value
            )

        query = query.order_by(WorkflowAppLog.created_at.desc())

        pagination = db.paginate(
            query,
            page=args['page'],
            per_page=args['limit'],
            error_out=False
        )

        return pagination
