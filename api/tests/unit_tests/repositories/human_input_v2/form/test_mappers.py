"""Explicit mapper tests for the Human Input v2 form persistence boundary."""

from datetime import datetime, timedelta

import pytest

from core.human_input import ButtonStyle
from core.human_input_v2 import (
    FileInput,
    FileListInput,
    MarkdownText,
    ParagraphInput,
    ResolvedForm,
    ResolvedFormAction,
    SelectInput,
)
from core.human_input_v2.approval import (
    ApprovalSubject,
    ApproverGrant,
    CanonicalSubjectKey,
    ConsoleEndpointPlan,
    ContactApprovalSubject,
    DeliveryAttempt,
    DeliveryEndpoint,
    EmailAddressApprovalSubject,
    EmailEndpointPlan,
    EmailProviderConfiguration,
    EndpointAccessCapability,
    EndUserApprovalSubject,
    FormRef,
    HumanInputForm,
    IMEndpointPlan,
    MatchedRecipientSource,
    RecipientSourceKind,
    ResolvedApprover,
    SubjectSnapshot,
    UploadCapability,
    UploadFileAssociation,
    WebEndpointPlan,
)
from core.human_input_v2.entities import (
    EmailProviderType,
    HumanInputApproverGrantSubjectType,
    HumanInputDeliveryAttemptStatus,
    HumanInputDeliveryChannel,
    HumanInputV2FormKind,
    HumanInputV2FormStatus,
    IMProvider,
)
from core.human_input_v2.shared import (
    AccountId,
    AppId,
    ApproverGrantId,
    ContactId,
    DeliveryAttemptId,
    DeliveryEndpointId,
    EmailProviderId,
    EndUserId,
    FormId,
    IMBindingId,
    IMIdentityId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
    UploadCapabilityId,
    UploadFileAssociationId,
)
from graphon.file.enums import FileTransferMethod, FileType
from models.human_input_v2 import HumanInputV2FormApproverGrant, HumanInputV2FormDeliveryEndpoint
from repositories.human_input_v2.form.mappers import (
    delivery_attempt_from_record,
    delivery_attempt_to_record,
    email_provider_from_record,
    email_provider_to_record,
    endpoint_from_record,
    endpoint_to_record,
    form_from_record,
    form_to_record,
    grant_from_record,
    grant_to_record,
    upload_capability_from_record,
    upload_capability_to_record,
    upload_file_from_record,
    upload_file_to_record,
)

_NOW = datetime(2026, 7, 25, 8)
_FORM_REF = FormRef(TenantId("workspace-1"), FormId("form-1"))


def _resolved_form() -> ResolvedForm:
    return ResolvedForm(
        title="Review",
        blocks=(
            MarkdownText("Review "),
            ParagraphInput("reason", "default"),
            SelectInput("decision", ("approve", "reject"), "approve"),
            FileInput(
                "attachment",
                (FileType.DOCUMENT, FileType.CUSTOM),
                ("pdf", "md"),
                (FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL),
            ),
            FileListInput(
                "evidence",
                (FileType.IMAGE,),
                (),
                (FileTransferMethod.LOCAL_FILE,),
                3,
            ),
        ),
        user_actions=(ResolvedFormAction("approve", "Approve", ButtonStyle.PRIMARY),),
        legacy_form_content="Review {{#$output.reason#}}",
    )


def _grant() -> ApproverGrant:
    email = NormalizedEmail("reviewer@example.com")
    approver = ResolvedApprover(
        subject=EmailAddressApprovalSubject(email),
        subject_key=CanonicalSubjectKey.for_email(email),
        matched_sources=(
            MatchedRecipientSource(RecipientSourceKind.DYNAMIC_EMAIL, 1, "node.email"),
            MatchedRecipientSource(RecipientSourceKind.ONE_TIME_EMAIL, 2, "reviewer@example.com"),
        ),
        subject_snapshot=SubjectSnapshot("Reviewer", "reviewer@example.com"),
        endpoints=(EmailEndpointPlan(email),),
    )
    return ApproverGrant.from_resolved_approver(
        grant_id=ApproverGrantId("grant-1"), form_ref=_FORM_REF, approver=approver, now=_NOW
    )


