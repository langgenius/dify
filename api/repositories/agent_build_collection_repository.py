"""Durable dispatch intents for Build-owned binding cleanup.

The repository owns claim CAS and settlement. ``last_attempt_at`` is an attempt
timestamp, never an acknowledgement of physical cleanup. A retry can republish
an in-flight task, so consumers must remain idempotent and settle by claim version.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models.agent import AgentBuildCollectionRequest


@dataclass(frozen=True, slots=True)
class AgentBuildCollectionIntent:
    """Identify one immutable dispatch claim and its optional retained error."""

    tenant_id: str
    binding_id: str
    attempt_count: int
    last_error: str | None = None


class AgentBuildCollectionRepository:
    """Persist and dispatch one Build retirement intent per tenant and binding."""

    def __init__(self, session_factory: sessionmaker[Session]):
        self._session_factory = session_factory

    @staticmethod
    def stage(*, session: Session, tenant_id: str, binding_id: str) -> None:
        """Stage and flush one intent without committing the caller's transaction.

        Success leaves retirement and dispatch recovery atomic. A uniqueness or
        database failure propagates so the caller can roll back both changes.
        """
        session.add(
            AgentBuildCollectionRequest(
                tenant_id=tenant_id,
                binding_id=binding_id,
                attempt_count=0,
            )
        )
        session.flush()

    def pending_binding_ids(self, *, tenant_id: str, binding_ids: set[str]) -> set[str]:
        """Return the persisted Build subset without changing dispatch state.

        Empty input returns an empty set. Legacy binding IDs remain eligible
        for their original collection path.
        """
        if not binding_ids:
            return set()
        with self._session_factory() as session:
            return set(
                session.scalars(
                    select(AgentBuildCollectionRequest.binding_id).where(
                        AgentBuildCollectionRequest.tenant_id == tenant_id,
                        AgentBuildCollectionRequest.binding_id.in_(binding_ids),
                    )
                )
            )

    def claim_next(
        self,
        *,
        tenant_id: str | None = None,
        binding_id: str | None = None,
        excluded_binding_ids: set[str] | None = None,
        retry_interval_seconds: float = 300.0,
        max_attempts: int = 100,
    ) -> AgentBuildCollectionIntent | None:
        """Commit at most one monotonic claim for the next eligible intent.

        Non-negative retry bounds and a positive attempt limit are required.
        The conditional update compares both claim generation and timestamp;
        no row or a lost race returns None without reporting a claim. Database
        failures roll back the claim and propagate.
        """
        if retry_interval_seconds < 0 or max_attempts < 1:
            raise ValueError("collection retry bounds must be non-negative with at least one attempt")
        now = naive_utc_now()
        cutoff = now - timedelta(seconds=retry_interval_seconds)
        with self._session_factory.begin() as session:
            filters = [
                or_(
                    AgentBuildCollectionRequest.last_attempt_at.is_(None),
                    AgentBuildCollectionRequest.last_attempt_at <= cutoff,
                ),
                AgentBuildCollectionRequest.attempt_count < max_attempts,
            ]
            if tenant_id is not None:
                filters.append(AgentBuildCollectionRequest.tenant_id == tenant_id)
            if binding_id is not None:
                filters.append(AgentBuildCollectionRequest.binding_id == binding_id)
            if excluded_binding_ids:
                filters.append(AgentBuildCollectionRequest.binding_id.not_in(sorted(excluded_binding_ids)))
            request = session.scalar(
                select(AgentBuildCollectionRequest)
                .where(*filters)
                .order_by(AgentBuildCollectionRequest.created_at, AgentBuildCollectionRequest.id)
                .limit(1)
            )
            if request is None:
                return None
            expected_attempt = request.attempt_count
            claimed = session.connection().execute(
                update(AgentBuildCollectionRequest)
                .where(
                    AgentBuildCollectionRequest.id == request.id,
                    AgentBuildCollectionRequest.attempt_count == expected_attempt,
                    AgentBuildCollectionRequest.last_attempt_at == request.last_attempt_at,
                )
                .values(
                    attempt_count=AgentBuildCollectionRequest.attempt_count + 1,
                    last_attempt_at=now,
                    last_error=None,
                )
            )
            if claimed.rowcount != 1:
                return None
            return AgentBuildCollectionIntent(
                tenant_id=request.tenant_id,
                binding_id=request.binding_id,
                attempt_count=expected_attempt + 1,
            )

    def record_error(self, *, intent: AgentBuildCollectionIntent, error_type: str) -> None:
        """Record only an exception type on the matching claim generation.

        The bounded text excludes broker payloads and credentials. A newer
        generation is left unchanged; this never acknowledges physical cleanup.
        """
        with self._session_factory.begin() as session:
            session.execute(
                update(AgentBuildCollectionRequest)
                .where(
                    AgentBuildCollectionRequest.tenant_id == intent.tenant_id,
                    AgentBuildCollectionRequest.binding_id == intent.binding_id,
                    AgentBuildCollectionRequest.attempt_count == intent.attempt_count,
                )
                .values(last_error=error_type[:128])
            )

    def current_attempt(self, *, session: Session, tenant_id: str, binding_id: str) -> int | None:
        """Read the claim generation before external cleanup, without committing.

        None denotes a legacy non-Build cleanup with no persisted intent.
        """
        return session.scalar(
            select(AgentBuildCollectionRequest.attempt_count).where(
                AgentBuildCollectionRequest.tenant_id == tenant_id,
                AgentBuildCollectionRequest.binding_id == binding_id,
            )
        )

    def complete(self, *, session: Session, tenant_id: str, binding_id: str, expected_attempt: int | None) -> bool:
        """Delete only the observed claim generation in the caller's transaction.

        True means one matching row was deleted. None, a missing row, or a newer
        retry returns False without deleting it. The caller owns the commit.
        """
        if expected_attempt is None:
            return False
        result = session.connection().execute(
            delete(AgentBuildCollectionRequest).where(
                AgentBuildCollectionRequest.tenant_id == tenant_id,
                AgentBuildCollectionRequest.binding_id == binding_id,
                AgentBuildCollectionRequest.attempt_count == expected_attempt,
            )
        )
        return result.rowcount == 1

    def exhausted(self, *, max_attempts: int) -> list[AgentBuildCollectionIntent]:
        """Return up to 100 retained exhausted intents for operator review.

        Rows at or above the attempt limit are never deleted by this query.
        """
        with self._session_factory() as session:
            rows = session.scalars(
                select(AgentBuildCollectionRequest)
                .where(AgentBuildCollectionRequest.attempt_count >= max_attempts)
                .order_by(AgentBuildCollectionRequest.created_at, AgentBuildCollectionRequest.id)
                .limit(100)
            ).all()
            return [
                AgentBuildCollectionIntent(
                    tenant_id=row.tenant_id,
                    binding_id=row.binding_id,
                    attempt_count=row.attempt_count,
                    last_error=row.last_error,
                )
                for row in rows
            ]
