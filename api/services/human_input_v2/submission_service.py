"""Authorize recipients and atomically commit Human Input v2 approvals."""

import hashlib
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import Enum, StrEnum, auto

from kombu.exceptions import OperationalError
from pydantic import JsonValue, TypeAdapter
from sqlalchemy.orm import Session, sessionmaker

from core.app.file_access import DatabaseFileAccessController
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.resolved_form import FileInput, FileListInput, MarkdownFragment, ParagraphInput, SelectInput
from core.human_input_v2.shared.values import AccountId, TenantId, WorkspaceScope
from core.workflow.nodes.human_input.enums import HumanInputFormStatus
from factories.file_factory import build_from_mapping
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FileUploadConfig
from graphon.variables.factory import build_segment
from graphon.variables.segments import ArrayFileSegment, FileSegment, Segment, StringSegment
from libs.datetime_utils import naive_utc_now
from repositories.factory import DifyAPIRepositoryFactory
from repositories.human_input_v2.contact import ContactType
from repositories.human_input_v2.delivery_repository import (
    EmailTargetSnapshot,
    IMUserTargetSnapshot,
    InitiatorSnapshot,
    SubmissionAuthType,
)
from repositories.human_input_v2.form_repository import Form, FormSubmissionFailure
from repositories.human_input_v2.im_channel_repository import IMChannelId
from repositories.human_input_v2.recipient_repository import (
    ContactRecipientSubject,
    EmailRecipientSubject,
    EndUserRecipientSubject,
    Recipient,
)
from repositories.human_input_v2.sqlalchemy_audit_repository import SQLAlchemyAuditRepository
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import SQLAlchemyIMWebhookChannelRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository
from services.human_input_v2.email_otp_service import (
    EmailOtpError,
    EmailOtpService,
    EmailSubject,
    ExternalContactSubject,
    OtpFailure,
    VerifiedEmail,
)

_STRING = TypeAdapter(str)
_FILE = TypeAdapter(dict[str, JsonValue])
_FILES = TypeAdapter(list[dict[str, JsonValue]])
logger = logging.getLogger(__name__)


class _InputValidationMode(Enum):
    STRICT = auto()
    LEGACY_COMPATIBLE = auto()


class HumanInputFormErrorCode(StrEnum):
    NOT_FOUND = "not_found"
    ALREADY_SUBMITTED = "already_submitted"
    EXPIRED = "expired"
    WORKFLOW_NOT_ACTIVE = "workflow_not_active"
    INVALID_INPUT = "invalid_input"


class HumanInputFormError(Exception):
    """A rejection translated to an HTTP response by the owning transport."""

    def __init__(self, code: HumanInputFormErrorCode, *, form_id: str | None = None):
        self.code = code
        # Unknown or unauthorized tokens have no form identity to expose.
        self.form_id = form_id
        super().__init__(code.value)


@dataclass(frozen=True, slots=True)
class WebAppFormActor:
    """App-owned EndUser established by the Web App passport boundary."""

    tenant_id: TenantId
    app_id: str
    end_user_id: str


@dataclass(frozen=True, slots=True)
class ServiceAPIFormActor:
    """App ownership established by the Service API bearer token.

    The caller may submit for a different EndUser than the run initiator.
    EndUser attribution is recorded separately from the recipient grant.
    """

    tenant_id: TenantId
    app_id: str


@dataclass(frozen=True, slots=True)
class IMFormActor:
    """Provider identity established by an authenticated callback in the inbox."""

    channel_id: IMChannelId
    provider: IMProvider
    provider_tenant_id: str
    provider_user_id: str


