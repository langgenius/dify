"""PostgreSQL row-lock regression for concurrent Composer saves and debug reservations."""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Event
from uuid import uuid4

import pytest
from sqlalchemy import Connection, Engine, event, select, text
from sqlalchemy.orm import Session, sessionmaker

from enums.agent import WorkflowAgentBindingType
from machinery.context import RequestContext
from models.account import Account, Tenant
from models.agent import Agent, AgentConfigSnapshot, AgentScope, AgentSource, WorkflowAgentNodeBinding
from models.agent_config_entities import AgentSoulConfig, WorkflowNodeJobConfig
from models.model import App
from models.workflow import Workflow, WorkflowRun
from repositories.workflow.debug_reservation_repository import WorkflowDebugReservationRepository
from services.agent.composer_service import AgentComposerService
from services.entities.agent_entities import ComposerSavePayload, ComposerSaveStrategy, ComposerVariant
from services.workflow.contracts import DebugReservationCursor, WorkflowSnapshot
from tests.unit_tests.workflow_execution import debug_lease


@pytest.mark.parametrize(
    "strategy", [ComposerSaveStrategy.SAVE_AS_NEW_VERSION, ComposerSaveStrategy.SAVE_TO_CURRENT_VERSION]
)
def test_debug_reservation_and_composer_use_the_same_lock_order(
    db_session_with_containers: Session, strategy: ComposerSaveStrategy
) -> None:
    session = db_session_with_containers
    engine = session.get_bind()
    assert isinstance(engine, Engine)
    assert engine.dialect.name == "postgresql", "This regression requires real PostgreSQL row locks"
    tenant = Tenant(name="Concurrent workflow")
    account = Account(name="Editor", email=f"{uuid4()}@example.com")
    session.add_all([tenant, account])
    session.flush()
    app = App(
        tenant_id=tenant.id,
        name="Workflow",
        mode="workflow",
        created_by=account.id,
        enable_site=True,
        enable_api=True,
    )
    session.add(app)
    session.flush()
    workflow = Workflow.new(
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        version="draft",
        features="{}",
        graph=json.dumps({"nodes": [{"id": "agent", "data": {"type": "agent", "version": "2"}}], "edges": []}),
        created_by=account.id,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    session.add(workflow)
    session.flush()
    agent = Agent(
        tenant_id=tenant.id,
        name="Inline",
        scope=AgentScope.WORKFLOW_ONLY,
        source=AgentSource.WORKFLOW,
        app_id=app.id,
        workflow_id=workflow.id,
        workflow_node_id="agent",
        created_by=account.id,
    )
    session.add(agent)
    session.flush()
    soul = AgentSoulConfig.model_validate(
        {"model": {"plugin_id": "langgenius/openai/openai", "model_provider": "openai", "model": "gpt-4o"}}
    )
    snapshot = AgentConfigSnapshot(
        tenant_id=tenant.id,
        agent_id=agent.id,
        version=1,
        config_snapshot=soul,
        created_by=account.id,
    )
    session.add(snapshot)
    session.flush()
    agent.active_config_snapshot_id = snapshot.id
    session.add(
        WorkflowAgentNodeBinding(
            tenant_id=tenant.id,
            app_id=app.id,
            workflow_id=workflow.id,
            workflow_version="draft",
            node_id="agent",
            node_job_config=WorkflowNodeJobConfig(),
            agent_id=agent.id,
            current_snapshot_id=snapshot.id,
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        )
    )
    session.commit()
    context = RequestContext(str(uuid4()), None, account.id, tenant.id)
    app_id, agent_id = app.id, agent.id
    session.rollback()  # Release fixture reads before concurrent writers begin.
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    agent_updated, release_composer = Event(), Event()
    debug_pid: Queue[int] = Queue()

    def set_up_connection(session: Session, _transaction: object, connection: Connection) -> None:
        connection.info["lock_test_worker"] = session.info.get("lock_test_worker")
        connection.execute(text("SET LOCAL lock_timeout = '5s'"))
        if session.info.get("lock_test_worker") == "debug":
            pid = connection.scalar(text("SELECT pg_backend_pid()"))
            assert isinstance(pid, int)
            debug_pid.put(pid)

    def hold_agent_update(
        connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        if connection.info.get("lock_test_worker") == "composer" and statement.lstrip().lower().startswith(
            "update agents"
        ):
            agent_updated.set()
            assert release_composer.wait(timeout=10), "test did not release Composer"

    event.listen(sessions, "after_begin", set_up_connection)
    event.listen(engine, "after_cursor_execute", hold_agent_update)

    def save() -> None:
        with sessions(info={"lock_test_worker": "composer"}) as editor:
            AgentComposerService.save_workflow_composer(
                session=editor,
                tenant_id=context.active_workspace_id,
                app_id=app_id,
                node_id="agent",
                account_id=context.account_id,
                payload=ComposerSavePayload(
                    variant=ComposerVariant.WORKFLOW,
                    save_strategy=strategy,
                    agent_soul=soul,
                ),
            )

    def reserve() -> tuple[App, WorkflowSnapshot]:
        debug_sessions = sessionmaker(bind=engine, expire_on_commit=False, info={"lock_test_worker": "debug"})
        event.listen(debug_sessions, "after_begin", set_up_connection)
        return WorkflowDebugReservationRepository(debug_sessions).reserve_trigger_debug(context, app_id)

    try:
        with ThreadPoolExecutor(max_workers=2) as workers:
            saving = workers.submit(save)
            try:
                assert agent_updated.wait(timeout=5), "Composer did not reach its Agent update"
                debugging = workers.submit(reserve)
                pid = debug_pid.get(timeout=5)
                deadline = time.monotonic() + 5
                # Observe an actual database wait, rather than assuming a sleep
                # produced the desired ordering. The old code waits on Agent
                # while holding binding; the fixed code waits on binding first.
                while time.monotonic() < deadline:
                    with engine.connect() as observer:
                        blocked = observer.scalar(text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid})
                    if blocked:
                        break
                    time.sleep(0.01)
                else:
                    pytest.fail("Debug reservation did not contend with the Composer transaction")
            finally:
                release_composer.set()
            saving.result(timeout=10)
            _, reserved = debugging.result(timeout=10)
        with sessions() as reader:
            current_snapshot = reader.scalar(select(Agent.active_config_snapshot_id).where(Agent.id == agent_id))
        assert reserved.graph_dict["_agent_bindings"]["bindings"]["agent"]["current_snapshot_id"] == current_snapshot
        assert reserved.execution_id is not None
        with sessions() as reader:
            lease = debug_lease(reader, reserved.execution_id)
            assert lease is not None
            run = reader.get(WorkflowRun, reserved.execution_id)
            assert run is not None
            assert lease.expires_at is not None
            cursor = DebugReservationCursor(run.id, lease.expires_at)
        reservations = WorkflowDebugReservationRepository(sessions)
        assert reservations.pending_batch(lease.expires_at, limit=1) == [cursor]
        assert reservations.pending_batch(lease.expires_at, limit=1, after=cursor) == []
    finally:
        release_composer.set()
        event.remove(engine, "after_cursor_execute", hold_agent_update)
        event.remove(sessions, "after_begin", set_up_connection)
