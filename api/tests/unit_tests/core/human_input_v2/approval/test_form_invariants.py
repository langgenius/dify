"""Boundary and failure-path tests for Form Core immutable domain values."""

from collections.abc import Mapping
from datetime import datetime, timedelta

import pytest
from pydantic import JsonValue

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    ApproverGrant,
    CanonicalSubjectKey,
    ConsoleEndpointConfiguration,
    ConsoleEndpointPlan,
    ContactApprovalSubject,
    DeliveryAttempt,
    DeliveryEndpoint,
    EmailAddressApprovalSubject,
    EmailEndpointConfiguration,
    EmailEndpointPlan,
    EndpointAccessCapability,
    FormCreation,
    FormInactiveReason,
    FormRef,
    HumanInputForm,
    IMEndpointConfiguration,
    IMEndpointPlan,
    MatchedRecipientSource,
    RecipientResolutionFailureReason,
    RecipientSourceKind,
    ResolvedApprovalPlan,
    ResolvedApprover,
    SubjectSnapshot,
    UploadCapability,
    UploadFileAssociation,
    WebEndpointConfiguration,
    WebEndpointPlan,
)
from core.human_input_v2.entities import (
    HumanInputDeliveryAttemptStatus,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
    IMProvider,
)
from core.human_input_v2.shared import (
    AppId,
    ApproverGrantId,
    ContactId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    FormId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    UploadCapabilityId,
    UploadFileAssociationId,
)

_NOW = datetime(2026, 7, 25, 8)
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))


def _email_approver(email: str = "reviewer@example.com") -> ResolvedApprover:
    normalized_email = NormalizedEmail(email)
    return ResolvedApprover(
        subject=EmailAddressApprovalSubject(normalized_email),
        subject_key=CanonicalSubjectKey.for_email(normalized_email),
        matched_sources=(MatchedRecipientSource(RecipientSourceKind.ONE_TIME_EMAIL, 0, email),),
        subject_snapshot=SubjectSnapshot("Reviewer", email),
        endpoints=(EmailEndpointPlan(normalized_email),),
    )


def _grant(
    *,
    grant_id: str = "grant-1",
    form_ref: FormRef = _FORM_REF,
    approver: ResolvedApprover | None = None,
) -> ApproverGrant:
    return ApproverGrant.from_resolved_approver(
        grant_id=ApproverGrantId(grant_id),
        form_ref=form_ref,
        approver=approver or _email_approver(),
        now=_NOW,
    )


def _resolved_form() -> ResolvedForm:
    return ResolvedForm(
        title=None,
        blocks=(MarkdownText("Approve"),),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="Approve",
    )


def _form(
    *,
    kind: HumanInputV2FormKind = HumanInputV2FormKind.RUNTIME,
    workflow_pause_id: str | None = "pause-1",
    node_execution_id: str | None = "execution-1",
    grants: tuple[ApproverGrant, ...] | list[ApproverGrant] | None = None,
    status: HumanInputV2FormStatus = HumanInputV2FormStatus.WAITING,
) -> HumanInputForm:
    return HumanInputForm(
        ref=_FORM_REF,
        app_id=AppId("app-1"),
        resolved_form=_resolved_form(),
        display_in_ui=None,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=kind,
        status=status,
        workflow_pause_id=workflow_pause_id,
        node_execution_id=node_execution_id,
        grants=(_grant(),) if grants is None else grants,
        created_at=_NOW,
        updated_at=_NOW,
    )


@pytest.mark.parametrize(
    ("action_id", "title"),
    [("", "Approve"), ("approve", "")],
)
def test_card_action_rejects_each_blank_component(action_id: str, title: str) -> None:
    with pytest.raises(ValueError, match="must not be blank"):
        ResolvedFormAction(action_id, title, ButtonStyle.PRIMARY)


def test_resolved_form_rejects_mutable_actions_and_duplicate_actions() -> None:
    action = ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY)

    with pytest.raises(TypeError, match="immutable tuple"):
        ResolvedForm(None, (), [action], "Approve")
    with pytest.raises(ValueError, match="unique"):
        ResolvedForm(None, (), (action, action), "Approve")


