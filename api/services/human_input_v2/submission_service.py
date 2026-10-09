"""Authorize Console recipients and commit Human Input v2 approvals."""

import hashlib
from collections.abc import Mapping
from enum import StrEnum

import sqlalchemy as sa
from pydantic import JsonValue, TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from core.human_input_v2.resolved_form import FileInput, FileListInput, MarkdownFragment, ParagraphInput, SelectInput
from core.human_input_v2.shared.values import AccountId
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from factories.file_factory import build_from_mapping
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FileUploadConfig
from graphon.variables.segments import ArrayFileSegment, FileSegment, Segment, StringSegment
from models.human_input_v2 import HumanInputForm
from repositories.factory import DifyAPIRepositoryFactory
from repositories.human_input_v2.delivery_repository import SubmissionAuthType
from repositories.human_input_v2.form_repository import Form, FormSubmissionFailure
from repositories.human_input_v2.recipient_repository import ContactRecipientSubject, Recipient
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository

_STRING = TypeAdapter(str)
_FILE = TypeAdapter(dict[str, JsonValue])
_FILES = TypeAdapter(list[dict[str, JsonValue]])


class ConsoleFormErrorCode(StrEnum):
    NOT_FOUND = "not_found"
    ALREADY_SUBMITTED = "already_submitted"
    EXPIRED = "expired"
    WORKFLOW_NOT_ACTIVE = "workflow_not_active"
    INVALID_INPUT = "invalid_input"


class ConsoleFormError(Exception):
    """A rejection translated to an HTTP response by the Console controller."""

    def __init__(self, code: ConsoleFormErrorCode):
        self.code = code
        super().__init__(code.value)


class HumanInputSubmissionService:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def submit_console_form(
        self, *, account_id: AccountId, form_token: str, action: str, inputs: Mapping[str, JsonValue]
    ) -> None:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            form, _ = self._authorize_console(session, account_id=account_id, token_hash=token_hash)
        # File reconstruction can access storage or remote URLs. Keep it outside
        # the write transaction, then recheck authorization and terminal state.
        try:
            normalized = _normalize_inputs(form, action=action, inputs=inputs)
        except ValueError as exc:
            raise ConsoleFormError(ConsoleFormErrorCode.INVALID_INPUT) from exc

        with self._session_factory() as session, session.begin():
            form, recipient = self._authorize_console(session, account_id=account_id, token_hash=token_hash)
            if form.workflow_run_id is not None:
                # Keep the run-before-form lock order shared with expiration.
                workflow_run_repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(
                    self._session_factory
                )
                run = workflow_run_repository.get_workflow_run_by_id_for_update(
                    session,
                    tenant_id=form.tenant_id,
                    app_id=form.app_id,
                    run_id=form.workflow_run_id,
                )
                if run is None:
                    raise ConsoleFormError(ConsoleFormErrorCode.NOT_FOUND)
                if run.status != WorkflowExecutionStatus.PAUSED:
                    raise ConsoleFormError(ConsoleFormErrorCode.WORKFLOW_NOT_ACTIVE)
                # PAUSED can be persisted before the checkpoint. Accept only
                # after its active pause is committed so resume has state to load.
                if not workflow_run_repository.has_active_workflow_pause(
                    session,
                    tenant_id=form.tenant_id,
                    app_id=form.app_id,
                    run_id=run.id,
                ):
                    raise ConsoleFormError(ConsoleFormErrorCode.WORKFLOW_NOT_ACTIVE)
            result = SQLAlchemyFormRepository(session, form.tenant_id, form.app_id).submit_form(
                form.id,
                submitted_by_recipient_id=recipient.id,
                selected_action_id=action,
                raw_submission_inputs=inputs,
                normalized_submission_data=normalized,
            )
            match result:
                case FormSubmissionFailure.NOT_FOUND:
                    raise ConsoleFormError(ConsoleFormErrorCode.NOT_FOUND)
                case FormSubmissionFailure.ALREADY_SUBMITTED:
                    raise ConsoleFormError(ConsoleFormErrorCode.ALREADY_SUBMITTED)
                case FormSubmissionFailure.FORM_EXPIRED | FormSubmissionFailure.GLOBAL_TIMEOUT:
                    raise ConsoleFormError(ConsoleFormErrorCode.EXPIRED)
                case Form():
                    pass
        if form.workflow_run_id is not None:
            from tasks.app_generate.workflow_execute_task import resume_app_execution

            resume_app_execution.apply_async(kwargs={"payload": {"workflow_run_id": form.workflow_run_id}})

    @staticmethod
    def _authorize_console(session: Session, *, account_id: AccountId, token_hash: str) -> tuple[Form, Recipient]:
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(token_hash)
        if delivery is None or delivery.auth_type != SubmissionAuthType.CONSOLE:
            raise ConsoleFormError(ConsoleFormErrorCode.NOT_FOUND)
        app_id = session.scalar(
            sa.select(HumanInputForm.app_id).where(
                HumanInputForm.id == delivery.form_id, HumanInputForm.tenant_id == delivery.tenant_id
            )
        )
        if app_id is None:
            raise ConsoleFormError(ConsoleFormErrorCode.NOT_FOUND)
        form = SQLAlchemyFormRepository(session, delivery.tenant_id, app_id).get_form_by_id(delivery.form_id)
        assert form is not None
        recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).get_recipient(delivery.recipient_id)
        if recipient is None or not isinstance(recipient.subject, ContactRecipientSubject):
            raise ConsoleFormError(ConsoleFormErrorCode.NOT_FOUND)
        # Resolve the current Account in the delivery's workspace, not the
        # browser's active workspace, and never authenticate by email equality.
        contact = SQLAlchemyContactRepository(session).get_contact_by_account_id(form.tenant_id, account_id)
        if contact is None or contact.id != recipient.subject.contact_id:
            raise ConsoleFormError(ConsoleFormErrorCode.NOT_FOUND)
        if form.status == HumanInputFormStatus.SUBMITTED:
            raise ConsoleFormError(ConsoleFormErrorCode.ALREADY_SUBMITTED)
        if form.status in (HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED):
            raise ConsoleFormError(ConsoleFormErrorCode.EXPIRED)
        return form, recipient


