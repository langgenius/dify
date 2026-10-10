"""Real SQLite owner/state controls. PostgreSQL locking is CI-owned."""

import importlib
import json
from datetime import datetime
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from core.dify_builder import execution_policy as domain
from core.dify_builder.models import Actor
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import Base, TypeBase
from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
from models.model import App
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionModel, WorkflowRun, WorkflowType
from tests.unit_tests.core.dify_builder.test_execution_policy import fixture, graph, policy


def service_module():
    return importlib.import_module("services.dify_builder.execution_policy_service")


@pytest.fixture
def owned():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TypeBase.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    tenant, app_id, session_id, ti_id, workflow_id = [str(uuid4()) for _ in range(5)]
    with factory.begin() as db:
        workspace = Tenant(name="Workspace")
        workspace.id = tenant
        db.add(workspace)
        account = Account(name="Owner", email="owner@example.invalid")
        db.add(account)
        db.flush()
        db.add(TenantAccountJoin(tenant_id=tenant, account_id=account.id, role=TenantAccountRole.OWNER))
        app = App(
            id=app_id, tenant_id=tenant, mode="workflow", name="test", tracing=None, enable_site=False, enable_api=False
        )
        workflow = Workflow(
            id=workflow_id,
            tenant_id=tenant,
            app_id=app_id,
            type=WorkflowType.WORKFLOW,
            kind=WorkflowKind.STANDARD,
            version="draft",
            graph=json.dumps(graph()),
            _features="{}",
            created_by=account.id,
            _environment_variables="{}",
            _conversation_variables="{}",
        )
        db.add_all(
            [
                app,
                workflow,
                DifyBuilderSession(
                    id=session_id,
                    app_id=app_id,
                    tenant_id=tenant,
                    owner_account_id=account.id,
                    entry_mode="build",
                    current_state="build.await_testdata",
                ),
                DifyBuilderTestInput(
                    id=ti_id, session_id=session_id, source="mock", inputs={"n": "41"}, start_schema_hash=""
                ),
            ]
        )
    yield factory, Actor(account_id=account.id, tenant_id=tenant), app, workflow, session_id, ti_id
    engine.dispose()


def prepare_inputs(owned, **kwargs):
    factory, actor, app, workflow, sid, tid = owned
    return (
        service_module()
        .BuilderExecutionPolicyService(factory)
        .prepare(
            session_id=sid,
            test_input_id=tid,
            app_id=app.id,
            actor=actor,
            workflow=workflow,
            submitted_inputs={"n": "41"},
            effective_inputs={"n": 41},
            **kwargs,
        )
    )


def test_owned_preparation_binds_both_inputs_and_does_not_infer_mock_mode(owned):
    context = prepare_inputs(owned)
    assert context.mode == "restricted"
    assert context.submitted_inputs_digest != context.effective_inputs_digest
    assert len(context.admitted_nodes) == 2


@pytest.mark.parametrize(
    "owner", ["membership", "account", "workspace", "session_owner", "session_app", "session_tenant", "test_session"]
)
def test_full_owner_chain_required(owned, owner):
    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        if owner == "membership":
            db.execute(delete(TenantAccountJoin))
        elif owner == "account":
            db.execute(delete(Account))
        elif owner == "workspace":
            db.execute(delete(Tenant))
        elif owner == "test_session":
            db.get(DifyBuilderTestInput, tid).session_id = str(uuid4())
        else:
            row = db.get(DifyBuilderSession, sid)
            setattr(
                row,
                {"session_owner": "owner_account_id", "session_app": "app_id", "session_tenant": "tenant_id"}[owner],
                str(uuid4()),
            )
    with pytest.raises(policy().BuilderExecutionPolicyError):
        prepare_inputs(owned)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("_environment_variables", '{"secret":{}}'),
        ("_conversation_variables", "null"),
        ("_environment_variables", "[]"),
        ("_features", '{"unknown":{"enabled":true}}'),
    ],
)
def test_metadata_refusal_precedes_revision_access(owned, monkeypatch, field, value):
    module = service_module()

    def forbidden(*_args):
        raise AssertionError("revision accessed after metadata refusal")

    monkeypatch.setattr(module, "execution_revision", forbidden)
    setattr(owned[3], field, value)
    with pytest.raises(policy().BuilderExecutionPolicyError):
        prepare_inputs(owned)


