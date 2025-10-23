import threading
import uuid
from collections.abc import Sequence

from sqlalchemy import Engine, select
from sqlalchemy.orm import selectinload, sessionmaker

import contexts
from core.workflow.enums import WorkflowExecutionStatus
from extensions.ext_database import db
from extensions.ext_storage import storage
from libs.datetime_utils import naive_utc_now
from libs.infinite_scroll_pagination import InfiniteScrollPagination
from libs.uuid_utils import uuidv7
from models import (
    Account,
    App,
    EndUser,
    WorkflowNodeExecutionModel,
    WorkflowRun,
    WorkflowRunTriggeredFrom,
)
from models import (
    WorkflowPause as WorkflowPauseModel,
)
from models.model import UploadFile
from repositories.factory import DifyAPIRepositoryFactory
from services.file_service import FileService


class _WorkflowRunError(Exception):
    pass


class _PauseStateError(_WorkflowRunError):
    pass


class _WorkflowRunNotFoundError(_PauseStateError):
    pass


class _StateFileNotExistError(_PauseStateError):
    pass


class _InvalidStateTransitionError(_WorkflowRunError):
    pass


class WorkflowPauseEntity:
    """
    WorkflowPauseState is the domain model for pause state management.
    """

    def __init__(self, model: WorkflowPauseModel, upload_file: UploadFile) -> None:
        self._model = model
        self._upload_file = upload_file

    @property
    def id(self) -> str:
        return self._model.id

    @property
    def workflow_id(self) -> str:
        return self._model.workflow_id

    @property
    def workflow_run_id(self) -> str:
        """Get the workflow run ID from the model."""
        return self._model.workflow_run_id

    def get_state(self) -> str:
        return storage.load(self._upload_file.key).decode()

    @property
    def resumed_at(self):
        return self._model.resumed_at


class WorkflowRunService:
    _session_factory: sessionmaker
    _file_srv: FileService

    def __init__(self, session_factory: Engine | sessionmaker | None = None, file_service: FileService | None = None):
        """Initialize WorkflowRunService with repository dependencies."""
        if session_factory is None:
            session_factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        elif isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory, expire_on_commit=False)

        self._session_factory = session_factory
        if file_service is None:
            file_service = FileService(self._session_factory)
        self._file_srv = file_service
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

    def get_pause_state(self, workflow_run_id: str) -> WorkflowPauseEntity | None:
        query = (
            select(WorkflowRun)
            .options(selectinload(WorkflowRun.pause).options(selectinload(WorkflowPauseModel.state_file)))
            .where(WorkflowRun.id == workflow_run_id)
        )
        with self._session_factory(expire_on_commit=False) as session:
            run: WorkflowRun | None = session.scalars(query).first()
        if run is None:
            raise _WorkflowRunNotFoundError(f"WorkflowRun not found, id={workflow_run_id}")
        pause_model = run.pause

        if pause_model is None:
            return None
        if pause_model.state_file is None:
            msg = (
                "StateFile not exists for PauseState, WorkflowRun.id={}, "
                "WorkflowPause.id={}, WorkflowPause.state_file_id={}"
            ).format(run.id, pause_model.id, pause_model.state_file_id)
            raise _StateFileNotExistError(msg)
        return WorkflowPauseEntity(model=pause_model, upload_file=pause_model.state_file)

    def save_pause_state(self, workflow_run: WorkflowRun, state_owner_user_id: str, state: str) -> WorkflowPauseEntity:
        """save_pause_state save the serialized runtime state of a workflow execution, updates its status
        and return the saved pause entity.


        """
        if workflow_run.status != WorkflowExecutionStatus.RUNNING:
            msg = ("Only WorkflowRun with RUNNING status can be paused, workflow_run_id={}, current_status={}").format(
                workflow_run.id, workflow_run.status
            )
            raise _InvalidStateTransitionError(msg)

        upload_file = self._file_srv.upload_text(
            text=state,
            text_name=f"workflow-state-{uuid.uuid4()}",
            user_id=state_owner_user_id,
            tenant_id=workflow_run.tenant_id,
        )
        with self._session_factory(expire_on_commit=False) as session, session.begin():
            state_model = WorkflowPauseModel()
            state_model.id = str(uuidv7())
            state_model.tenant_id = workflow_run.tenant_id
            state_model.app_id = workflow_run.app_id
            state_model.workflow_id = workflow_run.workflow_id
            state_model.workflow_run_id = workflow_run.id
            state_model.state_file_id = upload_file.id
            session.add(state_model)
            session.flush()
            db_run = session.get(WorkflowRun, workflow_run.id)
            db_run.pause_id = state_model.id
            db_run.status = WorkflowExecutionStatus.PAUSED
            session.add(db_run)
        return WorkflowPauseEntity(
            model=state_model,
            upload_file=upload_file,
        )

    def mark_as_resumed(self, pause_entity: WorkflowPauseEntity) -> WorkflowRun:
        if pause_entity.resumed_at is not None:
            raise _InvalidStateTransitionError(f"cannot resume an already resumed pause, pause_id={pause_entity.id}")

        with self._session_factory() as session, session.begin():
            pause_model = session.get(WorkflowPauseModel, pause_entity.id)
            if pause_model is None:
                raise _PauseStateError(f"PauseModel not found for pause, pause_id={pause_entity.id}")

            pause_model.resumed_at = naive_utc_now()
            workflow_run: WorkflowRun | None = session.get(WorkflowRun, pause_entity.workflow_run_id)

            if workflow_run is None:
                raise _PauseStateError(f"WorkflowRun not found for pause, pause_id={pause_entity.id}")

            if workflow_run.status != WorkflowExecutionStatus.PAUSED:
                msg = "WorkflowRun is not in PAUSED status, workflow_run_id={}, current_status={}".format(
                    workflow_run.id, workflow_run.status
                )
                raise _InvalidStateTransitionError(msg)
            if workflow_run.pause_id != pause_entity.id:
                msg = "WorkflowRun does not match pause, pause.workflow_run_id={}, workflow_run.pause_id={}".format(
                    pause_entity.workflow_run_id, workflow_run.pause_id
                )
                raise _PauseStateError(msg)

            workflow_run.pause_id = None
            workflow_run.status = WorkflowExecutionStatus.RUNNING
            session.add(workflow_run)
            session.add(pause_model)
        return workflow_run
