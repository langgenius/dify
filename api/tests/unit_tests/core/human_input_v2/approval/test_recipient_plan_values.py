"""Immutable approval plan value tests."""

import json
from dataclasses import FrozenInstanceError

import pytest

from core.human_input_v2.approval import (
    CanonicalSubjectKey,
    ConsoleEndpointPlan,
    ContactApprovalSubject,
    EmailAddressApprovalSubject,
    EmailEndpointPlan,
    EndUserApprovalSubject,
    IMEndpointPlan,
    MatchedRecipientSource,
    RecipientRejectionReason,
    RecipientResolutionFailureReason,
    RecipientSourceKind,
    RejectedRecipient,
    ResolvedApprovalPlan,
    ResolvedApprover,
    SubjectSnapshot,
    WebEndpointPlan,
)
from core.human_input_v2.entities import HumanInputDeliveryChannel, IMProvider
from core.human_input_v2.shared import (
    ContactId,
    EndUserId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
)


def test_canonical_subject_keys_are_typed_and_email_keys_do_not_expose_the_address() -> None:
    email = NormalizedEmail("USER@example.com")

    assert CanonicalSubjectKey.for_contact(ContactId("contact-1")).value == "contact:contact-1"
    assert CanonicalSubjectKey.for_end_user(EndUserId("end-user-1")).value == "end_user:end-user-1"
    email_key = CanonicalSubjectKey.for_email(email)
    assert email_key.value.startswith("email_address:")
    assert email.value not in email_key.value
    assert email_key == CanonicalSubjectKey.for_email(NormalizedEmail("user@example.com"))


@pytest.mark.parametrize(
    "invalid_key",
    ["", "contact:", "end_user:", "email_address:not-a-sha256"],
)
def test_canonical_subject_key_rejects_values_outside_the_portable_format(invalid_key: str) -> None:
    with pytest.raises(ValueError, match="canonical subject key"):
        CanonicalSubjectKey(invalid_key)


def test_subject_values_are_discriminated_without_conflating_delivery_channels() -> None:
    assert ContactApprovalSubject(ContactId("contact-1")).to_primitive() == {
        "type": "contact",
        "contact_id": "contact-1",
    }
    assert EndUserApprovalSubject(EndUserId("end-user-1")).to_primitive() == {
        "type": "end_user",
        "end_user_id": "end-user-1",
    }
    assert EmailAddressApprovalSubject(NormalizedEmail("user@example.com")).to_primitive() == {
        "type": "email_address",
        "normalized_email": "user@example.com",
    }


def test_approval_plan_is_deeply_immutable_and_has_an_explicit_serializable_boundary() -> None:
    source = MatchedRecipientSource(RecipientSourceKind.STATIC_CONTACT, 0, "contact-1")
    endpoint = EmailEndpointPlan(NormalizedEmail("user@example.com"))
    approver = ResolvedApprover(
        subject=ContactApprovalSubject(ContactId("contact-1")),
        subject_key=CanonicalSubjectKey.for_contact(ContactId("contact-1")),
        matched_sources=(source,),
        subject_snapshot=SubjectSnapshot(display_name="Reviewer", email="user@example.com"),
        endpoints=(endpoint,),
    )
    plan = ResolvedApprovalPlan(approvers=(approver,), rejected_recipients=(), failure_reason=None)

    primitive = plan.to_primitive()

    assert json.loads(json.dumps(primitive)) == primitive
    assert primitive["approvers"][0]["endpoints"] == [
        {"channel": HumanInputDeliveryChannel.EMAIL.value, "email_address": "user@example.com"}
    ]
    with pytest.raises(FrozenInstanceError):
        plan.approvers = ()
    with pytest.raises(TypeError):
        json.dumps(plan)


