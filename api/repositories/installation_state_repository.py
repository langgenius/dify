"""Persistence adapter for installation setup and tenant-existence state."""

from datetime import datetime

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantPluginAutoUpgradeStrategy
from models.model import DifySetup, TenantCreditPool


class InstallationStateRepository:
    """Read persistent state shared by installation bootstrap use cases."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get_setup_at(self) -> datetime | None:
        with self._session_factory() as session:
            return session.scalar(select(DifySetup.setup_at).limit(1))

    def is_setup(self) -> bool:
        return self.get_setup_at() is not None

    def has_tenants(self) -> bool:
        with self._session_factory() as session:
            return session.scalar(select(exists().select_from(Tenant))) is True

    def mark_setup(self, *, attempt_id: str) -> None:
        with self._session_factory.begin() as session:
            session.add(DifySetup(version=dify_config.project.version, instance_id=attempt_id))

    def reset_setup(self, *, attempt_id: str, account_id: str, workspace_id: str | None) -> None:
        """Reconcile and remove state committed by one failed setup attempt."""
        with self._session_factory.begin() as session:
            session.execute(delete(DifySetup).where(DifySetup.instance_id == attempt_id))

            workspace_ids: tuple[str, ...]
            if workspace_id is None:
                workspace_ids = tuple(
                    session.scalars(
                        select(TenantAccountJoin.tenant_id).where(
                            TenantAccountJoin.account_id == account_id,
                            TenantAccountJoin.role == TenantAccountRole.OWNER,
                        )
                    )
                )
            else:
                owned_workspace_id = session.scalar(
                    select(TenantAccountJoin.tenant_id).where(
                        TenantAccountJoin.account_id == account_id,
                        TenantAccountJoin.tenant_id == workspace_id,
                        TenantAccountJoin.role == TenantAccountRole.OWNER,
                    )
                )
                workspace_ids = (owned_workspace_id,) if owned_workspace_id is not None else ()

            if workspace_ids:
                session.execute(
                    delete(TenantPluginAutoUpgradeStrategy).where(
                        TenantPluginAutoUpgradeStrategy.tenant_id.in_(workspace_ids)
                    )
                )
                session.execute(delete(TenantCreditPool).where(TenantCreditPool.tenant_id.in_(workspace_ids)))
                session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.tenant_id.in_(workspace_ids)))
                session.execute(delete(Tenant).where(Tenant.id.in_(workspace_ids)))
            has_membership = exists().where(TenantAccountJoin.account_id == account_id)
            account = session.scalar(select(Account).where(Account.id == account_id, ~has_membership))
            if account is not None:
                session.delete(account)