def test_grant_rejects_mutable_sources_and_mismatched_subject_key() -> None:
    approver = _email_approver()

    with pytest.raises(TypeError, match="immutable tuple"):
        ApproverGrant(
            ref=_FORM_REF.grant(ApproverGrantId("grant-1")),
            subject=approver.subject,
            subject_key=approver.subject_key,
            matched_sources=list(approver.matched_sources),
            subject_snapshot=approver.subject_snapshot,
            created_at=_NOW,
            updated_at=_NOW,
        )
    with pytest.raises(ValueError, match="subject key"):
        ApproverGrant(
            ref=_FORM_REF.grant(ApproverGrantId("grant-1")),
            subject=ContactApprovalSubject(ContactId("contact-1")),
            subject_key=CanonicalSubjectKey.for_contact(ContactId("contact-2")),
            matched_sources=approver.matched_sources,
            subject_snapshot=approver.subject_snapshot,
            created_at=_NOW,
            updated_at=_NOW,
        )


def test_endpoint_factory_maps_each_channel_to_a_typed_configuration() -> None:
    grant_ref = _FORM_REF.grant(ApproverGrantId("grant-1"))
    plans = (
        EmailEndpointPlan(NormalizedEmail("reviewer@example.com")),
        IMEndpointPlan(
            integration_id=IntegrationId("integration-1"),
            provider=IMProvider.FEISHU,
            provider_tenant_id="provider-tenant-1",
            identity_id=IMIdentityId("identity-1"),
            binding_id=IMBindingId("binding-1"),
            provider_user_id="provider-user-1",
        ),
        WebEndpointPlan(),
        ConsoleEndpointPlan(),
    )

    endpoints = tuple(
        DeliveryEndpoint.from_plan(
            endpoint_id=DeliveryEndpointId(f"endpoint-{position}"),
            grant_ref=grant_ref,
            endpoint_plan=plan,
            access_capability=None,
            now=_NOW,
        )
        for position, plan in enumerate(plans)
    )

    assert isinstance(endpoints[0].configuration, EmailEndpointConfiguration)
    assert isinstance(endpoints[1].configuration, IMEndpointConfiguration)
    assert isinstance(endpoints[2].configuration, WebEndpointConfiguration)
    assert isinstance(endpoints[3].configuration, ConsoleEndpointConfiguration)
    assert len({endpoint.address_hash for endpoint in endpoints}) == 4


@pytest.mark.parametrize(
    ("provider_tenant_id", "provider_user_id"),
    [("", "user-1"), ("tenant-1", "")],
)
def test_im_endpoint_configuration_rejects_blank_provider_identity(
    provider_tenant_id: str,
    provider_user_id: str,
) -> None:
    with pytest.raises(ValueError, match="must not be blank"):
        IMEndpointConfiguration(
            integration_id=IntegrationId("integration-1"),
            provider=IMProvider.FEISHU,
            provider_tenant_id=provider_tenant_id,
            identity_id=IMIdentityId("identity-1"),
            binding_id=None,
            provider_user_id=provider_user_id,
        )


def test_hashes_and_endpoint_capability_owner_are_strict() -> None:
    grant_ref = _FORM_REF.grant(ApproverGrantId("grant-1"))
    endpoint_ref = grant_ref.endpoint(DeliveryEndpointId("endpoint-1"))

    with pytest.raises(ValueError, match="SHA-256"):
        EndpointAccessCapability(endpoint_ref, "short")
    with pytest.raises(ValueError, match="SHA-256"):
        EndpointAccessCapability(endpoint_ref, "z" * 64)
    with pytest.raises(ValueError, match="owner"):
        DeliveryEndpoint(
            ref=endpoint_ref,
            configuration=WebEndpointConfiguration(),
            address_hash="a" * 64,
            access_capability=EndpointAccessCapability(grant_ref.endpoint(DeliveryEndpointId("endpoint-2")), "b" * 64),
            created_at=_NOW,
            updated_at=_NOW,
        )
    with pytest.raises(ValueError, match="SHA-256"):
        UploadCapability(UploadCapabilityId("upload-1"), endpoint_ref, AppId("app-1"), "z" * 64, _NOW, _NOW)


