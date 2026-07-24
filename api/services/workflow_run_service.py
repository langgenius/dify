import threading
from collections.abc import Sequence

from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

import contexts
from extensions.ext_database import db
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from models import (
    Account,
    App,
    EndUser,
    WorkflowNodeExecutionModel,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
)
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory


class WorkflowRunService:
    _session_factory: sessionmaker
    _workflow_run_repo: APIWorkflowRunRepository

    def __init__(self, session_factory: Engine | sessionmaker | None = None):
        """Initialize WorkflowRunService with repository dependencies."""
        if session_factory is None:
            session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        elif isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)

        self._session_factory = session_factory
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            self._session_factory
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)

    def get_paginate_advanced_chat_workflow_runs(
        self, app_model: App, args: dict, triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING
    ) -> InfiniteScrollPagination:
        """
        Get advanced chat app workflow run list

        :param app_model: app model
        :param args: request args
        :param triggered_from: workflow run triggered from (default: DEBUGGING for preview runs)
        """

        class WorkflowWithMessage:
            message_id: str
            conversation_id: str

            def __init__(self, workflow_run: WorkflowRun):
                self._workflow_run = workflow_run

            def __getattr__(self, item):
                return getattr(self._workflow_run, item)

        pagination = self.get_paginate_workflow_runs(app_model, args, triggered_from)

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

    def get_paginate_workflow_runs(
        self, app_model: App, args: dict, triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING
    ) -> InfiniteScrollPagination:
        """
        Get workflow run list

        :param app_model: app model
        :param args: request args
        :param triggered_from: workflow run triggered from (default: DEBUGGING)
        """
        limit = int(args.get("limit", 20))
        last_id = args.get("last_id")
        status = args.get("status")

        return self._workflow_run_repo.get_paginated_workflow_runs(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=triggered_from,
            limit=limit,
            last_id=last_id,
            status=status,
        )

    def get_workflow_run(self, app_model: App, run_id: str) -> WorkflowRun | None:
        """
        Get workflow run detail

        :param app_model: app model
        :param run_id: workflow run id
        """
        return self._workflow_run_repo.get_workflow_run_by_id(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            run_id=run_id,
        )

    def get_workflow_runs_count(
        self,
        app_model: App,
        status: str | None = None,
        time_range: str | None = None,
        triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    ) -> dict[str, int]:
        """
        Get workflow runs count statistics

        :param app_model: app model
        :param status: optional status filter
        :param time_range: optional time range filter (e.g., "7d", "4h", "30m", "30s")
        :param triggered_from: workflow run triggered from (default: DEBUGGING)
        :return: dict with total and status counts
        """
        return self._workflow_run_repo.get_workflow_runs_count(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=triggered_from,
            status=status,
            time_range=time_range,
        )

    def get_workflow_run_node_executions(
        self,
        app_model: App,
        run_id: str,
        user: Account | EndUser,
    ) -> Sequence[WorkflowNodeExecutionModel]:
        """
        Get workflow run node execution list
        """
        workflow_run = self.get_workflow_run(app_model, run_id)

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        if not workflow_run:
            return []

        # Get tenant_id from user
        tenant_id = user.tenant_id if isinstance(user, EndUser) else user.current_tenant_id
        if tenant_id is None:
            raise ValueError("User tenant_id cannot be None")

        return self._node_execution_service_repo.get_executions_by_workflow_run(
            tenant_id=tenant_id,
            app_id=app_model.id,
            workflow_run_id=run_id,
        )