def test_launch_exactly_once_and_observation_binding(owned):
    p = policy()
    service = service_module().BuilderExecutionPolicyService(owned[0])
    context = prepare_inputs(owned)
    observation = p.BuilderExecutionObservation(
        observation_id="receipt",
        invocation_id="call",
        request_id=context.request_id,
        node_id="start",
        kind="effect_blocked",
        implementation_version=context.admitted_nodes[0].implementation + ":1",
        reason_code="unsupported_effect",
    )
    with pytest.raises(p.BuilderExecutionPolicyError):
        service.record(context=context, native_run_id="run", task_id="task", observation=observation)
    service.claim_launch(context=context, native_run_id="run", task_id="task")
    with pytest.raises(p.BuilderExecutionPolicyError):
        service.claim_launch(context=context, native_run_id="run", task_id="task")
    with pytest.raises(p.BuilderExecutionPolicyError):
        service.record(context=context, native_run_id="other", task_id="task", observation=observation)
    service.record(context=context, native_run_id="run", task_id="task", observation=observation)
    with pytest.raises(p.BuilderExecutionPolicyError):
        service.record(context=context, native_run_id="run", task_id="task", observation=observation)
    recorder = service.recorder(context=context, native_run_id="run", task_id="task")
    with pytest.raises(p.BuilderExecutionPolicyError):
        recorder.record(observation)
    assert not recorder.healthy
    with pytest.raises(p.BuilderExecutionPolicyError):
        recorder.record(observation.model_copy(update={"observation_id": "new"}))
    assert not recorder.healthy


def test_fixture_stamp_lineage_stale_reuse_and_malformed_persistence(owned):
    factory, actor, app, workflow, sid, tid = owned
    module = service_module()
    service = module.BuilderExecutionPolicyService(factory)
    workflow.graph = json.dumps(graph(http=True))
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
    revision = module.execution_revision(workflow)
    envelope = service.stamp_http_fixtures(app.id, actor, base_app_revision=revision, fixtures=(fixture(),))
    with factory.begin() as db:
        db.get(DifyBuilderTestInput, tid).http_fixtures = envelope.model_dump(mode="json")
    assert prepare_inputs(owned).mode == "mock"
    with pytest.raises(policy().BuilderExecutionPolicyError, match="stale_http_fixtures"):
        service.stamp_http_fixtures(app.id, actor, base_app_revision="old", fixtures=(fixture(),))
    with factory.begin() as db:
        db.get(DifyBuilderTestInput, tid).http_fixtures = {"schema_version": 1, "fixtures": []}
    with pytest.raises(policy().BuilderExecutionPolicyError, match="invalid_http_fixture_envelope"):
        prepare_inputs(owned)
    with factory.begin() as db:
        db.get(DifyBuilderTestInput, tid).http_fixtures = envelope.model_dump(mode="json")
        changed = graph(http=True)
        changed["nodes"][1]["data"]["url"] = "https://changed.invalid"
        workflow.graph = json.dumps(changed)
        db.get(Workflow, workflow.id).graph = workflow.graph
    with pytest.raises(policy().BuilderExecutionPolicyError, match="stale_http_fixtures"):
        prepare_inputs(owned)


@pytest.mark.parametrize(
    "change",
    [
        "root",
        "transport",
        "resume",
        "depth",
        "inputs",
        "graph",
        "environment",
        "conversation",
        "tracing",
        "owner",
        "fixtures",
    ],
)
def test_revalidation_refuses_changed_execution(owned, change, monkeypatch):
    factory, actor, app, workflow, sid, tid = owned
    module = service_module()
    context = prepare_inputs(owned)
    kwargs = {
        "context": context,
        "workflow": workflow,
        "app": app,
        "actor_id": actor.account_id,
        "effective_inputs": {"n": 41},
        "root_node_id": "start",
        "call_depth": 0,
        "transport": "in_process",
        "resume": False,
    }
    if change in {"root", "transport", "resume", "depth", "inputs"}:
        name, value = {
            "root": ("root_node_id", "end"),
            "transport": ("transport", "celery"),
            "resume": ("resume", True),
            "depth": ("call_depth", 1),
            "inputs": ("effective_inputs", {"n": 42}),
        }[change]
        kwargs[name] = value
    elif change == "tracing":
        app.tracing = '{"enabled":true,"tracing_provider":"secret"}'
    elif change == "environment":
        workflow._environment_variables = '{"secret":{}}'
    elif change == "conversation":
        workflow._conversation_variables = "[]"
    else:
        with factory.begin() as db:
            if change == "graph":
                workflow.graph = json.dumps(graph(http=True))
                db.get(Workflow, workflow.id).graph = workflow.graph
            elif change == "owner":
                db.get(DifyBuilderSession, sid).owner_account_id = str(uuid4())
            else:
                db.get(DifyBuilderTestInput, tid).http_fixtures = {}
    if change in {"environment", "conversation", "tracing"}:
        monkeypatch.setattr(module, "execution_revision", lambda *_args: pytest.fail("refusal accessed revision"))
    with pytest.raises(policy().BuilderExecutionPolicyError):
        module.BuilderExecutionPolicyService(factory).revalidate(**kwargs)


