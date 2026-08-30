"""Pure current-state authorization contracts for Human Input v2 submission."""

from dataclasses import fields
from datetime import datetime, timedelta

import pytest
from pydantic import NaiveDatetime

from core.human_input import ButtonStyle
from core.human_input_v2 import MarkdownText, ResolvedForm, ResolvedFormAction
from core.human_input_v2.approval import (
    AccountSubmissionActor,
    ApproverGrant,
    AuthorizationContext,
    ContactApprovalSubject,
    ContactOTPSubject,
    CurrentContactAuthorizationFacts,
    CurrentEndUserAuthorizationFacts,
    CurrentIMAuthorizationFacts,
    DeliveryEndpoint,
    EmailAddressApprovalSubject,
    EmailAddressOTPSubject,
    EmailAddressSubmissionActor,
    EndUserApprovalSubject,
    EndUserSubmissionActor,
    FormRef,
    HumanInputForm,
    IMEndpointConfiguration,
    SubmissionAuthorizationDecision,
    SubmissionAuthorizationRejection,
    SubmissionAuthorizer,
    VerifiedAccountSessionProof,
    VerifiedEmailOTPProof,
    VerifiedIMIdentityProof,
    VerifiedTrustedEndUserProof,
)
from core.human_input_v2.approval.recipient_plan import CanonicalSubjectKey, SubjectSnapshot
from core.human_input_v2.entities import HumanInputV2FormKind, HumanInputV2FormStatus, IMProvider
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    ApproverGrantId,
    ContactId,
    DeliveryEndpointId,
    EndUserId,
    FormId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    OTPChallengeId,
    TenantId,
)

_NOW = datetime(2026, 7, 25, 8)
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))
_ACCOUNT_ID = AccountId("account-1")
_CONTACT_ID = ContactId("contact-1")
_EMAIL = NormalizedEmail("reviewer@example.com")
_END_USER_ID = EndUserId("end-user-1")
_INTEGRATION_ID = IntegrationId("integration-1")
_IM_IDENTITY_ID = IMIdentityId("identity-1")
_IM_BINDING_ID = IMBindingId("binding-1")


