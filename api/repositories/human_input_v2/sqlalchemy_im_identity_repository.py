"""Channel-bound SQLAlchemy persistence for current IM Identities."""

from __future__ import annotations

from typing import override

import sqlalchemy as sa
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.human_input_v2.shared import IMIdentityId, IMSyncRunId
from libs.datetime_utils import ensure_naive_utc
from models.human_input_v2 import (
    HumanInputIMBinding,
    HumanInputIMBindingWorkspaceOverride,
    HumanInputIMIdentity,
    IMIdentityRawPayload,
)

from .im_channel_repository import IMChannelId
from .im_identity_repository import (
    IMIdentity,
    IMIdentityAlreadyExistsError,
    IMIdentityInUseError,
    IMIdentityNotFoundError,
    IMIdentityObservation,
    IMIdentityPage,
    IMIdentityRepository,
)

_PROVIDER_USER_UNIQUE_CONSTRAINT = "human_input_im_identities_channel_provider_user_uq"
_SQLITE_PROVIDER_USER_UNIQUE_TARGET = "human_input_im_identities.channel_id, human_input_im_identities.provider_user_id"
_MAX_SEARCH_LIMIT = 100


def _identity_from_record(record: HumanInputIMIdentity) -> IMIdentity:
    return IMIdentity(
        id=IMIdentityId(record.id),
        provider_user_id=record.provider_user_id,
        display_name=record.display_name,
        email=record.email,
        last_seen_sync_run_id=IMSyncRunId(record.last_seen_sync_run_id),
        last_seen_at=ensure_naive_utc(record.last_seen_at),
        created_at=ensure_naive_utc(record.created_at),
        updated_at=ensure_naive_utc(record.updated_at),
    )


def _canonical_pair(value: str | None) -> tuple[str | None, str | None]:
    if value is None:
        return None, None
    source = value.strip()
    if not source:
        return None, None
    return source, source.casefold()


def _is_provider_user_conflict(error: IntegrityError) -> bool:
    message = str(error.orig).lower()
    return _PROVIDER_USER_UNIQUE_CONSTRAINT in message or _SQLITE_PROVIDER_USER_UNIQUE_TARGET in message


def _apply_observation(record: HumanInputIMIdentity, observation: IMIdentityObservation) -> None:
    display_name, normalized_name = _canonical_pair(observation.display_name)
    email, normalized_email = _canonical_pair(observation.email)
    record.display_name = display_name
    record.normalized_name = normalized_name
    record.email = email
    record.normalized_email = normalized_email
    record.raw_payload = IMIdentityRawPayload(observation.raw_payload.root)
    record.last_seen_sync_run_id = str(observation.sync_run_id)
    record.last_seen_at = observation.observed_at
    record.updated_at = observation.observed_at


def _lock_current_identity(session: Session, channel_id: IMChannelId, identity_id: IMIdentityId) -> bool:
    # TODO(QuantumGhost): this lock is misleading.
    """Serialize Identity deletion and Binding writes inside the caller transaction."""

    result = session.execute(
        sa.update(HumanInputIMIdentity)
        .where(
            HumanInputIMIdentity.channel_id == str(channel_id),
            HumanInputIMIdentity.id == str(identity_id),
        )
        .values(updated_at=HumanInputIMIdentity.updated_at)
        .execution_options(autoflush=False, synchronize_session=False)
    )
    if not isinstance(result, CursorResult):
        raise TypeError("conditional IM Identity guard did not return a cursor result")
    return result.rowcount == 1


