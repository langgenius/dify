"""Persistence ports used by account application services."""

from collections.abc import Sequence
from typing import Protocol

from services.entities.account_entities import (
    AccountCredentials,
    AccountDeletionChallenge,
    AccountEmailResetResult,
    AccountInitialization,
    AccountInitializationResult,
    AccountIntegrationSnapshot,
    AccountPasswordDigest,
    AccountProfileChanges,
    AccountSnapshot,
)


class AccountRepository(Protocol):
    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def get_credentials(self, account_id: str) -> AccountCredentials | None: ...

    def update_profile(self, account_id: str, changes: AccountProfileChanges) -> AccountSnapshot | None: ...

    def update_password(self, account_id: str, password: AccountPasswordDigest) -> AccountSnapshot | None: ...

    def initialize(
        self,
        account_id: str,
        initialization: AccountInitialization,
        *,
        invitation_code: str | None,
        workspace_id: str | None,
    ) -> AccountInitializationResult: ...

    def email_exists(self, email: str) -> bool: ...

    def reset_email(self, account_id: str, *, expected_old_email: str, new_email: str) -> AccountEmailResetResult: ...


class AccountIntegrationRepository(Protocol):
    def list_for_account(self, account_id: str) -> list[AccountIntegrationSnapshot]: ...


class AccountWorkspaceMembershipQuery(Protocol):
    def list_ids_for_account(self, account_id: str) -> Sequence[str]: ...


class AccountAvatarFileGateway(Protocol):
    def get_owned_signed_url(self, *, account_id: str, upload_file_id: str) -> str | None: ...


class AccountPasswordHasher(Protocol):
    def verify(self, password: str, *, password_hash: str, password_salt: str) -> bool: ...

    def hash(self, password: str) -> AccountPasswordDigest: ...


class AccountDeletionVerificationGateway(Protocol):
    def create(self, *, account_id: str, email: str) -> AccountDeletionChallenge: ...

    def verify(self, *, account_id: str, token: str, code: str) -> bool: ...


class AccountDeletionVerificationNotifier(Protocol):
    def send(self, *, email: str, code: str) -> None: ...


class AccountDeletionSyncGateway(Protocol):
    def sync(self, *, account_id: str, workspace_ids: Sequence[str]) -> bool: ...


class AccountDeletionScheduler(Protocol):
    def schedule(self, account_id: str) -> None: ...