def _grant(subject: ContactApprovalSubject | EndUserApprovalSubject | EmailAddressApprovalSubject) -> ApproverGrant:
    grant_ref = _FORM_REF.grant(ApproverGrantId("grant-1"))
    if isinstance(subject, ContactApprovalSubject):
        subject_key = CanonicalSubjectKey.for_contact(subject.contact_id)
    elif isinstance(subject, EndUserApprovalSubject):
        subject_key = CanonicalSubjectKey.for_end_user(subject.end_user_id)
    else:
        subject_key = CanonicalSubjectKey.for_email(subject.normalized_email)
    return ApproverGrant(
        ref=grant_ref,
        subject=subject,
        subject_key=subject_key,
        matched_sources=(),
        subject_snapshot=SubjectSnapshot("Reviewer", str(_EMAIL)),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _form(grant: ApproverGrant, *, status: HumanInputV2FormStatus = HumanInputV2FormStatus.WAITING) -> HumanInputForm:
    return HumanInputForm(
        ref=_FORM_REF,
        app_id=AppId("app-1"),
        resolved_form=ResolvedForm(
            title="Review",
            blocks=(MarkdownText("Approve"),),
            user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
            legacy_form_content="Approve",
        ),
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


def _im_endpoint(grant: ApproverGrant) -> DeliveryEndpoint:
    return DeliveryEndpoint(
        ref=grant.ref.endpoint(DeliveryEndpointId("endpoint-1")),
        configuration=IMEndpointConfiguration(
            integration_id=_INTEGRATION_ID,
            provider=IMProvider.SLACK,
            provider_tenant_id="provider-tenant-1",
            identity_id=_IM_IDENTITY_ID,
            binding_id=_IM_BINDING_ID,
            provider_user_id="provider-user-1",
        ),
        address_hash="a" * 64,
        access_capability=None,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _contact_facts(
    *,
    contact_id: ContactId = _CONTACT_ID,
    account_id: AccountId | None = _ACCOUNT_ID,
    normalized_email: NormalizedEmail | None = _EMAIL,
    account_active: bool = True,
    workspace_available: bool = True,
) -> CurrentContactAuthorizationFacts:
    return CurrentContactAuthorizationFacts(
        contact_id=contact_id,
        account_id=account_id,
        normalized_email=normalized_email,
        account_active=account_active,
        workspace_available=workspace_available,
    )


def _im_facts(*, binding_id: IMBindingId | None = _IM_BINDING_ID) -> CurrentIMAuthorizationFacts:
    return CurrentIMAuthorizationFacts(
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.SLACK,
        provider_tenant_id="provider-tenant-1",
        contact_id=_CONTACT_ID,
        account_id=_ACCOUNT_ID,
        identity_id=_IM_IDENTITY_ID,
        binding_id=binding_id,
        provider_user_id="provider-user-1",
    )


def _context(
    grant: ApproverGrant,
    *,
    endpoint: DeliveryEndpoint | None = None,
    contact: CurrentContactAuthorizationFacts | None = None,
    end_user: CurrentEndUserAuthorizationFacts | None = None,
    im: CurrentIMAuthorizationFacts | None = None,
    status: HumanInputV2FormStatus = HumanInputV2FormStatus.WAITING,
) -> AuthorizationContext:
    return AuthorizationContext(
        form=_form(grant, status=status),
        grant=grant,
        endpoint=endpoint,
        current_contact=contact,
        current_end_user=end_user,
        current_im_binding=im,
    )


def _email_proof(grant: ApproverGrant, *, contact_id: ContactId | None = _CONTACT_ID) -> VerifiedEmailOTPProof:
    subject = ContactOTPSubject(contact_id) if contact_id is not None else EmailAddressOTPSubject(_EMAIL)
    return VerifiedEmailOTPProof(
        challenge_ref=grant.ref.challenge(OTPChallengeId("challenge-1")),
        subject=subject,
        normalized_email=_EMAIL,
        verified_at=_NOW,
    )


def _im_proof(*, binding_id: IMBindingId | None = _IM_BINDING_ID) -> VerifiedIMIdentityProof:
    return VerifiedIMIdentityProof(
        integration_id=_INTEGRATION_ID,
        identity_id=_IM_IDENTITY_ID,
        binding_id=binding_id,
        provider=IMProvider.SLACK,
        provider_tenant_id="provider-tenant-1",
        provider_user_id="provider-user-1",
    )


def _authorize(
    context: AuthorizationContext,
    proof: object,
    *,
    selected_action_id: str = "approve",
    now: NaiveDatetime = _NOW,
) -> SubmissionAuthorizationDecision:
    return SubmissionAuthorizer.authorize(
        context=context,
        proof=proof,
        selected_action_id=selected_action_id,
        now=now,
    )


@pytest.mark.parametrize("raw_candidate", ["123456", {"token": "secret"}, object()])
def test_raw_credentials_fail_closed_at_the_pure_authorization_boundary(raw_candidate: object) -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(_context(grant, contact=_contact_facts()), raw_candidate)

    assert decision.authorized is None
    assert decision.rejection is SubmissionAuthorizationRejection.RAW_CREDENTIAL_NOT_VERIFIED


def test_grant_endpoint_verified_proof_and_actor_are_not_interchangeable() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))
    endpoint = _im_endpoint(grant)
    context = _context(grant, endpoint=endpoint, contact=_contact_facts(), im=_im_facts())

    grant_decision = _authorize(context, grant)
    endpoint_decision = _authorize(context, endpoint)
    proof_decision = _authorize(context, _im_proof())

    assert grant_decision.rejection is SubmissionAuthorizationRejection.RAW_CREDENTIAL_NOT_VERIFIED
    assert endpoint_decision.rejection is SubmissionAuthorizationRejection.RAW_CREDENTIAL_NOT_VERIFIED
    assert isinstance(proof_decision.authorized.actor, AccountSubmissionActor)
    assert proof_decision.authorized.proof != proof_decision.authorized.actor


def test_verified_account_session_resolves_the_current_contact_account_actor() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(_context(grant, contact=_contact_facts()), VerifiedAccountSessionProof(_ACCOUNT_ID))

    assert decision.rejection is None
    assert decision.authorized is not None
    assert decision.authorized.actor == AccountSubmissionActor(_ACCOUNT_ID)


def test_trusted_end_user_remains_a_distinct_end_user_actor() -> None:
    grant = _grant(EndUserApprovalSubject(_END_USER_ID))
    current_end_user = CurrentEndUserAuthorizationFacts(
        end_user_id=_END_USER_ID,
        app_id=AppId("app-1"),
        workspace_available=True,
    )

    decision = _authorize(
        _context(grant, end_user=current_end_user),
        VerifiedTrustedEndUserProof(end_user_id=_END_USER_ID, app_id=AppId("app-1")),
    )

    assert decision.rejection is None
    assert decision.authorized is not None
    assert decision.authorized.actor == EndUserSubmissionActor(_END_USER_ID)


def test_standalone_email_otp_resolves_an_email_address_actor() -> None:
    grant = _grant(EmailAddressApprovalSubject(_EMAIL))

    decision = _authorize(_context(grant), _email_proof(grant, contact_id=None))

    assert decision.rejection is None
    assert decision.authorized is not None
    assert decision.authorized.actor == EmailAddressSubmissionActor(_EMAIL)


def test_contact_email_otp_uses_current_account_when_available() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(_context(grant, contact=_contact_facts()), _email_proof(grant))

    assert decision.rejection is None
    assert decision.authorized is not None
    assert decision.authorized.actor == AccountSubmissionActor(_ACCOUNT_ID)


def test_external_contact_email_otp_uses_the_verified_email_actor() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(
        _context(grant, contact=_contact_facts(account_id=None)),
        _email_proof(grant),
    )

    assert decision.rejection is None
    assert decision.authorized is not None
    assert decision.authorized.actor == EmailAddressSubmissionActor(_EMAIL)


def test_current_im_binding_resolves_only_to_the_current_dify_account() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))
    endpoint = _im_endpoint(grant)

    decision = _authorize(
        _context(grant, endpoint=endpoint, contact=_contact_facts(), im=_im_facts()),
        _im_proof(),
    )

    assert decision.rejection is None
    assert decision.authorized is not None
    assert decision.authorized.actor == AccountSubmissionActor(_ACCOUNT_ID)


