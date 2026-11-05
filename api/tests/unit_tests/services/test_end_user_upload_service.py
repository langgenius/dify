"""Exercise upload state and forbidden storage effects with real persistence."""

from dataclasses import dataclass, field
from typing import Literal

import pytest
from sqlalchemy import String, delete, event, func, select, type_coerce, update
from sqlalchemy.orm import Session, sessionmaker

from models.enums import CreatorUserRole
from models.model import EndUser, UploadFile
from models.upload_quota import UploadQuotaReservation
from repositories.upload_quota_repository import UploadQuotaRepository
from services.end_user_upload_service import (
    EndUserUploadService,
    PendingUpload,
    UploadActor,
    UploadLimits,
    UploadOwnerNotFoundError,
    UploadSettings,
    WorkspaceUploadQuotaExceededError,
)
from tests.helpers.unit.model_factories import make_app, make_end_user, make_tenant


@dataclass
class Objects:
    """External storage boundary; failures can occur after a physical write."""

    values: dict[str, bytes] = field(default_factory=dict)
    failure: Literal["before", "after"] | None = None

    def save(self, filename: str, data: bytes) -> None:
        """Write once, optionally fail before/after the externally visible effect."""
        if self.failure == "before":
            raise OSError("storage unavailable")
        self.values[filename] = data
        if self.failure == "after":
            raise OSError("acknowledgement lost")

    def load_once(self, filename: str) -> bytes:
        """Return bytes, or the storage contract's missing-object exception."""
        if filename not in self.values:
            raise FileNotFoundError(filename)
        return self.values[filename]


@dataclass
class Harness:
    sessions: sessionmaker[Session]
    repository: UploadQuotaRepository
    objects: Objects
    actor: UploadActor

    def service(self, *, max_bytes: int = 0, max_files: int = 0) -> EndUserUploadService:
        """Build a real use case; only the external object backend is substituted."""
        return EndUserUploadService(
            uploads=self.repository,
            objects=self.objects,
            settings=UploadSettings(
                limits=UploadLimits(max_bytes=max_bytes, max_files=max_files),
                storage_type="local",
                default_size_limit=1024,
                extension_size_limits={"png": 1024},
                blocked_extensions=frozenset({"exe"}),
                document_extensions=frozenset({"txt"}),
            ),
        )

    def counts(self) -> tuple[int, int]:
        """Read persisted state in an independent session after the use case."""
        with self.sessions() as session:
            return (
                session.scalar(select(func.count()).select_from(UploadFile)) or 0,
                session.scalar(select(func.count()).select_from(UploadQuotaReservation)) or 0,
            )


@pytest.fixture
def harness(sqlite_session_factory: sessionmaker[Session]) -> Harness:
    """Persist two complete owner chains; share no mutable service state."""
    with sqlite_session_factory.begin() as session:
        session.add_all([make_tenant(tenant_id="tenant-a"), make_tenant(tenant_id="tenant-b")])
        session.add_all(
            [make_app(app_id="app-a", tenant_id="tenant-a"), make_app(app_id="app-b", tenant_id="tenant-b")]
        )
        session.add_all(
            [
                make_end_user(end_user_id="user-a", tenant_id="tenant-a", app_id="app-a"),
                make_end_user(end_user_id="user-b", tenant_id="tenant-b", app_id="app-b"),
            ]
        )
    return Harness(
        sqlite_session_factory,
        UploadQuotaRepository(session_factory=sqlite_session_factory),
        Objects(),
        UploadActor(tenant_id="tenant-a", end_user_id="user-a"),
    )


def upload(service: EndUserUploadService, actor: UploadActor, content: bytes = b"1234") -> PendingUpload:
    """Use the public application boundary, preserving extension and source inputs."""
    return service.upload(actor, filename="photo.png", content=content, mimetype="image/png")


def test_historical_usage_and_exact_byte_threshold(harness: Harness) -> None:
    """Enabling the policy counts old rows without a backfill; rejection writes nothing."""
    upload(harness.service(), harness.actor)
    result = upload(harness.service(max_bytes=8), harness.actor)
    assert result.size == 4
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        upload(harness.service(max_bytes=8), harness.actor, b"1")
    assert harness.counts() == (2, 0)
    assert len(harness.objects.values) == 2


def test_count_limit_and_two_tenant_isolation(harness: Harness) -> None:
    """Counts include zero-byte files, while another tenant retains its own capacity."""
    service = harness.service(max_files=1)
    upload(service, harness.actor, b"")
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        upload(service, harness.actor, b"")
    upload(service, UploadActor(tenant_id="tenant-b", end_user_id="user-b"), b"")
    assert harness.counts() == (2, 0)


