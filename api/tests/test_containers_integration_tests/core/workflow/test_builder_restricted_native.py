"""CI-only composed native execution: port through real worker, Graphon and SQL.

No generator/runner/factory/persistence replacement in the positive controls.
The package SSRF convenience stub is deliberately replaced with failing spies.
"""

import json
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
import yaml
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from core.dify_builder.execution_policy import HttpResponseFixtureV1
from core.dify_builder.models import Actor
from core.dify_builder.verification import is_execution_policy_blocker
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.model import App
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder.dify_port import WorkflowServiceDifyPort
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from services.dify_builder.revision import execution_revision

FIXTURES = Path(__file__).parents[3] / "fixtures/workflow/builder_restricted"


@pytest.fixture
def native_owner(flask_req_ctx_with_containers, db_session_with_containers):
    assert flask_req_ctx_with_containers is None  # Request context fixture is active.
    session = db_session_with_containers
    engine = db.engine
    assert session.get_bind() is engine
    assert engine.dialect.name == "postgresql"
    tenant = Tenant(name="Restricted native CI")
    account = Account(name="Native owner", email=f"{uuid4()}@example.invalid")
    session.add_all([tenant, account])
    session.flush()
    session.add(
        TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=TenantAccountRole.OWNER, current=True)
    )
    app = App(
        tenant_id=tenant.id,
        name="Restricted native CI",
        mode="workflow",
        enable_site=False,
        enable_api=False,
        created_by=account.id,
        updated_by=account.id,
    )
    session.add(app)
    session.flush()
    workflow = Workflow(
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        kind="standard",
        version="draft",
        graph=json.dumps(yaml.safe_load((FIXTURES / "scalar.yml").read_text())),
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=account.id,
    )
    builder_session = DifyBuilderSession(
        app_id=app.id,
        tenant_id=tenant.id,
        owner_account_id=account.id,
        entry_mode="build",
        current_state="build.await_testdata",
    )
    published = Workflow(
        tenant_id=tenant.id,
        app_id=app.id,
        type="workflow",
        kind="standard",
        version="2026-10-09 00:00:00",
        graph=workflow.graph,
        _features="{}",
        _environment_variables="{}",
        _conversation_variables="{}",
        created_by=account.id,
    )
    session.add(published)
    session.flush()
    app.workflow_id = published.id
    published_id, published_graph = published.id, published.graph
    session.add_all([workflow, builder_session])
    session.flush()
    test_input = DifyBuilderTestInput(
        session_id=builder_session.id, source="user", inputs={"text": "native scalar"}, start_schema_hash=""
    )
    session.add(test_input)
    session.commit()
    yield (
        sessionmaker(bind=engine, expire_on_commit=False),
        Actor(account_id=account.id, tenant_id=tenant.id),
        app,
        workflow,
        builder_session.id,
        test_input.id,
    )

    session.expire_all()
    assert session.get(App, app.id).workflow_id == published_id
    assert session.get(Workflow, published_id).graph == published_graph


@pytest.fixture
def no_live(monkeypatch):
    from core.helper import ssrf_proxy
    from core.helper.code_executor.code_executor import CodeExecutor
    from core.model_manager import ModelManager
    from core.plugin.impl.oauth import OAuthHandler
    from core.tools.tool_manager import ToolManager
    from factories import file_factory

    spies = []
    for owner, name in [
        *((ssrf_proxy, n) for n in ("get", "post", "put", "patch", "delete", "head")),
        (CodeExecutor, "execute_code"),
        (ModelManager, "get_model_instance"),
        (OAuthHandler, "refresh_credentials"),
        (ToolManager, "get_workflow_tool_runtime"),
        (file_factory, "build_from_mapping"),
    ]:
        spy = Mock(side_effect=AssertionError(f"live capability reached: {name}"))
        monkeypatch.setattr(owner, name, spy)
        spies.append(spy)
    yield
    for spy in spies:
        spy.assert_not_called()


def configure(owner, name, *, fixture=False):
    factory, actor, app, workflow, sid, tid = owner
    graph = yaml.safe_load((FIXTURES / name).read_text())
    inputs = {"text": "native scalar"} if name == "scalar.yml" else {"path": "sample"}
    workflow.graph = json.dumps(graph)
    with factory.begin() as session:
        session.get(Workflow, workflow.id).graph = workflow.graph
        session.get(DifyBuilderTestInput, tid).inputs = inputs
    if fixture:
        # Stamping rereads the draft in its own session, so commit the graph first.
        with factory() as session:
            committed_revision = execution_revision(session.get(Workflow, workflow.id))
        envelope = BuilderExecutionPolicyService(factory).stamp_http_fixtures(
            app.id,
            actor,
            base_app_revision=committed_revision,
            fixtures=(
                HttpResponseFixtureV1(
                    node_id="http",
                    source="user_sample",
                    status_code=200,
                    content_type="text/plain",
                    body="native fixture ✓",
                ),
            ),
        )
        with factory.begin() as session:
            session.get(DifyBuilderTestInput, tid).http_fixtures = envelope.model_dump(mode="json")
    return inputs


