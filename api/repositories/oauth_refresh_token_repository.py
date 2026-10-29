"""SQLAlchemy persistence adapter for rotating OAuth refresh tokens."""

import secrets
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Row, and_, delete, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.oauth_bearer import sha256_hex
from models.oauth import OpenAPIOAuthRefreshToken
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


@dataclass(frozen=True)
class LiveRefreshToken:
    """A grant's newest usable refresh token."""

    id: str
    grant: GrantKey
    created_at: datetime
    expires_at: datetime


_GRANT_COLUMNS = (
    OpenAPIOAuthRefreshToken.subject_email,
    OpenAPIOAuthRefreshToken.subject_issuer,
    OpenAPIOAuthRefreshToken.client_id,
    OpenAPIOAuthRefreshToken.device_label,
)


def _refresh_grant_filter(grant: GrantKey) -> ColumnElement[bool]:
    return and_(
        OpenAPIOAuthRefreshToken.subject_email == grant.subject_email,
        OpenAPIOAuthRefreshToken.subject_issuer == grant.subject_issuer,
        OpenAPIOAuthRefreshToken.client_id == grant.client_id,
        OpenAPIOAuthRefreshToken.device_label == grant.device_label,
    )


def _grant_of(row: Row[Any]) -> GrantKey:
    return GrantKey(
        subject_email=row.subject_email,
        subject_issuer=row.subject_issuer,
        client_id=row.client_id,
        device_label=row.device_label,
    )


def new_refresh_token() -> str:
    return f"{REFRESH_TOKEN_PREFIX}{secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)}"


def insert_refresh_token(session: Session, *, grant: GrantKey, account_id: str, write: RefreshTokenWrite) -> None:
    session.add(
        OpenAPIOAuthRefreshToken(
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

    A rotated token stays valid until its successor is first used, so a client
    that lost a refresh response can retry without forking the login:

    - The current token is marked rotated, and the family's older rotated
      tokens go, except its parent, kept so reusing it is caught.
    - The most recently rotated token may be presented again while its
      successor is unused; that successor goes.

    So a family holds at most three rows. Raises ``RefreshTokenRejectedError``
    when the token is gone or expired, ``RefreshTokenReusedError`` for an older
    rotated token.
    """
    row = session.execute(
        select(OpenAPIOAuthRefreshToken.rotated_at)
        .where(OpenAPIOAuthRefreshToken.id == presented.id, OpenAPIOAuthRefreshToken.expires_at > now)
        .with_for_update()
    ).first()
    if row is None:
        raise RefreshTokenRejectedError
    family = OpenAPIOAuthRefreshToken.family_id == presented.family_id
    rotated = OpenAPIOAuthRefreshToken.rotated_at.is_not(None)
    latest_rotated = session.scalar(
        select(OpenAPIOAuthRefreshToken.id)
        .where(family, rotated)
        .order_by(OpenAPIOAuthRefreshToken.rotated_at.desc(), OpenAPIOAuthRefreshToken.id.desc())
        .limit(1)
    )
    if row.rotated_at is None:
        session.execute(
            delete(OpenAPIOAuthRefreshToken).where(family, rotated, OpenAPIOAuthRefreshToken.id != latest_rotated)
        )
        session.execute(
            update(OpenAPIOAuthRefreshToken).where(OpenAPIOAuthRefreshToken.id == presented.id).values(rotated_at=now)
        )
        return
    if latest_rotated != presented.id:
        raise RefreshTokenReusedError
    session.execute(delete(OpenAPIOAuthRefreshToken).where(family, OpenAPIOAuthRefreshToken.rotated_at.is_(None)))


def delete_refresh_grants(session: Session, grants: Collection[GrantKey], *, account_id: str) -> None:
    """Delete every refresh token the account holds for these grants, inside the caller's transaction.

    Scoped to the account: two accounts share a grant key when one reuses the
    other's old email.
    """
    if not grants:
        return
    session.execute(
        delete(OpenAPIOAuthRefreshToken).where(
            OpenAPIOAuthRefreshToken.account_id == account_id,
            or_(*(_refresh_grant_filter(grant) for grant in grants)),
        )
    )


def live_refresh_tokens(session: Session, *, account_id: str, now: datetime) -> dict[GrantKey, LiveRefreshToken]:
    """The account's grants holding a usable refresh token, each with its newest one."""
    rows = session.execute(
        select(
            OpenAPIOAuthRefreshToken.id,
            *_GRANT_COLUMNS,
            OpenAPIOAuthRefreshToken.created_at,
            OpenAPIOAuthRefreshToken.expires_at,
        )
        .where(
            OpenAPIOAuthRefreshToken.account_id == account_id,
            OpenAPIOAuthRefreshToken.rotated_at.is_(None),
            OpenAPIOAuthRefreshToken.expires_at > now,
        )
        .order_by(OpenAPIOAuthRefreshToken.created_at.asc(), OpenAPIOAuthRefreshToken.id.asc())
    )
    tokens = (
        LiveRefreshToken(id=row.id, grant=_grant_of(row), created_at=row.created_at, expires_at=row.expires_at)
        for row in rows
    )
    # Ascending order, so each grant keeps its newest token.
    return {token.grant: token for token in tokens}


def refresh_token_grant(session: Session, *, account_id: str, token_id: str) -> GrantKey | None:
    """The grant of one of the account's refresh tokens, found by its row id."""
    row = session.execute(
        select(*_GRANT_COLUMNS).where(
            OpenAPIOAuthRefreshToken.id == token_id, OpenAPIOAuthRefreshToken.account_id == account_id
        )
    ).first()
    if row is None:
        return None
    return _grant_of(row)


class SQLAlchemyOAuthRefreshTokenRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def find(self, token: str) -> RefreshTokenRecord | None:
        with self._session_factory() as session:
            row = session.scalar(
                select(OpenAPIOAuthRefreshToken).where(OpenAPIOAuthRefreshToken.token_hash == sha256_hex(token))
            )
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