def test_delivery_attempt_validates_sequence_terminal_time_and_failure_diagnostics() -> None:
    endpoint_ref = _FORM_REF.grant(ApproverGrantId("grant-1")).endpoint(DeliveryEndpointId("endpoint-1"))

    with pytest.raises(ValueError, match="positive"):
        DeliveryAttempt(
            DeliveryAttemptId("attempt-1"),
            endpoint_ref,
            0,
            HumanInputDeliveryAttemptStatus.QUEUED,
            _NOW,
            None,
            None,
            None,
            None,
            None,
            None,
            _NOW,
            _NOW,
        )
    with pytest.raises(ValueError, match="finished_at"):
        DeliveryAttempt(
            DeliveryAttemptId("attempt-1"),
            endpoint_ref,
            1,
            HumanInputDeliveryAttemptStatus.FAILED,
            _NOW,
            _NOW,
            None,
            None,
            "failed",
            None,
            None,
            _NOW,
            _NOW,
        )
    with pytest.raises(ValueError, match="only failed"):
        DeliveryAttempt(
            DeliveryAttemptId("attempt-1"),
            endpoint_ref,
            1,
            HumanInputDeliveryAttemptStatus.SENT,
            _NOW,
            _NOW,
            _NOW,
            "message-1",
            "invalid",
            None,
            None,
            _NOW,
            _NOW,
        )
    with pytest.raises(ValueError, match="only failed"):
        DeliveryAttempt(
            DeliveryAttemptId("attempt-1"),
            endpoint_ref,
            1,
            HumanInputDeliveryAttemptStatus.SENT,
            _NOW,
            _NOW,
            _NOW,
            "message-1",
            None,
            "invalid",
            None,
            _NOW,
            _NOW,
        )
    queued = DeliveryAttempt(
        DeliveryAttemptId("attempt-1"),
        endpoint_ref,
        1,
        HumanInputDeliveryAttemptStatus.QUEUED,
        _NOW,
        None,
        None,
        None,
        None,
        None,
        None,
        _NOW,
        _NOW,
    )
    assert queued.status is HumanInputDeliveryAttemptStatus.QUEUED


@pytest.mark.parametrize(
    ("failure_code", "failure_reason", "provider_response"),
    [
        (None, None, None),
        ("", " ", None),
    ],
)
def test_failed_delivery_attempt_requires_at_least_one_diagnostic(
    failure_code: str | None,
    failure_reason: str | None,
    provider_response: Mapping[str, JsonValue] | None,
) -> None:
    endpoint_ref = _FORM_REF.grant(ApproverGrantId("grant-1")).endpoint(DeliveryEndpointId("endpoint-1"))

    with pytest.raises(ValueError, match="failure diagnostic"):
        DeliveryAttempt(
            DeliveryAttemptId("attempt-1"),
            endpoint_ref,
            1,
            HumanInputDeliveryAttemptStatus.FAILED,
            _NOW,
            _NOW,
            _NOW,
            None,
            failure_code,
            failure_reason,
            provider_response,
            _NOW,
            _NOW,
        )


@pytest.mark.parametrize(
    ("failure_code", "failure_reason", "provider_response"),
    [
        ("provider_rejected", None, None),
        (None, "Recipient unavailable", None),
        (None, None, {"status": 400}),
    ],
)
def test_failed_delivery_attempt_accepts_each_supported_diagnostic(
    failure_code: str | None,
    failure_reason: str | None,
    provider_response: Mapping[str, JsonValue] | None,
) -> None:
    endpoint_ref = _FORM_REF.grant(ApproverGrantId("grant-1")).endpoint(DeliveryEndpointId("endpoint-1"))

    attempt = DeliveryAttempt(
        DeliveryAttemptId("attempt-1"),
        endpoint_ref,
        1,
        HumanInputDeliveryAttemptStatus.FAILED,
        _NOW,
        _NOW,
        _NOW,
        None,
        failure_code,
        failure_reason,
        provider_response,
        _NOW,
        _NOW,
    )

    assert attempt.status is HumanInputDeliveryAttemptStatus.FAILED


