"""PostgreSQL-only concurrency coverage for the IM Control Plane."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.contact_directory import Contact
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ApplyReconciliationStatus,
    ConfigurationTransition,
    EncryptedCredentials,
    IMIntegration,
    MatchKind,
    ProviderDirectoryEntry,
    ProviderTenantIdentity,
    ReconciliationAction,
    ReconciliationPlan,
    StaleRevision,
)
from core.human_input_v2.shared import AccountId, ContactId, IMSyncRunId, IntegrationId, TenantId
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from models.human_input_v2 import (
    HumanInputContact,
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncResult,
    HumanInputIMSyncRun,
)
from repositories.human_input_v2.contact_directory.mappers import contact_to_record
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository


def _require_postgresql() -> None:
    if db.engine.dialect.name != "postgresql":
        pytest.skip("requires the CI PostgreSQL integration database")


def _integration(integration_id: str, tenant_id: str | None) -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId(integration_id),
        tenant_id=TenantId(tenant_id) if tenant_id is not None else None,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, f"provider-{tenant_id or 'deployment'}"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=AccountId(str(uuidv7())),
        callback_url=None,
        now=naive_utc_now(),
    )


def _cleanup(
    session_maker,
    integration_ids: tuple[str, ...],
    *,
    contact_ids: tuple[str, ...] = (),
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
        if contact_ids:
            session.execute(sa.delete(HumanInputContact).where(HumanInputContact.id.in_(contact_ids)))


def test_concurrent_deployment_integration_creation_has_exactly_one_winner(flask_req_ctx, setup_account) -> None:
    _require_postgresql()
    assert setup_account.id
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    integration_ids = (str(uuidv7()), str(uuidv7()))
    with session_maker() as session:
        if session.scalar(
            sa.select(sa.func.count(HumanInputIMIntegration.id)).where(HumanInputIMIntegration.tenant_id.is_(None))
        ):
            pytest.skip("requires a deployment without an existing IM integration")
    barrier = Barrier(2)

    def create(integration_id: str) -> IMIntegration | str:
        barrier.wait()
        try:
            return SQLAlchemyIMControlPlaneRepository(session_maker).create_integration(
                _integration(integration_id, None)
            )
        except ValueError as error:
            return str(error)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(create, integration_ids))

        assert sum(isinstance(result, IMIntegration) for result in results) == 1
        assert results.count("deployment-wide IM integration already exists") == 1
        with session_maker() as session:
            count = session.scalar(
                sa.select(sa.func.count(HumanInputIMIntegration.id)).where(
                    HumanInputIMIntegration.id.in_(integration_ids),
                    HumanInputIMIntegration.tenant_id.is_(None),
                )
            )
        assert count == 1
    finally:
        _cleanup(session_maker, integration_ids)


def test_concurrent_configuration_cas_has_exactly_one_winner(flask_req_ctx) -> None:
    _require_postgresql()
    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
    integration_id = str(uuidv7())
    repository = SQLAlchemyIMControlPlaneRepository(session_maker)
    integration = repository.create_integration(_integration(integration_id, str(uuidv7())))
    barrier = Barrier(2)

    def rotate(secret: str) -> IMIntegration | StaleRevision:
        decision = integration.reconfigure(
            expected_revision=integration.revision,
            provider_tenant=integration.provider_tenant,
            encrypted_credentials=EncryptedCredentials.from_mapping(
                {"app_id": "app-1", "encrypted_app_secret": secret}
            ),
            configured_by_account_id=None,
            callback_url=None,
            now=naive_utc_now(),
        )
        assert isinstance(decision, ConfigurationTransition)
        barrier.wait()
        return SQLAlchemyIMControlPlaneRepository(session_maker).compare_and_swap_configuration(decision)

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(rotate, ("ciphertext-1", "ciphertext-2")))

        assert sum(isinstance(result, IMIntegration) for result in results) == 1
        assert sum(isinstance(result, StaleRevision) for result in results) == 1
    finally:
        _cleanup(session_maker, (integration_id,))


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


def test_concurrent_worker_retry_applies_one_sync_run_idempotently(flask_req_ctx) -> None:
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
    contact_id = ContactId(str(uuidv7()))
    contact = Contact.organization_account(
        contact_id=contact_id,
        account_id=AccountId(str(uuidv7())),
        name="Concurrent Retry Reviewer",
        email=f"concurrent-retry-{uuidv7()}@example.com",
        now=naive_utc_now(),
    )
    with session_maker.begin() as session:
        session.add(contact_to_record(contact))
    entry = ProviderDirectoryEntry.create(
        provider_user_id=f"provider-user-{uuidv7()}",
        display_name=contact.name,
        email=contact.email,
        raw_payload={"source": "concurrent-retry"},
    )
    plan = ReconciliationPlan(
        sync_run_id=run_decision.run.id,
        integration_revision=integration.revision,
        provider=integration.provider_tenant.provider,
        actions=(
            ReconciliationAction(
                entry=entry,
                match_kind=MatchKind.NORMALIZED_EMAIL,
                identity_id=None,
                binding_id=None,
                contact_id=contact.id,
            ),
        ),
        removed_identity_ids=(),
    )
    barrier = Barrier(2)

    def apply(_index: int):
        barrier.wait()
        return SQLAlchemyIMControlPlaneRepository(session_maker).apply_reconciliation(plan, now=naive_utc_now())

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(apply, range(2)))

        assert [result.status for result in results].count(ApplyReconciliationStatus.APPLIED) == 1
        assert [result.status for result in results].count(ApplyReconciliationStatus.ALREADY_APPLIED) == 1
        assert all(len(result.results) == 1 for result in results)
        assert results[0].results[0].id == results[1].results[0].id
        with session_maker() as session:
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputIMIdentity.id)).where(
                        HumanInputIMIdentity.integration_id == integration_id
                    )
                )
                == 1
            )
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputIMBinding.id)).where(
                        HumanInputIMBinding.integration_id == integration_id
                    )
                )
                == 1
            )
            assert (
                session.scalar(
                    sa.select(sa.func.count(HumanInputIMSyncResult.id)).where(
                        HumanInputIMSyncResult.sync_run_id == str(plan.sync_run_id)
                    )
                )
                == 1
            )
    finally:
        _cleanup(session_maker, (integration_id,), contact_ids=(str(contact_id),))


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
        encrypted_credentials=EncryptedCredentials.from_mapping({"app_id": "app-1", "encrypted_app_secret": "rotated"}),
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
