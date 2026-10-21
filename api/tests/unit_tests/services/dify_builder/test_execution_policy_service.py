"""Real SQLite owner/state controls. PostgreSQL locking is CI-owned."""

from __future__ import annotations

import hashlib
import importlib
import json
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from types import ModuleType
from typing import Literal, NoReturn, Unpack, cast
from uuid import uuid4

import pytest
from sqlalchemy import Table, create_engine, delete, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from typing_extensions import TypedDict

from core.dify_builder.models import Actor, Graph
from graphon.enums import WorkflowNodeExecutionStatus
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import Base, TypeBase
from models.dify_builder import DifyBuilderSession, DifyBuilderTestInput
from models.model import App, AppMode
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionModel, WorkflowRun, WorkflowType
from runtime_contracts.builder.execution import TrustedExecutionCompletion
from services.dify_builder.application import execution_policy as domain
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.core.dify_builder.test_execution_policy import fixture, graph, policy

type Owned = tuple[sessionmaker[Session], Actor, App, Workflow, str, str]


_PRE_EXTRACTION_GOLDENS = (
    Path(__file__).resolve().parents[3] / "fixtures/workflow/builder_restricted/pre_extraction_context_goldens.json"
)


def _stored_context_values() -> dict[str, object]:
    return {
        "request_id": "request-1",
        "tenant_id": "tenant-1",
        "app_id": "app-1",
        "workflow_id": "workflow-1",
        "actor_id": "actor-1",
        "session_id": "session-1",
        "test_input_id": "input-1",
        "execution_revision": "a" * 64,
        "graph_revision": "b" * 64,
        "submitted_inputs_digest": "c" * 64,
        "effective_inputs_digest": "d" * 64,
        "mode": "restricted",
        "sandbox_profile": "disabled",
        "admitted_nodes": (),
    }


def _json_context() -> domain.JsonToolExecutionContext:
    p = policy()
    values = _stored_context_values()
    nodes = tuple(
        p.AdmittedNodeBinding(
            node_id=node_id,
            implementation=implementation,
            node_version="1",
            normalized_config_digest="e" * 64,
        )
        for node_id, implementation in (
            ("node1", "graphon.nodes.start.start_node.StartNode"),
            ("node2", "graphon.nodes.tool.tool_node.ToolNode"),
            ("node3", "graphon.nodes.end.end_node.EndNode"),
        )
    )
    qualified = p.QualifiedJsonToolBinding(
        node_id="node2",
        tenant_id="tenant-1",
        installation_id="installation-1",
        plugin_id="langgenius/json_process",
        provider_id="langgenius/json_process/json_process",
        tool_name="parse",
        unique_identifier="langgenius/json_process:0.0.8@" + "f" * 64,
        version="0.0.8",
        checksum="1" * 64,
        provider_schema_digest="2" * 64,
        tool_schema_digest="3" * 64,
        runtime_type="local",
        qualification_digest="4" * 64,
        final_parameters_digest="5" * 64,
    )
    initial = p.JsonToolExecutionContext.model_validate(
        {
            **values,
            "policy_version": "builder-json-parse-v1",
            "admitted_nodes": nodes,
            "qualified_tool": qualified,
            "context_digest": "0" * 64,
        }
    )
    return initial.model_copy(update={"context_digest": p.context_digest(initial)})


def test_historical_restricted_context_tag_and_absence_decode_identically() -> None:
    p = policy()
    initial = p.BuilderExecutionContext.model_validate(
        {
            **_stored_context_values(),
            "fixture_digest": "f" * 64,
            "http_fixtures": (),
            "context_digest": "0" * 64,
        }
    )
    stored = initial.model_copy(update={"context_digest": p.context_digest(initial)}).model_dump(mode="json")
    tagged = p.validate_execution_context(stored)
    untagged = p.validate_execution_context({key: value for key, value in stored.items() if key != "policy_version"})
    assert tagged.model_dump(mode="json") == untagged.model_dump(mode="json") == stored
    assert p.context_digest(tagged) == p.context_digest(untagged) == stored["context_digest"]
    forged_contexts: tuple[dict[str, object], ...] = (
        {**stored, "qualified_tool": {}},
        {**stored, "policy_version": "unknown-v9"},
    )
    for forged in forged_contexts:
        with pytest.raises(p.BuilderExecutionPolicyError):
            p.validate_execution_context(forged)


