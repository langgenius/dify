"""Behavior tests for the single-entry recipient resolver."""

from datetime import datetime

import pytest

from core.human_input_v2.approval import (
    CanonicalSubjectKey,
    ConsoleEndpointPlan,
    ContactApprovalSubject,
    ContactInitiatorSnapshot,
    ContactRecipientSpecification,
    CurrentInitiatorRecipientSpecification,
    DebugRecipientReplacement,
    DeliveryCapabilitySnapshot,
    DynamicEmailRecipientSpecification,
    DynamicRecipientValue,
    EmailAddressApprovalSubject,
    EmailEndpointPlan,
    EndUserApprovalSubject,
    EndUserInitiatorSnapshot,
    IMEndpointPlan,
    OneTimeEmailRecipientSpecification,
    RecipientRejectionReason,
    RecipientResolutionFailureReason,
    RecipientResolver,
    RecipientSourceKind,
    UnsupportedDynamicRecipientValue,
    WebEndpointPlan,
)
from core.human_input_v2.contact_directory import Contact, ContactDirectorySnapshot
from core.human_input_v2.entities import HumanInputDeliveryChannel, IMProvider
from core.human_input_v2.im_integration import EffectiveIMBindingSnapshot
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    EndUserId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
)

_NOW = datetime(2026, 7, 25, 8)
_TENANT_ID = TenantId("workspace-1")


def _workspace_contact(
    contact_id: str = "contact-1",
    account_id: str = "account-1",
    email: str | None = "reviewer@example.com",
    tenant_id: TenantId = _TENANT_ID,
) -> Contact:
    return Contact.workspace_member(
        contact_id=ContactId(contact_id),
        tenant_id=tenant_id,
        account_id=AccountId(account_id),
        name=f"Reviewer {contact_id}",
        email=email,
        now=_NOW,
    )


def _organization_contact(
    contact_id: str = "contact-1",
    account_id: str = "account-1",
    email: str | None = "reviewer@example.com",
) -> Contact:
    return Contact.organization_account(
        contact_id=ContactId(contact_id),
        account_id=AccountId(account_id),
        name=f"Reviewer {contact_id}",
        email=email,
        now=_NOW,
    )


def _directory(*contacts: Contact) -> ContactDirectorySnapshot:
    selected_contacts = contacts or (_workspace_contact(),)
    return ContactDirectorySnapshot(
        tenant_id=_TENANT_ID,
        contacts=selected_contacts,
        member_account_ids=frozenset(
            contact.account_id for contact in selected_contacts if contact.account_id is not None
        ),
    )


def _im_binding(
    *,
    contact_id: str = "contact-1",
    integration_id: str = "integration-1",
    identity_id: str = "identity-1",
    binding_id: str | None = "binding-1",
    provider: IMProvider = IMProvider.FEISHU,
) -> EffectiveIMBindingSnapshot:
    return EffectiveIMBindingSnapshot(
        integration_id=IntegrationId(integration_id),
        integration_config_version=1,
        provider=provider,
        provider_tenant_id="provider-tenant-1",
        contact_id=ContactId(contact_id),
        account_id=AccountId("account-1"),
        identity_id=IMIdentityId(identity_id),
        binding_id=IMBindingId(binding_id) if binding_id is not None else None,
        provider_user_id=f"provider-{identity_id}",
        display_name="Reviewer",
        email="reviewer@example.com",
    )


