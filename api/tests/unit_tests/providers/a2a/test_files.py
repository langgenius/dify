"""Real SQLite + filesystem + FileService acceptance for the BYOA file bridge."""

import base64
from collections.abc import Generator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from typing import Literal, override
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import Table, create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from models import UploadFile
from models.enums import CreatorUserRole
from models.external_agent import ExternalAgentContextSlot, ExternalAgentFileLease, ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import App, AppMode
from providers.a2a.files import DifyFileAdapter
from providers.a2a.transport import BoundedTransport
from repositories.external_agents.file_lifecycle_repository import ExternalFileLifecycleRepository
from services.external_agents.io_contracts import (
    ExternalIOError,
    FileBlob,
    FileReference,
    FileScope,
    FileWriteReservation,
    JsonObject,
    StoredFile,
)
from services.file_service import FileService, FileUploadActor

type FileDomain = tuple[DifyFileAdapter, FileService, Lifecycle, sessionmaker[Session], FileEgress]
type SourceLifecycleDomain = tuple[DifyFileAdapter, FileService, sessionmaker[Session], Storage, FileScope, str]


class Lifecycle:
    def __init__(self) -> None:
        self.allowed = True
        self.files: dict[tuple[str, str, int], StoredFile] = {}
        self.plans = {}
        self.crash_before_binding = False

    def ensure_access(self, scope: FileScope) -> None:
        assert scope.tenant_id
        assert scope.invocation_id
        if not self.allowed:
            raise ExternalIOError("file_scope_revoked", "The file owner is deleted or expired.")

    def ensure_input_access(self, scope: FileScope, reference: FileReference) -> None:
        assert reference.file_id
        self.ensure_access(scope)

    def find_stored(self, scope: FileScope, *, artifact_id: str, part_index: int) -> StoredFile | None:
        self.ensure_access(scope)
        return self.files.get((scope.invocation_id, artifact_id, part_index))

    def record_stored(self, scope: FileScope, *, artifact_id: str, part_index: int, file: StoredFile) -> StoredFile:
        self.ensure_access(scope)
        if self.crash_before_binding:
            self.crash_before_binding = False
            raise SystemExit("injected process loss after durable upload")
        return self.files.setdefault((scope.invocation_id, artifact_id, part_index), file)

    def prepare_stored(
        self, scope: FileScope, blob: FileBlob, *, artifact_id: str, part_index: int, file_id: str, storage_key: str
    ) -> FileWriteReservation:
        self.ensure_access(scope)
        assert blob.data
        return self.plans.setdefault(
            (scope.invocation_id, artifact_id, part_index),
            FileWriteReservation(file_id=file_id, storage_key=storage_key),
        )

    def abort_stored(self, scope: FileScope, *, artifact_id: str, part_index: int, file_id: str) -> None:
        plan = self.plans[(scope.invocation_id, artifact_id, part_index)]
        assert plan.file_id == file_id
        self.allowed = False


class FileEgress:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.requests = []

    def request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        self.requests.append((method, url, kwargs))
        headers = kwargs["headers"]
        assert isinstance(headers, dict)
        assert "Authorization" not in headers
        assert kwargs["max_retries"] == 0
        assert kwargs["follow_redirects"] is False
        return httpx.Response(
            200,
            content=b"" if method == "HEAD" else self.payload,
            headers={"content-type": "application/pdf", "content-length": str(len(self.payload))},
        )


