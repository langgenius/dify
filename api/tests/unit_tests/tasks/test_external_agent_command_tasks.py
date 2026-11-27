"""Real command/export task adapters over SQLite, Flask and a memory broker."""

from contextlib import suppress
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from queue import Empty
from uuid import uuid4

import pytest
from kombu.simple import SimpleQueue
from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select

from configs import dify_config
from models.external_agent import ExternalAgentCommand, ExternalAgentInvocation
from models.external_agent_trace import ExternalAgentTraceDelivery
from services.external_agents.runtime_contracts import (
    ExecutionIdentity,
    InvocationDraft,
    RuntimeError,
    RuntimeScope,
    WaitPolicy,
)
from tasks.external_agent_task import (
    drain_external_commands,
    execute_external_command,
    execute_external_trace_delivery,
    maintain_external_agents,
)
from tests.unit_tests.controllers.console.agent.test_external_endpoint_contracts import endpoint_domain
from tests.unit_tests.controllers.console.agent.test_external_test_transport import TestTransport, test_transport

__all__ = ["endpoint_domain", "test_transport"]


def scope(test_transport: TestTransport) -> RuntimeScope:
    _, context, _, _, _ = test_transport[0]
    return RuntimeScope(
        tenant_id=context.active_workspace_id, initiator_id=context.account_id, app_id=None, origin="overview_test"
    )


def intent(test_transport: TestTransport, *, when: datetime, expired: bool = False) -> str:
    """Persist an actual command; no successful receipt or remote identity is injected."""
    domain, _, _ = test_transport
    _, _, agent, services, _ = domain
    draft = InvocationDraft(
        invocation_id=str(uuid4()),
        agent_id=agent,
        message_id=str(uuid4()),
        identity=ExecutionIdentity(execution_id=str(uuid4()), node_id="overview-test", frame_id="root"),
        parts=({"text": "Task"},),
        test_generation=1,
        job={"page_session_id": "tasks", "input_lease_ids": []},
        policy=WaitPolicy(wait_seconds=60),
        logical_deadline=when + timedelta(seconds=60) if expired else None,
    )
    return services.external_agents.repository.create(scope(test_transport), draft, now=when).id


def queued_tasks(test_transport: TestTransport, queue: str) -> list[tuple[str, list[object]]]:
    """Read actual serialized task envelopes with a bounded queue drain."""
    result: list[tuple[str, list[object]]] = []
    with test_transport[2].connection_for_write() as connection, SimpleQueue(connection, queue) as inbox:
        for _ in range(20):
            with suppress(Empty):
                message = inbox.get(block=False)
                args = TypeAdapter(list[object]).validate_python(message.payload[0])
                result.append((str(message.headers["task"]), args))
                message.ack()
    return result


def test_execute_validates_payload_scope_and_consumes_only_the_owned_due_deadline(
    test_transport: TestTransport,
) -> None:
    domain, _, _ = test_transport
    app, _, _, services, sessions = domain
    identifier = intent(test_transport, when=datetime.now(UTC) - timedelta(minutes=5), expired=True)
    with sessions() as session:
        deadline = session.scalars(
            select(ExternalAgentCommand).where(
                ExternalAgentCommand.invocation_id == identifier, ExternalAgentCommand.kind == "deadline"
            )
        ).one()
        command_id = deadline.id
    with app.app_context():
        with pytest.raises(ValidationError):
            execute_external_command.run({"origin": "untrusted-client"}, command_id)
        wrong = {**asdict(scope(test_transport)), "tenant_id": str(uuid4())}
        with pytest.raises(RuntimeError):
            execute_external_command.run(wrong, command_id)
        execute_external_command.run(asdict(scope(test_transport)), command_id)
    with sessions() as session:
        row = session.get(ExternalAgentInvocation, identifier)
        command = session.get(ExternalAgentCommand, command_id)
        assert row is not None
        assert row.local_state in {"failed", "ended", "stopped"}
        assert row.remote_task_id is None
        assert row.outputs is None
        assert row.error_code
        assert command is not None
        assert command.state == "done"
    assert services.external_agents.repository.get(scope(test_transport), identifier).dispatched_at is None


