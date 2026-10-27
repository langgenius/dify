"""SQLAlchemy persistence adapter for OAuth device tokens and sessions."""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from operator import itemgetter
from typing import Any

from sqlalchemy import ColumnElement, Row, and_, func, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from models.account import Account
from models.oauth import OAuthAccessToken, OAuthRefreshToken
from repositories.oauth_refresh_token_repository import (
    REFRESH_TOKEN_PREFIX,
    LiveRefreshToken,
    delete_refresh_grants,
    insert_refresh_token,
    live_refresh_tokens,
    refresh_grant_filter,
    refresh_token_grant,
    spend_refresh_token,
)
from services.oauth_device_contracts import (
    GrantKey,
    OAuthDeviceSession,
    OAuthDeviceSessionPage,
    OAuthDeviceTokenRotation,
    OAuthDeviceTokenWrite,
    RefreshTokenWrite,
)

logger = logging.getLogger(__name__)

_GRANT_COLUMNS = (
    OAuthAccessToken.subject_email,
    OAuthAccessToken.subject_issuer,
    OAuthAccessToken.client_id,
    OAuthAccessToken.device_label,
)

_SESSION_COLUMNS = (
    OAuthAccessToken.id,
    OAuthAccessToken.token_hash,
    OAuthAccessToken.prefix,
    OAuthAccessToken.created_at,
    OAuthAccessToken.last_used_at,
    OAuthAccessToken.expires_at,
    *_GRANT_COLUMNS,
)

# (subject_email, subject_issuer, client_id, device_label). The raw columns, not
# GrantKey, because subject_issuer is nullable on the table.
type _SessionKey = tuple[str, str | None, str, str]


def _grant_of(row: Row[Any]) -> GrantKey | None:
    # The app writes subject_issuer on every row; a row without one names no grant.
    if row.subject_issuer is None:
        return None
    return GrantKey(
        subject_email=row.subject_email,
        subject_issuer=row.subject_issuer,
        client_id=row.client_id,
        device_label=row.device_label,
    )


def _grant_filter(grant: GrantKey) -> ColumnElement[bool]:
    return and_(
        OAuthAccessToken.subject_email == grant.subject_email,
        OAuthAccessToken.subject_issuer == grant.subject_issuer,
        OAuthAccessToken.client_id == grant.client_id,
        OAuthAccessToken.device_label == grant.device_label,
    )


def lock_account(session: Session, account_id: str) -> None:
    """Take the account's row lock, the mutex for its logins, refreshes, revocations and session cap.

    Row locks on token rows cannot stop a concurrent insert, so the account row
    serializes them. Every path locks the account row first, then access rows,
    then refresh rows.
    """
    session.execute(select(Account.id).where(Account.id == account_id).with_for_update())


def grant_account_id(session: Session, grant: GrantKey) -> str | None:
    """The account behind a grant, or None for an external-SSO grant. Read without a lock: it never changes."""
    account_id = session.scalar(
        select(OAuthAccessToken.account_id)
        .where(_grant_filter(grant), OAuthAccessToken.account_id.is_not(None))
        .limit(1)
    )
    if account_id is not None:
        return account_id
    return session.scalar(select(OAuthRefreshToken.account_id).where(refresh_grant_filter(grant)).limit(1))


def find_live_access_grant(session: Session, token_hash: str) -> GrantKey | None:
    row = session.execute(
        select(*_GRANT_COLUMNS).where(
            OAuthAccessToken.token_hash == token_hash,
            OAuthAccessToken.revoked_at.is_(None),
        )
    ).first()
    if row is None:
        return None
    return _grant_of(row)