@pytest.mark.parametrize("case_name", ["restricted_tagged", "restricted_untagged", "confirmed_tagged"])
def test_saved_pre_extraction_context_bytes_and_digest_are_unchanged(case_name: str) -> None:
    p = policy()
    golden = json.loads(_PRE_EXTRACTION_GOLDENS.read_text())["cases"][case_name]
    decoded = p.validate_execution_context(golden["raw"])
    normalized = decoded.model_dump(mode="json")
    encoded = p.canonical_json(normalized)
    assert normalized == golden["normalized"]
    assert encoded == golden["canonical_json_utf8"].encode("utf-8")
    assert hashlib.sha256(encoded).hexdigest() == golden["normalized_sha256"]
    assert decoded.context_digest == p.context_digest(decoded) == golden["context_digest"]


@pytest.mark.parametrize("case_name", ["restricted_tagged", "restricted_untagged", "confirmed_tagged"])
def test_saved_pre_extraction_context_refuses_json_fields_and_unknown_tags(case_name: str) -> None:
    p = policy()
    raw = json.loads(_PRE_EXTRACTION_GOLDENS.read_text())["cases"][case_name]["raw"]
    forged_contexts: tuple[dict[str, object], ...] = (
        {**raw, "qualified_tool": {}},
        {**raw, "policy_version": "builder-unknown-v9"},
    )
    for forged in forged_contexts:
        with pytest.raises(p.BuilderExecutionPolicyError, match="invalid_execution_context"):
            p.validate_execution_context(forged)


@pytest.mark.parametrize(
    "field",
    [
        "installation_id",
        "node_id",
        "tenant_id",
        "plugin_id",
        "provider_id",
        "tool_name",
        "unique_identifier",
        "version",
        "checksum",
        "provider_schema_digest",
        "tool_schema_digest",
        "runtime_type",
        "qualification_digest",
        "final_parameters_digest",
    ],
)
def test_json_context_digest_covers_qualified_binding(field: str) -> None:
    p = policy()
    context = _json_context()
    replacement = "a" * 64 if field == "checksum" or field.endswith("_digest") else "alternate"
    mutated_binding = context.qualified_tool.model_copy(update={field: replacement})
    mutated_context = context.model_copy(update={"qualified_tool": mutated_binding})
    assert p.context_digest(mutated_context) != context.context_digest
    raw = mutated_context.model_dump(mode="json")
    if field not in {"node_id", "tenant_id", "tool_name", "runtime_type"}:
        p.JsonToolExecutionContext.model_validate(raw)
        with pytest.raises(p.BuilderExecutionPolicyError, match="context_digest_mismatch"):
            p.validate_execution_context(raw)
    else:
        with pytest.raises(p.BuilderExecutionPolicyError):
            p.validate_execution_context(raw)


def test_json_context_decodes_through_completion_and_requires_explicit_tag() -> None:
    p = policy()
    context = _json_context()
    assert isinstance(p.validate_execution_context(context.model_dump(mode="json")), p.JsonToolExecutionContext)
    completion = p.TrustedExecutionCompletion(
        context=context,
        native_run_id="run",
        task_id="task",
        worker_finished=True,
        worker_exit="returned",
        recorder_healthy=True,
        response_completed=True,
    )
    decoded = p.TrustedExecutionCompletion.model_validate(completion.model_dump(mode="json"))
    assert isinstance(decoded.context, p.JsonToolExecutionContext)
    without_tag = context.model_dump(mode="json")
    del without_tag["policy_version"]
    with pytest.raises(p.BuilderExecutionPolicyError):
        p.validate_execution_context(without_tag)


def service_module() -> ModuleType:
    return importlib.import_module("services.dify_builder.execution_policy_service")


@pytest.fixture
def owned() -> Iterator[Owned]:
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


def prepare_inputs(owned: Owned, **kwargs: object) -> domain.BuilderExecutionContext | domain.JsonToolExecutionContext:
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


def test_owned_preparation_binds_both_inputs_and_does_not_infer_mock_mode(owned: Owned) -> None:
    context = prepare_inputs(owned)
    assert context.mode == "restricted"
    assert context.submitted_inputs_digest != context.effective_inputs_digest
    assert len(context.admitted_nodes) == 2