class HumanInputSubmissionService:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_service_api_form(self, *, actor: ServiceAPIFormActor, form_token: str) -> Form:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            form, _ = self._authorize_service_api(session, actor=actor, token_hash=token_hash)
        return form

    def submit_service_api_form(
        self,
        *,
        actor: ServiceAPIFormActor,
        end_user_id: str,
        form_token: str,
        action: str,
        inputs: Mapping[str, JsonValue],
    ) -> None:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()

        def authorize(session: Session) -> tuple[Form, Recipient]:
            return self._authorize_service_api(session, actor=actor, token_hash=token_hash)

        def audit_submission(session: Session, form: Form, recipient: Recipient) -> None:
            SQLAlchemyAuditRepository(session, form.tenant_id, form.id).record_service_api_submission(
                recipient_id=recipient.id,
                end_user_id=end_user_id,
            )

        form = self._submit_form(
            authorize=authorize,
            action=action,
            inputs=inputs,
            input_validation_mode=_InputValidationMode.LEGACY_COMPATIBLE,
            after_submission=audit_submission,
        )
        try:
            self._enqueue_resume(form)
        except OperationalError:
            # The legacy Service API acknowledges the committed submission even
            # when the broker is unavailable; a retry cannot undo that acceptance.
            logger.exception(
                "Failed to enqueue resume task after Service API form submission, form_id=%s, workflow_run_id=%s",
                form.id,
                form.workflow_run_id,
            )

    def get_console_form(self, *, account_id: AccountId, form_token: str) -> Form:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            form, _ = self._authorize_console(session, account_id=account_id, token_hash=token_hash)
        if naive_utc_now() >= min(form.expiration_time, form.global_timeout_deadline):
            raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED)
        return form

    def submit_console_form(
        self, *, account_id: AccountId, form_token: str, action: str, inputs: Mapping[str, JsonValue]
    ) -> None:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()

        def authorize(session: Session) -> tuple[Form, Recipient]:
            return self._authorize_console(session, account_id=account_id, token_hash=token_hash)

        form = self._submit_form(authorize=authorize, action=action, inputs=inputs)
        self._enqueue_resume(form)

    def get_web_app_form(self, *, actor: WebAppFormActor, form_token: str) -> Form:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            form, _ = self._authorize_web_app(session, actor=actor, token_hash=token_hash)
        if naive_utc_now() >= min(form.expiration_time, form.global_timeout_deadline):
            raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED)
        return form

    def get_public_form(self, *, form_token: str) -> Form:
        """Read an active email-proof form before any OTP is requested or verified."""
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(token_hash)
            if (
                delivery is None
                or delivery.auth_type != SubmissionAuthType.EMAIL_OTP
                or not isinstance(delivery.target_snapshot, EmailTargetSnapshot)
            ):
                raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
            repository = SQLAlchemyFormRepository.for_existing_form(
                session, tenant_id=delivery.tenant_id, form_id=delivery.form_id
            )
            if repository is None:
                raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
            form = repository.get_form_by_id(delivery.form_id)
            if form is None:
                raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
            recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).get_recipient(
                delivery.recipient_id
            )
            if recipient is None:
                raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
            match recipient.subject:
                case EmailRecipientSubject(email):
                    if email.value != delivery.target_snapshot.email_address:
                        raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                case ContactRecipientSubject(contact_id):
                    contact = SQLAlchemyContactRepository(session).get_contacts_by_id(form.tenant_id, contact_id)
                    if (
                        contact is None
                        or contact.type != ContactType.EXTERNAL
                        or contact.email != delivery.target_snapshot.email_address
                    ):
                        raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                case EndUserRecipientSubject():
                    raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
            _ensure_form_waiting(form)
            if naive_utc_now() >= min(form.expiration_time, form.global_timeout_deadline):
                raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED)
            return form

    def submit_web_app_form(
        self, *, actor: WebAppFormActor, form_token: str, action: str, inputs: Mapping[str, JsonValue]
    ) -> None:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()

        def authorize(session: Session) -> tuple[Form, Recipient]:
            return self._authorize_web_app(session, actor=actor, token_hash=token_hash)

        form = self._submit_form(authorize=authorize, action=action, inputs=inputs)
        self._enqueue_resume(form)

    def submit_public_form(
        self,
        *,
        email_otp_service: EmailOtpService,
        form_token: str,
        action: str,
        inputs: Mapping[str, JsonValue],
        challenge_token: str | None,
        otp_code: str | None,
        ip_address: str | None,
    ) -> None:
        # OTP verification accesses Redis and owns failure audits. Complete it
        # outside the submission transaction and retain proof on rejected writes.
        verified = email_otp_service.verify(
            form_token, challenge_token=challenge_token, otp_code=otp_code, ip_address=ip_address
        )

        def authorize(session: Session) -> tuple[Form, Recipient]:
            return self._authorize_public(session, verified=verified)

        def audit_submission(session: Session, _form: Form, _recipient: Recipient) -> None:
            verified.add_submission_audit(session, ip_address=ip_address)

        form = self._submit_form(authorize=authorize, action=action, inputs=inputs, after_submission=audit_submission)
        email_otp_service.cleanup(verified.delivery.id, verified.challenge_token)
        self._enqueue_resume(form)

    def submit_im_form(
        self, *, actor: IMFormActor, form_token: str, action: str, inputs: Mapping[str, JsonValue]
    ) -> None:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()

        def authorize(session: Session) -> tuple[Form, Recipient]:
            form, recipient = self._load_im_form(session, actor=actor, token_hash=token_hash)
            _ensure_form_waiting(form)
            return form, recipient

        try:
            form = self._submit_form(authorize=authorize, action=action, inputs=inputs)
            self._enqueue_resume(form)
        except HumanInputFormError as error:
            if error.code is not HumanInputFormErrorCode.ALREADY_SUBMITTED:
                raise
            self._resume_submitted_im_form(actor=actor, token_hash=token_hash, action=action, inputs=inputs)

    def _submit_form(
        self,
        *,
        authorize: Callable[[Session], tuple[Form, Recipient]],
        action: str,
        inputs: Mapping[str, JsonValue],
        after_submission: Callable[[Session, Form, Recipient], None] | None = None,
        input_validation_mode: _InputValidationMode = _InputValidationMode.STRICT,
    ) -> Form:
        with self._session_factory() as session:
            form, _ = authorize(session)
        # File reconstruction can access storage or remote URLs. Keep it outside
        # the write transaction, then recheck authorization and terminal state.
        try:
            normalized = _normalize_inputs(form, action, inputs, mode=input_validation_mode)
        except ValueError as exc:
            raise HumanInputFormError(HumanInputFormErrorCode.INVALID_INPUT, form_id=form.id) from exc

        with self._session_factory() as session, session.begin():
            form, recipient = authorize(session)
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
                    raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                if run.status != WorkflowExecutionStatus.PAUSED:
                    raise HumanInputFormError(HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE)
                # PAUSED can be persisted before the checkpoint. Accept only
                # after its active pause is committed so resume has state to load.
                if not workflow_run_repository.has_active_workflow_pause(
                    session,
                    tenant_id=form.tenant_id,
                    app_id=form.app_id,
                    run_id=run.id,
                ):
                    raise HumanInputFormError(HumanInputFormErrorCode.WORKFLOW_NOT_ACTIVE)
                # The run lock may have waited for another transaction. Recheck
                # current recipient authorization before accepting the form.
                form, recipient = authorize(session)
            result = SQLAlchemyFormRepository(session, form.tenant_id, form.app_id).submit_form(
                form.id,
                submitted_by_recipient_id=recipient.id,
                selected_action_id=action,
                raw_submission_inputs=inputs,
                normalized_submission_data=normalized,
            )
            match result:
                case FormSubmissionFailure.NOT_FOUND:
                    raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                case FormSubmissionFailure.ALREADY_SUBMITTED:
                    raise HumanInputFormError(HumanInputFormErrorCode.ALREADY_SUBMITTED, form_id=form.id)
                case FormSubmissionFailure.FORM_EXPIRED | FormSubmissionFailure.GLOBAL_TIMEOUT:
                    raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED, form_id=form.id)
                case Form():
                    form = result
            if after_submission is not None:
                after_submission(session, form, recipient)
        return form

    @staticmethod
    def _enqueue_resume(form: Form) -> None:
        if form.workflow_run_id is not None:
            from tasks.app_generate.workflow_execute_task import resume_app_execution

            resume_app_execution.apply_async(kwargs={"payload": {"workflow_run_id": form.workflow_run_id}})

    @staticmethod
    def _authorize_service_api(
        session: Session,
        *,
        actor: ServiceAPIFormActor,
        token_hash: str,
    ) -> tuple[Form, Recipient]:
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(token_hash)
        if (
            delivery is None
            or delivery.tenant_id != actor.tenant_id
            or delivery.auth_type != SubmissionAuthType.WEB_APP
            or not isinstance(delivery.target_snapshot, InitiatorSnapshot)
        ):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        repository = SQLAlchemyFormRepository.for_existing_form(
            session,
            tenant_id=actor.tenant_id,
            form_id=delivery.form_id,
        )
        if repository is None:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        form = repository.get_form_by_id(delivery.form_id)
        if form is None or form.app_id != actor.app_id:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        recipient = SQLAlchemyRecipientRepository(session, actor.tenant_id, form.id).get_recipient(
            delivery.recipient_id
        )
        if recipient is None or not isinstance(recipient.subject, EndUserRecipientSubject):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        # Service API authorizes the application, not a browser passport.
        # Do not require the submitted user to equal the original recipient.
        _ensure_form_waiting(form)
        if naive_utc_now() >= min(form.expiration_time, form.global_timeout_deadline):
            raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED, form_id=form.id)
        return form, recipient

    @staticmethod
    def _authorize_console(session: Session, *, account_id: AccountId, token_hash: str) -> tuple[Form, Recipient]:
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(token_hash)
        if delivery is None or delivery.auth_type != SubmissionAuthType.CONSOLE:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        app_id = SQLAlchemyFormRepository.find_app_id(session, tenant_id=delivery.tenant_id, form_id=delivery.form_id)
        if app_id is None:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        form = SQLAlchemyFormRepository(session, delivery.tenant_id, app_id).get_form_by_id(delivery.form_id)
        assert form is not None
        recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).get_recipient(delivery.recipient_id)
        if recipient is None or not isinstance(recipient.subject, ContactRecipientSubject):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        # Resolve the current Account in the delivery's workspace, not the
        # browser's active workspace, and never authenticate by email equality.
        contact = SQLAlchemyContactRepository(session).get_contact_by_account_id(form.tenant_id, account_id)
        if contact is None or contact.id != recipient.subject.contact_id:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        _ensure_form_waiting(form)
        return form, recipient

    @staticmethod
    def _authorize_web_app(session: Session, *, actor: WebAppFormActor, token_hash: str) -> tuple[Form, Recipient]:
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(token_hash)
        if (
            delivery is None
            or delivery.auth_type != SubmissionAuthType.WEB_APP
            or delivery.tenant_id != actor.tenant_id
        ):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        form = SQLAlchemyFormRepository(session, actor.tenant_id, actor.app_id).get_form_by_id(delivery.form_id)
        if form is None:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        recipient = SQLAlchemyRecipientRepository(session, actor.tenant_id, form.id).get_recipient(
            delivery.recipient_id
        )
        if recipient is None or not isinstance(recipient.subject, EndUserRecipientSubject):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        if recipient.subject.end_user_id != actor.end_user_id:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        _ensure_form_waiting(form)
        return form, recipient

    @staticmethod
    def _authorize_public(session: Session, *, verified: VerifiedEmail) -> tuple[Form, Recipient]:
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(verified.delivery.token_hash)
        if delivery is None or delivery.auth_type != SubmissionAuthType.EMAIL_OTP:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        if delivery.id != verified.delivery.id or not isinstance(delivery.target_snapshot, EmailTargetSnapshot):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        form = SQLAlchemyFormRepository(session, delivery.tenant_id, verified.app_id).get_form_by_id(delivery.form_id)
        if form is None:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).get_recipient(delivery.recipient_id)
        if recipient is None:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        match verified.subject:
            case EmailSubject():
                if not isinstance(recipient.subject, EmailRecipientSubject):
                    raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                if recipient.subject.email.value != verified.subject.email:
                    raise EmailOtpError(OtpFailure.STALE)
            case ExternalContactSubject():
                if not isinstance(recipient.subject, ContactRecipientSubject):
                    raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                if recipient.subject.contact_id != verified.subject.contact_id:
                    raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                contact = SQLAlchemyContactRepository(session).get_contacts_by_id(
                    form.tenant_id, recipient.subject.contact_id
                )
                if contact is None or contact.type != ContactType.EXTERNAL:
                    raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
                if contact.email != verified.subject.email:
                    raise EmailOtpError(OtpFailure.STALE)
        _ensure_form_waiting(form)
        return form, recipient

    @staticmethod
    def _load_im_form(session: Session, *, actor: IMFormActor, token_hash: str) -> tuple[Form, Recipient]:
        route = SQLAlchemyIMWebhookChannelRepository(session).find_by_channel_id(actor.channel_id)
        if (
            route is None
            or route.channel.provider is not actor.provider
            or route.channel.provider_tenant_id != actor.provider_tenant_id
        ):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(token_hash)
        if delivery is None or delivery.auth_type is not SubmissionAuthType.IM:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        if isinstance(route.scope, WorkspaceScope) and route.scope.id != delivery.tenant_id:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        target = delivery.target_snapshot
        if (
            not isinstance(target, IMUserTargetSnapshot)
            or target.im_provider is not actor.provider
            or target.im_tenant_id != actor.provider_tenant_id
            or target.im_provider_user_id != actor.provider_user_id
        ):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        app_id = SQLAlchemyFormRepository.find_app_id(session, tenant_id=delivery.tenant_id, form_id=delivery.form_id)
        if app_id is None:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        form = SQLAlchemyFormRepository(session, delivery.tenant_id, app_id).get_form_by_id(delivery.form_id)
        if form is None:
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).get_recipient(delivery.recipient_id)
        if recipient is None or not isinstance(recipient.subject, ContactRecipientSubject):
            raise HumanInputFormError(HumanInputFormErrorCode.NOT_FOUND)
        return form, recipient

    def _resume_submitted_im_form(
        self, *, actor: IMFormActor, token_hash: str, action: str, inputs: Mapping[str, JsonValue]
    ) -> None:
        # Approval commit and broker publication are separate. A redelivery can
        # repair a failed resume publication without changing the saved approval.
        with self._session_factory() as session, session.begin():
            form, recipient = self._load_im_form(session, actor=actor, token_hash=token_hash)
            submission = form.submission
            if (
                submission is None
                or submission.submitted_by_recipient_id != recipient.id
                or submission.selected_action_id != action
                or submission.raw_submission_inputs != inputs
            ):
                raise HumanInputFormError(HumanInputFormErrorCode.ALREADY_SUBMITTED)
            if form.workflow_run_id is None:
                return
            repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)
            run = repository.get_workflow_run_by_id_for_update(
                session, tenant_id=form.tenant_id, app_id=form.app_id, run_id=form.workflow_run_id
            )
            if run is None or run.status != WorkflowExecutionStatus.PAUSED:
                return
        from tasks.app_generate.workflow_execute_task import resume_app_execution

        resume_app_execution.apply_async(kwargs={"payload": {"workflow_run_id": form.workflow_run_id}})


