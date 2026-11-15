"""Owned temporary input copies for an Overview page, before business submission."""

from datetime import timedelta
from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.uuid_utils import uuidv7
from machinery.context import RequestContext
from models.external_agent import ExternalAgentFileLease
from models.external_agent_trace import ExternalAgentDataTombstone
from services.external_agents.contracts import ExternalAgentConflictError, ExternalAgentNotFoundError
from services.external_agents.file_profile import FileLimits
from services.external_agents.io_contracts import FileBlob, FileWriteReservation, JsonObject
from services.external_agents.test_service import TestFile

from .asset_repository import ExternalAssetRepository, now, utc_time


class ExternalTestFileRepository:
    def __init__(self, *, sessions: sessionmaker[Session], limits: FileLimits) -> None:
        self._sessions, self._limits = sessions, limits

    @staticmethod
    def _page(session: Session, context: RequestContext, page_session_id: str) -> None:
        key = sha256(f"{context.account_id}:{page_session_id}".encode()).hexdigest()
        if session.scalar(
            select(ExternalAgentDataTombstone.id).where(
                ExternalAgentDataTombstone.tenant_id == context.active_workspace_id,
                ExternalAgentDataTombstone.owner_kind == "test_page",
                ExternalAgentDataTombstone.owner_id == key,
            )
        ):
            raise ExternalAgentConflictError("The test page has left; use a new page session.")

    @staticmethod
    def _statement(context: RequestContext, agent_id: str, page_session_id: str):
        return select(ExternalAgentFileLease).where(
            ExternalAgentFileLease.tenant_id == context.active_workspace_id,
            ExternalAgentFileLease.owner_id == context.account_id,
            ExternalAgentFileLease.agent_id == agent_id,
            ExternalAgentFileLease.page_session_id == page_session_id,
            ExternalAgentFileLease.purpose == "input",
            ExternalAgentFileLease.released_at.is_(None),
            ExternalAgentFileLease.expires_at > now(),
        )

    def register(
        self,
        context: RequestContext,
        *,
        agent_id: str,
        page_session_id: str,
        plan: FileWriteReservation,
        blob: FileBlob,
    ) -> TestFile:
        with self._sessions.begin() as session:
            ExternalAssetRepository._writer_role(
                session, context, allowed_roles=frozenset({"owner", "admin", "editor"})
            )
            # Serialize a page's count/byte admission using its asset head.
            ExternalAssetRepository._rows(session, context.active_workspace_id, agent_id, lock=True)
            self._page(session, context, page_session_id)
            existing = tuple(
                session.scalars(
                    self._statement(context, agent_id, page_session_id).where(
                        ExternalAgentFileLease.invocation_id.is_(None),
                    )
                )
            )
            sizes: dict[str, int] = {}
            for item in existing:
                sizes[item.file_id] = max(sizes.get(item.file_id, 0), item.size or 0)
            if len({row.file_id for row in existing}) >= self._limits.max_files or (
                sum(sizes.values()) + len(blob.data) > self._limits.max_total_bytes
            ):
                raise ExternalAgentConflictError("The test page file count or total byte limit is reached.")
            row = ExternalAgentFileLease(
                id=str(uuidv7()),
                tenant_id=context.active_workspace_id,
                file_id=plan.file_id,
                owner_id=context.account_id,
                purpose="input",
                expires_at=now() + timedelta(hours=1),
                agent_id=agent_id,
                page_session_id=page_session_id,
                size=len(blob.data),
                media_type=blob.media_type,
                file_value={"filename": blob.filename},
                temporary_copy=True,
                storage_key=plan.storage_key,
                content_hash=sha256(blob.data).hexdigest(),
                write_state="planned",
                write_lease_until=now() + timedelta(seconds=120),
            )
            session.add(row)
            return TestFile(
                lease_id=row.id,
                file_id=plan.file_id,
                filename=blob.filename,
                media_type=blob.media_type,
                size=len(blob.data),
                expires_at=utc_time(row.expires_at),
            )

    def complete(self, context: RequestContext, *, lease_id: str) -> bool:
        with self._sessions.begin() as session:
            ExternalAssetRepository._writer_role(
                session, context, allowed_roles=frozenset({"owner", "admin", "editor"})
            )
            row = session.scalar(
                select(ExternalAgentFileLease)
                .where(
                    ExternalAgentFileLease.id == lease_id,
                    ExternalAgentFileLease.tenant_id == context.active_workspace_id,
                    ExternalAgentFileLease.owner_id == context.account_id,
                    ExternalAgentFileLease.invocation_id.is_(None),
                )
                .with_for_update()
            )
            if row is None:
                return False
            try:
                self._page(session, context, row.page_session_id or "")
                ExternalAssetRepository._rows(session, context.active_workspace_id, row.agent_id or "")
                valid = row.released_at is None and row.expires_at > now() and row.write_state == "planned"
            except (ExternalAgentConflictError, ExternalAgentNotFoundError):
                valid = False
            row.write_state = "committed" if valid else "aborted"
            if not valid:
                row.released_at = row.released_at or now()
            return valid

    def abort(self, context: RequestContext, *, lease_id: str) -> None:
        with self._sessions.begin() as session:
            row = session.scalar(
                select(ExternalAgentFileLease)
                .where(
                    ExternalAgentFileLease.id == lease_id,
                    ExternalAgentFileLease.tenant_id == context.active_workspace_id,
                    ExternalAgentFileLease.owner_id == context.account_id,
                    ExternalAgentFileLease.invocation_id.is_(None),
                )
                .with_for_update()
            )
            if row is not None and row.write_state == "planned":
                row.write_state = "aborted"
                row.released_at = row.released_at or now()

    def release(self, context: RequestContext, *, agent_id: str, lease_id: str) -> None:
        """Idempotently release only the complete owned, unsubmitted input chain.

        A submitted lease belongs to its Invocation until terminal cleanup. A
        planned writer remains planned until completion/abort acknowledges I/O;
        releasing it cannot erase the exact-key cleanup intent prematurely.
        """
        with self._sessions.begin() as session:
            row = session.scalar(
                select(ExternalAgentFileLease)
                .where(
                    ExternalAgentFileLease.id == lease_id,
                    ExternalAgentFileLease.tenant_id == context.active_workspace_id,
                    ExternalAgentFileLease.owner_id == context.account_id,
                    ExternalAgentFileLease.agent_id == agent_id,
                    ExternalAgentFileLease.purpose == "input",
                    ExternalAgentFileLease.invocation_id.is_(None),
                )
                .with_for_update()
            )
            if row is not None:
                row.released_at = row.released_at or now()

    def references(
        self, context: RequestContext, *, agent_id: str, page_session_id: str, lease_ids: tuple[str, ...]
    ) -> tuple[JsonObject, ...]:
        if len(lease_ids) > self._limits.max_files:
            raise ExternalAgentConflictError("Too many test file references.")
        with self._sessions() as session:
            self._page(session, context, page_session_id)
            rows = {
                row.id: row
                for row in session.scalars(
                    self._statement(context, agent_id, page_session_id).where(
                        ExternalAgentFileLease.id.in_(lease_ids), ExternalAgentFileLease.write_state == "committed"
                    )
                )
            }
            if any(key not in rows for key in lease_ids):
                raise ExternalAgentNotFoundError("A test file is absent, expired or belongs to another page.")
            if sum(rows[key].size or 0 for key in lease_ids) > self._limits.max_total_bytes:
                raise ExternalAgentConflictError("The input file byte budget is exceeded.")
            return tuple({"fileRef": {"file_id": rows[key].file_id, "kind": "upload"}} for key in lease_ids)