def test_sealed_append_and_tampered_full_context_refused(owned):
    from models.dify_builder import DifyBuilderExecutionRequest

    p = policy()
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    with pytest.raises(p.BuilderExecutionPolicyError):
        service.claim_launch(
            context=context.model_copy(update={"actor_id": "foreign"}), native_run_id="run", task_id="task"
        )
    service.claim_launch(context=context, native_run_id="run", task_id="task")
    with owned[0].begin() as db:
        db.get(DifyBuilderExecutionRequest, context.request_id).state = "sealed"
    observation = p.BuilderExecutionObservation(
        observation_id="receipt",
        invocation_id="call",
        request_id=context.request_id,
        node_id="start",
        kind="effect_blocked",
        implementation_version=context.admitted_nodes[0].implementation + ":1",
        reason_code="unsupported_effect",
    )
    with pytest.raises(p.BuilderExecutionPolicyError):
        service.record(context=context, native_run_id="run", task_id="task", observation=observation)


@pytest.mark.parametrize("handler_name", ["build", "edit", "fix"])
def test_all_handlers_persist_actual_server_stamp(owned, monkeypatch, handler_name):
    from datetime import datetime

    from core.dify_builder import handlers_build, handlers_edit, handlers_fix
    from core.dify_builder.models import Action, DifyBuilderContext, EntryMode, Turn
    from core.dify_builder.models import Session as BuilderSession
    from core.dify_builder.runner import Env
    from core.dify_builder.state import PcState
    from services.dify_builder import dify_port
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent

    factory, actor, app, workflow, sid, tid = owned
    workflow.graph = json.dumps(graph(http=True))
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
    revision = service_module().execution_revision(workflow)
    monkeypatch.setattr(dify_port, "_session_factory", lambda: factory)
    port = FakeDifyPort()
    port.graph = graph(http=True)
    port.hash = revision
    port.stamp_http_fixtures = dify_port.WorkflowServiceDifyPort().stamp_http_fixtures
    repo = InMemoryRepository()
    env = Env(dify=port, repo=repo, agent=StubAgent(), now=lambda: datetime.min)
    session = BuilderSession(
        id=sid,
        app_id=app.id,
        tenant_id=actor.tenant_id,
        owner_account_id=actor.account_id,
        entry_mode=EntryMode(handler_name),
        current_state=PcState.FIX_AWAIT_TESTDATA,
    )
    turn = Turn(
        actor=actor,
        action=Action(
            kind="provide_testdata",
            base_app_revision=revision,
            payload={"inputs": {}, "http_fixtures": [fixture().model_dump(mode="json")]},
        ),
    )
    handler = {"build": handlers_build, "edit": handlers_edit, "fix": handlers_fix}[handler_name].handle_await_testdata
    result = handler(env, turn, session, DifyBuilderContext())
    saved = repo.get_test_input(result.context.test_input_ref)
    assert saved.http_fixtures.execution_revision == revision
    assert saved.http_fixtures.fixtures[0].status_code == 201
    assert saved.http_fixtures.fixtures[0].source == "user_sample"


@pytest.mark.parametrize("field", ["app_id", "tenant_id"])
def test_supplied_workflow_identity_cannot_disagree_with_owned_row(owned, field):
    setattr(owned[3], field, str(uuid4()))
    with pytest.raises(policy().BuilderExecutionPolicyError, match="execution_owner_mismatch"):
        prepare_inputs(owned)