@pytest.mark.parametrize("failure", ["before", "after"])
def test_uncertain_storage_failure_stays_reserved(harness: Harness, failure: Literal["before", "after"]) -> None:
    """An exception does not prove there was no object; retries cannot exceed the quota."""
    harness.objects.failure = failure
    service = harness.service(max_files=1)
    with pytest.raises(OSError, match="storage unavailable|acknowledgement lost"):
        upload(service, harness.actor)
    harness.objects.failure = None
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        upload(service, harness.actor)
    assert harness.counts() == (0, 1)
    assert len(harness.objects.values) == (1 if failure == "after" else 0)


def test_recovery_finalizes_existing_object_idempotently(harness: Harness) -> None:
    """Recovery retains the admitted identity and never repeats an object write."""
    harness.objects.failure = "after"
    service = harness.service(max_files=1)
    with pytest.raises(OSError, match="storage unavailable|acknowledgement lost"):
        upload(service, harness.actor)
    reservation = harness.repository.pending(tenant_id="tenant-a", limit=10)[0]
    assert service.recover(reservation, apply=False, release_missing=False, writers_stopped=False) == "ready"
    assert harness.counts() == (0, 1)
    assert service.recover(reservation, apply=True, release_missing=False, writers_stopped=False) == "finalized"
    assert service.recover(reservation, apply=True, release_missing=False, writers_stopped=False) == "finalized"
    assert harness.counts() == (1, 0)
    assert len(harness.objects.values) == 1
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        upload(service, harness.actor)


def test_missing_recovery_requires_quiesced_writers(harness: Harness) -> None:
    """Dry-run and active-writer recovery never free a potentially delayed write."""
    harness.objects.failure = "before"
    service = harness.service(max_files=1)
    with pytest.raises(OSError, match="storage unavailable|acknowledgement lost"):
        upload(service, harness.actor)
    reservation = harness.repository.pending(tenant_id="tenant-a", limit=10)[0]
    with pytest.raises(ValueError, match="stopped"):
        service.recover(reservation, apply=True, release_missing=True, writers_stopped=False)
    assert service.recover(reservation, apply=False, release_missing=True, writers_stopped=True) == "missing"
    assert harness.counts() == (0, 1)
    assert service.recover(reservation, apply=True, release_missing=True, writers_stopped=True) == "released"
    assert harness.counts() == (0, 0)


def test_database_failure_after_object_write_is_recoverable(harness: Harness) -> None:
    """A rolled-back metadata insert leaves capacity reserved and can be finalized later."""

    def fail_upload_insert(session: Session, *_args: object) -> None:
        """Fail at the DB boundary after real reservation and storage operations."""
        if any(isinstance(obj, UploadFile) for obj in session.new):
            raise RuntimeError("database unavailable")

    service = harness.service(max_bytes=4)
    event.listen(harness.sessions, "before_flush", fail_upload_insert)
    try:
        with pytest.raises(RuntimeError, match="database unavailable"):
            upload(service, harness.actor)
    finally:
        event.remove(harness.sessions, "before_flush", fail_upload_insert)
    assert harness.counts() == (0, 1)
    reservation = harness.repository.pending(tenant_id="tenant-a", limit=1)[0]
    assert service.recover(reservation, apply=True, release_missing=False, writers_stopped=False) == "finalized"
    assert harness.counts() == (1, 0)


@pytest.mark.parametrize("actor", [UploadActor("tenant-b", "user-a"), UploadActor("missing", "user-a")])
def test_owner_chain_rejects_before_storage(harness: Harness, actor: UploadActor) -> None:
    """A valid user ID grants no authority over a different workspace."""
    with pytest.raises(UploadOwnerNotFoundError):
        upload(harness.service(max_files=1), actor)
    assert harness.counts() == (0, 0)
    assert harness.objects.values == {}


def test_cross_tenant_app_owner_is_rejected(harness: Harness) -> None:
    """Even a matching end-user tenant does not authorize an app in another workspace."""
    with harness.sessions.begin() as session:
        session.execute(update(EndUser).where(EndUser.id == "user-a").values(app_id="app-b"))
    with pytest.raises(UploadOwnerNotFoundError):
        upload(harness.service(max_files=1), harness.actor)
    assert harness.counts() == (0, 0)
    assert harness.objects.values == {}


def test_historical_role_spelling_counts_but_staff_uploads_do_not(harness: Harness) -> None:
    """Old role spellings retain capacity; account-owned objects use a separate policy."""
    old = upload(harness.service(), harness.actor)
    staff = upload(harness.service(), harness.actor)
    with harness.sessions.begin() as session:
        session.execute(
            update(UploadFile)
            .where(UploadFile.id == old.id)
            .values(
                {
                    type_coerce(UploadFile.created_by_role, String): "end-user",
                }
            )
        )
        session.execute(
            update(UploadFile).where(UploadFile.id == staff.id).values(created_by_role=CreatorUserRole.ACCOUNT)
        )
    upload(harness.service(max_files=2, max_bytes=8), harness.actor)
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        upload(harness.service(max_files=2, max_bytes=8), harness.actor)
    assert harness.counts() == (3, 0)


