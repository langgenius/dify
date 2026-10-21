"""CI-only actual Dify/Graphon + PostgreSQL/encrypted C03 native delivery.

Do not import, collect or run on the development host. Only HTTP transport and
queue publication are offline boundaries; Run/history, claims, grants, journal,
checkpoint serialization and physical owned threads use their actual owners.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Never, Unpack

from pydantic import JsonValue
from typing_extensions import TypedDict

from models.account import Account
from models.workflow import Workflow
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
    NativeDeliveryMessage,
    require_instance,
)

if TYPE_CHECKING:
    from collections.abc import Iterator

    from sqlalchemy.orm import Session

    from core.dify_builder.models import Actor
    from dify_app import DifyApp
    from runtime_contracts.builder.native.contracts import (
        NativeTestContextRef,
    )
    from services.dify_builder.native_testing.lifecycle import NativeDispatchRef
    from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
        RuntimeDeliveryCase,
    )

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import test_builder_restricted_native as _fixture_types_0

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import test_builder_restricted_native as _fixture_types_0

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from tests.test_containers_integration_tests.core.workflow import test_builder_restricted_native as _fixture_types_0


import json
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest
from httpx._client import UseClientDefault
from httpx._models import Response
from httpx._types import AuthTypes
from sqlalchemy import select

from core.dify_builder.input_schema import schema_hash, start_schema
from core.dify_builder.models import Actor, Graph
from models.account import Tenant
from models.dify_builder import (
    DifyBuilderExecutionRequest,
    DifyBuilderSession,
    DifyBuilderSessionCommit,
    DifyBuilderTestInput,
)
from models.dify_builder_native_tests import NativeDispatch, NativeInvocationState, NativeTestScope
from models.workflow import WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionPolicyError
from runtime_contracts.builder.native.contracts import decode_native_ref
from runtime_contracts.builder.native.runtime_contracts import CheckpointRef, NativeWorkflowOutcome
from services.dify_builder.native_testing.api_service import NativeTestPublicReceipt
from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime
from services.dify_builder.native_testing.lifecycle import NativeDispatchRef, NativeTestLifecycleService, WaitingReceipt
from services.dify_builder.native_testing.observation_repository import bind_native_repository_observation
from services.dify_builder.native_testing.repository import OwnedNativeTest
from services.dify_builder.native_testing.runtime import DifyNativeRuntime, DifyNativeRuntimeOwner, build_native_api
from tests.test_containers_integration_tests.core.workflow.builder_native_fixture_records import (
    RuntimeDeliveryCase,
    require_present,
)
from tests.test_containers_integration_tests.core.workflow.builder_native_runtime_diagnostics import (
    native_runtime_resume_diagnostics as native_runtime_resume_diagnostics,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    no_live as no_live,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_http_binding import literal_data


class PauseArguments(TypedDict, closed=True):
    ref: NativeTestContextRef
    checkpoint: CheckpointRef
    pending_operation_ids: tuple[str, ...]
    expected_generation: int


class HttpSendArguments(TypedDict, total=False, closed=True):
    stream: bool
    auth: AuthTypes | UseClientDefault | None
    follow_redirects: bool | UseClientDefault


def published_callback(c: RuntimeDeliveryCase) -> Callable[..., None]:
    def publish(**message: Unpack[NativeDeliveryMessage]) -> None:
        c.published.append(message)

    return publish


def initial_graph(kind: str = "root") -> Graph:
    graph: Graph = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "http", "data": literal_data()},
            {
                "id": "end",
                "data": {
                    "type": "end",
                    "title": "End",
                    "outputs": [
                        {"variable": "body", "value_selector": ["http", "body"]},
                    ],
                },
            },
        ],
        "edges": [
            {"id": "start-http", "source": "start", "target": "http", "sourceHandle": "source"},
            {"id": "http-end", "source": "http", "target": "end", "sourceHandle": "source"},
        ],
    }

    if kind == "root":
        return graph
    http = graph["nodes"][1]
    http_data = http["data"]
    assert isinstance(http_data, dict)
    http_data[kind + "_id"] = "container"
    graph["nodes"] = [
        graph["nodes"][0],
        {
            "id": "container",
            "data": {
                "type": kind,
                "start_node_id": "body-start",
                **(
                    {
                        "iterator_selector": ["start", "items"],
                        "output_selector": ["http", "body"],
                        "is_parallel": True,
                        "parallel_nums": 2,
                        "flatten_output": True,
                    }
                    if kind == "iteration"
                    else {"loop_count": 1, "break_conditions": [], "logical_operator": "and"}
                ),
            },
        },
        {"id": "body-start", "data": {"type": kind + "-start", kind + "_id": "container"}},
        http,
        {"id": "end", "data": {"type": "end", "outputs": list[JsonValue]()}},
    ]
    graph["edges"] = [
        {"source": "start", "target": "container"},
        {"source": "body-start", "target": "http"},
        {"source": "container", "target": "end"},
    ]
    return graph


@pytest.fixture
def runtime_case(
    flask_app_with_containers: DifyApp,
    native_owner: _fixture_types_0.NativeOwner,
    no_live: None,
    migrated_continuation_tables: None,
    migrated_dispatch_claims: None,
    mock_ssrf_proxy_requests: Callable[..., httpx.Response],
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
) -> Iterator[RuntimeDeliveryCase]:
    kind = request.param if hasattr(request, "param") else "root"
    assert migrated_continuation_tables is migrated_dispatch_claims is no_live is None
    from core.helper import ssrf_proxy
    from extensions.ext_database import db
    from libs.key_providers import generate_key_pair
    from libs.sensitive_http_telemetry import SensitiveHttpLogFilter

    filtering = SensitiveHttpLogFilter()
    logging_plugin = request.config.pluginmanager.getplugin("logging-plugin")
    # Pytest attaches these real capture/report sinks again for the call phase,
    # after this setup fixture has yielded. Protect those exact handlers too;
    # the production readiness check must continue to reject unfiltered sinks.
    from _pytest.logging import LoggingPlugin

    capture_handlers = (
        (logging_plugin.caplog_handler, logging_plugin.report_handler)
        if isinstance(logging_plugin, LoggingPlugin)
        else ()
    )
    handlers = tuple(
        dict.fromkeys((*logging.getLogger().handlers, *(h for h in capture_handlers if isinstance(h, logging.Handler))))
    )
    for handler in handlers:
        handler.addFilter(filtering)
    try:
        factory, actor, app, workflow, session_id, input_id = native_owner
        # Preserve native_owner teardown IDs, then release its committed setup
        # snapshot before the independent Session updates the tenant key.
        assert app.id
        assert workflow.id
        db.session.expunge(app)
        db.session.expunge(workflow)
        db.session.close()
        public_key = generate_key_pair(actor.tenant_id)
        with factory.begin() as session:
            require_instance(session.get(Tenant, actor.tenant_id), Tenant).encrypt_public_key = public_key
            actual = session.get(Workflow, workflow.id)
            require_instance(actual, Workflow).graph = json.dumps(initial_graph(kind))
            require_instance(actual, Workflow)._features = "{}"
            require_instance(actual, Workflow)._environment_variables = "{}"
            saved_input = session.get(DifyBuilderTestInput, input_id)
            require_instance(saved_input, DifyBuilderTestInput).inputs = (
                {"items": ["one", "two"]} if kind == "iteration" else {}
            )
            require_instance(saved_input, DifyBuilderTestInput).start_schema_hash = schema_hash(
                start_schema(dict(require_instance(actual, Workflow).graph_dict), app.mode)
            )
            builder = session.get(DifyBuilderSession, session_id)
            # This fixture exercises the independently qualified direct-start
            # API from an idle Builder state, not an ordinary queued test action.
            require_instance(builder, DifyBuilderSession).current_state = "build.review"
            version = require_instance(builder, DifyBuilderSession).version
            session.add(
                DifyBuilderSessionCommit(
                    session_id=session_id,
                    version=version,
                    state=require_instance(builder, DifyBuilderSession).current_state,
                    actor="user",
                    context={"test_input_ref": input_id},
                )
            )
        published: list[NativeDeliveryMessage] = []
        sends: list[httpx.Request] = []

        def publish(**message: Unpack[NativeDeliveryMessage]) -> None:
            published.append(message)

        def send(_client: httpx.Client, request: httpx.Request, **_kwargs: object) -> Response:
            sends.append(request)
            assert request.url.host == "example.com"
            return httpx.Response(
                200,
                headers={"content-type": "application/json"},
                content=b'{"private":"response-canary","flag":true}',
                request=request,
            )

        monkeypatch.setattr(httpx.Client, "send", send)
        # Restore the real SSRF facade only while this lower transport is synthetic.
        monkeypatch.setattr(ssrf_proxy, "make_request", mock_ssrf_proxy_requests)
        owner = DifyNativeRuntimeOwner()
        api = build_native_api(sessions=factory, actor=actor, owner=owner, publish=publish)
        admitted = api.start(
            actor=actor,
            session_id=session_id,
            test_input_id=input_id,
            expected_version=version,
            mode="native",
            idempotency_key="actual-initial",
        )
        assert len(published) == 1
        yield RuntimeDeliveryCase(
            factory=factory,
            actor=actor,
            app=flask_app_with_containers,
            session_id=session_id,
            api=api,
            owner=owner,
            published=published,
            sends=sends,
            request_id=admitted.request_id,
            kind=kind,
        )
    finally:
        for handler in handlers:
            handler.removeFilter(filtering)


def delivery(c: RuntimeDeliveryCase, message: NativeDeliveryMessage) -> NativeTestLifecycleService:
    return c.owner.delivery(
        sessions=c.factory,
        delivery=NativeDispatchRef(decode_native_ref(message["ref"]), message["generation"], message["dispatch_id"]),
        actor_hint=Actor(account_id=message["actor"]["account_id"], tenant_id=message["actor"]["tenant_id"]),
    )


def execute(
    c: RuntimeDeliveryCase, lifecycle: NativeTestLifecycleService, message: NativeDeliveryMessage
) -> NativeWorkflowOutcome | None:
    with c.app.app_context():
        return lifecycle.execute_dispatch(
            ref=decode_native_ref(message["ref"]), generation=message["generation"], dispatch_id=message["dispatch_id"]
        )


def confirm(c: RuntimeDeliveryCase) -> NativeTestPublicReceipt:
    receipt = c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)
    assert receipt.status == "waiting"
    assert receipt.wait_reason == "approval"
    assert receipt.native_run_id
    assert 1 <= len(receipt.pending) <= (2 if c.kind == "iteration" else 1)
    for pending in receipt.pending:
        assert pending.scope_digest is not None
        c.api.decide(
            actor=c.actor,
            session_id=c.session_id,
            request_id=c.request_id,
            pending_operation_id=pending.pending_operation_id,
            decision="confirm",
            scope_digest=pending.scope_digest,
            expected_version=receipt.version,
            idempotency_key="confirmation-" + pending.pending_operation_id,
        )
    return receipt


@pytest.mark.parametrize("runtime_case", ["root", "loop", "iteration"], indirect=True)
def test_actual_same_run_http_wait_checkpoint_cleanup_claimed_resume_and_duplicate(
    runtime_case: RuntimeDeliveryCase,
) -> None:
    c = runtime_case
    first = c.published[0]
    initial = delivery(c, first)
    waiting = execute(c, initial, first)
    assert waiting is not None
    assert waiting.status == "waiting"
    assert c.sends == []
    assert waiting.checkpoint_ref is not None
    checkpoint = c.api.store.read_checkpoint(ref=waiting.ref, checkpoint=waiting.checkpoint_ref)
    assert checkpoint.native_run_id == waiting.native_run_id
    assert checkpoint.node_journals
    assert checkpoint.approval_proposals
    with c.factory() as session:
        before = session.get(WorkflowRun, waiting.native_run_id)
        created_at = require_instance(before, WorkflowRun).created_at
        assert require_instance(before, WorkflowRun).status == "paused"
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        assert require_instance(state, NativeInvocationState).cleanup_complete
        assert require_instance(session.get(NativeDispatch, first["dispatch_id"]), NativeDispatch).state == "completed"
    completed = waiting
    second = resumed = None
    for index in range(3):
        receipt = confirm(c)
        c.api.resume(
            actor=c.actor,
            session_id=c.session_id,
            request_id=c.request_id,
            expected_generation=receipt.generation,
            idempotency_key=f"same-run-resume-{index}",
        )
        c.api.lifecycle.publish_pending(publish=published_callback(c))
        second = c.published[-1]
        resumed = delivery(c, second)
        completed = execute(c, resumed, second)
        assert completed is not None
        if completed.status != "waiting":
            break
    assert completed.status == "completed"
    assert completed.native_status == "succeeded"
    assert completed.native_run_id == receipt.native_run_id == waiting.native_run_id
    assert len(c.sends) == (2 if c.kind == "iteration" else 1)
    assert second is not None
    assert resumed is not None
    # Same real used acquisition/capacity is retained even after cleanup.
    assert delivery(c, second) is resumed
    assert execute(c, resumed, second) is None
    assert len(c.sends) == (2 if c.kind == "iteration" else 1)
    with c.factory() as session:
        run = session.get(WorkflowRun, completed.native_run_id)
        assert require_instance(run, WorkflowRun).created_at == created_at
        assert require_instance(run, WorkflowRun).status == "succeeded"
        outputs = require_instance(run, WorkflowRun).outputs
        assert outputs is not None
        assert "response-canary" not in outputs
        assert (
            len(
                session.scalars(
                    select(WorkflowRun).where(WorkflowRun.id == require_instance(run, WorkflowRun).id)
                ).all()
            )
            == 1
        )


def test_real_resume_writer_refuses_wait_cleanup_before_source_finalize_then_same_command_succeeds(
    runtime_case: RuntimeDeliveryCase,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    c = runtime_case
    message = c.published[0]
    lifecycle = delivery(c, message)
    held, release = Event(), Event()
    actual_pause = lifecycle.pause

    def pause(**kwargs: Unpack[PauseArguments]) -> WaitingReceipt:
        receipt = actual_pause(**kwargs)
        if require_instance(require_present(lifecycle._capacity)._verifier, NativeHostLifetime)._consumed:
            held.set()  # Real wait and cleanup committed; no SQL writer held.
            assert release.wait(15)
        return receipt

    monkeypatch.setattr(lifecycle, "pause", pause)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(execute, c, lifecycle, message)
        try:
            assert held.wait(15)
            confirm(c)
            with pytest.raises(BuilderExecutionPolicyError, match="native_resume_unsettled"):
                c.api.resume(
                    actor=c.actor,
                    session_id=c.session_id,
                    request_id=c.request_id,
                    expected_generation=0,
                    idempotency_key="race-resume",
                )
            with c.factory() as session:
                state = session.scalar(
                    select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id)
                )
                scope = session.get(NativeTestScope, c.request_id)
                assert (
                    require_instance(state, NativeInvocationState).generation
                    == require_instance(scope, NativeTestScope).generation
                    == 0
                )
                assert require_instance(state, NativeInvocationState).cleanup_complete
                assert (
                    require_instance(scope, NativeTestScope).spent_calls
                    == require_instance(scope, NativeTestScope).spent_dispatches
                    == 0
                )
                assert (
                    len(session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all())
                    == 1
                )
                assert (
                    require_instance(session.get(NativeDispatch, message["dispatch_id"]), NativeDispatch).state
                    == "claimed"
                )
        finally:
            release.set()
        assert require_instance(future.result(timeout=15), NativeWorkflowOutcome).status == "waiting"
    c.api.resume(
        actor=c.actor,
        session_id=c.session_id,
        request_id=c.request_id,
        expected_generation=0,
        idempotency_key="race-resume",
    )
    with c.factory() as session:
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        assert require_instance(state, NativeInvocationState).generation == 1
        assert require_instance(state, NativeInvocationState).state == "queued"
        assert len(session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()) == 2
    assert c.sends == []


@pytest.mark.parametrize("registered_before_cancel", [False, True])
def test_actual_api_cancel_initial_outbox_before_delivery_is_logically_settled(
    runtime_case: RuntimeDeliveryCase, registered_before_cancel: bool
) -> None:
    c = runtime_case
    message = c.published[0]
    assert c.owner._requests == c.owner._current == {}
    registered = delivery(c, message) if registered_before_cancel else None
    if registered is not None:
        assert isinstance(registered.runtime, DifyNativeRuntime)
        assert registered.runtime.host.lifetime._registry is None
    result = c.api.cancel(
        actor=c.actor, session_id=c.session_id, request_id=c.request_id, idempotency_key="before-worker"
    )
    assert require_present(result.cancellation).status == "cancelled"
    assert result.status == "terminal"
    assert c.api.lifecycle.reconcile() == 0
    late = delivery(c, message)
    with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
        execute(c, late, message)
    c.owner.retire_closed(sessions=c.factory)
    assert c.owner._requests == c.owner._current == {}
    if registered is not None:
        assert isinstance(registered.runtime, DifyNativeRuntime)
        assert registered.runtime.registry._disposed
        assert not registered.runtime.host.lifetime._consumed
        with pytest.raises(ValueError, match="native_host_acquisition_not_current"):
            registered.runtime.registry.activate(lifetime=registered.runtime.host.lifetime)
    assert c.sends == []
    with c.factory() as session:
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        assert require_instance(state, NativeInvocationState).generation == 0
        assert require_instance(state, NativeInvocationState).cleanup_complete
        dispatches = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()
        assert len(dispatches) == 1
        assert dispatches[0].state == "cancelled"
        assert dispatches[0].claim_expires_at is None
        request = session.get(DifyBuilderExecutionRequest, c.request_id)
        assert request is not None
        assert result.native_run_id is None
        assert session.get(WorkflowRun, request.context["native_run_id"]) is None


def test_actual_cancel_through_consumed_source_owner_does_not_ack_live_resumed_owner(
    runtime_case: RuntimeDeliveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = runtime_case
    initial = delivery(c, c.published[0])
    waiting = execute(c, initial, c.published[0])
    assert waiting is not None
    assert waiting.status == "waiting"
    assert require_instance(initial.runtime, DifyNativeRuntime).host.lifetime._consumed
    receipt = confirm(c)
    c.api.resume(
        actor=c.actor,
        session_id=c.session_id,
        request_id=c.request_id,
        expected_generation=receipt.generation,
        idempotency_key="cancel-other-owner-resume",
    )
    c.api.lifecycle.publish_pending(publish=published_callback(c))
    message = c.published[-1]
    assert message["generation"] == 1
    other = DifyNativeRuntimeOwner()
    resumed = other.delivery(
        sessions=c.factory,
        delivery=NativeDispatchRef(decode_native_ref(message["ref"]), message["generation"], message["dispatch_id"]),
    )
    assert isinstance(resumed.runtime, DifyNativeRuntime)
    entered, release = Event(), Event()
    actual_send = httpx.Client.send

    def held_send(client: httpx.Client, request: httpx.Request, **kwargs: Unpack[HttpSendArguments]) -> Response:
        entered.set()
        assert release.wait(15)
        return actual_send(client, request, **kwargs)

    monkeypatch.setattr(httpx.Client, "send", held_send)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(execute, c, resumed, message)
        try:
            assert entered.wait(15)
            result = c.api.cancel(
                actor=c.actor,
                session_id=c.session_id,
                request_id=c.request_id,
                idempotency_key="cancel-through-old-process",
            )
            assert require_present(result.cancellation).status in {"cancelling", "unknown"}
            assert not require_instance(resumed.runtime, DifyNativeRuntime).host.lifetime._consumed
            c.api.lifecycle.reconcile()
            with c.factory() as session:
                state = session.scalar(
                    select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id)
                )
                assert require_instance(state, NativeInvocationState).generation == 1
                assert not require_instance(state, NativeInvocationState).cleanup_complete
                assert (
                    require_instance(session.get(NativeDispatch, message["dispatch_id"]), NativeDispatch).state
                    == "claimed"
                )
                assert (
                    require_instance(session.get(NativeDispatch, c.published[0]["dispatch_id"]), NativeDispatch).state
                    == "completed"
                )
        finally:
            release.set()
        # The actual worker closes or fails under the durable cancellation fence;
        # its result/exception is not a cleanup receipt for the older owner.
        from services.dify_builder.native_testing.observation_adapters import NativeObservationError

        try:
            future.result(timeout=15)
        except (BuilderExecutionPolicyError, NativeObservationError):
            assert require_present(
                c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id).cancellation
            ).status in {
                "cancelling",
                "unknown",
                "cancelled",
            }
    assert require_instance(initial.runtime, DifyNativeRuntime).host.lifetime._consumed


def test_actual_initial_run_null_outputs_survive_first_native_node_persistence(
    runtime_case: RuntimeDeliveryCase,
) -> None:
    """Real mapped insert/read witness before any graph effect or cleanup claim."""
    from uuid import uuid4

    from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
    from core.repositories.sqlalchemy_workflow_node_execution_repository import (
        SQLAlchemyWorkflowNodeExecutionRepository,
    )
    from graphon.entities import WorkflowExecution, WorkflowNodeExecution
    from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
    from libs.datetime_utils import naive_utc_now
    from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
    from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom

    c = runtime_case
    lifecycle = delivery(c, c.published[0])
    assert isinstance(lifecycle.runtime, DifyNativeRuntime)
    context = lifecycle.runtime.context
    guard = require_instance(lifecycle.runtime, DifyNativeRuntime).host.native_observation
    with c.factory() as session:
        account = session.get(Account, context.actor_id)
        assert account is not None
        session.expunge(account)
    runs = SQLAlchemyWorkflowExecutionRepository(
        c.factory, context.tenant_id, account, context.app_id, WorkflowRunTriggeredFrom.DEBUGGING
    )
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        c.factory, context.tenant_id, account, context.app_id, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    )
    bind_native_repository_observation(repository=runs, context=context, guard=guard)
    bind_native_repository_observation(repository=nodes, context=context, guard=guard)
    now = naive_utc_now()
    execution = WorkflowExecution(
        id_=context.native_run_id,
        workflow_id=context.workflow_id,
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph=context.graph,
        inputs=context.inputs,
        started_at=now,
    )
    assert execution.outputs is None
    runs.save(execution)
    with c.factory() as session:
        row = session.scalar(
            select(WorkflowRun).where(
                WorkflowRun.id == context.native_run_id,
                WorkflowRun.tenant_id == context.tenant_id,
                WorkflowRun.app_id == context.app_id,
                WorkflowRun.workflow_id == context.workflow_id,
                WorkflowRun.created_by == context.actor_id,
                WorkflowRun.created_by_role == CreatorUserRole.ACCOUNT,
            )
        )
        assert row is not None
        assert row.status is WorkflowExecutionStatus.RUNNING
        assert row.outputs == "null"
    restored = runs.get_native_observation_run(workflow_run_id=context.native_run_id)
    assert restored.outputs is None
    assert not guard.failed
    node_id = str(uuid4())
    nodes.save(
        WorkflowNodeExecution(
            id=node_id,
            node_execution_id=node_id,
            workflow_id=context.workflow_id,
            workflow_execution_id=context.native_run_id,
            index=1,
            node_id="start",
            node_type="start",
            title="Start",
            status=WorkflowNodeExecutionStatus.SUCCEEDED,
            inputs={},
            outputs={},
            process_data={},
            created_at=now,
            finished_at=now,
        )
    )
    with c.factory() as session:
        row = session.scalar(
            select(WorkflowNodeExecutionModel).where(
                WorkflowNodeExecutionModel.id == node_id,
                WorkflowNodeExecutionModel.workflow_run_id == context.native_run_id,
                WorkflowNodeExecutionModel.tenant_id == context.tenant_id,
                WorkflowNodeExecutionModel.app_id == context.app_id,
                WorkflowNodeExecutionModel.workflow_id == context.workflow_id,
                WorkflowNodeExecutionModel.created_by == context.actor_id,
                WorkflowNodeExecutionModel.created_by_role == CreatorUserRole.ACCOUNT,
            )
        )
        assert row is not None
        assert row.status is WorkflowNodeExecutionStatus.SUCCEEDED
    assert execution.outputs is None
    assert not guard.failed
    assert c.sends == []


def test_real_cancel_after_wait_cleanup_before_source_finalize_preserves_unknown(
    runtime_case: RuntimeDeliveryCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CI-only actual WAIT/SQL/checkpoint/verifier race; no synthesized ACK or source settlement."""
    from models.dify_builder_native_tests import (
        NativeContinuation,
        NativeEffectAttempt,
        NativeEffectDispatchClaim,
        NativeEffectOperation,
        NativePendingAction,
    )

    c = runtime_case
    message = c.published[0]
    ref = decode_native_ref(message["ref"])
    lifecycle = delivery(c, message)
    held, release = Event(), Event()
    actual_pause = lifecycle.pause
    waits: list[WaitingReceipt] = []

    def pause(**kwargs: Unpack[PauseArguments]) -> WaitingReceipt:
        receipt = actual_pause(**kwargs)
        if require_instance(require_present(lifecycle._capacity)._verifier, NativeHostLifetime)._consumed:
            waits.append(receipt)
            held.set()  # Real protected WAIT + consumed physical verifier, before finalizer.
            assert release.wait(15)
        return receipt

    monkeypatch.setattr(lifecycle, "pause", pause)
    # A separate API process owner has no retained worker lifetime to fabricate ACK.
    api = build_native_api(
        sessions=c.factory, actor=c.actor, owner=DifyNativeRuntimeOwner(), publish=published_callback(c)
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(execute, c, lifecycle, message)
        try:
            assert held.wait(15)
            assert require_instance(lifecycle.runtime, DifyNativeRuntime).host.lifetime._consumed
            waiting = waits[0]
            assert waiting.generation == 0
            assert waiting.wait_reason == "approval"
            checkpoint = c.api.store.read_checkpoint(ref=ref, checkpoint=waiting.checkpoint)
            assert checkpoint.generation == 0
            assert checkpoint.node_journals
            assert checkpoint.approval_proposals
            with c.factory() as session:
                request = session.get(DifyBuilderExecutionRequest, c.request_id)
                state = session.scalar(
                    select(NativeInvocationState).where(
                        NativeInvocationState.tenant_id == c.actor.tenant_id,
                        NativeInvocationState.request_id == c.request_id,
                        NativeInvocationState.invocation_id == ref.invocation_id,
                    )
                )
                scope = session.get(NativeTestScope, c.request_id)
                source = session.get(NativeDispatch, message["dispatch_id"])
                continuation = session.scalar(
                    select(NativeContinuation).where(
                        NativeContinuation.tenant_id == c.actor.tenant_id,
                        NativeContinuation.request_id == c.request_id,
                        NativeContinuation.invocation_id == ref.invocation_id,
                        NativeContinuation.checkpoint_id == waiting.checkpoint.checkpoint_id,
                    )
                )
                pending = session.scalars(
                    select(NativePendingAction).where(NativePendingAction.request_id == c.request_id)
                ).all()
                assert continuation is not None
                assert continuation.generation == 0
                assert continuation.payload_digest == waiting.checkpoint.payload_digest
                assert (
                    set(require_instance(state, NativeInvocationState).pending_ids)
                    == set(waiting.pending_operation_ids)
                    == {row.id for row in pending}
                )
                assert all(row.generation == 0 and row.category == "approval" for row in pending)
                assert require_instance(state, NativeInvocationState).checkpoint_id == continuation.checkpoint_id
                assert (
                    require_instance(state, NativeInvocationState).generation
                    == require_instance(scope, NativeTestScope).generation
                    == require_instance(source, NativeDispatch).generation
                    == 0
                )
                assert require_instance(state, NativeInvocationState).cleanup_complete
                assert require_instance(source, NativeDispatch).state == "claimed"
                assert (
                    require_instance(source, NativeDispatch).tenant_id,
                    require_instance(source, NativeDispatch).request_id,
                    require_instance(source, NativeDispatch).invocation_id,
                ) == (
                    c.actor.tenant_id,
                    c.request_id,
                    ref.invocation_id,
                )
                native_run_id = checkpoint.native_run_id
                run = session.get(WorkflowRun, native_run_id)
                created_at = require_instance(run, WorkflowRun).created_at
                assert require_instance(run, WorkflowRun).status == "paused"
                assert (
                    require_instance(request, DifyBuilderExecutionRequest).context["native_run_id"]
                    == require_instance(run, WorkflowRun).id
                )
                assert (
                    require_instance(scope, NativeTestScope).spent_calls
                    == require_instance(scope, NativeTestScope).spent_dispatches
                    == 0
                )
                operation_ids = {
                    row.id
                    for row in session.scalars(
                        select(NativeEffectOperation).where(NativeEffectOperation.request_id == c.request_id)
                    )
                }
                for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
                    assert session.scalar(select(model.id).where(model.request_id == c.request_id)) is None
            cancelled = api.cancel(
                actor=c.actor, session_id=c.session_id, request_id=c.request_id, idempotency_key="ack-window-cancel"
            )
            assert require_present(cancelled.cancellation).status == "cancelling"
            assert cancelled.outcome is None
            assert cancelled.status == "running"
            assert cancelled.native_run_id == native_run_id
            assert cancelled.native_status == "paused"
        finally:
            release.set()
        # The unchanged finalizer rejects cancelled authority. execute_dispatch's
        # real exception tail must persist unknown while retaining the physical ACK.
        with pytest.raises(BuilderExecutionPolicyError, match="native_dispatch_conflict"):
            future.result(timeout=15)
    assert c.sends == []
    assert require_instance(lifecycle.runtime, DifyNativeRuntime).host.lifetime._consumed
    for _ in range(2):
        for receipt in (
            api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id),
            api.cancel(
                actor=c.actor, session_id=c.session_id, request_id=c.request_id, idempotency_key="ack-window-cancel"
            ),
        ):
            assert require_present(receipt.cancellation).status == receipt.outcome == "unknown"
            assert receipt.status == "terminal"
            assert set(require_present(receipt.cancellation).operation_states) == operation_ids
            assert set(require_present(receipt.cancellation).operation_states.values()) <= {"not_dispatched"}
            assert receipt.native_run_id == native_run_id
            assert receipt.native_status == "paused"
            assert receipt.generation == 0
            assert receipt.pending == ()
        assert api.lifecycle.reconcile() == 0
    with c.factory() as session:
        state = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        scope = session.get(NativeTestScope, c.request_id)
        sources = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()
        assert len(sources) == 1
        source = sources[0]
        assert (
            source.id,
            source.tenant_id,
            source.request_id,
            source.invocation_id,
            source.generation,
            source.state,
        ) == (message["dispatch_id"], c.actor.tenant_id, c.request_id, ref.invocation_id, 0, "unknown")
        assert require_instance(state, NativeInvocationState).state == "cancelled"
        assert require_instance(state, NativeInvocationState).cleanup_complete
        assert require_instance(scope, NativeTestScope).cancelled
        assert (
            require_instance(state, NativeInvocationState).generation
            == require_instance(scope, NativeTestScope).generation
            == 0
        )
        assert require_instance(state, NativeInvocationState).checkpoint_id == waiting.checkpoint.checkpoint_id
        assert (
            require_instance(scope, NativeTestScope).spent_calls
            == require_instance(scope, NativeTestScope).spent_dispatches
            == 0
        )
        run = session.get(WorkflowRun, native_run_id)
        assert require_instance(run, WorkflowRun).status == "paused"
        assert require_instance(run, WorkflowRun).created_at == created_at
        assert len(session.scalars(select(WorkflowRun).where(WorkflowRun.id == native_run_id)).all()) == 1
        assert {
            row.id
            for row in session.scalars(
                select(NativeEffectOperation).where(NativeEffectOperation.request_id == c.request_id)
            )
        } == operation_ids
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
            assert session.scalar(select(model.id).where(model.request_id == c.request_id)) is None
    assert len(c.published) == 1
    assert c.sends == []


