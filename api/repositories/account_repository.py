"""SQLAlchemy implementation of the account persistence port."""

from typing import override

from sqlalchemy.orm import Session

from models.account import Account
from services.account_ports import AccountRepository
from services.entities.account_entities import AccountProfileChanges, AccountSnapshot


class SQLAlchemyAccountRepository(AccountRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    @override
    def get(self, account_id: str) -> AccountSnapshot | None:
        account = self._session.get(Account, account_id)
        return self._to_snapshot(account) if account is not None else None

    @override
    def update_profile(self, account_id: str, changes: AccountProfileChanges) -> AccountSnapshot | None:
        account = self._session.get(Account, account_id)
        if account is None:
            return None

        if changes.name is not None:
            account.name = changes.name
        if changes.avatar is not None:
            account.avatar = changes.avatar
        if changes.interface_language is not None:
            account.interface_language = changes.interface_language
        if changes.interface_theme is not None:
            account.interface_theme = changes.interface_theme
        if changes.timezone is not None:
            account.timezone = changes.timezone

        self._session.flush()
        return self._to_snapshot(account)

    @staticmethod
    def _to_snapshot(account: Account) -> AccountSnapshot:
        return AccountSnapshot(
            id=account.id,
            name=account.name,
            email=account.email,
            avatar=account.avatar,
            is_password_set=account.is_password_set,
            interface_language=account.interface_language,
            interface_theme=account.interface_theme,
            timezone=account.timezone,
            last_login_at=account.last_login_at,
            last_login_ip=account.last_login_ip,
            status=account.status.value,
            initialized_at=account.initialized_at,
            created_at=account.created_at,
        )