def test_upload_file_requires_a_non_blank_file_identifier() -> None:
    endpoint_ref = _FORM_REF.grant(ApproverGrantId("grant-1")).endpoint(DeliveryEndpointId("endpoint-1"))
    capability = UploadCapability(UploadCapabilityId("upload-1"), endpoint_ref, AppId("app-1"), "b" * 64, _NOW, _NOW)

    with pytest.raises(ValueError, match="must not be blank"):
        UploadFileAssociation(UploadFileAssociationId("association-1"), capability.ref, " ", _NOW, _NOW)


def test_form_and_creation_reject_invalid_owner_and_collection_shapes() -> None:
    with pytest.raises(TypeError, match="grants"):
        _form(grants=[_grant()])
    with pytest.raises(ValueError, match="runtime form"):
        _form(workflow_pause_id=None)
    with pytest.raises(ValueError, match="runtime form"):
        _form(node_execution_id=None)
    delivery_test = _form(
        kind=HumanInputV2FormKind.DELIVERY_TEST,
        workflow_pause_id=None,
        node_execution_id=None,
    )
    assert delivery_test.kind is HumanInputV2FormKind.DELIVERY_TEST

    other_ref = FormRef(TenantId("workspace-2"), FormId("form-2"))
    with pytest.raises(ValueError, match="another owner"):
        _form(grants=(_grant(form_ref=other_ref),))
    with pytest.raises(ValueError, match="unique"):
        _form(grants=(_grant(), _grant()))
    same_subject = _email_approver()
    with pytest.raises(ValueError, match="unique"):
        _form(
            grants=(
                _grant(grant_id="grant-1", approver=same_subject),
                _grant(grant_id="grant-2", approver=same_subject),
            )
        )

    valid_form = _form()
    with pytest.raises(TypeError, match="immutable tuple"):
        FormCreation(valid_form, [])
    outside_endpoint = DeliveryEndpoint.from_plan(
        endpoint_id=DeliveryEndpointId("endpoint-outside"),
        grant_ref=other_ref.grant(ApproverGrantId("grant-outside")),
        endpoint_plan=WebEndpointPlan(),
        access_capability=None,
        now=_NOW,
    )
    with pytest.raises(ValueError, match="outside"):
        FormCreation(valid_form, (outside_endpoint,))


def test_inactive_form_returns_state_instead_of_a_transition_decision() -> None:
    form = _form(status=HumanInputV2FormStatus.SUBMITTED)

    result = form.decide_submission(
        grant_id=ApproverGrantId("grant-1"),
        selected_action_id="approve",
        now=_NOW,
    )

    assert result.reason is FormInactiveReason.SUBMITTED


def test_failed_recipient_plan_cannot_create_a_form_snapshot() -> None:
    plan = ResolvedApprovalPlan(
        approvers=(),
        rejected_recipients=(),
        failure_reason=RecipientResolutionFailureReason.NO_VALID_RECIPIENTS,
    )

    class _UnusedFactory:
        def new_grant_id(self) -> ApproverGrantId:
            raise AssertionError("must not generate identifiers")

        def new_endpoint_id(self) -> DeliveryEndpointId:
            raise AssertionError("must not generate identifiers")

    with pytest.raises(ValueError, match="approvers"):
        HumanInputForm.create_from_plan(
            ref=_FORM_REF,
            app_id=AppId("app-1"),
            resolved_form=_resolved_form(),
            display_in_ui=None,
            node_timeout_at=_NOW + timedelta(hours=1),
            global_expires_at=_NOW + timedelta(hours=2),
            kind=HumanInputV2FormKind.RUNTIME,
            workflow_pause_id="pause-1",
            node_execution_id="execution-1",
            plan=plan,
            identifier_factory=_UnusedFactory(),
            now=_NOW,
        )
