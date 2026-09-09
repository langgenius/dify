"""Business persistence contract limited to HumanInputForm rows."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from pydantic import JsonValue, NaiveDatetime

from core.human_input_v2.resolved_form import ResolvedForm
from core.human_input_v2.shared.values import RecipientId, TenantId
from core.workflow.nodes.human_input.enums import HumanInputFormKind, HumanInputFormStatus
from graphon.variables.segments import Segment


@dataclass(frozen=True, slots=True)
class FormSubmission:
    """Complete accepted submission; absent as a whole before submission."""

    submitted_at: NaiveDatetime
    submitted_by_recipient_id: RecipientId
    selected_action_id: str
    raw_submission_inputs: Mapping[str, JsonValue]
    normalized_submission_data: Mapping[str, Segment]


@dataclass(frozen=True, slots=True)
class Form:
    """Form snapshot independent of ORM lifetime, with decoded submission data."""

    id: str
    tenant_id: TenantId
    app_id: str
    workflow_run_id: str | None
    node_execution_id: str | None
    form_kind: HumanInputFormKind
    resolved_form: ResolvedForm
    created_at: NaiveDatetime
    updated_at: NaiveDatetime
    expiration_time: NaiveDatetime
    global_timeout_deadline: NaiveDatetime
    submission: FormSubmission | None
    # The source of truth for form status. Deadlines govern transitions out of
    # WAITING, but never change an already persisted outcome.
    status: HumanInputFormStatus


@dataclass(frozen=True, slots=True)
class FormCreateParams:
    """Resolved creation values for the repository's bound tenant and app.

    Runtime forms require both execution IDs. Delivery tests have neither.
    Values, including naive UTC deadlines, are validated before this boundary.
    """

    workflow_run_id: str | None
    node_execution_id: str | None
    resolved_form: ResolvedForm
    expiration_time: NaiveDatetime
    global_timeout_deadline: NaiveDatetime
    form_kind: HumanInputFormKind = HumanInputFormKind.RUNTIME


class FormSubmissionFailure(StrEnum):
    """Expected rejection reasons that require distinct caller handling."""

    NOT_FOUND = "not_found"
    ALREADY_SUBMITTED = "already_submitted"
    FORM_EXPIRED = "form_expired"
    GLOBAL_TIMEOUT = "global_timeout"


class FormRepository(Protocol):
    """Form operations scoped to one constructor-bound tenant and app.

    Every read and write includes both owner predicates. Implementations only
    access HumanInputForm; recipient authorization, file ownership, workflow
    state, delivery, and audit orchestration belong to callers. Callers own the
    transaction so form writes can participate in a larger business operation.

    Implementations serialize submission mappings and use Pydantic to decode
    stored JSON into concrete values, preserving Segment subtypes. Partial
    stored submissions are invalid, not equivalent to an unsubmitted form.
    All timestamps use naive UTC.
    """

    def get_form(self, workflow_run_id: str, node_execution_id: str) -> Form | None:
        """Read the runtime form for this exact execution, including on resume."""
        ...

    def get_form_by_id(self, form_id: str) -> Form | None:
        """Read a runtime or delivery-test form; missing or out of scope returns None."""
        ...

    def create_form(self, params: FormCreateParams) -> Form:
        """Create an unsubmitted form with generated ID and timestamps.

        Runtime creation atomically reuses the form for the same execution,
        including concurrent retries, without replacing its frozen content,
        deadlines, or submission. Delivery-test creation always creates a form.
        """
        ...

    def submit_form(
        self,
        form_id: str,
        *,
        submitted_by_recipient_id: RecipientId,
        selected_action_id: str,
        raw_submission_inputs: Mapping[str, JsonValue],
        normalized_submission_data: Mapping[str, Segment],
    ) -> Form | FormSubmissionFailure:
        """Atomically accept the first submission while both deadlines allow it.

        The caller has already authorized the recipient for this form and
        validated the action, inputs, and file ownership. Preserve raw inputs
        without sanitizing them; persist normalized inputs with their types.

        Reject missing/out-of-scope forms first, then persisted terminal states.
        Only WAITING forms may be submitted. Compare persistence time
        against both deadlines: equality is expired. Set submitted_at from
        that same time and persist SUBMITTED with all submission fields together,
        returning the updated form. Global timeout takes precedence when both
        deadlines are reached. A rejected write leaves the form unchanged, including
        when another recipient wins a concurrent submission.
        """
        ...

    def list_expired_forms(
        self,
        *,
        now: NaiveDatetime,
        limit: int,
        after_form_id: str | None = None,
    ) -> tuple[Form, ...]:
        """Find WAITING runtime forms due for timeout handling.

        Include forms where either deadline is <= now, within the bound owner.
        Return at most the positive limit in ascending ID order, exclusively
        after after_form_id when supplied. Keep now fixed across a scan's pages.
        This is a read, not a claim or persisted timeout transition: callers
        must coordinate workflow handling and tolerate repeated scan results.
        """
        ...

    def expire_form(self, form_id: str) -> Form | None:
        """Atomically settle a WAITING form whose deadline has been reached.

        Set EXPIRED if the global deadline is reached, otherwise TIMEOUT if the
        form deadline is reached, using persistence time after acquiring the
        form lock. Preserve terminal states and forms that are not yet due.
        Return the current form, or None if missing/out of scope. The caller
        coordinates the corresponding workflow outcome in the same transaction;
        this method neither reads nor terminates a workflow run.
        """
        ...
