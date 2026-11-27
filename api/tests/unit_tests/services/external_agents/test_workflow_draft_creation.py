"""External permission admission stays outside serialized first-draft saves."""

from collections.abc import Callable
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker
from sqlalchemy.sql.elements import ClauseElement

from core.rbac import RBACPermission, RBACResourceScope
from extensions.ext_redis import RedisClientWrapper
from models.model import AppMode
from models.workflow import Workflow
from services.errors.app import WorkflowHashNotEqualError
from services.external_agents.io_contracts import JsonObject
from services.workflow import draft_creation_lock
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account, make_app, make_workflow
from tests.helpers.unit.rbac_fakes import RBACDomain


@pytest.mark.parametrize("allowed", [False, True])
@pytest.mark.parametrize("serialize_creation", [False, True])
def test_external_permission_admission_precedes_creation_lease_and_draft_row_lock(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    redis_transport: tuple[RedisClientWrapper, MagicMock],
    rbac_domain: RBACDomain,
    config_overrides: Callable[..., None],
    allowed: bool,
    serialize_creation: bool,
) -> None:
    """Deny before locking; an admitted contender still observes the committed winner."""
    config_overrides(RBAC_ENABLED=True)
    service = WorkflowService(sqlite_session_factory)
    app = make_app(mode=AppMode.WORKFLOW)
    actor = make_account()
    agent_id = str(uuid4())
    winner = make_workflow(workflow_id="winner", app_id=app.id, tenant_id=app.tenant_id)
    graph: JsonObject = {
        "nodes": [
            {
                "id": "external",
                "data": {
                    "type": "agent",
                    "version": "2",
                    "agent_node_kind": "external_a2a",
                    "agent_binding": {"binding_type": "roster_agent", "agent_id": agent_id},
                },
            }
        ],
        "edges": [],
    }
    with sqlite_session_factory.begin() as seed:
        seed.add(app)
        if allowed and not serialize_creation:
            seed.add(winner)
    rbac_domain.transport.response = {"allowed": allowed}
    redis, commands = redis_transport
    monkeypatch.setattr(draft_creation_lock, "redis_client", redis)
    lock_events: list[str] = []

    def dispatch_redis(command: str, *_args: object, **_kwargs: object) -> int:
        assert len(rbac_domain.transport.requests) == 1
        lock_events.append(command)
        if command == "SET":
            with sqlite_session_factory.begin() as other_writer:
                other_writer.add(winner)
        return 1

    commands.side_effect = dispatch_redis

    def observe_row_lock(state: ORMExecuteState) -> None:
        if state.is_select and isinstance(state.statement, ClauseElement):
            statement = str(state.statement.compile(dialect=postgresql.dialect()))
            if "FROM workflows" in statement and "FOR UPDATE" in statement:
                assert len(rbac_domain.transport.requests) == 1
                assert lock_events == (["SET"] if serialize_creation else [])
                lock_events.append("ROW_LOCK")

    with sqlite_session_factory() as session:
        event.listen(session, "do_orm_execute", observe_row_lock)
        try:
            with pytest.raises(WorkflowHashNotEqualError if allowed else ValueError):
                service.sync_draft_workflow(
                    app_model=app,
                    graph=graph,
                    features={},
                    unique_hash=None,
                    account=actor,
                    environment_variables=[],
                    conversation_variables=[],
                    session=session,
                    serialize_creation=serialize_creation,
                )
        finally:
            event.remove(session, "do_orm_execute", observe_row_lock)
    request = rbac_domain.transport.only_request
    assert request.endpoint == "/rbac/check-access"
    assert request.json == {
        "account_id": actor.id,
        "tenant_id": app.tenant_id,
        "scene": RBACPermission.AGENT_PREVIEW,
        "resource_type": RBACResourceScope.AGENT,
        "resource_id": agent_id,
    }
    expected_locks = ["SET", "ROW_LOCK", "EVALSHA"] if serialize_creation else ["ROW_LOCK"]
    assert lock_events == (expected_locks if allowed else [])
    with sqlite_session_factory() as reader:
        assert list(reader.scalars(select(Workflow.id))) == ([winner.id] if allowed else [])