def test_drain_recovers_entered_send_as_unknown_and_publishes_durable_commands_once(
    test_transport: TestTransport,
) -> None:
    domain, _, _ = test_transport
    app, _, _, services, sessions = domain
    repo = services.external_agents.repository
    old = datetime.now(UTC) - timedelta(minutes=5)
    orphan = intent(test_transport, when=old)
    admitted = repo.acquire_dispatch(scope(test_transport), orphan, now=old + timedelta(seconds=1))
    assert admitted is not None
    # SQL crash probe at the persisted HTTP-entry marker; it does not send or
    # manufacture a success receipt. The task must reconcile, never replay it.
    assert repo.begin_send(scope(test_transport), admitted, now=old + timedelta(seconds=2)) is not None
    ready = intent(test_transport, when=datetime.now(UTC))
    with app.app_context():
        drain_external_commands.run()
    messages = queued_tasks(test_transport, dify_config.EXTERNAL_AGENTS_QUEUE)
    assert messages
    assert all(name == "tasks.external_agent_task.execute_external_command" for name, _ in messages)
    found_ready = False
    with sessions() as session:
        for _, args in messages:
            admitted_scope = TypeAdapter(RuntimeScope).validate_python(args[0])
            assert admitted_scope == scope(test_transport)
            command_id = TypeAdapter(str).validate_python(args[1])
            row = session.get(ExternalAgentCommand, command_id)
            assert row is not None
            assert row.publish_after is not None
            found_ready = found_ready or row.invocation_id == ready
        row = session.get(ExternalAgentInvocation, orphan)
        assert row is not None
        assert row.submission_state == "submission_unknown"
        assert row.remote_task_id is None
    assert found_ready
    with app.app_context():
        drain_external_commands.run()
    assert queued_tasks(test_transport, dify_config.EXTERNAL_AGENTS_QUEUE) == []


def test_maintenance_publishes_export_without_agent_dispatch_and_deleted_source_stops_delivery(
    test_transport: TestTransport,
) -> None:
    domain, _, _ = test_transport
    app, context, agent, _, sessions = domain
    delivery_id, missing_source = str(uuid4()), str(uuid4())
    with sessions.begin() as session:
        session.add(
            ExternalAgentTraceDelivery(
                id=delivery_id,
                tenant_id=context.active_workspace_id,
                invocation_id=missing_source,
                delivery_key="d" * 64,
                target_kind="asset",
                target_id=agent,
                provider="phoenix",
                config_revision="1",
                payload_revision=1,
                encrypted_config={},
                trace_payload={"source": "synthetic expired export"},
                capture_content=False,
            )
        )
    with app.app_context():
        maintain_external_agents.run()
    assert queued_tasks(test_transport, dify_config.EXTERNAL_AGENTS_QUEUE) == []
    messages = queued_tasks(test_transport, dify_config.OPS_TRACE_QUEUE)
    assert messages == [
        ("tasks.external_agent_task.execute_external_trace_delivery", [context.active_workspace_id, delivery_id])
    ]
    with app.app_context():
        maintain_external_agents.run()
        execute_external_trace_delivery.run(str(uuid4()), delivery_id)
    assert queued_tasks(test_transport, dify_config.OPS_TRACE_QUEUE) == []
    with sessions() as session:
        row = session.get(ExternalAgentTraceDelivery, delivery_id)
        assert row is not None
        assert row.state == "pending"
        assert row.attempts == 0
    with app.app_context():
        execute_external_trace_delivery.run(context.active_workspace_id, delivery_id)
    with sessions() as session:
        row = session.get(ExternalAgentTraceDelivery, delivery_id)
        assert row is not None
        assert row.state == "stopped"
        assert row.error_code == "source_deleted_or_expired"
        assert row.attempts == 0