def test_actual_settled_wait_completed_source_cancel_is_clean_and_preserves_native_pause(
    runtime_case: RuntimeDeliveryCase,
) -> None:
    """Positive CI-only counterpart: real WAIT/source finalization precede API cancel."""
    from models.dify_builder_native_tests import NativeEffectAttempt, NativeEffectDispatchClaim, NativeEffectOperation

    c = runtime_case
    message = c.published[0]
    lifecycle = delivery(c, message)
    assert isinstance(lifecycle.runtime, DifyNativeRuntime)
    waiting = execute(c, lifecycle, message)
    assert waiting is not None
    assert waiting.status == "waiting"
    assert waiting.wait_reason == "approval"
    assert require_instance(lifecycle.runtime, DifyNativeRuntime).host.lifetime._consumed
    assert c.sends == []
    assert waiting.checkpoint_ref is not None
    checkpoint = c.api.store.read_checkpoint(ref=waiting.ref, checkpoint=waiting.checkpoint_ref)
    assert checkpoint.native_run_id == waiting.native_run_id
    assert checkpoint.generation == 0
    assert checkpoint.node_journals
    assert checkpoint.approval_proposals
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.tenant_id == c.actor.tenant_id,
                NativeInvocationState.request_id == c.request_id,
                NativeInvocationState.invocation_id == waiting.ref.invocation_id,
            )
        )
        scope = session.get(NativeTestScope, c.request_id)
        source = session.get(NativeDispatch, message["dispatch_id"])
        assert (
            require_instance(source, NativeDispatch).tenant_id,
            require_instance(source, NativeDispatch).request_id,
            require_instance(source, NativeDispatch).invocation_id,
        ) == (
            c.actor.tenant_id,
            c.request_id,
            waiting.ref.invocation_id,
        )
        assert (
            require_instance(state, NativeInvocationState).generation
            == require_instance(scope, NativeTestScope).generation
            == require_instance(source, NativeDispatch).generation
            == 0
        )
        assert require_instance(state, NativeInvocationState).cleanup_complete
        assert require_instance(source, NativeDispatch).state == "completed"
        assert require_instance(state, NativeInvocationState).checkpoint_id == waiting.checkpoint_ref.checkpoint_id
        pending_ids = tuple(require_instance(state, NativeInvocationState).pending_ids)
        assert pending_ids == waiting.pending_operation_ids
        run = session.get(WorkflowRun, waiting.native_run_id)
        created_at, elapsed_time = (
            require_instance(run, WorkflowRun).created_at,
            require_instance(run, WorkflowRun).elapsed_time,
        )
        assert require_instance(run, WorkflowRun).status == "paused"
        assert (
            require_instance(scope, NativeTestScope).spent_calls
            == require_instance(scope, NativeTestScope).spent_dispatches
            == 0
        )
        operation_ids = {
            row.id
            for row in session.scalars(
                select(NativeEffectOperation).where(NativeEffectOperation.request_id == c.request_id)
            )
        }
        assert operation_ids
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
            assert session.scalar(select(model.id).where(model.request_id == c.request_id)) is None
    for _ in range(2):
        cancelled = c.api.cancel(
            actor=c.actor, session_id=c.session_id, request_id=c.request_id, idempotency_key="settled-wait-cancel"
        )
        for receipt in (cancelled, c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)):
            assert (receipt.status, receipt.outcome, require_present(receipt.cancellation).status) == (
                "terminal",
                "cancelled",
                "cancelled",
            )
            assert receipt.native_run_id == waiting.native_run_id
            assert receipt.native_status == "paused"
            assert receipt.generation == 0
            assert receipt.wait_reason is None
            assert receipt.pending == ()
            assert set(require_present(receipt.cancellation).operation_states) == operation_ids
            assert set(require_present(receipt.cancellation).operation_states.values()) == {"not_dispatched"}
        assert c.api.lifecycle.reconcile() == 0
        with pytest.raises(BuilderExecutionPolicyError, match="native_cancelled"):
            c.api.resume(
                actor=c.actor,
                session_id=c.session_id,
                request_id=c.request_id,
                expected_generation=0,
                idempotency_key="settled-wait-cancel-resume-denied",
            )
    with c.factory() as session:
        state = session.scalar(
            select(NativeInvocationState).where(
                NativeInvocationState.tenant_id == c.actor.tenant_id,
                NativeInvocationState.request_id == c.request_id,
                NativeInvocationState.invocation_id == waiting.ref.invocation_id,
            )
        )
        scope = session.get(NativeTestScope, c.request_id)
        sources = session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()
        assert len(sources) == 1
        source = sources[0]
        assert (source.id, source.tenant_id, source.request_id, source.invocation_id) == (
            message["dispatch_id"],
            c.actor.tenant_id,
            c.request_id,
            waiting.ref.invocation_id,
        )
        assert source.state == "completed"
        assert require_instance(state, NativeInvocationState).state == "cancelled"
        assert require_instance(state, NativeInvocationState).cleanup_complete
        assert (
            require_instance(state, NativeInvocationState).generation
            == require_instance(scope, NativeTestScope).generation
            == source.generation
            == 0
        )
        assert require_instance(scope, NativeTestScope).cancelled
        assert (
            require_instance(scope, NativeTestScope).spent_calls
            == require_instance(scope, NativeTestScope).spent_dispatches
            == 0
        )
        assert (
            require_instance(session.get(DifyBuilderExecutionRequest, c.request_id), DifyBuilderExecutionRequest).state
            == "sealed"
        )
        assert require_instance(state, NativeInvocationState).checkpoint_id == waiting.checkpoint_ref.checkpoint_id
        assert tuple(require_instance(state, NativeInvocationState).pending_ids) == pending_ids
        run = session.get(WorkflowRun, waiting.native_run_id)
        assert require_instance(run, WorkflowRun).status == "paused"
        assert require_instance(run, WorkflowRun).created_at == created_at
        assert require_instance(run, WorkflowRun).elapsed_time == elapsed_time
        assert len(session.scalars(select(WorkflowRun).where(WorkflowRun.id == waiting.native_run_id)).all()) == 1
        assert {
            row.id
            for row in session.scalars(
                select(NativeEffectOperation).where(NativeEffectOperation.request_id == c.request_id)
            )
        } == operation_ids
        for model in (NativeEffectAttempt, NativeEffectDispatchClaim):
            assert session.scalar(select(model.id).where(model.request_id == c.request_id)) is None
    assert require_instance(lifecycle.runtime, DifyNativeRuntime).host.lifetime._consumed
    assert len(c.published) == 1
    assert c.sends == []


