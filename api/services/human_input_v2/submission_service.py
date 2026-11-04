"""Authorize recipients and atomically commit Human Input v2 approvals."""

import hashlib
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
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
from factories.human_input_v2_form_presentation import refresh_form_file_urls
from graphon.enums import WorkflowExecutionStatus
from graphon.file import FileUploadConfig
from graphon.variables.factory import build_segment
from graphon.variables.segments import ArrayFileSegment, FileSegment, Segment, StringSegment
from libs.datetime_utils import naive_utc_now
from repositories.factory import DifyAPIRepositoryFactory
from repositories.human_input_v2.contact import ContactType
from repositories.human_input_v2.delivery_repository import (
    Delivery,
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
from repositories.human_input_v2.sqlalchemy_im_binding_repository import SQLAlchemyIMBindingRepository
from repositories.human_input_v2.sqlalchemy_im_channel_repository import SQLAlchemyIMWebhookChannelRepository
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
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


@dataclass(frozen=True, slots=True)
class _AuthorizedForm:
    """The exact delivery and recipient authenticated for one form."""

    form: Form
    recipient: Recipient
    delivery: Delivery


@dataclass(frozen=True, slots=True)
class _IMFormContext:
    form: Form
    delivery: Delivery
    target: IMUserTargetSnapshot


@dataclass(frozen=True, slots=True)
class _IMCallbackRejection:
    """Expected rejection with safe diagnostic text and the transport error code."""

    code: HumanInputFormErrorCode
    reason: str


class HumanInputSubmissionService:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_service_api_form(
        self, *, actor: ServiceAPIFormActor, form_token: str, ip_address: str | None = None
    ) -> Form:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            form = self._authorize_service_api(session, actor=actor, token_hash=token_hash).form
        self._record_form_view(form, ip_address=ip_address)
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

        def authorize(session: Session) -> _AuthorizedForm:
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

    def get_console_form(self, *, account_id: AccountId, form_token: str, ip_address: str | None = None) -> Form:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            form = self._authorize_console(session, account_id=account_id, token_hash=token_hash).form
        if naive_utc_now() >= min(form.expiration_time, form.global_timeout_deadline):
            raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED)
        self._record_form_view(form, ip_address=ip_address)
        return replace(form, resolved_form=refresh_form_file_urls(form.resolved_form))

    def submit_console_form(
        self, *, account_id: AccountId, form_token: str, action: str, inputs: Mapping[str, JsonValue]
    ) -> None:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()

        def authorize(session: Session) -> _AuthorizedForm:
            return self._authorize_console(session, account_id=account_id, token_hash=token_hash)

        form = self._submit_form(authorize=authorize, action=action, inputs=inputs)
        self._enqueue_resume(form)

    def get_web_app_form(self, *, actor: WebAppFormActor, form_token: str, ip_address: str | None = None) -> Form:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        with self._session_factory() as session:
            form = self._authorize_web_app(session, actor=actor, token_hash=token_hash).form
        if naive_utc_now() >= min(form.expiration_time, form.global_timeout_deadline):
            raise HumanInputFormError(HumanInputFormErrorCode.EXPIRED)
        self._record_form_view(form, ip_address=ip_address)
        return form

    def get_public_form(self, *, form_token: str, ip_address: str | None = None) -> Form:
        """Read an active email-proof form before any OTP is requested or verified."""
        form = self.authorize_public_form(form_token=form_token)
        self._record_form_view(form, ip_address=ip_address)
        return replace(form, resolved_form=refresh_form_file_urls(form.resolved_form))

    def _record_form_view(self, form: Form, *, ip_address: str | None) -> None:
        with self._session_factory() as session, session.begin():
            SQLAlchemyAuditRepository(session, form.tenant_id, form.id).record_form_view(viewer_ip_address=ip_address)

    def authorize_public_form(self, *, form_token: str) -> Form:
        """Authorize public access, including file uploads, without recording a page view."""
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

        def authorize(session: Session) -> _AuthorizedForm:
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

        def authorize(session: Session) -> _AuthorizedForm:
            return self._authorize_public(session, verified=verified)

        def audit_submission(session: Session, _form: Form, _recipient: Recipient) -> None:
            verified.add_submission_audit(session, ip_address=ip_address)

        form = self._submit_form(authorize=authorize, action=action, inputs=inputs, after_submission=audit_submission)
        email_otp_service.cleanup(verified.delivery.id, verified.challenge_token)
        self._enqueue_resume(form)

    def submit_im_form(
        self,
        *,
        actor: IMFormActor,
        form_token: str,
        action: str,
        inputs: Mapping[str, JsonValue],
        ip_address: str | None = None,
    ) -> None:
        token_hash = hashlib.sha256(form_token.encode()).hexdigest()
        verification = self._verify_im_callback(actor=actor, token_hash=token_hash, ip_address=ip_address)
        if isinstance(verification, _IMCallbackRejection):
            raise HumanInputFormError(verification.code)

        def authorize(session: Session) -> _AuthorizedForm:
            authorized = self._authorize_im_form(session, actor=actor, token_hash=token_hash)
            _ensure_form_waiting(authorized.form)
            return authorized

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
        authorize: Callable[[Session], _AuthorizedForm],
        action: str,
        inputs: Mapping[str, JsonValue],
        after_submission: Callable[[Session, Form, Recipient], None] | None = None,
        input_validation_mode: _InputValidationMode = _InputValidationMode.STRICT,
    ) -> Form:
        with self._session_factory() as session:
            form = authorize(session).form
        # File reconstruction can access storage or remote URLs. Keep it outside
        # the write transaction, then recheck authorization and terminal state.
        try:
            normalized = _normalize_inputs(form, action, inputs, mode=input_validation_mode)
        except ValueError as exc:
            raise HumanInputFormError(HumanInputFormErrorCode.INVALID_INPUT, form_id=form.id) from exc

        with self._session_factory() as session, session.begin():
            authorized = authorize(session)
            form = authorized.form
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
                authorized = authorize(session)
            form, recipient = authorized.form, authorized.recipient
            result = SQLAlchemyFormRepository(session, form.tenant_id, form.app_id).submit_form(
                form.id,
                submitted_by_recipient_id=recipient.id,
                submitted_by_delivery_id=authorized.delivery.id,
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
        self._enqueue_card_updates(form)
        return form

    def _enqueue_card_updates(self, form: Form) -> None:
        from services.human_input_v2.im_card_service import HumanInputIMCardService

        try:
            HumanInputIMCardService(session_factory=self._session_factory).enqueue_updates(form)
        except Exception:
            # Card synchronization is an independent follow-up. A failure must
            # not change the accepted submission or suppress workflow resume.
            logger.exception(
                "Failed to fan out Human Input IM card updates tenant_id=%s form_id=%s",
                form.tenant_id,
                form.id,
            )

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
    ) -> _AuthorizedForm:
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
        return _AuthorizedForm(form, recipient, delivery)

    @staticmethod
    def _authorize_console(session: Session, *, account_id: AccountId, token_hash: str) -> _AuthorizedForm:
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
        return _AuthorizedForm(form, recipient, delivery)

    @staticmethod
    def _authorize_web_app(session: Session, *, actor: WebAppFormActor, token_hash: str) -> _AuthorizedForm:
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
        return _AuthorizedForm(form, recipient, delivery)

    @staticmethod
    def _authorize_public(session: Session, *, verified: VerifiedEmail) -> _AuthorizedForm:
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
        return _AuthorizedForm(form, recipient, delivery)

    def _verify_im_callback(
        self, *, actor: IMFormActor, token_hash: str, ip_address: str | None
    ) -> Recipient | _IMCallbackRejection:
        with self._session_factory() as session, session.begin():
            # No audit attribution until the authenticated route and stored
            # delivery resolve a form in the same Provider tenant/workspace.
            context = self._resolve_im_form_context(session, actor=actor, token_hash=token_hash)
            if isinstance(context, _IMCallbackRejection):
                self._log_im_callback_rejection(actor=actor, rejection=context, context=None)
                return context
            verification = self._check_im_recipient(session, actor=actor, context=context)
            if isinstance(verification, _IMCallbackRejection):
                succeeded = False
                reason = verification.reason
            else:
                succeeded = True
                reason = "verified"
            SQLAlchemyAuditRepository(session, context.form.tenant_id, context.form.id).record_im_callback_verification(
                succeeded=succeeded,
                request_ip_address=ip_address,
                reason=reason,
            )
        # Verification audits commit before the caller translates a rejection
        # or attempts form submission.
        if isinstance(verification, _IMCallbackRejection):
            self._log_im_callback_rejection(actor=actor, rejection=verification, context=context)
        return verification

    @staticmethod
    def _log_im_callback_rejection(
        *, actor: IMFormActor, rejection: _IMCallbackRejection, context: _IMFormContext | None
    ) -> None:
        tenant_id = context.form.tenant_id if context is not None else None
        form_id = context.form.id if context is not None else None
        logger.warning(
            "Rejected IM callback channel_id=%s tenant_id=%s form_id=%s code=%s reason=%s",
            actor.channel_id,
            tenant_id,
            form_id,
            rejection.code.value,
            rejection.reason,
            extra={
                "channel_id": actor.channel_id,
                "tenant_id": tenant_id,
                "form_id": form_id,
                "delivery_id": context.delivery.id if context is not None else None,
                "recipient_id": context.delivery.recipient_id if context is not None else None,
                "im_provider": actor.provider.value,
                "provider_tenant_id": actor.provider_tenant_id,
                "callback_provider_user_id": actor.provider_user_id,
                "target_provider_user_id": context.target.im_provider_user_id if context is not None else None,
                "error_code": rejection.code.value,
                "rejection_reason": rejection.reason,
            },
        )

    @classmethod
    def _authorize_im_form(cls, session: Session, *, actor: IMFormActor, token_hash: str) -> _AuthorizedForm:
        """Require current IM recipient authorization for submission and resume repair.

        Rejections raise here; callback verification retains them to commit its audit.
        """
        context = cls._resolve_im_form_context(session, actor=actor, token_hash=token_hash)
        if isinstance(context, _IMCallbackRejection):
            cls._log_im_callback_rejection(actor=actor, rejection=context, context=None)
            raise HumanInputFormError(context.code)
        recipient = cls._check_im_recipient(session, actor=actor, context=context)
        if isinstance(recipient, _IMCallbackRejection):
            cls._log_im_callback_rejection(actor=actor, rejection=recipient, context=context)
            raise HumanInputFormError(recipient.code)
        return _AuthorizedForm(context.form, recipient, context.delivery)

    @staticmethod
    def _resolve_im_form_context(
        session: Session, *, actor: IMFormActor, token_hash: str
    ) -> _IMFormContext | _IMCallbackRejection:
        """Resolve trusted form ownership without granting the callback user access.

        This context lets recipient verification failures be audited against the form.
        """
        route = SQLAlchemyIMWebhookChannelRepository(session).find_by_channel_id(actor.channel_id)
        if route is None:
            return _IMCallbackRejection(HumanInputFormErrorCode.NOT_FOUND, "Callback channel was not found.")
        if route.channel.provider is not actor.provider:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback provider does not match the channel provider."
            )
        if route.channel.provider_tenant_id != actor.provider_tenant_id:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback provider tenant does not match the channel tenant."
            )
        delivery = SQLAlchemyDeliveryRepository(session).get_delivery_by_token_hash(token_hash)
        if delivery is None:
            return _IMCallbackRejection(HumanInputFormErrorCode.NOT_FOUND, "Callback delivery was not found.")
        if delivery.auth_type is not SubmissionAuthType.IM:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback delivery does not use IM authentication."
            )
        if isinstance(route.scope, WorkspaceScope) and route.scope.id != delivery.tenant_id:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Channel and delivery belong to different workspaces."
            )
        target = delivery.target_snapshot
        if not isinstance(target, IMUserTargetSnapshot):
            return _IMCallbackRejection(HumanInputFormErrorCode.NOT_FOUND, "Delivery target is not an IM user.")
        if target.im_provider is not actor.provider:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback provider does not match the delivery target provider."
            )
        if target.im_tenant_id != actor.provider_tenant_id:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback provider tenant does not match the delivery target tenant."
            )
        app_id = SQLAlchemyFormRepository.find_app_id(session, tenant_id=delivery.tenant_id, form_id=delivery.form_id)
        if app_id is None:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Form ownership could not be resolved for the delivery."
            )
        form = SQLAlchemyFormRepository(session, delivery.tenant_id, app_id).get_form_by_id(delivery.form_id)
        if form is None:
            return _IMCallbackRejection(HumanInputFormErrorCode.NOT_FOUND, "Callback form was not found.")
        return _IMFormContext(form=form, delivery=delivery, target=target)

    @staticmethod
    def _check_im_recipient(
        session: Session, *, actor: IMFormActor, context: _IMFormContext
    ) -> Recipient | _IMCallbackRejection:
        form, delivery, target = context.form, context.delivery, context.target
        if target.im_provider_user_id != actor.provider_user_id:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback user does not match the delivery target user."
            )
        recipient = SQLAlchemyRecipientRepository(session, form.tenant_id, form.id).get_recipient(delivery.recipient_id)
        if recipient is None:
            return _IMCallbackRejection(HumanInputFormErrorCode.NOT_FOUND, "Callback recipient was not found.")
        if not isinstance(recipient.subject, ContactRecipientSubject):
            return _IMCallbackRejection(HumanInputFormErrorCode.NOT_FOUND, "Callback recipient is not a contact.")
        # Matching a Provider user must not revive a card after rebinding.
        # The delivered Binding must still be effective for this Contact.
        contact = SQLAlchemyContactRepository(session).get_contacts_by_id(form.tenant_id, recipient.subject.contact_id)
        if contact is None:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback contact is no longer available in the workspace."
            )
        if contact.type is ContactType.EXTERNAL:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "External contacts cannot authenticate IM callbacks."
            )
        binding = SQLAlchemyIMBindingRepository(session, actor.channel_id).get_effective(form.tenant_id, contact.id)
        if binding is None:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback contact has no effective IM binding for the channel."
            )
        if binding.id != target.im_binding_id:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback contact binding has changed since delivery."
            )
        identity = SQLAlchemyIMIdentityRepository(session, actor.channel_id).get(binding.identity_id)
        if identity is None:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback binding identity was not found in the channel."
            )
        if identity.provider_user_id != actor.provider_user_id:
            return _IMCallbackRejection(
                HumanInputFormErrorCode.NOT_FOUND, "Callback user does not match the bound identity user."
            )
        return recipient

    def _resume_submitted_im_form(
        self, *, actor: IMFormActor, token_hash: str, action: str, inputs: Mapping[str, JsonValue]
    ) -> None:
        # Approval commit and broker publication are separate. A redelivery can
        # repair a failed resume publication without changing the saved approval.
        with self._session_factory() as session, session.begin():
            authorized = self._authorize_im_form(session, actor=actor, token_hash=token_hash)
            form, recipient = authorized.form, authorized.recipient
            submission = form.submission
            if (
                submission is None
                or submission.submitted_by_recipient_id != recipient.id
                or submission.selected_action_id != action
                or submission.raw_submission_inputs != inputs
            ):
                raise HumanInputFormError(HumanInputFormErrorCode.ALREADY_SUBMITTED)
            should_resume = False
            if form.workflow_run_id is not None:
                repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)
                run = repository.get_workflow_run_by_id_for_update(
                    session, tenant_id=form.tenant_id, app_id=form.app_id, run_id=form.workflow_run_id
                )
                should_resume = run is not None and run.status == WorkflowExecutionStatus.PAUSED
        # A callback redelivery can also repair card publication after resume.
        self._enqueue_card_updates(form)
        if should_resume:
            self._enqueue_resume(form)


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