def test_raw_tracing_refusal_in_prepare_and_fixture_stamp_precedes_revision(owned, monkeypatch):
    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        db.get(App, app.id).tracing = '{"enabled":true,"tracing_provider":"secret"}'
    module = service_module()
    monkeypatch.setattr(module, "execution_revision", lambda *_args: pytest.fail("tracing refusal accessed revision"))
    service = module.BuilderExecutionPolicyService(factory)
    with pytest.raises(policy().BuilderExecutionPolicyError, match="unsupported_external_tracing"):
        prepare_inputs(owned)
    with pytest.raises(policy().BuilderExecutionPolicyError, match="unsupported_external_tracing"):
        service.stamp_http_fixtures(app.id, actor, base_app_revision="a" * 64, fixtures=())


@pytest.mark.parametrize("boundary", ["snapshot", "prepare", "stamp"])
@pytest.mark.parametrize(
    "malformed_graph",
    [
        {"nodes": None, "edges": []},
        {"nodes": [None], "edges": []},
        {"nodes": [{"id": "start", "data": "private"}], "edges": []},
        {"nodes": [{"id": "start", "data": {"type": "start", "variables": "private"}}], "edges": []},
        {"nodes": [{"id": "start", "data": {"type": "start", "variables": [None]}}], "edges": []},
    ],
)
def test_malformed_snapshot_refusal_is_sanitized_before_revision(owned, monkeypatch, malformed_graph, boundary):
    factory, actor, app, workflow, sid, tid = owned
    workflow.graph = json.dumps(malformed_graph)
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
    module = service_module()
    monkeypatch.setattr(module, "execution_revision", lambda *_args: pytest.fail("malformed draft accessed revision"))
    service = module.BuilderExecutionPolicyService(factory)
    invoke = {
        "snapshot": lambda: module.restricted_admission_snapshot(workflow, app),
        "prepare": lambda: prepare_inputs(owned),
        "stamp": lambda: service.stamp_http_fixtures(app.id, actor, base_app_revision="a" * 64, fixtures=()),
    }[boundary]
    with pytest.raises(policy().BuilderExecutionPolicyError, match="invalid_graph_metadata") as error:
        invoke()
    assert "private" not in str(error.value)


def test_append_verifies_fixture_node_implementation_profile_and_bound_limit(owned):
    from models.dify_builder import DifyBuilderExecutionRequest

    factory, actor, app, workflow, sid, tid = owned
    module = service_module()
    workflow.graph = json.dumps(graph(http=True))
    service = module.BuilderExecutionPolicyService(factory)
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
    envelope = service.stamp_http_fixtures(
        app.id, actor, base_app_revision=module.execution_revision(workflow), fixtures=(fixture(),)
    )
    with factory.begin() as db:
        db.get(DifyBuilderTestInput, tid).http_fixtures = envelope.model_dump(mode="json")
    context = prepare_inputs(owned)
    service.claim_launch(context=context, native_run_id="run", task_id="task")
    observation = policy().BuilderExecutionObservation(
        observation_id="served",
        invocation_id="attempt-1",
        request_id=context.request_id,
        node_id="http",
        kind="fixture_served",
        implementation_version=fixture().implementation + ":1",
        reason_code="http_fixture_served",
        fixture_digest=context.fixture_digest,
    )
    for changes in (
        {"node_id": "end"},
        {"request_id": "foreign"},
        {"implementation_version": "1"},
        {"fixture_digest": "a" * 64},
        {"profile_digest": "a" * 64},
    ):
        with pytest.raises(policy().BuilderExecutionPolicyError):
            service.record(
                context=context, native_run_id="run", task_id="task", observation=observation.model_copy(update=changes)
            )
    service.record(context=context, native_run_id="run", task_id="task", observation=observation)
    with pytest.raises(policy().BuilderExecutionPolicyError, match="duplicate_capability_invocation"):
        service.record(
            context=context,
            native_run_id="run",
            task_id="task",
            observation=observation.model_copy(update={"observation_id": "new"}),
        )
    with factory.begin() as db:
        db.get(DifyBuilderExecutionRequest, context.request_id).observations = [
            observation.model_dump(mode="json")
        ] * 4096
    with pytest.raises(policy().BuilderExecutionPolicyError, match="observation_limit_exceeded"):
        service.record(
            context=context,
            native_run_id="run",
            task_id="task",
            observation=observation.model_copy(update={"observation_id": "new", "invocation_id": "attempt-2"}),
        )