def test_im_endpoint_and_rejected_fact_keep_transport_neutral_structured_facts() -> None:
    endpoint = IMEndpointPlan(
        integration_id=IntegrationId("integration-1"),
        provider=IMProvider.FEISHU,
        provider_tenant_id="provider-tenant-1",
        identity_id=IMIdentityId("identity-1"),
        binding_id=IMBindingId("binding-1"),
        provider_user_id="provider-user-1",
    )
    rejection = RejectedRecipient(
        source=MatchedRecipientSource(RecipientSourceKind.DYNAMIC_EMAIL, 2, "node-1.email"),
        reason=RecipientRejectionReason.UNSUPPORTED_DYNAMIC_TYPE,
        rejected_value="list",
    )
    plan = ResolvedApprovalPlan(
        approvers=(),
        rejected_recipients=(rejection,),
        failure_reason=RecipientResolutionFailureReason.NO_VALID_RECIPIENTS,
    )

    assert endpoint.to_primitive() == {
        "channel": "im",
        "integration_id": "integration-1",
        "provider": "feishu",
        "provider_tenant_id": "provider-tenant-1",
        "identity_id": "identity-1",
        "binding_id": "binding-1",
        "provider_user_id": "provider-user-1",
    }
    assert plan.to_primitive()["rejected_recipients"] == [
        {
            "source": {"kind": "dynamic_email", "position": 2, "reference": "node-1.email"},
            "reason": "unsupported_dynamic_type",
            "rejected_value": "list",
        }
    ]
    assert plan.to_primitive()["failure_reason"] == "no_valid_recipients"


def test_value_invariants_reject_mutable_collections_and_inconsistent_subject_keys() -> None:
    source = MatchedRecipientSource(RecipientSourceKind.STATIC_CONTACT, 0, "contact-1")
    endpoint = EmailEndpointPlan(NormalizedEmail("user@example.com"))
    snapshot = SubjectSnapshot("Reviewer", "user@example.com")

    with pytest.raises(ValueError, match="position"):
        MatchedRecipientSource(RecipientSourceKind.STATIC_CONTACT, -1, "contact-1")
    with pytest.raises(TypeError, match="immutable tuples"):
        ResolvedApprover(
            ContactApprovalSubject(ContactId("contact-1")),
            CanonicalSubjectKey.for_contact(ContactId("contact-1")),
            [source],
            snapshot,
            (endpoint,),
        )
    with pytest.raises(ValueError, match="does not match"):
        ResolvedApprover(
            ContactApprovalSubject(ContactId("contact-1")),
            CanonicalSubjectKey.for_contact(ContactId("contact-2")),
            (source,),
            snapshot,
            (endpoint,),
        )


def test_plan_invariants_require_deeply_immutable_consistent_values() -> None:
    source = MatchedRecipientSource(RecipientSourceKind.STATIC_CONTACT, 0, "contact-1")
    approver = ResolvedApprover(
        ContactApprovalSubject(ContactId("contact-1")),
        CanonicalSubjectKey.for_contact(ContactId("contact-1")),
        (source,),
        SubjectSnapshot("Reviewer", "user@example.com"),
        (EmailEndpointPlan(NormalizedEmail("user@example.com")),),
    )

    with pytest.raises(TypeError, match="immutable tuples"):
        ResolvedApprovalPlan([approver], (), None)
    with pytest.raises(ValueError, match="cannot have a failure"):
        ResolvedApprovalPlan((approver,), (), RecipientResolutionFailureReason.NO_VALID_RECIPIENTS)
    with pytest.raises(ValueError, match="must have a failure"):
        ResolvedApprovalPlan((), (), None)


def test_interaction_endpoints_and_unbound_im_endpoint_have_stable_primitive_shapes() -> None:
    endpoint = IMEndpointPlan(
        integration_id=IntegrationId("integration-1"),
        provider=IMProvider.FEISHU,
        provider_tenant_id="provider-tenant-1",
        identity_id=IMIdentityId("identity-1"),
        binding_id=None,
        provider_user_id="provider-user-1",
    )

    assert endpoint.to_primitive()["binding_id"] is None
    assert WebEndpointPlan().to_primitive() == {"channel": "web"}
    assert ConsoleEndpointPlan().to_primitive() == {"channel": "console"}