class SQLAlchemyIMIdentityRepository(IMIdentityRepository):
    """Persist current Identities through one caller-owned Session and Channel."""

    def __init__(self, session: Session, channel_id: IMChannelId) -> None:
        self._session = session
        self._channel_id = channel_id

    @override
    def get(self, identity_id: IMIdentityId) -> IMIdentity | None:
        record = self._session.scalar(
            sa.select(HumanInputIMIdentity)
            .where(
                HumanInputIMIdentity.channel_id == str(self._channel_id),
                HumanInputIMIdentity.id == str(identity_id),
            )
            .execution_options(autoflush=False)
        )
        return _identity_from_record(record) if record is not None else None

    @override
    def get_by_provider_user_id(self, provider_user_id: str) -> IMIdentity | None:
        canonical_provider_user_id = provider_user_id.strip()
        record = self._session.scalar(
            sa.select(HumanInputIMIdentity)
            .where(
                HumanInputIMIdentity.channel_id == str(self._channel_id),
                HumanInputIMIdentity.provider_user_id == canonical_provider_user_id,
            )
            .execution_options(autoflush=False)
        )
        return _identity_from_record(record) if record is not None else None

    @override
    def list_all(self) -> tuple[IMIdentity, ...]:
        records = self._session.scalars(
            sa.select(HumanInputIMIdentity)
            .where(HumanInputIMIdentity.channel_id == str(self._channel_id))
            .order_by(HumanInputIMIdentity.id)
            .execution_options(autoflush=False)
        ).all()
        return tuple(_identity_from_record(record) for record in records)

    @override
    def search(self, *, keyword: str = "", page: int, limit: int) -> IMIdentityPage:
        if page < 1:
            raise ValueError("page must be positive")
        if limit < 1 or limit > _MAX_SEARCH_LIMIT:
            raise ValueError(f"limit must be between 1 and {_MAX_SEARCH_LIMIT}")

        predicates: list[sa.ColumnElement[bool]] = [HumanInputIMIdentity.channel_id == str(self._channel_id)]
        normalized_keyword = keyword.strip().casefold()
        if normalized_keyword:
            predicates.append(
                sa.or_(
                    sa.func.lower(HumanInputIMIdentity.provider_user_id).contains(
                        normalized_keyword,
                        autoescape=True,
                    ),
                    HumanInputIMIdentity.normalized_name.contains(normalized_keyword, autoescape=True),
                    HumanInputIMIdentity.normalized_email.contains(normalized_keyword, autoescape=True),
                )
            )
        total = (
            self._session.scalar(
                sa.select(sa.func.count(HumanInputIMIdentity.id)).where(*predicates).execution_options(autoflush=False)
            )
            or 0
        )
        records = self._session.scalars(
            sa.select(HumanInputIMIdentity)
            .where(*predicates)
            .order_by(HumanInputIMIdentity.id)
            .offset((page - 1) * limit)
            .limit(limit)
            .execution_options(autoflush=False)
        ).all()
        return IMIdentityPage(
            items=tuple(_identity_from_record(record) for record in records),
            page=page,
            limit=limit,
            total=total,
        )

    @override
    def create(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        provider_user_id = observation.provider_user_id.strip()
        if not provider_user_id:
            raise ValueError("provider user id must not be blank")
        record = HumanInputIMIdentity(
            channel_id=str(self._channel_id),
            provider_user_id=provider_user_id,
            raw_payload=IMIdentityRawPayload(observation.raw_payload.root),
            last_seen_sync_run_id=str(observation.sync_run_id),
            last_seen_at=observation.observed_at,
        )
        record.id = str(identity_id)
        record.created_at = observation.observed_at
        _apply_observation(record, observation)
        try:
            self._session.add(record)
            self._session.flush([record])
        except IntegrityError as error:
            if _is_provider_user_conflict(error):
                raise IMIdentityAlreadyExistsError("Provider user already exists in the bound IM Channel") from error
            raise
        return _identity_from_record(record)

    @override
    def update(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        record = self._session.scalar(
            sa.select(HumanInputIMIdentity)
            .where(
                HumanInputIMIdentity.channel_id == str(self._channel_id),
                HumanInputIMIdentity.id == str(identity_id),
            )
            .execution_options(autoflush=False)
        )
        if record is None:
            raise IMIdentityNotFoundError("IM Identity is not current in the bound Channel")
        _apply_observation(record, observation)
        self._session.flush([record])
        return _identity_from_record(record)

    @override
    def delete(self, identity_id: IMIdentityId) -> None:
        if not _lock_current_identity(self._session, self._channel_id, identity_id):
            return
        record = self._session.scalar(
            sa.select(HumanInputIMIdentity)
            .where(
                HumanInputIMIdentity.channel_id == str(self._channel_id),
                HumanInputIMIdentity.id == str(identity_id),
            )
            .execution_options(autoflush=False)
        )
        if record is None:
            raise RuntimeError("guarded IM Identity disappeared inside the caller transaction")
        in_use = self._session.scalar(
            sa.select(
                sa.or_(
                    sa.exists(
                        sa.select(HumanInputIMBinding.id).where(
                            HumanInputIMBinding.channel_id == str(self._channel_id),
                            HumanInputIMBinding.im_identity_id == str(identity_id),
                        )
                    ),
                    sa.exists(
                        sa.select(HumanInputIMBindingWorkspaceOverride.id).where(
                            HumanInputIMBindingWorkspaceOverride.channel_id == str(self._channel_id),
                            HumanInputIMBindingWorkspaceOverride.im_identity_id == str(identity_id),
                        )
                    ),
                )
            ).execution_options(autoflush=False)
        )
        if in_use:
            raise IMIdentityInUseError("IM Identity is referenced by a current Binding")
        self._session.delete(record)
        self._session.flush()


__all__ = ["SQLAlchemyIMIdentityRepository"]