def test_native_rbac_requires_both_scenes_and_allows_delegated_membership(owned, monkeypatch):
    from configs import dify_config
    from core.rbac import RBACPermission
    from services.enterprise.rbac_service import RBACService

    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        db.query(TenantAccountJoin).update({"role": TenantAccountRole.NORMAL})
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    calls = []

    def check(_tenant_id, _account_id, *, scene, resource_type, resource_id):
        assert resource_type == "app"
        assert resource_id == app.id
        calls.append(scene)
        return scene == RBACPermission.APP_EDIT

    monkeypatch.setattr(RBACService.CheckAccess, "check", check)
    with pytest.raises(policy().BuilderExecutionPolicyError, match="execution_permission_denied"):
        prepare_inputs(owned)
    assert calls == [RBACPermission.APP_EDIT, RBACPermission.APP_TEST_AND_RUN]
    monkeypatch.setattr(RBACService.CheckAccess, "check", lambda *_args, **_kwargs: True)
    assert prepare_inputs(owned).actor_id == actor.account_id


def test_native_rbac_plain_app_maintainer_bypass_is_persisted(owned, monkeypatch):
    from configs import dify_config
    from services.enterprise.rbac_service import RBACService

    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        db.get(App, app.id).maintainer = actor.account_id
        db.query(TenantAccountJoin).update({"role": TenantAccountRole.NORMAL})
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr(
        RBACService.CheckAccess, "check", lambda *_args, **_kwargs: pytest.fail("maintainer bypass called RPC")
    )
    assert prepare_inputs(owned).actor_id == actor.account_id


@pytest.mark.parametrize("status", ["active", "archived"])
def test_native_rbac_agent_app_binding_precedes_maintainer_bypass(owned, monkeypatch, status):
    from configs import dify_config
    from models.agent import Agent, AgentScope, AgentSource, AgentStatus
    from services.enterprise.rbac_service import RBACService

    factory, actor, app, workflow, sid, tid = owned
    Agent.__table__.create(factory.kw["bind"], checkfirst=True)
    with factory.begin() as db:
        row = db.get(App, app.id)
        row.mode = "agent"
        row.maintainer = actor.account_id
        db.add(
            Agent(
                tenant_id=actor.tenant_id,
                name="Bound agent",
                scope=AgentScope.ROSTER,
                source=AgentSource.AGENT_APP,
                status=AgentStatus(status),
                app_id=app.id,
            )
        )
    monkeypatch.setattr(dify_config, "RBAC_ENABLED", True)
    monkeypatch.setattr(
        RBACService.CheckAccess, "check", lambda *_args, **_kwargs: pytest.fail("Agent guard called RPC")
    )
    with pytest.raises(policy().BuilderExecutionPolicyError, match="unsupported_workflow"):
        service_module().BuilderExecutionPolicyService(factory).stamp_http_fixtures(
            app.id, actor, base_app_revision="a" * 64, fixtures=()
        )


def completion(context, run_id=None, **changes):
    return domain.TrustedExecutionCompletion(
        context=context,
        native_run_id=run_id,
        task_id="task" if run_id else None,
        worker_finished=True,
        worker_exit="returned",
        recorder_healthy=True,
        response_completed=True,
        **changes,
    )


def native_rows(owned, context, status="succeeded"):
    factory, actor, app, workflow, _, _ = owned
    run_id = str(uuid4())
    service_module().BuilderExecutionPolicyService(factory).claim_launch(
        context=context, native_run_id=run_id, task_id="task"
    )
    with factory.begin() as db:
        db.add(
            WorkflowRun(
                id=run_id,
                tenant_id=actor.tenant_id,
                app_id=app.id,
                workflow_id=workflow.id,
                type="workflow",
                triggered_from="debugging",
                version="draft",
                graph=workflow.graph,
                inputs=json.dumps({"n": 41, "sys.workflow_run_id": run_id}),
                status=status,
                created_by_role="account",
                created_by=actor.account_id,
                total_steps=2,
                finished_at=datetime.now(),
                outputs='{"out":41}',
                exceptions_count=0,
            )
        )
        for index, node in enumerate(json.loads(workflow.graph)["nodes"], 1):
            db.add(
                WorkflowNodeExecutionModel(
                    id=str(uuid4()),
                    tenant_id=actor.tenant_id,
                    app_id=app.id,
                    workflow_id=workflow.id,
                    workflow_run_id=run_id,
                    node_execution_id=str(uuid4()),
                    node_id=node["id"],
                    node_type=node["data"]["type"],
                    title="test",
                    index=index,
                    # Native Graphon start events leave this optional field unset.
                    predecessor_node_id=None,
                    triggered_from="workflow-run",
                    created_by_role="account",
                    created_by=actor.account_id,
                    status="succeeded",
                    finished_at=datetime.now(),
                )
            )
    return run_id


