"""PostgreSQL and Redis HTTP contracts for the IM Contact Sync control plane."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime

import pytest
from flask.testing import FlaskClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.human_input_v2.entities import (
    IMProvider,
    IMSyncRemovalReason,
    IMSyncResultType,
    IMSyncRunStatus,
)
from core.human_input_v2.im_integration import (
    IMChannelRevision,
    IMSyncRun,
    SyncContactSnapshot,
    SyncIdentitySnapshot,
    SyncResultFact,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    NormalizedEmail,
    TenantId,
)
from models.account import Account, Tenant
from models.human_input_v2 import (
    ContactSubjectType,
    HumanInputContactIdentity,
    HumanInputIMBinding,
    HumanInputIMSyncRun,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.contact import Contact, ContactType
from repositories.human_input_v2.im_channel_repository import (
    IMChannel,
    IMChannelId,
    IMChannelStatus,
    WebhookId,
)
from repositories.human_input_v2.im_identity_repository import IMIdentity, IMIdentityObservation, OpaqueProviderPayload
from repositories.human_input_v2.im_integration.mappers import (
    sync_result_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from repositories.human_input_v2.sqlalchemy_im_identity_repository import SQLAlchemyIMIdentityRepository
from tasks.im_contact_sync_tasks import reconcile_im_contacts_task
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)

_NOW = datetime(2026, 8, 11, 8)
_LATER = datetime(2026, 8, 11, 9)
_CONTACT_ID = ContactId("00000000-0000-0000-0000-000000000101")
_CHANNEL_ID = IMChannelId("00000000-0000-0000-0000-000000000201")
_PRIMARY_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000301")
_SECONDARY_IDENTITY_ID = IMIdentityId("00000000-0000-0000-0000-000000000302")
_SYNC_RUNS_PATH = "/console/api/workspaces/current/human-input/im-sync-runs"


def _seed_control_plane(
    session: Session,
) -> tuple[Account, Tenant, Contact, IMChannel, IMIdentity, IMIdentity]:
    account, tenant = create_console_account_and_tenant(session)
    tenant_id = TenantId(tenant.id)
    account.name = "Reviewer"
    account.email = "reviewer@example.com"
    contact_identity = HumanInputContactIdentity(
        subject_type=ContactSubjectType.ACCOUNT,
        account_id=account.id,
    )
    contact_identity.id = str(_CONTACT_ID)
    contact_identity.created_at = _NOW
    contact_identity.updated_at = _NOW
    contact = Contact(
        id=_CONTACT_ID,
        type=ContactType.WORKSPACE,
        name="Reviewer",
        email="reviewer@example.com",
        avatar_file_id=None,
        created_at=_NOW,
    )
    channel = IMChannel(
        id=_CHANNEL_ID,
        created_at=_NOW,
        updated_at=_NOW,
        provider=IMProvider.FEISHU,
        provider_tenant_id="provider-tenant-1",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-feishu-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )
    session.add(contact_identity)
    WorkspaceIMChannelWriter(session, tenant_id, AccountId(account.id)).create(channel)
    identity_repository = SQLAlchemyIMIdentityRepository(session, channel.id)
    primary_identity = _create_identity(
        identity_repository,
        _PRIMARY_IDENTITY_ID,
        "provider-user-primary",
        "Primary Reviewer",
        "reviewer@example.com",
    )
    secondary_identity = _create_identity(
        identity_repository,
        _SECONDARY_IDENTITY_ID,
        "provider-user-secondary",
        "Secondary Reviewer",
        "secondary@example.com",
    )
    session.commit()
    return account, tenant, contact, channel, primary_identity, secondary_identity


def _create_identity(
    repository: SQLAlchemyIMIdentityRepository,
    identity_id: IMIdentityId,
    provider_user_id: str,
    display_name: str,
    email: str,
) -> IMIdentity:
    return repository.create(
        identity_id,
        IMIdentityObservation(
            provider_user_id=provider_user_id,
            display_name=display_name,
            email=email,
            raw_payload=OpaqueProviderPayload({}),
            sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000901"),
            observed_at=_NOW,
        ),
    )


def test_manual_binding_http_commands_use_real_guarded_postgresql_writes(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant, contact, _channel, _primary, _secondary = _seed_control_plane(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)
    binding_path = f"/console/api/workspaces/current/human-input/contacts/{contact.id}/im-bindings"
    override_path = f"/console/api/workspaces/current/human-input/contacts/{contact.id}/im-override"

    created = test_client_with_containers.put(
        binding_path,
        json={"identity_id": str(_PRIMARY_IDENTITY_ID)},
        headers=headers,
    )
    assert created.status_code == 200
    created_payload = created.get_json()
    assert created_payload is not None
    organization_binding = created_payload["contact"]["im_bindings"][0]
    assert organization_binding["scope"] == "organization"

    idempotent = test_client_with_containers.put(
        binding_path,
        json={"identity_id": str(_PRIMARY_IDENTITY_ID)},
        headers=headers,
    )
    assert idempotent.status_code == 200
    assert idempotent.get_json()["contact"]["im_bindings"] == [organization_binding]

    conflict = test_client_with_containers.put(
        binding_path,
        json={"identity_id": str(_SECONDARY_IDENTITY_ID)},
        headers=headers,
    )
    assert conflict.status_code == 409
    assert conflict.get_json()["code"] == "im_binding_conflict"

    missing_identity = test_client_with_containers.put(
        binding_path,
        json={"identity_id": "00000000-0000-0000-0000-000000000399"},
        headers=headers,
    )
    assert missing_identity.status_code == 404
    assert missing_identity.get_json()["code"] == "im_identity_not_found"

    override = test_client_with_containers.put(
        override_path,
        json={"identity_id": str(_SECONDARY_IDENTITY_ID)},
        headers=headers,
    )
    assert override.status_code == 200
    assert override.get_json()["contact"]["im_bindings"][0]["scope"] == "workspace"

    replaced_override = test_client_with_containers.put(
        override_path,
        json={"identity_id": str(_PRIMARY_IDENTITY_ID)},
        headers=headers,
    )
    assert replaced_override.status_code == 200
    assert (
        replaced_override.get_json()["contact"]["im_bindings"][0]["id"]
        == override.get_json()["contact"]["im_bindings"][0]["id"]
    )

    reset = test_client_with_containers.delete(override_path, headers=headers)
    assert reset.status_code == 200
    assert reset.get_json()["contact"]["im_bindings"] == [organization_binding]
    idempotent_reset = test_client_with_containers.delete(override_path, headers=headers)
    assert idempotent_reset.status_code == 200
    assert idempotent_reset.get_json()["contact"]["im_bindings"] == [organization_binding]

    missing_binding = test_client_with_containers.delete(
        binding_path,
        query_string={"binding_id": "00000000-0000-0000-0000-000000000499"},
        headers=headers,
    )
    assert missing_binding.status_code == 404
    assert missing_binding.get_json()["code"] == "im_binding_not_found"

    deleted = test_client_with_containers.delete(
        binding_path,
        query_string={"binding_id": organization_binding["id"]},
        headers=headers,
    )
    assert deleted.status_code == 200
    assert deleted.get_json() == {}
    db_session_with_containers.expire_all()
    assert db_session_with_containers.scalar(select(HumanInputIMBinding)) is None


def test_sync_command_and_identity_queries_use_real_postgresql(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account, tenant, _contact, channel, _primary, _secondary = _seed_control_plane(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)
    dispatched: list[tuple[tuple[str, str, str | None], str]] = []

    def capture_dispatch(*, args: tuple[str, str, str | None], queue: str) -> None:
        dispatched.append((args, queue))

    monkeypatch.setattr(reconcile_im_contacts_task, "apply_async", capture_dispatch)

    created = test_client_with_containers.post(_SYNC_RUNS_PATH, headers=headers)
    replayed = test_client_with_containers.post(_SYNC_RUNS_PATH, headers=headers)
    latest = test_client_with_containers.get(f"{_SYNC_RUNS_PATH}/latest", headers=headers)
    identities = test_client_with_containers.get(
        "/console/api/workspaces/current/human-input/im-identities",
        query_string={"keyword": "provider-user", "page": 1, "limit": 1},
        headers=headers,
    )

    assert created.status_code == replayed.status_code == latest.status_code == identities.status_code == 200
    created_run = created.get_json()["run"]
    assert replayed.get_json()["run"]["id"] == created_run["id"]
    assert latest.get_json()["run"]["id"] == created_run["id"]
    expected_dispatch = (
        (created_run["id"], "workspace", tenant.id),
        "human_input_contact_sync",
    )
    assert dispatched == [expected_dispatch, expected_dispatch]
    identity_page = identities.get_json()
    assert identity_page["total"] == 2
    assert len(identity_page["data"]) == 1
    assert identity_page["data"][0]["provider"] == IMProvider.FEISHU.value
    assert identity_page["data"][0]["binding_status"] == "unbound"
    assert created_run["integration_id"] == str(channel.id)


def test_latest_result_http_projection_reads_every_persisted_bucket(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, _tenant, contact, channel, primary_identity, _secondary = _seed_control_plane(db_session_with_containers)
    run = replace(
        IMSyncRun.create(
            sync_run_id=IMSyncRunId("00000000-0000-0000-0000-000000000501"),
            channel_revision=IMChannelRevision(str(channel.id), channel.config_version),
            provider=channel.provider,
            started_by_account_id=AccountId(account.id),
            now=_NOW,
        ),
        status=IMSyncRunStatus.SUCCEEDED,
        added_count=1,
        not_matched_count=1,
        failed_count=1,
        removed_count=1,
        skipped_count=1,
        started_at=_NOW,
        finished_at=_LATER,
    )
    results = _result_facts(run, contact, primary_identity, channel.provider)
    db_session_with_containers.add(sync_run_to_record(run))
    db_session_with_containers.add_all(sync_result_to_record(result) for result in results)
    db_session_with_containers.commit()
    headers = authenticate_console_client(test_client_with_containers, account)

    for result in results:
        response = test_client_with_containers.get(
            f"{_SYNC_RUNS_PATH}/latest/results",
            query_string={"result": result.result_type.value, "page": 1, "limit": 20},
            headers=headers,
        )
        assert response.status_code == 200
        payload = response.get_json()
        assert payload is not None
        assert (payload["page"], payload["limit"], payload["total"]) == (1, 20, 1)
        assert payload["data"][0]["result"]["type"] == result.result_type.value

    added = test_client_with_containers.get(
        f"{_SYNC_RUNS_PATH}/latest/results",
        query_string={"result": IMSyncResultType.ADDED.value, "page": 1, "limit": 20},
        headers=headers,
    ).get_json()["data"][0]["result"]
    failed = test_client_with_containers.get(
        f"{_SYNC_RUNS_PATH}/latest/results",
        query_string={"result": IMSyncResultType.FAILED.value, "page": 1, "limit": 20},
        headers=headers,
    ).get_json()["data"][0]["result"]
    removed = test_client_with_containers.get(
        f"{_SYNC_RUNS_PATH}/latest/results",
        query_string={"result": IMSyncResultType.REMOVED.value, "page": 1, "limit": 20},
        headers=headers,
    ).get_json()["data"][0]["result"]
    assert added["contact"]["id"] == str(contact.id)
    assert failed["reason"] == "Directory read failed"
    assert removed["last_known_identity"]["identity_id"] == str(primary_identity.id)
    assert removed["reason"] == IMSyncRemovalReason.NOT_PRESENT_IN_DIRECTORY.value


def _result_facts(
    run: IMSyncRun,
    contact: Contact,
    identity: IMIdentity,
    provider: IMProvider,
) -> tuple[SyncResultFact, ...]:
    contact_snapshot = SyncContactSnapshot(contact.id, contact.name, contact.email, contact.avatar_file_id)
    identity_snapshot = SyncIdentitySnapshot(
        identity.id,
        provider,
        identity.provider_user_id,
        identity.display_name,
        identity.email,
    )

    def result(
        result_id: int,
        result_type: IMSyncResultType,
        *,
        include_entry: bool = True,
        include_contact: bool = False,
        removal_reason: IMSyncRemovalReason | None = None,
        reason_message: str | None = None,
    ) -> SyncResultFact:
        suffix = str(result_id).zfill(12)
        return SyncResultFact(
            id=IMSyncResultId(f"00000000-0000-0000-0000-{suffix}"),
            integration_id=IntegrationId(run.channel_revision.channel_id),
            sync_run_id=run.id,
            operation_key=f"result:{result_type.value}:{result_id}",
            result_type=result_type,
            provider_user_id=identity.provider_user_id if include_entry else None,
            display_name=identity.display_name if include_entry else None,
            email=identity.email if include_entry else None,
            normalized_email=NormalizedEmail(identity.email) if include_entry and identity.email is not None else None,
            contact_id=contact.id if include_contact else None,
            identity_id=identity.id,
            binding_id=None,
            removal_reason=removal_reason,
            reason_code=None,
            reason_message=reason_message,
            directory_entry_payload=None,
            contact_snapshot=contact_snapshot if include_contact else None,
            identity_snapshot=identity_snapshot if removal_reason is not None else None,
            created_at=_NOW,
            updated_at=_NOW,
        )

    return (
        result(1, IMSyncResultType.ADDED, include_contact=True),
        result(2, IMSyncResultType.NOT_MATCHED),
        result(3, IMSyncResultType.FAILED, reason_message="Directory read failed"),
        result(
            4,
            IMSyncResultType.REMOVED,
            include_entry=False,
            include_contact=True,
            removal_reason=IMSyncRemovalReason.NOT_PRESENT_IN_DIRECTORY,
        ),
        result(5, IMSyncResultType.SKIPPED, include_contact=True),
    )


def test_missing_control_plane_state_returns_stable_http_errors(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)

    missing_integration = test_client_with_containers.get(
        "/console/api/workspaces/current/human-input/im-identities",
        headers=headers,
    )
    missing_sync_integration = test_client_with_containers.post(_SYNC_RUNS_PATH, headers=headers)
    assert missing_integration.status_code == missing_sync_integration.status_code == 404
    assert missing_integration.get_json()["code"] == "im_integration_not_configured"

    channel = IMChannel(
        id=_CHANNEL_ID,
        created_at=_NOW,
        updated_at=_NOW,
        provider=IMProvider.FEISHU,
        provider_tenant_id="provider-tenant-1",
        encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-feishu-ciphertext"),
        app_identifier="app-1",
        webhook_id=WebhookId("00000000000000000000000000000001"),
        config_version=1,
        status=IMChannelStatus.CONNECTED,
    )
    WorkspaceIMChannelWriter(db_session_with_containers, TenantId(tenant.id), AccountId(account.id)).create(channel)
    db_session_with_containers.commit()

    missing_run = test_client_with_containers.get(f"{_SYNC_RUNS_PATH}/latest", headers=headers)
    missing_results = test_client_with_containers.get(
        f"{_SYNC_RUNS_PATH}/latest/results",
        query_string={"result": IMSyncResultType.ADDED.value},
        headers=headers,
    )
    assert missing_run.status_code == missing_results.status_code == 404
    assert missing_run.get_json()["code"] == "im_sync_run_not_found"
    assert db_session_with_containers.scalar(select(HumanInputIMSyncRun)) is None