def test_verified_proof_scoped_to_another_grant_is_rejected() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))
    other_grant = ApproverGrant(
        ref=_FORM_REF.grant(ApproverGrantId("grant-2")),
        subject=grant.subject,
        subject_key=grant.subject_key,
        matched_sources=(),
        subject_snapshot=grant.subject_snapshot,
        created_at=_NOW,
        updated_at=_NOW,
    )

    decision = _authorize(_context(grant, contact=_contact_facts()), _email_proof(other_grant))

    assert decision.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED


@pytest.mark.parametrize(
    ("contact", "expected"),
    [
        (None, SubmissionAuthorizationRejection.STALE_IDENTITY),
        (_contact_facts(account_active=False), SubmissionAuthorizationRejection.ACCOUNT_DISABLED),
        (
            _contact_facts(contact_id=ContactId("recreated-contact")),
            SubmissionAuthorizationRejection.STALE_IDENTITY,
        ),
        (
            _contact_facts(normalized_email=NormalizedEmail("changed@example.com")),
            SubmissionAuthorizationRejection.STALE_IDENTITY,
        ),
        (
            _contact_facts(workspace_available=False),
            SubmissionAuthorizationRejection.WORKSPACE_UNAVAILABLE,
        ),
    ],
)
def test_contact_email_proof_revalidates_every_current_identity_fact(
    contact: CurrentContactAuthorizationFacts | None,
    expected: SubmissionAuthorizationRejection,
) -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(_context(grant, contact=contact), _email_proof(grant))

    assert decision.rejection is expected


