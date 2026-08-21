"""Persistence ports used by account application services."""

from typing import Protocol

from services.entities.account_entities import (
    AccountCredentials,
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


class AccountIntegrationRepository(Protocol):
    def list_for_account(self, account_id: str) -> list[AccountIntegrationSnapshot]: ...


class AccountAvatarFileGateway(Protocol):
    def get_owned_signed_url(self, *, account_id: str, upload_file_id: str) -> str | None: ...


class AccountPasswordHasher(Protocol):
    def verify(self, password: str, *, password_hash: str, password_salt: str) -> bool: ...

    def hash(self, password: str) -> AccountPasswordDigest: ...
