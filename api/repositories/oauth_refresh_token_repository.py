"""SQLAlchemy persistence adapter for rotating OAuth refresh tokens."""

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from itertools import starmap
from typing import cast

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.oauth_bearer import sha256_hex
from models.oauth import OAuthRefreshToken
from services.oauth_device_contracts import GrantKey

REFRESH_TOKEN_PREFIX = "dfor_"
_REFRESH_TOKEN_BYTES = 32


@dataclass(frozen=True)
class RefreshTokenRecord:
    id: str
    family_id: str
    subject_email: str
    subject_issuer: str
    account_id: str
    client_id: str
    device_label: str
    workspace_id: str | None
    expires_at: datetime
    rotated_at: datetime | None

    @property
    def grant_key(self) -> GrantKey:
        return GrantKey(
            subject_email=self.subject_email,
            subject_issuer=self.subject_issuer,
            client_id=self.client_id,
            device_label=self.device_label,
        )


class SQLAlchemyOAuthRefreshTokenRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def issue(
        self,
        *,
        grant: GrantKey,
        account_id: str,
        workspace_id: str | None,
        family_id: str | None,
        lifetime: timedelta,
    ) -> str:
        token = f"{REFRESH_TOKEN_PREFIX}{secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)}"
        row = OAuthRefreshToken(
            family_id=family_id or str(uuid.uuid4()),
            token_hash=sha256_hex(token),
            subject_email=grant.subject_email,
            subject_issuer=grant.subject_issuer,
            account_id=account_id,
            client_id=grant.client_id,
            device_label=grant.device_label,
            expires_at=datetime.now(UTC) + lifetime,
            workspace_id=workspace_id,
        )
        with self._session_factory() as session, session.begin():
            session.add(row)
        return token

    def find(self, token: str) -> RefreshTokenRecord | None:
        with self._session_factory() as session:
            row = session.scalar(select(OAuthRefreshToken).where(OAuthRefreshToken.token_hash == sha256_hex(token)))
            if row is None:
                return None
            return RefreshTokenRecord(
                id=row.id,
                family_id=row.family_id,
                subject_email=row.subject_email,
                subject_issuer=row.subject_issuer,
                account_id=row.account_id,
                client_id=row.client_id,
                device_label=row.device_label,
                workspace_id=row.workspace_id,
                expires_at=row.expires_at,
                rotated_at=row.rotated_at,
            )

    def rotate(self, record: RefreshTokenRecord) -> bool:
        with self._session_factory() as session, session.begin():
            result = session.execute(
                update(OAuthRefreshToken)
                .where(OAuthRefreshToken.id == record.id, OAuthRefreshToken.rotated_at.is_(None))
                .values(rotated_at=datetime.now(UTC))
            )
            return cast(CursorResult, result).rowcount == 1

    def revoke_family(self, family_id: str) -> None:
        with self._session_factory() as session, session.begin():
            session.execute(delete(OAuthRefreshToken).where(OAuthRefreshToken.family_id == family_id))

    def revoke_grant(self, grant: GrantKey) -> None:
        with self._session_factory() as session, session.begin():
            session.execute(
                delete(OAuthRefreshToken).where(
                    OAuthRefreshToken.subject_email == grant.subject_email,
                    OAuthRefreshToken.subject_issuer == grant.subject_issuer,
                    OAuthRefreshToken.client_id == grant.client_id,
                    OAuthRefreshToken.device_label == grant.device_label,
                )
            )

    def live_grant_keys(self, account_id: str) -> list[GrantKey]:
        stmt = (
            select(
                OAuthRefreshToken.subject_email,
                OAuthRefreshToken.subject_issuer,
                OAuthRefreshToken.client_id,
                OAuthRefreshToken.device_label,
            )
            .where(
                OAuthRefreshToken.account_id == account_id,
                OAuthRefreshToken.rotated_at.is_(None),
                OAuthRefreshToken.expires_at > datetime.now(UTC),
            )
            .distinct()
        )
        with self._session_factory() as session:
            return list(starmap(GrantKey, session.execute(stmt)))
