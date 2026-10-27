"""SQLAlchemy persistence adapter for rotating OAuth refresh tokens."""

import secrets
import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.oauth_bearer import sha256_hex
from models.oauth import OAuthRefreshToken
from services.oauth_device_contracts import (
    GrantKey,
    PresentedRefreshToken,
    RefreshTokenRejectedError,
    RefreshTokenReusedError,
    RefreshTokenWrite,
)

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


_GRANT_COLUMNS = (
    OAuthRefreshToken.subject_email,
    OAuthRefreshToken.subject_issuer,
    OAuthRefreshToken.client_id,
    OAuthRefreshToken.device_label,
)


def new_refresh_token() -> str:
    return f"{REFRESH_TOKEN_PREFIX}{secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)}"


def insert_refresh_token(session: Session, *, grant: GrantKey, account_id: str, write: RefreshTokenWrite) -> None:
    session.add(
        OAuthRefreshToken(
            family_id=write.family_id,
            token_hash=write.token_hash,
            subject_email=grant.subject_email,
            subject_issuer=grant.subject_issuer,
            account_id=account_id,
            client_id=grant.client_id,
            device_label=grant.device_label,
            expires_at=write.expires_at,
            workspace_id=write.workspace_id,
        )
    )


def spend_refresh_token(session: Session, presented: PresentedRefreshToken, *, now: datetime) -> None:
    """Spend the presented token in the caller's transaction, which holds the account lock.

    A fresh token is marked rotated. A rotated one passes only inside the replay
    grace, and is left as it is. Raises ``RefreshTokenRejectedError`` when the
    token is gone or expired, ``RefreshTokenReusedError`` past the grace.
    """
    row = session.execute(
        select(OAuthRefreshToken.rotated_at)
        .where(OAuthRefreshToken.id == presented.id, OAuthRefreshToken.expires_at > now)
        .with_for_update()
    ).first()
    if row is None:
        raise RefreshTokenRejectedError
    if row.rotated_at is None:
        session.execute(update(OAuthRefreshToken).where(OAuthRefreshToken.id == presented.id).values(rotated_at=now))
        return
    if not presented.may_replay(rotated_at=row.rotated_at, now=now):
        raise RefreshTokenReusedError


def delete_refresh_grants(session: Session, grants: Collection[GrantKey]) -> None:
    """Delete every refresh token of these grants inside the caller's transaction."""
    if not grants:
        return
    session.execute(
        delete(OAuthRefreshToken).where(
            or_(
                *(
                    and_(
                        OAuthRefreshToken.subject_email == grant.subject_email,
                        OAuthRefreshToken.subject_issuer == grant.subject_issuer,
                        OAuthRefreshToken.client_id == grant.client_id,
                        OAuthRefreshToken.device_label == grant.device_label,
                    )
                    for grant in grants
                )
            )
        )
    )


def live_refresh_grants(session: Session, *, account_id: str, now: datetime) -> dict[GrantKey, datetime]:
    """The account's grants holding a usable refresh token, each with its newest token's issue time."""
    stmt = (
        select(*_GRANT_COLUMNS, func.max(OAuthRefreshToken.created_at).label("issued_at"))
        .where(
            OAuthRefreshToken.account_id == account_id,
            OAuthRefreshToken.rotated_at.is_(None),
            OAuthRefreshToken.expires_at > now,
        )
        .group_by(*_GRANT_COLUMNS)
    )
    return {
        GrantKey(
            subject_email=row.subject_email,
            subject_issuer=row.subject_issuer,
            client_id=row.client_id,
            device_label=row.device_label,
        ): row.issued_at
        for row in session.execute(stmt)
    }


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
        token = new_refresh_token()
        write = RefreshTokenWrite(
            token_hash=sha256_hex(token),
            family_id=family_id or str(uuid.uuid4()),
            workspace_id=workspace_id,
            expires_at=datetime.now(UTC) + lifetime,
            presented=None,
        )
        with self._session_factory() as session, session.begin():
            insert_refresh_token(session, grant=grant, account_id=account_id, write=write)
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
