"""Rich Human Input v2 form aggregate and plan-to-snapshot creation.

``HumanInputForm`` directly owns every local lifecycle decision: persisted
status, node/global expiry, grant membership, and selected actions. It returns a
transition decision only; committing the first successful submission belongs to
the later submission transaction boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import NaiveDatetime

from core.human_input_v2 import ResolvedForm
from core.human_input_v2.entities import HumanInputV2FormKind, HumanInputV2FormStatus
from core.human_input_v2.shared import (
    AppId,
    ApproverGrantId,
    DeliveryEndpointId,
)

from .delivery import DeliveryAttempt, DeliveryEndpoint
from .grants import ApproverGrant, FormRef
from .recipient_plan import ResolvedApprovalPlan


class InvalidApproverGrantError(ValueError):
    """The selected grant does not belong to this form snapshot."""


class InvalidSelectedActionError(ValueError):
    """The selected action is absent from the resolved presentation snapshot."""


class FormInactiveReason(StrEnum):
    """Transport-neutral reason why a form cannot accept a transition."""

    SUBMITTED = "submitted"
    TIMED_OUT = "timed_out"
    STATUS_EXPIRED = "status_expired"
    GLOBALLY_EXPIRED = "globally_expired"


@dataclass(frozen=True, slots=True)
class WaitingFormState:
    """Stable active-state result for a waiting form."""

    is_waiting: bool = True


@dataclass(frozen=True, slots=True)
class InactiveFormState:
    """Stable inactive-state result independent from HTTP status codes."""

    reason: FormInactiveReason
    is_waiting: bool = False


type FormState = WaitingFormState | InactiveFormState


@dataclass(frozen=True, slots=True)
class SubmissionTransitionDecision:
    """Validated intent that does not claim persistence has committed."""

    form_ref: FormRef
    grant_id: ApproverGrantId
    selected_action_id: str
    decided_at: NaiveDatetime


class FormSnapshotIdentifierFactory(Protocol):
    """Provide child identifiers without coupling the domain to persistence."""

    def new_grant_id(self) -> ApproverGrantId: ...

    def new_endpoint_id(self) -> DeliveryEndpointId: ...


@dataclass(frozen=True, slots=True)
class FormCreation:
    """Complete form/grant/endpoint snapshot persisted by one transaction."""

    form: HumanInputForm
    endpoints: tuple[DeliveryEndpoint, ...]
    attempts: tuple[DeliveryAttempt, ...] = ()

    def __post_init__(self) -> None:
        if not isinstance(self.endpoints, tuple):
            raise TypeError("form creation endpoints must be an immutable tuple")
        if not isinstance(self.attempts, tuple):
            raise TypeError("form creation attempts must be an immutable tuple")
        grant_refs = {grant.ref for grant in self.form.grants}
        if any(endpoint.grant_ref not in grant_refs for endpoint in self.endpoints):
            raise ValueError("form creation contains an endpoint outside its grants")
        endpoint_refs = {endpoint.ref for endpoint in self.endpoints}
        if any(attempt.endpoint_ref not in endpoint_refs for attempt in self.attempts):
            raise ValueError("form creation contains a delivery attempt outside its endpoints")


@dataclass(frozen=True, slots=True)
class HumanInputForm:
    """Form root owning local lifecycle and submission transition invariants."""

    ref: FormRef
    app_id: AppId
    resolved_form: ResolvedForm
    display_in_ui: bool | None
    node_timeout_at: NaiveDatetime
    global_expires_at: NaiveDatetime
    kind: HumanInputV2FormKind
    status: HumanInputV2FormStatus
    workflow_pause_id: str | None
    node_execution_id: str | None
    grants: tuple[ApproverGrant, ...]
    created_at: NaiveDatetime
    updated_at: NaiveDatetime

    def __post_init__(self) -> None:
        if not isinstance(self.grants, tuple):
            raise TypeError("form grants must be an immutable tuple")
        if self.kind is HumanInputV2FormKind.RUNTIME and (
            self.workflow_pause_id is None or self.node_execution_id is None
        ):
            raise ValueError("runtime form requires workflow pause and node execution owners")
        if any(grant.ref.form_ref != self.ref for grant in self.grants):
            raise ValueError("form contains a grant from another owner")
        grant_ids = [grant.id for grant in self.grants]
        subject_keys = [grant.subject_key for grant in self.grants]
        if len(grant_ids) != len(set(grant_ids)) or len(subject_keys) != len(set(subject_keys)):
            raise ValueError("form grants must have unique identifiers and canonical subjects")

    def state_at(self, now: NaiveDatetime) -> FormState:
        """Return a stable status/expiry decision without changing persisted state."""

        match self.status:
            case HumanInputV2FormStatus.SUBMITTED:
                return InactiveFormState(FormInactiveReason.SUBMITTED)
            case HumanInputV2FormStatus.TIMEOUT:
                return InactiveFormState(FormInactiveReason.TIMED_OUT)
            case HumanInputV2FormStatus.EXPIRED:
                return InactiveFormState(FormInactiveReason.STATUS_EXPIRED)
            case HumanInputV2FormStatus.WAITING:
                if now >= self.global_expires_at:
                    return InactiveFormState(FormInactiveReason.GLOBALLY_EXPIRED)
                if now >= self.node_timeout_at:
                    return InactiveFormState(FormInactiveReason.TIMED_OUT)
                return WaitingFormState()
        raise AssertionError(f"unsupported Human Input form status: {self.status}")

    def decide_submission(
        self,
        *,
        grant_id: ApproverGrantId,
        selected_action_id: str,
        now: NaiveDatetime,
    ) -> SubmissionTransitionDecision | InactiveFormState:
        """Validate one local transition without mutating or persisting the form."""

        state = self.state_at(now)
        if isinstance(state, InactiveFormState):
            return state
        if not any(grant.id == grant_id for grant in self.grants):
            raise InvalidApproverGrantError(str(grant_id))
        if not self.resolved_form.accepts_action(selected_action_id):
            raise InvalidSelectedActionError(selected_action_id)
        return SubmissionTransitionDecision(
            form_ref=self.ref,
            grant_id=grant_id,
            selected_action_id=selected_action_id,
            decided_at=now,
        )

    @classmethod
    def create_from_plan(
        cls,
        *,
        ref: FormRef,
        app_id: AppId,
        resolved_form: ResolvedForm,
        display_in_ui: bool | None,
        node_timeout_at: NaiveDatetime,
        global_expires_at: NaiveDatetime,
        kind: HumanInputV2FormKind,
        workflow_pause_id: str | None,
        node_execution_id: str | None,
        plan: ResolvedApprovalPlan,
        identifier_factory: FormSnapshotIdentifierFactory,
        now: NaiveDatetime,
    ) -> FormCreation:
        """Map one deterministic resolved plan into a complete frozen snapshot."""

        if not plan.approvers:
            raise ValueError("form creation requires resolved approvers")
        grants: list[ApproverGrant] = []
        endpoints: list[DeliveryEndpoint] = []
        for approver in plan.approvers:
            grant = ApproverGrant.from_resolved_approver(
                grant_id=identifier_factory.new_grant_id(),
                form_ref=ref,
                approver=approver,
                now=now,
            )
            grants.append(grant)
            for endpoint_plan in approver.endpoints:
                endpoints.append(
                    DeliveryEndpoint.from_plan(
                        endpoint_id=identifier_factory.new_endpoint_id(),
                        grant_ref=grant.ref,
                        endpoint_plan=endpoint_plan,
                        access_capability=None,
                        now=now,
                    )
                )
        form = cls(
            ref=ref,
            app_id=app_id,
            resolved_form=resolved_form,
            display_in_ui=display_in_ui,
            node_timeout_at=node_timeout_at,
            global_expires_at=global_expires_at,
            kind=kind,
            status=HumanInputV2FormStatus.WAITING,
            workflow_pause_id=workflow_pause_id,
            node_execution_id=node_execution_id,
            grants=tuple(grants),
            created_at=now,
            updated_at=now,
        )
        return FormCreation(form=form, endpoints=tuple(endpoints))