def _revoke_access_rows(session: Session, rows_filter: ColumnElement[bool], *, now: datetime) -> list[str]:
    """Revoke the matching access rows and return their hashes. Rows revoked earlier lose
    their hash too, so ``rollback_rotation`` can never bring them back.
    """
    rows = session.execute(
        select(OAuthAccessToken.id, OAuthAccessToken.token_hash)
        .where(rows_filter, OAuthAccessToken.token_hash.is_not(None))
        .with_for_update()
    ).all()
    if rows:
        ids = [row.id for row in rows]
        session.execute(
            update(OAuthAccessToken)
            .where(OAuthAccessToken.id.in_(ids), OAuthAccessToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        session.execute(update(OAuthAccessToken).where(OAuthAccessToken.id.in_(ids)).values(token_hash=None))
    return [row.token_hash for row in rows]


def revoke_grant_rows(session: Session, grant: GrantKey, *, now: datetime) -> list[str]:
    """Revoke the grant's access rows and delete its refresh tokens in the caller's transaction.

    Returns the hashes to drop from the bearer cache.
    """
    hashes = _revoke_access_rows(session, _grant_filter(grant), now=now)
    delete_refresh_grants(session, (grant,))
    return hashes


def revoke_session_grant(session: Session, *, account_id: str, session_id: str, now: datetime) -> list[str] | None:
    """Revoke the whole grant of a listed session in the caller's transaction, under the account lock.

    ``session_id`` is an access row id, or a refresh token id for a session whose
    access rows are gone (see ``list_live_sessions``). Returns the hashes to drop
    from the bearer cache, or None when the account has no such session.
    """
    lock_account(session, account_id)
    access = session.execute(
        select(*_GRANT_COLUMNS).where(OAuthAccessToken.id == session_id, OAuthAccessToken.account_id == account_id)
    ).first()
    if access is not None:
        grant = _grant_of(access)
        if grant is None:
            return _revoke_access_rows(session, OAuthAccessToken.id == session_id, now=now)
        return revoke_grant_rows(session, grant, now=now)
    grant = refresh_token_grant(session, account_id=account_id, token_id=session_id)
    if grant is None:
        return None
    return revoke_grant_rows(session, grant, now=now)


def _write_refresh(
    session: Session, token: OAuthDeviceTokenWrite, refresh: RefreshTokenWrite, *, now: datetime
) -> None:
    if token.account_id is None:
        raise ValueError("refresh tokens are issued with account tokens only")
    # A raise here rolls back the whole rotation: a revoked or reused token issues nothing.
    if refresh.presented is not None:
        spend_refresh_token(session, refresh.presented, now=now)
    insert_refresh_token(
        session,
        grant=GrantKey(
            subject_email=token.subject_email,
            subject_issuer=token.subject_issuer,
            client_id=token.client_id,
            device_label=token.device_label,
        ),
        account_id=token.account_id,
        write=refresh,
    )


@dataclass
class _LiveSession:
    last_used: datetime
    grant: GrantKey | None
    access_rows: list[Row[Any]] = field(default_factory=list)
    refresh: LiveRefreshToken | None = None

    @property
    def eviction_order(self) -> tuple[datetime, str]:
        return self.last_used, min((str(row.id) for row in self.access_rows), default="")


def _live_sessions(session: Session, *, account_id: str, now: datetime) -> dict[_SessionKey, _LiveSession]:
    """The account's sessions the cap counts: a live access row or a live refresh token, one per grant.

    Its last use is the latest of its access row's last use (or creation) and
    its newest refresh token's issue time.
    """
    last_used = func.coalesce(OAuthAccessToken.last_used_at, OAuthAccessToken.created_at).label("last_used")
    access_rows = session.execute(
        select(*_SESSION_COLUMNS, last_used)
        .where(
            OAuthAccessToken.account_id == account_id,
            OAuthAccessToken.revoked_at.is_(None),
            OAuthAccessToken.expires_at > now,
        )
        .order_by(last_used.asc(), OAuthAccessToken.id.asc())
    ).all()
    sessions: dict[_SessionKey, _LiveSession] = {}
    for row in access_rows:
        key = (row.subject_email, row.subject_issuer, row.client_id, row.device_label)
        live = sessions.setdefault(key, _LiveSession(last_used=row.last_used, grant=_grant_of(row)))
        live.access_rows.append(row)
        live.last_used = max(live.last_used, row.last_used)
    for grant, refresh in live_refresh_tokens(session, account_id=account_id, now=now).items():
        key = (grant.subject_email, grant.subject_issuer, grant.client_id, grant.device_label)
        live = sessions.setdefault(key, _LiveSession(last_used=refresh.created_at, grant=grant))
        live.refresh = refresh
        live.last_used = max(live.last_used, refresh.created_at)
    return sessions


def _latest_access_rows(session: Session, *, account_id: str, grants: Sequence[GrantKey]) -> dict[GrantKey, Row[Any]]:
    if not grants:
        return {}
    rows = session.execute(
        select(*_SESSION_COLUMNS)
        .where(OAuthAccessToken.account_id == account_id, or_(*(_grant_filter(grant) for grant in grants)))
        .order_by(OAuthAccessToken.created_at.asc(), OAuthAccessToken.id.asc())
    )
    # Ascending order, so each grant keeps its newest row.
    return {grant: row for row in rows if (grant := _grant_of(row)) is not None}


def _access_session(row: Row[Any]) -> OAuthDeviceSession:
    return OAuthDeviceSession(
        id=str(row.id),
        prefix=row.prefix,
        client_id=row.client_id,
        device_label=row.device_label,
        created_at=row.created_at,
        last_used_at=row.last_used_at,
        expires_at=row.expires_at,
    )


def _refresh_session(refresh: LiveRefreshToken) -> OAuthDeviceSession:
    # A refresh token records no use of its own.
    return OAuthDeviceSession(
        id=refresh.id,
        prefix=REFRESH_TOKEN_PREFIX,
        client_id=refresh.grant.client_id,
        device_label=refresh.grant.device_label,
        created_at=refresh.created_at,
        last_used_at=None,
        expires_at=refresh.expires_at,
    )


def list_live_sessions(session: Session, *, account_id: str, now: datetime) -> list[OAuthDeviceSession]:
    """The sessions the cap counts, newest first, each shown by its newest live access row.

    A session kept alive only by its refresh token is shown by its grant's newest
    access row, expired or revoked; when that is gone too, by the refresh token
    itself. Every id shown here is one ``revoke_session_grant`` accepts.
    """
    sessions = list(_live_sessions(session, account_id=account_id, now=now).values())
    refresh_only = [live.grant for live in sessions if not live.access_rows and live.grant is not None]
    latest = _latest_access_rows(session, account_id=account_id, grants=refresh_only)
    shown: list[tuple[datetime, str, OAuthDeviceSession]] = []
    for live in sessions:
        row = max(live.access_rows, key=lambda access: access.created_at, default=None)
        if row is None and live.grant is not None:
            row = latest.get(live.grant)
        if row is not None:
            shown.append((row.created_at, str(row.id), _access_session(row)))
        elif live.refresh is not None:
            shown.append((live.refresh.created_at, live.refresh.id, _refresh_session(live.refresh)))
    shown.sort(key=itemgetter(0, 1), reverse=True)
    return [item for _created_at, _id, item in shown]


@dataclass(frozen=True)
class _Eviction:
    access_rows: Sequence[Row[Any]] = ()
    grants: tuple[GrantKey, ...] = ()


@dataclass(frozen=True, slots=True)
class _TokenRowValues:
    """The columns a rotation overwrites when it reuses a device's row.

    The id is overwritten too, so every login keeps its own token id: an old
    id held by a hint, an audit log or an in-flight hard-expire never matches
    the new login.
    """

    id: str
    token_hash: str | None
    prefix: str
    account_id: str | None
    expires_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime

    @classmethod
    def of(cls, record: OAuthAccessToken) -> _TokenRowValues:
        return cls(
            id=record.id,
            token_hash=record.token_hash,
            prefix=record.prefix,
            account_id=record.account_id,
            expires_at=record.expires_at,
            revoked_at=record.revoked_at,
            last_used_at=record.last_used_at,
            created_at=record.created_at,
        )

    def apply_to(self, record: OAuthAccessToken) -> None:
        record.id = self.id
        record.token_hash = self.token_hash
        record.prefix = self.prefix
        record.account_id = self.account_id
        record.expires_at = self.expires_at
        record.revoked_at = self.revoked_at
        record.last_used_at = self.last_used_at
        record.created_at = self.created_at


class SQLAlchemyOAuthDeviceTokenRepository:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        redis: RedisClientWrapper,
        max_sessions_per_account: int,
    ) -> None:
        self._session_factory = session_factory
        self._redis = redis
        self._max_sessions_per_account = max_sessions_per_account

    def rotate_token(self, token: OAuthDeviceTokenWrite) -> OAuthDeviceTokenRotation:
        now = datetime.now(UTC)
        eviction = _Eviction()
        with self._session_factory() as session:
            if token.account_id is not None:
                lock_account(session, token.account_id)

            prior = session.execute(
                select(OAuthAccessToken.id, OAuthAccessToken.token_hash)
                .where(
                    OAuthAccessToken.subject_email == token.subject_email,
                    OAuthAccessToken.subject_issuer == token.subject_issuer,
                    OAuthAccessToken.client_id == token.client_id,
                    OAuthAccessToken.device_label == token.device_label,
                )
                .order_by(OAuthAccessToken.revoked_at.is_not(None))
                .limit(1)
                .with_for_update()
            ).first()
            if prior is not None:
                session.execute(update(OAuthAccessToken).where(OAuthAccessToken.id == prior.id).values(revoked_at=now))

            if token.account_id is not None:
                eviction = self._evict_over_cap(session, token=token, account_id=token.account_id, now=now)

            record = OAuthAccessToken(
                subject_email=token.subject_email,
                subject_issuer=token.subject_issuer,
                account_id=token.account_id,
                client_id=token.client_id,
                device_label=token.device_label,
                prefix=token.prefix,
                token_hash=token.token_hash,
                expires_at=token.expires_at,
            )
            if record is None:
                record = OAuthAccessToken(
                    subject_email=token.subject_email,
                    subject_issuer=token.subject_issuer,
                    account_id=token.account_id,
                    client_id=token.client_id,
                    device_label=token.device_label,
                    prefix=token.prefix,
                    token_hash=token.token_hash,
                    expires_at=token.expires_at,
                )
                session.add(record)
            else:
                previous = _TokenRowValues.of(record)
                _TokenRowValues(
                    id=str(uuidv7()),
                    token_hash=token.token_hash,
                    prefix=token.prefix,
                    account_id=token.account_id,
                    expires_at=token.expires_at,
                    revoked_at=None,
                    last_used_at=None,
                    created_at=datetime.now(UTC),
                ).apply_to(record)
            session.flush()
            token_id = record.id
            # Refresh rows go last, in lock order. The evicted grants' refresh tokens
            # are deleted in this transaction, so a refresh waiting on the account
            # lock can never revive them; rollback_rotation cannot bring them back.
            delete_refresh_grants(session, eviction.grants)
            if token.refresh is not None:
                _write_refresh(session, token, token.refresh, now=now)
            session.commit()

        replaced = previous if previous is not None and previous.revoked_at is None else None
        rotation = OAuthDeviceTokenRotation(
            token_id=token_id,
            replaced_token_id=str(prior.id) if prior is not None else None,
            replaced_token_hash=prior.token_hash if prior is not None else None,
            evicted_token_ids=tuple(str(row.id) for row in eviction.access_rows),
            evicted_token_hashes=tuple(row.token_hash for row in eviction.access_rows if row.token_hash),
        )
        cache_keys = [
            TOKEN_CACHE_KEY_FMT.format(hash=token_hash)
            for token_hash in (rotation.replaced_token_hash, *rotation.evicted_token_hashes)
            if token_hash
        ]
        if cache_keys:
            try:
                self._redis.delete(*cache_keys)
            except Exception:
                self.rollback_rotation(rotation)
                raise
        return rotation

    def _evict_over_cap(
        self,
        session: Session,
        *,
        token: OAuthDeviceTokenWrite,
        account_id: str,
        now: datetime,
    ) -> _Eviction:
        sessions = _live_sessions(session, account_id=account_id, now=now)
        # A refresh of an existing grant reuses its slot.
        sessions.pop((token.subject_email, token.subject_issuer, token.client_id, token.device_label), None)
        # The row about to be inserted takes one of the slots.
        overflow = len(sessions) + 1 - self._max_sessions_per_account
        if overflow <= 0:
            return _Eviction()

        evicted = sorted(sessions.values(), key=lambda live: live.eviction_order)[:overflow]
        access_rows = [row for live in evicted for row in live.access_rows]
        if access_rows:
            # The hash stays so rollback_rotation can restore the row.
            session.execute(
                update(OAuthAccessToken)
                .where(OAuthAccessToken.id.in_([row.id for row in access_rows]))
                .values(revoked_at=now)
            )
        return _Eviction(
            access_rows=access_rows,
            grants=tuple(live.grant for live in evicted if live.grant is not None),
        )

    def rollback_rotation(self, rotation: OAuthDeviceTokenRotation) -> bool:
        new_hash: str | None = None
        with self._session_factory() as session:
            record = session.scalar(
                select(OAuthAccessToken)
                .where(
                    OAuthAccessToken.id == rotation.token_id,
                    OAuthAccessToken.token_hash == new_hash,
                )
                .with_for_update()
            )
            # A later successful rotation already superseded this token. In
            # that case restoring its predecessor would create two live rows.
            if current is None:
                return False

            new_hash = current.token_hash
            session.delete(current)
            session.flush()
            if rotation.replaced_token_id is not None:
                predecessor = session.scalar(
                    select(OAuthAccessToken)
                    .where(
                        OAuthAccessToken.id == rotation.replaced_token_id,
                        OAuthAccessToken.revoked_at.is_not(None),
                    )
                    .with_for_update()
                )
                if predecessor is None:
                    raise RuntimeError("OAuth token rotation predecessor could not be restored")
                predecessor.revoked_at = None
            if rotation.evicted_token_ids:
                # A row whose hash was cleared was revoked by the user since; keep it revoked.
                session.execute(
                    update(OAuthAccessToken)
                    .where(
                        OAuthAccessToken.id.in_(rotation.evicted_token_ids),
                        OAuthAccessToken.revoked_at.is_not(None),
                        OAuthAccessToken.token_hash.is_not(None),
                    )
                    .values(revoked_at=None)
                )
            session.commit()

        cache_keys = [
            TOKEN_CACHE_KEY_FMT.format(hash=token_hash)
            for token_hash in (new_hash, rotation.replaced_token_hash, *rotation.evicted_token_hashes)
            if token_hash
        ]
        try:
            self._redis.delete(*cache_keys)
        except Exception:
            logger.exception("failed to invalidate rolled-back OAuth token caches")

    def list_account_sessions(
        self,
        *,
        account_id: str,
        page: int,
        limit: int,
    ) -> OAuthDeviceSessionPage:
        with self._session_factory() as session:
            sessions = list_live_sessions(session, account_id=account_id, now=datetime.now(UTC))
        offset = (page - 1) * limit
        return OAuthDeviceSessionPage(
            page=page,
            limit=limit,
            total=len(sessions),
            items=tuple(sessions[offset : offset + limit]),
        )

    def revoke_account_session(self, *, account_id: str, token_id: str) -> bool:
        """Revoke the session's whole grant: its access rows and its refresh tokens."""
        with self._session_factory() as session:
            hashes = revoke_session_grant(session, account_id=account_id, session_id=token_id, now=datetime.now(UTC))
            session.commit()
        if hashes:
            self._redis.delete(*(TOKEN_CACHE_KEY_FMT.format(hash=token_hash) for token_hash in hashes))
        return hashes is not None
