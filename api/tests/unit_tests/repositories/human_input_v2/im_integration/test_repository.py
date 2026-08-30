"""SQLite-backed read and diagnostic contracts for the IM Control Plane adapter."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMBindingScope, IMProvider, IMSyncResultType
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMBinding,
    IMIdentity,
    IMIntegration,
    IMSyncRun,
    IntegrationRevisionToken,
    ProviderTenantIdentity,
    SyncResultFact,
)
from core.human_input_v2.shared import (
    AccountId,
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncResultId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
)
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.im_integration.mappers import (
    binding_to_record,
    identity_to_record,
    integration_to_record,
    sync_result_to_record,
    sync_run_to_record,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("workspace-1")
_INTEGRATION_ID = IntegrationId("integration-1")


@pytest.fixture
def repository_context(
    sqlite_engine: Engine,
) -> tuple[SQLAlchemyIMControlPlaneRepository, sessionmaker[Session]]:
    HumanInputIMIntegration.metadata.create_all(
        sqlite_engine,
        tables=[
            HumanInputIMIntegration.__table__,
            HumanInputIMIdentity.__table__,
            HumanInputIMBinding.__table__,
            HumanInputIMSyncRun.__table__,
            HumanInputIMSyncResult.__table__,
        ],
    )
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    def fail_if_write_unit_of_work_is_requested(_scope: object) -> None:
        raise AssertionError("read-only repository operation requested a write unit of work")

    return SQLAlchemyIMControlPlaneRepository(sessions, fail_if_write_unit_of_work_is_requested), sessions


def _integration(
    integration_id: IntegrationId = _INTEGRATION_ID,
    *,
    tenant_id: TenantId | None = _TENANT_ID,
) -> IMIntegration:
    return IMIntegration.create(
        integration_id=integration_id,
        tenant_id=tenant_id,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, f"provider-tenant:{integration_id}"),
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
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
        raw_payload={},
        last_seen_sync_run_id=None,
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
        bound_by_account_id=None,
        now=_NOW,
    )


def _run() -> IMSyncRun:
    return IMSyncRun.create(
        sync_run_id=IMSyncRunId("run-1"),
        integration_revision=IntegrationRevisionToken(_INTEGRATION_ID, 1),
        provider=IMProvider.FEISHU,
        started_by_account_id=None,
        now=_NOW,
    )


def _result(result_id: str = "result-1") -> SyncResultFact:
    return SyncResultFact(
        id=IMSyncResultId(result_id),
        integration_id=_INTEGRATION_ID,
        sync_run_id=IMSyncRunId("run-1"),
        operation_key=f"diagnostic:{result_id}",
        result_type=IMSyncResultType.FAILED,
        provider_user_id=None,
        display_name=None,
        email=None,
        normalized_email=None,
        contact_id=None,
        identity_id=None,
        binding_id=None,
        removal_reason=None,
        reason_code="test_diagnostic",
        reason_message="Operator-safe diagnostic",
        directory_entry_payload=None,
        contact_snapshot=None,
        identity_snapshot=None,
        created_at=_NOW,
        updated_at=_NOW,
    )


def test_current_integration_read_is_exactly_owner_scoped(repository_context) -> None:
    repository, sessions = repository_context
    deployment_integration = _integration(IntegrationId("integration-deployment"), tenant_id=None)
    workspace_integration = _integration()
    with sessions.begin() as session:
        session.add_all(
            (
                integration_to_record(deployment_integration),
                integration_to_record(workspace_integration),
            )
        )

    assert repository.load_current_integration(None) == deployment_integration
    assert repository.load_current_integration(_TENANT_ID) == workspace_integration
    assert repository.load_current_integration(TenantId("workspace-missing")) is None


def test_integration_state_eagerly_maps_current_children(repository_context) -> None:
    repository, sessions = repository_context
    integration = _integration()
    identity = _identity()
    binding = _binding()
    run = _run()
    result = _result()
    with sessions.begin() as session:
        session.add_all(
            (
                integration_to_record(integration),
                identity_to_record(identity),
                binding_to_record(binding),
                sync_run_to_record(run),
                sync_result_to_record(result),
            )
        )

    state = repository.load_integration_state(_INTEGRATION_ID)

    assert state.integration == integration
    assert state.identities == (identity,)
    assert state.bindings == (binding,)
    assert state.sync_runs == (run,)
    assert state.sync_results == (result,)


def test_integration_state_reports_missing_owner(repository_context) -> None:
    repository, _ = repository_context

    with pytest.raises(ValueError, match="integration not found"):
        repository.load_integration_state(IntegrationId("integration-missing"))


def test_explicit_diagnostic_append_uses_its_own_transaction(repository_context) -> None:
    repository, sessions = repository_context
    with sessions.begin() as session:
        session.add_all((integration_to_record(_integration()), sync_run_to_record(_run())))

    repository.append_sync_results((_result(), _result("result-2")))

    with sessions() as session:
        assert session.scalar(select(func.count(HumanInputIMSyncResult.id))) == 2
