"""Durable child-create identity; SQL receipts never grant a second POST."""

import dataclasses
import json
from typing import cast

import httpx
import pytest
import pytest_mock
import sqlalchemy.orm
from dify_agent.client import Client
from dify_agent.protocol import CreateRunRequest, CreateRunResponse, RunComposition
from dify_agent.protocol.run_recovery import LookupRunRequest
from httpx._models import Response
from sqlalchemy.orm import sessionmaker

from clients.agent_backend import AgentBackendTransportError, DifyAgentBackendRunClient
from services.agent.workflow_run_recovery import (
    AgentCreateAcknowledgementUnknown,
    AgentCreateIntentConflict,
    AgentCreateRecoveryClient,
    AgentCreateScope,
    WorkflowAgentRunRecovery,
)
from tests.unit_tests.core.workflow.nodes.agent_v2.test_session_store import _execution_row


def _scope() -> AgentCreateScope:
    return AgentCreateScope(
        tenant_id="tenant-1",
        app_id="app-1",
        workflow_id="workflow-1",
        workflow_run_id="run-1",
        node_id="node-1",
        execution_id="execution-1",
        workflow_binding_id="workflow-binding-1",
    )


@pytest.fixture
def recovery(sqlite_engine: sqlalchemy.Engine, sqlite_session: sqlalchemy.orm.Session) -> WorkflowAgentRunRecovery:
    row = _execution_row(
        binding_id="binding-1",
        process_data={"workflow_agent_binding_id": "workflow-binding-1", "kept": "value"},
    )
    sqlite_session.add(row)
    sqlite_session.commit()
    return WorkflowAgentRunRecovery(sessionmaker(bind=sqlite_engine, expire_on_commit=False))


