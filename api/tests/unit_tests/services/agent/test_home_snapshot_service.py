from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.agent import (
    AgentConfigDraft,
    AgentConfigDraftType,
    AgentConfigSnapshot,
    AgentHomeSnapshot,
    AgentWorkingResourceStatus,
)
from models.agent_config_entities import AgentSoulConfig
from services.agent.errors import AgentBuildSandboxNotFoundError
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.resource_creation_compensation import (
    ResourceCreationCompensations,
    resource_creation_transaction,
)


class _Transaction:
    def __init__(self, *, commit_error: Exception | None = None) -> None:
        self._commit_error = commit_error

    def __enter__(self) -> None:
        return None

    def __exit__(self, exc_type, exc, traceback) -> bool:
        if exc_type is None and self._commit_error is not None:
            raise self._commit_error
        return False


class _Session:
    def __init__(self, *, flush_error: Exception | None = None, commit_error: Exception | None = None) -> None:
        self.info: dict[str, object] = {}
        self._flush_error = flush_error
        self._commit_error = commit_error
        self.added: list[object] = []

    def begin(self) -> _Transaction:
        return _Transaction(commit_error=self._commit_error)

    def add(self, value: object) -> None:
        self.added.append(value)

    def flush(self) -> None:
        if self._flush_error is not None:
            raise self._flush_error


def _build_draft() -> AgentConfigDraft:
    return AgentConfigDraft(
        id="build-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        draft_type=AgentConfigDraftType.DEBUG_BUILD,
        account_id="account-1",
        draft_owner_key="account-1",
        home_snapshot_id="home-old",
        config_snapshot=AgentSoulConfig(),
    )


def _client(*, snapshot_ref: str = "snapshot-ref-1") -> MagicMock:
    client = MagicMock()
    client.initialize_home_snapshot_sync.return_value = SimpleNamespace(snapshot_ref=snapshot_ref)
    client.create_home_snapshot_from_binding_sync.return_value = SimpleNamespace(snapshot_ref=snapshot_ref)
    return client


def _raise_business_failure(session: _Session, compensate: MagicMock) -> None:
    with resource_creation_transaction(session) as compensations:  # type: ignore[arg-type]
        compensations.register(key="test-resource", compensate=compensate)
        raise RuntimeError("business failed")


def test_create_initial_persists_backend_snapshot_ref(monkeypatch) -> None:
    session = MagicMock()
    client = _client()
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    snapshot = AgentHomeSnapshotService.create_initial(
        session=session,
        tenant_id="tenant-1",
        agent_id="agent-1",
    )

    assert snapshot.snapshot_ref == "snapshot-ref-1"
    assert snapshot.status is AgentWorkingResourceStatus.ACTIVE
    session.add.assert_called_once_with(snapshot)
    session.flush.assert_called_once_with()


def test_create_initial_flush_failure_compensates_locally(monkeypatch) -> None:
    session = MagicMock()
    session.flush.side_effect = RuntimeError("flush failed")
    client = _client()
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    with pytest.raises(RuntimeError, match="flush failed"):
        AgentHomeSnapshotService.create_initial(
            session=session,
            tenant_id="tenant-1",
            agent_id="agent-1",
        )

    client.delete_home_snapshot_sync.assert_called_once_with("snapshot-ref-1")


def test_build_apply_checkpoints_exact_active_binding(monkeypatch) -> None:
    session = MagicMock()
    session.scalar.return_value = SimpleNamespace(backend_binding_ref="binding-ref-1")
    client = _client(snapshot_ref="snapshot-ref-2")
    monkeypatch.setattr(AgentHomeSnapshotService, "_client", lambda: nullcontext(client))

    snapshot = AgentHomeSnapshotService.create_for_build_apply(
        session=session,
        build_draft=_build_draft(),
        source_binding_id="binding-1",
        compensations=ResourceCreationCompensations(),
    )

    request = client.create_home_snapshot_from_binding_sync.call_args.args[0]
    assert request.backend_binding_ref == "binding-ref-1"
    assert snapshot.snapshot_ref == "snapshot-ref-2"


def test_build_apply_fails_fast_without_source_binding() -> None:
    session = MagicMock()
    session.scalar.return_value = None

    with pytest.raises(AgentBuildSandboxNotFoundError):
        AgentHomeSnapshotService.create_for_build_apply(
            session=session,
            build_draft=_build_draft(),
            source_binding_id="missing-binding",
            compensations=ResourceCreationCompensations(),
        )


def test_business_failure_before_final_flush_compensates_once() -> None:
    session = _Session()
    compensate = MagicMock()

    with pytest.raises(RuntimeError, match="business failed"):
        _raise_business_failure(session, compensate)

    compensate.assert_called_once_with()


def test_final_flush_failure_compensates_once() -> None:
    session = _Session(flush_error=RuntimeError("flush failed"))
    compensate = MagicMock()

    with pytest.raises(RuntimeError, match="flush failed"):
        with resource_creation_transaction(session) as compensations:  # type: ignore[arg-type]
            compensations.register(key="test-resource", compensate=compensate)

    compensate.assert_called_once_with()


def test_commit_exception_after_final_flush_does_not_compensate() -> None:
    session = _Session(commit_error=RuntimeError("commit response lost"))
    compensate = MagicMock()

    with pytest.raises(RuntimeError, match="commit response lost"):
        with resource_creation_transaction(session) as compensations:  # type: ignore[arg-type]
            compensations.register(key="test-resource", compensate=compensate)

    compensate.assert_not_called()


def test_successful_commit_does_not_compensate() -> None:
    session = _Session()
    compensate = MagicMock()

    with resource_creation_transaction(session) as compensations:  # type: ignore[arg-type]
        compensations.register(key="test-resource", compensate=compensate)

    compensate.assert_not_called()


def test_home_snapshot_collection_database_failure_is_best_effort(monkeypatch) -> None:
    context = MagicMock()
    session = context.__enter__.return_value
    session.scalar.side_effect = RuntimeError("database unavailable")
    log_exception = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: context,
    )
    monkeypatch.setattr("services.agent.home_snapshot_service.logger.exception", log_exception)

    AgentHomeSnapshotService.collect_retired_home_snapshot(
        tenant_id="tenant-1",
        home_snapshot_id="home-1",
    )

    session.scalar.assert_called_once()
    log_exception.assert_called_once_with(
        "Failed to collect retired Agent Home Snapshot",
        extra={"tenant_id": "tenant-1", "home_snapshot_id": "home-1"},
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [(AgentHomeSnapshot, AgentConfigDraft, AgentConfigSnapshot)],
    indirect=True,
)
def test_home_snapshot_collection_final_delete_failure_is_best_effort(
    monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
) -> None:
    snapshot = AgentHomeSnapshot(
        id="home-1",
        tenant_id="tenant-1",
        agent_id="agent-1",
        snapshot_ref="snapshot-ref-1",
        status=AgentWorkingResourceStatus.RETIRED,
    )
    sqlite_session.add(snapshot)
    sqlite_session.commit()
    commit = MagicMock(side_effect=RuntimeError("database unavailable"))
    delete = MagicMock()
    monkeypatch.setattr(
        "services.agent.home_snapshot_service.session_factory.create_session",
        lambda: nullcontext(sqlite_session),
    )
    monkeypatch.setattr(sqlite_session, "commit", commit)
    monkeypatch.setattr(AgentHomeSnapshotService, "delete", delete)

    AgentHomeSnapshotService.collect_retired_home_snapshot(
        tenant_id="tenant-1",
        home_snapshot_id="home-1",
    )

    delete.assert_called_once_with(snapshot_ref="snapshot-ref-1")
