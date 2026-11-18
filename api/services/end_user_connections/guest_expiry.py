"""Expire only inactive Guest Connections and deliver their pinned OAuth revocations."""

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Literal, Protocol

from services.end_user_connections.entities import (
    ConnectionOAuthClient,
    OAuthGrantRevocationStatus,
    WebConnectionContext,
)

logger = logging.getLogger(__name__)
_REVOCATION_LEASE = timedelta(minutes=5)

type GuestExpiryOutcome = Literal["manual_revocation_required", "oauth_revocation_pending", "oauth_unavailable"]


@dataclass(frozen=True, slots=True)
class GuestExpiryCandidate:
    connection_id: str
    context: WebConnectionContext
    last_active_at: datetime


@dataclass(frozen=True, slots=True)
class PendingGuestOAuthRevocation:
    connection_id: str
    tenant_id: str
    available_at: datetime


@dataclass(frozen=True, slots=True)
class GuestOAuthRevocation:
    context: WebConnectionContext
    provider: str
    client: ConnectionOAuthClient
    encrypted_credentials: str = field(repr=False)


class GuestConnectionExpiryStore(Protocol):
    def inactive_guests(
        self, *, before: datetime, after: GuestExpiryCandidate | None, limit: int
    ) -> tuple[GuestExpiryCandidate, ...]:
        """Page Guest IDs without reading secrets, ordered by activity then ID.

        `before` is a strict UTC cutoff. `after=None` starts a sweep; otherwise
        resume strictly after that cursor, even if its row has since changed.
        """
        ...

    def expire_guest(
        self, candidate: GuestExpiryCandidate, *, before: datetime, now: datetime
    ) -> GuestExpiryOutcome | None:
        """Recheck Guest ownership and inactivity, then atomically remove live state.

        Share the EndUser fence with Claim and take the Connection row lock to
        serialize with activity writes. Return None if the row is no longer
        eligible or its owner is busy. On success only OAuth grants with pinned
        provenance leave an encrypted revocation job, committed with deletion.
        History is never changed. Any failure rolls back this Connection alone.
        """
        ...

    def pending_guest_oauth_revocations(
        self, *, now: datetime, after: PendingGuestOAuthRevocation | None, limit: int
    ) -> tuple[PendingGuestOAuthRevocation, ...]:
        """Page due work without secrets, ordered by availability then ID; None starts a sweep."""
        ...

    def lease_guest_oauth_revocation(
        self, candidate: PendingGuestOAuthRevocation, *, until: datetime
    ) -> GuestOAuthRevocation | None:
        """Advance the matching availability timestamp to `until` and commit before returning the grant.

        Only one worker can reserve a given version. A stale or completed candidate
        returns None. If a worker stops before finishing, the lease makes the work
        visible again at `until` without making the deleted Connection claimable.
        """
        ...

    def finish_guest_oauth_revocation(self, candidate: PendingGuestOAuthRevocation, *, until: datetime) -> None:
        """Erase the encrypted job only if the original lease is still current."""
        ...


class GuestOAuthRevoker(Protocol):
    def revoke_grant(
        self,
        context: WebConnectionContext,
        *,
        provider: str,
        reference: ConnectionOAuthClient,
        encrypted_credentials: str,
    ) -> OAuthGrantRevocationStatus:
        """Attempt once using the original artifact and Client; return a safe status."""
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
        """Sweep with a fixed cutoff and bounded pages; retry failed rows on the next sweep.

        A cursor advances past failed rows, so the oldest bad record cannot block
        later pages. Repeated or concurrent sweeps can neither delete an Account
        grant nor restore a deleted Connection, even if the Provider is unavailable.
        """
        now = self._clock()
        before = now - self._inactivity
        page = self._store.inactive_guests(before=before, after=None, limit=self._batch_size)
        while page:
            for candidate in page:
                self._expire(candidate, before=before, now=now)
            page = self._store.inactive_guests(before=before, after=page[-1], limit=self._batch_size)

        pending = self._store.pending_guest_oauth_revocations(now=now, after=None, limit=self._batch_size)
        while pending:
            for job in pending:
                self._revoke(job)
            pending = self._store.pending_guest_oauth_revocations(now=now, after=pending[-1], limit=self._batch_size)

    def _expire(self, candidate: GuestExpiryCandidate, *, before: datetime, now: datetime) -> None:
        """Log only committed deletion outcomes; do not let one local failure halt the sweep."""
        try:
            outcome = self._store.expire_guest(candidate, before=before, now=now)
        except Exception:
            # A database or provider error can carry secret input. Never attach it to these logs.
            logger.error("Guest Connection expiry failed: connection_id=%s", candidate.connection_id)  # noqa: TRY400
        else:
            if outcome is not None:
                logger.info("Guest Connection expired: connection_id=%s outcome=%s", candidate.connection_id, outcome)

    def _revoke(self, job: PendingGuestOAuthRevocation) -> None:
        """Use a committed lease; retire normal provider failures as well as successes."""
        # Whole seconds round-trip unchanged through both PostgreSQL and MySQL DateTime columns.
        until = self._clock().replace(microsecond=0) + _REVOCATION_LEASE
        try:
            grant = self._store.lease_guest_oauth_revocation(job, until=until)
            if grant is not None:
                outcome = self._oauth.revoke_grant(
                    grant.context,
                    provider=grant.provider,
                    reference=grant.client,
                    encrypted_credentials=grant.encrypted_credentials,
                )
                level = logging.INFO if outcome in {"revoked", "unsupported"} else logging.WARNING
                logger.log(
                    level, "Expired Guest OAuth revocation: connection_id=%s outcome=%s", job.connection_id, outcome
                )
                self._store.finish_guest_oauth_revocation(job, until=until)
        except Exception:
            logger.error("Guest OAuth revocation job failed: connection_id=%s", job.connection_id)  # noqa: TRY400
