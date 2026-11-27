"""File ownership/deletion gates and atomic remote-part materialization receipts."""

from datetime import UTC, datetime, timedelta
from hashlib import sha256

from pydantic import TypeAdapter
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from libs.uuid_utils import uuidv7
from models.external_agent import ExternalAgentContextSlot, ExternalAgentFileLease, ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import App
from services.external_agents.io_contracts import (
    ExternalIOError,
    FileBlob,
    FileReference,
    FileScope,
    FileWriteReservation,
    JsonObject,
    StoredFile,
)

_FILE_VALUE = TypeAdapter(JsonObject)


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class ExternalFileLifecycleRepository:
    def __init__(self, *, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    @staticmethod
    def _owned(session: Session, scope: FileScope, *, lock: bool = False) -> ExternalAgentInvocation:
        stmt = select(ExternalAgentInvocation).where(
            ExternalAgentInvocation.id == scope.invocation_id,
            ExternalAgentInvocation.tenant_id == scope.tenant_id,
            ExternalAgentInvocation.app_id == scope.app_id,
            ExternalAgentInvocation.initiator_id == scope.actor_id,
        )
        if lock:
            stmt = stmt.with_for_update()
        row = session.scalar(stmt)
        now = _now()
        if (
            row is None
            or row.deleted_at is not None
            or any(value is not None and value <= now for value in (row.retention_expires_at, row.test_expires_at))
        ):
            raise ExternalIOError("file_scope_expired", "The file owner is absent, deleted or expired.")
        if scope.app_id is None:
            if row.origin != "overview_test" or scope.actor_role != "account":
                raise ExternalIOError("file_scope_invalid", "Only an owned Overview test may omit the source app.")
        elif session.scalar(select(App.id).where(App.id == scope.app_id, App.tenant_id == scope.tenant_id)) is None:
            raise ExternalIOError("file_scope_expired", "The source application is absent.")
        owners = [
            ("tenant", row.tenant_id),
            ("app", row.app_id),
            ("workflow_run", row.workflow_run_id),
            ("message", row.message_id),
            ("invocation", row.id),
            ("context_slot", row.context_slot_key),
        ]
        if row.context_slot_key:
            conversation = session.scalar(
                select(ExternalAgentContextSlot.conversation_id).where(
                    ExternalAgentContextSlot.key == row.context_slot_key,
                    ExternalAgentContextSlot.tenant_id == scope.tenant_id,
                )
            )
            owners.append(("conversation", conversation))
        tombstone = session.scalar(
            select(ExternalAgentDataTombstone.id)
            .where(
                ExternalAgentDataTombstone.tenant_id == scope.tenant_id,
                or_(
                    *(
                        and_(
                            ExternalAgentDataTombstone.owner_kind == kind, ExternalAgentDataTombstone.owner_id == owner
                        )
                        for kind, owner in owners
                        if owner
                    )
                ),
            )
            .limit(1)
        )
        if tombstone:
            raise ExternalIOError("file_scope_expired", "The parent lifecycle has revoked file ingestion.")
        if scope.lease_id:
            lease = session.scalar(
                select(ExternalAgentFileLease).where(
                    ExternalAgentFileLease.id == scope.lease_id,
                    ExternalAgentFileLease.tenant_id == scope.tenant_id,
                    ExternalAgentFileLease.owner_id == scope.actor_id,
                    ExternalAgentFileLease.invocation_id == scope.invocation_id,
                    ExternalAgentFileLease.released_at.is_(None),
                    ExternalAgentFileLease.expires_at > now,
                )
            )
            if lease is None:
                raise ExternalIOError("file_lease_expired", "The test file lease is absent or expired.")
        return row

    @staticmethod
    def _allow_output(session: Session, row: ExternalAgentInvocation) -> None:
        page_id = row.job_config.get("page_session_id")
        if row.origin == "overview_test" and isinstance(page_id, str):
            page_key = sha256(f"{row.initiator_id}:{page_id}".encode()).hexdigest()
            if session.scalar(
                select(ExternalAgentDataTombstone.id).where(
                    ExternalAgentDataTombstone.tenant_id == row.tenant_id,
                    ExternalAgentDataTombstone.owner_kind == "test_page",
                    ExternalAgentDataTombstone.owner_id == page_key,
                )
            ):
                raise ExternalIOError(
                    "file_scope_expired", "The test page has left; output materialization is revoked."
                )

    @staticmethod
    def _stored(session: Session, scope: FileScope, artifact_id: str, part_index: int) -> StoredFile | None:
        row = session.scalar(
            select(ExternalAgentFileLease).where(
                ExternalAgentFileLease.tenant_id == scope.tenant_id,
                ExternalAgentFileLease.invocation_id == scope.invocation_id,
                ExternalAgentFileLease.artifact_id == artifact_id,
                ExternalAgentFileLease.part_index == part_index,
                ExternalAgentFileLease.released_at.is_(None),
                ExternalAgentFileLease.expires_at > _now(),
            )
        )
        if row is None or row.file_value is None or row.size is None or row.media_type is None:
            return None
        return StoredFile(
            file_id=row.file_id,
            value=_FILE_VALUE.validate_python(row.file_value, strict=True),
            size=row.size,
            media_type=row.media_type,
        )

    def ensure_access(self, scope: FileScope) -> None:
        with self._sessions() as session:
            self._owned(session, scope)

    def ensure_input_access(self, scope: FileScope, reference: FileReference) -> None:
        """Revalidate temporary-file provenance without a storage/network transaction.

        A new consumer input_grant cannot replace the original temporary-copy
        provenance. Released origin markers remain relevant until physical GC.
        Overview bytes are private to the exact admitted input lease; leaving
        its page does not revoke an already submitted input before remote end.
        """
        with self._sessions() as session:
            consumer = self._owned(session, scope)
            if reference.kind == "tool":
                # BYOA temporary copies are UploadFiles, never ToolFile rows.
                return
            origins = tuple(
                session.scalars(
                    select(ExternalAgentFileLease).where(
                        ExternalAgentFileLease.tenant_id == scope.tenant_id,
                        ExternalAgentFileLease.file_id == reference.file_id,
                        or_(
                            ExternalAgentFileLease.temporary_copy.is_(True), ExternalAgentFileLease.purpose == "output"
                        ),
                    )
                )
            )
            if not origins:
                return
            producers = {
                row.id: row
                for row in session.scalars(
                    select(ExternalAgentInvocation).where(
                        ExternalAgentInvocation.tenant_id == scope.tenant_id,
                        ExternalAgentInvocation.id.in_(
                            [origin.invocation_id for origin in origins if origin.invocation_id]
                        ),
                    )
                )
            }
            now = _now()

            def live(origin: ExternalAgentFileLease) -> bool:
                return origin.released_at is None and origin.expires_at > now and origin.write_state == "committed"

            def is_overview(origin: ExternalAgentFileLease) -> bool:
                producer = producers.get(origin.invocation_id or "")
                return origin.page_session_id is not None or (
                    producer is not None and producer.origin == "overview_test"
                )

            overview = [origin for origin in origins if is_overview(origin)]
            if overview:
                bound = consumer.job_config.get("input_lease_ids", [])
                admitted = (
                    consumer.origin == "overview_test"
                    and isinstance(bound, list)
                    and any(
                        origin.id in bound
                        and origin.invocation_id == consumer.id
                        and origin.owner_id == scope.actor_id
                        and origin.purpose == "input"
                        and origin.page_session_id == consumer.job_config.get("page_session_id")
                        and live(origin)
                        for origin in overview
                    )
                )
                if admitted:
                    return
            else:
                for origin in origins:
                    producer = producers.get(origin.invocation_id or "")
                    if live(origin) and producer is not None and producer.initiator_id == origin.owner_id:
                        try:
                            self._owned(
                                session,
                                FileScope(
                                    tenant_id=scope.tenant_id,
                                    app_id=producer.app_id,
                                    actor_id=origin.owner_id,
                                    invocation_id=producer.id,
                                ),
                            )
                        except ExternalIOError:
                            # Another live source may legitimately own shared bytes.
                            producer = None
                        if producer is not None:
                            return
            raise ExternalIOError(
                "file_source_unavailable", "The temporary file source is revoked or outside this invocation."
            )

    def find_stored(self, scope: FileScope, *, artifact_id: str, part_index: int) -> StoredFile | None:
        with self._sessions() as session:
            self._allow_output(session, self._owned(session, scope))
            return self._stored(session, scope, artifact_id, part_index)

    @staticmethod
    def _part(session: Session, scope: FileScope, artifact_id: str, part_index: int):
        return session.scalar(
            select(ExternalAgentFileLease)
            .where(
                ExternalAgentFileLease.tenant_id == scope.tenant_id,
                ExternalAgentFileLease.invocation_id == scope.invocation_id,
                ExternalAgentFileLease.artifact_id == artifact_id,
                ExternalAgentFileLease.part_index == part_index,
            )
            .with_for_update()
        )

    @staticmethod
    def _expiry(invocation: ExternalAgentInvocation, now: datetime) -> datetime:
        expiry = invocation.retention_expires_at or datetime(9999, 1, 1)
        if invocation.origin == "overview_test":
            expiry = min(expiry, now + timedelta(hours=24), invocation.test_expires_at or datetime(9999, 1, 1))
        return expiry

    def prepare_stored(
        self, scope: FileScope, blob: FileBlob, *, artifact_id: str, part_index: int, file_id: str, storage_key: str
    ) -> FileWriteReservation:
        with self._sessions.begin() as session:
            invocation = self._owned(session, scope, lock=True)
            self._allow_output(session, invocation)
            row = self._part(session, scope, artifact_id, part_index)
            if row is not None:
                if row.released_at is not None or row.expires_at <= _now() or row.write_state == "aborted":
                    raise ExternalIOError("file_scope_expired", "The original materialization intent is revoked.")
                if row.content_hash is not None and row.content_hash != sha256(blob.data).hexdigest():
                    raise ExternalIOError("file_content_changed", "The original pending file content has changed.")
                return FileWriteReservation(
                    file_id=row.file_id,
                    storage_key=row.storage_key or "",
                    existing=self._stored(session, scope, artifact_id, part_index),
                )
            now = _now()
            session.add(
                ExternalAgentFileLease(
                    id=str(uuidv7()),
                    tenant_id=scope.tenant_id,
                    file_id=file_id,
                    owner_id=scope.actor_id,
                    purpose="output",
                    expires_at=self._expiry(invocation, now),
                    invocation_id=scope.invocation_id,
                    agent_id=invocation.agent_id,
                    page_session_id=invocation.job_config.get("page_session_id"),
                    artifact_id=artifact_id,
                    part_index=part_index,
                    size=len(blob.data),
                    media_type=blob.media_type,
                    storage_key=storage_key,
                    content_hash=sha256(blob.data).hexdigest(),
                    write_state="planned",
                    write_lease_until=now + timedelta(seconds=120),
                    temporary_copy=True,
                )
            )
            return FileWriteReservation(file_id=file_id, storage_key=storage_key)

    def abort_stored(self, scope: FileScope, *, artifact_id: str, part_index: int, file_id: str) -> None:
        # Cleanup acknowledgement remains possible after its parent is deleted.
        with self._sessions.begin() as session:
            row = self._part(session, scope, artifact_id, part_index)
            if (
                row is not None
                and row.owner_id == scope.actor_id
                and row.file_id == file_id
                and row.write_state == "planned"
            ):
                row.write_state = "aborted"
                row.released_at = row.released_at or _now()

    def record_stored(self, scope: FileScope, *, artifact_id: str, part_index: int, file: StoredFile) -> StoredFile:
        try:
            with self._sessions.begin() as session:
                invocation = self._owned(session, scope, lock=True)
                self._allow_output(session, invocation)
                previous = self._stored(session, scope, artifact_id, part_index)
                if previous:
                    return previous
                pending = self._part(session, scope, artifact_id, part_index)
                if pending is not None:
                    if (
                        pending.file_id != file.file_id
                        or pending.released_at is not None
                        or pending.write_state == "aborted"
                    ):
                        raise ExternalIOError(
                            "file_scope_expired", "The upload does not own the pending materialization."
                        )
                    pending.file_value = dict(file.value)
                    pending.size = file.size
                    pending.media_type = file.media_type
                    pending.write_state = "committed"
                    return file
                now = _now()
                expiry = self._expiry(invocation, now)
                session.add(
                    ExternalAgentFileLease(
                        id=str(uuidv7()),
                        tenant_id=scope.tenant_id,
                        file_id=file.file_id,
                        owner_id=scope.actor_id,
                        purpose="output",
                        expires_at=expiry,
                        invocation_id=scope.invocation_id,
                        agent_id=invocation.agent_id,
                        artifact_id=artifact_id,
                        part_index=part_index,
                        file_value=dict(file.value),
                        size=file.size,
                        media_type=file.media_type,
                        # Every remote materialization is our own newly uploaded
                        # copy. Production expiry remains the parent's expiry.
                        temporary_copy=True,
                        page_session_id=invocation.job_config.get("page_session_id"),
                    )
                )
                return file
        except IntegrityError:
            # A concurrent materializer may win; re-check all revocation gates.
            winner = self.find_stored(scope, artifact_id=artifact_id, part_index=part_index)
            if winner:
                return winner
            raise
