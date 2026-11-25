from __future__ import annotations

import json
from typing import TYPE_CHECKING
from uuid import uuid4

import pytest
from loro import ExportMode, LoroDoc, VersionVector
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from libs.datetime_utils import naive_utc_now
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowLoroDraft, WorkflowType
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.workflow_loro_document import (
    LoroDraftEpochChangedError,
    LoroDraftSyncResult,
    LoroDraftUpdateError,
    project_loro_graph,
)
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account, make_app

if TYPE_CHECKING:
    from loro import LoroValue

GRAPH: dict[str, LoroValue] = {
    "nodes": [{"id": "llm", "data": {"type": "llm", "prompt_template": [{"role": "system", "text": "before"}]}}],
    "edges": [],
}


@pytest.fixture
def draft(sqlite_session: Session) -> tuple[App, Workflow]:
    """Provide a committed JSON draft with no Loro history."""
    app = make_app(app_id=str(uuid4()), tenant_id=str(uuid4()), mode=AppMode.ADVANCED_CHAT)
    draft = Workflow(
        app_id=app.id,
        tenant_id=app.tenant_id,
        created_by=str(uuid4()),
        type=WorkflowType.CHAT,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(GRAPH),
        _features="{}",
    )
    sqlite_session.add(draft)
    sqlite_session.commit()
    return app, draft


@pytest.fixture
def service(sqlite_session_factory: sessionmaker[Session]) -> WorkflowService:
    """Use the test database without a Flask database binding."""
    return WorkflowService(sqlite_session_factory)


def _seed(service: WorkflowService, app: App, draft: Workflow, session: Session) -> tuple[LoroDoc, bytes]:
    """Load the same baseline the browser receives, through the service transaction."""
    result = service.sync_loro_draft(
        app_model=app,
        account_id=draft.created_by,
        epoch=draft.id,
        version=None,
        update=None,
        allow_empty=False,
        session=session,
    )
    assert result.update is not None
    client = LoroDoc()
    client.import_(result.update)
    return client, result.version


def test_first_pull_creates_separate_history_without_changing_the_graph(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow]
) -> None:
    app, row = draft
    graph, updated_at = row.graph, row.updated_at
    assert sqlite_session.get(WorkflowLoroDraft, row.id) is None

    _seed(service, app, row, sqlite_session)

    sqlite_session.refresh(row)
    state = sqlite_session.get_one(WorkflowLoroDraft, row.id)
    assert (state.tenant_id, state.epoch) == (row.tenant_id, row.id)
    assert state.snapshot is not None
    assert (row.graph, row.updated_at) == (graph, updated_at)


def test_draft_read_returns_the_replaced_graph_and_epoch_together(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], draft: tuple[App, Workflow]
) -> None:
    app, cached = draft
    new_epoch = str(uuid4())
    new_graph = {"nodes": [], "edges": []}
    with sqlite_session_factory.begin() as writer:
        workflow = writer.get_one(Workflow, cached.id)
        workflow.graph = json.dumps(new_graph)
        writer.add(WorkflowLoroDraft(workflow_id=workflow.id, tenant_id=workflow.tenant_id, epoch=new_epoch))

    assert cached.graph_dict == GRAPH
    result = WorkflowService.get_draft_workflow_with_loro_epoch(app, session=sqlite_session)
    assert result is not None
    workflow, epoch = result
    assert (workflow.graph_dict, epoch) == (new_graph, new_epoch)


def test_duplicate_loro_update_confirms_original_revision(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow]
) -> None:
    """A dropped ACK is recoverable; resending already committed operations performs no new write."""
    app, row = draft
    client, baseline = _seed(service, app, row, sqlite_session)
    client.get_map("graph").insert("viewport", {"x": 32, "y": 0, "zoom": 1})
    delta = client.export(ExportMode.Updates(VersionVector.decode(baseline)))

    def exchange() -> LoroDraftSyncResult:
        return service.sync_loro_draft(
            app_model=app,
            account_id=row.created_by,
            epoch=row.id,
            version=baseline,
            update=delta,
            allow_empty=False,
            session=sqlite_session,
        )

    first = exchange()
    saved = row.updated_at
    duplicate = exchange()
    assert first.changed
    assert not duplicate.changed
    assert VersionVector.decode(duplicate.version).distance_between(VersionVector.decode(first.version)) == 0
    assert duplicate.hash == first.hash
    assert row.updated_at == saved
    snapshot = sqlite_session.get_one(WorkflowLoroDraft, row.id).snapshot
    assert snapshot is not None
    durable = LoroDoc()
    durable.import_(snapshot)
    assert project_loro_graph(durable) == row.graph_dict
    assert row.graph_dict["viewport"] == {"x": 32, "y": 0, "zoom": 1}


