"""SQLAlchemy persistence for account-scoped OAuth access sessions."""

from __future__ import annotations

from datetime import datetime
from typing import override

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.oauth import OAuthAccessToken
from services.account_ports import AccountSessionRepository
from services.entities.account_access_entities import (
    AccountSessionRevocation,
    AccountSessionSnapshot,
)


class SQLAlchemyOAuthAccessTokenRepository(AccountSessionRepository):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def list_active(
        self,
        *,
        account_id: str,
        active_at: datetime,
        offset: int,
        limit: int,
    ) -> tuple[int, tuple[AccountSessionSnapshot, ...]]:
        predicates = (
            OAuthAccessToken.account_id == account_id,
            OAuthAccessToken.revoked_at.is_(None),
            OAuthAccessToken.token_hash.is_not(None),
            OAuthAccessToken.expires_at > active_at,
        )
        with self._session_factory() as session:
            total = session.scalar(select(func.count()).select_from(OAuthAccessToken).where(*predicates)) or 0
            rows = session.scalars(
                select(OAuthAccessToken)
                .where(*predicates)
                .order_by(OAuthAccessToken.created_at.desc(), OAuthAccessToken.id.desc())
                .offset(offset)
                .limit(limit)
            ).all()
            return int(total), tuple(self._to_snapshot(row) for row in rows)

    @override
    def revoke(
        self,
        *,
        account_id: str,
        token_id: str,
        revoked_at: datetime,
    ) -> AccountSessionRevocation:
        with self._session_factory.begin() as session:
            row = session.execute(
                select(OAuthAccessToken.account_id, OAuthAccessToken.token_hash)
                .where(OAuthAccessToken.id == token_id)
                .with_for_update()
            ).one_or_none()
            if row is None or row.account_id != account_id:
                return AccountSessionRevocation(owned=False)

            token_hash = row.token_hash
            if token_hash is not None:
                session.execute(
                    update(OAuthAccessToken)
                    .where(
                        OAuthAccessToken.id == token_id,
                        OAuthAccessToken.account_id == account_id,
                        OAuthAccessToken.revoked_at.is_(None),
                    )
                    .values(revoked_at=revoked_at, token_hash=None)
                )
            return AccountSessionRevocation(owned=True, token_hash=token_hash)

    @staticmethod
    def _to_snapshot(row: OAuthAccessToken) -> AccountSessionSnapshot:
        return AccountSessionSnapshot(
            id=str(row.id),
            prefix=row.prefix,
            client_id=row.client_id,
            device_label=row.device_label,
            created_at=row.created_at,
            last_used_at=row.last_used_at,
            expires_at=row.expires_at,
        )