@pytest.fixture
def file_domain(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[FileDomain]:
    engine = create_engine("sqlite://")
    table = UploadFile.__table__
    assert isinstance(table, Table)
    table.create(engine)
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    # Inject real storage into the legacy FileService seam, not a mock object.
    monkeypatch.setattr("services.file_service.storage", storage)
    files = FileService(session_factory=sessions)
    lifecycle = Lifecycle()
    egress = FileEgress(b"%PDF-result")
    adapter = DifyFileAdapter(
        sessions=sessions, storage=storage, files=files, lifecycle=lifecycle, remote_transport=BoundedTransport(egress)
    )
    yield adapter, files, lifecycle, sessions, egress
    engine.dispose()


def scope(
    *, tenant: str = "tenant-a", actor: str = "actor-a", role: Literal["account", "end_user"] = "end_user"
) -> FileScope:
    return FileScope(
        tenant_id=tenant,
        app_id=None,
        actor_id=actor,
        invocation_id="invocation-a",
        actor_role=role,
        lease_id="test-lease",
    )


def test_read_reconstructs_tenant_and_user_ownership_before_storage(file_domain: FileDomain) -> None:
    adapter, files, _, _, _ = file_domain
    uploaded = files.upload_file_for_actor(
        actor=FileUploadActor(id="actor-a", creator_role=CreatorUserRole.END_USER),
        resource_tenant_id="tenant-a",
        filename="report.txt",
        content=b"owned",
        mimetype="text/plain",
    )
    ref = FileReference(file_id=uploaded.id)
    assert adapter.read_authorized(scope(), ref, max_bytes=10).data == b"owned"
    for other in [scope(tenant="tenant-b"), scope(actor="actor-b")]:
        with pytest.raises(ExternalIOError) as error:
            adapter.read_authorized(other, ref, max_bytes=10)
        assert error.value.code == "file_not_available"


def test_materialization_is_durable_and_idempotent_per_part(file_domain: FileDomain) -> None:
    adapter, _, _, sessions, _ = file_domain
    part: JsonObject = {
        "raw": base64.b64encode(b"%PDF-raw").decode(),
        "filename": "report.pdf",
        "mediaType": "application/pdf",
    }
    first = adapter.materialize(scope(), part, artifact_id="report", part_index=0)
    second = adapter.materialize(scope(), part, artifact_id="report", part_index=0)
    assert first == second
    assert first.value["transfer_method"] == "local_file"
    assert "url" not in first.value
    assert "raw" not in first.value
    with sessions() as session:
        rows = session.scalars(select(UploadFile)).all()
    assert len(rows) == 1
    assert rows[0].tenant_id == "tenant-a"


def test_revoked_lease_does_not_reuse_or_rematerialize_old_file(file_domain: FileDomain) -> None:
    adapter, _, lifecycle, sessions, _ = file_domain
    part: JsonObject = {"raw": base64.b64encode(b"owned").decode(), "filename": "report.txt", "mediaType": "text/plain"}
    adapter.materialize(scope(), part, artifact_id="report", part_index=0)
    lifecycle.allowed = False
    with pytest.raises(ExternalIOError) as error:
        adapter.materialize(scope(), part, artifact_id="report", part_index=0)
    assert error.value.code == "file_scope_revoked"
    with sessions() as session:
        assert len(session.scalars(select(UploadFile)).all()) == 1


def test_url_file_is_fetched_without_agent_credentials_and_stored_locally(file_domain: FileDomain) -> None:
    adapter, _, _, _, egress = file_domain
    stored = adapter.materialize(
        scope(),
        {"url": "https://files.example/report?sig=secret", "filename": "report.pdf", "mediaType": "application/pdf"},
        artifact_id="report",
        part_index=0,
    )
    assert stored.size == len(b"%PDF-result")
    assert [entry[0] for entry in egress.requests] == ["HEAD", "GET"]
    assert "secret" not in str(stored.value)


def test_raw_size_failure_happens_before_upload(file_domain: FileDomain) -> None:
    adapter, _, _, sessions, _ = file_domain
    with pytest.raises(ExternalIOError):
        adapter.materialize(
            scope(),
            {"raw": base64.b64encode(b"too-large").decode(), "filename": "r.txt", "mediaType": "text/plain"},
            artifact_id="report",
            part_index=0,
            max_bytes=1,
        )
    with sessions() as session:
        assert list(session.scalars(select(UploadFile))) == []


def test_crash_after_upload_reuses_the_previously_reserved_storage_and_db_identity(file_domain: FileDomain) -> None:
    adapter, _files, lifecycle, sessions, _egress = file_domain
    part: JsonObject = {"raw": base64.b64encode(b"owned").decode(), "filename": "report.txt", "mediaType": "text/plain"}
    lifecycle.crash_before_binding = True
    with pytest.raises(SystemExit, match="process loss"):
        adapter.materialize(scope(), part, artifact_id="report", part_index=0)
    with sessions() as session:
        first = session.scalar(select(UploadFile))
        assert first is not None
        first_id, first_key = first.id, first.key
    restored = adapter.materialize(scope(), part, artifact_id="report", part_index=0)
    assert restored.file_id == first_id
    with sessions() as session:
        rows = tuple(session.scalars(select(UploadFile)))
        assert len(rows) == 1
        assert rows[0].key == first_key


def test_a_shared_batch_deadline_blocks_the_next_file_without_new_network_or_storage(file_domain: FileDomain) -> None:
    adapter, _files, _lifecycle, sessions, egress = file_domain
    expired = replace(scope(), io_deadline=datetime.now(UTC) - timedelta(seconds=1))
    with pytest.raises(ExternalIOError) as error:
        adapter.materialize(
            expired,
            {"url": "https://files.example/report", "filename": "r.pdf", "mediaType": "application/pdf"},
            artifact_id="late",
            part_index=0,
        )
    assert error.value.code == "file_io_deadline_exceeded"
    assert egress.requests == []
    with sessions() as session:
        assert tuple(session.scalars(select(UploadFile))) == ()


@pytest.fixture
def source_lifecycle_domain(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[SourceLifecycleDomain]:
    engine = create_engine("sqlite://")
    for model in (
        UploadFile,
        App,
        ExternalAgentInvocation,
        ExternalAgentFileLease,
        ExternalAgentContextSlot,
        ExternalAgentDataTombstone,
    ):
        table = model.__table__
        assert isinstance(table, Table)
        table.create(engine)
    sessions = sessionmaker(engine, expire_on_commit=False)
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    monkeypatch.setattr("services.file_service.storage", storage)
    files = FileService(session_factory=sessions)
    tenant, actor, consumer_app, consumer, producer = (str(uuid4()) for _ in range(5))
    with sessions.begin() as session:
        session.add(
            App(
                id=consumer_app,
                tenant_id=tenant,
                name="Consumer",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        for identifier, app_id, origin in ((consumer, consumer_app, "production"), (producer, None, "overview_test")):
            session.add(
                ExternalAgentInvocation(
                    id=identifier,
                    tenant_id=tenant,
                    agent_id=str(uuid4()),
                    request_key=identifier,
                    execution_key=identifier,
                    origin=origin,
                    app_id=app_id,
                    initiator_id=actor,
                    job_config={"page_session_id": "producer-page"} if app_id is None else {},
                )
            )
    scope = FileScope(
        tenant_id=tenant, app_id=consumer_app, actor_id=actor, actor_role="account", invocation_id=consumer
    )
    adapter = DifyFileAdapter(
        sessions=sessions,
        storage=storage,
        files=files,
        lifecycle=ExternalFileLifecycleRepository(sessions=sessions),
        remote_transport=BoundedTransport(FileEgress(b"")),
    )
    yield adapter, files, sessions, storage, scope, producer
    engine.dispose()


@pytest.mark.parametrize("revocation", ["released", "expired", "active"])
def test_revoked_overview_copy_cannot_be_revived_as_production_input_before_physical_gc(
    source_lifecycle_domain: SourceLifecycleDomain, revocation: str
) -> None:
    adapter, files, sessions, storage, scope, producer = source_lifecycle_domain
    uploaded = files.upload_file_for_actor(
        actor=FileUploadActor(id=scope.actor_id, creator_role=CreatorUserRole.ACCOUNT),
        resource_tenant_id=scope.tenant_id,
        filename="old-test.txt",
        content=b"old overview bytes",
        mimetype="text/plain",
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    with sessions.begin() as session:
        session.add(
            ExternalAgentFileLease(
                id=str(uuid4()),
                tenant_id=scope.tenant_id,
                file_id=uploaded.id,
                owner_id=scope.actor_id,
                agent_id=str(uuid4()),
                purpose="input",
                invocation_id=producer,
                page_session_id="producer-page",
                temporary_copy=True,
                write_state="committed",
                expires_at=now - timedelta(seconds=1) if revocation == "expired" else now + timedelta(hours=1),
                released_at=now if revocation == "released" else None,
            )
        )
        row = session.get(UploadFile, uploaded.id)
        assert row is not None
        key = row.key
    assert storage.exists(key)
    with pytest.raises(ExternalIOError):
        adapter.read_authorized(scope, FileReference(file_id=uploaded.id), max_bytes=1024)


def production_source(domain: SourceLifecycleDomain, *, legacy_noncopy: bool = False) -> tuple[str, str]:
    _adapter, files, sessions, _storage, scope, producer = domain
    uploaded = files.upload_file_for_actor(
        actor=FileUploadActor(id=scope.actor_id, creator_role=CreatorUserRole.ACCOUNT),
        resource_tenant_id=scope.tenant_id,
        filename="produced.txt",
        content=b"produced bytes",
        mimetype="text/plain",
    )
    source_app, lease_id = str(uuid4()), str(uuid4())
    with sessions.begin() as session:
        session.add(
            App(
                id=source_app,
                tenant_id=scope.tenant_id,
                name="Source",
                mode=AppMode.WORKFLOW,
                enable_site=False,
                enable_api=False,
            )
        )
        row = session.get(ExternalAgentInvocation, producer)
        assert row is not None
        row.app_id = source_app
        row.origin = "production"
        row.job_config = {}
        session.add(
            ExternalAgentFileLease(
                id=lease_id,
                tenant_id=scope.tenant_id,
                file_id=uploaded.id,
                owner_id=scope.actor_id,
                agent_id=row.agent_id,
                purpose="output",
                invocation_id=producer,
                temporary_copy=not legacy_noncopy,
                write_state="committed",
                expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            )
        )
    return uploaded.id, lease_id


def test_ordinary_shared_original_without_byoa_origin_keeps_existing_file_access_policy(
    source_lifecycle_domain: SourceLifecycleDomain,
) -> None:
    adapter, files, _sessions, _storage, scope, _producer = source_lifecycle_domain
    uploaded = files.upload_file_for_actor(
        actor=FileUploadActor(id=str(uuid4()), creator_role=CreatorUserRole.ACCOUNT),
        resource_tenant_id=scope.tenant_id,
        filename="shared.txt",
        content=b"shared bytes",
        mimetype="text/plain",
    )
    assert adapter.read_authorized(scope, FileReference(file_id=uploaded.id), max_bytes=1024).data == b"shared bytes"


@pytest.mark.parametrize("legacy_noncopy", [False, True])
def test_live_production_output_can_feed_authorized_consumer_but_revoked_parent_cannot(
    source_lifecycle_domain: SourceLifecycleDomain, legacy_noncopy: bool
) -> None:
    adapter, _files, sessions, _storage, scope, producer = source_lifecycle_domain
    file_id, _lease = production_source(source_lifecycle_domain, legacy_noncopy=legacy_noncopy)
    assert adapter.read_authorized(scope, FileReference(file_id=file_id), max_bytes=1024).data == b"produced bytes"
    with sessions.begin() as session:
        session.add(
            ExternalAgentDataTombstone(
                id=str(uuid4()),
                tenant_id=scope.tenant_id,
                owner_kind="invocation",
                owner_id=producer,
                deleted_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
    with pytest.raises(ExternalIOError, match="source"):
        adapter.read_authorized(scope, FileReference(file_id=file_id), max_bytes=1024)


@pytest.mark.parametrize("revocation", ["released", "expired"])
def test_new_input_grant_cannot_launder_a_revoked_production_origin(
    source_lifecycle_domain: SourceLifecycleDomain, revocation: str
) -> None:
    adapter, _files, sessions, _storage, scope, _producer = source_lifecycle_domain
    file_id, lease_id = production_source(source_lifecycle_domain)
    now = datetime.now(UTC).replace(tzinfo=None)
    with sessions.begin() as session:
        source = session.get(ExternalAgentFileLease, lease_id)
        assert source is not None
        if revocation == "released":
            source.released_at = now
        else:
            source.expires_at = now - timedelta(seconds=1)
        session.add(
            ExternalAgentFileLease(
                id=str(uuid4()),
                tenant_id=scope.tenant_id,
                file_id=file_id,
                owner_id=scope.actor_id,
                invocation_id=scope.invocation_id,
                purpose="input_grant",
                temporary_copy=False,
                write_state="committed",
                expires_at=now + timedelta(hours=1),
            )
        )
    with pytest.raises(ExternalIOError, match="source"):
        adapter.read_authorized(scope, FileReference(file_id=file_id), max_bytes=1024)


def test_source_parent_revoked_during_storage_read_is_rechecked_before_returning_bytes(
    source_lifecycle_domain: SourceLifecycleDomain,
) -> None:
    _adapter, files, sessions, storage, scope, producer = source_lifecycle_domain
    file_id, _lease = production_source(source_lifecycle_domain)

    class ParentRevokingStorage(Storage):
        @override
        def load_stream(self, filename: str) -> Generator[bytes]:
            yield from storage.load_stream(filename)
            with sessions.begin() as session:
                session.add(
                    ExternalAgentDataTombstone(
                        id=str(uuid4()),
                        tenant_id=scope.tenant_id,
                        owner_kind="invocation",
                        owner_id=producer,
                        deleted_at=datetime.now(UTC).replace(tzinfo=None),
                    )
                )

    adapter = DifyFileAdapter(
        sessions=sessions,
        storage=ParentRevokingStorage(),
        files=files,
        lifecycle=ExternalFileLifecycleRepository(sessions=sessions),
        remote_transport=BoundedTransport(FileEgress(b"")),
    )
    with pytest.raises(ExternalIOError, match="source"):
        adapter.read_authorized(scope, FileReference(file_id=file_id), max_bytes=1024)


def test_overview_input_requires_its_exact_live_bound_lease_but_survives_page_leave(
    source_lifecycle_domain: SourceLifecycleDomain,
) -> None:
    adapter, files, sessions, _storage, scope, _producer = source_lifecycle_domain
    scope = replace(scope, app_id=None)
    lease_id = str(uuid4())
    uploaded = files.upload_file_for_actor(
        actor=FileUploadActor(id=scope.actor_id, creator_role=CreatorUserRole.ACCOUNT),
        resource_tenant_id=scope.tenant_id,
        filename="bound.txt",
        content=b"bound input",
        mimetype="text/plain",
    )
    with sessions.begin() as session:
        consumer = session.get(ExternalAgentInvocation, scope.invocation_id)
        assert consumer is not None
        consumer.app_id, consumer.origin = None, "overview_test"
        consumer.job_config = {"page_session_id": "current-page", "input_lease_ids": [lease_id]}
        session.add(
            ExternalAgentFileLease(
                id=lease_id,
                tenant_id=scope.tenant_id,
                file_id=uploaded.id,
                owner_id=scope.actor_id,
                agent_id=consumer.agent_id,
                invocation_id=consumer.id,
                purpose="input",
                temporary_copy=True,
                page_session_id="current-page",
                write_state="committed",
                expires_at=datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=1),
            )
        )
        session.add(
            ExternalAgentDataTombstone(
                id=str(uuid4()),
                tenant_id=scope.tenant_id,
                owner_kind="test_page",
                owner_id=sha256(f"{scope.actor_id}:current-page".encode()).hexdigest(),
                deleted_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
    assert adapter.read_authorized(scope, FileReference(file_id=uploaded.id), max_bytes=1024).data == b"bound input"
    with sessions.begin() as session:
        consumer = session.get(ExternalAgentInvocation, scope.invocation_id)
        assert consumer is not None
        consumer.job_config = {
            "page_session_id": "current-page",
            "input_lease_ids": [],
        }
    with pytest.raises(ExternalIOError, match="source"):
        adapter.read_authorized(scope, FileReference(file_id=uploaded.id), max_bytes=1024)
