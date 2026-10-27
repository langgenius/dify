"""PostgreSQL evidence for app draft creation and legacy duplicate conflicts."""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock

import pytest
from flask import Flask
from sqlalchemy import event, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowType
from services.errors.app import WorkflowHashNotEqualError
from services.workflow_service import WorkflowService
from tests.workflow_empty_draft_test_utils import POPULATED_GRAPH, seed_owner


def _graph(title: str) -> dict[str, object]:
    return {"nodes": [{"id": "start", "data": {"type": "start", "title": title}}], "edges": []}


@pytest.mark.parametrize("existing", [False, True], ids=["first-create", "existing-cas"])
def test_competing_graph_saves_keep_one_acknowledged_draft(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    existing: bool,
) -> None:
    """Force both missing reads before creation, without blocking the owner lock.

    For existing rows synchronize before SELECT, because the first FOR UPDATE
    must be allowed to finish and commit while the other waits in PostgreSQL.
    Each writer has its own real connection, Session and ORM owner identities.
    """
    owner = seed_owner(db_session_with_containers, graph=POPULATED_GRAPH if existing else None)
    app_id, account_id = owner.app.id, owner.account.id
    initial_hash = owner.draft.unique_hash if owner.draft is not None else None
    engine = db_session_with_containers.get_bind()
    assert engine.dialect.name == "postgresql"
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    barrier = Barrier(2, timeout=15)
    seen: set[int] = set()
    guard = Lock()

    def synchronize(connection: Connection, _cursor: object, statement: str, *_args: object) -> None:
        if "FROM workflows" not in statement or "FOR UPDATE" not in statement:
            return
        with guard:
            identity = id(connection)
            if identity in seen:
                return
            seen.add(identity)
        barrier.wait()

    boundary = "before_cursor_execute" if existing else "after_cursor_execute"
    event.listen(engine, boundary, synchronize)

    def write(title: str) -> dict[str, object]:
        with flask_app_with_containers.app_context(), factory() as session:
            session.execute(text("SET LOCAL lock_timeout = '10s'"))
            session.execute(text("SET LOCAL statement_timeout = '20s'"))
            pid = session.scalar(text("SELECT pg_backend_pid()"))
            isolation = session.scalar(text("SHOW transaction_isolation"))
            app = session.get(App, app_id)
            account = session.get(Account, account_id)
            assert app is not None
            assert account is not None
            try:
                result = WorkflowService(factory).sync_draft_workflow(
                    app_model=app,
                    graph=_graph(title),
                    features={},
                    unique_hash=initial_hash,
                    account=account,
                    environment_variables=[],
                    conversation_variables=[],
                    session=session,
                )
                return {
                    "result": "success",
                    "id": result.id,
                    "hash": result.unique_hash,
                    "graph": result.graph_dict,
                    "pid": pid,
                    "isolation": isolation,
                }
            except WorkflowHashNotEqualError as error:
                session.rollback()
                return {"result": type(error).__name__, "pid": pid, "isolation": isolation}

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(write, title) for title in ("writer-a", "writer-b")]
            results = [future.result(timeout=40) for future in futures]
    finally:
        event.remove(engine, boundary, synchronize)
    with factory() as reader:
        drafts = list(
            reader.scalars(
                select(Workflow).where(
                    Workflow.app_id == app_id,
                    Workflow.tenant_id == owner.app.tenant_id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
            )
        )
        persisted = [{"id": draft.id, "hash": draft.unique_hash, "graph": draft.graph_dict} for draft in drafts]
        indexes = list(reader.execute(text("SELECT indexdef FROM pg_indexes WHERE tablename = 'workflows'")).scalars())
    evidence = {"existing": existing, "results": results, "persisted": persisted, "indexes": indexes}
    logging.getLogger(__name__).warning("ENG1204_EVIDENCE %s", json.dumps(evidence, sort_keys=True))
    assert len({result["pid"] for result in results}) == 2
    assert all(result["isolation"] == "read committed" for result in results)
    assert len(seen) == 2
    assert len(drafts) == 1, evidence
    accepted = [result for result in results if result["result"] == "success"]
    assert len(accepted) == 1, evidence
    assert [result["result"] for result in results].count("WorkflowHashNotEqualError") == 1, evidence
    assert persisted == [{key: accepted[0][key] for key in ("id", "hash", "graph")}], evidence


@pytest.mark.parametrize("operation", ["save", "restore", "dsl"])
def test_legacy_duplicate_drafts_are_rejected_without_writes(
    db_session_with_containers: Session,
    operation: str,
) -> None:
    """Historical ambiguity must be actionable and preserve every stored row."""
    from services.app_dsl_service import AppDslService
    from tests.workflow_empty_draft_test_utils import workflow_rows

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    session.add(
        Workflow(
            tenant_id=owner.app.tenant_id,
            app_id=owner.app.id,
            type=WorkflowType.WORKFLOW,
            version="draft",
            graph=json.dumps(_graph("duplicate")),
            _features="{}",
            created_by=owner.account.id,
        )
    )
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    before = workflow_rows(factory)
    service = WorkflowService(factory)
    original_name = owner.app.name

    def operate() -> None:
        if operation == "restore":
            assert owner.app.workflow_id is not None
            service.restore_published_workflow_to_draft(
                app_model=owner.app, workflow_id=owner.app.workflow_id, account=owner.account, session=session
            )
        elif operation == "dsl":
            AppDslService(session)._create_or_update_app(
                app=owner.app,
                account=owner.account,
                data={
                    "app": {"mode": "workflow", "name": "must-not-change"},
                    "workflow": {"graph": _graph("dsl"), "features": {}},
                },
            )
        else:
            service.sync_draft_workflow(
                app_model=owner.app,
                graph=_graph("save"),
                features={},
                unique_hash=owner.draft.unique_hash,
                account=owner.account,
                environment_variables=[],
                conversation_variables=[],
                session=session,
            )

    with pytest.raises(ValueError, match="Multiple draft workflows exist"):
        operate()
    assert owner.app.name == original_name
    session.rollback()
    assert workflow_rows(factory) == before


def test_missing_draft_requires_persisted_complete_app_owner(db_session_with_containers: Session) -> None:
    from uuid import uuid4

    from services.errors.app import WorkflowNotFoundError
    from tests.workflow_empty_draft_test_utils import workflow_rows

    session = db_session_with_containers
    owner = seed_owner(session, graph=None)
    forged = App(id=owner.app.id, tenant_id=str(uuid4()), mode=AppMode.WORKFLOW)
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    before = workflow_rows(factory)
    with pytest.raises(WorkflowNotFoundError):
        WorkflowService(factory).sync_draft_workflow(
            app_model=forged,
            graph=_graph("forged"),
            features={},
            unique_hash=None,
            account=owner.account,
            environment_variables=[],
            conversation_variables=[],
            session=session,
        )
    session.rollback()
    assert workflow_rows(factory) == before


@pytest.mark.parametrize(("mode", "converted_mode"), [("chat", "advanced-chat"), ("completion", "workflow")])
def test_conversion_creates_draft_under_new_destination_only(
    db_session_with_containers: Session,
    mode: str,
    converted_mode: str,
) -> None:
    from models.model import AppModelConfig
    from tests.workflow_empty_draft_test_utils import workflow_rows

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    owner.app.mode = AppMode(mode)
    config = AppModelConfig(
        app_id=owner.app.id,
        provider="openai",
        model_id="gpt-3.5-turbo",
        model=json.dumps(
            {
                "provider": "openai",
                "name": "gpt-3.5-turbo",
                "completion_params": {"max_tokens": 1000, "temperature": 0.7},
            }
        ),
        pre_prompt="You are a helpful assistant.",
        created_by=owner.account.id,
        updated_by=owner.account.id,
    )
    session.add(config)
    session.flush()
    owner.app.app_model_config_id = config.id
    session.commit()
    source_id = owner.app.id
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    before = workflow_rows(factory)
    inserted_owners: list[str] = []

    def witness(_connection: Connection, _cursor: object, statement: str, parameters: object, *_args: object) -> None:
        if statement.startswith("INSERT INTO workflows"):
            assert isinstance(parameters, dict)
            inserted_owner = parameters["app_id"]
            assert isinstance(inserted_owner, str)
            inserted_owners.append(inserted_owner)

    event.listen(session.get_bind(), "after_cursor_execute", witness)
    try:
        result = WorkflowService(factory).convert_to_workflow(
            app_model=owner.app,
            account=owner.account,
            args={"name": "Converted", "icon_type": "emoji", "icon": "sparkles", "icon_background": "#123456"},
            session=session,
        )
    finally:
        event.remove(session.get_bind(), "after_cursor_execute", witness)
    assert result.id != source_id
    assert result.mode == converted_mode
    assert result.name == "Converted"
    assert result.icon == "sparkles"
    assert result.icon_background == "#123456"
    assert result.created_by == owner.account.id
    assert inserted_owners == [result.id]
    with factory() as reader:
        drafts = list(reader.scalars(select(Workflow).where(Workflow.app_id == result.id)))
        assert len(drafts) == 1
        assert drafts[0].tenant_id == owner.app.tenant_id
        assert drafts[0].version == Workflow.VERSION_DRAFT
        assert drafts[0].graph_dict["nodes"]
        source = reader.get(App, source_id)
        assert source is not None
        assert source.mode == mode
        assert source.app_model_config_id == config.id
    assert [row for row in workflow_rows(factory) if row[2] == source_id] == before


@pytest.mark.parametrize("finish", ["commit", "rollback"])
@pytest.mark.parametrize("contender", ["sync", "restore", "dsl"])
def test_uncommitted_initialization_holds_owner_lock_until_caller_finishes(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    finish: str,
    contender: str,
) -> None:
    """Witness the real PostgreSQL wait and recovery, including restore/import."""
    from queue import Queue
    from time import monotonic

    from services.app_dsl_service import AppDslService

    owner = seed_owner(db_session_with_containers, graph=None)
    app_id, account_id, source_id = owner.app.id, owner.account.id, owner.app.workflow_id
    assert source_id is not None
    factory = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    contender_pid: Queue[int] = Queue()

    def write() -> tuple[str, str | None]:
        with flask_app_with_containers.app_context(), factory() as session:
            session.execute(text("SET LOCAL lock_timeout = '10s'"))
            pid = session.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(pid, int)
            contender_pid.put(pid)
            app = session.get(App, app_id)
            account = session.get(Account, account_id)
            assert app is not None
            assert account is not None
            service = WorkflowService(factory)
            try:
                if contender == "restore":
                    result = service.restore_published_workflow_to_draft(
                        app_model=app, workflow_id=source_id, account=account, session=session
                    )
                elif contender == "dsl":
                    AppDslService(session)._create_or_update_app(
                        app=app,
                        account=account,
                        data={"app": {"mode": "workflow"}, "workflow": {"graph": _graph("contender"), "features": {}}},
                    )
                    result = service.get_draft_workflow(app, session=session)
                    assert result is not None
                else:
                    result = service.sync_draft_workflow(
                        app_model=app,
                        graph=_graph("contender"),
                        features={},
                        unique_hash=None,
                        account=account,
                        environment_variables=[],
                        conversation_variables=[],
                        session=session,
                    )
                return "success", result.id
            except WorkflowHashNotEqualError as error:
                session.rollback()
                return type(error).__name__, None

    with factory() as first, ThreadPoolExecutor(max_workers=1) as executor:
        app = first.get(App, app_id)
        account = first.get(Account, account_id)
        assert app is not None
        assert account is not None
        first_pid = first.scalar(text("SELECT pg_backend_pid()"))
        pending = WorkflowService(factory).sync_draft_workflow(
            app_model=app,
            graph=_graph("pending"),
            features={},
            unique_hash=None,
            account=account,
            environment_variables=[],
            conversation_variables=[],
            session=first,
            commit=False,
        )
        pending_id = pending.id
        future = executor.submit(write)
        pid = contender_pid.get(timeout=10)
        try:
            with factory() as observer:
                deadline = monotonic() + 8
                blockers: list[int] = []
                while monotonic() < deadline:
                    blockers = observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": pid})
                    if first_pid in blockers:
                        break
                assert first_pid in blockers, (contender, finish, blockers)
                assert (
                    list(
                        observer.scalars(
                            select(Workflow).where(
                                Workflow.app_id == app_id, Workflow.version == Workflow.VERSION_DRAFT
                            )
                        )
                    )
                    == []
                )
            if finish == "commit":
                first.commit()
            else:
                first.rollback()
        finally:
            first.rollback()
        outcome, result_id = future.result(timeout=20)
    with factory() as reader:
        drafts = list(
            reader.scalars(
                select(Workflow).where(Workflow.app_id == app_id, Workflow.version == Workflow.VERSION_DRAFT)
            )
        )
        assert len(drafts) == 1
        if finish == "commit" and contender == "sync":
            assert outcome == "WorkflowHashNotEqualError"
            assert drafts[0].id == pending_id
            assert drafts[0].graph_dict == _graph("pending")
        else:
            assert outcome == "success"
            assert drafts[0].id == result_id
            assert (drafts[0].id == pending_id) == (finish == "commit")
            assert drafts[0].graph_dict == (POPULATED_GRAPH if contender == "restore" else _graph("contender"))


@pytest.mark.parametrize("operation", ["save", "restore", "missing-owner"])
def test_draft_conflicts_are_served_by_framework_without_writes(
    db_session_with_containers: Session,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    """Exercise real parsing/service/database/error serialization through HTTP."""
    import inspect
    from uuid import uuid4

    from flask_restx import Resource

    from controllers.console.app import workflow as workflow_api
    from libs.external_api import ExternalApi
    from tests.workflow_empty_draft_test_utils import EmptyDraftDatabase, workflow_rows

    session = db_session_with_containers
    owner = seed_owner(session, graph=None if operation == "missing-owner" else POPULATED_GRAPH)
    target = owner.app
    if operation == "missing-owner":
        target = App(id=owner.app.id, tenant_id=str(uuid4()), mode=AppMode.WORKFLOW)
    else:
        session.add(
            Workflow(
                tenant_id=target.tenant_id,
                app_id=target.id,
                type=WorkflowType.WORKFLOW,
                version="draft",
                graph=json.dumps(_graph("duplicate")),
                _features="{}",
                created_by=owner.account.id,
            )
        )
        session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    before = workflow_rows(factory)
    app_id, account_id, source_id = owner.app.id, owner.account.id, owner.app.workflow_id
    initial_hash = owner.draft.unique_hash if owner.draft else None
    with factory() as request_session:
        if operation != "missing-owner":
            target = request_session.get(App, app_id)
            assert target is not None
        account = request_session.get(Account, account_id)
        assert account is not None
        service = WorkflowService(factory)
        monkeypatch.setattr(workflow_api, "db", EmptyDraftDatabase(request_session))
        monkeypatch.setattr(workflow_api, "WorkflowService", lambda: service)
        http_app = Flask(__name__)
        # Match the real app factory, so framework URI hints do not alter domain messages.
        http_app.config["RESTX_ERROR_404_HELP"] = False

        class HttpResource(Resource):
            def post(self) -> object:
                if operation == "restore":
                    endpoint = workflow_api.DraftWorkflowRestoreApi()
                    return inspect.unwrap(endpoint.post)(endpoint, account, app_model=target, workflow_id=source_id)
                endpoint = workflow_api.DraftWorkflowApi()
                return inspect.unwrap(endpoint.post)(endpoint, account, app_model=target)

        ExternalApi(http_app).add_resource(HttpResource, "/draft")
        response = http_app.test_client().post(
            "/draft",
            json={"graph": _graph("http"), "features": {}, "hash": initial_hash},
        )
        expected_status = 404 if operation == "missing-owner" else 409
        assert response.status_code == expected_status
        assert response.json == {
            "code": "not_found" if operation == "missing-owner" else "conflict",
            "status": expected_status,
            "message": "App not found for draft initialization."
            if operation == "missing-owner"
            else (
                "Multiple draft workflows exist for this app. Resolve the duplicate drafts before saving or restoring."
            ),
        }
        request_session.rollback()
    assert workflow_rows(factory) == before


def test_duplicate_import_returns_failed_reason_before_metadata_changes(db_session_with_containers: Session) -> None:
    from services.app_dsl_service import CURRENT_DSL_VERSION, AppDslService, ImportStatus
    from tests.workflow_empty_draft_test_utils import workflow_rows

    session = db_session_with_containers
    owner = seed_owner(session, graph=POPULATED_GRAPH)
    session.add(
        Workflow(
            tenant_id=owner.app.tenant_id,
            app_id=owner.app.id,
            type=WorkflowType.WORKFLOW,
            version="draft",
            graph=json.dumps(_graph("duplicate")),
            _features="{}",
            created_by=owner.account.id,
        )
    )
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    before = workflow_rows(factory)
    original_name = owner.app.name
    result = AppDslService(session).import_app(
        account=owner.account,
        app_id=owner.app.id,
        import_mode="yaml-content",
        yaml_content=json.dumps(
            {
                "version": CURRENT_DSL_VERSION,
                "kind": "app",
                "app": {"mode": "workflow", "name": "must-not-change"},
                "workflow": {"graph": _graph("import"), "features": {}},
            }
        ),
    )
    assert result.status == ImportStatus.FAILED
    assert result.error == (
        "Multiple draft workflows exist for this app. Resolve the duplicate drafts before saving or restoring."
    )
    assert owner.app.name == original_name
    # Even an accidental caller commit after the FAILED result cannot persist a partial import.
    session.commit()
    assert workflow_rows(factory) == before
    with factory() as reader:
        app = reader.get(App, owner.app.id)
        assert app is not None
        assert app.name == original_name


@pytest.mark.parametrize("finish", ["commit", "rollback"])
def test_initial_draft_and_agent_binding_share_caller_transaction(
    db_session_with_containers: Session,
    finish: str,
) -> None:
    from uuid import uuid4

    from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, AgentStatus, WorkflowAgentNodeBinding
    from models.agent_config_entities import AgentSoulConfig

    session = db_session_with_containers
    owner = seed_owner(session, graph=None)
    agent = Agent(
        id=str(uuid4()),
        tenant_id=owner.app.tenant_id,
        name="Creation roster agent",
        scope=AgentScope.ROSTER,
        source=AgentSource.ROSTER,
        status=AgentStatus.ACTIVE,
    )
    snapshot = AgentConfigSnapshot(
        id=str(uuid4()), tenant_id=owner.app.tenant_id, agent_id=agent.id, version=1, config_snapshot=AgentSoulConfig()
    )
    agent.active_config_snapshot_id = snapshot.id
    session.add_all([agent, snapshot])
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    graph: dict[str, object] = {
        "nodes": [
            {
                "id": "agent-node",
                "data": {
                    "type": "agent",
                    "version": "2",
                    "title": "Agent",
                    "agent_node_kind": "dify_agent",
                    "agent_binding": {"binding_type": "roster_agent", "agent_id": agent.id},
                },
            }
        ],
        "edges": [],
    }
    draft = WorkflowService(factory).sync_draft_workflow(
        app_model=owner.app,
        graph=graph,
        features={},
        unique_hash=None,
        account=owner.account,
        environment_variables=[],
        conversation_variables=[],
        session=session,
        commit=False,
    )
    draft_id = draft.id
    binding = session.scalars(
        select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == draft_id)
    ).one()
    expected_owner = (owner.app.tenant_id, owner.app.id, draft_id, "draft", "agent-node", agent.id, snapshot.id)
    assert (
        binding.tenant_id,
        binding.app_id,
        binding.workflow_id,
        binding.workflow_version,
        binding.node_id,
        binding.agent_id,
        binding.current_snapshot_id,
    ) == expected_owner
    with factory() as observer:
        assert observer.get(Workflow, draft_id) is None
        assert (
            list(
                observer.scalars(
                    select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == draft_id)
                )
            )
            == []
        )
    if finish == "commit":
        session.commit()
    else:
        session.rollback()
    with factory() as observer:
        saved = observer.get(Workflow, draft_id)
        bindings = list(
            observer.scalars(select(WorkflowAgentNodeBinding).where(WorkflowAgentNodeBinding.workflow_id == draft_id))
        )
        if finish == "commit":
            assert saved is not None
            assert saved.graph_dict == graph
            assert len(bindings) == 1
            persisted = bindings[0]
            assert (
                persisted.tenant_id,
                persisted.app_id,
                persisted.workflow_id,
                persisted.workflow_version,
                persisted.node_id,
                persisted.agent_id,
                persisted.current_snapshot_id,
            ) == expected_owner
        else:
            assert saved is None
            assert bindings == []