def test_seal_requires_authoritative_native_rows_and_is_idempotent(owned):
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context)
    done = completion(context, run_id)
    result = service.seal(request_id=context.request_id, completion=done)
    assert result.safety_outcome == "restricted_execution_completed"
    assert result.native_run_id == run_id
    assert service.seal(request_id=context.request_id, completion=done) == result
    with pytest.raises(domain.BuilderExecutionPolicyError):
        service.seal(request_id=context.request_id, completion=done.model_copy(update={"response_completed": False}))


@pytest.mark.parametrize(
    ("start_predecessor", "end_predecessor", "outcome"),
    [
        (None, None, "restricted_execution_completed"),
        (None, "start", "restricted_execution_completed"),
        ("", None, "restricted_execution_completed"),
        ("", "start", "restricted_execution_completed"),
        ("start", None, "execution_evidence_unknown"),
        ("end", None, "execution_evidence_unknown"),
        (None, "end", "execution_evidence_unknown"),
        (None, "foreign", "execution_evidence_unknown"),
        (None, "", "execution_evidence_unknown"),
    ],
)
def test_native_predecessor_corroborates_chain_when_present(owned, start_predecessor, end_predecessor, outcome):
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context)
    with owned[0].begin() as db:
        nodes = list(db.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)))
        nodes[0].predecessor_node_id = start_predecessor
        nodes[1].predecessor_node_id = end_predecessor
    result = service.seal(request_id=context.request_id, completion=completion(context, run_id))
    assert result.safety_outcome == outcome
    with owned[0]() as db:
        nodes = list(db.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)))
        assert [node.predecessor_node_id for node in nodes] == [start_predecessor, end_predecessor]


def test_optional_predecessor_change_cannot_rewrite_sealed_evidence(owned):
    from models.dify_builder import DifyBuilderExecutionRequest

    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context)
    done = completion(context, run_id)
    result = service.seal(request_id=context.request_id, completion=done)
    assert result.safety_outcome == "restricted_execution_completed"
    with owned[0].begin() as db:
        end = db.scalar(select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "end"))
        assert end is not None
        end.predecessor_node_id = "start"
    with pytest.raises(domain.BuilderExecutionPolicyError, match="conflicting_execution_completion"):
        service.seal(request_id=context.request_id, completion=done)
    with owned[0]() as db:
        request = db.get(DifyBuilderExecutionRequest, context.request_id)
        assert request is not None
        assert request.completion_summary == result.model_dump(mode="json")


@pytest.mark.parametrize("missing", ["worker", "response", "recorder", "node", "run"])
def test_incomplete_proof_seals_unknown(owned, missing):
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context)
    done = completion(context, run_id)
    field = {"worker": "worker_finished", "response": "response_completed", "recorder": "recorder_healthy"}.get(missing)
    if field:
        done = done.model_copy(update={field: False})
    else:
        with owned[0].begin() as db:
            if missing == "run":
                db.delete(db.get(WorkflowRun, run_id))
            else:
                from sqlalchemy import select

                db.delete(db.scalars(select(WorkflowNodeExecutionModel)).first())
    result = service.seal(request_id=context.request_id, completion=done)
    assert result.safety_outcome == "execution_evidence_unknown"


@pytest.mark.parametrize("status", ["failed", "stopped", "partial-succeeded"])
def test_complete_non_success_native_status_remains_native_failed(owned, status):
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context, status)
    assert (
        service.seal(request_id=context.request_id, completion=completion(context, run_id)).safety_outcome
        == "native_failed"
    )


