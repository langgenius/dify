"""Stubs for initializing one Human Input approval per node execution.

This module owns form creation, recipient resolution, and their transaction.
It returns committed initialization results to the runtime; it never sends a
notification or calls another transaction-owning service.
Submission, OTP, and manual resend contracts are outside this initial stub.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from pydantic import NaiveDatetime
from sqlalchemy.orm import Session

from core.human_input_v2.shared.values import AccountId, TenantId
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.runtime import PreparedForm
from graphon.runtime.graph_runtime_state_protocol import ReadOnlyVariablePool
from repositories.human_input_v2.form_repository import Form
from repositories.human_input_v2.recipient_repository import Recipient, RecipientCreateParams

from .delivery_service import ResolvedMessageTemplate


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
        session_factory: Callable[[], Session],
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
        """Atomically reuse an existing form or commit its first initialization.

        Look up the tenant/app-scoped (workflow_run_id, node_execution_id) first.
        An existing initialization is authoritative: reuse it
        without compiling content, resolving recipients, extending deadlines,
        creating deliveries, or sending notifications again.

        For first entry, compile/freeze the form and create it, then resolve and
        merge recipients and persist them for this form in one short transaction.
        Recipient identity is the deduplication boundary. Different recipients
        remain independent even when their Email or IM endpoints coincide.
        Roll back initialization on persistence failure. Delivery selection and
        creation belong to DeliveryService after this transaction commits.

        Resolve the notification template once during first initialization.
        Return CreatedForm only after commit, with the frozen message template
        and persisted recipients. Runtime invokes DeliveryService for each
        recipient; this service does not select card/link mode, create Delivery,
        issue delivery tokens, or send notifications.

        Return PreparedForm when reusing an existing form. Its form_token is
        only the original usable Current Initiator token, otherwise None. Never
        substitute an Email/IM recipient's token. Merely having an authenticated
        invocation does not establish a Current Initiator grant.

        Concurrent entries must serialize the whole initialization. Reusing a
        Form from create_form does not authorize creating more recipients or
        starting another delivery round. A losing caller must reuse the winner's
        complete recipient initialization, including an empty set.
        The result variant expresses initialization ownership, not a Form status.
        An empty recipient list does not establish whether this call created a form.

        TODO: Decide how initialization ownership is established with the
        existing repositories. A read-before-insert check is not sufficient.
        TODO: Specify how the original initiator token is recovered on reentry;
        the existing Delivery repository stores only its hash. Do not regenerate
        deliveries or expose another recipient's token as a workaround.
        """
        raise NotImplementedError

    def get_form(self, *, node_execution_id: str) -> Form:
        """Read an initialized form's outcome after the runtime finishes sending.

        Own a short read transaction scoped by the bound tenant/app/run and the
        exact node execution. Return a detached Form without initialization,
        delivery, expiration, or workflow effects. A missing form is an error,
        not permission to initialize another approval. The runtime uses this
        read because a recipient may submit during the initial sending round.
        """
        raise NotImplementedError

    def handle_expiration(self, *, form_id: str) -> Form:
        """Settle a due form and coordinate its workflow outcome.

        Call the owner-scoped FormRepository.expire_form in an explicit short
        transaction. Use its returned state after concurrency arbitration: a
        submission may have won, or the form may not yet be due. Preserve all
        terminal outcomes. TIMEOUT enables the node timeout handle; EXPIRED
        terminates the workflow run and must never enter a node branch.

        Establish that the form belongs to the bound workflow run as well as
        tenant/app before acting. An absent or mismatched form is not expiration.

        Coordinate persistent workflow effects with the form transition and
        leave external I/O outside the transaction. Repeated handling must be
        safe. A terminal form does not prove that workflow continuation finished.

        TODO: Specify durable continuation/termination recovery, including a
        crash after commit and before queue publication. Reuse workflow-owned
        execution infrastructure; do not make node reentry the sole repair path.
        """
        raise NotImplementedError

    def _resolve_recipients(
        self,
        *,
        session: Session,
        node_data: HumanInputNodeData,
        variable_pool: ReadOnlyVariablePool,
    ) -> tuple[RecipientCreateParams, ...]:
        """Resolve approval subjects only during first initialization.

        Expand Contact and AllWorkspaceContacts through current tenant-scoped
        directory reads. Resolve DynamicEmail as a string email without looking
        up a Contact. Resolve Initiator only from the trusted invocation identity
        or original session. Merge sources for equal subjects; never merge
        different Contacts or a Contact and direct email by email equality.

        For an applicable Debug Mode invocation, use the debugging Account and
        its selected test channels instead of resolving formal recipients.
        Record invalid recipient sources and their reasons in execution logs;
        one invalid source does not discard other valid approval paths.

        This method neither persists recipients nor calls notification providers.
        """
        raise NotImplementedError
