"""SQLAlchemy implementation of the account integration persistence port."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import AccountIntegrate
from services.account_ports import AccountIntegrationRepository
from services.entities.account_entities import AccountIntegrationSnapshot


class SQLAlchemyAccountIntegrationRepository(AccountIntegrationRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def find_account_id(self, *, provider: str, open_id: str) -> str | None:
        with self._session_factory() as session:
            return session.scalar(
                select(AccountIntegrate.account_id)
                .where(AccountIntegrate.provider == provider, AccountIntegrate.open_id == open_id)
                .limit(1)
            )

    @override
    def list_for_account(self, account_id: str) -> list[AccountIntegrationSnapshot]:
        with self._session_factory() as session:
            rows = session.execute(
                select(AccountIntegrate.provider, AccountIntegrate.created_at).where(
                    AccountIntegrate.account_id == account_id
                )
            ).all()
            return [AccountIntegrationSnapshot(provider=row.provider, created_at=row.created_at) for row in rows]

    @override
    def link(self, account_id: str, *, provider: str, open_id: str) -> None:
        with self._session_factory.begin() as session:
            integration = session.scalar(
                select(AccountIntegrate)
                .where(
                    AccountIntegrate.account_id == account_id,
                    AccountIntegrate.provider == provider,
                )
                .limit(1)
            )
            if integration is None:
                session.add(
                    AccountIntegrate(
                        account_id=account_id,
                        provider=provider,
                        open_id=open_id,
                        encrypted_token="",
                    )
                )
                return
            integration.open_id = open_id
            integration.encrypted_token = ""
