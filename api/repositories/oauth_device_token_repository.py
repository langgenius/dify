"""SQLAlchemy persistence adapter for OAuth device tokens and sessions."""

from __future__ import annotations

import logging
from dataclasses import dataclass, fields
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, sessionmaker

from constants.oauth_bearer import TOKEN_CACHE_KEY_FMT
from extensions.ext_redis import RedisClientWrapper
from models.oauth import OAuthAccessToken
from services.oauth_device_contracts import (
    OAuthDeviceSession,
    OAuthDeviceSessionPage,
    OAuthDeviceTokenRotation,
    OAuthDeviceTokenWrite,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class _TokenRowValues:
    """The columns a rotation overwrites when it reuses a device's row."""

    token_hash: str | None
    prefix: str
    account_id: str | None
    expires_at: datetime
    revoked_at: datetime | None
    last_used_at: datetime | None
    created_at: datetime

    @classmethod
    def of(cls, record: OAuthAccessToken) -> _TokenRowValues:
        return cls(**{value_field.name: getattr(record, value_field.name) for value_field in fields(cls)})

    def apply_to(self, record: OAuthAccessToken) -> None:
        for value_field in fields(self):
            setattr(record, value_field.name, getattr(self, value_field.name))


class SQLAlchemyOAuthDeviceTokenRepository:
    def __init__(self, *, session_factory: sessionmaker[Session], redis: RedisClientWrapper) -> None:
        self._session_factory = session_factory
        self._redis = redis

    def rotate_token(self, token: OAuthDeviceTokenWrite) -> OAuthDeviceTokenRotation:
        # MySQL drops the index's WHERE revoked_at IS NULL, so a revoked row on
        # the same device key would collide with a new insert. Reuse the row.
        previous: _TokenRowValues | None = None
        with self._session_factory() as session:
            record = session.scalar(
                select(OAuthAccessToken)
                .where(
                    OAuthAccessToken.subject_email == token.subject_email,
                    OAuthAccessToken.subject_issuer == token.subject_issuer,
                    OAuthAccessToken.client_id == token.client_id,
                    OAuthAccessToken.device_label == token.device_label,
                )
                .order_by(OAuthAccessToken.revoked_at.is_not(None))
                .limit(1)
                .with_for_update()
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
            replaced_token_id=token_id if replaced is not None else None,
            replaced_token_hash=replaced.token_hash if replaced is not None else None,
        )
        if rotation.replaced_token_hash:
            try:
                self._redis.delete(TOKEN_CACHE_KEY_FMT.format(hash=rotation.replaced_token_hash))
            except Exception:
                self._rollback_rotation(rotation, new_hash=token.token_hash, previous=previous)
                raise
        return rotation

    def _rollback_rotation(
        self,
        rotation: OAuthDeviceTokenRotation,
        *,
        new_hash: str,
        previous: _TokenRowValues | None,
    ) -> None:
        with self._session_factory() as session:
            record = session.scalar(
                select(OAuthAccessToken)
                .where(
                    OAuthAccessToken.id == rotation.token_id,
                    OAuthAccessToken.token_hash == new_hash,
                )
                .with_for_update()
            )
            # A later rotation already replaced this token; leave its row alone.
            if record is not None:
                if previous is None:
                    session.delete(record)
                else:
                    previous.apply_to(record)
                session.commit()

        cache_keys = [
            TOKEN_CACHE_KEY_FMT.format(hash=token_hash)
            for token_hash in (new_hash, rotation.replaced_token_hash)
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
        old_hash: str | None
        with self._session_factory() as session:
            prior = session.execute(
                select(OAuthAccessToken.id, OAuthAccessToken.token_hash)
                .where(
                    OAuthAccessToken.id == token_id,
                    OAuthAccessToken.account_id == account_id,
                    OAuthAccessToken.revoked_at.is_(None),
                )
                .with_for_update()
            ).first()
            if prior is None:
                return False

            old_hash = prior.token_hash
            session.execute(
                update(OAuthAccessToken)
                .where(
                    OAuthAccessToken.id == prior.id,
                    OAuthAccessToken.revoked_at.is_(None),
                )
                .values(revoked_at=datetime.now(UTC), token_hash=None)
            )
            session.commit()

        if old_hash:
            self._redis.delete(TOKEN_CACHE_KEY_FMT.format(hash=old_hash))
        return True
