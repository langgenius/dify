import logging
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from typing import Any, Protocol, cast

from pydantic import JsonValue, TypeAdapter, ValidationError
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.app.layers.pause_state_persist_layer import WorkflowResumptionContext
from core.repositories.human_input_repository import (
    HumanInputFormRecord,
    HumanInputFormSubmissionRepository,
)
from core.workflow.human_input import (
    FileInputConfig,
    FileListInputConfig,
    FormDefinition,
    FormInputConfig,
    HumanInputFormKind,
    HumanInputFormStatus,
    HumanInputSubmissionValidationError,
    SelectInputConfig,
    UserActionConfig,
    ValueSourceType,
    validate_human_input_submission,
)
from core.workflow.human_input_policy import resolve_variable_select_input_options
from factories.file_factory import build_from_mapping, build_from_mappings
from graphon.file import FileUploadConfig
from graphon.runtime import GraphRuntimeState
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from libs.datetime_utils import ensure_naive_utc, naive_utc_now
from libs.exception import BaseHTTPException
from models.human_input import RecipientType
from models.model import App, AppMode
from repositories.factory import DifyAPIRepositoryFactory
from tasks.app_generate.workflow_execute_task import resume_app_execution

_file_access_controller = DatabaseFileAccessController()


_JsonObjectAdapter: TypeAdapter[dict[str, JsonValue]] = TypeAdapter(dict[str, JsonValue])
_JsonValueAdapter: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
_MappingSequenceAdapter: TypeAdapter[Sequence[Mapping[str, Any]]] = TypeAdapter(Sequence[Mapping[str, Any]])


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
    def workflow_run_id(self) -> str | None:
        """Workflow run id for runtime forms; None for delivery tests."""
        return self._record.workflow_run_id

    @property
    def tenant_id(self) -> str:
        return self._record.tenant_id

    @property
    def app_id(self) -> str:
        return self._record.app_id

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
    def form_kind(self) -> HumanInputFormKind:
        return self._record.form_kind

    @property
    def created_at(self) -> "datetime":
        return self._record.created_at

    @property
    def expiration_time(self) -> "datetime":
        return self._record.expiration_time


class HumanInputError(Exception):
    pass


class FormSubmittedError(BaseHTTPException, HumanInputError):
    error_code = "human_input_form_submitted"
    description = "This form has already been submitted by another user, form_id={form_id}"
    code = 412

    def __init__(self, form_id: str):
        template = self.description or "This form has already been submitted by another user, form_id={form_id}"
        description = template.format(form_id=form_id)
        BaseHTTPException.__init__(self, description=description)


class FormNotFoundError(BaseHTTPException, HumanInputError):
    error_code = "human_input_form_not_found"
    code = 404


class InvalidFormDataError(BaseHTTPException, HumanInputError):
    error_code = "invalid_form_data"
    code = 400

    def __init__(self, description: str):
        BaseHTTPException.__init__(self, description=description)


class WebAppDeliveryNotEnabledError(HumanInputError, BaseException):
    pass


class FormExpiredError(BaseHTTPException, HumanInputError):
    error_code = "human_input_form_expired"
    code = 412

    def __init__(self, form_id: str):
        BaseHTTPException.__init__(
            self,
            description=f"This form has expired, form_id={form_id}",
        )


logger = logging.getLogger(__name__)


class FormDefinitionProtocol(Protocol):
    @property
    def inputs(self) -> Sequence[FormInputConfig]: ...

    @property
    def user_actions(self) -> Sequence[UserActionConfig]: ...


