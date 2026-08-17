"""Behavior tests for the Human Input v2 form aggregate and frozen child facts."""

from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta

import pytest
from pydantic import NaiveDatetime

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ParagraphInput, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    ApproverGrant,
    CanonicalSubjectKey,
    DeliveryAttempt,
    DeliveryEndpoint,
    EmailAddressApprovalSubject,
    EmailEndpointPlan,
    EndpointAccessCapability,
    FormInactiveReason,
    FormRef,
    FormSnapshotIdentifierFactory,
    HumanInputForm,
    InvalidApproverGrantError,
    InvalidSelectedActionError,
    MatchedRecipientSource,
    RecipientSourceKind,
    ResolvedApprovalPlan,
    ResolvedApprover,
    SubjectSnapshot,
    UploadCapability,
    UploadFileAssociation,
)
from core.human_input_v2.entities import (
    HumanInputDeliveryAttemptStatus,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
)
from core.human_input_v2.shared import (
    AppId,
    ApproverGrantId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    FormId,
    NormalizedEmail,
    TenantId,
    UploadCapabilityId,
    UploadFileAssociationId,
)

_NOW = datetime(2026, 7, 25, 8)
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))


class _SequentialIdentifierFactory(FormSnapshotIdentifierFactory):
    def __init__(self) -> None:
        self._grant_number = 0
        self._endpoint_number = 0

    def new_grant_id(self) -> ApproverGrantId:
        self._grant_number += 1
        return ApproverGrantId(f"grant-{self._grant_number}")

    def new_endpoint_id(self) -> DeliveryEndpointId:
        self._endpoint_number += 1
        return DeliveryEndpointId(f"endpoint-{self._endpoint_number}")


def _resolved_form() -> ResolvedForm:
    return ResolvedForm(
        title="Review",
        blocks=(MarkdownText("Please approve "), ParagraphInput("reason", "ok")),
        user_actions=(
            ResolvedFormAction(id="approve", title="Approve", button_style=ButtonStyle.PRIMARY),
            ResolvedFormAction(id="reject", title="Reject", button_style=ButtonStyle.DEFAULT),
        ),
        legacy_form_content="Please approve {{#$output.reason#}}",
    )


def _approver(email: str, *, source_position: int = 0) -> ResolvedApprover:
    normalized_email = NormalizedEmail(email)
    return ResolvedApprover(
        subject=EmailAddressApprovalSubject(normalized_email),
        subject_key=CanonicalSubjectKey.for_email(normalized_email),
        matched_sources=(MatchedRecipientSource(RecipientSourceKind.ONE_TIME_EMAIL, source_position, email),),
        subject_snapshot=SubjectSnapshot(display_name=None, email=email),
        endpoints=(EmailEndpointPlan(normalized_email),),
    )


