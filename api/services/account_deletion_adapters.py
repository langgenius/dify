"""Infrastructure adapters for the account deletion application service."""

import secrets
from collections.abc import Sequence
from typing import override

from libs.helper import RateLimiter, TokenManager
from services.account_errors import AccountDeletionRateLimitError
from services.account_ports import (
    AccountDeletionScheduler,
    AccountDeletionSyncGateway,
    AccountDeletionVerificationGateway,
    AccountDeletionVerificationNotifier,
)
from services.enterprise.account_deletion_sync import sync_account_deletion_memberships
from services.entities.account_entities import AccountDeletionChallenge
from tasks.delete_account_task import delete_account_task
from tasks.mail_account_deletion_task import send_account_deletion_verification_code


class TokenManagerAccountDeletionVerificationGateway(AccountDeletionVerificationGateway):
    @override
    def create(self, *, account_id: str, email: str) -> AccountDeletionChallenge:
        code = "".join(str(secrets.randbelow(exclusive_upper_bound=10)) for _ in range(6))
        token = TokenManager.generate_token(
            account_id=account_id,
            email=email,
            token_type="account_deletion",
            additional_data={"code": code},
        )
        return AccountDeletionChallenge(token=token, code=code)

    @override
    def verify(self, *, account_id: str, token: str, code: str) -> bool:
        token_data = TokenManager.get_token_data(token, "account_deletion")
        if token_data is None:
            return False
        return token_data.get("account_id") == account_id and token_data.get("code") == code


class CeleryAccountDeletionVerificationNotifier(AccountDeletionVerificationNotifier):
    def __init__(self, *, rate_limiter: RateLimiter) -> None:
        self._rate_limiter = rate_limiter

    @override
    def send(self, *, email: str, code: str) -> None:
        if self._rate_limiter.is_rate_limited(email):
            raise AccountDeletionRateLimitError(int(self._rate_limiter.time_window / 60))

        send_account_deletion_verification_code.delay(to=email, code=code)
        self._rate_limiter.increment_rate_limit(email)


class EnterpriseAccountDeletionSyncGateway(AccountDeletionSyncGateway):
    @override
    def sync(self, *, account_id: str, workspace_ids: Sequence[str]) -> bool:
        return sync_account_deletion_memberships(
            account_id=account_id,
            workspace_ids=workspace_ids,
            source="account_deleted",
        )


class CeleryAccountDeletionScheduler(AccountDeletionScheduler):
    @override
    def schedule(self, account_id: str) -> None:
        delete_account_task.delay(account_id)
