"""Authoritative resolved-form ownership tests for the Human Input v2 aggregate."""

from dataclasses import fields
from datetime import datetime, timedelta

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    ApproverGrant,
    CanonicalSubjectKey,
    EmailAddressApprovalSubject,
    FormRef,
    HumanInputForm,
    InvalidSelectedActionError,
    MatchedRecipientSource,
    RecipientSourceKind,
    ResolvedApprover,
    SubjectSnapshot,
)
from core.human_input_v2.entities import HumanInputV2FormKind, HumanInputV2FormStatus
from core.human_input_v2.shared import AppId, ApproverGrantId, FormId, NormalizedEmail, TenantId

_NOW = datetime(2026, 8, 10, 8)


def _resolved_form() -> ResolvedForm:
    return ResolvedForm(
        title="Review",
        blocks=(MarkdownText("Approve the request"),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="Approve the request",
    )


def _form() -> HumanInputForm:
    form_ref = FormRef(TenantId("workspace-1"), FormId("form-1"))
    email = NormalizedEmail("reviewer@example.com")
    grant = ApproverGrant.from_resolved_approver(
        grant_id=ApproverGrantId("grant-1"),
        form_ref=form_ref,
        approver=ResolvedApprover(
            subject=EmailAddressApprovalSubject(email),
            subject_key=CanonicalSubjectKey.for_email(email),
            matched_sources=(MatchedRecipientSource(RecipientSourceKind.ONE_TIME_EMAIL, 0, str(email)),),
            subject_snapshot=SubjectSnapshot("Reviewer", str(email)),
            endpoints=(),
        ),
        now=_NOW,
    )
    return HumanInputForm(
        ref=form_ref,
        app_id=AppId("app-1"),
        resolved_form=_resolved_form(),
        display_in_ui=True,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=HumanInputV2FormKind.RUNTIME,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id="pause-1",
        node_execution_id="execution-1",
        grants=(grant,),
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_form_owns_one_resolved_form_without_parallel_presentation_values() -> None:
    form = _form()
    field_names = {field.name for field in fields(HumanInputForm)}

    assert form.resolved_form == _resolved_form()
    assert "definition" not in field_names
    assert "rendered_content" not in field_names
    assert form.display_in_ui is True


def test_form_validates_selected_action_against_the_resolved_snapshot() -> None:
    form = _form()

    with pytest.raises(InvalidSelectedActionError):
        form.decide_submission(
            grant_id=ApproverGrantId("grant-1"),
            selected_action_id="reject",
            now=_NOW,
        )