@pytest.mark.parametrize("stop_path", ["initial-preparation-fault", "resumed-approved-redirect"])
def test_actual_known_stop_settles_sql_cleanup_and_finalizes_exact_source(
    runtime_case: RuntimeDeliveryCase, monkeypatch: pytest.MonkeyPatch, stop_path: str
) -> None:
    """CI-only SQL/native STOP composition; never import/collect/run locally.

    The initial witness injects only a preparation ValueError to exercise the
    genuine typed policy conversion before any intent/send. It does not claim
    a naturally invalid literal is admitted. Redirect uses a real API
    approval decision; no operation is pregranted or lifecycle ACK fabricated.
    """
    from models.dify_builder_native_tests import (
        NativeEffectDispatchClaim,
        NativeEffectOutcome,
        NativeTestInvocation,
    )
    from services.dify_builder.native_testing.host_lifetime import NativeHostLifetime
    from services.dify_builder.native_testing.http_adapter import NativeHttpClient
    from services.dify_builder.native_testing.lifecycle import NativeTestLifecycleService

    c = runtime_case
    first = c.published[0]
    initial = delivery(c, first)
    cleanup_proofs: list[tuple[int, str]] = []
    finalizations: list[tuple[int, str]] = []
    actual_cleanup = NativeHostLifetime.consume_cleanup
    actual_finalize = NativeTestLifecycleService.finalize_dispatch_locked

    def consume(lifetime: NativeHostLifetime, *, ref: NativeTestContextRef, generation: int, dispatch_id: str) -> None:
        # The real capacity owner calls this OUTSIDE its SQL writer, after the
        # actual reader/source, worker and dispatcher have all settled.
        if ref.request_id == c.request_id:
            lifetime.require_settled_root()
            with c.factory() as session:
                local = session.scalar(
                    select(NativeInvocationState).where(
                        NativeInvocationState.request_id == c.request_id,
                        NativeInvocationState.invocation_id == ref.invocation_id,
                    )
                )
                assert local is not None
                assert not local.cleanup_complete
                assert require_instance(session.get(NativeDispatch, dispatch_id), NativeDispatch).state == "claimed"
            threads = tuple(item.thread for item in lifetime._threads)
            assert threads
            assert all(not thread.is_alive() for thread in threads)
        result = actual_cleanup(lifetime, ref=ref, generation=generation, dispatch_id=dispatch_id)
        if ref.request_id == c.request_id:
            assert result is None
            assert lifetime._consumed
            cleanup_proofs.append((generation, dispatch_id))
        return result

    def finalize(
        lifecycle: NativeTestLifecycleService,
        *,
        session: Session,
        owned: OwnedNativeTest,
        scope: NativeTestScope,
        dispatch_id: str,
        generation: int,
        outcome: NativeWorkflowOutcome,
    ) -> None:
        if owned.ref.request_id == c.request_id and outcome.status == "stopped":
            local = session.scalar(
                select(NativeInvocationState).where(
                    NativeInvocationState.request_id == c.request_id,
                    NativeInvocationState.invocation_id == owned.ref.invocation_id,
                )
            )
            assert require_instance(local, NativeInvocationState).cleanup_complete
            assert (generation, dispatch_id) in cleanup_proofs
            assert require_instance(session.get(NativeDispatch, dispatch_id), NativeDispatch).state == "claimed"
            finalizations.append((generation, dispatch_id))
        return actual_finalize(
            lifecycle,
            session=session,
            owned=owned,
            scope=scope,
            dispatch_id=dispatch_id,
            generation=generation,
            outcome=outcome,
        )

    monkeypatch.setattr(NativeHostLifetime, "consume_cleanup", consume)
    monkeypatch.setattr(NativeTestLifecycleService, "finalize_dispatch_locked", finalize)
    if stop_path == "initial-preparation-fault":

        def preparation_fault(_client: object, *_args: object, **_kwargs: object) -> Never:
            raise ValueError("fixture_native_http_preparation_failure")

        monkeypatch.setattr(NativeHttpClient, "_prepare", preparation_fault)
        source, lifecycle = first, initial
        result = execute(c, lifecycle, source)
        assert result is not None
        expected_reason, expected_sends, expected_generation = "native_http_preparation_failed", 0, 0
    else:
        waiting = execute(c, initial, first)
        assert waiting is not None
        assert waiting.status == "waiting"
        assert c.sends == []
        with c.factory() as session:
            original_started = require_instance(session.get(WorkflowRun, waiting.native_run_id), WorkflowRun).created_at
        receipt = c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)
        assert receipt.status == "waiting"
        assert len(receipt.pending) == 1
        pending = receipt.pending[0]
        c.api.decide(
            actor=c.actor,
            session_id=c.session_id,
            request_id=c.request_id,
            pending_operation_id=pending.pending_operation_id,
            decision="confirm",
            scope_digest=require_instance(pending.scope_digest, str),
            expected_version=receipt.version,
            idempotency_key="known-stop-decision",
        )
        c.api.resume(
            actor=c.actor,
            session_id=c.session_id,
            request_id=c.request_id,
            expected_generation=receipt.generation,
            idempotency_key="known-stop-resume",
        )
        c.api.lifecycle.publish_pending(publish=published_callback(c))
        source = c.published[-1]
        lifecycle = delivery(c, source)
        assert source["generation"] == 1
        if stop_path == "resumed-approved-redirect":

            def redirect(
                _client: httpx.Client, request: httpx.Request, **kwargs: Unpack[HttpSendArguments]
            ) -> Response:
                c.sends.append(request)
                assert kwargs.get("follow_redirects") is False
                return httpx.Response(
                    302,
                    headers={"Location": "https://example.com/never-followed"},
                    content=b"redirect-response-canary",
                    request=request,
                )

            monkeypatch.setattr(httpx.Client, "send", redirect)
        result = execute(c, lifecycle, source)
        assert result is not None
        assert result.native_run_id == waiting.native_run_id
        with c.factory() as session:
            assert (
                require_instance(session.get(WorkflowRun, result.native_run_id), WorkflowRun).created_at
                == original_started
            )
        expected_reason = "native_http_redirect_limit"
        expected_sends, expected_generation = 1, 1
    assert result.status == "stopped"
    assert result.reason_code == expected_reason
    assert len(c.sends) == expected_sends
    assert source["generation"] == expected_generation
    assert require_instance(lifecycle.runtime, DifyNativeRuntime).host.lifetime._consumed
    assert not require_instance(lifecycle.runtime, DifyNativeRuntime).host.lifetime.unknown
    assert finalizations == [(expected_generation, source["dispatch_id"])]
    assert (expected_generation, source["dispatch_id"]) in cleanup_proofs
    with c.factory() as session:
        request = session.get(DifyBuilderExecutionRequest, c.request_id)
        local = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        invocation = session.scalar(select(NativeTestInvocation).where(NativeTestInvocation.request_id == c.request_id))
        run = session.get(WorkflowRun, result.native_run_id)
        assert require_instance(request, DifyBuilderExecutionRequest).state == "sealed"
        assert not require_instance(session.get(NativeTestScope, c.request_id), NativeTestScope).cancelled
        assert not require_instance(invocation, NativeTestInvocation).active
        assert require_instance(local, NativeInvocationState).state == "stopped"
        outcome = require_instance(local, NativeInvocationState).outcome
        assert outcome is not None
        assert outcome["status"] == "stopped"
        assert require_instance(local, NativeInvocationState).generation == expected_generation
        assert require_instance(local, NativeInvocationState).cleanup_complete
        assert outcome["native_run_id"] == result.native_run_id
        assert require_instance(session.get(NativeDispatch, source["dispatch_id"]), NativeDispatch).state == "completed"
        assert require_instance(run, WorkflowRun).status == "stopped"
        claims = session.scalars(
            select(NativeEffectDispatchClaim).where(NativeEffectDispatchClaim.request_id == c.request_id)
        ).all()
        outcomes = session.scalars(
            select(NativeEffectOutcome).where(NativeEffectOutcome.request_id == c.request_id)
        ).all()
        assert len(claims) == len(outcomes) == expected_sends
        assert all(outcome.outcome == "completed" and outcome.result_ref for outcome in outcomes)
    # Both retained duplicate execution and a distinct consumer's claim refuse
    # replay. Neither creates a new physical lifetime or another HTTP request.
    assert delivery(c, source) is lifecycle
    assert execute(c, lifecycle, source) is None
    foreign = DifyNativeRuntimeOwner().delivery(
        sessions=c.factory,
        delivery=NativeDispatchRef(decode_native_ref(source["ref"]), source["generation"], source["dispatch_id"]),
        actor_hint=c.actor,
    )
    assert not foreign.claim_dispatch(
        ref=decode_native_ref(source["ref"]), generation=source["generation"], dispatch_id=source["dispatch_id"]
    )
    assert len(c.sends) == expected_sends
    assert finalizations == [(expected_generation, source["dispatch_id"])]


