"""Review-only interface stub for Human Input v1/v2 runtime composition.

This file records the intended ownership and dependency boundaries before
implementation. It is not imported by production code and contains no ORM,
queue, controller, or Provider behavior.

The contracts describe observable capabilities and atomic semantics without
prescribing a persistence mechanism. Clock, identifier, and token generation
are private dependencies of the concrete application service or creation
factory rather than public architectural ports.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, NewType, Protocol, TypeAlias

if TYPE_CHECKING:
    from core.human_input_v2.approval import (
        AuthorizedSubmission,
        DeliveryCapabilitySnapshot,
        FormCreation,
        FormSubmission,
        HumanInputForm,
    )
    from core.human_input_v2.approval.recipient_resolution import InitiatorSnapshot
    from core.human_input_v2.contact_directory import ContactDirectorySnapshot
    from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
    from graphon.entities.base_node_data import BaseNodeData
    from graphon.nodes.base.node import Node
    from graphon.nodes.human_input.entities import HITLContext, HITLDecision


TenantId = NewType("TenantId", str)
AppId = NewType("AppId", str)
WorkflowRunId = NewType("WorkflowRunId", str)
WorkflowNodeExecutionId = NewType("WorkflowNodeExecutionId", str)
WorkflowPauseId = NewType("WorkflowPauseId", str)
WorkflowNodeId = NewType("WorkflowNodeId", str)
FormId = NewType("FormId", str)
ApproverGrantId = NewType("ApproverGrantId", str)
DeliveryEndpointId = NewType("DeliveryEndpointId", str)
DeliveryAttemptId = NewType("DeliveryAttemptId", str)
SubmissionId = NewType("SubmissionId", str)
AuditEventId = NewType("AuditEventId", str)

RawNodeData: TypeAlias = Mapping[str, object]
StructuredValues: TypeAlias = Mapping[str, object]


# ---------------------------------------------------------------------------
# Workflow/Graphon composition boundary
# ---------------------------------------------------------------------------


class VersionNeutralHITLCallback(Protocol):
    """Graphon-facing callback shared by Human Input node versions.

    This is the only HITL dependency visible to a workflow node. A concrete v2
    callback translates Graphon context into an application command and maps a
    transport-neutral runtime outcome back to a Graphon decision.
    """

    def __call__(self, context: HITLContext) -> HITLDecision: ...


class HumanInputCallbackFactory(Protocol):
    """Build the callback owned by one exact Human Input runtime binding."""

    def build(self, node_data: BaseNodeData) -> VersionNeutralHITLCallback: ...


@dataclass(frozen=True, slots=True)
class HumanInputRuntimeBinding:
    """Exact node class, schema, and callback composition for one version.

    Keeping the three decisions in one value prevents validation and callback
    behavior from being selected independently. In particular, a v2 payload can
    never pass through the legacy schema or callback as an intermediate form.
    """

    version: str
    node_class: type[Node]
    node_data_type: type[BaseNodeData]
    callback_factory: HumanInputCallbackFactory


def resolve_human_input_runtime_binding(
    raw_node_data: RawNodeData,
) -> HumanInputRuntimeBinding:
    """Resolve a Human Input binding before shared node-data coercion.

    Missing ``version`` and exact string ``"1"`` select the legacy binding.
    Exact string ``"2"`` selects the v2 binding. Every other raw value is a
    stable configuration error; implementations must not stringify the value or
    fall back to a registry-defined latest version.
    """

    ...


# ---------------------------------------------------------------------------
# Human Input v2 runtime application boundary
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RuntimeFormOwner:
    """Trusted workflow owner of at most one runtime form.

    ``workflow_node_execution_id`` identifies ``workflow_node_executions.id``.
    It does not identify that table's separate runtime ``node_execution_id``
    column. The persistence capability must verify that the node execution
    belongs to the same tenant and workflow run before creating a form.
    """

    tenant_id: TenantId
    workflow_run_id: WorkflowRunId
    workflow_node_execution_id: WorkflowNodeExecutionId


@dataclass(frozen=True, slots=True)
class RuntimeVariableValue:
    """One immutable workflow value copied across the Graphon boundary."""

    selector: tuple[str, ...]
    value: object


@dataclass(frozen=True, slots=True)
class AccountInitiatorReference:
    """Trusted workflow initiator reference for an authenticated account run."""

    account_id: str


@dataclass(frozen=True, slots=True)
class EndUserInitiatorReference:
    """Trusted workflow initiator reference for an app-scoped end-user run."""

    end_user_id: str


InitiatorReference: TypeAlias = AccountInitiatorReference | EndUserInitiatorReference


@dataclass(frozen=True, slots=True)
class RuntimeInvocationSnapshot:
    """Workflow-owned values captured for a possible first form creation.

    The snapshot contains no live VariablePool, request, controller, or ORM
    object. Existing runtime forms must be evaluated from their persisted frozen
    state; this snapshot is only meaningful when the owner has no form yet.
    """

    values: tuple[RuntimeVariableValue, ...]
    initiator: InitiatorReference | None


@dataclass(frozen=True, slots=True)
class EnterHumanInputV2Command:
    """Complete workflow request to enter or re-enter one v2 HITL node."""

    owner: RuntimeFormOwner
    app_id: AppId
    node_id: WorkflowNodeId
    node_data: HumanInputNodeData
    invocation: RuntimeInvocationSnapshot


@dataclass(frozen=True, slots=True)
class RuntimeWaiting:
    """The persisted form still requires Human Input."""

    form_id: FormId


@dataclass(frozen=True, slots=True)
class RuntimeCompleted:
    """Committed submission restored without re-reading authoring data.

    Values are transport-neutral. The Graphon callback owns conversion to
    Segments and the final ``Completed`` decision.
    """

    form_id: FormId
    selected_action_id: str
    input_values: StructuredValues
    output_values: StructuredValues


@dataclass(frozen=True, slots=True)
class RuntimeNodeTimedOut:
    """Node-level timeout outcome that the callback maps to ``__timeout``."""

    form_id: FormId
    output_values: StructuredValues


@dataclass(frozen=True, slots=True)
class RuntimeGlobalExpiry:
    """Invalid callback re-entry after global form expiry.

    Global expiry terminates the workflow through separate orchestration. It is
    not a node timeout and must never select a Graphon branch.
    """

    form_id: FormId


RuntimeEntryOutcome: TypeAlias = (
    RuntimeWaiting | RuntimeCompleted | RuntimeNodeTimedOut | RuntimeGlobalExpiry
)


class HumanInputV2Runtime(Protocol):
    """Deep application API used exclusively by the v2 Graphon callback.

    The implementation owns first-entry creation, frozen-state reload, lifecycle
    evaluation, recipient resolution, and post-commit delivery wakeup. Callers do
    not coordinate those steps and never receive persistence records.
    """

    def enter(self, command: EnterHumanInputV2Command) -> RuntimeEntryOutcome: ...


# ---------------------------------------------------------------------------
# Capabilities consumed inside HumanInputV2Runtime
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RuntimeRecipientContextQuery:
    """Scope needed to load current recipient-resolution facts.

    The initiator reference comes from the trusted workflow invocation. The
    loader resolves it into current domain facts but never sees Graphon context.
    """

    tenant_id: TenantId
    app_id: AppId
    initiator: InitiatorReference | None


@dataclass(frozen=True, slots=True)
class RuntimeRecipientContext:
    """One coherent immutable input to pure recipient resolution."""

    directory: ContactDirectorySnapshot
    initiator: InitiatorSnapshot | None
    delivery_capabilities: DeliveryCapabilitySnapshot


class RuntimeRecipientContextLoader(Protocol):
    """Load storage-owned facts required by one recipient-resolution request."""

    def load(self, query: RuntimeRecipientContextQuery) -> RuntimeRecipientContext: ...


class RuntimeFormCreationFactory(Protocol):
    """Build a complete new form graph without making durable writes.

    The entry store invokes this factory only for the winning creation of an
    owner that has no form. The factory may compile authoring values, resolve
    recipients, generate local identifiers and capabilities, and materialize
    initial attempts. It must not publish delivery work or commit persistence.
    """

    def create(self) -> FormCreation: ...


@dataclass(frozen=True, slots=True)
class FrozenRuntimeFormEntry:
    """Coherent persisted state returned by one owner-scoped entry operation.

    ``winning_submission`` is loaded with the form whenever the form is
    submitted, so the application never reconciles status and submission through
    separate reads. ``created_attempt_ids`` is non-empty only when this operation
    created the form graph and is safe to hand to post-commit wakeup.
    """

    form: HumanInputForm
    winning_submission: FormSubmission | None
    created_attempt_ids: tuple[DeliveryAttemptId, ...]
    created: bool


class RuntimeFormEntryStore(Protocol):
    """Atomically enter the runtime form owned by one node execution.

    For an existing owner, return the frozen form and optional winning submission
    without invoking ``creation``. For a new owner, invoke ``creation`` once for
    the winner and make the form, grants, endpoints, capabilities, and initial
    attempts visible together. Concurrent callers must resolve to the same form.

    This contract intentionally says nothing about sessions, locks, retries, or
    database-specific mechanisms.
    """

    def enter_once(
        self,
        owner: RuntimeFormOwner,
        creation: RuntimeFormCreationFactory,
    ) -> FrozenRuntimeFormEntry: ...


class InitialDeliveryWakeup(Protocol):
    """Request processing of already committed initial delivery attempts.

    The runtime application calls this only after ``enter_once`` returns a newly
    created entry. Repeated requests must be safe, and a wakeup failure must not
    roll back or hide the committed form graph.
    """

    def request_delivery(self, attempt_ids: tuple[DeliveryAttemptId, ...]) -> None: ...


# ---------------------------------------------------------------------------
# Submission, trusted correlation, and workflow resume
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class SubmitHumanInputV2Command:
    """Transport-neutral request to submit one runtime form.

    No workflow pause identifier or resume identity is accepted from the caller.
    Transport adapters must verify raw credentials before constructing ``proof``.
    Persistence record identifiers and time are application-owned details.
    """

    tenant_id: TenantId
    form_id: FormId
    approver_grant_id: ApproverGrantId
    endpoint_id: DeliveryEndpointId | None
    proof: object
    selected_action_id: str
    input_values: StructuredValues


@dataclass(frozen=True, slots=True)
class WorkflowResumeIdentity:
    """Trusted immutable resume target reconstructed from persisted ownership.

    Only the authorized submission persistence capability may create this value.
    It proves the form owner, node execution, active pause, and matching pause
    reason were correlated before the submission became visible.
    """

    tenant_id: TenantId
    form_id: FormId
    workflow_run_id: WorkflowRunId
    workflow_node_execution_id: WorkflowNodeExecutionId
    workflow_pause_id: WorkflowPauseId


@dataclass(frozen=True, slots=True)
class AuthorizedRuntimeSubmission:
    """Complete authorized write intent prepared by the application service."""

    tenant_id: TenantId
    form_id: FormId
    approver_grant_id: ApproverGrantId
    endpoint_id: DeliveryEndpointId | None
    submission_id: SubmissionId
    authorization_audit_event_id: AuditEventId
    authorized: AuthorizedSubmission
    input_values: StructuredValues
    canonical_values: StructuredValues


@dataclass(frozen=True, slots=True)
class RuntimeSubmissionCommitted:
    """Winning submission and its trusted post-commit resume target."""

    submission: FormSubmission
    resume_identity: WorkflowResumeIdentity


@dataclass(frozen=True, slots=True)
class RuntimeSubmissionAlreadyCompleted:
    """Stable idempotent result when another submission already won."""

    form_id: FormId


class ResumeCorrelationRejection(StrEnum):
    """Stable failures while reconstructing persisted workflow ownership."""

    OWNER_MISMATCH = "owner_mismatch"
    ACTIVE_PAUSE_NOT_FOUND = "active_pause_not_found"
    MATCHING_PAUSE_REASON_NOT_FOUND = "matching_pause_reason_not_found"


@dataclass(frozen=True, slots=True)
class RuntimeSubmissionCorrelationRejected:
    """Submission was not committed because trusted correlation was absent."""

    form_id: FormId
    reason: ResumeCorrelationRejection


RuntimeSubmissionCommitOutcome: TypeAlias = (
    RuntimeSubmissionCommitted
    | RuntimeSubmissionAlreadyCompleted
    | RuntimeSubmissionCorrelationRejected
)


class AuthorizedRuntimeSubmissionCommitter(Protocol):
    """Validate persisted correlation and commit one authorized submission.

    The capability validates the form owner, owning workflow node execution,
    active workflow pause, and matching form-backed pause reason against one
    coherent persistence state. A successful result makes authorization audit,
    submission, and form lifecycle transition visible together and returns the
    trusted resume identity for post-commit dispatch.

    The contract defines atomic visibility, not how it is implemented.
    """

    def commit_once(
        self, submission: AuthorizedRuntimeSubmission
    ) -> RuntimeSubmissionCommitOutcome: ...


class WorkflowResumeDispatcher(Protocol):
    """Request workflow resume idempotently after submission commit."""

    def enqueue_once(self, identity: WorkflowResumeIdentity) -> None: ...


@dataclass(frozen=True, slots=True)
class HumanInputV2SubmissionAccepted:
    """Application result for a committed or previously committed form."""

    form_id: FormId
    newly_committed: bool
    resume_enqueued: bool


@dataclass(frozen=True, slots=True)
class HumanInputV2SubmissionRejected:
    """Transport-neutral authorization or correlation rejection."""

    form_id: FormId
    reason: str


HumanInputV2SubmissionOutcome: TypeAlias = (
    HumanInputV2SubmissionAccepted | HumanInputV2SubmissionRejected
)


class HumanInputV2Submission(Protocol):
    """Deep application API used by verified submission adapters.

    The implementation authorizes current proof, commits at most one submission,
    and dispatches resume only after a successful commit. Callers do not resolve
    workflow pauses or coordinate persistence and enqueue ordering.
    """

    def submit(
        self, command: SubmitHumanInputV2Command
    ) -> HumanInputV2SubmissionOutcome: ...


__all__ = [
    "AuthorizedRuntimeSubmission",
    "AuthorizedRuntimeSubmissionCommitter",
    "EnterHumanInputV2Command",
    "FrozenRuntimeFormEntry",
    "HumanInputRuntimeBinding",
    "HumanInputV2Runtime",
    "HumanInputV2Submission",
    "InitialDeliveryWakeup",
    "RuntimeEntryOutcome",
    "RuntimeFormEntryStore",
    "RuntimeFormOwner",
    "RuntimeRecipientContextLoader",
    "SubmitHumanInputV2Command",
    "VersionNeutralHITLCallback",
    "WorkflowResumeDispatcher",
    "WorkflowResumeIdentity",
    "resolve_human_input_runtime_binding",
]
