"""Build collection intents must be atomic, bounded and settled only by cleanup."""

import runpy
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from datetime import timedelta
from pathlib import Path
from threading import Barrier
from typing import TypedDict
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, Engine, create_engine, event, inspect, select
from sqlalchemy.orm import Session

from libs.datetime_utils import naive_utc_now
from models.agent import AgentBuildCollectionRequest, AgentWorkspace, AgentWorkspaceBinding
from repositories.agent_build_collection_repository import AgentBuildCollectionRepository
from repositories.agent_workspace_repository import AgentWorkspaceRepository
from services.agent.workspace_service import AgentWorkspaceService
from tasks.collect_agent_resources_task import reconcile_agent_build_collections
from tests.unit_tests.controllers.console.agent.test_agent_build_session import (
    BuildState,
    _RecordingBackendClient,
    observe_collection_publication,
)
from tests.unit_tests.controllers.console.agent.test_api_access import Harness

pytest_plugins = ("tests.unit_tests.controllers.console.agent.test_agent_build_session",)


class _PublishedCollection(TypedDict):
    tenant_id: str
    binding_ids: list[str]
    workspace_ids: list[str]
    home_snapshot_ids: list[str]
    purge_agent_ids: list[str]


def _retire_and_stage(harness: Harness, build_state: BuildState) -> None:
    """Commit an actual retired binding and its recovery intent."""
    with harness.sessions.begin() as session:
        AgentWorkspaceRepository(session=session).retire_binding(
            tenant_id=harness.tenant_id, binding_id=build_state.binding_id
        )
        AgentBuildCollectionRepository(harness.sessions).stage(
            session=session,
            tenant_id=harness.tenant_id,
            binding_id=build_state.binding_id,
        )


def test_claim_cas_and_attempt_limit_keep_the_pending_row(
    harness: Harness, build_state: BuildState, sqlite_engine: Engine
) -> None:
    _retire_and_stage(harness, build_state)
    repository = AgentBuildCollectionRepository(harness.sessions)
    barrier = Barrier(2)

    def pause_before_select(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        """Synchronize both actual SELECT statements at the database boundary."""
        if statement.lstrip().startswith("SELECT") and "agent_build_collection_requests" in statement:
            barrier.wait(timeout=20)

    event.listen(sqlite_engine, "before_cursor_execute", pause_before_select)
    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            claims = list(
                workers.map(
                    lambda _: repository.claim_next(
                        tenant_id=harness.tenant_id,
                        binding_id=build_state.binding_id,
                        retry_interval_seconds=3600.0,
                        max_attempts=2,
                    ),
                    range(2),
                )
            )
    finally:
        event.remove(sqlite_engine, "before_cursor_execute", pause_before_select)
    assert len([claim for claim in claims if claim is not None]) == 1

    second = repository.claim_next(
        tenant_id=harness.tenant_id,
        binding_id=build_state.binding_id,
        retry_interval_seconds=0.0,
        max_attempts=2,
    )
    assert second is not None
    assert second.attempt_count == 2
    repository.record_error(intent=second, error_type="RuntimeError")
    assert (
        repository.claim_next(
            tenant_id=harness.tenant_id,
            binding_id=build_state.binding_id,
            retry_interval_seconds=0.0,
            max_attempts=2,
        )
        is None
    )
    exhausted = repository.exhausted(max_attempts=2)
    assert len(exhausted) == 1
    assert exhausted[0].binding_id == build_state.binding_id
    assert exhausted[0].last_error == "RuntimeError"

    with harness.sessions.begin() as session:
        assert (
            session.scalar(
                select(AgentBuildCollectionRequest).where(
                    AgentBuildCollectionRequest.binding_id == build_state.binding_id
                )
            )
            is not None
        )
        assert not repository.complete(
            session=session,
            tenant_id=harness.tenant_id,
            binding_id=build_state.binding_id,
            expected_attempt=1,
        )
        assert repository.complete(
            session=session,
            tenant_id=harness.tenant_id,
            binding_id=build_state.binding_id,
            expected_attempt=2,
        )


def test_failed_external_cleanup_keeps_intent_until_success(
    harness: Harness, build_state: BuildState, monkeypatch: pytest.MonkeyPatch
) -> None:
    _retire_and_stage(harness, build_state)
    client = _RecordingBackendClient()
    client.error = RuntimeError("backend not ready")
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))

    with pytest.raises(RuntimeError, match="backend not ready"):
        AgentWorkspaceService.collect_retired_binding(tenant_id=harness.tenant_id, binding_id=build_state.binding_id)
    with harness.sessions() as session:
        assert session.scalar(select(AgentBuildCollectionRequest)) is not None
        assert session.get(AgentWorkspaceBinding, build_state.binding_id) is not None

    client.error = None
    AgentWorkspaceService.collect_retired_binding(tenant_id=harness.tenant_id, binding_id=build_state.binding_id)
    with harness.sessions() as session:
        assert session.scalar(select(AgentBuildCollectionRequest)) is None
        assert session.get(AgentWorkspaceBinding, build_state.binding_id) is None
    AgentWorkspaceService.collect_retired_binding(tenant_id=harness.tenant_id, binding_id=build_state.binding_id)


