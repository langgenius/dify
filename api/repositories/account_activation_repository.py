"""SQLAlchemy repository for account invitation activation."""

from typing import override

from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from services.account_activation_service import AccountActivationRepository
from services.entities.account_activation_entities import (
    AccountInvitation,
    AccountSetup,
    ActivationPersistenceResult,
    InvitationToken,
)


class SQLAlchemyAccountActivationRepository(AccountActivationRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def resolve(self, invitation: InvitationToken) -> AccountInvitation | None:
        with self._session_factory() as session:
            tenant = session.scalar(
                select(Tenant).where(
                    Tenant.id == invitation.workspace_id,
                    Tenant.status == TenantStatus.NORMAL,
                )
            )
            if tenant is None:
                return None

            account = session.scalar(
                select(Account).where(
                    Account.id == invitation.account_id,
                    Account.email == invitation.email,
                )
            )
            if account is None:
                return None

            return AccountInvitation(
                account_id=account.id,
                account_email=account.email,
                account_status=account.status.value,
                workspace_id=tenant.id,
                workspace_name=tenant.name,
                role=invitation.role,
                requires_setup=invitation.requires_setup,
            )

    @override
    def activate(
        self,
        invitation: AccountInvitation,
        *,
        role: str,
        setup: AccountSetup | None,
    ) -> ActivationPersistenceResult | None:
        with self._session_factory.begin() as session:
            tenant_id = session.scalar(
                select(Tenant.id).where(
                    Tenant.id == invitation.workspace_id,
                    Tenant.status == TenantStatus.NORMAL,
                )
            )
            account = session.scalar(
                select(Account)
                .where(
                    Account.id == invitation.account_id,
                    Account.email == invitation.account_email,
                )
                .with_for_update()
            )
            if tenant_id is None or account is None:
                return None

            membership = session.scalar(
                select(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id == account.id,
                )
            )
            membership_created = membership is None
            if membership is None:
                membership = TenantAccountJoin(
                    tenant_id=tenant_id,
                    account_id=account.id,
                    role=TenantAccountRole(role),
                )
                session.add(membership)

            if setup is not None:
                account.name = setup.name
                account.interface_language = setup.interface_language
                account.timezone = setup.timezone
                account.interface_theme = "light"
                account.status = AccountStatus.ACTIVE
                account.initialized_at = naive_utc_now()

            session.execute(
                update(TenantAccountJoin)
                .where(
                    TenantAccountJoin.account_id == account.id,
                    TenantAccountJoin.tenant_id != tenant_id,
                )
                .values(current=False)
            )
            membership.current = True
            membership.last_opened_at = naive_utc_now()

            return ActivationPersistenceResult(membership_created=membership_created)
