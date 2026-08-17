"""Routing tests for Organization-guarded IM Control Plane writes."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ActiveRunDecisionKind,
    ConfigurationTransition,
    EncryptedCredentials,
    IMIntegration,
    ProviderTenantIdentity,
)
from core.human_input_v2.shared import (
    AccountId,
    DirectoryScope,
    IMSyncRunId,
    IntegrationId,
    TenantId,
    WorkspaceScope,
)
from models.human_input_v2 import HumanInputIMIntegration
from repositories.human_input_v2.im_integration.repository import SQLAlchemyIMControlPlaneRepository
from repositories.human_input_v2.im_integration.unit_of_work import SQLAlchemyOrganizationIMWriteUnitOfWork

_NOW = datetime(2026, 8, 11, 8)
_TENANT_ID = TenantId("workspace-1")


def test_account_and_membership_writes_are_outside_the_im_write_lock_boundary() -> None:
    api_root = Path(__file__).resolve().parents[5]
    account_service_source = (api_root / "services/account_service.py").read_text(encoding="utf-8")

    assert "services.human_input_v2.im_contact_sync" not in account_service_source
    assert "repositories.human_input_v2.organization_write_unit_of_work" not in account_service_source
    assert not (api_root / "services/human_input_v2/im_contact_sync/protected_writes.py").exists()


class _OwnedWriteLock:
    def __init__(self) -> None:
        self.held = False

    def __enter__(self) -> _OwnedWriteLock:
        self.held = True
        return self

    def __exit__(self, *_unused: object) -> None:
        self.held = False

    def ensure_owned(self) -> None:
        if not self.held:
            raise RuntimeError("lock is not held")

    def extend(self) -> None:
        self.ensure_owned()


class _RecordingUnitOfWorkFactory:
    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker
        self.scopes: list[DirectoryScope] = []

    def __call__(self, scope: DirectoryScope) -> SQLAlchemyOrganizationIMWriteUnitOfWork:
        self.scopes.append(scope)
        return SQLAlchemyOrganizationIMWriteUnitOfWork(self._session_maker, _OwnedWriteLock())


def _integration() -> IMIntegration:
    return IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=_TENANT_ID,
        provider_tenant=ProviderTenantIdentity(IMProvider.FEISHU, "provider-tenant-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {"app_id": "app-1", "encrypted_app_secret": "ciphertext"}
        ),
        configured_by_account_id=AccountId("account-1"),
        callback_url=None,
        now=_NOW,
    )


def test_control_plane_write_uses_explicit_scope_while_read_remains_unlocked(sqlite_engine: Engine) -> None:
    HumanInputIMIntegration.metadata.create_all(sqlite_engine, tables=[HumanInputIMIntegration.__table__])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    unit_of_work_factory = _RecordingUnitOfWorkFactory(session_maker)
    repository = SQLAlchemyIMControlPlaneRepository(session_maker, unit_of_work_factory)
    organization_scope = WorkspaceScope(id=_TENANT_ID)

    created = repository.create_integration(_integration(), organization_scope=organization_scope)
    loaded = repository.load_current_integration(_TENANT_ID)

    assert created == loaded
    assert unit_of_work_factory.scopes == [organization_scope]


def test_configuration_run_and_delete_writes_reuse_the_explicit_organization_scope(sqlite_engine: Engine) -> None:
    HumanInputIMIntegration.metadata.create_all(sqlite_engine)
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    unit_of_work_factory = _RecordingUnitOfWorkFactory(session_maker)
    repository = SQLAlchemyIMControlPlaneRepository(session_maker, unit_of_work_factory)
    organization_scope = WorkspaceScope(id=_TENANT_ID)
    current = repository.create_integration(_integration(), organization_scope=organization_scope)
    transition = current.reconfigure(
        expected_revision=current.revision,
        provider_tenant=current.provider_tenant,
        encrypted_credentials=EncryptedCredentials.from_mapping({"app_id": "app-1", "encrypted_app_secret": "rotated"}),
        configured_by_account_id=AccountId("account-2"),
        callback_url=None,
        now=_NOW,
    )
    assert isinstance(transition, ConfigurationTransition)

    updated = repository.compare_and_swap_configuration(transition, organization_scope=organization_scope)
    active_run = repository.create_or_get_active_run(
        updated.revision,
        organization_scope=organization_scope,
        sync_run_id=IMSyncRunId("run-1"),
        started_by_account_id=AccountId("account-2"),
        now=_NOW,
    )
    deleted = repository.compare_and_swap_delete(
        updated.plan_deletion(updated.revision),
        organization_scope=organization_scope,
    )

    assert active_run.kind is ActiveRunDecisionKind.CREATED
    assert deleted is None
    assert unit_of_work_factory.scopes == [organization_scope] * 4