def test_static_contact_dynamic_email_and_initiator_collapse_to_one_contact() -> None:
    specifications = (
        ContactRecipientSpecification("contact-1"),
        DynamicEmailRecipientSpecification(("node-1", "email")),
        CurrentInitiatorRecipientSpecification(),
    )

    plan = RecipientResolver.resolve(
        specifications=specifications,
        directory=_directory(),
        dynamic_values=(DynamicRecipientValue(("node-1", "email"), " REVIEWER@example.com "),),
        initiator=ContactInitiatorSnapshot(ContactId("contact-1")),
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert len(plan.approvers) == 1
    approver = plan.approvers[0]
    assert approver.subject == ContactApprovalSubject(ContactId("contact-1"))
    assert [source.kind for source in approver.matched_sources] == [
        RecipientSourceKind.STATIC_CONTACT,
        RecipientSourceKind.DYNAMIC_EMAIL,
        RecipientSourceKind.CURRENT_INITIATOR,
    ]
    assert approver.endpoints == (EmailEndpointPlan(NormalizedEmail("reviewer@example.com")),)
    assert plan.rejected_recipients == ()


def test_unmatched_email_is_upgraded_to_email_subject_and_normalized_duplicates_collapse() -> None:
    specifications = (
        OneTimeEmailRecipientSpecification(" Person@Example.com "),
        DynamicEmailRecipientSpecification(("node-1", "email")),
    )

    plan = RecipientResolver.resolve(
        specifications=specifications,
        directory=_directory(),
        dynamic_values=(DynamicRecipientValue(("node-1", "email"), "person@example.COM"),),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert len(plan.approvers) == 1
    approver = plan.approvers[0]
    assert approver.subject == EmailAddressApprovalSubject(NormalizedEmail("person@example.com"))
    assert approver.subject_key == CanonicalSubjectKey.for_email(NormalizedEmail("person@example.com"))
    assert [source.kind for source in approver.matched_sources] == [
        RecipientSourceKind.ONE_TIME_EMAIL,
        RecipientSourceKind.DYNAMIC_EMAIL,
    ]
    assert approver.endpoints == (EmailEndpointPlan(NormalizedEmail("person@example.com")),)


def test_email_matching_contact_with_unavailable_account_does_not_bypass_contact_governance() -> None:
    contact = _workspace_contact()
    directory = ContactDirectorySnapshot(
        tenant_id=_TENANT_ID,
        contacts=(contact,),
        member_account_ids=frozenset({AccountId("account-1")}),
        unavailable_account_ids=frozenset({AccountId("account-1")}),
    )

    plan = RecipientResolver.resolve(
        specifications=(OneTimeEmailRecipientSpecification("reviewer@example.com"),),
        directory=directory,
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert plan.approvers == ()
    assert [(rejection.reason, rejection.rejected_value) for rejection in plan.rejected_recipients] == [
        (RecipientRejectionReason.CONTACT_UNAVAILABLE, "reviewer@example.com")
    ]
    assert plan.failure_reason is RecipientResolutionFailureReason.NO_VALID_RECIPIENTS


def test_email_matching_organization_contact_outside_workspace_visibility_does_not_fallback() -> None:
    contact = _organization_contact()
    directory = ContactDirectorySnapshot(tenant_id=_TENANT_ID, contacts=(contact,))

    plan = RecipientResolver.resolve(
        specifications=(OneTimeEmailRecipientSpecification("reviewer@example.com"),),
        directory=directory,
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert plan.approvers == ()
    assert [(rejection.reason, rejection.rejected_value) for rejection in plan.rejected_recipients] == [
        (RecipientRejectionReason.CONTACT_UNAVAILABLE, "reviewer@example.com")
    ]
    assert plan.failure_reason is RecipientResolutionFailureReason.NO_VALID_RECIPIENTS


def test_email_matching_cross_workspace_contact_does_not_fallback() -> None:
    contact = _workspace_contact(tenant_id=TenantId("workspace-2"))
    directory = ContactDirectorySnapshot(
        tenant_id=_TENANT_ID,
        contacts=(contact,),
        member_account_ids=frozenset({AccountId("account-1")}),
    )

    plan = RecipientResolver.resolve(
        specifications=(OneTimeEmailRecipientSpecification("reviewer@example.com"),),
        directory=directory,
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert plan.approvers == ()
    assert [(rejection.reason, rejection.rejected_value) for rejection in plan.rejected_recipients] == [
        (RecipientRejectionReason.CONTACT_UNAVAILABLE, "reviewer@example.com")
    ]
    assert plan.failure_reason is RecipientResolutionFailureReason.NO_VALID_RECIPIENTS


def test_invalid_and_unsupported_recipients_are_retained_without_dropping_valid_approvers() -> None:
    specifications = (
        OneTimeEmailRecipientSpecification("not-an-email"),
        DynamicEmailRecipientSpecification(("node-1", "email")),
        OneTimeEmailRecipientSpecification("valid@example.com"),
    )

    plan = RecipientResolver.resolve(
        specifications=specifications,
        directory=_directory(),
        dynamic_values=(
            DynamicRecipientValue(
                ("node-1", "email"),
                UnsupportedDynamicRecipientValue("list"),
            ),
        ),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert [approver.subject for approver in plan.approvers] == [
        EmailAddressApprovalSubject(NormalizedEmail("valid@example.com"))
    ]
    assert [(rejection.reason, rejection.rejected_value) for rejection in plan.rejected_recipients] == [
        (RecipientRejectionReason.INVALID_EMAIL, "not-an-email"),
        (RecipientRejectionReason.UNSUPPORTED_DYNAMIC_TYPE, "list"),
    ]
    assert plan.failure_reason is None


@pytest.mark.parametrize(
    ("specification", "dynamic_values", "reason", "value"),
    [
        (ContactRecipientSpecification(" "), (), RecipientRejectionReason.INVALID_CONTACT_ID, " "),
        (
            DynamicEmailRecipientSpecification(()),
            (),
            RecipientRejectionReason.INVALID_DYNAMIC_SELECTOR,
            "",
        ),
        (
            DynamicEmailRecipientSpecification(("node-1", "email")),
            (),
            RecipientRejectionReason.DYNAMIC_VALUE_UNAVAILABLE,
            "node-1.email",
        ),
        (
            DynamicEmailRecipientSpecification(("node-1", "email")),
            (DynamicRecipientValue(("node-1", "email"), "invalid"),),
            RecipientRejectionReason.INVALID_EMAIL,
            "invalid",
        ),
    ],
)
def test_invalid_input_paths_return_stable_no_valid_recipients(
    specification,
    dynamic_values: tuple[DynamicRecipientValue, ...],
    reason: RecipientRejectionReason,
    value: str,
) -> None:
    first = RecipientResolver.resolve(
        specifications=(specification,),
        directory=_directory(),
        dynamic_values=dynamic_values,
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )
    second = RecipientResolver.resolve(
        specifications=(specification,),
        directory=_directory(),
        dynamic_values=dynamic_values,
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert first == second
    assert first.approvers == ()
    assert [(rejection.reason, rejection.rejected_value) for rejection in first.rejected_recipients] == [
        (reason, value)
    ]
    assert first.failure_reason is RecipientResolutionFailureReason.NO_VALID_RECIPIENTS


def test_unavailable_contact_and_initiator_do_not_block_other_recipients() -> None:
    plan = RecipientResolver.resolve(
        specifications=(
            ContactRecipientSpecification("missing-contact"),
            CurrentInitiatorRecipientSpecification(),
            OneTimeEmailRecipientSpecification("valid@example.com"),
        ),
        directory=_directory(),
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert len(plan.approvers) == 1
    assert [rejection.reason for rejection in plan.rejected_recipients] == [
        RecipientRejectionReason.CONTACT_UNAVAILABLE,
        RecipientRejectionReason.INITIATOR_UNAVAILABLE,
    ]


def test_email_and_all_effective_im_bindings_create_parallel_deterministic_endpoints() -> None:
    capabilities = DeliveryCapabilitySnapshot(
        im_bindings=(
            _im_binding(
                integration_id="integration-2",
                identity_id="identity-2",
                provider=IMProvider.SLACK,
            ),
            _im_binding(),
        ),
        contact_console_ids=frozenset({ContactId("contact-1")}),
    )

    plan = RecipientResolver.resolve(
        specifications=(ContactRecipientSpecification("contact-1"),),
        directory=_directory(),
        dynamic_values=(),
        initiator=None,
        capabilities=capabilities,
    )

    assert [endpoint.channel for endpoint in plan.approvers[0].endpoints] == [
        HumanInputDeliveryChannel.EMAIL,
        HumanInputDeliveryChannel.IM,
        HumanInputDeliveryChannel.IM,
        HumanInputDeliveryChannel.CONSOLE,
    ]
    assert plan.approvers[0].endpoints == (
        EmailEndpointPlan(NormalizedEmail("reviewer@example.com")),
        IMEndpointPlan(
            integration_id=IntegrationId("integration-1"),
            provider=IMProvider.FEISHU,
            provider_tenant_id="provider-tenant-1",
            identity_id=IMIdentityId("identity-1"),
            binding_id=IMBindingId("binding-1"),
            provider_user_id="provider-identity-1",
        ),
        IMEndpointPlan(
            integration_id=IntegrationId("integration-2"),
            provider=IMProvider.SLACK,
            provider_tenant_id="provider-tenant-1",
            identity_id=IMIdentityId("identity-2"),
            binding_id=IMBindingId("binding-1"),
            provider_user_id="provider-identity-2",
        ),
        ConsoleEndpointPlan(),
    )


def test_email_only_and_explicit_web_capability_are_planned_separately() -> None:
    email_only = RecipientResolver.resolve(
        specifications=(OneTimeEmailRecipientSpecification("person@example.com"),),
        directory=_directory(),
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )
    email_and_web = RecipientResolver.resolve(
        specifications=(OneTimeEmailRecipientSpecification("person@example.com"),),
        directory=_directory(),
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(email_address_web_available=True),
    )

    assert email_only.approvers[0].endpoints == (EmailEndpointPlan(NormalizedEmail("person@example.com")),)
    assert email_and_web.approvers[0].endpoints == (
        EmailEndpointPlan(NormalizedEmail("person@example.com")),
        WebEndpointPlan(),
    )


def test_subject_without_any_usable_endpoint_is_rejected() -> None:
    contact = _workspace_contact(email=None)

    plan = RecipientResolver.resolve(
        specifications=(ContactRecipientSpecification("contact-1"),),
        directory=_directory(contact),
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
    )

    assert plan.approvers == ()
    assert [rejection.reason for rejection in plan.rejected_recipients] == [RecipientRejectionReason.NO_USABLE_ENDPOINT]
    assert plan.failure_reason is RecipientResolutionFailureReason.NO_VALID_RECIPIENTS


def test_debug_replacement_is_request_scoped_and_does_not_mutate_saved_specifications() -> None:
    saved_specifications = (OneTimeEmailRecipientSpecification("configured@example.com"),)

    plan = RecipientResolver.resolve(
        specifications=saved_specifications,
        directory=_directory(),
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(),
        debug_replacement=DebugRecipientReplacement(ContactInitiatorSnapshot(ContactId("contact-1"))),
    )

    assert saved_specifications == (OneTimeEmailRecipientSpecification("configured@example.com"),)
    assert [approver.subject for approver in plan.approvers] == [ContactApprovalSubject(ContactId("contact-1"))]
    assert [source.kind for source in plan.approvers[0].matched_sources] == [RecipientSourceKind.DEBUG_REPLACEMENT]


def test_end_user_initiator_remains_a_distinct_subject_with_request_scoped_capabilities() -> None:
    end_user_id = EndUserId("end-user-1")

    plan = RecipientResolver.resolve(
        specifications=(CurrentInitiatorRecipientSpecification(),),
        directory=_directory(),
        dynamic_values=(),
        initiator=EndUserInitiatorSnapshot(
            end_user_id=end_user_id,
            display_name="End User",
            email="ENDUSER@example.com",
        ),
        capabilities=DeliveryCapabilitySnapshot(end_user_web_ids=frozenset({end_user_id})),
    )

    assert plan.approvers[0].subject == EndUserApprovalSubject(end_user_id)
    assert plan.approvers[0].endpoints == (
        EmailEndpointPlan(NormalizedEmail("enduser@example.com")),
        WebEndpointPlan(),
    )


@pytest.mark.parametrize("email", [None, "invalid"])
def test_end_user_initiator_without_usable_email_can_use_an_explicit_web_endpoint(email: str | None) -> None:
    end_user_id = EndUserId("end-user-1")

    plan = RecipientResolver.resolve(
        specifications=(CurrentInitiatorRecipientSpecification(),),
        directory=_directory(),
        dynamic_values=(),
        initiator=EndUserInitiatorSnapshot(end_user_id, "End User", email),
        capabilities=DeliveryCapabilitySnapshot(end_user_web_ids=frozenset({end_user_id})),
    )

    assert plan.approvers[0].endpoints == (WebEndpointPlan(),)


def test_contact_web_capability_and_duplicate_endpoints_are_deterministically_deduplicated() -> None:
    duplicate_binding = _im_binding()

    plan = RecipientResolver.resolve(
        specifications=(
            ContactRecipientSpecification("contact-1"),
            ContactRecipientSpecification("contact-1"),
        ),
        directory=_directory(),
        dynamic_values=(),
        initiator=None,
        capabilities=DeliveryCapabilitySnapshot(
            im_bindings=(duplicate_binding, duplicate_binding),
            contact_web_ids=frozenset({ContactId("contact-1")}),
        ),
    )

    assert [endpoint.channel for endpoint in plan.approvers[0].endpoints] == [
        HumanInputDeliveryChannel.EMAIL,
        HumanInputDeliveryChannel.IM,
        HumanInputDeliveryChannel.WEB,
    ]


def test_resolver_rejects_mutable_top_level_inputs() -> None:
    with pytest.raises(TypeError, match="immutable tuples"):
        RecipientResolver.resolve(
            specifications=[OneTimeEmailRecipientSpecification("user@example.com")],
            directory=_directory(),
            dynamic_values=(),
            initiator=None,
            capabilities=DeliveryCapabilitySnapshot(),
        )


def test_unknown_recipient_specification_fails_closed_instead_of_resolving_current_initiator() -> None:
    with pytest.raises(AssertionError):
        RecipientResolver.resolve(
            specifications=(object(),),
            directory=_directory(),
            dynamic_values=(),
            initiator=ContactInitiatorSnapshot(ContactId("contact-1")),
            capabilities=DeliveryCapabilitySnapshot(),
        )


def test_every_ordered_plan_component_is_equal_across_repeated_resolution() -> None:
    specifications = (
        OneTimeEmailRecipientSpecification("z@example.com"),
        ContactRecipientSpecification("contact-1"),
        OneTimeEmailRecipientSpecification("a@example.com"),
        DynamicEmailRecipientSpecification(("node-1", "bad")),
    )
    dynamic_values = (DynamicRecipientValue(("node-1", "bad"), "invalid"),)
    capabilities = DeliveryCapabilitySnapshot(
        im_bindings=(_im_binding(),),
        contact_console_ids=frozenset({ContactId("contact-1")}),
    )

    first = RecipientResolver.resolve(
        specifications=specifications,
        directory=_directory(),
        dynamic_values=dynamic_values,
        initiator=None,
        capabilities=capabilities,
    )
    second = RecipientResolver.resolve(
        specifications=specifications,
        directory=_directory(),
        dynamic_values=dynamic_values,
        initiator=None,
        capabilities=capabilities,
    )

    assert first == second
    assert [approver.subject_key.value for approver in first.approvers] == [
        CanonicalSubjectKey.for_email(NormalizedEmail("z@example.com")).value,
        "contact:contact-1",
        CanonicalSubjectKey.for_email(NormalizedEmail("a@example.com")).value,
    ]
    assert [rejection.source.position for rejection in first.rejected_recipients] == [3]
