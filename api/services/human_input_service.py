import logging
from collections.abc import Mapping
from typing import Any

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.human_input_reposotiry import HumanInputFormReadRepository, HumanInputFormRecord
from core.workflow.nodes.human_input.entities import FormDefinition
from libs.exception import BaseHTTPException
from models.account import Account
from models.human_input import RecipientType
from models.model import App, AppMode
from models.workflow import WorkflowRun
from repositories.sqlalchemy_workflow_trigger_log_repository import SQLAlchemyWorkflowTriggerLogRepository
from services.workflow.entities import WorkflowResumeTaskData
from tasks.app_generate.workflow_execute_task import resume_chatflow_execution
from tasks.async_workflow_tasks import resume_workflow_execution


class Form:
    def __init__(self, record: HumanInputFormRecord):
        self._record = record

    def get_definition(self) -> FormDefinition:
        return self._record.definition

    @property
    def submitted(self) -> bool:
        return self._record.submitted

    @property
    def id(self) -> str:
        return self._record.form_id

    @property
    def workflow_run_id(self) -> str:
        return self._record.workflow_run_id

    @property
    def recipient_id(self) -> str | None:
        return self._record.recipient_id

    @property
    def recipient_type(self) -> RecipientType | None:
        return self._record.recipient_type


class HumanInputError(Exception):
    pass


class FormSubmittedError(HumanInputError, BaseHTTPException):
    error_code = "human_input_form_submitted"
    description = "This form has already been submitted by another user, form_id={form_id}"
    code = 412

    def __init__(self, form_id: str):
        description = self.description.format(form_id=form_id)
        super().__init__(description=description)


class FormNotFoundError(HumanInputError, BaseHTTPException):
    error_code = "human_input_form_not_found"
    code = 404


class WebAppDeliveryNotEnabledError(HumanInputError, BaseException):
    pass


logger = logging.getLogger(__name__)


class HumanInputService:
    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        form_repository: HumanInputFormReadRepository | None = None,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory
        self._form_repository = form_repository or HumanInputFormReadRepository(session_factory)

    def get_form_by_token(self, form_token: str) -> Form | None:
        record = self._form_repository.get_by_token(form_token)
        if record is None:
            return None
        return Form(record)

    def get_form_by_id(self, form_id: str, recipient_type: RecipientType = RecipientType.WEBAPP) -> Form | None:
        record = self._form_repository.get_by_form_id_and_recipient_type(
            form_id=form_id,
            recipient_type=recipient_type,
        )
        if record is None:
            return None
        return Form(record)

    def get_form_definition_by_id(self, form_id: str) -> Form | None:
        form = self.get_form_by_id(form_id, recipient_type=RecipientType.WEBAPP)
        if form is None:
            return None
        self._ensure_not_submitted(form)
        return form

    def get_form_definition_by_token(self, recipient_type: RecipientType, form_token: str) -> Form | None:
        form = self.get_form_by_token(form_token)
        if form is None or form.recipient_type != recipient_type:
            return None
        self._ensure_not_submitted(form)
        return form

    def submit_form_by_id(
        self,
        form_id: str,
        selected_action_id: str,
        form_data: Mapping[str, Any],
        user: Account | None = None,
    ):
        form = self.get_form_by_id(form_id, recipient_type=RecipientType.WEBAPP)
        if form is None:
            raise WebAppDeliveryNotEnabledError()

        self._ensure_not_submitted(form)

        result = self._form_repository.mark_submitted(
            form_id=form.id,
            recipient_id=form.recipient_id,
            selected_action_id=selected_action_id,
            form_data=form_data,
            submission_user_id=user.id if user else None,
            submission_end_user_id=None,
        )

        self._enqueue_resume(result.workflow_run_id)

    def submit_form_by_token(
        self,
        recipient_type: RecipientType,
        form_token: str,
        selected_action_id: str,
        form_data: Mapping[str, Any],
        submission_end_user_id: str | None = None,
    ):
        form = self.get_form_by_token(form_token)
        if form is None or form.recipient_type != recipient_type:
            raise WebAppDeliveryNotEnabledError()

        self._ensure_not_submitted(form)

        result = self._form_repository.mark_submitted(
            form_id=form.id,
            recipient_id=form.recipient_id,
            selected_action_id=selected_action_id,
            form_data=form_data,
            submission_user_id=None,
            submission_end_user_id=submission_end_user_id,
        )

        self._enqueue_resume(result.workflow_run_id)

    def _ensure_not_submitted(self, form: Form) -> None:
        if form.submitted:
            raise FormSubmittedError(form.id)

    def _enqueue_resume(self, workflow_run_id: str) -> None:
        with self._session_factory(expire_on_commit=False) as session:
            trigger_log_repo = SQLAlchemyWorkflowTriggerLogRepository(session)
            trigger_log = trigger_log_repo.get_by_workflow_run_id(workflow_run_id)

        if trigger_log is not None:
            payload = WorkflowResumeTaskData(
                workflow_trigger_log_id=trigger_log.id,
                workflow_run_id=workflow_run_id,
            )

            try:
                resume_workflow_execution.apply_async(
                    kwargs={"task_data_dict": payload.model_dump()},
                    queue=trigger_log.queue_name,
                )
            except Exception:  # pragma: no cover
                logger.exception("Failed to enqueue resume task for workflow run %s", workflow_run_id)
            return

        if self._enqueue_chatflow_resume(workflow_run_id):
            return

        logger.warning("No workflow trigger log bound to workflow run %s; skipping resume dispatch", workflow_run_id)

    def _enqueue_chatflow_resume(self, workflow_run_id: str) -> bool:
        with self._session_factory(expire_on_commit=False) as session:
            workflow_run = session.get(WorkflowRun, workflow_run_id)
            if workflow_run is None:
                return False

            app = session.get(App, workflow_run.app_id)

        if app is None:
            return False

        if app.mode != AppMode.ADVANCED_CHAT.value:
            return False

        try:
            resume_chatflow_execution.apply_async(
                kwargs={"payload": {"workflow_run_id": workflow_run_id}},
                queue="chatflow_execute",
            )
        except Exception:  # pragma: no cover
            logger.exception("Failed to enqueue chatflow resume for workflow run %s", workflow_run_id)
            return False

        return True
