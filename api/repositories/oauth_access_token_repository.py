"""SQLAlchemy persistence for account-scoped OAuth access sessions."""

from __future__ import annotations

from datetime import datetime
from typing import override

from sqlalchemy.orm import Session, sessionmaker

from repositories.oauth_device_token_repository import list_live_sessions, revoke_session_grant
from services.account_ports import AccountSessionRepository
from services.entities.account_access_entities import (
    AccountSessionRevocation,
    AccountSessionSnapshot,
)
from services.oauth_device_contracts import OAuthDeviceSession


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
        with self._session_factory() as session:
            sessions = list_live_sessions(session, account_id=account_id, now=active_at)
        return len(sessions), tuple(self._to_snapshot(item) for item in sessions[offset : offset + limit])

    @override
    def revoke(
        self,
        *,
        account_id: str,
        token_id: str,
        revoked_at: datetime,
    ) -> AccountSessionRevocation:
        with self._session_factory.begin() as session:
            hashes = revoke_session_grant(session, account_id=account_id, session_id=token_id, now=revoked_at)
        if hashes is None:
            return AccountSessionRevocation(owned=False)
        return AccountSessionRevocation(owned=True, token_hashes=tuple(hashes))

    @staticmethod
    def _to_snapshot(item: OAuthDeviceSession) -> AccountSessionSnapshot:
        return AccountSessionSnapshot(
            id=item.id,
            prefix=item.prefix,
            client_id=item.client_id,
            device_label=item.device_label,
            created_at=item.created_at,
            last_used_at=item.last_used_at,
            expires_at=item.expires_at,
        )
