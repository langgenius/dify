"""Expire only inactive Guest Connections and attempt their OAuth revocation."""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Protocol

from constants.end_user_connections import ConnectionCredentialType
from services.end_user_connections.entities import ConnectionManagementContext, WebConnectionContext
from services.end_user_connections.management import StoredConnection

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class GuestExpiryCandidate:
    connection_id: str
    context: WebConnectionContext
    last_active_at: datetime


class GuestConnectionExpiryStore(Protocol):
    def inactive_guests(
        self, *, before: datetime, after: GuestExpiryCandidate | None, limit: int
    ) -> tuple[GuestExpiryCandidate, ...]:
        """Page Guest IDs without reading secrets, ordered by activity then ID.

        `before` is a strict UTC cutoff. `after=None` starts a sweep; otherwise
        resume strictly after that cursor, even if its row has since changed.
        """
        ...

    def expire_guest(self, candidate: GuestExpiryCandidate, *, before: datetime) -> StoredConnection | None:
        """Recheck Guest ownership and inactivity, then delete the row and its live choices.

        Share the EndUser fence with Claim and take the Connection row lock to
        serialize with activity writes. Return the captured row on commit so the
        caller can attempt revocation, or None when the row is no longer eligible
        or its owner is busy. History is never changed. Any failure rolls back this
        Connection alone, and the caller must not hold this transaction open.
        """
        ...


class GuestOAuthRevoker(Protocol):
    def revoke_deleted(self, context: ConnectionManagementContext, record: StoredConnection) -> None:
        """Attempt one best-effort revocation after the deletion has committed."""
        ...


class GuestConnectionExpiryService:
    def __init__(
        self,
        *,
        store: GuestConnectionExpiryStore,
        oauth: GuestOAuthRevoker,
        inactivity: timedelta,
        batch_size: int,
        clock: Callable[[], datetime],
    ) -> None:
        """Accept positive retention/page settings and a naive UTC clock."""
        if inactivity <= timedelta(0) or batch_size <= 0:
            raise ValueError("Guest Connection retention and batch size must be positive.")
        self._store = store
        self._oauth = oauth
        self._inactivity = inactivity
        self._batch_size = batch_size
        self._clock = clock

    def run(self) -> None:
        """Sweep with a fixed cutoff and bounded pages; retry failed deletions on the next sweep.

        A cursor advances past failed rows, so the oldest bad record cannot block
        later pages. Repeated or concurrent sweeps can neither delete an Account
        grant nor restore a deleted Connection, even if the Provider is unavailable.
        """
        before = self._clock() - self._inactivity
        page = self._store.inactive_guests(before=before, after=None, limit=self._batch_size)
        while page:
            for candidate in page:
                self._expire(candidate, before=before)
            page = self._store.inactive_guests(before=before, after=page[-1], limit=self._batch_size)

    def _expire(self, candidate: GuestExpiryCandidate, *, before: datetime) -> None:
        """Keep revocation outside the write transaction and never let one failure halt the sweep.

        A crash between the commit and the revocation attempt loses only that
        best-effort attempt; the Connection stays deleted and the next sweep does
        not resurrect or repeat it.
        """
        try:
            record = self._store.expire_guest(candidate, before=before)
        except Exception:
            # A database error can carry secret input. Never attach it to these logs.
            logger.error("Guest Connection expiry failed: connection_id=%s", candidate.connection_id)  # noqa: TRY400
            return
        if record is None:
            return
        logger.info(
            "Guest Connection expired: connection_id=%s credential_type=%s",
            candidate.connection_id,
            record.access.credential_type,
        )
        if record.access.credential_type != ConnectionCredentialType.OAUTH2:
            return
        # Revocation is best effort: local deletion has committed, so an incomplete
        # revocation must not be reported as a cleanup failure or retried.
        try:
            self._oauth.revoke_deleted(candidate.context, record)
        except Exception:
            # The exception may contain credentials; log only the Connection ID.
            logger.warning(
                "Guest Connection deleted locally; best-effort OAuth revocation did not complete: connection_id=%s",
                candidate.connection_id,
            )