def test_metadata_removal_releases_capacity_without_counter_drift(harness: Harness) -> None:
    """Existing deletion paths need no counter backfill or new quota dependency."""
    old = upload(harness.service(max_files=1), harness.actor)
    with harness.sessions.begin() as session:
        session.execute(delete(UploadFile).where(UploadFile.tenant_id == old.tenant_id, UploadFile.id == old.id))
    upload(harness.service(max_files=1), harness.actor)
    assert harness.counts() == (1, 0)


def test_lost_commit_acknowledgement_preserves_committed_file(harness: Harness) -> None:
    """An error after commit never triggers storage deletion or blind upload replay."""
    commits = 0

    def lose_second_ack(_session: Session) -> None:
        """Lose only the metadata transaction's acknowledgement, after real commit."""
        nonlocal commits
        commits += 1
        if commits == 2:
            raise OSError("commit acknowledgement lost")

    event.listen(harness.sessions, "after_commit", lose_second_ack)
    try:
        with pytest.raises(OSError, match="commit acknowledgement lost"):
            upload(harness.service(max_files=1), harness.actor)
    finally:
        event.remove(harness.sessions, "after_commit", lose_second_ack)
    assert harness.counts() == (1, 0)
    assert len(harness.objects.values) == 1
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        upload(harness.service(max_files=1), harness.actor)


def test_pending_queries_are_bounded_and_tenant_scoped(harness: Harness) -> None:
    """Recovery cannot enumerate another workspace's reservation through the selected scope."""
    harness.objects.failure = "before"
    service = harness.service(max_files=5)
    for _ in range(2):
        with pytest.raises(OSError, match="storage unavailable|acknowledgement lost"):
            upload(service, harness.actor)
    assert len(service.pending(tenant_id="tenant-a", limit=1)) == 1
    assert service.pending(tenant_id="tenant-b", limit=10) == []
    with pytest.raises(ValueError, match="limit must"):
        service.pending(tenant_id="tenant-a", limit=1001)


def test_recovery_mismatch_or_backend_change_keeps_capacity(harness: Harness) -> None:
    """No recovery path deletes unexpected objects or frees their uncertain capacity."""
    from dataclasses import replace

    harness.objects.failure = "after"
    service = harness.service(max_files=1)
    with pytest.raises(OSError, match="storage unavailable|acknowledgement lost"):
        upload(service, harness.actor)
    pending = service.pending(tenant_id="tenant-a", limit=1)[0]
    harness.objects.values[pending.key] = b"bad"
    assert service.recover(pending, apply=True, release_missing=False, writers_stopped=False) == "mismatch"
    assert (
        service.recover(replace(pending, storage_type="s3"), apply=True, release_missing=False, writers_stopped=False)
        == "different_backend"
    )
    assert harness.counts() == (0, 1)
    assert harness.objects.values == {pending.key: b"bad"}


def test_recovery_by_id_reaches_later_reservations(harness: Harness) -> None:
    """Unresolved entries at the head of a bounded batch cannot starve a later valid object."""
    service = harness.service(max_files=5)
    harness.objects.failure = "before"
    for _ in range(2):
        with pytest.raises(OSError, match="storage unavailable"):
            upload(service, harness.actor)
    harness.objects.failure = "after"
    with pytest.raises(OSError, match="acknowledgement lost"):
        upload(service, harness.actor)
    stored_key = next(iter(harness.objects.values))
    later_id = stored_key.rsplit("/", 1)[1].split(".")[0]
    selected = service.pending(tenant_id="tenant-a", limit=1, reservation_id=later_id)
    assert len(selected) == 1
    assert service.pending(tenant_id="tenant-b", limit=1, reservation_id=later_id) == []
    assert service.recover(selected[0], apply=True, release_missing=False, writers_stopped=False) == "finalized"
    assert harness.counts() == (1, 2)


def test_internal_offload_does_not_consume_user_upload_quota(harness: Harness) -> None:
    """Persistent purpose keeps accounting stable even when offload references are removed."""
    from models.enums import UploadFilePurpose

    internal = upload(harness.service(), harness.actor)
    with harness.sessions.begin() as session:
        session.execute(
            update(UploadFile).where(UploadFile.id == internal.id).values(purpose=UploadFilePurpose.WORKFLOW_OFFLOAD)
        )
    upload(harness.service(max_files=1, max_bytes=4), harness.actor)
    with pytest.raises(WorkspaceUploadQuotaExceededError):
        upload(harness.service(max_files=1, max_bytes=4), harness.actor)
    assert harness.counts() == (2, 0)
