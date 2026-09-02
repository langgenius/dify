"""Channel-bound SQLAlchemy adapter stub for current IM Identities."""

from __future__ import annotations

from typing import override

from sqlalchemy.orm import Session

from core.human_input_v2.shared import IMIdentityId

from .im_channel_repository import IMChannelId
from .im_identity_repository import IMIdentity, IMIdentityObservation, IMIdentityPage, IMIdentityRepository


class SQLAlchemyIMIdentityRepository(IMIdentityRepository):
    """Constructor-complete Identity adapter with intentionally absent SQL.

    The caller owns the supplied Session and its complete transaction, including
    commit and rollback. The caller also owns external locking, Provider I/O
    ordering, and task dispatch; this adapter must never perform those actions.
    """

    def __init__(self, session: Session, channel_id: IMChannelId) -> None:
        self._session = session
        self._channel_id = channel_id

    @override
    def get(self, identity_id: IMIdentityId) -> IMIdentity | None:
        raise NotImplementedError

    @override
    def get_by_provider_user_id(self, provider_user_id: str) -> IMIdentity | None:
        raise NotImplementedError

    @override
    def list_all(self) -> tuple[IMIdentity, ...]:
        raise NotImplementedError

    @override
    def search(self, *, keyword: str = "", page: int, limit: int) -> IMIdentityPage:
        raise NotImplementedError

    @override
    def create(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        raise NotImplementedError

    @override
    def update(self, identity_id: IMIdentityId, observation: IMIdentityObservation) -> IMIdentity:
        raise NotImplementedError

    @override
    def delete(self, identity_id: IMIdentityId) -> IMIdentity:
        raise NotImplementedError


__all__ = ["SQLAlchemyIMIdentityRepository"]
