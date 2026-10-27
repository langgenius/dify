"""SQLAlchemy persistence adapter for OAuth device tokens and sessions."""

from __future__ import annotations

import logging
from collections.abc import Generator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import ColumnElement, Row, and_, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from models.account import Account
from models.oauth import OAuthAccessToken
from repositories.oauth_refresh_token_repository import delete_refresh_grants, live_refresh_grants
from services.oauth_device_contracts import (
    GrantKey,
    OAuthDeviceSession,
    OAuthDeviceSessionPage,
    OAuthDeviceTokenRotation,
    OAuthDeviceTokenWrite,
)

logger = logging.getLogger(__name__)

_GRANT_COLUMNS = (
    OAuthAccessToken.subject_email,
    OAuthAccessToken.subject_issuer,
    OAuthAccessToken.client_id,
    OAuthAccessToken.device_label,
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


def revoke_grant_rows(session: Session, grant: GrantKey, *, now: datetime) -> list[str]:
    """Revoke the grant's access rows and delete its refresh tokens in the caller's transaction.

    Returns the hashes to drop from the bearer cache. Rows revoked earlier lose
    their hash too, so ``rollback_rotation`` can never bring them back.
    """
    rows = session.execute(
        select(OAuthAccessToken.id, OAuthAccessToken.token_hash)
        .where(_grant_filter(grant), OAuthAccessToken.token_hash.is_not(None))
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
    delete_refresh_grants(session, (grant,))
    return [row.token_hash for row in rows]


@dataclass
class _LiveSession:
    last_used: datetime
    grant: GrantKey | None
    access_rows: list[Row[Any]] = field(default_factory=list)

    @property
    def eviction_order(self) -> tuple[datetime, str]:
        return self.last_used, min((str(row.id) for row in self.access_rows), default="")


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
                # Row locks on token rows cannot stop a concurrent insert, so the
                # account row serializes this account's logins for the cap check.
                session.execute(select(Account.id).where(Account.id == token.account_id).with_for_update())

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
            with self._undone_on_failure(rotation):
                self._redis.delete(*cache_keys)
        # Refresh rows are deleted, not flagged, so rollback_rotation cannot bring
        # them back. They go last, once the new row is committed and nothing else can fail.
        if eviction.grants:
            with self._undone_on_failure(rotation), self._session_factory() as session, session.begin():
                delete_refresh_grants(session, eviction.grants)
        return rotation

    @contextmanager
    def _undone_on_failure(self, rotation: OAuthDeviceTokenRotation) -> Generator[None]:
        try:
            yield
        except Exception:
            self.rollback_rotation(rotation)
            raise

    def _evict_over_cap(
        self,
        session: Session,
        *,
        token: OAuthDeviceTokenWrite,
        account_id: str,
        now: datetime,
    ) -> _Eviction:
        sessions = self._live_sessions(session, account_id=account_id, now=now)
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

    @staticmethod
    def _live_sessions(session: Session, *, account_id: str, now: datetime) -> dict[_SessionKey, _LiveSession]:
        """A session is a live access row or a live refresh token, one per grant.

        Its last use is the latest of its access row's last use (or creation) and
        its newest refresh token's issue time.
        """
        last_used = func.coalesce(OAuthAccessToken.last_used_at, OAuthAccessToken.created_at).label("last_used")
        access_rows = session.execute(
            select(OAuthAccessToken.id, OAuthAccessToken.token_hash, *_GRANT_COLUMNS, last_used)
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
        for grant, issued_at in live_refresh_grants(session, account_id=account_id, now=now).items():
            key = (grant.subject_email, grant.subject_issuer, grant.client_id, grant.device_label)
            live = sessions.setdefault(key, _LiveSession(last_used=issued_at, grant=grant))
            live.last_used = max(live.last_used, issued_at)
        return sessions

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
        now = datetime.now(UTC)
        filters = (
            OAuthAccessToken.account_id == account_id,
            OAuthAccessToken.revoked_at.is_(None),
            OAuthAccessToken.token_hash.is_not(None),
            OAuthAccessToken.expires_at > now,
        )
        with self._session_factory() as session:
            total = session.scalar(select(func.count()).select_from(OAuthAccessToken).where(*filters)) or 0
            records = session.scalars(
                select(OAuthAccessToken)
                .where(*filters)
                .order_by(OAuthAccessToken.created_at.desc())
                .offset((page - 1) * limit)
                .limit(limit)
            ).all()

        return OAuthDeviceSessionPage(
            page=page,
            limit=limit,
            total=total,
            items=tuple(
                OAuthDeviceSession(
                    id=record.id,
                    prefix=record.prefix,
                    client_id=record.client_id,
                    device_label=record.device_label,
                    created_at=record.created_at,
                    last_used_at=record.last_used_at,
                    expires_at=record.expires_at,
                )
                for record in records
            ),
        )

    def revoke_account_session(self, *, account_id: str, token_id: str) -> bool:
        """Revoke the session's whole grant: its access row and its refresh tokens."""
        now = datetime.now(UTC)
        with self._session_factory() as session:
            prior = session.execute(
                select(OAuthAccessToken.id, OAuthAccessToken.token_hash, *_GRANT_COLUMNS)
                .where(
                    OAuthAccessToken.id == token_id,
                    OAuthAccessToken.account_id == account_id,
                    OAuthAccessToken.revoked_at.is_(None),
                )
                .with_for_update()
            ).first()
            if prior is None:
                return False

            old_hashes = [prior.token_hash] if prior.token_hash else []
            session.execute(
                update(OAuthAccessToken)
                .where(
                    OAuthAccessToken.id == prior.id,
                    OAuthAccessToken.revoked_at.is_(None),
                )
                .values(revoked_at=now, token_hash=None)
            )
            grant = _grant_of(prior)
            if grant is not None:
                old_hashes.extend(revoke_grant_rows(session, grant, now=now))
            session.commit()

        if old_hashes:
            self._redis.delete(*(TOKEN_CACHE_KEY_FMT.format(hash=token_hash) for token_hash in old_hashes))
        return True
