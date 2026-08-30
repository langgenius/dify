"""PostgreSQL-only concurrency coverage for the IM Control Plane."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ApplyReconciliationStatus,
    ConfigurationTransition,
    EncryptedCredentials,
    IMIntegration,
    ProviderTenantIdentity,
    ReconciliationPlan,
    StaleRevision,
)
from core.human_input_v2.shared import AccountId, IMSyncRunId, IntegrationId, TenantId
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository


def _require_postgresql() -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")


def _integration(integration_id: str, tenant_id: str | None) -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId(integration_id),
        tenant_id=TenantId(tenant_id) if tenant_id is not None else None,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, f"provider-{tenant_id or 'deployment'}"),
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-ciphertext"),
        app_identifier="app-1",
        configured_by_account_id=AccountId(str(uuidv7())),
        callback_url=None,
        now=naive_utc_now(),
    )


def _cleanup(
    session_maker,
    integration_ids: tuple[str, ...],
) -> None:
    with session_maker.begin() as session:
        run_ids = session.scalars(
            sa.select(HumanInputIMSyncRun.id).where(HumanInputIMSyncRun.integration_id.in_(integration_ids))
        ).all()
        if run_ids:
            session.execute(sa.delete(HumanInputIMSyncResult).where(HumanInputIMSyncResult.sync_run_id.in_(run_ids)))
        session.execute(sa.delete(HumanInputIMBinding).where(HumanInputIMBinding.integration_id.in_(integration_ids)))
        session.execute(sa.delete(HumanInputIMIdentity).where(HumanInputIMIdentity.integration_id.in_(integration_ids)))
        session.execute(sa.delete(HumanInputIMSyncRun).where(HumanInputIMSyncRun.integration_id.in_(integration_ids)))
        session.execute(sa.delete(HumanInputIMIntegration).where(HumanInputIMIntegration.id.in_(integration_ids)))


def test_concurrent_sync_triggers_create_at_most_one_active_run(flask_req_ctx) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    integration_id = str(uuidv7())
    repository = SQLAlchemyIMControlPlaneRepository(session_maker)
    integration = repository.create_integration(_integration(integration_id, str(uuidv7())))
    barrier = Barrier(2)

    def trigger(_index: int):
        barrier.wait()
        return SQLAlchemyIMControlPlaneRepository(session_maker).create_or_get_active_run(
            integration.revision,
            sync_run_id=IMSyncRunId(str(uuidv7())),
            started_by_account_id=None,
            now=naive_utc_now(),
        )

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(trigger, range(2)))

        assert [result.kind for result in results].count(ActiveRunDecisionKind.CREATED) == 1
        assert [result.kind for result in results].count(ActiveRunDecisionKind.EXISTING_ACTIVE) == 1
        with session_maker() as session:
            count = session.scalar(
                sa.select(sa.func.count(HumanInputIMSyncRun.id)).where(
                    HumanInputIMSyncRun.integration_id == integration_id
                )
            )
        assert count == 1
    finally:
        _cleanup(session_maker, (integration_id,))


def test_stale_reconciliation_records_diagnostic_without_current_mutation(flask_req_ctx) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    integration_id = str(uuidv7())
    repository = SQLAlchemyIMControlPlaneRepository(session_maker)
    integration = repository.create_integration(_integration(integration_id, str(uuidv7())))
    run_decision = repository.create_or_get_active_run(
        integration.revision,
        sync_run_id=IMSyncRunId(str(uuidv7())),
        started_by_account_id=None,
        now=naive_utc_now(),
    )
    assert run_decision.run is not None
    rotation = integration.reconfigure(
        expected_revision=integration.revision,
        provider_tenant=integration.provider_tenant,
        encrypted_credentials=EncryptedCredentials(ciphertext="opaque-rotated-ciphertext"),
        app_identifier="app-1",
        configured_by_account_id=None,
        callback_url=None,
        now=naive_utc_now(),
    )
    assert isinstance(rotation, ConfigurationTransition)
    repository.compare_and_swap_configuration(rotation)
    plan = ReconciliationPlan(
        sync_run_id=run_decision.run.id,
        integration_revision=integration.revision,
        provider=integration.provider_tenant.provider,
        actions=(),
        removed_identity_ids=(),
    )

    try:
        result = repository.apply_reconciliation(plan, now=naive_utc_now())

        assert result.status is ApplyReconciliationStatus.STALE_REVISION
        with session_maker() as session:
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputIMSyncResult.id)).where(
                        HumanInputIMSyncResult.sync_run_id == str(plan.sync_run_id)
                    )
                )
                == 1
            )
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputIMIdentity.id)).where(
                        HumanInputIMIdentity.integration_id == integration_id
                    )
                )
                == 0
            )
    finally:
        _cleanup(session_maker, (integration_id,))
