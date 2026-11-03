"""Application service for the current account deletion lifecycle."""

import logging

from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError, InvalidAccountDeletionVerificationError
from services.account_ports import (
    AccountDeletionScheduler,
    AccountDeletionSyncGateway,
    AccountDeletionVerificationGateway,
    AccountDeletionVerificationNotifier,
    AccountRepository,
    AccountWorkspaceMembershipQuery,
)

logger = logging.getLogger(__name__)


class AccountDeletionService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        memberships: AccountWorkspaceMembershipQuery,
        verification: AccountDeletionVerificationGateway,
        notifications: AccountDeletionVerificationNotifier,
        synchronization: AccountDeletionSyncGateway,
        scheduler: AccountDeletionScheduler,
    ) -> None:
        self._accounts = accounts
        self._memberships = memberships
        self._verification = verification
        self._notifications = notifications
        self._synchronization = synchronization
        self._scheduler = scheduler

    def issue_verification(self, context: RequestContext) -> str:
        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError

        challenge = self._verification.create(account_id=account.id, email=account.email)
        self._notifications.send(email=account.email, code=challenge.code)
        return challenge.token

    def request_deletion(self, context: RequestContext, *, token: str, code: str) -> None:
        if not self._verification.verify(account_id=context.account_id, token=token, code=code):
            raise InvalidAccountDeletionVerificationError

        workspace_ids = tuple(self._memberships.list_ids_for_account(context.account_id))
        if not self._synchronization.sync(account_id=context.account_id, workspace_ids=workspace_ids):
            logger.warning(
                "Enterprise account deletion sync failed for account %s; proceeding with local deletion.",
                context.account_id,
            )
        self._scheduler.schedule(context.account_id)