def _grant_for_subject(subject: ApprovalSubject, subject_key: CanonicalSubjectKey) -> ApproverGrant:
    return ApproverGrant(
        ref=_FORM_REF.grant(ApproverGrantId("grant-1")),
        subject=subject,
        subject_key=subject_key,
        matched_sources=(MatchedRecipientSource(RecipientSourceKind.STATIC_CONTACT, 0, "recipient-1"),),
        subject_snapshot=SubjectSnapshot("Reviewer", "reviewer@example.com"),
        created_at=_NOW,
        updated_at=_NOW,
    )


def _endpoint() -> DeliveryEndpoint:
    grant = _grant()
    endpoint_ref = grant.ref.endpoint(DeliveryEndpointId("endpoint-1"))
    return DeliveryEndpoint.from_plan(
        endpoint_id=endpoint_ref.endpoint_id,
        grant_ref=grant.ref,
        endpoint_plan=EmailEndpointPlan(NormalizedEmail("reviewer@example.com")),
        access_capability=EndpointAccessCapability(endpoint_ref, "a" * 64),
        now=_NOW,
    )


def _im_endpoint(*, binding_id: IMBindingId | None) -> DeliveryEndpoint:
    return DeliveryEndpoint.from_plan(
        endpoint_id=DeliveryEndpointId("endpoint-im"),
        grant_ref=_grant().ref,
        endpoint_plan=IMEndpointPlan(
            integration_id=IntegrationId("integration-1"),
            provider=IMProvider.FEISHU,
            provider_tenant_id="provider-tenant-1",
            identity_id=IMIdentityId("identity-1"),
            binding_id=binding_id,
            provider_user_id="provider-user-1",
        ),
        access_capability=None,
        now=_NOW,
    )


