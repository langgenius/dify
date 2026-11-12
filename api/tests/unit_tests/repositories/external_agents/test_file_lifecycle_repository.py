"""Real stored-part uniqueness and page/parent revocation boundaries."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from models.base import TypeBase
from models.external_agent import ExternalAgentContextSlot, ExternalAgentFileLease, ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentDataTombstone
from models.model import App
from repositories.external_agents.file_lifecycle_repository import ExternalFileLifecycleRepository
from services.external_agents.io_contracts import ExternalIOError, FileBlob, FileScope, StoredFile

type LifecycleDomain = tuple[ExternalFileLifecycleRepository, sessionmaker[Session], FileScope]


def uid() -> str:
    return str(uuid4())


@pytest.fixture
def lifecycle() -> Iterator[LifecycleDomain]:
    engine = create_engine("sqlite://")
    TypeBase.metadata.create_all(
        engine,
        tables=[
            TypeBase.metadata.tables[value.__tablename__]
            for value in (
                App,
                ExternalAgentInvocation,
                ExternalAgentContextSlot,
                ExternalAgentFileLease,
                ExternalAgentDataTombstone,
            )
        ],
    )
    sessions = sessionmaker(engine, expire_on_commit=False)
    scope = FileScope(tenant_id=uid(), app_id=None, actor_id=uid(), invocation_id=uid())
    with sessions.begin() as session:
        session.add(
            ExternalAgentInvocation(
                id=scope.invocation_id,
                tenant_id=scope.tenant_id,
                agent_id=uid(),
                request_key=uid(),
                execution_key=uid(),
                origin="overview_test",
                initiator_id=scope.actor_id,
                job_config={"page_session_id": "page"},
            )
        )
    yield ExternalFileLifecycleRepository(sessions=sessions), sessions, scope
    engine.dispose()


def only_lease(session: Session) -> ExternalAgentFileLease:
    row = session.scalar(select(ExternalAgentFileLease))
    assert row is not None
    return row


def stored() -> StoredFile:
    identifier = uid()
    return StoredFile(file_id=identifier, value={"upload_file_id": identifier}, size=4, media_type="text/plain")


def test_write_intent_precedes_upload_and_crash_reentry_keeps_exact_owned_plan(lifecycle: LifecycleDomain) -> None:
    repo, sessions, scope = lifecycle
    blob = FileBlob(filename="result.txt", media_type="text/plain", data=b"data")
    first_id = uid()
    first = repo.prepare_stored(
        scope,
        blob,
        artifact_id="artifact",
        part_index=0,
        file_id=first_id,
        storage_key=f"upload_files/{scope.tenant_id}/{first_id}.txt",
    )
    with sessions() as session:
        intent = only_lease(session)
        assert intent.write_state == "planned"
        assert intent.file_value is None
        assert intent.storage_key == first.storage_key
        assert intent.content_hash == sha256(blob.data).hexdigest()
        original_expiry = intent.expires_at
    repeated = repo.prepare_stored(
        scope, blob, artifact_id="artifact", part_index=0, file_id=uid(), storage_key="a-different-plan"
    )
    assert repeated == first
    file = StoredFile(file_id=first.file_id, value={"upload_file_id": first.file_id}, size=4, media_type="text/plain")
    repo.record_stored(scope, artifact_id="artifact", part_index=0, file=file)
    with sessions() as session:
        intent = only_lease(session)
        assert intent.write_state == "committed"
        assert intent.expires_at == original_expiry
        assert len(tuple(session.scalars(select(ExternalAgentFileLease)))) == 1


def test_pending_content_cannot_change_on_reentry_or_revive_after_abort(lifecycle: LifecycleDomain) -> None:
    repo, _, scope = lifecycle
    blob = FileBlob(filename="result.txt", media_type="text/plain", data=b"data")
    plan = repo.prepare_stored(
        scope, blob, artifact_id="artifact", part_index=0, file_id=uid(), storage_key="owned-key"
    )
    with pytest.raises(ExternalIOError) as error:
        repo.prepare_stored(
            scope,
            replace(blob, data=b"changed"),
            artifact_id="artifact",
            part_index=0,
            file_id=uid(),
            storage_key="other-key",
        )
    assert error.value.code == "file_content_changed"
    repo.abort_stored(scope, artifact_id="artifact", part_index=0, file_id=plan.file_id)
    with pytest.raises(ExternalIOError):
        repo.prepare_stored(scope, blob, artifact_id="artifact", part_index=0, file_id=uid(), storage_key="other-key")


def test_part_materialization_is_unique_and_never_extends_fixed_expiry(lifecycle: LifecycleDomain) -> None:
    repo, sessions, scope = lifecycle
    first = stored()
    assert repo.record_stored(scope, artifact_id="artifact", part_index=0, file=first) == first
    with sessions() as session:
        expiry = only_lease(session).expires_at
    assert repo.record_stored(scope, artifact_id="artifact", part_index=0, file=stored()) == first
    assert repo.find_stored(scope, artifact_id="artifact", part_index=0) == first
    with sessions() as session:
        assert only_lease(session).expires_at == expiry


def test_full_file_owner_scope_is_enforced(lifecycle: LifecycleDomain) -> None:
    repo, _, scope = lifecycle
    for foreign in (replace(scope, tenant_id=uid()), replace(scope, actor_id=uid()), replace(scope, app_id=uid())):
        with pytest.raises(ExternalIOError):
            repo.ensure_access(foreign)


def test_page_leave_allows_submitted_input_read_but_forbids_output_revival(lifecycle: LifecycleDomain) -> None:
    repo, sessions, scope = lifecycle
    with sessions.begin() as session:
        session.add(
            ExternalAgentDataTombstone(
                id=uid(),
                tenant_id=scope.tenant_id,
                owner_kind="test_page",
                owner_id=sha256(f"{scope.actor_id}:page".encode()).hexdigest(),
                deleted_at=datetime.now(UTC).replace(tzinfo=None),
            )
        )
    repo.ensure_access(scope)
    with pytest.raises(ExternalIOError):
        repo.find_stored(scope, artifact_id="late", part_index=0)
    with pytest.raises(ExternalIOError):
        repo.record_stored(scope, artifact_id="late", part_index=0, file=stored())


@pytest.mark.parametrize("reason", ["expiry", "parent_delete", "invocation_delete"])
def test_revoked_parent_blocks_existing_and_new_materialization(lifecycle: LifecycleDomain, reason: str) -> None:
    repo, sessions, scope = lifecycle
    repo.record_stored(scope, artifact_id="artifact", part_index=0, file=stored())
    with sessions.begin() as session:
        row = session.get(ExternalAgentInvocation, scope.invocation_id)
        assert row is not None
        now = datetime.now(UTC).replace(tzinfo=None)
        if reason == "expiry":
            row.test_expires_at = now - timedelta(seconds=1)
        elif reason == "invocation_delete":
            row.deleted_at = now
        else:
            session.add(
                ExternalAgentDataTombstone(
                    id=uid(),
                    tenant_id=scope.tenant_id,
                    owner_kind="invocation",
                    owner_id=scope.invocation_id,
                    deleted_at=now,
                )
            )
    with pytest.raises(ExternalIOError):
        repo.find_stored(scope, artifact_id="artifact", part_index=0)
    with pytest.raises(ExternalIOError):
        repo.record_stored(scope, artifact_id="new", part_index=0, file=stored())
