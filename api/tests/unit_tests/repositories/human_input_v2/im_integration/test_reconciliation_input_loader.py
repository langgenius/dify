"""SQLite tests for reconciliation input behavior independent of legacy Contacts."""

from datetime import datetime

import pytest
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMBindingScope, IMIntegrationStatus, IMProvider
from core.human_input_v2.im_integration import IMBinding, IMSyncRun, IntegrationRevisionToken, ReconciliationRunRef
from core.human_input_v2.shared import (
    ContactId,
    IMBindingId,
    IMIdentityId,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMIdentity,
    HumanInputIMIntegration,
    HumanInputIMSyncRun,
    IMEncryptedCredentials,
)
from repositories.human_input_v2.im_integration.mappers import binding_to_record, sync_run_to_record

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("workspace-1")
_OTHER_TENANT_ID = TenantId("workspace-2")
_INTEGRATION_ID = IntegrationId("integration-1")


class _OwnedWriteLock:
    def __init__(self) -> None:
        self.held = False

    def __enter__(self) -> "_OwnedWriteLock":
        self.held = True
        return self

    def __exit__(self, *_unused: object) -> None:
        self.held = False

    def ensure_owned(self) -> None:
        if not self.held:
            raise RuntimeError("lock is not held")

    def extend(self) -> None:
        self.ensure_owned()


@pytest.fixture
def loader_context(sqlite_engine: Engine) -> tuple[sessionmaker[Session], _OwnedWriteLock, ReconciliationRunRef]:
    tables = [
        HumanInputIMIntegration.__table__,
        HumanInputIMIdentity.__table__,
        HumanInputIMBinding.__table__,
        HumanInputIMSyncRun.__table__,
    ]
    HumanInputIMIntegration.metadata.create_all(sqlite_engine, tables=tables)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    run = ReconciliationRunRef(
        IMSyncRunId("run-1"),
        IntegrationRevisionToken(_INTEGRATION_ID, 1),
        IMProvider.FEISHU,
    )
    sync_run = IMSyncRun.create(
        sync_run_id=run.sync_run_id,
        integration_revision=run.integration_revision,
        provider=run.provider,
        started_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        integration = HumanInputIMIntegration(
            provider=IMProvider.FEISHU,
            encrypted_credentials=IMEncryptedCredentials(ciphertext="opaque-ciphertext"),
            tenant_id=str(_TENANT_ID),
            provider_tenant_id="provider-tenant-1",
            app_identifier="app-1",
            status=IMIntegrationStatus.CONFIGURED,
            config_version=1,
        )
        integration.id = str(_INTEGRATION_ID)
        session.add(integration)
        session.add(sync_run_to_record(sync_run))
    return session_maker, _OwnedWriteLock(), run


def test_workspace_projection_rejects_scope_that_does_not_own_integration(loader_context) -> None:
    session_maker, lock, run = loader_context

    with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
        with pytest.raises(ValueError, match="Contact scope does not own IM Integration"):
            repository.load_reconciliation_input(run, (), WorkspaceScope(id=_OTHER_TENANT_ID))


def test_run_capture_mismatch_fails_before_loading_reconciliation_snapshots(
    sqlite_engine: Engine,
    loader_context,
) -> None:
    session_maker, lock, run = loader_context
    mismatched_run = ReconciliationRunRef(
        run.sync_run_id,
        IntegrationRevisionToken(run.integration_revision.integration_id, 2),
        run.provider,
    )
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
            with pytest.raises(ValueError, match="sync run capture does not match reconciliation input"):
                repository.load_reconciliation_input(mismatched_run, (), WorkspaceScope(id=_TENANT_ID))
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    executed_sql = "\n".join(statements).lower()
    assert "human_input_im_sync_runs" in executed_sql
    assert "human_input_im_integrations" not in executed_sql
    assert "human_input_im_identities" not in executed_sql
    assert "human_input_im_bindings" not in executed_sql


def test_empty_identity_namespace_does_not_load_unreferenced_bindings(
    sqlite_engine: Engine,
    loader_context,
) -> None:
    session_maker, lock, run = loader_context
    unrelated_binding = IMBinding.create(
        binding_id=IMBindingId("binding-unrelated"),
        integration_id=IntegrationId("integration-other"),
        scope=IMBindingScope.ORGANIZATION,
        scope_id="integration-other",
        contact_id=ContactId("contact-unrelated"),
        identity_id=IMIdentityId("identity-unrelated"),
        provider=IMProvider.FEISHU,
        bound_by_account_id=None,
        now=_NOW,
    )
    with session_maker.begin() as session:
        session.add(binding_to_record(unrelated_binding))
    statements: list[str] = []

    def record_statement(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(sqlite_engine, "before_cursor_execute", record_statement)
    try:
        with SQLAlchemyOrganizationIMWriteUnitOfWork(session_maker, lock) as repository:
            reconciliation_input = repository.load_reconciliation_input(run, (), WorkspaceScope(id=_TENANT_ID))
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", record_statement)

    assert reconciliation_input.current_identities == ()
    assert reconciliation_input.current_bindings == ()
    assert reconciliation_input.reconciled_binding_ids == frozenset()
    assert all("FOR UPDATE" not in statement.upper() for statement in statements)
