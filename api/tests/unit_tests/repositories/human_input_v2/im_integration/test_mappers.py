"""Bidirectional mapping tests for every IM Control Plane record."""

from datetime import datetime

import pytest

from core.human_input_v2.entities import (
    IMBindingScope,
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
)
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMBinding,
    IMBindingChangeSnapshot,
    IMIdentity,
    IMIdentityChangeSnapshot,
    IMIntegration,
    IMReconciliationChange,
    IMReconciliationOperation,
    IMReconciliationSubjectKind,
    IMSyncRun,
    IntegrationRevisionToken,
    OpaqueProviderPayload,
    ProviderTenantIdentity,
    SyncContactSnapshot,
    SyncIdentitySnapshot,
    SyncResultFact,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMReconciliationChangeId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
)
from models.human_input_v2 import MSTeamsIMIntegrationEncryptedCredentials
from repositories.human_input_v2.im_integration.mappers import (
    binding_from_record,
    binding_to_record,
    identity_from_record,
    identity_to_record,
    integration_from_record,
    integration_to_record,
    reconciliation_change_from_record,
    reconciliation_change_to_record,
    sync_result_from_record,
    sync_result_to_record,
    sync_run_from_record,
    sync_run_to_record,
)

_NOW = datetime(2026, 7, 25, 8)
_INTEGRATION_ID = IntegrationId("integration-1")


def _integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=_INTEGRATION_ID,
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=AccountId("account-1"),
        callback_url="https://example.com/callback",
        now=_NOW,
    )


def _identity() -> IMIdentity:
    return IMIdentity.create(
        identity_id=IMIdentityId("identity-1"),
        integration_id=_INTEGRATION_ID,
        provider=IMProvider.FEISHU,
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        raw_payload={"provider": "value"},
        last_seen_sync_run_id=IMSyncRunId("run-1"),
        last_seen_at=_NOW,
        now=_NOW,
    )


def _binding() -> IMBinding:
    return IMBinding.create(
        binding_id=IMBindingId("binding-1"),
        integration_id=_INTEGRATION_ID,
        scope=IMBindingScope.ORGANIZATION,
        scope_id=str(_INTEGRATION_ID),
        contact_id=ContactId("contact-1"),
        identity_id=IMIdentityId("identity-1"),
        provider=IMProvider.FEISHU,
        bound_by_account_id=AccountId("account-1"),
        now=_NOW,
    )


def _run() -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=IntegrationRevisionToken(_INTEGRATION_ID, 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=AccountId("account-1"),
        now=_NOW,
    )


def _result() -> SyncResultFact:
    return SyncResultFact(
        id=IMSyncResultId("result-1"),
        integration_id=_INTEGRATION_ID,
        sync_run_id=IMSyncRunId("run-1"),
        operation_key="result:removed:1",
        result_type=IMSyncResultType.REMOVED,
        provider_user_id="provider-user-1",
        display_name="Reviewer",
        email="reviewer@example.com",
        normalized_email=NormalizedEmail("reviewer@example.com"),
        contact_id=ContactId("contact-1"),
        identity_id=IMIdentityId("identity-1"),
        binding_id=IMBindingId("binding-1"),
        removal_reason=IMSyncRemovalReason.NOT_PRESENT_IN_DIRECTORY,
        reason_code="removed",
        reason_message="No longer present",
        directory_entry_payload=OpaqueProviderPayload.from_mapping({"provider": "value"}),
        contact_snapshot=SyncContactSnapshot(
            contact_id=ContactId("contact-1"),
            name="Reviewer",
            email="reviewer@example.com",
            avatar_file_id=None,
            created_at=_NOW,
        ),
        identity_snapshot=SyncIdentitySnapshot(
            identity_id=IMIdentityId("identity-1"),
            provider=IMProvider.FEISHU,
            provider_user_id="provider-user-1",
            display_name="Reviewer",
            email="reviewer@example.com",
        ),
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_integration_mapping_round_trips_without_leaking_orm_identity() -> None:
    integration = _integration()

    record = integration_to_record(integration)

    assert record.encrypted_credentials.provider is IMProvider.FEISHU
    assert integration_from_record(record) == integration


def test_dify_owner_provider_namespace_and_native_tenant_id_remain_independent() -> None:
    provider_native_tenant_id = "11111111-1111-1111-1111-111111111111"
    integration = IMIntegration.create(
        integration_id=_INTEGRATION_ID,
        tenant_id=TenantId("dify-tenant-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.MS_TEAMS, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "tenant_id": provider_native_tenant_id,
                "client_id": "22222222-2222-2222-2222-222222222222",
                "encrypted_client_secret": "ciphertext",
            }
        ),
        configured_by_account_id=AccountId("account-1"),
        callback_url="https://example.com/callback",
        now=_NOW,
    )

    record = integration_to_record(integration)

    assert record.tenant_id == "dify-tenant-1"
    assert record.provider_tenant_id == "provider-tenant-1"
    assert isinstance(record.encrypted_credentials, MSTeamsIMIntegrationEncryptedCredentials)
    assert record.encrypted_credentials.tenant_id == provider_native_tenant_id
    assert integration_from_record(record) == integration