def _ensure_form_waiting(form: Form) -> None:
    if form.status == HumanInputFormStatus.SUBMITTED:
        raise HumanInputFormError(HumanInputFormErrorCode.ALREADY_SUBMITTED, form_id=form.id)
    if form.status in (HumanInputFormStatus.TIMEOUT, HumanInputFormStatus.EXPIRED):
        raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED, form_id=form.id)


def _normalize_inputs(
    form: Form,
    action: str,
    inputs: Mapping[str, JsonValue],
    *,
    mode: _InputValidationMode,
) -> dict[str, Segment]:
    if action not in {item.id for item in form.resolved_form.actions}:
        raise ValueError("Unknown form action")
    fields = {
        part.output_variable_name: part for part in form.resolved_form.parts if not isinstance(part, MarkdownFragment)
    }
    # Legacy submissions retain extra raw fields but only declared fields become
    # node outputs. Paragraphs preserve their JSON values rather than coercing them.
    missing_inputs = fields.keys() - inputs.keys()
    extra_inputs = inputs.keys() - fields.keys()
    if missing_inputs or (mode is _InputValidationMode.STRICT and extra_inputs):
        raise ValueError("Submitted fields must match the resolved form")
    normalized: dict[str, Segment] = {}
    for name, part in fields.items():
        value = inputs[name]
        match part:
            case ParagraphInput():
                if mode is _InputValidationMode.LEGACY_COMPATIBLE:
                    normalized[name] = build_segment(value)
                else:
                    normalized[name] = StringSegment(value=_STRING.validate_python(value, strict=True))
            case SelectInput():
                text = _STRING.validate_python(value, strict=True)
                if text not in part.options:
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