def test_existing_draft_save_does_not_wait_for_app_owner_lock(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
) -> None:
    """Protect Builder's draft-first order against an unconditional parent lock."""
    owner = seed_owner(db_session_with_containers, graph=POPULATED_GRAPH)
    assert owner.draft is not None
    app_id, account_id, draft_hash = owner.app.id, owner.account.id, owner.draft.unique_hash
    factory = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)

    def write() -> str:
        with flask_app_with_containers.app_context(), factory() as session:
            session.execute(text("SET LOCAL lock_timeout = '3s'"))
            app = session.get(App, app_id)
            account = session.get(Account, account_id)
            assert app is not None
            assert account is not None
            result = WorkflowService(factory).sync_draft_workflow(
                app_model=app,
                graph=_graph("existing"),
                features={},
                unique_hash=draft_hash,
                account=account,
                environment_variables=[],
                conversation_variables=[],
                session=session,
            )
            return result.unique_hash

    with factory() as parent_holder, ThreadPoolExecutor(max_workers=1) as executor:
        parent_holder.execute(select(App.id).where(App.id == app_id).with_for_update())
        future = executor.submit(write)
        try:
            accepted_hash = future.result(timeout=8)
        finally:
            parent_holder.rollback()
    with factory() as reader:
        draft = WorkflowService.get_draft_workflow(owner.app, session=reader)
        assert draft is not None
        assert draft.graph_dict == _graph("existing")
        assert draft.unique_hash == accepted_hash