@pytest.mark.parametrize(
    "owner", ["membership", "account", "workspace", "session_owner", "session_app", "session_tenant", "test_session"]
)
def test_full_owner_chain_required(owned: Owned, owner: str) -> None:
    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        if owner == "membership":
            db.execute(delete(TenantAccountJoin))
        elif owner == "account":
            db.execute(delete(Account))
        elif owner == "workspace":
            db.execute(delete(Tenant))
        elif owner == "test_session":
            stored_dify_builder_test_input = db.get(DifyBuilderTestInput, tid)
            assert stored_dify_builder_test_input is not None
            stored_dify_builder_test_input.session_id = str(uuid4())
        else:
            row = db.get(DifyBuilderSession, sid)
            setattr(
                row,
                {"session_owner": "owner_account_id", "session_app": "app_id", "session_tenant": "tenant_id"}[owner],
                str(uuid4()),
            )
    with pytest.raises(policy().BuilderExecutionPolicyError):
        prepare_inputs(owned)


def test_owner_helpers_are_exported_once_for_shared_callers(owned: Owned, monkeypatch: pytest.MonkeyPatch) -> None:
    from services.enterprise.rbac_service import RBACService

    factory, actor, app, workflow, sid, tid = owned
    module = service_module()
    assert not hasattr(module, "_owners")
    assert not hasattr(module, "_permission")
    with factory() as db:
        owner = module.load_execution_owners(
            db, app_id=app.id, actor=actor, workflow_id=workflow.id, session_id=sid, test_input_id=tid
        )
        assert (owner.app.id, owner.workflow.id) == (app.id, workflow.id)
        assert owner.session is not None
        assert owner.session.id == sid
        assert owner.test_input is not None
        assert owner.test_input.id == tid
        with pytest.raises(policy().BuilderExecutionPolicyError, match="execution_owner_mismatch"):
            module.load_execution_owners(db, app_id=str(uuid4()), actor=actor)
    module.check_execution_permission(actor, app.id, factory)
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(RBACService.CheckAccess, "check", lambda *_args, **_kwargs: False)
    with pytest.raises(policy().BuilderExecutionPolicyError, match="execution_permission_denied"):
        module.check_execution_permission(actor, app.id, factory)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("_environment_variables", '{"secret":{}}'),
        ("_conversation_variables", "null"),
        ("_environment_variables", "[]"),
        ("_features", '{"unknown":{"enabled":true}}'),
    ],
)
def test_metadata_refusal_precedes_revision_access(
    owned: Owned, monkeypatch: pytest.MonkeyPatch, field: str, value: str
) -> None:
    module = service_module()

    def forbidden(*_args: object) -> NoReturn:
        raise AssertionError("revision accessed after metadata refusal")

    monkeypatch.setattr(module, "execution_revision", forbidden)
    setattr(owned[3], field, value)
    with pytest.raises(policy().BuilderExecutionPolicyError):
        prepare_inputs(owned)


def test_launch_exactly_once_and_observation_binding(owned: Owned) -> None:
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