class HumanInputService:
    def __init__(
        self,
        session_factory: sessionmaker[Session] | Engine,
        form_repository: HumanInputFormSubmissionRepository | None = None,
    ):
        if isinstance(session_factory, Engine):
            session_factory = sessionmaker(bind=session_factory)
        self._session_factory = session_factory
        self._form_repository = form_repository or HumanInputFormSubmissionRepository()

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
        if form is None or form.recipient_type not in {RecipientType.CONSOLE, RecipientType.BACKSTAGE}:
            return None
        self._ensure_not_submitted(form)
        return form

    def resolve_form_inputs(self, form: Form) -> Sequence[FormInputConfig]:
        variable_pool = self._load_variable_pool_for_form(form)
        return resolve_variable_select_input_options(
            form.get_definition().inputs,
            variable_pool=variable_pool,
        )

    def submit_form_by_token(
        self,
        recipient_type: RecipientType,
        form_token: str,
        selected_action_id: str,
        form_data: Mapping[str, JsonValue],
        submission_end_user_id: str | None = None,
        submission_user_id: str | None = None,
    ):
        form = self.get_form_by_token(form_token)
        if form is None or form.recipient_type != recipient_type:
            raise WebAppDeliveryNotEnabledError()

        self.ensure_form_active(form)
        normalized_form_data = self._validate_submission(
            form=form,
            selected_action_id=selected_action_id,
            form_data=form_data,
        )

        result = self._form_repository.mark_submitted(
            form_id=form.id,
            recipient_id=form.recipient_id,
            selected_action_id=selected_action_id,
            form_data=normalized_form_data,
            submission_user_id=submission_user_id,
            submission_end_user_id=submission_end_user_id,
        )

        if result.form_kind != HumanInputFormKind.RUNTIME:
            return
        # A RUNTIME form is owned by a workflow run (workflow Agent node) or a
        # conversation (ENG-635: Agent v2 chat). Route the resume accordingly.
        if result.workflow_run_id is not None:
            self.enqueue_resume(result.workflow_run_id)
        elif result.conversation_id is not None:
            self.enqueue_agent_app_resume(conversation_id=result.conversation_id, form_id=result.form_id)

    def ensure_form_active(self, form: Form) -> None:
        if form.submitted:
            raise FormSubmittedError(form.id)
        if form.status in {HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED}:
            raise FormExpiredError(form.id)
        now = naive_utc_now()
        if ensure_naive_utc(form.expiration_time) <= now:
            raise FormExpiredError(form.id)
        if self._is_globally_expired(form, now=now):
            raise FormExpiredError(form.id)

    def _ensure_not_submitted(self, form: Form) -> None:
        if form.submitted:
            raise FormSubmittedError(form.id)

    def _validate_submission(
        self,
        form: Form,
        selected_action_id: str,
        form_data: Mapping[str, Any],
    ) -> dict[str, JsonValue]:
        definition = form.get_definition()
        try:
            return self.validate_and_normalize_submission(
                tenant_id=form.tenant_id,
                form_definition=definition,
                selected_action_id=selected_action_id,
                form_data=form_data,
            )
        except HumanInputSubmissionValidationError as exc:
            raise InvalidFormDataError(str(exc)) from exc

    def enqueue_resume(self, workflow_run_id: str) -> None:
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
                )
            except Exception:  # pragma: no cover
                logger.exception("Failed to enqueue resume task for workflow run %s", workflow_run_id)
            return

        logger.warning("App mode %s does not support resume for workflow run %s", app.mode, workflow_run_id)

    def enqueue_agent_app_resume(self, *, conversation_id: str, form_id: str) -> None:
        """ENG-635: resume an Agent v2 chat after its ask_human form is submitted.

        Enqueues a background turn for the conversation; the Agent App runner
        continues the agent run, threading the human's reply into the request as
        ``deferred_tool_results``.
        """
        from tasks.app_generate.resume_agent_app_task import resume_agent_app_execution

        try:
            resume_agent_app_execution.apply_async(
                kwargs={"conversation_id": conversation_id, "form_id": form_id},
            )
        except Exception:  # pragma: no cover
            logger.exception("Failed to enqueue Agent App resume for conversation %s form %s", conversation_id, form_id)

    def _load_variable_pool_for_form(self, form: Form) -> ReadOnlyVariablePool | None:
        workflow_run_id = form.workflow_run_id
        if workflow_run_id is None:
            return None

        workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)
        pause_entity = workflow_run_repo.get_workflow_pause(workflow_run_id)

        if pause_entity is None or pause_entity.resumed_at is not None:
            return None

        resumption_context = WorkflowResumptionContext.loads(pause_entity.get_state().decode())
        runtime_state = GraphRuntimeState.from_snapshot(resumption_context.serialized_graph_runtime_state)

        return runtime_state.variable_pool

    def _is_globally_expired(self, form: Form, *, now: datetime | None = None) -> bool:
        global_timeout_seconds = dify_config.HUMAN_INPUT_GLOBAL_TIMEOUT_SECONDS
        if global_timeout_seconds <= 0:
            return False
        if form.workflow_run_id is None:
            return False
        current = now or naive_utc_now()
        created_at = ensure_naive_utc(form.created_at)
        global_deadline = created_at + timedelta(seconds=global_timeout_seconds)
        return global_deadline <= current

    @classmethod
    def validate_and_normalize_submission(
        cls,
        *,
        tenant_id: str,
        form_definition: FormDefinitionProtocol,
        selected_action_id: str,
        form_data: Mapping[str, Any],
    ) -> dict[str, JsonValue]:
        """
        Normalize runtime payloads, then validate them against Dify-owned form semantics.
        """
        normalized_form_data = cls.normalize_submission_data(
            tenant_id=tenant_id,
            form_definition=form_definition,
            form_data=form_data,
        )
        validate_human_input_submission(
            inputs=form_definition.inputs,
            user_actions=form_definition.user_actions,
            selected_action_id=selected_action_id,
            form_data=normalized_form_data,
        )
        return normalized_form_data

    @classmethod
    def normalize_submission_data(
        cls,
        *,
        tenant_id: str,
        form_definition: FormDefinitionProtocol,
        form_data: Mapping[str, Any],
    ) -> dict[str, JsonValue]:
        normalized_form_data: dict[str, JsonValue] = _JsonObjectAdapter.validate_python(form_data)
        inputs_by_name = {form_input.output_variable_name: form_input for form_input in form_definition.inputs}
        for name, form_input in inputs_by_name.items():
            if name not in form_data:
                continue
            normalized_form_data[name] = cls._normalize_input_value(
                tenant_id=tenant_id,
                form_input=form_input,
                value=form_data[name],
            )

        return normalized_form_data

    @classmethod
    def _normalize_input_value(
        cls,
        *,
        tenant_id: str,
        form_input: FormInputConfig,
        value: Any,
    ) -> JsonValue:
        if isinstance(form_input, SelectInputConfig):
            return cls._normalize_select_value(form_input=form_input, value=value)
        if isinstance(form_input, FileInputConfig):
            return cls._normalize_file_value(
                tenant_id=tenant_id,
                form_input=form_input,
                value=value,
            )
        if isinstance(form_input, FileListInputConfig):
            return cls._normalize_file_list_value(
                tenant_id=tenant_id,
                form_input=form_input,
                value=value,
            )
        return _JsonValueAdapter.validate_python(value)

    @classmethod
    def _normalize_select_value(
        cls,
        *,
        form_input: SelectInputConfig,
        value: Any,
    ) -> JsonValue:
        if not isinstance(value, str):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for select input '{form_input.output_variable_name}': expected string"
            )
        option_source = form_input.option_source
        if option_source.type == ValueSourceType.CONSTANT and value not in option_source.value:
            raise HumanInputSubmissionValidationError(
                f"Invalid value for select input '{form_input.output_variable_name}': {value}"
            )
        return value

    @classmethod
    def _normalize_file_value(
        cls,
        *,
        tenant_id: str,
        form_input: FileInputConfig,
        value: Any,
    ) -> JsonValue:
        if not isinstance(value, Mapping):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file input '{form_input.output_variable_name}': expected mapping"
            )
        upload_config = cls._build_file_upload_config(form_input=form_input, number_limits=1)
        try:
            # `build_from_mapping` enforces tenant ownership for persisted upload references.
            file = build_from_mapping(
                mapping=value,
                tenant_id=tenant_id,
                config=upload_config,
                strict_type_validation=True,
                access_controller=_file_access_controller,
            )
        except ValueError as exc:
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file input '{form_input.output_variable_name}': {exc}"
            ) from exc
        return cast(JsonValue, file.to_dict())

    @classmethod
    def _normalize_file_list_value(
        cls,
        *,
        tenant_id: str,
        form_input: FileListInputConfig,
        value: Any,
    ) -> JsonValue:
        try:
            validated_value = _MappingSequenceAdapter.validate_python(value)
        except ValidationError as exc:
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file list input '{form_input.output_variable_name}': {exc}"
            ) from exc
        if not isinstance(value, list):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file list input '{form_input.output_variable_name}': expected list"
            )
        if any(not isinstance(item, Mapping) for item in value):
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file list input '{form_input.output_variable_name}': expected list of mappings"
            )
        upload_config = cls._build_file_upload_config(
            form_input=form_input,
            number_limits=form_input.number_limits,
        )
        try:
            # `build_from_mappings` performs the same tenant-aware ownership validation in batch.
            files = build_from_mappings(
                mappings=validated_value,
                tenant_id=tenant_id,
                config=upload_config,
                strict_type_validation=True,
                access_controller=_file_access_controller,
            )
        except ValueError as exc:
            raise HumanInputSubmissionValidationError(
                f"Invalid value for file list input '{form_input.output_variable_name}': {exc}"
            ) from exc
        return cast(JsonValue, [file.to_dict() for file in files])

    @staticmethod
    def _build_file_upload_config(
        *,
        form_input: FileInputConfig | FileListInputConfig,
        number_limits: int,
    ) -> FileUploadConfig:
        return FileUploadConfig(
            allowed_file_types=list(form_input.allowed_file_types),
            allowed_file_extensions=list(form_input.allowed_file_extensions),
            allowed_file_upload_methods=list(form_input.allowed_file_upload_methods),
            number_limits=number_limits,
        )