@pytest.mark.parametrize("metadata_writer", ["dsl", "builder-publish"])
def test_stale_missing_draft_read_does_not_deadlock_metadata_writer(
    flask_app_with_containers: Flask,
    db_session_with_containers: Session,
    metadata_writer: str,
) -> None:
    """Reproduce App→draft versus actual DSL draft→App metadata autoflush.

    A sees absence; B initializes; C locks B's draft through real DSL, then A
    reaches a PostgreSQL-observed wait on C. Releasing C creates the old cycle.
    An App-first metadata writer instead makes A wait on App and then progress.
    """
    from contextvars import ContextVar
    from queue import Queue
    from threading import Event
    from time import monotonic

    from psycopg2 import Error as PsycopgError
    from sqlalchemy.exc import DBAPIError

    from core.dify_builder.models import Actor
    from services.app_dsl_service import AppDslService
    from services.dify_builder.dify_port import WorkflowServiceDifyPort
    from services.dify_builder.revision import execution_revision

    owner = seed_owner(db_session_with_containers, graph=None)
    app_id, account_id = owner.app.id, owner.account.id
    factory = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    missing_read, release_absence, dsl_locked, release_dsl = Event(), Event(), Event(), Event()
    stale_pid: Queue[int] = Queue()
    dsl_pid: Queue[int] = Queue()
    owner_locked = Event()
    current_role: ContextVar[str] = ContextVar("eng1204_metadata_writer", default="")
    expected_revision = ""
    expected_graph_revision = ""
    original_name = owner.app.name

    def boundary(connection: Connection, _cursor: object, statement: str, *_args: object) -> None:
        role = current_role.get()
        if role == "stale" and "FROM apps" in statement and "FOR UPDATE" in statement:
            owner_locked.set()
        if "FROM workflows" not in statement or "FOR UPDATE" not in statement:
            return
        if role == "stale" and not missing_read.is_set():
            missing_read.set()
            assert release_absence.wait(timeout=12)
        elif role == "dsl" and not dsl_locked.is_set():
            pid = connection.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(pid, int)
            dsl_pid.put(pid)
            dsl_locked.set()
            assert release_dsl.wait(timeout=12)

    def write(role: str) -> dict[str, object]:
        with flask_app_with_containers.app_context(), factory() as session:
            token = current_role.set(role)
            session.execute(text("SET LOCAL lock_timeout = '10s'"))
            session.execute(text("SET LOCAL statement_timeout = '15s'"))
            session.execute(text("SET LOCAL deadlock_timeout = '100ms'"))
            pid = session.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(pid, int)
            if role == "stale":
                stale_pid.put(pid)
            app = session.get(App, app_id)
            account = session.get(Account, account_id)
            assert app is not None
            assert account is not None
            try:
                if role == "stale":
                    WorkflowService(factory).sync_draft_workflow(
                        app_model=app,
                        graph=_graph("stale"),
                        features={},
                        unique_hash=None,
                        account=account,
                        environment_variables=[],
                        conversation_variables=[],
                        session=session,
                    )
                elif metadata_writer == "dsl":
                    AppDslService(session)._create_or_update_app(
                        app=app,
                        account=account,
                        data={
                            "app": {"mode": "workflow", "name": "Imported metadata"},
                            "workflow": {"graph": _graph("dsl-metadata"), "features": {}},
                        },
                    )
                else:
                    WorkflowServiceDifyPort().publish(
                        app_id,
                        Actor(account_id=account.id, tenant_id=app.tenant_id),
                        expected_revision=expected_revision,
                        expected_graph_revision=expected_graph_revision,
                    )
                return {"result": "success", "pid": pid}
            except WorkflowHashNotEqualError as error:
                session.rollback()
                return {"result": type(error).__name__, "pid": pid}
            except DBAPIError as error:
                session.rollback()
                if not isinstance(error.orig, PsycopgError):
                    raise
                return {"result": type(error).__name__, "sqlstate": error.orig.pgcode, "pid": pid}
            finally:
                current_role.reset(token)

    engine = db_session_with_containers.get_bind()
    event.listen(engine, "after_cursor_execute", boundary)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            stale = executor.submit(write, "stale")
            first_pid = stale_pid.get(timeout=10)
            assert missing_read.wait(timeout=10)
            with factory() as initializer:
                app = initializer.get(App, app_id)
                account = initializer.get(Account, account_id)
                assert app is not None
                assert account is not None
                initial = WorkflowService(factory).sync_draft_workflow(
                    app_model=app,
                    graph=_graph("initialized"),
                    features={},
                    unique_hash=None,
                    account=account,
                    environment_variables=[],
                    conversation_variables=[],
                    session=initializer,
                )
                initial_id = initial.id
                expected_revision = execution_revision(initial)
                expected_graph_revision = WorkflowServiceDifyPort().graph_revision(dict(initial.graph_dict))
            importer = executor.submit(write, "dsl")
            second_pid = dsl_pid.get(timeout=10)
            try:
                assert dsl_locked.wait(timeout=10)
                release_absence.set()
                with factory() as observer:
                    deadline = monotonic() + 8
                    blockers: list[int] = []
                    while monotonic() < deadline:
                        blockers = observer.scalar(text("SELECT pg_blocking_pids(:pid)"), {"pid": first_pid})
                        if second_pid in blockers:
                            break
                    assert second_pid in blockers, blockers
                held_app_before_wait = owner_locked.is_set()
                release_dsl.set()
                results = [stale.result(timeout=20), importer.result(timeout=20)]
            finally:
                release_absence.set()
                release_dsl.set()
    finally:
        event.remove(engine, "after_cursor_execute", boundary)
    with factory() as reader:
        drafts = list(
            reader.scalars(
                select(Workflow).where(Workflow.app_id == app_id, Workflow.version == Workflow.VERSION_DRAFT)
            )
        )
        app = reader.get(App, app_id)
        assert app is not None
        evidence = {
            "results": results,
            "held_app_before_wait": held_app_before_wait,
            "drafts": [{"id": draft.id, "hash": draft.unique_hash, "graph": draft.graph_dict} for draft in drafts],
            "app_name": app.name,
        }
        logging.getLogger(__name__).warning("ENG1204_DEADLOCK_EVIDENCE %s", json.dumps(evidence, sort_keys=True))
        assert results[0]["result"] == "WorkflowHashNotEqualError", evidence
        assert results[1]["result"] == "success", evidence
        assert held_app_before_wait is False, evidence
        assert len(drafts) == 1
        assert drafts[0].id == initial_id
        assert drafts[0].graph_dict == _graph("dsl-metadata" if metadata_writer == "dsl" else "initialized")
        assert app.name == ("Imported metadata" if metadata_writer == "dsl" else original_name)
        if metadata_writer == "builder-publish":
            published = reader.get(Workflow, app.workflow_id)
            assert published is not None
            assert published.version != Workflow.VERSION_DRAFT
            assert published.graph_dict == drafts[0].graph_dict