def run_port(owner, inputs):
    _, actor, app, _, sid, tid = owner
    return WorkflowServiceDifyPort().run_draft(app.id, actor, inputs, lambda _: None, session_id=sid, test_input_id=tid)


@pytest.mark.usefixtures("no_live")
@pytest.mark.parametrize(
    ("name", "fixture", "status", "outcome"),
    [
        ("scalar.yml", False, "succeeded", "restricted_execution_completed"),
        ("http_text.yml", True, "succeeded", "simulation_completed"),
        ("http_default_output.yml", False, "partial-succeeded", "native_failed"),
    ],
)
def test_actual_native_port_to_persistence(native_owner, name, fixture, status, outcome):
    assert dify_config.CORE_WORKFLOW_EXECUTION_REPOSITORY.endswith("SQLAlchemyWorkflowExecutionRepository")
    assert dify_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY.endswith("SQLAlchemyWorkflowNodeExecutionRepository")
    inputs = configure(native_owner, name, fixture=fixture)
    result = run_port(native_owner, inputs)
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    summary = result.verification.execution_evidence
    assert summary.sealed
    assert summary.safety_outcome == outcome
    factory, actor, app, workflow, sid, tid = native_owner
    with factory() as session:
        native = session.get(WorkflowRun, result.dify_run_id)
        sidecar = session.get(DifyBuilderExecutionRequest, summary.request_id)
        nodes = list(
            session.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.workflow_run_id == native.id)
            )
        )
        assert (native.tenant_id, native.app_id, native.workflow_id, native.created_by) == (
            actor.tenant_id,
            app.id,
            workflow.id,
            actor.account_id,
        )
        assert native.status == status
        assert {n.node_id for n in nodes} == ({"start", "end"} if name == "scalar.yml" else {"start", "http", "end"})
        assert sidecar.state == "sealed"
        assert sidecar.native_run_id == native.id
        assert (sidecar.session_id, sidecar.test_input_id) == (sid, tid)
        assert sidecar.completion_fingerprint
        assert native.outputs_dict == ({"out": "native scalar"} if name == "scalar.yml" else native.outputs_dict)
        if fixture:
            assert native.outputs_dict["text"] == "native fixture ✓"
            assert [o["kind"] for o in sidecar.observations] == ["fixture_served"]
        if status == "partial-succeeded":
            assert native.outputs_dict == {"status": 599, "text": "denied default"}
            assert native.exceptions_count == 1
            assert next(n for n in nodes if n.node_id == "end").status == "succeeded"
            assert summary.blocked_node_ids == ("http",)
            assert is_execution_policy_blocker(result)
            assert sidecar.observations[0]["kind"] == "effect_blocked"


