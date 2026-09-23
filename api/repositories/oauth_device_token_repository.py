"""SQLAlchemy persistence adapter for OAuth device tokens and sessions."""

import logging
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


class SQLAlchemyOAuthDeviceTokenRepository:
    def __init__(self, *, session_factory: sessionmaker[Session], redis: RedisClientWrapper) -> None:
        self._session_factory = session_factory
        self._redis = redis

    def rotate_token(self, token: OAuthDeviceTokenWrite) -> OAuthDeviceTokenRotation:
        old_hash: str | None = None
        replaced_token_id: str | None = None
        with self._session_factory() as session:
            prior = session.execute(
                select(OAuthAccessToken.id, OAuthAccessToken.token_hash)
                .where(
                    OAuthAccessToken.subject_email == token.subject_email,
                    OAuthAccessToken.subject_issuer == token.subject_issuer,
                    OAuthAccessToken.client_id == token.client_id,
                    OAuthAccessToken.device_label == token.device_label,
                    OAuthAccessToken.revoked_at.is_(None),
                )
                .limit(1)
                .with_for_update()
            ).first()
            if prior is not None:
                old_hash = prior.token_hash
                replaced_token_id = str(prior.id)
                session.execute(
                    update(OAuthAccessToken).where(OAuthAccessToken.id == prior.id).values(revoked_at=datetime.now(UTC))
                )

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
            session.flush()
            token_id = str(record.id)
            session.commit()

        rotation = OAuthDeviceTokenRotation(
            token_id=token_id,
            replaced_token_id=replaced_token_id,
            replaced_token_hash=old_hash,
        )
        if old_hash:
            try:
                self._redis.delete(TOKEN_CACHE_KEY_FMT.format(hash=old_hash))
            except Exception:
                self.rollback_rotation(rotation)
                raise
        return rotation

    def rollback_rotation(self, rotation: OAuthDeviceTokenRotation) -> bool:
        new_hash: str | None = None
        with self._session_factory() as session:
            current = session.scalar(
                select(OAuthAccessToken)
                .where(
                    OAuthAccessToken.id == rotation.token_id,
                    OAuthAccessToken.revoked_at.is_(None),
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
            session.commit()

        cache_keys = [
            TOKEN_CACHE_KEY_FMT.format(hash=token_hash)
            for token_hash in (new_hash, rotation.replaced_token_hash)
            if token_hash
        ]
        if cache_keys:
            try:
                self._redis.delete(*cache_keys)
            except Exception:
                logger.exception("failed to invalidate rolled-back OAuth token caches")
        return True

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
                    id=str(record.id),
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
