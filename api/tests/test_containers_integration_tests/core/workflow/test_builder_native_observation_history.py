"""Normal CI only: PostgreSQL diagnostic rows + actual storage, no local collection.

This proves content/owner boundaries, not C03 resume provenance or physical IO.
"""

import json
import logging
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.repositories.sqlalchemy_workflow_execution_repository import SQLAlchemyWorkflowExecutionRepository
from core.repositories.sqlalchemy_workflow_node_execution_repository import SQLAlchemyWorkflowNodeExecutionRepository
from graphon.entities import WorkflowExecution, WorkflowNodeExecution
from graphon.enums import WorkflowExecutionStatus, WorkflowNodeExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from libs.key_providers import generate_key_pair
from libs.sensitive_http_telemetry import SensitiveHttpLogFilter
from models import Account, WorkflowRun
from models.account import Tenant
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.dify_builder_native_tests import NativeTestScope
from models.enums import WorkflowRunTriggeredFrom
from models.model import UploadFile
from models.workflow import (
    Workflow,
    WorkflowNodeExecutionModel,
    WorkflowNodeExecutionOffload,
    WorkflowNodeExecutionTriggeredFrom,
)
from services.dify_builder.execution_contracts import canonical_digest
from services.dify_builder.native_testing.http_binding import (
    NativeHttpBindingResolver,
    build_native_http_profile,
    describe_http_resource,
)
from services.dify_builder.native_testing.observation_adapters import NativeObservationError
from services.dify_builder.native_testing.observation_owner import create_http_observation_guard
from services.dify_builder.native_testing.repository import OwnedNativeTestLoader, native_workflow_revision
from services.dify_builder.native_testing.runtime_contracts import ResolvedNativeTestContext
from services.dify_builder.native_testing.state_store import NativeExecutionStateStore
from services.variable_truncator import VariableTruncator
from tests.test_containers_integration_tests.core.workflow.test_builder_native_continuation import (
    migrated_continuation_tables as migrated_continuation_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_dispatch_claims import (
    migrated_dispatch_claims as migrated_dispatch_claims,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import (
    migrated_native_tables as migrated_native_tables,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_native_effect_ledger import raw_ledger_case
from tests.test_containers_integration_tests.core.workflow.test_builder_native_http_binding import literal_data
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import no_live as no_live  # noqa: PLC0414

CANARY = "PRIVATE_NATIVE_HISTORY_FIXTURE_4f3a"


@pytest.fixture
def history_case(native_owner, no_live, migrated_continuation_tables, migrated_dispatch_claims, request):
    shape = getattr(request, "param", "literal_http")
    # Test-owned application logging sinks use the real installed privacy filter.
    filtering = SensitiveHttpLogFilter()
    handlers = tuple(logging.getLogger().handlers)
    for handler in handlers:
        handler.addFilter(filtering)
    try:
        # Same ordinary raw setup owner as http_case, before one real immutable C03 initialization.
        ledger = raw_ledger_case(native_owner, no_live)
        from extensions.ext_database import db

        _, _, app, workflow, _, _ = native_owner
        assert app.id
        assert workflow.id
        db.session.expunge(app)
        db.session.expunge(workflow)
        db.session.close()
        assert migrated_continuation_tables is None
        assert migrated_dispatch_claims is None
        graph = {
            "nodes": [
                {"id": "start", "data": {"type": "start", "variables": []}},
                {"id": "http", "data": literal_data()},
                {"id": "end", "data": {"type": "end", "outputs": []}},
            ],
            "edges": [
                {"id": "a", "source": "start", "target": "http", "sourceHandle": "source"},
                {"id": "b", "source": "http", "target": "end", "sourceHandle": "source"},
            ],
        }
        if shape == "start_end":
            graph = {
                "nodes": [
                    {"id": "start", "data": {"title": CANARY, "type": "start", "variables": []}},
                    {"id": "end", "data": {"title": CANARY, "type": "end", "outputs": []}},
                ],
                "edges": [{"id": "a", "source": "start", "target": "end", "sourceHandle": "source"}],
            }
        inputs, run_id = {"flag": True}, str(uuid4())
        public_key = generate_key_pair(ledger.actor.tenant_id)
        with ledger.factory.begin() as session:
            session.get(Tenant, ledger.actor.tenant_id).encrypt_public_key = public_key
            request = session.get(DifyBuilderExecutionRequest, ledger.ref.request_id)
            workflow = session.get(Workflow, request.workflow_id)
            workflow.graph = json.dumps(graph)
            revision = native_workflow_revision(workflow)
            manifest = tuple(
                describe_http_resource(
                    node_id=node["id"],
                    raw=node["data"],
                    workflow_revision=revision,
                    app_id=request.app_id,
                    workflow_id=request.workflow_id,
                )
                for node in graph["nodes"]
                if node["data"]["type"] == "http-request"
            )
            test_input = session.get(DifyBuilderTestInput, request.test_input_id)
            request.context = {
                **request.context,
                "request_id": request.id,
                "invocation_id": ledger.ref.invocation_id,
                "native_run_id": run_id,
                "mode": "native",
                "tenant_id": request.tenant_id,
                "actor_id": request.actor_id,
                "app_id": request.app_id,
                "workflow_id": request.workflow_id,
                "session_id": request.session_id,
                "test_input_id": request.test_input_id,
                "execution_revision": revision,
                "input_revision": canonical_digest(inputs),
                "start_schema_hash": test_input.start_schema_hash,
                "resource_manifest_digest": canonical_digest(list(manifest)),
                "profile": build_native_http_profile().model_dump(mode="json"),
            }
            request.context_digest = canonical_digest(request.context)
            ref = ledger.ref.model_copy(update={"context_digest": request.context_digest})
            app_id, workflow_id = request.app_id, request.workflow_id
            test_input.inputs = inputs
            scope = session.get(NativeTestScope, ref.request_id)
            scope.max_calls = scope.max_dispatches = scope.max_cost_units = 16
            scope.budget_limits = scope.budget_spent = {}
            scope.profile = build_native_http_profile().limits
        loader = OwnedNativeTestLoader(ledger.factory, actor=ledger.actor, resolver=NativeHttpBindingResolver())
        store = NativeExecutionStateStore(loader)
        context = ResolvedNativeTestContext(
            ref=ref,
            tenant_id=ledger.actor.tenant_id,
            actor_id=ledger.actor.account_id,
            app_id=app_id,
            workflow_id=workflow_id,
            graph=graph,
            inputs=inputs,
            graph_revision=revision,
            input_revision=canonical_digest(inputs),
            resource_manifest=manifest,
            generation=0,
            native_run_id=run_id,
            root_native_run_id=run_id,
            parent_invocation_id=None,
            call_depth=0,
            budget_ref=ref.request_id,
            cancellation_ref=ref.request_id,
            execution_mode="native",
        )
        store.initialize_context(context=context)
        yield SimpleNamespace(factory=ledger.factory, actor=ledger.actor, store=store, ref=ref, shape=shape)
    finally:
        for handler in handlers:
            handler.removeFilter(filtering)


def repositories(c):
    context = c.store.load_context(ref=c.ref)
    guard = create_http_observation_guard(state=c.store, context=context, on_failure=lambda: None)
    with c.factory() as session:
        user = session.get(Account, c.actor.account_id)
    runs = SQLAlchemyWorkflowExecutionRepository(
        c.factory, context.tenant_id, user, context.app_id, WorkflowRunTriggeredFrom.DEBUGGING
    )
    nodes = SQLAlchemyWorkflowNodeExecutionRepository(
        c.factory, context.tenant_id, user, context.app_id, WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN
    )
    for repository in (runs, nodes):
        repository.bind_native_observation(context=context, guard=guard)
    return context, guard, runs, nodes


def saved(c, monkeypatch, *, offload=False):
    context, guard, runs, nodes = repositories(c)
    now = naive_utc_now()
    run = WorkflowExecution(
        id_=context.native_run_id,
        workflow_id=context.workflow_id,
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph=context.graph,
        inputs={"private": CANARY},
        outputs={"private": CANARY},
        status=WorkflowExecutionStatus.SUCCEEDED,
        error_message=CANARY,
        total_tokens=0,
        total_steps=1,
        exceptions_count=0,
        started_at=now,
        finished_at=now,
    )
    node = WorkflowNodeExecution(
        id=str(uuid4()),
        node_execution_id=str(uuid4()),
        workflow_id=context.workflow_id,
        workflow_execution_id=context.native_run_id,
        index=1,
        predecessor_node_id="start",
        node_id="http",
        node_type="http-request",
        title=CANARY,
        inputs={"private": CANARY},
        process_data={"private": CANARY},
        outputs={"private": CANARY},
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        error=CANARY,
        elapsed_time=0.1,
        metadata={},
        created_at=now,
        finished_at=now,
    )
    runs.save(run)
    if offload:
        monkeypatch.setattr(
            nodes,
            "_create_truncator",
            lambda: VariableTruncator(max_size_bytes=48, string_length_limit=8, array_element_limit=2),
        )
        nodes.save_execution_data(node)
    else:
        nodes.save(node)
    assert node.outputs == {"private": CANARY}
    assert run.inputs == {"private": CANARY}
    return context, node


def test_projected_save_fresh_bound_same_run_reload_including_real_offload(history_case, monkeypatch):
    c = history_case
    context, node = saved(c, monkeypatch, offload=True)
    _, guard, runs, nodes = repositories(c)
    assert not nodes._node_execution_cache
    restored = runs.get_native_observation_run(workflow_run_id=context.native_run_id)
    with c.factory() as session:
        links = session.scalars(
            select(WorkflowNodeExecutionOffload).where(WorkflowNodeExecutionOffload.node_execution_id == node.id)
        ).all()
        assert len(links) == 3
        assert all(session.get(UploadFile, link.file_id).hash for link in links)
    history = nodes.get_by_workflow_execution(context.native_run_id)
    assert len(history) == 1
    assert history[0].node_execution_id == node.node_execution_id
    assert history[0].outputs["redacted"] is True
    assert restored.outputs["redacted"] is True
    assert CANARY not in str(history[0].outputs)
    assert CANARY not in str(restored.graph)
    assert not guard.failed
    assert c.store.load_context(ref=c.ref).native_run_id == context.native_run_id


@pytest.mark.parametrize("fault", ["run_app", "node_actor", "raw_outputs"])
def test_actual_owner_or_legacy_content_refuses_before_cache(history_case, monkeypatch, fault):
    c = history_case
    context, node = saved(c, monkeypatch)
    _, guard, runs, nodes = repositories(c)
    with c.factory.begin() as session:
        if fault == "run_app":
            session.get(WorkflowRun, context.native_run_id).app_id = str(uuid4())
        elif fault == "node_actor":
            session.get(WorkflowNodeExecutionModel, node.id).created_by = str(uuid4())
        else:
            session.get(WorkflowNodeExecutionModel, node.id).outputs = '{"raw":"' + CANARY + '"}'
    with pytest.raises(NativeObservationError, match="native_observation_failed"):
        nodes.get_by_workflow_execution(context.native_run_id)
    assert nodes._node_execution_cache == {}
    assert guard.failed


def test_foreign_upload_owner_refuses_before_actual_storage_read(history_case, monkeypatch):
    from extensions.ext_storage import storage

    c = history_case
    context, node = saved(c, monkeypatch, offload=True)
    _, guard, runs, nodes = repositories(c)
    with c.factory.begin() as session:
        links = session.scalars(
            select(WorkflowNodeExecutionOffload).where(WorkflowNodeExecutionOffload.node_execution_id == node.id)
        ).all()
        for link in links:
            session.get(UploadFile, link.file_id).created_by = str(uuid4())

    forbidden = Mock(side_effect=AssertionError("foreign offload reached storage"))

    monkeypatch.setattr(storage, "load", forbidden)
    with pytest.raises(NativeObservationError):
        nodes.get_db_models_by_workflow_run(context.native_run_id)
    forbidden.assert_not_called()
    assert nodes._node_execution_cache == {}
    assert guard.failed


@pytest.mark.parametrize("history_case", ["start_end", "literal_http"], indirect=True)
def test_initial_current_profile_observation_reads_real_sql_and_protected_object(history_case):
    """CI only: initial guard composition without a native run or effect send."""
    c = history_case
    context = c.store.load_context(ref=c.ref)
    assert bool(context.resource_manifest) == (c.shape == "literal_http")
    with c.factory() as session:
        request = session.get(DifyBuilderExecutionRequest, c.ref.request_id)
        before = (request.state, request.context_digest, request.context)
        assert session.get(WorkflowRun, context.native_run_id) is None
    guard = create_http_observation_guard(state=c.store, context=context, on_failure=lambda: pytest.fail("unknown"))
    assert not guard.failed
    assert CANARY not in json.dumps(guard.graph(context.graph))
    with c.factory() as session:
        request = session.get(DifyBuilderExecutionRequest, c.ref.request_id)
        assert (request.state, request.context_digest, request.context) == before
        assert session.get(WorkflowRun, context.native_run_id) is None
        scope = session.get(NativeTestScope, c.ref.request_id)
        scope.cancelled = True
        session.commit()
    with pytest.raises(NativeObservationError, match="^native_observation_failed$"):
        create_http_observation_guard(state=c.store, context=context, on_failure=lambda: None)