def _form() -> HumanInputForm:
    return HumanInputForm(
        ref=_FORM_REF,
        app_id=AppId("app-1"),
        resolved_form=_resolved_form(),
        display_in_ui=True,
        node_timeout_at=_NOW + timedelta(hours=1),
        global_expires_at=_NOW + timedelta(hours=2),
        kind=HumanInputV2FormKind.RUNTIME,
        status=HumanInputV2FormStatus.WAITING,
        workflow_pause_id="pause-1",
        node_execution_id="node-execution-1",
        grants=(_grant(),),
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_form_grant_and_endpoint_round_trip() -> None:
    form = _form()
    grant = form.grants[0]
    endpoint = _endpoint()

    form_record = form_to_record(form)
    grant_record = grant_to_record(grant)
    endpoint_record = endpoint_to_record(endpoint)

    restored_grant = grant_from_record(grant_record)
    restored_form = form_from_record(form_record, (grant_record,))
    restored_endpoint = endpoint_from_record(endpoint_record)
    assert restored_form == form
    assert restored_grant == grant
    assert restored_endpoint == endpoint
    assert restored_form.resolved_form == _resolved_form()
    assert restored_form.resolved_form.blocks[3].allowed_file_types == (FileType.DOCUMENT, FileType.CUSTOM)
    assert restored_form.resolved_form.blocks[3].allowed_file_upload_methods == (
        FileTransferMethod.LOCAL_FILE,
        FileTransferMethod.REMOTE_URL,
    )
    assert form_record.form_definition.user_actions[0].button_style is ButtonStyle.PRIMARY
    assert form_record.rendered_content == _resolved_form().legacy_form_content
    assert [block.type for block in form_record.form_definition.blocks] == [
        "markdown",
        "paragraph",
        "select",
        "file",
        "file-list",
    ]
    assert restored_grant.matched_sources == grant.matched_sources


def test_delivery_attempt_provider_and_upload_values_round_trip() -> None:
    endpoint = _endpoint()
    attempt = DeliveryAttempt(
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
        provider_response={"status": 400, "body": {"retry": False}},
        created_at=_NOW,
        updated_at=_NOW,
    )
    provider = EmailProviderConfiguration(
        id=EmailProviderId("provider-1"),
        tenant_id=TenantId("workspace-1"),
        provider=EmailProviderType.RESEND,
        sender_email=NormalizedEmail("Sender@Example.com"),
        sender_name="Dify",
        encrypted_credentials={"provider": "resend", "encrypted_api_key": "ciphertext"},
        configured_by_account_id=AccountId("account-1"),
        created_at=_NOW,
        updated_at=_NOW,
    )
    capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-1"),
        endpoint_ref=endpoint.ref,
        app_id=AppId("app-1"),
        token_hash="b" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    upload = UploadFileAssociation(
        id=UploadFileAssociationId("upload-association-1"),
        capability_ref=capability.ref,
        upload_file_id="file-1",
        created_at=_NOW,
        updated_at=_NOW,
    )

    endpoint_record = endpoint_to_record(endpoint)
    assert delivery_attempt_from_record(delivery_attempt_to_record(attempt), endpoint_record) == attempt
    assert email_provider_from_record(email_provider_to_record(provider)) == provider
    capability_record = upload_capability_to_record(capability)
    assert upload_capability_from_record(capability_record, endpoint_record) == capability
    assert upload_file_from_record(upload_file_to_record(upload), capability_record, endpoint_record) == upload


@pytest.mark.parametrize(
    "credentials",
    [
        {"provider": "wrong", "encrypted_api_key": "ciphertext"},
        {"provider": "resend"},
        {"provider": "resend", "encrypted_api_key": "ciphertext", "unexpected": "value"},
    ],
)
def test_email_provider_mapper_strictly_validates_credentials(credentials: dict[str, str]) -> None:
    provider = EmailProviderConfiguration(
        id=EmailProviderId("provider-1"),
        tenant_id=TenantId("workspace-1"),
        provider=EmailProviderType.RESEND,
        sender_email=NormalizedEmail("sender@example.com"),
        sender_name="Dify",
        encrypted_credentials=dict(credentials),
        configured_by_account_id=None,
        created_at=_NOW,
        updated_at=_NOW,
    )

    with pytest.raises(ValueError):
        email_provider_to_record(provider)


def test_mappers_reject_malformed_subject_and_endpoint_records() -> None:
    grant_record = HumanInputV2FormApproverGrant(
        tenant_id="workspace-1",
        form_id="form-1",
        subject_type=HumanInputApproverGrantSubjectType.CONTACT,
        subject_key="contact:contact-1",
    )
    grant_record.id = "grant-1"
    grant_record.created_at = _NOW
    grant_record.updated_at = _NOW
    endpoint_record = HumanInputV2FormDeliveryEndpoint(
        tenant_id="workspace-1",
        form_id="form-1",
        approver_grant_id="grant-1",
        channel=HumanInputDeliveryChannel.EMAIL,
        address_hash="a" * 64,
    )
    endpoint_record.id = "endpoint-1"
    endpoint_record.created_at = _NOW
    endpoint_record.updated_at = _NOW

    with pytest.raises(ValueError, match="contact_id"):
        grant_from_record(grant_record)
    with pytest.raises(ValueError, match="email_address"):
        endpoint_from_record(endpoint_record)


@pytest.mark.parametrize(
    ("subject", "subject_key", "subject_type", "identity_field", "identity_value"),
    [
        (
            ContactApprovalSubject(ContactId("contact-1")),
            CanonicalSubjectKey.for_contact(ContactId("contact-1")),
            HumanInputApproverGrantSubjectType.CONTACT,
            "contact_id",
            "contact-1",
        ),
        (
            EndUserApprovalSubject(EndUserId("end-user-1")),
            CanonicalSubjectKey.for_end_user(EndUserId("end-user-1")),
            HumanInputApproverGrantSubjectType.END_USER,
            "end_user_id",
            "end-user-1",
        ),
        (
            EmailAddressApprovalSubject(NormalizedEmail("reviewer@example.com")),
            CanonicalSubjectKey.for_email(NormalizedEmail("reviewer@example.com")),
            HumanInputApproverGrantSubjectType.EMAIL_ADDRESS,
            "normalized_email",
            "reviewer@example.com",
        ),
    ],
)
def test_grant_mappers_support_each_subject_variant(
    subject: ApprovalSubject,
    subject_key: CanonicalSubjectKey,
    subject_type: HumanInputApproverGrantSubjectType,
    identity_field: str,
    identity_value: str,
) -> None:
    grant = _grant_for_subject(subject, subject_key)

    record = grant_to_record(grant)

    assert record.subject_type is subject_type
    assert getattr(record, identity_field) == identity_value
    assert grant_from_record(record) == grant


@pytest.mark.parametrize(
    ("subject", "subject_key", "identity_field", "message"),
    [
        (
            ContactApprovalSubject(ContactId("contact-1")),
            CanonicalSubjectKey.for_contact(ContactId("contact-1")),
            "contact_id",
            "contact_id",
        ),
        (
            EndUserApprovalSubject(EndUserId("end-user-1")),
            CanonicalSubjectKey.for_end_user(EndUserId("end-user-1")),
            "end_user_id",
            "end_user_id",
        ),
        (
            EmailAddressApprovalSubject(NormalizedEmail("reviewer@example.com")),
            CanonicalSubjectKey.for_email(NormalizedEmail("reviewer@example.com")),
            "normalized_email",
            "normalized_email",
        ),
    ],
)
def test_grant_mapper_rejects_each_missing_subject_identity(
    subject: ApprovalSubject,
    subject_key: CanonicalSubjectKey,
    identity_field: str,
    message: str,
) -> None:
    record = grant_to_record(_grant_for_subject(subject, subject_key))
    setattr(record, identity_field, None)

    with pytest.raises(ValueError, match=message):
        grant_from_record(record)


def test_form_mapper_rejects_a_grant_from_another_owner() -> None:
    form_record = form_to_record(_form())
    grant_record = grant_to_record(_grant())
    grant_record.tenant_id = "workspace-2"

    with pytest.raises(ValueError, match="does not belong"):
        form_from_record(form_record, (grant_record,))


def test_endpoint_mappers_support_im_web_console_and_optional_binding() -> None:
    endpoints = (
        _im_endpoint(binding_id=IMBindingId("binding-1")),
        _im_endpoint(binding_id=None),
        DeliveryEndpoint.from_plan(
            endpoint_id=DeliveryEndpointId("endpoint-web"),
            grant_ref=_grant().ref,
            endpoint_plan=WebEndpointPlan(),
            access_capability=None,
            now=_NOW,
        ),
        DeliveryEndpoint.from_plan(
            endpoint_id=DeliveryEndpointId("endpoint-console"),
            grant_ref=_grant().ref,
            endpoint_plan=ConsoleEndpointPlan(),
            access_capability=None,
            now=_NOW,
        ),
    )

    assert tuple(endpoint_from_record(endpoint_to_record(endpoint)) for endpoint in endpoints) == endpoints


@pytest.mark.parametrize(
    "missing_field",
    ["integration_id", "provider", "provider_tenant_id", "im_identity_id", "provider_user_id"],
)
def test_endpoint_mapper_rejects_each_missing_im_provider_value(missing_field: str) -> None:
    record = endpoint_to_record(_im_endpoint(binding_id=IMBindingId("binding-1")))
    setattr(record, missing_field, None)

    with pytest.raises(ValueError, match="provider configuration"):
        endpoint_from_record(record)


@pytest.mark.parametrize(
    ("channel", "contaminated_field", "contaminated_value"),
    [
        (HumanInputDeliveryChannel.EMAIL, "integration_id", "integration-1"),
        (HumanInputDeliveryChannel.EMAIL, "provider", IMProvider.FEISHU),
        (HumanInputDeliveryChannel.EMAIL, "provider_tenant_id", "provider-tenant-1"),
        (HumanInputDeliveryChannel.EMAIL, "provider_user_id", "provider-user-1"),
        (HumanInputDeliveryChannel.EMAIL, "im_identity_id", "identity-1"),
        (HumanInputDeliveryChannel.EMAIL, "im_binding_id", "binding-1"),
        (HumanInputDeliveryChannel.IM, "email_address", "reviewer@example.com"),
        (HumanInputDeliveryChannel.WEB, "email_address", "reviewer@example.com"),
        (HumanInputDeliveryChannel.WEB, "integration_id", "integration-1"),
        (HumanInputDeliveryChannel.WEB, "provider", IMProvider.FEISHU),
        (HumanInputDeliveryChannel.WEB, "provider_tenant_id", "provider-tenant-1"),
        (HumanInputDeliveryChannel.WEB, "provider_user_id", "provider-user-1"),
        (HumanInputDeliveryChannel.WEB, "im_identity_id", "identity-1"),
        (HumanInputDeliveryChannel.WEB, "im_binding_id", "binding-1"),
        (HumanInputDeliveryChannel.CONSOLE, "email_address", "reviewer@example.com"),
        (HumanInputDeliveryChannel.CONSOLE, "integration_id", "integration-1"),
        (HumanInputDeliveryChannel.CONSOLE, "provider", IMProvider.FEISHU),
        (HumanInputDeliveryChannel.CONSOLE, "provider_tenant_id", "provider-tenant-1"),
        (HumanInputDeliveryChannel.CONSOLE, "provider_user_id", "provider-user-1"),
        (HumanInputDeliveryChannel.CONSOLE, "im_identity_id", "identity-1"),
        (HumanInputDeliveryChannel.CONSOLE, "im_binding_id", "binding-1"),
    ],
)
def test_endpoint_mapper_rejects_cross_channel_field_contamination(
    channel: HumanInputDeliveryChannel,
    contaminated_field: str,
    contaminated_value: str | IMProvider,
) -> None:
    endpoint_by_channel = {
        HumanInputDeliveryChannel.EMAIL: _endpoint(),
        HumanInputDeliveryChannel.IM: _im_endpoint(binding_id=IMBindingId("binding-1")),
        HumanInputDeliveryChannel.WEB: DeliveryEndpoint.from_plan(
            endpoint_id=DeliveryEndpointId("endpoint-web"),
            grant_ref=_grant().ref,
            endpoint_plan=WebEndpointPlan(),
            access_capability=None,
            now=_NOW,
        ),
        HumanInputDeliveryChannel.CONSOLE: DeliveryEndpoint.from_plan(
            endpoint_id=DeliveryEndpointId("endpoint-console"),
            grant_ref=_grant().ref,
            endpoint_plan=ConsoleEndpointPlan(),
            access_capability=None,
            now=_NOW,
        ),
    }
    record = endpoint_to_record(endpoint_by_channel[channel])
    setattr(record, contaminated_field, contaminated_value)

    with pytest.raises(ValueError, match="channel configuration"):
        endpoint_from_record(record)


def test_endpoint_mapper_rejects_unsupported_channel_explicitly() -> None:
    record = endpoint_to_record(_endpoint())
    channel_field = "channel"
    setattr(record, channel_field, "sms")

    with pytest.raises(ValueError, match="unsupported delivery channel"):
        endpoint_from_record(record)


def test_optional_mapper_values_round_trip_when_absent() -> None:
    endpoint = _endpoint()
    queued_attempt = DeliveryAttempt(
        id=DeliveryAttemptId("attempt-queued"),
        endpoint_ref=endpoint.ref,
        attempt_number=1,
        status=HumanInputDeliveryAttemptStatus.QUEUED,
        scheduled_at=_NOW,
        started_at=None,
        finished_at=None,
        provider_message_id=None,
        failure_code=None,
        failure_reason=None,
        provider_response=None,
        created_at=_NOW,
        updated_at=_NOW,
    )
    provider = EmailProviderConfiguration(
        id=EmailProviderId("provider-1"),
        tenant_id=TenantId("workspace-1"),
        provider=EmailProviderType.RESEND,
        sender_email=NormalizedEmail("sender@example.com"),
        sender_name="Dify",
        encrypted_credentials={"provider": "resend", "encrypted_api_key": "ciphertext"},
        configured_by_account_id=None,
        created_at=_NOW,
        updated_at=_NOW,
    )
    endpoint_record = endpoint_to_record(endpoint)

    assert delivery_attempt_from_record(delivery_attempt_to_record(queued_attempt), endpoint_record) == queued_attempt
    assert email_provider_from_record(email_provider_to_record(provider)) == provider


@pytest.mark.parametrize(
    ("owner_field", "wrong_value"),
    [("tenant_id", "workspace-2"), ("form_id", "form-2"), ("endpoint_id", "endpoint-2")],
)
def test_delivery_attempt_mapper_rejects_each_owner_mismatch(owner_field: str, wrong_value: str) -> None:
    endpoint = _endpoint()
    attempt = DeliveryAttempt(
        id=DeliveryAttemptId("attempt-1"),
        endpoint_ref=endpoint.ref,
        attempt_number=1,
        status=HumanInputDeliveryAttemptStatus.QUEUED,
        scheduled_at=_NOW,
        started_at=None,
        finished_at=None,
        provider_message_id=None,
        failure_code=None,
        failure_reason=None,
        provider_response=None,
        created_at=_NOW,
        updated_at=_NOW,
    )
    record = delivery_attempt_to_record(attempt)
    setattr(record, owner_field, wrong_value)

    with pytest.raises(ValueError, match="owner"):
        delivery_attempt_from_record(record, endpoint_to_record(endpoint))


@pytest.mark.parametrize(
    ("owner_field", "wrong_value"),
    [("tenant_id", "workspace-2"), ("form_id", "form-2"), ("endpoint_id", "endpoint-2")],
)
def test_upload_capability_mapper_rejects_each_owner_mismatch(owner_field: str, wrong_value: str) -> None:
    endpoint = _endpoint()
    capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-1"),
        endpoint_ref=endpoint.ref,
        app_id=AppId("app-1"),
        token_hash="b" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    record = upload_capability_to_record(capability)
    setattr(record, owner_field, wrong_value)

    with pytest.raises(ValueError, match="owner"):
        upload_capability_from_record(record, endpoint_to_record(endpoint))


@pytest.mark.parametrize(
    ("owner_field", "wrong_value"),
    [
        ("upload_token_id", "upload-capability-2"),
        ("tenant_id", "workspace-2"),
        ("form_id", "form-2"),
        ("endpoint_id", "endpoint-2"),
        ("app_id", "app-2"),
    ],
)
def test_upload_file_mapper_rejects_each_owner_mismatch(owner_field: str, wrong_value: str) -> None:
    endpoint = _endpoint()
    capability = UploadCapability(
        id=UploadCapabilityId("upload-capability-1"),
        endpoint_ref=endpoint.ref,
        app_id=AppId("app-1"),
        token_hash="b" * 64,
        created_at=_NOW,
        updated_at=_NOW,
    )
    association = UploadFileAssociation(
        id=UploadFileAssociationId("upload-association-1"),
        capability_ref=capability.ref,
        upload_file_id="file-1",
        created_at=_NOW,
        updated_at=_NOW,
    )
    capability_record = upload_capability_to_record(capability)
    record = upload_file_to_record(association)
    setattr(record, owner_field, wrong_value)

    with pytest.raises(ValueError, match="owner"):
        upload_file_from_record(record, capability_record, endpoint_to_record(endpoint))
