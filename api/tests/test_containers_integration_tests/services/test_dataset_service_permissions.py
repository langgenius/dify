"""Database-backed coverage for dataset permissions and lifecycle mutations."""

from uuid import uuid4

import pytest
from sqlalchemy.orm import Session, sessionmaker

from machinery.context import RequestContext
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.dataset import Dataset, DatasetPermission, DatasetPermissionEnum
from models.enums import DataSourceType
from repositories.knowledge.dataset_read_repository import get_or_create_dataset_collection_binding
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetAccessService
from services.knowledge.entities.resource_scope import DatasetRef


def _account(session: Session, tenant: Tenant, *, role: TenantAccountRole) -> Account:
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


def _dataset(session: Session, tenant: Tenant, owner: Account, *, permission: DatasetPermissionEnum) -> Dataset:
    dataset = Dataset(
        tenant_id=tenant.id,
        name=f"dataset-{uuid4()}",
        description="",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="economy",
        created_by=owner.id,
        maintainer=owner.id,
        provider="vendor",
        permission=permission,
    )
    session.add(dataset)
    session.flush()
    return dataset


def _repository(session: Session) -> tuple[SQLAlchemyDatasetRepository, sessionmaker[Session]]:
    sessions = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    return (
        SQLAlchemyDatasetRepository(
            session_factory=sessions,
            revoke_keys_after_commit=lambda _session, _tokens: None,
        ),
        sessions,
    )


def _context(account: Account, tenant: Tenant) -> RequestContext:
    return RequestContext("request", None, account.id, tenant.id)


def test_partial_member_permission_is_scoped_to_dataset_and_tenant(
    db_session_with_containers: Session,
) -> None:
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    other_tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    db_session_with_containers.add_all([tenant, other_tenant])
    db_session_with_containers.flush()
    owner = _account(db_session_with_containers, tenant, role=TenantAccountRole.OWNER)
    member = _account(db_session_with_containers, tenant, role=TenantAccountRole.NORMAL)
    outsider = _account(db_session_with_containers, other_tenant, role=TenantAccountRole.OWNER)
    dataset = _dataset(
        db_session_with_containers,
        tenant,
        owner,
        permission=DatasetPermissionEnum.PARTIAL_TEAM,
    )
    db_session_with_containers.add(
        DatasetPermission(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            account_id=member.id,
            has_permission=True,
        )
    )
    db_session_with_containers.commit()
    repository, sessions = _repository(db_session_with_containers)
    access = DatasetAccessService(
        datasets=repository,
        workspace_roles=WorkspaceRepository(sessions),
        legacy_permissions_enabled=True,
    )

    assert access.require_accessible(_context(member, tenant), dataset.id).id == dataset.id
    with pytest.raises(DatasetAccessDeniedError):
        access.require_accessible(_context(outsider, other_tenant), dataset.id)


def test_only_me_dataset_rejects_non_maintainer(db_session_with_containers: Session) -> None:
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    db_session_with_containers.add(tenant)
    db_session_with_containers.flush()
    owner = _account(db_session_with_containers, tenant, role=TenantAccountRole.EDITOR)
    member = _account(db_session_with_containers, tenant, role=TenantAccountRole.EDITOR)
    dataset = _dataset(db_session_with_containers, tenant, owner, permission=DatasetPermissionEnum.ONLY_ME)
    db_session_with_containers.commit()
    repository, sessions = _repository(db_session_with_containers)
    access = DatasetAccessService(
        datasets=repository,
        workspace_roles=WorkspaceRepository(sessions),
        legacy_permissions_enabled=True,
    )

    with pytest.raises(DatasetAccessDeniedError):
        access.require_accessible(_context(member, tenant), dataset.id)


def test_set_api_enabled_updates_owned_dataset(db_session_with_containers: Session) -> None:
    tenant = Tenant(name=f"tenant-{uuid4()}", status=TenantStatus.NORMAL)
    db_session_with_containers.add(tenant)
    db_session_with_containers.flush()
    owner = _account(db_session_with_containers, tenant, role=TenantAccountRole.OWNER)
    dataset = _dataset(db_session_with_containers, tenant, owner, permission=DatasetPermissionEnum.ONLY_ME)
    dataset.enable_api = False
    db_session_with_containers.commit()
    repository, _sessions = _repository(db_session_with_containers)

    assert repository.set_api_enabled(DatasetRef(tenant.id, dataset.id), actor_id=owner.id, enabled=True)
    db_session_with_containers.expire_all()
    persisted = db_session_with_containers.get_one(Dataset, dataset.id)
    assert persisted.enable_api is True
    assert persisted.updated_by == owner.id


def test_collection_binding_get_or_create_is_idempotent(db_session_with_containers: Session) -> None:
    first = get_or_create_dataset_collection_binding(
        db_session_with_containers,
        provider_name="provider",
        model_name="model",
    )
    second = get_or_create_dataset_collection_binding(
        db_session_with_containers,
        provider_name="provider",
        model_name="model",
    )

    assert second.id == first.id