def test_failed_graph_validation_does_not_advance_history(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Failure after writing the projected graph rolls back both history and graph."""
    app, row = draft
    client, baseline = _seed(service, app, row, sqlite_session)
    old_snapshot = sqlite_session.get_one(WorkflowLoroDraft, row.id).snapshot
    client.get_map("graph").insert("viewport", {"x": 32, "y": 0, "zoom": 1})
    delta = client.export(ExportMode.Updates(VersionVector.decode(baseline)))

    def fail_validation(**_kwargs: object) -> None:
        raise ValueError("Invalid agent binding")

    monkeypatch.setattr(WorkflowAgentPublishService, "validate_agent_nodes_for_draft_sync", fail_validation)
    with pytest.raises(ValueError, match="Invalid agent binding"):
        service.sync_loro_draft(
            app_model=app,
            account_id=row.created_by,
            epoch=row.id,
            version=baseline,
            update=delta,
            allow_empty=False,
            session=sqlite_session,
        )
    sqlite_session.rollback()
    assert row.graph_dict == GRAPH
    assert sqlite_session.get_one(WorkflowLoroDraft, row.id).snapshot == old_snapshot


def test_missing_dependencies_do_not_advance_applied_version(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow]
) -> None:
    """An update cannot acknowledge a change whose prerequisite never reached the server."""
    app, row = draft
    client, baseline = _seed(service, app, row, sqlite_session)
    client.get_map("graph").insert("viewport", {"x": 32, "y": 0, "zoom": 1})
    client.commit()
    missing = client.state_vv
    client.get_map("graph").insert("viewport", {"x": 64, "y": 0, "zoom": 1})
    delta = client.export(ExportMode.Updates(missing))

    with pytest.raises(LoroDraftUpdateError, match="causal dependencies"):
        service.sync_loro_draft(
            app_model=app,
            account_id=row.created_by,
            epoch=row.id,
            version=baseline,
            update=delta,
            allow_empty=False,
            session=sqlite_session,
        )
    assert row.graph_dict == GRAPH


def test_ordinary_http_write_retires_old_loro_epoch(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow]
) -> None:
    """Once HTTP owns the draft again, reconnects with an old history cannot overwrite its graph."""
    app, row = draft
    _, old_version = _seed(service, app, row, sqlite_session)
    updated: dict[str, LoroValue] = {"nodes": [], "edges": []}
    service.sync_draft_workflow(
        app_model=app,
        graph=updated,
        features={},
        unique_hash=row.unique_hash,
        account=make_account(account_id=row.created_by),
        environment_variables=[],
        conversation_variables=[],
        session=sqlite_session,
        graph_writer="http",
    )
    assert row.graph_dict == updated
    state = sqlite_session.get_one(WorkflowLoroDraft, row.id)
    assert state.snapshot is None
    assert state.epoch != row.id
    with pytest.raises(LoroDraftEpochChangedError):
        service.sync_loro_draft(
            app_model=app,
            account_id=row.created_by,
            epoch=row.id,
            version=old_version,
            update=None,
            allow_empty=False,
            session=sqlite_session,
        )

    fresh = service.sync_loro_draft(
        app_model=app,
        account_id=row.created_by,
        epoch=state.epoch,
        version=None,
        update=None,
        allow_empty=False,
        session=sqlite_session,
    )
    assert fresh.update is not None
    reopened = LoroDoc()
    reopened.import_(fresh.update)
    assert project_loro_graph(reopened) == updated


@pytest.mark.parametrize("operation", ["restore", "overwrite"])
def test_server_replacement_excludes_previous_epoch(
    service: WorkflowService,
    sqlite_session: Session,
    draft: tuple[App, Workflow],
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    """Keep a committed replacement when edits from the previous draft arrive on either side of it."""
    monkeypatch.setattr(dify_config, "ENABLE_COLLABORATION_MODE", True)
    app, row = draft
    account = make_account(account_id=row.created_by)
    client, baseline = _seed(service, app, row, sqlite_session)
    old_epoch = row.id

    def exchange(epoch: str, version: bytes | None, update: bytes | None) -> LoroDraftSyncResult:
        return service.sync_loro_draft(
            app_model=app,
            account_id=account.id,
            epoch=epoch,
            version=version,
            update=update,
            allow_empty=False,
            session=sqlite_session,
        )

    client.get_map("graph").insert("viewport", {"x": 32, "y": 0, "zoom": 1})
    committed = exchange(old_epoch, baseline, client.export(ExportMode.Updates(VersionVector.decode(baseline))))
    assert committed.changed
    client.get_map("graph").insert("viewport", {"x": 64, "y": 0, "zoom": 1})
    pending = client.export(ExportMode.Updates(VersionVector.decode(committed.version)))

    if operation == "restore":
        published = Workflow(
            app_id=app.id,
            tenant_id=app.tenant_id,
            created_by=account.id,
            type=WorkflowType.CHAT,
            version=Workflow.version_from_datetime(naive_utc_now()),
            graph=json.dumps(GRAPH),
            _features="{}",
        )
        sqlite_session.add(published)
        sqlite_session.commit()
        service.restore_published_workflow_to_draft(
            app_model=app, workflow_id=published.id, account=account, session=sqlite_session
        )
    else:
        service.sync_draft_workflow(
            app_model=app,
            graph=GRAPH,
            features={},
            unique_hash=committed.hash,
            account=account,
            environment_variables=[],
            conversation_variables=[],
            session=sqlite_session,
        )

    new_epoch = sqlite_session.get_one(WorkflowLoroDraft, row.id).epoch
    assert new_epoch != old_epoch
    assert row.graph_dict == GRAPH
    with pytest.raises(LoroDraftEpochChangedError):
        exchange(old_epoch, committed.version, pending)
    sqlite_session.rollback()

    confirmation = exchange(new_epoch, None, None)
    assert confirmation.update is not None
    restored = LoroDoc()
    restored.import_(confirmation.update)
    assert project_loro_graph(restored) == row.graph_dict == GRAPH
    assert not restored.state_vv.includes_vv(VersionVector.decode(committed.version))


def test_pull_uses_no_write_lock_after_seed(service, sqlite_session, draft, monkeypatch):
    app, row = draft
    _, version = _seed(service, app, row, sqlite_session)
    monkeypatch.setattr(
        service, "get_draft_workflow_for_update", lambda *_args, **_kwargs: pytest.fail("Unexpected lock")
    )
    result = service.sync_loro_draft(
        app_model=app,
        account_id=row.created_by,
        epoch=row.id,
        version=version,
        update=None,
        allow_empty=False,
        session=sqlite_session,
    )
    assert result.update is None
    assert not result.changed


def test_compaction_check_precedes_delta_import(service, sqlite_session, draft, monkeypatch):
    from services import workflow_loro_document as document

    app, row = draft
    monkeypatch.setattr(document, "MAX_HISTORY_OPS", 1)
    _seed(service, app, row, sqlite_session)
    with pytest.raises(document.LoroDraftHistoryCompactedError):
        service.sync_loro_draft(
            app_model=app,
            account_id=row.created_by,
            epoch=row.id,
            version=VersionVector().encode(),
            update=b"invalid",
            allow_empty=False,
            session=sqlite_session,
        )


@pytest.mark.parametrize("size", [32, 100_000])
def test_push_includes_only_small_committed_deltas(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow], size: int
) -> None:
    from secrets import token_hex

    app, row = draft
    client, version = _seed(service, app, row, sqlite_session)
    client.get_map("nodes").ensure_mergeable_map("llm").ensure_mergeable_map("data").insert("text", token_hex(size))
    delta = client.export(ExportMode.Updates(VersionVector.decode(version)))
    result = service.sync_loro_draft(
        app_model=app,
        account_id=row.created_by,
        epoch=row.id,
        version=version,
        update=delta,
        allow_empty=False,
        session=sqlite_session,
    )
    assert result.changed
    if size == 32:
        assert result.committed_update is not None
        assert result.from_version == version
    else:
        assert result.committed_update is None
        assert result.from_version is None
    assert result.update is not None


def test_http_initialization_cannot_replace_an_existing_collaborative_draft(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow]
) -> None:
    from services.errors.app import WorkflowHashNotEqualError

    app, row = draft
    _seed(service, app, row, sqlite_session)
    snapshot = sqlite_session.get_one(WorkflowLoroDraft, row.id).snapshot
    with pytest.raises(WorkflowHashNotEqualError):
        service.sync_draft_workflow(
            app_model=app,
            graph={"nodes": [], "edges": []},
            features={},
            unique_hash=row.unique_hash,
            account=make_account(account_id=row.created_by),
            environment_variables=[],
            conversation_variables=[],
            session=sqlite_session,
            graph_writer="initialize",
        )
    sqlite_session.rollback()
    assert row.graph_dict == GRAPH
    assert sqlite_session.get_one(WorkflowLoroDraft, row.id).snapshot == snapshot
