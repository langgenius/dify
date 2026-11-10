"""Actual PostgreSQL contention on the existing owned Agent caller row."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import sessionmaker

    from dify_app import DifyApp


from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.orm import sessionmaker

from extensions.ext_database import db
from models.workflow import WorkflowNodeExecutionModel
from runtime_contracts.agent_recovery import AgentCreateIntent
from services.agent.workflow_run_recovery import AgentCreateScope, WorkflowAgentRunRecovery
from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _execution_row


def test_postgres_concurrent_reservations_allow_exactly_one_create(flask_app_with_containers: DifyApp) -> None:
    with flask_app_with_containers.app_context():
        factory = sessionmaker(bind=db.engine, expire_on_commit=False)
        ids = {
            name: str(uuid4())
            for name in (
                "tenant_id",
                "app_id",
                "workflow_id",
                "workflow_run_id",
                "execution_id",
                "workflow_binding_id",
            )
        }
        scope = AgentCreateScope(**ids, node_id="agent-node")
        row = _execution_row(
            execution_id=scope.execution_id,
            workflow_run_id=scope.workflow_run_id,
            binding_id=str(uuid4()),
            process_data={"workflow_agent_binding_id": scope.workflow_binding_id},
        )
        for name, value in (
            ("tenant_id", scope.tenant_id),
            ("app_id", scope.app_id),
            ("workflow_id", scope.workflow_id),
            ("node_id", scope.node_id),
        ):
            setattr(row, name, value)
        row.created_by = str(uuid4())
        row.node_execution_id = str(uuid4())
        with factory.begin() as session:
            session.add(row)
        barrier = Barrier(12)

        def reserve(_index) -> tuple[AgentCreateIntent, bool]:
            barrier.wait(timeout=15)
            return WorkflowAgentRunRecovery(factory).reserve(
                scope=scope,
                attempt=0,
                key="one-key",
                digest="a" * 64,
            )

        try:
            with ThreadPoolExecutor(max_workers=12) as pool:
                results = list(pool.map(reserve, range(12)))
            assert sum(inserted for _intent, inserted in results) == 1
            assert len({intent.model_dump_json() for intent, _inserted in results}) == 1
            restarted = WorkflowAgentRunRecovery(factory)
            intent = results[0][0]
            restarted.bind_child(scope=scope, intent=intent, child_run_id="retained-child")
            same, inserted = restarted.reserve(scope=scope, attempt=0, key=intent.key, digest=intent.digest)
            assert not inserted
            assert same.child_run_id == "retained-child"
        finally:
            with factory.begin() as session:
                session.execute(
                    delete(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.id == scope.execution_id)
                )