def test_changed_effective_im_binding_rejects_historical_im_proof() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))
    endpoint = _im_endpoint(grant)

    decision = _authorize(
        _context(
            grant,
            endpoint=endpoint,
            contact=_contact_facts(),
            im=_im_facts(binding_id=IMBindingId("replacement-binding")),
        ),
        _im_proof(),
    )

    assert decision.rejection is SubmissionAuthorizationRejection.IM_BINDING_CHANGED


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        (HumanInputV2FormStatus.SUBMITTED, SubmissionAuthorizationRejection.FORM_ALREADY_SUBMITTED),
        (HumanInputV2FormStatus.TIMEOUT, SubmissionAuthorizationRejection.FORM_TIMED_OUT),
        (HumanInputV2FormStatus.EXPIRED, SubmissionAuthorizationRejection.FORM_STATUS_EXPIRED),
    ],
)
def test_inactive_form_states_remain_stable_and_transport_neutral(
    status: HumanInputV2FormStatus,
    expected: SubmissionAuthorizationRejection,
) -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(_context(grant, contact=_contact_facts(), status=status), _email_proof(grant))

    assert decision.rejection is expected


def test_authorization_context_is_an_immutable_snapshot_without_version_or_reload_hooks() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))
    mutable_current_state = {"account_active": True, "workspace_available": True}
    context = _context(
        grant,
        contact=_contact_facts(
            account_active=mutable_current_state["account_active"],
            workspace_available=mutable_current_state["workspace_available"],
        ),
    )
    mutable_current_state["account_active"] = False
    mutable_current_state["workspace_available"] = False

    decision = _authorize(context, _email_proof(grant))

    assert decision.rejection is None
    assert {field.name for field in fields(AuthorizationContext)}.isdisjoint(
        {"contact_version", "binding_version", "reload", "loader"}
    )
    assert AuthorizationContext.__dataclass_params__.frozen is True


@pytest.mark.parametrize(
    ("provider_tenant_id", "provider_user_id"),
    [("", "provider-user-1"), ("provider-tenant-1", "  ")],
)
def test_verified_im_proof_rejects_blank_provider_identity(
    provider_tenant_id: str,
    provider_user_id: str,
) -> None:
    with pytest.raises(ValueError, match="must not be blank"):
        VerifiedIMIdentityProof(
            integration_id=_INTEGRATION_ID,
            identity_id=_IM_IDENTITY_ID,
            binding_id=_IM_BINDING_ID,
            provider=IMProvider.SLACK,
            provider_tenant_id=provider_tenant_id,
            provider_user_id=provider_user_id,
        )


def test_authorization_context_rejects_grant_or_endpoint_from_another_owner() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))
    other_grant = ApproverGrant(
        ref=_FORM_REF.grant(ApproverGrantId("grant-2")),
        subject=EndUserApprovalSubject(_END_USER_ID),
        subject_key=CanonicalSubjectKey.for_end_user(_END_USER_ID),
        matched_sources=(),
        subject_snapshot=SubjectSnapshot("Other Reviewer", None),
        created_at=_NOW,
        updated_at=_NOW,
    )

    with pytest.raises(ValueError, match="grant does not belong"):
        AuthorizationContext(_form(grant), other_grant, None, None, None, None)
    with pytest.raises(ValueError, match="endpoint does not belong"):
        AuthorizationContext(_form(grant), grant, _im_endpoint(other_grant), None, None, None)


def test_authorization_decision_requires_exactly_one_outcome() -> None:
    with pytest.raises(ValueError, match="exactly one outcome"):
        SubmissionAuthorizationDecision(None, None)


def test_invalid_selected_action_returns_transport_neutral_rejection() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(
        _context(grant, contact=_contact_facts()),
        VerifiedAccountSessionProof(_ACCOUNT_ID),
        selected_action_id="unknown",
    )

    assert decision.rejection is SubmissionAuthorizationRejection.INVALID_SELECTED_ACTION