def test_fixture_stamp_lineage_stale_reuse_and_malformed_persistence(owned: Owned) -> None:
    factory, actor, app, workflow, sid, tid = owned
    module = service_module()
    service = module.BuilderExecutionPolicyService(factory)
    workflow.graph = json.dumps(graph(http=True))
    with factory.begin() as db:
        stored_workflow = db.get(Workflow, workflow.id)
        assert stored_workflow is not None
        stored_workflow.graph = workflow.graph
    revision = module.execution_revision(workflow)
    envelope = service.stamp_http_fixtures(app.id, actor, base_app_revision=revision, fixtures=(fixture(),))
    with factory.begin() as db:
        stored_dify_builder_test_input = db.get(DifyBuilderTestInput, tid)
        assert stored_dify_builder_test_input is not None
        stored_dify_builder_test_input.http_fixtures = envelope.model_dump(mode="json")
    assert prepare_inputs(owned).mode == "mock"
    with pytest.raises(policy().BuilderExecutionPolicyError, match="stale_http_fixtures"):
        service.stamp_http_fixtures(app.id, actor, base_app_revision="old", fixtures=(fixture(),))
    with factory.begin() as db:
        stored_dify_builder_test_input = db.get(DifyBuilderTestInput, tid)
        assert stored_dify_builder_test_input is not None
        stored_dify_builder_test_input.http_fixtures = {"schema_version": 1, "fixtures": []}
    with pytest.raises(policy().BuilderExecutionPolicyError, match="invalid_http_fixture_envelope"):
        prepare_inputs(owned)
    with factory.begin() as db:
        stored_dify_builder_test_input = db.get(DifyBuilderTestInput, tid)
        assert stored_dify_builder_test_input is not None
        stored_dify_builder_test_input.http_fixtures = envelope.model_dump(mode="json")
        changed = graph(http=True)
        changed["nodes"][1]["data"]["url"] = "https://changed.invalid"
        workflow.graph = json.dumps(changed)
        stored_workflow = db.get(Workflow, workflow.id)
        assert stored_workflow is not None
        stored_workflow.graph = workflow.graph
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
def test_revalidation_refuses_changed_execution(owned: Owned, change: str, monkeypatch: pytest.MonkeyPatch) -> None:
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
                stored_workflow = db.get(Workflow, workflow.id)
                assert stored_workflow is not None
                stored_workflow.graph = workflow.graph
            elif change == "owner":
                stored_dify_builder_session = db.get(DifyBuilderSession, sid)
                assert stored_dify_builder_session is not None
                stored_dify_builder_session.owner_account_id = str(uuid4())
            else:
                stored_dify_builder_test_input = db.get(DifyBuilderTestInput, tid)
                assert stored_dify_builder_test_input is not None
                stored_dify_builder_test_input.http_fixtures = {}
    if change in {"environment", "conversation", "tracing"}:
        monkeypatch.setattr(module, "execution_revision", lambda *_args: pytest.fail("refusal accessed revision"))
    with pytest.raises(policy().BuilderExecutionPolicyError):
        module.BuilderExecutionPolicyService(factory).revalidate(**kwargs)


def test_sealed_append_and_tampered_full_context_refused(owned: Owned) -> None:
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
        stored_dify_builder_execution_request = db.get(DifyBuilderExecutionRequest, context.request_id)
        assert stored_dify_builder_execution_request is not None
        stored_dify_builder_execution_request.state = "sealed"
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
def test_all_handlers_persist_actual_server_stamp(
    owned: Owned, monkeypatch: pytest.MonkeyPatch, handler_name: str
) -> None:
    from datetime import datetime

    from core.dify_builder.models import Action, DifyBuilderContext, EntryMode, Turn
    from core.dify_builder.models import Session as BuilderSession
    from core.dify_builder.state import PcState
    from services.dify_builder import dify_port
    from services.dify_builder.application import handlers_build, handlers_edit, handlers_fix
    from services.dify_builder.application.runner import Env
    from tests.unit_tests.core.dify_builder.fakes import FakeDifyPort, InMemoryRepository, StubAgent

    factory, actor, app, workflow, sid, tid = owned
    workflow.graph = json.dumps(graph(http=True))
    with factory.begin() as db:
        stored_workflow = db.get(Workflow, workflow.id)
        assert stored_workflow is not None
        stored_workflow.graph = workflow.graph
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
    assert result.context is not None
    saved = repo.get_test_input(result.context.test_input_ref)
    assert saved.http_fixtures is not None
    assert saved.http_fixtures.execution_revision == revision
    assert saved.http_fixtures.fixtures[0].status_code == 201
    assert saved.http_fixtures.fixtures[0].source == "user_sample"


@pytest.mark.parametrize("field", ["app_id", "tenant_id"])
def test_supplied_workflow_identity_cannot_disagree_with_owned_row(owned: Owned, field: str) -> None:
    setattr(owned[3], field, str(uuid4()))
    with pytest.raises(policy().BuilderExecutionPolicyError, match="execution_owner_mismatch"):
        prepare_inputs(owned)