def test_actual_denied_pending_cannot_borrow_stop_settlement_for_resume(runtime_case: RuntimeDeliveryCase) -> None:
    """A real denial remains unresolved; evidence settlement cannot admit it."""
    c = runtime_case
    source = c.published[0]
    lifecycle = delivery(c, source)
    waiting = execute(c, lifecycle, source)
    assert waiting is not None
    assert waiting.status == "waiting"
    assert c.sends == []
    receipt = c.api.get(actor=c.actor, session_id=c.session_id, request_id=c.request_id)
    pending = receipt.pending[0]
    c.api.decide(
        actor=c.actor,
        session_id=c.session_id,
        request_id=c.request_id,
        pending_operation_id=pending.pending_operation_id,
        decision="deny",
        scope_digest=require_instance(pending.scope_digest, str),
        expected_version=receipt.version,
        idempotency_key="known-stop-denial-admission-negative",
    )
    with pytest.raises(BuilderExecutionPolicyError, match="native_pending_unresolved"):
        c.api.resume(
            actor=c.actor,
            session_id=c.session_id,
            request_id=c.request_id,
            expected_generation=receipt.generation,
            idempotency_key="known-stop-denied-resume",
        )
    assert c.sends == []
    assert len(c.published) == 1
    with c.factory() as session:
        local = session.scalar(select(NativeInvocationState).where(NativeInvocationState.request_id == c.request_id))
        assert require_instance(local, NativeInvocationState).state == "waiting"
        assert require_instance(local, NativeInvocationState).generation == 0
        assert require_instance(local, NativeInvocationState).cleanup_complete
        assert require_instance(local, NativeInvocationState).outcome is None
        assert require_instance(session.get(WorkflowRun, waiting.native_run_id), WorkflowRun).status == "paused"
        assert require_instance(session.get(NativeDispatch, source["dispatch_id"]), NativeDispatch).state == "completed"
        assert len(session.scalars(select(NativeDispatch).where(NativeDispatch.request_id == c.request_id)).all()) == 1
    assert execute(c, lifecycle, source) is None
