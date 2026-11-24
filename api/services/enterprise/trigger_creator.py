"""Resolve Enterprise trigger attribution from Dify's persisted ownership chain."""

from typing import Literal

from sqlalchemy import case, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, TenantAccountJoin, TenantAccountRole
from models.enums import CreatorUserRole, EndUserType
from models.model import App, EndUser
from models.trigger import TriggerSubscription
from services.account_errors import AccountNotFoundError
from services.app_scoped_end_user_service import AppScopedEndUserService
from services.workflow.entities import TriggerActor


class TriggerCreatorService:
    def __init__(self, *, sessions: sessionmaker[Session], end_users: AppScopedEndUserService[EndUser]) -> None:
        self._sessions = sessions
        self._end_users = end_users

    def resolve(
        self,
        *,
        tenant_id: str,
        app_id: str,
        trigger_type: Literal["trigger-schedule", "trigger-webhook", "trigger-plugin"],
        subscription_id: str,
    ) -> TriggerActor:
        """Validate app ownership, then return an account or app-scoped TRIGGER actor.

        Schedule requires a tenant owner/admin account. Plugin requires a tenant-owned
        subscription and falls back to its creator when end-user provisioning fails.
        Webhook provisioning errors propagate. No actor is returned for an unknown app.
        """
        with self._sessions() as session:
            app = session.scalar(select(App.id).where(App.id == app_id, App.tenant_id == tenant_id))
            if app is None:
                raise LookupError("App not found")
            if trigger_type == "trigger-schedule":
                account_id = session.scalar(
                    select(Account.id)
                    .join(TenantAccountJoin, TenantAccountJoin.account_id == Account.id)
                    .where(
                        TenantAccountJoin.tenant_id == tenant_id,
                        TenantAccountJoin.role.in_([TenantAccountRole.OWNER, TenantAccountRole.ADMIN]),
                    )
                    .order_by(case((TenantAccountJoin.role == TenantAccountRole.OWNER, 0), else_=1))
                    .limit(1)
                )
                if account_id is None:
                    raise AccountNotFoundError(f"Account not found for tenant: {tenant_id}")
                return TriggerActor(id=account_id, role=CreatorUserRole.ACCOUNT)
            subscription_user_id = None
            if trigger_type == "trigger-plugin":
                subscription_user_id = session.scalar(
                    select(TriggerSubscription.user_id).where(
                        TriggerSubscription.id == subscription_id, TriggerSubscription.tenant_id == tenant_id
                    )
                )
                if subscription_user_id is None:
                    raise LookupError("Trigger subscription not found")

        try:
            end_user = self._end_users.get_or_create_end_user_by_type(
                type=EndUserType.TRIGGER, tenant_id=tenant_id, app_id=app_id, user_id=None
            )
            return TriggerActor(id=end_user.id, role=CreatorUserRole.END_USER)
        except Exception:
            if subscription_user_id is None:
                raise
            return TriggerActor(id=subscription_user_id, role=CreatorUserRole.ACCOUNT)