def test_raw_tracing_refusal_in_prepare_and_fixture_stamp_precedes_revision(
    owned: Owned, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        stored_app = db.get(App, app.id)
        assert stored_app is not None
        stored_app.tracing = '{"enabled":true,"tracing_provider":"secret"}'
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
def test_malformed_snapshot_refusal_is_sanitized_before_revision(
    owned: Owned, monkeypatch: pytest.MonkeyPatch, malformed_graph: Graph, boundary: str
) -> None:
    factory, actor, app, workflow, sid, tid = owned
    workflow.graph = json.dumps(malformed_graph)
    with factory.begin() as db:
        stored_workflow = db.get(Workflow, workflow.id)
        assert stored_workflow is not None
        stored_workflow.graph = workflow.graph
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


def test_append_verifies_fixture_node_implementation_profile_and_bound_limit(owned: Owned) -> None:
    from models.dify_builder import DifyBuilderExecutionRequest

    factory, actor, app, workflow, sid, tid = owned
    module = service_module()
    workflow.graph = json.dumps(graph(http=True))
    service = module.BuilderExecutionPolicyService(factory)
    with factory.begin() as db:
        stored_workflow = db.get(Workflow, workflow.id)
        assert stored_workflow is not None
        stored_workflow.graph = workflow.graph
    envelope = service.stamp_http_fixtures(
        app.id, actor, base_app_revision=module.execution_revision(workflow), fixtures=(fixture(),)
    )
    with factory.begin() as db:
        stored_dify_builder_test_input = db.get(DifyBuilderTestInput, tid)
        assert stored_dify_builder_test_input is not None
        stored_dify_builder_test_input.http_fixtures = envelope.model_dump(mode="json")
    context = prepare_inputs(owned)
    assert isinstance(context, domain.BuilderExecutionContext)
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
        stored_dify_builder_execution_request = db.get(DifyBuilderExecutionRequest, context.request_id)
        assert stored_dify_builder_execution_request is not None
        stored_dify_builder_execution_request.observations = [observation.model_dump(mode="json")] * 4096
    with pytest.raises(policy().BuilderExecutionPolicyError, match="observation_limit_exceeded"):
        service.record(
            context=context,
            native_run_id="run",
            task_id="task",
            observation=observation.model_copy(update={"observation_id": "new", "invocation_id": "attempt-2"}),
        )


def test_native_rbac_requires_both_scenes_and_allows_delegated_membership(
    owned: Owned, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.rbac import RBACPermission
    from services.enterprise.rbac_service import RBACService

    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        db.query(TenantAccountJoin).update({"role": TenantAccountRole.NORMAL})
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    calls = []

    def check(
        _tenant_id: str, _account_id: str, *, scene: RBACPermission, resource_type: str, resource_id: str
    ) -> bool:
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


def test_native_rbac_plain_app_maintainer_bypass_is_persisted(owned: Owned, monkeypatch: pytest.MonkeyPatch) -> None:
    from services.enterprise.rbac_service import RBACService

    factory, actor, app, workflow, sid, tid = owned
    with factory.begin() as db:
        stored_app = db.get(App, app.id)
        assert stored_app is not None
        stored_app.maintainer = actor.account_id
        db.query(TenantAccountJoin).update({"role": TenantAccountRole.NORMAL})
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        RBACService.CheckAccess, "check", lambda *_args, **_kwargs: pytest.fail("maintainer bypass called RPC")
    )
    assert prepare_inputs(owned).actor_id == actor.account_id


@pytest.mark.parametrize("status", ["active", "archived"])
def test_native_rbac_agent_app_binding_precedes_maintainer_bypass(
    owned: Owned, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    from models.agent import Agent, AgentScope, AgentSource, AgentStatus
    from services.enterprise.rbac_service import RBACService

    factory, actor, app, workflow, sid, tid = owned
    cast(Table, Agent.__table__).create(factory.kw["bind"], checkfirst=True)
    with factory.begin() as db:
        row = db.get(App, app.id)
        assert row is not None
        row.mode = AppMode.AGENT
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
    apply_config_overrides(monkeypatch, RBAC_ENABLED=True)
    monkeypatch.setattr(
        RBACService.CheckAccess, "check", lambda *_args, **_kwargs: pytest.fail("Agent guard called RPC")
    )
    with pytest.raises(policy().BuilderExecutionPolicyError, match="unsupported_workflow"):
        service_module().BuilderExecutionPolicyService(factory).stamp_http_fixtures(
            app.id, actor, base_app_revision="a" * 64, fixtures=()
        )


class CompletionChanges(TypedDict, total=False, closed=True):
    refusal: domain.BuilderExecutionRefusal | None
    preworker_refusal: bool


def completion(
    context: domain.BuilderExecutionContext | domain.JsonToolExecutionContext,
    run_id: str | None = None,
    **changes: Unpack[CompletionChanges],
) -> TrustedExecutionCompletion:
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


def native_rows(
    owned: Owned, context: domain.BuilderExecutionContext | domain.JsonToolExecutionContext, status: str = "succeeded"
) -> str:
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


def test_seal_requires_authoritative_native_rows_and_is_idempotent(owned: Owned) -> None:
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
def test_native_predecessor_corroborates_chain_when_present(
    owned: Owned, start_predecessor: None | str, end_predecessor: None | str, outcome: str
) -> None:
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


def test_optional_predecessor_change_cannot_rewrite_sealed_evidence(owned: Owned) -> None:
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
def test_incomplete_proof_seals_unknown(owned: Owned, missing: str) -> None:
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
def test_complete_non_success_native_status_remains_native_failed(owned: Owned, status: str) -> None:
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
def test_http_receipts_and_unknown_first_precedence(
    owned: Owned,
    kind: Literal["effect_blocked", "fixture_served"] | None,
    status: str,
    missing: bool | str,
    outcome: str,
) -> None:
    from sqlalchemy import select

    from models.dify_builder import DifyBuilderTestInput
    from models.workflow import Workflow
    from services.dify_builder.revision import execution_revision
    from tests.unit_tests.core.dify_builder.test_execution_policy import fixture, graph

    factory, actor, app, workflow, sid, tid = owned
    workflow.graph = json.dumps(graph(http=True))
    with factory.begin() as db:
        stored_workflow = db.get(Workflow, workflow.id)
        assert stored_workflow is not None
        stored_workflow.graph = workflow.graph
        if kind == "fixture_served":
            stored_dify_builder_test_input = db.get(DifyBuilderTestInput, tid)
            assert stored_dify_builder_test_input is not None
            stored_dify_builder_test_input.http_fixtures = domain.HttpFixtureSetV1(
                execution_revision=execution_revision(workflow), fixtures=(fixture(),)
            ).model_dump(mode="json")
    context = prepare_inputs(owned)
    assert isinstance(context, domain.BuilderExecutionContext)
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
        stored_workflow_run = db.get(WorkflowRun, run_id)
        assert stored_workflow_run is not None
        stored_workflow_run.total_steps = 3
        nodes = list(db.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)))
        if missing == "malformed_receipt":
            from models.dify_builder import DifyBuilderExecutionRequest

            row = db.get(DifyBuilderExecutionRequest, context.request_id)
            assert row is not None
            row.observations = [*row.observations, {"broken": True}]
        elif missing:
            db.delete(nodes[0])
    result = service.seal(request_id=context.request_id, completion=completion(context, run_id))
    assert result.safety_outcome == outcome
    assert result.blocked_node_ids == (("http",) if kind == "effect_blocked" else ())
    with factory() as db:
        stored_workflow_run = db.get(WorkflowRun, run_id)
        assert stored_workflow_run is not None
        assert stored_workflow_run.status == status


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
def test_canonical_native_owner_and_proof_mutations(owned: Owned, mutation: str) -> None:
    from sqlalchemy import select

    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context)
    with owned[0].begin() as db:
        run = db.get(WorkflowRun, run_id)
        assert run is not None
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
def test_null_predecessor_prefix_requires_failed_or_stopped_run(owned: Owned, status: str, outcome: str) -> None:
    context = prepare_inputs(owned)
    service = service_module().BuilderExecutionPolicyService(owned[0])
    run_id = native_rows(owned, context, status)
    with owned[0].begin() as db:
        run = db.get(WorkflowRun, run_id)
        assert run is not None
        run.total_steps = 1
        nodes = list(db.scalars(select(WorkflowNodeExecutionModel).order_by(WorkflowNodeExecutionModel.index)))
        nodes[0].status = WorkflowNodeExecutionStatus.FAILED
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
    owned: Owned, receipt_count: int, retry_index: int, total_steps: int, outcome: str
) -> None:
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
        http.status = WorkflowNodeExecutionStatus.EXCEPTION
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
def test_seal_revalidates_constructed_preworker_origin(owned: Owned, invalid: str) -> None:
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
