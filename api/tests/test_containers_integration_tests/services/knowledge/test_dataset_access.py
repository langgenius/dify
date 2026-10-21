"""Database-backed coverage for the current dataset access boundary."""

from collections.abc import Sequence
from uuid import uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums.account import TenantAccountRole
from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantStatus
from models.dataset import Dataset, DatasetPermission, DatasetPermissionEnum
from models.enums import DataSourceType
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetAccessService, DatasetNotFoundError
from services.knowledge.datasets.contracts import DatasetUpdateMutation
from services.knowledge.resource_scope import DatasetRef


def _account(session: Session, *, tenant: Tenant, role: TenantAccountRole) -> Account:
    account = Account(
        email=f"{uuid4()}@example.com",
        name=f"member-{uuid4()}",
        interface_language="en-US",
        status=AccountStatus.ACTIVE,
    )
    session.add(account)
    session.flush()
    session.add(
        TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=role,
            current=True,
        )
    )
    return account


def _dataset(
    session: Session,
    *,
    tenant: Tenant,
    maintainer: Account,
    permission: DatasetPermissionEnum,
) -> Dataset:
    dataset = Dataset(
        tenant_id=tenant.id,
        name=f"dataset-{uuid4()}",
        description="",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="economy",
        created_by=maintainer.id,
        maintainer=maintainer.id,
        provider="vendor",
        permission=permission,
    )
    session.add(dataset)
    session.flush()
    return dataset


def _services(
    session: Session,
) -> tuple[DatasetAccessService, SQLAlchemyDatasetRepository, sessionmaker[Session]]:
    sessions = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    datasets = SQLAlchemyDatasetRepository(
        session_factory=sessions,
        wake_after_commit=lambda _session: None,
        revoke_keys_after_commit=lambda _session, _token_ids: None,
    )
    access = DatasetAccessService(
        datasets=datasets,
        workspace_roles=WorkspaceRepository(sessions),
        legacy_permissions_enabled=True,
    )
    return access, datasets, sessions


def _context(account: Account, tenant: Tenant, *, resources: Sequence[str] | None = None) -> RequestContext:
    return RequestContext(
        request_id="request",
        trace_id=None,
        account_id=account.id,
        active_workspace_id=tenant.id,
        resource_dataset_ids=frozenset(resources) if resources is not None else None,
    )


def test_partial_member_access_tracks_repository_owned_grants(db_session_with_containers: Session) -> None:
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    db_session_with_containers.add(tenant)
    db_session_with_containers.flush()
    owner = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.OWNER)
    member = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.NORMAL)
    revoked = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.NORMAL)
    dataset = _dataset(
        db_session_with_containers,
        tenant=tenant,
        maintainer=owner,
        permission=DatasetPermissionEnum.PARTIAL_TEAM,
    )
    db_session_with_containers.add_all(
        [
            DatasetPermission(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                account_id=member.id,
                has_permission=True,
            ),
            DatasetPermission(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                account_id=revoked.id,
                has_permission=False,
            ),
        ]
    )
    db_session_with_containers.commit()
    access, datasets, _sessions = _services(db_session_with_containers)

    ref = DatasetRef(tenant.id, dataset.id)
    update_snapshot = datasets.get_update_snapshot(ref)
    permission_snapshot = datasets.get_permission_change_snapshot(ref, actor_id=owner.id)
    assert update_snapshot is not None
    assert permission_snapshot is not None

    assert access.require_accessible(_context(member, tenant), dataset.id).id == dataset.id
    with pytest.raises(DatasetAccessDeniedError):
        access.require_accessible(_context(revoked, tenant), dataset.id)

    assert datasets.update_dataset(
        DatasetUpdateMutation(
            ref_tenant_id=tenant.id,
            ref_dataset_id=dataset.id,
            actor_id=owner.id,
            expected=update_snapshot,
            permission_expected=permission_snapshot,
            values={},
            partial_member_ids=(),
        )
    )
    with pytest.raises(DatasetAccessDeniedError):
        access.require_accessible(_context(member, tenant), dataset.id)


def test_access_hides_foreign_workspace_and_enforces_resource_scope(db_session_with_containers: Session) -> None:
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    other_tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    db_session_with_containers.add_all([tenant, other_tenant])
    db_session_with_containers.flush()
    owner = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.OWNER)
    dataset = _dataset(
        db_session_with_containers,
        tenant=tenant,
        maintainer=owner,
        permission=DatasetPermissionEnum.ONLY_ME,
    )
    db_session_with_containers.commit()
    access, _datasets, _sessions = _services(db_session_with_containers)

    assert access.require_accessible(_context(owner, tenant), dataset.id).id == dataset.id
    with pytest.raises(DatasetAccessDeniedError):
        access.require_accessible(_context(owner, tenant, resources=()), dataset.id)

    foreign_context = _context(owner, other_tenant)
    with pytest.raises(DatasetNotFoundError):
        access.require_accessible(foreign_context, dataset.id)


def test_permission_change_snapshot_and_member_update_share_an_atomic_fence(
    db_session_with_containers: Session,
) -> None:
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    other_tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    db_session_with_containers.add_all([tenant, other_tenant])
    db_session_with_containers.flush()
    owner = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.OWNER)
    operator = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.DATASET_OPERATOR)
    first_member = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.NORMAL)
    second_member = _account(db_session_with_containers, tenant=tenant, role=TenantAccountRole.NORMAL)
    dataset = _dataset(
        db_session_with_containers,
        tenant=tenant,
        maintainer=owner,
        permission=DatasetPermissionEnum.PARTIAL_TEAM,
    )
    db_session_with_containers.add(
        DatasetPermission(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            account_id=first_member.id,
        )
    )
    db_session_with_containers.commit()
    _access, datasets, sessions = _services(db_session_with_containers)

    snapshot = datasets.get_permission_change_snapshot(
        DatasetRef(tenant.id, dataset.id),
        actor_id=operator.id,
    )
    update_snapshot = datasets.get_update_snapshot(DatasetRef(tenant.id, dataset.id))
    assert snapshot is not None
    assert update_snapshot is not None
    assert snapshot.actor_role == TenantAccountRole.DATASET_OPERATOR.value
    assert snapshot.current_permission == DatasetPermissionEnum.PARTIAL_TEAM.value
    assert snapshot.current_member_ids == (first_member.id,)

    assert datasets.update_dataset(
        DatasetUpdateMutation(
            ref_tenant_id=tenant.id,
            ref_dataset_id=dataset.id,
            actor_id=operator.id,
            expected=update_snapshot,
            permission_expected=snapshot,
            values={},
            partial_member_ids=(second_member.id, second_member.id),
        )
    )
    assert (
        datasets.update_dataset(
            DatasetUpdateMutation(
                ref_tenant_id=tenant.id,
                ref_dataset_id=dataset.id,
                actor_id=operator.id,
                expected=update_snapshot,
                permission_expected=snapshot,
                values={"name": "stale-authorized-write"},
            )
        )
        is False
    )
    with sessions() as verification_session:
        member_ids = verification_session.scalars(
            select(DatasetPermission.account_id).where(
                DatasetPermission.tenant_id == tenant.id,
                DatasetPermission.dataset_id == dataset.id,
            )
        ).all()
        persisted_name = verification_session.scalar(
            select(Dataset.name).where(Dataset.tenant_id == tenant.id, Dataset.id == dataset.id)
        )
    assert member_ids == [second_member.id]
    assert persisted_name == dataset.name