@pytest.mark.parametrize("active_sibling", [False, True], ids=["workspace-cleanup", "binding-cleanup"])
def test_slow_cleanup_does_not_settle_a_newer_attempt(
    harness: Harness, build_state: BuildState, active_sibling: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An older worker cannot settle a retry claimed during backend cleanup."""
    if active_sibling:
        with harness.sessions.begin() as session:
            original = session.get_one(AgentWorkspaceBinding, build_state.binding_id)
            session.add(
                AgentWorkspaceBinding(
                    tenant_id=original.tenant_id,
                    app_id=original.app_id,
                    workspace_id=original.workspace_id,
                    agent_id=original.agent_id,
                    base_home_snapshot_id=original.base_home_snapshot_id,
                    agent_config_version_id=original.agent_config_version_id,
                    agent_config_version_kind=original.agent_config_version_kind,
                    backend_binding_ref="active-sibling",
                )
            )
    _retire_and_stage(harness, build_state)
    repository = AgentBuildCollectionRepository(harness.sessions)
    first = repository.claim_next(retry_interval_seconds=0.0)
    assert first is not None
    assert first.attempt_count == 1
    client = _RecordingBackendClient()

    def claim_newer_attempt_during_cleanup(_request: object) -> None:
        newer = repository.claim_next(retry_interval_seconds=0.0)
        assert newer is not None
        assert newer.attempt_count == 2

    client.on_destroy = claim_newer_attempt_during_cleanup
    monkeypatch.setattr(AgentWorkspaceService, "_client", lambda: nullcontext(client))

    AgentWorkspaceService.collect_retired_binding(tenant_id=harness.tenant_id, binding_id=build_state.binding_id)
    request = client.requests[0]
    assert request.destroy_workspace is not active_sibling
    with harness.sessions() as session:
        assert session.get(AgentWorkspaceBinding, build_state.binding_id) is None
        assert (session.get(AgentWorkspace, build_state.workspace_id) is not None) is active_sibling
        pending = session.scalar(select(AgentBuildCollectionRequest))
        assert pending is not None
        assert pending.attempt_count == 2

    AgentWorkspaceService.collect_retired_binding(tenant_id=harness.tenant_id, binding_id=build_state.binding_id)
    assert len(client.requests) == 1
    with harness.sessions() as session:
        assert session.scalar(select(AgentBuildCollectionRequest)) is None


@pytest.mark.usefixtures("memory_broker")
def test_reconcile_dispatches_each_pending_binding_once_per_batch(harness: Harness) -> None:
    """A zero-delay batch publishes two pending bindings once each."""
    binding_ids = {str(uuid4()), str(uuid4())}
    with harness.sessions.begin() as session:
        session.add_all(
            AgentBuildCollectionRequest(tenant_id=harness.tenant_id, binding_id=binding_id)
            for binding_id in sorted(binding_ids)
        )
    published: list[_PublishedCollection] = []

    def on_publish(body: tuple[object, _PublishedCollection, object], **_kwargs: object) -> None:
        published.append(body[1])

    with observe_collection_publication(on_publish):
        outcome = reconcile_agent_build_collections(retry_interval_seconds=0.0)

    assert outcome == {"published": 2, "failed": 0, "exhausted": 0}
    assert sorted(payload["binding_ids"][0] for payload in published) == sorted(binding_ids)
    assert all(
        payload["tenant_id"] == harness.tenant_id
        and payload["workspace_ids"] == []
        and payload["home_snapshot_ids"] == []
        and payload["purge_agent_ids"] == []
        for payload in published
    )
    with harness.sessions() as session:
        rows = session.scalars(select(AgentBuildCollectionRequest)).all()
        assert {(row.binding_id, row.attempt_count, row.last_error) for row in rows} == {
            (binding_id, 1, None) for binding_id in binding_ids
        }


def test_collection_request_migration_upgrade_and_downgrade(tmp_path: Path) -> None:
    api_root = next(parent for parent in Path(__file__).resolve().parents if parent.name == "api")
    migration = api_root / "migrations/versions/2026_11_21_2200-e8a2b5f41c6d_add_agent_build_collection_requests.py"
    engine = create_engine(f"sqlite+pysqlite:///{tmp_path / 'migration.sqlite'}")
    table = "agent_build_collection_requests"
    with engine.begin() as connection, Operations.context(MigrationContext.configure(connection)) as op:
        module = runpy.run_path(str(migration), {"op": op})
        assert module["down_revision"] == "f8b6e2c4a901"
        module["upgrade"]()
        assert inspect(connection).has_table(table)
        indexes = inspect(connection).get_indexes(table)
        unique = [index for index in indexes if index["unique"]]
        assert len(unique) == 1
        assert set(unique[0]["column_names"]) == {"tenant_id", "binding_id"}
        with Session(bind=connection) as session:
            request = AgentBuildCollectionRequest(
                tenant_id=str(uuid4()),
                binding_id=str(uuid4()),
                attempt_count=0,
                last_attempt_at=naive_utc_now() - timedelta(seconds=1),
            )
            session.add(request)
            session.commit()
            assert session.scalar(select(AgentBuildCollectionRequest.attempt_count)) == 0
            session.delete(request)
            session.commit()
        module["downgrade"]()
        assert not inspect(connection).has_table(table)
    engine.dispose()