@pytest.mark.parametrize(
    ("kind", "status", "missing", "outcome"),
    [
        (
            "effect_blocked",
            "succeeded",
            False,
            "execution_blocked",
        ),  # Defensive SQL state, not actual Graphon default output.
        ("effect_blocked", "partial-succeeded", False, "native_failed"),
        ("effect_blocked", "succeeded", True, "execution_evidence_unknown"),
        ("effect_blocked", "succeeded", "malformed_receipt", "execution_evidence_unknown"),
        ("fixture_served", "succeeded", False, "simulation_completed"),
        (None, "succeeded", False, "execution_evidence_unknown"),
    ],
)
def test_http_receipts_and_unknown_first_precedence(owned, kind, status, missing, outcome):
    from sqlalchemy import select

    from models.dify_builder import DifyBuilderTestInput
    from models.workflow import Workflow
    from services.dify_builder.revision import execution_revision
    from tests.unit_tests.core.dify_builder.test_execution_policy import fixture, graph

    factory, actor, app, workflow, sid, tid = owned
    workflow.graph = json.dumps(graph(http=True))
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
        if kind == "fixture_served":
            db.get(DifyBuilderTestInput, tid).http_fixtures = domain.HttpFixtureSetV1(
                execution_revision=execution_revision(workflow), fixtures=(fixture(),)
            ).model_dump(mode="json")
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(factory)
    run_id = native_rows(owned, context, status)
    if kind:
        service.record(
            context=context,
            native_run_id=run_id,
            task_id="task",
            observation=domain.BuilderExecutionObservation(
                observation_id="o",
                invocation_id="i",
                request_id=context.request_id,
                node_id="http",
                kind=kind,
                implementation_version="graphon.nodes.http_request.node.HttpRequestNode:1",
                reason_code="test",
                fixture_digest=context.fixture_digest if kind == "fixture_served" else None,
            ),
        )
    with factory.begin() as db:
        db.get(WorkflowRun, run_id).total_steps = 3
        nodes = list(db.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)))
        if missing == "malformed_receipt":
            from models.dify_builder import DifyBuilderExecutionRequest

            row = db.get(DifyBuilderExecutionRequest, context.request_id)
            row.observations = [*row.observations, {"broken": True}]
        elif missing:
            db.delete(nodes[0])
    result = service.seal(request_id=context.request_id, completion=completion(context, run_id))
    assert result.safety_outcome == outcome
    assert result.blocked_node_ids == (("http",) if kind == "effect_blocked" else ())
    with factory() as db:
        assert db.get(WorkflowRun, run_id).status == status


@pytest.mark.parametrize(
    "mutation",
    [
        "actor",
        "node_actor",
        "graph",
        "inputs",
        "node_execution",
        "steps",
        "node_order",
        "index_gap",
        "duplicate_index",
        "missing_start",
        "missing_end",
        "unknown_node",
        "duplicate_node",
        "node_type",
    ],
)
def test_canonical_native_owner_and_proof_mutations(owned, mutation):
    from sqlalchemy import select

    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context)
    with owned[0].begin() as db:
        run = db.get(WorkflowRun, run_id)
        nodes = list(db.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)))
        if mutation == "actor":
            run.created_by = str(uuid4())
        elif mutation == "node_actor":
            nodes[0].created_by = str(uuid4())
        elif mutation == "graph":
            run.graph = "{}"
        elif mutation == "inputs":
            run.inputs = '{"n":42}'
        elif mutation == "node_execution":
            nodes[0].node_execution_id = nodes[1].node_execution_id
        elif mutation == "node_order":
            nodes[0].index, nodes[1].index = 2, 1
        elif mutation == "index_gap":
            nodes[1].index = 3
        elif mutation == "duplicate_index":
            nodes[1].index = 1
        elif mutation in {"missing_start", "missing_end"}:
            db.delete(nodes[0] if mutation == "missing_start" else nodes[1])
            run.total_steps = 1
        elif mutation == "unknown_node":
            nodes[1].node_id = "foreign"
        elif mutation == "duplicate_node":
            nodes[1].node_id = nodes[0].node_id
        elif mutation == "node_type":
            nodes[1].node_type = "start"
        else:
            run.total_steps = 3
    if mutation in {"actor", "node_actor"}:
        with pytest.raises(domain.BuilderExecutionPolicyError, match="owner_mismatch"):
            service.seal(request_id=context.request_id, completion=completion(context, run_id))
    else:
        assert (
            service.seal(request_id=context.request_id, completion=completion(context, run_id)).safety_outcome
            == "execution_evidence_unknown"
        )


