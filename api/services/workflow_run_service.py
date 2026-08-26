import threading
from dataclasses import dataclass
from datetime import datetime
from typing import TypedDict

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

import contexts
from core.workflow.human_input_forms import load_form_tokens_by_form_id as _load_form_tokens_by_form_id
from core.workflow.nodes.human_input.pause_reason import HumanInputRequired
from graphon.enums import WorkflowExecutionStatus
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from machinery.context import RequestContext
from models import (
    Message,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
)
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory
from services.workflow_node_execution_trace_service import (
    WorkflowNodeExecutionTrace,
    assemble_workflow_node_execution_traces,
)


class WorkflowRunListArgs(TypedDict, total=False):
    """Expected shape of the args dict passed to workflow run pagination methods."""

    limit: int
    last_id: str
    status: str


@dataclass(frozen=True, slots=True)
class WorkflowRunPausedNode:
    node_id: str
    node_title: str
    form_id: str
    form_token: str | None


@dataclass(frozen=True, slots=True)
class WorkflowRunPauseDetails:
    paused_at: datetime | None
    paused_nodes: tuple[WorkflowRunPausedNode, ...]


class WorkflowRunService:
    _session_factory: sessionmaker[Session]
    _workflow_run_repo: APIWorkflowRunRepository

    def __init__(self, session_factory: Engine | sessionmaker[Session]):
        """Initialize WorkflowRunService with repository dependencies."""
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)

        self._session_factory = session_factory
        self._node_execution_service_repo = DifyAPIRepositoryFactory.create_api_workflow_node_execution_repository(
            self._session_factory
        )
        self._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)

    def get_paginate_advanced_chat_workflow_runs(
        self,
        context: RequestContext,
        *,
        app_id: str,
        args: WorkflowRunListArgs,
        triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    ) -> InfiniteScrollPagination:
        """
        Get advanced chat app workflow run list

        :param context: admitted Console request context
        :param app_id: app id
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

        pagination = self.get_paginate_workflow_runs(
            context,
            app_id=app_id,
            args=args,
            triggered_from=triggered_from,
        )

        # Batch-load the associated Message for every run in a single query to avoid
        # an N+1 pattern: the deprecated WorkflowRun.message property issues one query
        # per run. The filter matches that property exactly (app_id + workflow_run_id).
        workflow_runs = pagination.data
        run_ids = [workflow_run.id for workflow_run in workflow_runs]
        messages_by_run_id: dict[str, Message] = {}
        if run_ids:
            with self._session_factory() as session:
                messages = session.scalars(
                    select(Message).where(
                        Message.app_id == app_id,
                        Message.workflow_run_id.in_(run_ids),
                    )
                ).all()
            for loaded_message in messages:
                run_id = loaded_message.workflow_run_id
                if run_id is None:
                    continue
                # setdefault mirrors scalar()'s single-row-per-run semantics.
                messages_by_run_id.setdefault(run_id, loaded_message)

        with_message_workflow_runs = []
        for workflow_run in workflow_runs:
            message = messages_by_run_id.get(workflow_run.id)
            with_message_workflow_run = WorkflowWithMessage(workflow_run=workflow_run)
            if message:
                with_message_workflow_run.message_id = message.id
                with_message_workflow_run.conversation_id = message.conversation_id

            with_message_workflow_runs.append(with_message_workflow_run)

        pagination.data = with_message_workflow_runs
        return pagination

    def get_paginate_workflow_runs(
        self,
        context: RequestContext,
        *,
        app_id: str,
        args: WorkflowRunListArgs,
        triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    ) -> InfiniteScrollPagination:
        """
        Get workflow run list

        :param context: admitted Console request context
        :param app_id: app id
        :param args: request args
        :param triggered_from: workflow run triggered from (default: DEBUGGING)
        """
        limit = int(args.get("limit", 20))
        last_id = args.get("last_id")
        status = args.get("status")

        return self._workflow_run_repo.get_paginated_workflow_runs(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            triggered_from=triggered_from,
            limit=limit,
            last_id=last_id,
            status=status,
        )

    def get_workflow_run(self, context: RequestContext, *, app_id: str, run_id: str) -> WorkflowRun | None:
        """
        Get workflow run detail

        :param context: admitted Console request context
        :param app_id: app id
        :param run_id: workflow run id
        """
        return self._workflow_run_repo.get_workflow_run_by_id(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            run_id=run_id,
        )

    def get_workflow_runs_count(
        self,
        context: RequestContext,
        *,
        app_id: str,
        status: str | None = None,
        time_range: str | None = None,
        triggered_from: WorkflowRunTriggeredFrom = WorkflowRunTriggeredFrom.DEBUGGING,
    ) -> dict[str, int]:
        """
        Get workflow runs count statistics

        :param context: admitted Console request context
        :param app_id: app id
        :param status: optional status filter
        :param time_range: optional time range filter (e.g., "7d", "4h", "30m", "30s")
        :param triggered_from: workflow run triggered from (default: DEBUGGING)
        :return: dict with total and status counts
        """
        return self._workflow_run_repo.get_workflow_runs_count(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            triggered_from=triggered_from,
            status=status,
            time_range=time_range,
        )

    def get_workflow_run_node_executions(
        self,
        context: RequestContext,
        *,
        app_id: str,
        run_id: str,
    ) -> list[WorkflowNodeExecutionTrace]:
        """
        Get workflow run node execution list
        """
        workflow_run = self.get_workflow_run(context, app_id=app_id, run_id=run_id)

        contexts.plugin_tool_providers.set({})
        contexts.plugin_tool_providers_lock.set(threading.Lock())

        if not workflow_run:
            return []

        node_executions = self._node_execution_service_repo.get_executions_by_workflow_run(
            tenant_id=self._workspace_id(context),
            app_id=app_id,
            workflow_run_id=run_id,
        )
        return assemble_workflow_node_execution_traces(node_executions, self._node_execution_service_repo)

    def get_pause_details(
        self,
        context: RequestContext,
        *,
        workflow_run_id: str,
    ) -> WorkflowRunPauseDetails | None:
        workspace_id = self._workspace_id(context)
        workflow_run = self._workflow_run_repo.get_workflow_run_by_id_and_tenant_id(
            tenant_id=workspace_id,
            run_id=workflow_run_id,
        )
        if workflow_run is None:
            return None
        if workflow_run.status != WorkflowExecutionStatus.PAUSED:
            return WorkflowRunPauseDetails(paused_at=None, paused_nodes=())

        pause_entity = self._workflow_run_repo.get_workflow_pause(workflow_run_id)
        pause_reasons = pause_entity.get_pause_reasons() if pause_entity else []
        human_input_reasons: list[HumanInputRequired] = []
        for reason in pause_reasons:
            if not isinstance(reason, HumanInputRequired):
                raise AssertionError("unimplemented.")
            human_input_reasons.append(reason)

        form_tokens_by_form_id: dict[str, str] = {}
        if human_input_reasons:
            with self._session_factory() as session:
                form_tokens_by_form_id = _load_form_tokens_by_form_id(
                    [reason.form_id for reason in human_input_reasons],
                    session=session,
                )

        return WorkflowRunPauseDetails(
            paused_at=pause_entity.paused_at if pause_entity else None,
            paused_nodes=tuple(
                WorkflowRunPausedNode(
                    node_id=reason.node_id,
                    node_title=reason.node_title,
                    form_id=reason.form_id,
                    form_token=form_tokens_by_form_id.get(reason.form_id),
                )
                for reason in human_input_reasons
            ),
        )

    @staticmethod
    def _workspace_id(context: RequestContext) -> str:
        if context.active_workspace_id is None:
            raise RuntimeError("Console account admission did not resolve an active workspace")
        return context.active_workspace_id