def test_waiting_form_past_global_expiry_returns_global_expired_rejection() -> None:
    grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    decision = _authorize(
        _context(grant, contact=_contact_facts()),
        VerifiedAccountSessionProof(_ACCOUNT_ID),
        now=_NOW + timedelta(hours=3),
    )

    assert decision.rejection is SubmissionAuthorizationRejection.FORM_GLOBALLY_EXPIRED


def test_account_session_requires_contact_grant_current_contact_and_matching_account() -> None:
    end_user_grant = _grant(EndUserApprovalSubject(_END_USER_ID))
    contact_grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    wrong_subject = _authorize(_context(end_user_grant), VerifiedAccountSessionProof(_ACCOUNT_ID))
    missing_contact = _authorize(_context(contact_grant), VerifiedAccountSessionProof(_ACCOUNT_ID))
    wrong_account = _authorize(
        _context(contact_grant, contact=_contact_facts()),
        VerifiedAccountSessionProof(AccountId("account-2")),
    )

    assert wrong_subject.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
    assert missing_contact.rejection is SubmissionAuthorizationRejection.STALE_IDENTITY
    assert wrong_account.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED


def test_trusted_end_user_requires_end_user_grant_current_owner_and_workspace() -> None:
    contact_grant = _grant(ContactApprovalSubject(_CONTACT_ID))
    end_user_grant = _grant(EndUserApprovalSubject(_END_USER_ID))
    proof = VerifiedTrustedEndUserProof(_END_USER_ID, AppId("app-1"))

    wrong_subject = _authorize(_context(contact_grant, contact=_contact_facts()), proof)
    missing_end_user = _authorize(_context(end_user_grant), proof)
    unavailable_workspace = _authorize(
        _context(
            end_user_grant,
            end_user=CurrentEndUserAuthorizationFacts(_END_USER_ID, AppId("app-1"), False),
        ),
        proof,
    )

    assert wrong_subject.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
    assert missing_end_user.rejection is SubmissionAuthorizationRejection.END_USER_UNAVAILABLE
    assert unavailable_workspace.rejection is SubmissionAuthorizationRejection.WORKSPACE_UNAVAILABLE


def test_email_proof_requires_matching_subject_kind_and_contact_incarnation() -> None:
    standalone_grant = _grant(EmailAddressApprovalSubject(_EMAIL))
    contact_grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    standalone_with_contact_proof = _authorize(_context(standalone_grant), _email_proof(standalone_grant))
    contact_with_email_address_proof = _authorize(
        _context(contact_grant, contact=_contact_facts()),
        _email_proof(contact_grant, contact_id=None),
    )
    changed_contact_incarnation = _authorize(
        _context(contact_grant, contact=_contact_facts()),
        _email_proof(contact_grant, contact_id=ContactId("contact-2")),
    )

    assert standalone_with_contact_proof.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
    assert contact_with_email_address_proof.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
    assert changed_contact_incarnation.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED


def test_im_proof_requires_contact_account_and_current_effective_binding() -> None:
    end_user_grant = _grant(EndUserApprovalSubject(_END_USER_ID))
    contact_grant = _grant(ContactApprovalSubject(_CONTACT_ID))

    wrong_subject = _authorize(_context(end_user_grant), _im_proof())
    missing_contact = _authorize(_context(contact_grant), _im_proof())
    contact_without_account = _authorize(
        _context(contact_grant, contact=_contact_facts(account_id=None)),
        _im_proof(),
    )
    missing_binding = _authorize(
        _context(contact_grant, contact=_contact_facts()),
        _im_proof(),
    )

    assert wrong_subject.rejection is SubmissionAuthorizationRejection.GRANT_NOT_MATCHED
    assert missing_contact.rejection is SubmissionAuthorizationRejection.STALE_IDENTITY
    assert contact_without_account.rejection is SubmissionAuthorizationRejection.STALE_IDENTITY
    assert missing_binding.rejection is SubmissionAuthorizationRejection.IM_BINDING_CHANGED