@pytest.mark.parametrize(
    ("status", "outcome"),
    [
        ("failed", "native_failed"),
        ("stopped", "native_failed"),
        ("succeeded", "execution_evidence_unknown"),
        ("partial-succeeded", "execution_evidence_unknown"),
    ],
)
def test_null_predecessor_prefix_requires_failed_or_stopped_run(owned, status, outcome):
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context, status)
    with owned[0].begin() as db:
        run = db.get(WorkflowRun, run_id)
        assert run is not None
        run.total_steps = 1
        nodes = list(db.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)))
        nodes[0].status = "failed"
        db.delete(nodes[1])
    assert service.seal(request_id=context.request_id, completion=completion(context, run_id)).safety_outcome == outcome


@pytest.mark.parametrize(
    ("receipt_count", "retry_index", "total_steps", "outcome"),
    [
        (2, 1, 4, "native_failed"),
        (1, 1, 4, "execution_evidence_unknown"),
        (3, 1, 4, "execution_evidence_unknown"),
        (2, 2, 4, "execution_evidence_unknown"),
        (2, 1, 3, "execution_evidence_unknown"),
    ],
)
def test_null_predecessor_http_retry_requires_all_attempt_proof(
    owned, receipt_count, retry_index, total_steps, outcome
):
    from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY

    factory, _, _, workflow, _, _ = owned
    workflow.graph = json.dumps(graph(http=True))
    with factory.begin() as db:
        draft = db.get(Workflow, workflow.id)
        assert draft is not None
        draft.graph = workflow.graph
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(factory)
    run_id = native_rows(owned, context, "partial-succeeded")
    for attempt in range(receipt_count):
        service.record(
            context=context,
            native_run_id=run_id,
            task_id="task",
            observation=domain.BuilderExecutionObservation(
                observation_id=f"o-{attempt}",
                invocation_id=f"i-{attempt}",
                request_id=context.request_id,
                node_id="http",
                kind="effect_blocked",
                implementation_version="graphon.nodes.http_request.node.HttpRequestNode:1",
                reason_code="test",
            ),
        )
    with factory.begin() as db:
        run = db.get(WorkflowRun, run_id)
        assert run is not None
        run.total_steps = total_steps
        run.exceptions_count = 1
        http = db.scalar(select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.node_id == "http"))
        assert http is not None
        http.status = "exception"
        http.process_data = json.dumps(
            {
                RETRY_HISTORY_PROCESS_DATA_KEY: [
                    {
                        "retry_index": retry_index,
                        "inputs": {},
                        "process_data": {},
                        "outputs": {},
                        "error": "blocked",
                        "elapsed_time": 0.0,
                        "execution_metadata": {},
                        "created_at": 1,
                        "finished_at": 2,
                    }
                ]
            }
        )
    result = service.seal(request_id=context.request_id, completion=completion(context, run_id))
    assert result.safety_outcome == outcome
    assert result.blocked_node_ids == ("http",)


@pytest.mark.parametrize("invalid", ["no_refusal", "claim", "recorder", "finished", "exit"])
def test_seal_revalidates_constructed_preworker_origin(owned, invalid):
    context = prepare_inputs(owned)
    facts: dict[str, object] = {
        "context": context,
        "native_run_id": None,
        "task_id": None,
        "worker_finished": False,
        "worker_exit": "not_observed",
        "recorder_healthy": False,
        "response_completed": True,
        "refusal": domain.BuilderExecutionRefusal(reason_code="unsupported_workflow"),
        "preworker_refusal": True,
    }
    if invalid == "no_refusal":
        facts["refusal"] = None
    elif invalid == "claim":
        facts.update(native_run_id="allocated", task_id="task")
    elif invalid == "recorder":
        facts["recorder_healthy"] = True
    elif invalid == "finished":
        facts.update(worker_finished=True, worker_exit="policy_refused")
    else:
        facts["worker_exit"] = "policy_refused"
    forged = domain.TrustedExecutionCompletion.model_construct(_fields_set=None, **facts)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    with pytest.raises(domain.BuilderExecutionPolicyError, match="invalid_execution_completion"):
        service.seal(request_id=context.request_id, completion=forged)