def _normalize_inputs(form: Form, *, action: str, inputs: Mapping[str, JsonValue]) -> dict[str, Segment]:
    if action not in {item.id for item in form.resolved_form.actions}:
        raise ValueError("Unknown form action")
    fields = {
        part.output_variable_name: part for part in form.resolved_form.parts if not isinstance(part, MarkdownFragment)
    }
    if inputs.keys() != fields.keys():
        raise ValueError("Submitted fields must match the resolved form")
    normalized: dict[str, Segment] = {}
    for name, part in fields.items():
        value = inputs[name]
        match part:
            case ParagraphInput() | SelectInput():
                text = _STRING.validate_python(value, strict=True)
                if isinstance(part, SelectInput) and text not in part.options:
                    raise ValueError("Unknown select option")
                normalized[name] = StringSegment(value=text)
            case FileInput() | FileListInput():
                config = FileUploadConfig(
                    allowed_file_types=list(part.allowed_file_types),
                    allowed_file_extensions=list(part.allowed_file_extensions),
                    allowed_file_upload_methods=list(part.allowed_file_upload_methods),
                    number_limits=part.number_limits if isinstance(part, FileListInput) else 1,
                )
                mappings = (
                    _FILES.validate_python(value, strict=True)
                    if isinstance(part, FileListInput)
                    else [_FILE.validate_python(value, strict=True)]
                )
                if isinstance(part, FileListInput) and len(mappings) > part.number_limits:
                    raise ValueError("Too many files")
                files = [
                    build_from_mapping(
                        mapping=mapping,
                        tenant_id=str(form.tenant_id),
                        config=config,
                        strict_type_validation=True,
                        access_controller=DatabaseFileAccessController(),
                    )
                    for mapping in mappings
                ]
                normalized[name] = (
                    ArrayFileSegment(value=files) if isinstance(part, FileListInput) else FileSegment(value=files[0])
                )
    return normalized
