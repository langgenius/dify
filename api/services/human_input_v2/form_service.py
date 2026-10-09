"""Initialize approvals and handle node timeout and global expiration.

Form creation and recipient resolution share a transaction. Node timeout
requests resume after committing; global expiration stops execution without
resuming it. Recipient notifications belong to the delivery service.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from datetime import timedelta
from typing import NamedTuple, assert_never

from pydantic import EmailStr, NaiveDatetime, SecretStr, TypeAdapter, ValidationError
from sqlalchemy.orm import Session, sessionmaker

from core.db.session_factory import session_factory as default_session_factory
from core.helper import encrypter
from core.human_input_v2.entities import DebugChannel
from core.human_input_v2.shared.values import AccountId, ContactId, NormalizedEmail, TenantId
from core.workflow.human_input_adapter import EmailDeliveryConfig
from core.workflow.nodes.human_input.enums import HumanInputFormStatus, TimeoutUnit
from core.workflow.nodes.human_input_v2.entities import (
    AllWorkspaceContacts,
    Contact,
    DynamicEmail,
    HumanInputNodeData,
    Initiator,
    OnetimeEmail,
    RecipientConfig,
)
from core.workflow.nodes.human_input_v2.form_compiler import compile_resolved_form
from core.workflow.nodes.human_input_v2.runtime import HumanInputDeliveryError, PreparedForm
from graphon.enums import WorkflowExecutionStatus
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from graphon.variables.segments import StringSegment
from graphon.variables.template_resolution import convert_template
from libs.datetime_utils import naive_utc_now
from models.workflow import WorkflowRun
from repositories.api_workflow_run_repository import APIWorkflowRunRepository
from repositories.factory import DifyAPIRepositoryFactory
from repositories.human_input_v2.contact import Contact as ResolvedContact
from repositories.human_input_v2.contact import ContactQuery, ContactType
from repositories.human_input_v2.delivery_repository import InitiatorSnapshot
from repositories.human_input_v2.form_repository import Form, FormCreateParams
from repositories.human_input_v2.recipient_repository import (
    ContactRecipientSubject,
    EmailRecipientSubject,
    EndUserRecipientSubject,
    Recipient,
    RecipientCreateParams,
    RecipientSubject,
)
from repositories.human_input_v2.sqlalchemy_contact_repository import SQLAlchemyContactRepository
from repositories.human_input_v2.sqlalchemy_delivery_repository import SQLAlchemyDeliveryRepository
from repositories.human_input_v2.sqlalchemy_form_repository import SQLAlchemyFormRepository
from repositories.human_input_v2.sqlalchemy_recipient_repository import SQLAlchemyRecipientRepository

from .delivery_service import ResolvedMessageTemplate

logger = logging.getLogger(__name__)
_EMAIL = TypeAdapter(EmailStr)
_CONTACT_PAGE_SIZE = 100


@dataclass(frozen=True, slots=True)
class CreatedForm:
    """Committed first initialization whose delivery round belongs to this caller.

    Only the caller that initialized the form receives this result, including
    when there are no external notifications. Other callers receive PreparedForm.
    The result carries detached values, never an open Session or transaction.
    """

    form: Form
    recipients: tuple[Recipient, ...]
    message_template: ResolvedMessageTemplate
    debug_channels: tuple[DebugChannel, ...] | None = None


@dataclass(frozen=True, slots=True)
class AccountInitiator:
    """Account authenticated by the invocation boundary, not an email match."""

    account_id: AccountId


@dataclass(frozen=True, slots=True)
class EndUserInitiator:
    """Original app session verified by the invocation boundary.

    App ownership and the caller's right to use this session are already checked.
    A service API's arbitrary user string or API key alone cannot establish this.
    """

    end_user_id: str


@dataclass(frozen=True, slots=True)
class FormExecutionContext:
    """Trusted execution facts shared by initialization and node reentry."""

    tenant_id: TenantId
    app_id: str
    workflow_run_id: str
    global_timeout_deadline: NaiveDatetime
    initiator: AccountInitiator | EndUserInitiator | None
    # Present only for an actual debugger invocation; node configuration alone
    # must not establish a debugging identity or redirect production recipients.
    debugging_account_id: AccountId | None


class HumanInputFormService:
    """Run-bound transaction boundary for form initialization and expiration.

    Construct the required repositories inside each method using its Session.
    Initialization writes share one transaction. Return only after committing
    or rolling back, without carrying an active transaction into delivery.
    """

    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        context: FormExecutionContext,
    ) -> None:
        self._session_factory = session_factory
        self._context = context

    def prepare_form(
        self,
        *,
        node_execution_id: str,
        node_data: HumanInputNodeData,
        variable_pool: ReadOnlyVariablePool,
    ) -> PreparedForm | CreatedForm:
        """Commit Form and Recipients together; reentry never creates deliveries.

        Execution startup and the Graph Engine establish execution eligibility
        and guarantee exclusive execution for each node execution. This operation
        trusts the bound execution context and only creates or restores the form.
        """
        protected_token = None
        expected_hash = None
        created = None
        with self._session_factory() as session, session.begin():
            repository = SQLAlchemyFormRepository(session, self._context.tenant_id, self._context.app_id)
            existing = repository.get_form(self._context.workflow_run_id, node_execution_id)
            if existing is not None:
                if existing.status == HumanInputFormStatus.WAITING:
                    delivery = SQLAlchemyDeliveryRepository(session).get_initiator_delivery(
                        tenant_id=self._context.tenant_id, form_id=existing.id
                    )
                    if delivery is not None:
                        assert isinstance(delivery.target_snapshot, InitiatorSnapshot)
                        protected_token = delivery.target_snapshot.protected_form_token
                        expected_hash = delivery.token_hash
            else:
                now = naive_utc_now()
                duration = (
                    timedelta(hours=node_data.timeout)
                    if node_data.timeout_unit == TimeoutUnit.HOUR
                    else timedelta(days=node_data.timeout)
                )
                template = self._resolve_message_template(node_data, variable_pool)
                debug_channels = (
                    tuple(node_data.debug_mode.channels)
                    if node_data.debug_mode.enabled and self._context.debugging_account_id is not None
                    else None
                )
                if debug_channels == ():
                    raise HumanInputDeliveryError("Debug Mode requires at least one test channel")
                form = repository.create_form(
                    FormCreateParams(
                        workflow_run_id=self._context.workflow_run_id,
                        node_execution_id=node_execution_id,
                        resolved_form=compile_resolved_form(node_data, variable_pool),
                        expiration_time=now + duration,
                        global_timeout_deadline=self._context.global_timeout_deadline,
                    )
                )
                resolved_recipients = self._resolve_recipients(
                    session=session, node_data=node_data, variable_pool=variable_pool
                )
                if not resolved_recipients:
                    raise HumanInputDeliveryError("No one can approve this step.")
                recipients = SQLAlchemyRecipientRepository(session, self._context.tenant_id, form.id).create_recipients(
                    resolved_recipients
                )
                created = CreatedForm(form, recipients, template, debug_channels)
        if created is not None:
            return created
        assert existing is not None
        # Tenant-key loading may perform I/O; it must not prolong the DB transaction.
        token = None
        if protected_token is not None:
            plaintext = encrypter.decrypt_token(str(self._context.tenant_id), protected_token)
            assert expected_hash is not None
            if not hmac.compare_digest(hashlib.sha256(plaintext.encode()).hexdigest(), expected_hash):
                raise ValueError("Recovered initiator token does not match its delivery")
            token = SecretStr(plaintext)
        return PreparedForm(existing, token)

    @staticmethod
    def _resolve_message_template(
        node_data: HumanInputNodeData, variable_pool: ReadOnlyVariablePool
    ) -> ResolvedMessageTemplate:
        template = node_data.message_template
        if template.body.count(EmailDeliveryConfig.URL_PLACEHOLDER) != 1:
            raise ValueError("Message body must contain exactly one Request URL")
        subject = EmailDeliveryConfig.sanitize_subject(convert_template(variable_pool, template.subject).text)
        body = convert_template(variable_pool, template.body).text
        if body.count(EmailDeliveryConfig.URL_PLACEHOLDER) != 1:
            raise ValueError("Resolved message body must retain exactly one Request URL")
        return ResolvedMessageTemplate(subject, body)

    def handle_timeouts(self) -> None:
        """Choose one expiration path for this run and publish at most one resume.

        Lock the run to serialize with submission, then reload its waiting
        forms and evaluate deadlines using the current database time.
        Lock individual forms only when applying their state transitions.
        """
        resume = False
        with self._session_factory() as session, session.begin():
            workflow_run_repository = DifyAPIRepositoryFactory.create_api_workflow_run_repository(self._session_factory)
            # Keep the run-before-form lock order shared with submission.
            run = workflow_run_repository.get_workflow_run_by_id_for_update(
                session,
                tenant_id=self._context.tenant_id,
                app_id=self._context.app_id,
                run_id=self._context.workflow_run_id,
            )
            if run is None:
                raise ValueError("Workflow run was not found in the bound owner scope")
            repository = SQLAlchemyFormRepository(session, self._context.tenant_id, self._context.app_id)
            batch = repository.list_waiting_forms_for_run(run.id)
            globally_expired = tuple(form for form in batch.forms if form.global_timeout_deadline <= batch.now)
            if globally_expired:
                self._handle_global_expiration(session, workflow_run_repository, repository, run, globally_expired)
            else:
                node_timeouts = tuple(form for form in batch.forms if form.expiration_time <= batch.now)
                resume = self._handle_node_timeouts(repository, run, node_timeouts)
        if resume:
            _enqueue_resume(self._context.workflow_run_id)

    @staticmethod
    def _handle_global_expiration(
        session: Session,
        workflow_run_repository: APIWorkflowRunRepository,
        repository: SQLAlchemyFormRepository,
        run: WorkflowRun,
        forms: Sequence[Form],
    ) -> None:
        for form in forms:
            repository.expire_form(form.id)
        if run.status in (WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED):
            workflow_run_repository.stop_workflow_run(
                session, run=run, error="Human input global timeout", finished_at=naive_utc_now()
            )

    @staticmethod
    def _handle_node_timeouts(repository: SQLAlchemyFormRepository, run: WorkflowRun, forms: Sequence[Form]) -> bool:
        timed_out = False
        for form in forms:
            settled = repository.timeout_form(form.id)
            assert settled is not None
            if settled.status == HumanInputFormStatus.TIMEOUT:
                timed_out = True
        return timed_out and run.status in (WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.PAUSED)

    def _resolve_recipients(
        self,
        *,
        session: Session,
        node_data: HumanInputNodeData,
        variable_pool: ReadOnlyVariablePool,
    ) -> tuple[RecipientCreateParams, ...]:
        """Resolve subjects once, merging provenance only for equal subjects."""
        contacts = SQLAlchemyContactRepository(session)
        resolved: dict[RecipientSubject, RecipientCreateParams] = {}

        def add(subject: RecipientSubject, source: RecipientConfig, name: str | None = None) -> None:
            previous = resolved.get(subject)
            if previous is None:
                resolved[subject] = RecipientCreateParams(subject, (source,), name)
            elif source not in previous.sources:
                resolved[subject] = replace(previous, sources=(*previous.sources, source))

        def add_contact(contact: ResolvedContact | None, source: RecipientConfig) -> None:
            if contact is None:
                self._recipient_warning("contact_unavailable")
                return
            add(ContactRecipientSubject(contact.id), source, contact.name)

        if node_data.debug_mode.enabled and self._context.debugging_account_id is not None:
            contact = contacts.get_contact_by_account_id(self._context.tenant_id, self._context.debugging_account_id)
            if contact is None:
                raise HumanInputDeliveryError("The debugging account has no available Contact")
            add_contact(contact, Contact(contact_id=str(contact.id)))
            return tuple(resolved.values())

        for source in node_data.recipients_spec:
            match source:
                case Contact():
                    add_contact(
                        contacts.get_contacts_by_id(self._context.tenant_id, ContactId(source.contact_id)), source
                    )
                case AllWorkspaceContacts():
                    page = 1
                    while True:
                        # This migration marker preserves the legacy all-members audience.
                        members = contacts.list_contact(
                            self._context.tenant_id,
                            page,
                            _CONTACT_PAGE_SIZE,
                            ContactQuery(contact_type=ContactType.WORKSPACE),
                        )
                        for contact in members.items:
                            add_contact(contact, source)
                        if len(members.items) < _CONTACT_PAGE_SIZE:
                            break
                        page += 1
                case Initiator():
                    match self._context.initiator:
                        case AccountInitiator(account_id):
                            add_contact(contacts.get_contact_by_account_id(self._context.tenant_id, account_id), source)
                        case EndUserInitiator(end_user_id):
                            add(EndUserRecipientSubject(end_user_id), source)
                        case None:
                            self._recipient_warning("initiator_unavailable")
                case OnetimeEmail():
                    email = self._parse_email(source.email)
                    if email is not None:
                        add(EmailRecipientSubject(email), source)
                case DynamicEmail():
                    segment = variable_pool.get(source.selector)
                    if segment is None:
                        self._recipient_warning("variable_missing")
                        continue
                    if not isinstance(segment, StringSegment):
                        self._recipient_warning("unsupported_type")
                        continue
                    if not segment.value.strip():
                        self._recipient_warning("variable_empty")
                        continue
                    email = self._parse_email(segment.value)
                    if email is not None:
                        add(EmailRecipientSubject(email), source)
                case _:
                    assert_never(source)
        return tuple(resolved.values())

    def _parse_email(self, email: str) -> NormalizedEmail | None:
        try:
            validated = _EMAIL.validate_python(email)
        except ValidationError:
            self._recipient_warning("invalid_email")
            return None
        return NormalizedEmail(str(validated).lower())

    def _recipient_warning(self, reason: str) -> None:
        logger.warning(
            "Human Input recipient skipped: tenant_id=%s app_id=%s workflow_run_id=%s reason=%s",
            self._context.tenant_id,
            self._context.app_id,
            self._context.workflow_run_id,
            reason,
        )


def _enqueue_resume(workflow_run_id: str) -> None:
    # Import at the task boundary to keep task bootstrap out of service imports.

    # FIX(QuantumGhost): fix the import loop
    from tasks.app_generate.workflow_execute_task import resume_app_execution

    resume_app_execution.apply_async(kwargs={"payload": {"workflow_run_id": workflow_run_id}})


class _InitiatorFormToken(NamedTuple):
    ciphertext: str
    token_hash: str


def load_prepared_forms(
    *,
    workflow_run_id: str,
    form_ids: Sequence[str],
    session_factory: Callable[[], Session] = default_session_factory.create_session,
) -> dict[str, PreparedForm]:
    """Read run-owned presentation and original initiator grants without delivery.

    The caller has authorized the workflow run. Recover secrets only after the
    read transaction closes; never substitute a notification delivery's token.
    """
    if not form_ids:
        return {}
    initiator_tokens_by_form_id: dict[str, _InitiatorFormToken] = {}
    with session_factory() as session:
        run = session.get(WorkflowRun, workflow_run_id)
        if run is None:
            return {}
        tenant_id = TenantId(run.tenant_id)
        repository = SQLAlchemyFormRepository(session, tenant_id, run.app_id)
        forms = repository.get_forms_by_ids(workflow_run_id=run.id, form_ids=form_ids)
        for form in forms:
            if form.status != HumanInputFormStatus.WAITING:
                continue
            delivery = SQLAlchemyDeliveryRepository(session).get_initiator_delivery(
                tenant_id=tenant_id, form_id=form.id
            )
            if delivery is not None:
                assert isinstance(delivery.target_snapshot, InitiatorSnapshot)
                initiator_tokens_by_form_id[form.id] = _InitiatorFormToken(
                    ciphertext=delivery.target_snapshot.protected_form_token,
                    token_hash=delivery.token_hash,
                )
    prepared: dict[str, PreparedForm] = {}
    for form in forms:
        token = None
        initiator_token = initiator_tokens_by_form_id.get(form.id)
        if initiator_token is not None:
            plaintext = encrypter.decrypt_token(str(form.tenant_id), initiator_token.ciphertext)
            if not hmac.compare_digest(hashlib.sha256(plaintext.encode()).hexdigest(), initiator_token.token_hash):
                raise ValueError("Recovered initiator token does not match its delivery")
            token = SecretStr(plaintext)
        prepared[form.id] = PreparedForm(form, token)
    return prepared
