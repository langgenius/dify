import threading
from collections.abc import Sequence
from typing import Optional

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
from repositories.factory import DifyAPIRepositoryFactory


class WorkflowRunService:
    def __init__(self):
        """Initialize WorkflowRunService with repository dependencies."""
        session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            session_maker
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)

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
        last_id = args.get("last_id")

        return self._workflow_run_repo.get_paginated_workflow_runs(
            tenant_id=app_model.tenant_id,
            app_id=app_model.id,
            triggered_from=WorkflowRunTriggeredFrom.DEBUGGING.value,
            limit=limit,
            last_id=last_id,
        )

    def get_workflow_run(self, app_model: App, run_id: str) -> Optional[WorkflowRun]:
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
