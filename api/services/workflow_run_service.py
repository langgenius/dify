from typing import Optional

from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models.enums import WorkflowRunTriggeredFrom
from models.model import App
from models.workflow import (
    WorkflowNodeExecution,
    WorkflowNodeExecutionTriggeredFrom,
    WorkflowRun,
)


class WorkflowRunService:
    def get_paginate_advanced_chat_workflow_runs(self, app_model: App, args: dict) -> InfiniteScrollPagination:
        """
        Get advanced chat app workflow run list
        Only return triggered_from == advanced_chat

        :param app_model: app model
        :param args: request args
        """

        class WorkflowWithMessage:
            message_id: str
            conversation_id: str

            def __init__(self, workflow_run: WorkflowRun):
                self._workflow_run = workflow_run

            def __getattr__(self, item):
                return getattr(self._workflow_run, item)

        pagination = self.get_paginate_workflow_runs(app_model, args)

        with_message_workflow_runs = []
        for workflow_run in pagination.data:
            message = workflow_run.message
            with_message_workflow_run = WorkflowWithMessage(workflow_run=workflow_run)
            if message:
                with_message_workflow_run.message_id = message.id
                with_message_workflow_run.conversation_id = message.conversation_id

            with_message_workflow_runs.append(with_message_workflow_run)

        pagination.data = with_message_workflow_runs
        return pagination

    def get_paginate_workflow_runs(self, app_model: App, args: dict) -> InfiniteScrollPagination:
        """
        Get debug workflow run list
        Only return triggered_from == debugging

        :param app_model: app model
        :param args: request args
        """
        limit = int(args.get("limit", 20))

        base_query = db.session.query(WorkflowRun).filter(
            WorkflowRun.tenant_id == app_model.tenant_id,
            WorkflowRun.app_id == app_model.id,
            WorkflowRun.triggered_from == WorkflowRunTriggeredFrom.DEBUGGING.value,
        )

        if args.get("last_id"):
            last_workflow_run = base_query.filter(
                WorkflowRun.id == args.get("last_id"),
            ).first()

            if not last_workflow_run:
                raise ValueError("Last workflow run not exists")

            workflow_runs = (
                base_query.filter(
                    WorkflowRun.created_at < last_workflow_run.created_at, WorkflowRun.id != last_workflow_run.id
                )
                .order_by(WorkflowRun.created_at.desc())
                .limit(limit)
                .all()
            )
        else:
            workflow_runs = base_query.order_by(WorkflowRun.created_at.desc()).limit(limit).all()

        has_more = False
        if len(workflow_runs) == limit:
            current_page_first_workflow_run = workflow_runs[-1]
            rest_count = base_query.filter(
                WorkflowRun.created_at < current_page_first_workflow_run.created_at,
                WorkflowRun.id != current_page_first_workflow_run.id,
            ).count()

            if rest_count > 0:
                has_more = True

        return InfiniteScrollPagination(data=workflow_runs, limit=limit, has_more=has_more)

    def get_workflow_run(self, app_model: App, run_id: str) -> Optional[WorkflowRun]:
        """
        Get workflow run detail

        :param app_model: app model
        :param run_id: workflow run id
        """
        workflow_run = (
            db.session.query(WorkflowRun)
            .filter(
                WorkflowRun.tenant_id == app_model.tenant_id,
                WorkflowRun.app_id == app_model.id,
                WorkflowRun.id == run_id,
            )
            .first()
        )

        return workflow_run

    def get_workflow_run_node_executions(self, app_model: App, run_id: str) -> list[WorkflowNodeExecution]:
        """
        Get workflow run node execution list
        """
        workflow_run = self.get_workflow_run(app_model, run_id)

        if not workflow_run:
            return []

        node_executions = (
            db.session.query(WorkflowNodeExecution)
            .filter(
                WorkflowNodeExecution.tenant_id == app_model.tenant_id,
                WorkflowNodeExecution.app_id == app_model.id,
                WorkflowNodeExecution.workflow_id == workflow_run.workflow_id,
                WorkflowNodeExecution.triggered_from == WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN.value,
                WorkflowNodeExecution.workflow_run_id == run_id,
            )
            .order_by(WorkflowNodeExecution.index.desc())
            .all()
        )

        return node_executions
