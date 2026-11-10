import json
from uuid import uuid4

import pytest
from loro import ExportMode, LoroDoc, VersionVector
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from libs.datetime_utils import naive_utc_now
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.agent.workflow_publish_service import WorkflowAgentPublishService
from services.workflow_loro_document import LoroDraftEpochChangedError, LoroDraftUpdateError, project_loro_graph
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account, make_app

GRAPH = {
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


def test_duplicate_loro_update_confirms_original_revision(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow]
) -> None:
    """A dropped ACK is recoverable; resending already committed operations performs no new write."""
    app, row = draft
    client, baseline = _seed(service, app, row, sqlite_session)
    client.get_map("graph").insert("viewport", {"x": 32, "y": 0, "zoom": 1})
    delta = client.export(ExportMode.Updates(VersionVector.decode(baseline)))

    def exchange():
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
    assert row.loro_draft_snapshot is not None
    durable = LoroDoc()
    durable.import_(row.loro_draft_snapshot)
    assert project_loro_graph(durable) == row.graph_dict
    assert row.graph_dict["viewport"] == {"x": 32, "y": 0, "zoom": 1}


def test_failed_graph_validation_does_not_advance_history(
    service: WorkflowService, sqlite_session: Session, draft: tuple[App, Workflow], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Failure after writing the projected graph rolls back both history and graph."""
    app, row = draft
    client, baseline = _seed(service, app, row, sqlite_session)
    old_snapshot = row.loro_draft_snapshot
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
    assert row.loro_draft_snapshot == old_snapshot


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

    with pytest.raises(LoroDraftUpdateError, match="missing causal dependencies"):
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
    updated = {"nodes": [], "edges": []}
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
    assert row.loro_draft_snapshot is None
    assert row.loro_draft_epoch not in (None, row.id)
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

    def exchange(epoch: str, version: bytes | None, update: bytes | None):
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

    new_epoch = row.loro_draft_epoch
    assert new_epoch is not None
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
