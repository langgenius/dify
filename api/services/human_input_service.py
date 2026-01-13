import logging
from collections.abc import Mapping
from typing import Any

from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from core.repositories.human_input_reposotiry import (
    HumanInputFormRecord,
    HumanInputFormSubmissionRepository,
)
from core.workflow.nodes.human_input.entities import (
    FormDefinition,
    HumanInputSubmissionValidationError,
    validate_human_input_submission,
)
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from libs.datetime_utils import naive_utc_now
from libs.exception import BaseHTTPException
from models.human_input import RecipientType
from models.model import App, AppMode
from repositories.factory import DifyAPIRepositoryFactory
from tasks.app_generate.workflow_execute_task import APP_EXECUTE_QUEUE, resume_app_execution


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

    @property
    def status(self) -> HumanInputFormStatus:
        return self._record.status

    @property
    def expiration_time(self):
        return self._record.expiration_time


class HumanInputError(Exception):
    pass


class FormSubmittedError(HumanInputError, BaseHTTPException):
    error_code = "human_input_form_submitted"
    description = "This form has already been submitted by another user, form_id={form_id}"
    code = 412

    def __init__(self, form_id: str):
        template = self.description or "This form has already been submitted by another user, form_id={form_id}"
        description = template.format(form_id=form_id)
        super().__init__(description=description)


class FormNotFoundError(HumanInputError, BaseHTTPException):
    error_code = "human_input_form_not_found"
    code = 404


class InvalidFormDataError(HumanInputError, BaseHTTPException):
    error_code = "invalid_form_data"
    code = 400

    def __init__(self, description: str):
        super().__init__(description=description)


class WebAppDeliveryNotEnabledError(HumanInputError, BaseException):
    pass


class FormExpiredError(HumanInputError, BaseHTTPException):
    error_code = "human_input_form_expired"
    code = 412

    def __init__(self, form_id: str):
        super().__init__(description=f"This form has expired, form_id={form_id}")


logger = logging.getLogger(__name__)


class HumanInputService:
    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        form_repository: HumanInputFormSubmissionRepository | None = None,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory
        self._form_repository = form_repository or HumanInputFormSubmissionRepository(session_factory)

    def get_form_by_token(self, form_token: str) -> Form | None:
        record = self._form_repository.get_by_token(form_token)
        if record is None:
            return None
        return Form(record)

    def get_form_definition_by_token(self, recipient_type: RecipientType, form_token: str) -> Form | None:
        form = self.get_form_by_token(form_token)
        if form is None or form.recipient_type != recipient_type:
            return None
        self._ensure_not_submitted(form)
        return form

    def get_form_definition_by_token_for_console(self, form_token: str) -> Form | None:
        form = self.get_form_by_token(form_token)
        if form is None or form.recipient_type != RecipientType.CONSOLE:
            return None
        self._ensure_not_submitted(form)
        return form

    def submit_form_by_token(
        self,
        recipient_type: RecipientType,
        form_token: str,
        selected_action_id: str,
        form_data: Mapping[str, Any],
        submission_end_user_id: str | None = None,
        submission_user_id: str | None = None,
    ):
        form = self.get_form_by_token(form_token)
        if form is None or form.recipient_type != recipient_type:
            raise WebAppDeliveryNotEnabledError()

        self._ensure_form_active(form)
        self._validate_submission(form=form, selected_action_id=selected_action_id, form_data=form_data)

        result = self._form_repository.mark_submitted(
            form_id=form.id,
            recipient_id=form.recipient_id,
            selected_action_id=selected_action_id,
            form_data=form_data,
            submission_user_id=submission_user_id,
            submission_end_user_id=submission_end_user_id,
        )

        self._enqueue_resume(result.workflow_run_id)

    def _ensure_form_active(self, form: Form) -> None:
        if form.submitted:
            raise FormSubmittedError(form.id)
        if form.status == HumanInputFormStatus.TIMEOUT:
            raise FormExpiredError(form.id)
        now = naive_utc_now()
        if form.expiration_time <= now:
            raise FormExpiredError(form.id)

    def _ensure_not_submitted(self, form: Form) -> None:
        if form.submitted:
            raise FormSubmittedError(form.id)

    def _validate_submission(self, form: Form, selected_action_id: str, form_data: Mapping[str, Any]) -> None:
        definition = form.get_definition()
        try:
            validate_human_input_submission(
                inputs=definition.inputs,
                user_actions=definition.user_actions,
                selected_action_id=selected_action_id,
                form_data=form_data,
            )
        except HumanInputSubmissionValidationError as exc:
            raise InvalidFormDataError(str(exc)) from exc

    def _enqueue_resume(self, workflow_run_id: str) -> None:
        workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)
        workflow_run = workflow_run_repo.get_workflow_run_by_id_without_tenant(workflow_run_id)

        if workflow_run is None:
            raise AssertionError(f"WorkflowRun not found, id={workflow_run_id}")
        with self._session_factory(expire_on_commit=False) as session:
            app_query = select(App).where(App.id == workflow_run.app_id)
            app = session.execute(app_query).scalar_one_or_none()
        if app is None:
            logger.error(
                "App not found for WorkflowRun, workflow_run_id=%s, app_id=%s", workflow_run_id, workflow_run.app_id
            )
            return

        if app.mode in {AppMode.WORKFLOW, AppMode.ADVANCED_CHAT}:
            payload = {"workflow_run_id": workflow_run_id}
            try:
                resume_app_execution.apply_async(
                    kwargs={"payload": payload},
                    queue=APP_EXECUTE_QUEUE,
                )
            except Exception:  # pragma: no cover
                logger.exception("Failed to enqueue resume task for workflow run %s", workflow_run_id)
            return

        logger.warning("App mode %s does not support resume for workflow run %s", app.mode, workflow_run_id)