@pytest.mark.usefixtures("no_live")
@pytest.mark.parametrize("missing", ["run", "http", "receipt", "recorder"])
def test_real_native_result_missing_proof_is_unknown(native_owner, monkeypatch, missing):
    from sqlalchemy import delete

    inputs = configure(native_owner, "http_text.yml", fixture=True)
    original = BuilderExecutionPolicyService.seal

    def before_seal(service, *, request_id, completion):
        # Fault injection after actual worker completion, never a fabricated event stream.
        assert completion.worker_finished
        with native_owner[0].begin() as session:
            if missing == "run":
                session.execute(delete(WorkflowRun).where(WorkflowRun.id == completion.native_run_id))
            elif missing == "http":
                session.execute(
                    delete(WorkflowNodeExecutionModel).where(
                        WorkflowNodeExecutionModel.workflow_run_id == completion.native_run_id,
                        WorkflowNodeExecutionModel.node_id == "http",
                    )
                )
            elif missing == "receipt":
                session.get(DifyBuilderExecutionRequest, request_id).observations = []
        if missing == "recorder":
            completion = completion.model_copy(update={"recorder_healthy": False})
        return original(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", before_seal)
    result = run_port(native_owner, inputs)
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"


@pytest.mark.usefixtures("no_live")
@pytest.mark.parametrize("change", ["authenticated", "file", "code", "template", "stale_fixture", "fixture_reuse"])
def test_composed_prelaunch_refusals_have_no_native_id(native_owner, change):
    inputs = configure(native_owner, "http_text.yml", fixture=True)
    factory, actor, app, workflow, sid, tid = native_owner
    with factory.begin() as session:
        draft = session.get(Workflow, workflow.id)
        graph = draft.graph_dict
        if change == "authenticated":
            graph["nodes"][1]["data"]["authorization"] = {"type": "api-key", "config": {"api_key": "never-live"}}
        elif change == "file":
            graph["nodes"][0]["data"]["variables"].append({"variable": "upload", "type": "file", "label": "File"})
        elif change in {"code", "template"}:
            graph["nodes"][1]["data"]["type"] = "code" if change == "code" else "template-transform"
        elif change == "stale_fixture":
            graph["nodes"][1]["data"]["url"] = "https://changed.invalid"
        else:
            envelope = dict(session.get(DifyBuilderTestInput, tid).http_fixtures)
            envelope["execution_revision"] = "a" * 64
            session.get(DifyBuilderTestInput, tid).http_fixtures = envelope
        draft.graph = json.dumps(graph)
    result = run_port(native_owner, inputs)
    assert result.execution_refusal is not None
    assert result.dify_run_id == ""
    with factory() as session:
        assert session.scalars(select(WorkflowRun).where(WorkflowRun.app_id == app.id)).first() is None


@pytest.mark.usefixtures("no_live")
def test_composed_worker_reload_trace_race_refuses(native_owner, monkeypatch):
    from services.dify_builder.dify_port import _BuilderExecutionLaunch

    original = _BuilderExecutionLaunch.__call__

    def changed_before_admission(launch, *args, **kwargs):
        with native_owner[0].begin() as session:
            session.get(App, native_owner[2].id).tracing = '{"enabled":true}'
        return original(launch, *args, **kwargs)

    monkeypatch.setattr(_BuilderExecutionLaunch, "__call__", changed_before_admission)
    result = run_port(native_owner, configure(native_owner, "scalar.yml"))
    assert result.dify_run_id == ""
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "unsupported_safe_execution"


@pytest.mark.usefixtures("no_live")
def test_composed_effective_default_binding(native_owner):
    factory, actor, app, workflow, sid, tid = native_owner
    with factory.begin() as session:
        draft = session.get(Workflow, workflow.id)
        graph = draft.graph_dict
        graph["nodes"][0]["data"]["variables"][0].update(default="default text", required=False)
        draft.graph = json.dumps(graph)
        session.get(DifyBuilderTestInput, tid).inputs = {}
    result = run_port(native_owner, {})
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "restricted_execution_completed"
    with factory() as session:
        native = session.get(WorkflowRun, result.dify_run_id)
        assert native.inputs_dict["text"] == "default text"
        assert native.outputs_dict == {"out": "default text"}


@pytest.mark.usefixtures("no_live")
def test_async_native_repositories_without_delivered_saves_stay_unknown(native_owner, monkeypatch):
    from core.repositories import celery_workflow_execution_repository as runs
    from core.repositories import celery_workflow_node_execution_repository as nodes

    pending_runs, pending_nodes = [], []
    # Exercise the actual configurable async repositories; hold only broker delivery.
    monkeypatch.setattr(runs.save_workflow_execution_task, "delay", lambda **kw: pending_runs.append(kw))
    monkeypatch.setattr(nodes.save_workflow_node_execution_task, "delay", lambda **kw: pending_nodes.append(kw))
    monkeypatch.setattr(
        dify_config,
        "CORE_WORKFLOW_EXECUTION_REPOSITORY",
        "core.repositories.celery_workflow_execution_repository.CeleryWorkflowExecutionRepository",
    )
    monkeypatch.setattr(
        dify_config,
        "CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY",
        "core.repositories.celery_workflow_node_execution_repository.CeleryWorkflowNodeExecutionRepository",
    )
    result = run_port(native_owner, configure(native_owner, "scalar.yml"))
    assert pending_runs
    assert pending_nodes
    assert result.dify_run_id == ""
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"


@pytest.mark.usefixtures("no_live")
def test_ordinary_native_scalar_execution_remains_ordinary(native_owner):
    from core.app.entities.app_invoke_entities import InvokeFrom
    from services.app_generate_service import AppGenerateService
    from services.dify_builder.run_mapping import run_id_from_stream_chunk, stream_chunk_as_mapping

    factory, actor, app, workflow, sid, tid = native_owner
    with factory() as session:
        account = session.get(Account, actor.account_id)
        native_app = session.get(App, app.id)
        response = AppGenerateService.generate(
            native_app,
            account,
            {"inputs": {"text": "ordinary"}},
            InvokeFrom.DEBUGGER,
            session=session,
            streaming=True,
            workflow_execution_mode="in_process",
        )
    native_id = ""
    try:
        for chunk in response:
            payload = stream_chunk_as_mapping(chunk)
            if payload:
                native_id = native_id or run_id_from_stream_chunk(payload)
    finally:
        response.close()
    with factory() as session:
        native = session.get(WorkflowRun, native_id)
        assert native.status == "succeeded"
        assert native.outputs_dict == {"out": "ordinary"}
        assert session.scalars(select(DifyBuilderExecutionRequest)).first() is None


@pytest.mark.usefixtures("no_live")
def test_composed_class_replacement_refuses_before_native_validation(native_owner, monkeypatch):
    from core.workflow import node_factory

    class Replacement:
        @staticmethod
        def validate_node_data(_):
            pytest.fail("unreviewed native class reached validation")

    monkeypatch.setattr(node_factory, "resolve_workflow_node_class", lambda **_kw: Replacement)
    result = run_port(native_owner, {"text": "test"})
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "unsupported_node_implementation"
    assert result.dify_run_id == ""


@pytest.mark.usefixtures("no_live")
@pytest.mark.parametrize("poison", [False, True])
def test_composed_http_retry_receipts_and_recorder_poison(native_owner, monkeypatch, poison):
    inputs = configure(native_owner, "http_text.yml", fixture=True)
    factory, actor, app, workflow, sid, tid = native_owner
    with factory.begin() as session:
        draft = session.get(Workflow, workflow.id)
        graph = draft.graph_dict
        graph["nodes"][1]["data"]["retry_config"] = {"retry_enabled": True, "max_retries": 2, "retry_interval": 0}
        draft.graph = json.dumps(graph)
        workflow.graph = draft.graph
    service = BuilderExecutionPolicyService(factory)
    envelope = service.stamp_http_fixtures(
        app.id,
        actor,
        base_app_revision=execution_revision(workflow),
        fixtures=(
            HttpResponseFixtureV1(
                node_id="http", source="user_sample", status_code=500, content_type="text/plain", body="retry"
            ),
        ),
    )
    with factory.begin() as session:
        session.get(DifyBuilderTestInput, tid).http_fixtures = envelope.model_dump(mode="json")
    original = BuilderExecutionPolicyService.record
    recorded = []

    def record(service, **kwargs):
        if poison and recorded:
            raise OSError("CI injected recorder failure after successful durable receipt")
        original(service, **kwargs)
        recorded.append(kwargs["observation"].invocation_id)

    monkeypatch.setattr(BuilderExecutionPolicyService, "record", record)
    result = run_port(native_owner, inputs)
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    summary = result.verification.execution_evidence
    assert summary.safety_outcome == ("execution_evidence_unknown" if poison else "native_failed")
    assert summary.simulated_node_ids == ("http",)
    assert len(recorded) == (1 if poison else 3)
    assert len(set(recorded)) == len(recorded)


@pytest.mark.usefixtures("no_live")
def test_composed_canonical_seal_replay_cannot_upgrade_or_change(native_owner, monkeypatch):
    from core.dify_builder.execution_policy import BuilderExecutionPolicyError

    original = BuilderExecutionPolicyService.seal
    captured = []

    def seal(service, *, request_id, completion):
        captured.append(completion)
        return original(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", seal)
    result = run_port(native_owner, configure(native_owner, "scalar.yml"))
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    summary = result.verification.execution_evidence
    assert summary.safety_outcome == "restricted_execution_completed"
    assert len(captured) == 1
    assert captured[0].worker_finished
    service = BuilderExecutionPolicyService(native_owner[0])
    assert original(service, request_id=summary.request_id, completion=captured[0]) == summary
    with pytest.raises(BuilderExecutionPolicyError, match="conflicting_execution_completion"):
        original(
            service,
            request_id=summary.request_id,
            completion=captured[0].model_copy(update={"response_completed": False}),
        )
    with native_owner[0].begin() as session:
        session.get(WorkflowRun, result.dify_run_id).outputs = '{"out":"changed after seal"}'
    with pytest.raises(BuilderExecutionPolicyError, match="conflicting_execution_completion"):
        original(service, request_id=summary.request_id, completion=captured[0])