def test_create_intent_is_committed_before_transport_and_survives_service_restart(
    recovery: WorkflowAgentRunRecovery, sqlite_engine: sqlalchemy.Engine
) -> None:
    first, inserted = recovery.reserve(scope=_scope(), attempt=0, key="run-1:execution-1", digest="a" * 64)
    assert inserted
    assert first.child_run_id is None
    restarted = WorkflowAgentRunRecovery(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    same, inserted_again = restarted.reserve(scope=_scope(), attempt=0, key=first.key, digest=first.digest)
    assert same == first
    assert not inserted_again
    assert restarted.process_data(scope=_scope())["kept"] == "value"


def test_recovery_needs_no_executable_request_and_never_posts(
    recovery: WorkflowAgentRunRecovery, mocker: pytest_mock.MockerFixture
) -> None:
    # No durable intent: even a missing client must remain untouched.
    assert (
        recovery.recover_existing(
            scope=_scope(), client=cast(AgentCreateRecoveryClient, None), on_persisted=lambda _data: None
        )
        is None
    )
    recovery.reserve(scope=_scope(), attempt=0, key="saved", digest="a" * 64)
    seen: list[LookupRunRequest] = []
    response = CreateRunResponse(run_id="original-child", status="succeeded")
    client = DifyAgentBackendRunClient(Client(base_url="http://test.invalid"))
    mocker.patch.object(client, "lookup_run", side_effect=lambda request: seen.append(request) or response)
    create = mocker.patch.object(client, "create_run", side_effect=AssertionError("recovery must not post"))
    assert recovery.recover_existing(scope=_scope(), client=client, on_persisted=lambda _data: None) is response
    assert [(item.idempotency_key, item.request_digest) for item in seen] == [("saved", "a" * 64)]
    assert recovery.process_data(scope=_scope())["agent_create_attempts"][0]["child_run_id"] == "original-child"
    create.assert_not_called()


@pytest.mark.parametrize("field", ["tenant_id", "app_id", "workflow_id", "workflow_run_id", "node_id", "execution_id"])
def test_every_execution_owner_component_is_required_before_reservation(
    recovery: WorkflowAgentRunRecovery, field: str
) -> None:
    with pytest.raises(AgentCreateIntentConflict):
        recovery.reserve(
            scope=dataclasses.replace(_scope(), **{field: "different"}),
            attempt=0,
            key="run-1:execution-1",
            digest="a" * 64,
        )


def test_saved_workflow_binding_must_match(recovery: WorkflowAgentRunRecovery) -> None:
    with pytest.raises(AgentCreateIntentConflict):
        recovery.reserve(
            scope=dataclasses.replace(_scope(), workflow_binding_id="another-binding"),
            attempt=0,
            key="run-1:execution-1",
            digest="a" * 64,
        )


def test_changed_payload_or_key_cannot_reuse_attempt(recovery: WorkflowAgentRunRecovery) -> None:
    recovery.reserve(scope=_scope(), attempt=0, key="original", digest="a" * 64)
    for key, digest in [("changed", "a" * 64), ("original", "b" * 64)]:
        with pytest.raises(AgentCreateIntentConflict):
            recovery.reserve(scope=_scope(), attempt=0, key=key, digest=digest)


def test_acknowledged_child_is_pinned_and_cannot_be_replaced(recovery: WorkflowAgentRunRecovery) -> None:
    intent, _ = recovery.reserve(scope=_scope(), attempt=0, key="original", digest="a" * 64)
    saved = recovery.bind_child(scope=_scope(), intent=intent, child_run_id="child-1")
    assert saved.child_run_id == "child-1"
    assert recovery.bind_child(scope=_scope(), intent=intent, child_run_id="child-1") == saved
    with pytest.raises(AgentCreateIntentConflict):
        recovery.bind_child(scope=_scope(), intent=intent, child_run_id="child-2")


def test_binding_child_requires_the_original_durable_intent(recovery: WorkflowAgentRunRecovery) -> None:
    intent, _ = recovery.reserve(scope=_scope(), attempt=0, key="original", digest="a" * 64)
    with pytest.raises(AgentCreateIntentConflict):
        recovery.bind_child(
            scope=_scope(), intent=intent.model_copy(update={"digest": "b" * 64}), child_run_id="child-1"
        )


def test_explicit_output_retry_has_distinct_bounded_attempt_and_preserves_prior_identity(
    recovery: WorkflowAgentRunRecovery,
) -> None:
    original, _ = recovery.reserve(scope=_scope(), attempt=0, key="original", digest="a" * 64)
    recovery.bind_child(scope=_scope(), intent=original, child_run_id="child-1")
    retry, inserted = recovery.reserve(scope=_scope(), attempt=1, key="original:retry-1", digest="b" * 64)
    assert inserted
    assert retry.attempt == 1
    retained, inserted_again = recovery.reserve(scope=_scope(), attempt=0, key="original", digest="a" * 64)
    assert retained.child_run_id == "child-1"
    assert not inserted_again


@pytest.mark.parametrize(
    ("attempt", "key", "digest"),
    [(-1, "valid", "a" * 64), (0, "", "a" * 64), (0, "k" * 257, "a" * 64), (0, "valid", "x" * 64)],
)
def test_invalid_or_unbounded_identity_refuses_without_persistence(
    recovery: WorkflowAgentRunRecovery, attempt: int, key: str, digest: str
) -> None:
    with pytest.raises(AgentCreateIntentConflict):
        recovery.reserve(scope=_scope(), attempt=attempt, key=key, digest=digest)


def _request() -> CreateRunRequest:
    return CreateRunRequest(composition=RunComposition(layers=[]), idempotency_key="run-1:execution-1")


def test_lost_create_ack_queries_existing_child_once_and_never_reposts(recovery: WorkflowAgentRunRecovery) -> None:
    calls = []
    published = []

    def transport(request: httpx.Request) -> Response:
        calls.append(request.url.path)
        if request.url.path == "/runs":
            stored = recovery.process_data(scope=_scope())["agent_create_attempts"]
            assert len(stored) == 1
            assert stored[0]["child_run_id"] is None
            assert published
            assert published[-1]["agent_create_attempts"] == stored
            raise httpx.ReadTimeout("accepted response lost", request=request)
        assert request.url.path == "/runs/lookup"
        selected = json.loads(request.content)
        assert selected["idempotency_key"] == "run-1:execution-1"
        assert len(selected["request_digest"]) == 64
        return httpx.Response(200, json={"run_id": "original-child", "status": "succeeded"})

    client = DifyAgentBackendRunClient(
        Client(base_url="http://test.invalid", sync_http_client=httpx.Client(transport=httpx.MockTransport(transport)))
    )
    result = recovery.start_or_recover(
        scope=_scope(), attempt=0, request=_request(), client=client, on_persisted=published.append
    )
    assert result.run_id == "original-child"
    assert result.status == "succeeded"
    again = recovery.start_or_recover(
        scope=_scope(), attempt=0, request=_request(), client=client, on_persisted=published.append
    )
    assert again == result
    assert calls == ["/runs", "/runs/lookup", "/runs/lookup"]
    assert published[-1]["agent_create_attempts"][0]["child_run_id"] == "original-child"


@pytest.mark.parametrize("lookup_status", [404, 409, 503])
def test_lost_ack_missing_conflicting_or_unavailable_lookup_stays_unknown(
    recovery: WorkflowAgentRunRecovery, lookup_status: int
) -> None:
    calls = []
    published = []

    def transport(request: httpx.Request) -> Response:
        calls.append(request.url.path)
        if request.url.path == "/runs":
            raise httpx.ReadTimeout("accepted response lost", request=request)
        return httpx.Response(lookup_status, json={"detail": "unavailable"})

    client = DifyAgentBackendRunClient(
        Client(base_url="http://test.invalid", sync_http_client=httpx.Client(transport=httpx.MockTransport(transport)))
    )
    for _ in range(2):
        with pytest.raises(AgentCreateAcknowledgementUnknown, match="unknown"):
            recovery.start_or_recover(
                scope=_scope(), attempt=0, request=_request(), client=client, on_persisted=published.append
            )
    assert calls.count("/runs") == 1
    assert calls.count("/runs/lookup") == 2
    assert published[-1]["agent_create_attempts"][0]["child_run_id"] is None


def test_backend_validation_refusal_does_not_lookup_or_recreate(recovery: WorkflowAgentRunRecovery) -> None:
    calls = []

    def transport(request: httpx.Request) -> Response:
        calls.append(request.url.path)
        return httpx.Response(409, json={"detail": {"code": "create_identity_conflict"}})

    client = DifyAgentBackendRunClient(
        Client(base_url="http://test.invalid", sync_http_client=httpx.Client(transport=httpx.MockTransport(transport)))
    )
    with pytest.raises(AgentBackendTransportError):
        recovery.start_or_recover(
            scope=_scope(), attempt=0, request=_request(), client=client, on_persisted=lambda _: None
        )
    assert calls == ["/runs"]