def _form(*, status: HumanInputV2FormStatus = HumanInputV2FormStatus.WAITING) -> HumanInputForm:
    grant = ApproverGrant.from_resolved_approver(
        grant_id=ApproverGrantId("grant-1"),
        form_ref=_FORM_REF,
        approver=_approver("reviewer@example.com"),
        now=_NOW,
    )
    return HumanInputForm(
        ref=_FORM_REF,
        app_id=AppId("app-1"),
        resolved_form=_resolved_form(),
        display_in_ui=True,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=HumanInputV2FormKind.RUNTIME,
        status=status,
        workflow_pause_id="pause-1",
        node_execution_id="node-execution-1",
        grants=(grant,),
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_resolved_form_prevents_attribute_reassignment() -> None:
    resolved_form = _resolved_form()

    assert resolved_form.blocks[-1] == ParagraphInput("reason", "ok")
    with pytest.raises(FrozenInstanceError):
        resolved_form.title = "Changed"


def test_grant_endpoint_token_upload_and_delivery_facts_remain_distinct_capabilities() -> None:
    grant = ApproverGrant.from_resolved_approver(
        grant_id=ApproverGrantId("grant-1"),
        form_ref=_FORM_REF,
        approver=_approver("reviewer@example.com"),
        now=_NOW,
    )
    endpoint = DeliveryEndpoint.from_plan(
        endpoint_id=DeliveryEndpointId("endpoint-1"),
        grant_ref=grant.ref,
        endpoint_plan=EmailEndpointPlan(NormalizedEmail("reviewer@example.com")),
        access_capability=EndpointAccessCapability(
            endpoint_ref=grant.ref.endpoint(DeliveryEndpointId("endpoint-1")),
            token_hash="a" * 64,
        ),
        now=_NOW,
    )
    upload_capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-1"),
        endpoint_ref=endpoint.ref,
        app_id=AppId("app-1"),
        token_hash="b" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    upload = UploadFileAssociation(
        id=UploadFileAssociationId("upload-association-1"),
        capability_ref=upload_capability.ref,
        upload_file_id="file-1",
        created_at=_NOW,
        updated_at=_NOW,
    )
    failed_attempt = DeliveryAttempt(
        id=DeliveryAttemptId("attempt-1"),
        endpoint_ref=endpoint.ref,
        attempt_number=1,
        status=HumanInputDeliveryAttemptStatus.FAILED,
        scheduled_at=_NOW,
        started_at=_NOW,
        finished_at=_NOW,
        provider_message_id=None,
        failure_code="provider_rejected",
        failure_reason="Recipient unavailable",
        provider_response={"status": 400},
        created_at=_NOW,
        updated_at=_NOW,
    )

    assert grant.subject_snapshot.email == "reviewer@example.com"
    assert endpoint.access_capability is not None
    assert endpoint.access_capability.endpoint_ref == endpoint.ref
    assert upload.capability_ref.endpoint_ref == endpoint.ref
    assert failed_attempt.endpoint_ref == endpoint.ref
    assert not hasattr(endpoint.access_capability, "actor")
    assert not hasattr(endpoint.access_capability, "verified_proof")


@pytest.mark.parametrize(
    ("status", "now", "expected_reason"),
    [
        (HumanInputV2FormStatus.SUBMITTED, _NOW, FormInactiveReason.SUBMITTED),
        (HumanInputV2FormStatus.TIMEOUT, _NOW, FormInactiveReason.TIMED_OUT),
        (HumanInputV2FormStatus.EXPIRED, _NOW, FormInactiveReason.STATUS_EXPIRED),
        (
            HumanInputV2FormStatus.WAITING,
            _NOW + timedelta(hours=3),
            FormInactiveReason.GLOBALLY_EXPIRED,
        ),
        (
            HumanInputV2FormStatus.WAITING,
            _NOW + timedelta(minutes=90),
            FormInactiveReason.TIMED_OUT,
        ),
    ],
)
def test_form_returns_stable_inactive_reasons(
    status: HumanInputV2FormStatus,
    now: NaiveDatetime,
    expected_reason: FormInactiveReason,
) -> None:
    state = _form(status=status).state_at(now)

    assert state.reason is expected_reason


def test_waiting_form_accepts_valid_transition_decision_without_mutating_status() -> None:
    form = _form()

    decision = form.decide_submission(
        grant_id=ApproverGrantId("grant-1"),
        selected_action_id="approve",
        now=_NOW,
    )

    assert decision.form_ref == _FORM_REF
    assert decision.grant_id == ApproverGrantId("grant-1")
    assert decision.selected_action_id == "approve"
    assert form.status is HumanInputV2FormStatus.WAITING


def test_form_rejects_invalid_grant_and_selected_action_without_mutating_status() -> None:
    form = _form()

    with pytest.raises(InvalidApproverGrantError):
        form.decide_submission(
            grant_id=ApproverGrantId("grant-missing"),
            selected_action_id="approve",
            now=_NOW,
        )
    with pytest.raises(InvalidSelectedActionError):
        form.decide_submission(
            grant_id=ApproverGrantId("grant-1"),
            selected_action_id="escalate",
            now=_NOW,
        )

    assert form.status is HumanInputV2FormStatus.WAITING


def test_resolved_plan_maps_deterministically_to_one_grant_per_approver_and_separate_endpoints() -> None:
    first_approver = _approver("first@example.com", source_position=0)
    second_email = NormalizedEmail("second@example.com")
    second_approver = ResolvedApprover(
        subject=EmailAddressApprovalSubject(second_email),
        subject_key=CanonicalSubjectKey.for_email(second_email),
        matched_sources=(
            MatchedRecipientSource(RecipientSourceKind.DYNAMIC_EMAIL, 1, "node.email"),
            MatchedRecipientSource(RecipientSourceKind.ONE_TIME_EMAIL, 2, "second@example.com"),
        ),
        subject_snapshot=SubjectSnapshot(display_name="Second", email="second@example.com"),
        endpoints=(EmailEndpointPlan(second_email), EmailEndpointPlan(NormalizedEmail("backup@example.com"))),
    )
    plan = ResolvedApprovalPlan(
        approvers=(first_approver, second_approver),
        rejected_recipients=(),
        failure_reason=None,
    )

    creation = HumanInputForm.create_from_plan(
        ref=_FORM_REF,
        app_id=AppId("app-1"),
        resolved_form=_resolved_form(),
        display_in_ui=True,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=HumanInputV2FormKind.RUNTIME,
        workflow_pause_id="pause-1",
        node_execution_id="node-execution-1",
        plan=plan,
        identifier_factory=_SequentialIdentifierFactory(),
        now=_NOW,
    )

    assert [grant.id for grant in creation.form.grants] == [
        ApproverGrantId("grant-1"),
        ApproverGrantId("grant-2"),
    ]
    assert [endpoint.id for endpoint in creation.endpoints] == [
        DeliveryEndpointId("endpoint-1"),
        DeliveryEndpointId("endpoint-2"),
        DeliveryEndpointId("endpoint-3"),
    ]
    assert creation.form.grants[1].matched_sources == second_approver.matched_sources
    assert [endpoint.grant_ref.grant_id for endpoint in creation.endpoints] == [
        ApproverGrantId("grant-1"),
        ApproverGrantId("grant-2"),
        ApproverGrantId("grant-2"),
    ]


def test_failed_delivery_fact_does_not_change_form_lifecycle() -> None:
    form = _form()

    before = form.state_at(_NOW)
    after = form.state_at(_NOW)

    assert before.is_waiting
    assert after.is_waiting
    assert form.status is HumanInputV2FormStatus.WAITING