def test_integration_mapping_rejects_missing_provider_tenant_identity() -> None:
    record = integration_to_record(_integration())
    record.provider_tenant_id = None

    with pytest.raises(ValueError, match="provider_tenant_id"):
        integration_from_record(record)


def test_identity_mapping_round_trips_structured_raw_payload() -> None:
    identity = _identity()

    record = identity_to_record(identity)

    assert record.raw_payload.root == {"provider": "value"}
    assert identity_from_record(record) == identity


def test_binding_mapping_round_trips_scope_and_owner_facts() -> None:
    binding = _binding()

    assert binding_from_record(binding_to_record(binding)) == binding


def test_sync_run_mapping_round_trips_captured_revision_and_counts() -> None:
    run = _run()

    assert sync_run_from_record(sync_run_to_record(run)) == run


def test_sync_result_mapping_round_trips_all_structured_snapshots() -> None:
    result = _result()

    record = sync_result_to_record(result)

    assert record.directory_entry_payload is not None
    assert record.directory_entry_payload.root == {"provider": "value"}
    assert sync_result_from_record(record) == result


@pytest.mark.parametrize(
    "change",
    [
        IMReconciliationChange(
            id=IMReconciliationChangeId("change-identity"),
            integration_id=_INTEGRATION_ID,
            sync_run_id=IMSyncRunId("run-1"),
            operation_key="identity:update:1",
            subject_kind=IMReconciliationSubjectKind.IDENTITY,
            operation=IMReconciliationOperation.UPDATE,
            reason_code="profile_changed",
            identity_id=IMIdentityId("identity-1"),
            binding_id=None,
            contact_id=None,
            before=IMIdentityChangeSnapshot(
                identity_id=IMIdentityId("identity-1"),
                provider=IMProvider.FEISHU,
                provider_user_id="provider-user-1",
                display_name="Before",
                email="reviewer@example.com",
                normalized_email=NormalizedEmail("reviewer@example.com"),
                last_seen_sync_run_id=None,
            ),
            after=IMIdentityChangeSnapshot(
                identity_id=IMIdentityId("identity-1"),
                provider=IMProvider.FEISHU,
                provider_user_id="provider-user-1",
                display_name="After",
                email="reviewer@example.com",
                normalized_email=NormalizedEmail("reviewer@example.com"),
                last_seen_sync_run_id=IMSyncRunId("run-1"),
            ),
            committed_at=_NOW,
        ),
        IMReconciliationChange(
            id=IMReconciliationChangeId("change-binding"),
            integration_id=_INTEGRATION_ID,
            sync_run_id=IMSyncRunId("run-1"),
            operation_key="binding:replace:1",
            subject_kind=IMReconciliationSubjectKind.BINDING,
            operation=IMReconciliationOperation.REPLACE,
            reason_code="binding_replaced",
            identity_id=IMIdentityId("identity-2"),
            binding_id=IMBindingId("binding-1"),
            contact_id=ContactId("contact-1"),
            before=IMBindingChangeSnapshot(
                binding_id=IMBindingId("binding-1"),
                identity_id=IMIdentityId("identity-1"),
                contact_id=ContactId("contact-1"),
            ),
            after=IMBindingChangeSnapshot(
                binding_id=IMBindingId("binding-1"),
                identity_id=IMIdentityId("identity-2"),
                contact_id=ContactId("contact-1"),
            ),
            committed_at=_NOW,
        ),
    ],
)
def test_reconciliation_change_mapping_round_trips_without_orm_leak(
    change: IMReconciliationChange,
) -> None:
    record = reconciliation_change_to_record(change)

    mapped = reconciliation_change_from_record(record)

    assert mapped == change
    assert type(mapped) is IMReconciliationChange
