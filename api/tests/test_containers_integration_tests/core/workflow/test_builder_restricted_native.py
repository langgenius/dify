"""CI-only composed native execution: port through real worker, Graphon and SQL.

No generator/runner/factory/persistence replacement in the positive controls.
The package SSRF convenience stub is deliberately replaced with failing spies.
"""

import json
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import NoReturn
from unittest.mock import Mock
from uuid import uuid4

import pytest
import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.entities.app_invoke_entities import WorkflowAppGenerateEntity
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from core.dify_builder.models import Actor, Graph, Inputs, Run
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderSession, DifyBuilderTestInput
from models.model import App
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import BuilderExecutionRecorder
from services.dify_builder.application.execution_policy import (
    BuilderExecutionContext,
    BuilderExecutionContextValue,
    BuilderExecutionObservation,
    ExecutionEvidenceSummary,
    HttpResponseFixtureV1,
    TrustedExecutionCompletion,
    scalar_inputs_digest,
)
from services.dify_builder.application.verification import is_execution_policy_blocker, publication_decision
from services.dify_builder.dify_port import WorkflowServiceDifyPort, _BuilderExecutionLaunch
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from services.dify_builder.revision import executable_graph_revision, execution_revision

FIXTURES = Path(__file__).parents[3] / "fixtures/workflow/builder_restricted"


type NativeOwner = tuple[sessionmaker[Session], Actor, App, Workflow, str, str]


@pytest.fixture
def native_owner(flask_req_ctx_with_containers: None, db_session_with_containers: Session) -> Iterator[NativeOwner]:
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
    _loaded_app1 = session.get(App, app.id)
    assert _loaded_app1 is not None
    assert _loaded_app1.workflow_id == published_id
    _loaded_workflow2 = session.get(Workflow, published_id)
    assert _loaded_workflow2 is not None
    assert _loaded_workflow2.graph == published_graph


@pytest.fixture
def no_live(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
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


@pytest.fixture
def no_jinja_compilation(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Guard restricted Template execution without replacing Jinja lex/parse."""
    from jinja2 import Environment, Template, debug

    spies = []
    for owner, names in (
        (Environment, ("from_string", "compile", "compile_expression", "compile_templates", "_generate", "_compile")),
        (Template, ("render", "generate", "render_async", "generate_async")),
        (debug, ("rewrite_traceback_stack", "fake_traceback")),
    ):
        for name in names:
            spy = Mock(side_effect=AssertionError(f"Jinja compilation/rendering reached: {name}"))
            monkeypatch.setattr(owner, name, spy)
            spies.append(spy)
    yield
    # A swallowed compiler/renderer error cannot satisfy the overflow control.
    for spy in spies:
        spy.assert_not_called()


def configure(owner: NativeOwner, name: str, *, fixture: bool = False) -> dict[str, str]:
    factory, actor, app, workflow, sid, tid = owner
    graph = yaml.safe_load((FIXTURES / name).read_text())
    inputs = {"text": "native scalar"} if name == "scalar.yml" else {"path": "sample"}
    graph_json = json.dumps(graph)
    with factory.begin() as session:
        _loaded_workflow3 = session.get(Workflow, workflow.id)
        assert _loaded_workflow3 is not None
        _loaded_workflow3.graph = graph_json
        _loaded_dify_builder_test_input4 = session.get(DifyBuilderTestInput, tid)
        assert _loaded_dify_builder_test_input4 is not None
        _loaded_dify_builder_test_input4.inputs = inputs
    if fixture:
        # Stamping rereads the draft in its own session, so commit the graph first.
        with factory() as session:
            _loaded_workflow13 = session.get(Workflow, workflow.id)
            assert _loaded_workflow13 is not None
            committed_revision = execution_revision(_loaded_workflow13)
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
            _loaded_dify_builder_test_input14 = session.get(DifyBuilderTestInput, tid)
            assert _loaded_dify_builder_test_input14 is not None
            _loaded_dify_builder_test_input14.http_fixtures = envelope.model_dump(mode="json")
    return inputs


def run_port(owner: NativeOwner, inputs: Inputs) -> Run:
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
def test_actual_native_port_to_persistence(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, name: str, fixture: bool, status: str, outcome: str
) -> None:
    completions: list[TrustedExecutionCompletion] = []
    real_seal = BuilderExecutionPolicyService.seal

    def observe_seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
        completions.append(completion)
        return real_seal(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", observe_seal)
    assert dify_config.CORE_WORKFLOW_EXECUTION_REPOSITORY.endswith("SQLAlchemyWorkflowExecutionRepository")
    assert dify_config.CORE_WORKFLOW_NODE_EXECUTION_REPOSITORY.endswith("SQLAlchemyWorkflowNodeExecutionRepository")
    inputs = configure(native_owner, name, fixture=fixture)
    result = run_port(native_owner, inputs)
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    summary = result.verification.execution_evidence
    assert summary.sealed
    diagnostic: dict[str, object] = {}
    if summary.safety_outcome != outcome:
        # Observe only; never reseal, wait, write, or expose graph/input/output payloads.
        diagnostic["completion_count"] = len(completions)
        diagnostic["completions"] = [
            {
                "native_run_id": c.native_run_id,
                "task_id": c.task_id,
                "worker_finished": c.worker_finished,
                "worker_exit": c.worker_exit,
                "recorder_healthy": c.recorder_healthy,
                "response_completed": c.response_completed,
                "preworker_refusal": c.preworker_refusal,
                "refusal_reason": c.refusal.reason_code if c.refusal else None,
            }
            for c in completions[:2]
        ]
        diagnostic["summary_native_run_id"] = summary.native_run_id
        try:
            factory, _, _, _, _, _ = native_owner
            with factory() as session:
                request = session.get(DifyBuilderExecutionRequest, summary.request_id)
                assert request is not None
                diagnostic["request"] = {
                    "state": request.state,
                    "native_run_id": request.native_run_id,
                    "task_id": request.task_id,
                    "observation_count": len(request.observations),
                }
                _loaded_workflow_run20 = session.get(WorkflowRun, request.native_run_id)
                assert _loaded_workflow_run20 is not None
                native = _loaded_workflow_run20 if request.native_run_id else None
                diagnostic["native_present"] = native is not None
                if native is not None and completions:
                    context = completions[-1].context
                    assert isinstance(context, BuilderExecutionContext)
                    nodes = list(
                        session.scalars(
                            select(WorkflowNodeExecutionModel)
                            .where(WorkflowNodeExecutionModel.workflow_run_id == native.id)
                            .order_by(WorkflowNodeExecutionModel.index)
                        )
                    )
                    diagnostic["native"] = {
                        "status": native.status,
                        "finished": native.finished_at is not None,
                        "total_steps": native.total_steps,
                        "exceptions_count": native.exceptions_count,
                        "owner_matches": (native.tenant_id, native.app_id, native.workflow_id, native.created_by)
                        == (context.tenant_id, context.app_id, context.workflow_id, context.actor_id),
                        "graph_matches": executable_graph_revision(dict(native.graph_dict)) == context.graph_revision,
                        "effective_inputs_match": scalar_inputs_digest(
                            {k: v for k, v in native.inputs_dict.items() if not k.startswith("sys.")}
                        )
                        == context.effective_inputs_digest,
                    }
                    diagnostic["node_count"] = len(nodes)
                    diagnostic["nodes"] = [
                        {
                            "node_id": n.node_id,
                            "node_execution_id": n.node_execution_id,
                            "type": n.node_type,
                            "status": n.status,
                            "index": n.index,
                            "predecessor": n.predecessor_node_id,
                            "finished": n.finished_at is not None,
                            "owner_matches": (n.tenant_id, n.app_id, n.workflow_id, n.created_by)
                            == (context.tenant_id, context.app_id, context.workflow_id, context.actor_id),
                            "retry_count": len((n.process_data_dict or {}).get(RETRY_HISTORY_PROCESS_DATA_KEY, [])),
                        }
                        for n in nodes[:16]
                    ]
                    diagnostic["post_seal_native_proof"] = BuilderExecutionPolicyService._native_proof(
                        context,
                        native,
                        nodes,
                        [BuilderExecutionObservation.model_validate(o) for o in request.observations],
                    )
        except Exception as error:
            # Diagnostic failures cannot replace the original outcome assertion.
            diagnostic["diagnostic_error_type"] = type(error).__name__
    assert summary.safety_outcome == outcome, json.dumps(diagnostic, sort_keys=True, indent=2)
    factory, actor, app, workflow, sid, tid = native_owner
    with factory() as session:
        native = session.get(WorkflowRun, result.dify_run_id)
        assert native is not None
        sidecar = session.get(DifyBuilderExecutionRequest, summary.request_id)
        assert sidecar is not None
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
def test_real_native_result_missing_proof_is_unknown(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, missing: str
) -> None:
    from sqlalchemy import delete

    inputs = configure(native_owner, "http_text.yml", fixture=True)
    original = BuilderExecutionPolicyService.seal

    def before_seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
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
                _loaded_dify_builder_execution_request22 = session.get(DifyBuilderExecutionRequest, request_id)
                assert _loaded_dify_builder_execution_request22 is not None
                _loaded_dify_builder_execution_request22.observations = []
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
def test_composed_prelaunch_refusals_have_no_native_id(native_owner: NativeOwner, change: str) -> None:
    inputs = configure(native_owner, "http_text.yml", fixture=True)
    factory, actor, app, workflow, sid, tid = native_owner
    with factory.begin() as session:
        draft = session.get(Workflow, workflow.id)
        assert draft is not None
        graph = draft.graph_dict
        if change == "authenticated":
            graph["nodes"][1]["data"]["authorization"] = {"type": "api-key", "config": {"api_key": "never-live"}}
        elif change == "file":
            graph["nodes"][0]["data"]["variables"].append({"variable": "upload", "type": "file", "label": "File"})
        elif change in {"code", "template"}:
            if change == "code":
                graph["nodes"][1]["data"]["type"] = "code"
            else:
                # Preserve the original negative identity using a genuinely
                # unsafe Template, rather than refusing every native Template.
                graph["nodes"][1]["data"] = {
                    "type": "template-transform",
                    "template": "{{ path.__class__ }}",
                    "variables": [{"variable": "path", "value_selector": ["start", "path"]}],
                }
        elif change == "stale_fixture":
            graph["nodes"][1]["data"]["url"] = "https://changed.invalid"
        else:
            _loaded_dify_builder_test_input24 = session.get(DifyBuilderTestInput, tid)
            assert _loaded_dify_builder_test_input24 is not None
            assert _loaded_dify_builder_test_input24.http_fixtures is not None
            envelope = dict(_loaded_dify_builder_test_input24.http_fixtures)
            envelope["execution_revision"] = "a" * 64
            _loaded_dify_builder_test_input23 = session.get(DifyBuilderTestInput, tid)
            assert _loaded_dify_builder_test_input23 is not None
            _loaded_dify_builder_test_input23.http_fixtures = envelope
        draft.graph = json.dumps(graph)
    result = run_port(native_owner, inputs)
    assert result.execution_refusal is not None
    assert result.dify_run_id == ""
    with factory() as session:
        assert session.scalars(select(WorkflowRun).where(WorkflowRun.app_id == app.id)).first() is None


@pytest.mark.usefixtures("no_live")
def test_composed_worker_reload_trace_race_refuses(native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch) -> None:

    original = _BuilderExecutionLaunch.__call__

    def changed_before_admission(
        launch: _BuilderExecutionLaunch,
        workflow: Workflow,
        app: App,
        entity: WorkflowAppGenerateEntity,
        root_node_id: str,
        resume: bool,
    ) -> BuilderExecutionRecorder:
        with native_owner[0].begin() as session:
            _loaded_app15 = session.get(App, native_owner[2].id)
            assert _loaded_app15 is not None
            _loaded_app15.tracing = '{"enabled":true}'
        return original(launch, workflow, app, entity, root_node_id, resume)

    monkeypatch.setattr(_BuilderExecutionLaunch, "__call__", changed_before_admission)
    result = run_port(native_owner, configure(native_owner, "scalar.yml"))
    assert result.dify_run_id == ""
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "unsupported_safe_execution"


@pytest.mark.usefixtures("no_live")
def test_composed_effective_default_binding(native_owner: NativeOwner) -> None:
    factory, actor, app, workflow, sid, tid = native_owner
    with factory.begin() as session:
        draft = session.get(Workflow, workflow.id)
        assert draft is not None
        graph = draft.graph_dict
        graph["nodes"][0]["data"]["variables"][0].update(default="default text", required=False)
        draft.graph = json.dumps(graph)
        _loaded_dify_builder_test_input5 = session.get(DifyBuilderTestInput, tid)
        assert _loaded_dify_builder_test_input5 is not None
        _loaded_dify_builder_test_input5.inputs = {}
    result = run_port(native_owner, {})
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "restricted_execution_completed"
    with factory() as session:
        native = session.get(WorkflowRun, result.dify_run_id)
        assert native is not None
        assert native.inputs_dict["text"] == "default text"
        assert native.outputs_dict == {"out": "default text"}


@pytest.mark.usefixtures("no_live")
def test_async_native_repositories_without_delivered_saves_stay_unknown(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.repositories import celery_workflow_execution_repository as runs
    from core.repositories import celery_workflow_node_execution_repository as nodes

    pending_runs: list[dict[str, object]] = []
    pending_nodes: list[dict[str, object]] = []
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
def test_ordinary_native_scalar_execution_remains_ordinary(native_owner: NativeOwner) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from services.app_generate_service import AppGenerateService
    from services.dify_builder.run_mapping import run_id_from_stream_chunk, stream_chunk_as_mapping

    factory, actor, app, workflow, sid, tid = native_owner
    with factory() as session:
        account = session.get(Account, actor.account_id)
        assert account is not None
        native_app = session.get(App, app.id)
        assert native_app is not None
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
        assert native is not None
        assert str(native.status) == "succeeded"
        assert native.outputs_dict == {"out": "ordinary"}
        assert session.scalars(select(DifyBuilderExecutionRequest)).first() is None


@pytest.mark.usefixtures("no_live")
def test_composed_class_replacement_refuses_before_native_validation(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.workflow_runtime import node_factory

    class Replacement:
        @staticmethod
        def validate_node_data(_: object) -> NoReturn:
            pytest.fail("unreviewed native class reached validation")

    monkeypatch.setattr(node_factory, "resolve_workflow_node_class", lambda **_kw: Replacement)
    result = run_port(native_owner, {"text": "test"})
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "unsupported_node_implementation"
    assert result.dify_run_id == ""


@pytest.mark.usefixtures("no_live")
@pytest.mark.parametrize("poison", [False, True])
def test_composed_http_retry_receipts_and_recorder_poison(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, poison: bool
) -> None:
    inputs = configure(native_owner, "http_text.yml", fixture=True)
    factory, actor, app, workflow, sid, tid = native_owner
    with factory.begin() as session:
        draft = session.get(Workflow, workflow.id)
        assert draft is not None
        graph = draft.graph_dict
        graph["nodes"][1]["data"]["retry_config"] = {"retry_enabled": True, "max_retries": 2, "retry_interval": 0}
        draft.graph = json.dumps(graph)
    with factory() as session:
        persisted_workflow = session.get(Workflow, workflow.id)
        assert persisted_workflow is not None
        committed_revision = execution_revision(persisted_workflow)
    service = BuilderExecutionPolicyService(factory)
    envelope = service.stamp_http_fixtures(
        app.id,
        actor,
        base_app_revision=committed_revision,
        fixtures=(
            HttpResponseFixtureV1(
                node_id="http", source="user_sample", status_code=500, content_type="text/plain", body="retry"
            ),
        ),
    )
    with factory.begin() as session:
        _loaded_dify_builder_test_input6 = session.get(DifyBuilderTestInput, tid)
        assert _loaded_dify_builder_test_input6 is not None
        _loaded_dify_builder_test_input6.http_fixtures = envelope.model_dump(mode="json")
    original = BuilderExecutionPolicyService.record
    recorded: list[str] = []

    def record(
        service: BuilderExecutionPolicyService,
        *,
        context: BuilderExecutionContextValue,
        native_run_id: str,
        task_id: str,
        observation: BuilderExecutionObservation,
    ) -> None:
        if poison and recorded:
            raise OSError("CI injected recorder failure after successful durable receipt")
        original(service, context=context, native_run_id=native_run_id, task_id=task_id, observation=observation)
        recorded.append(observation.invocation_id)

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
def test_composed_canonical_seal_replay_cannot_upgrade_or_change(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

    original = BuilderExecutionPolicyService.seal
    captured = []

    def seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
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
        _loaded_workflow_run7 = session.get(WorkflowRun, result.dify_run_id)
        assert _loaded_workflow_run7 is not None
        _loaded_workflow_run7.outputs = '{"out":"changed after seal"}'
    with pytest.raises(BuilderExecutionPolicyError, match="conflicting_execution_completion"):
        original(service, request_id=summary.request_id, completion=captured[0])


def configure_template(
    owner: NativeOwner,
    *,
    inputs: Inputs | None = None,
    graph: Graph | None = None,
    sample: HttpResponseFixtureV1 | None = None,
) -> Inputs:
    """Commit real draft/test-input rows before the ordinary port rereads them."""
    factory, actor, app, workflow, _, tid = owner
    graph = graph if graph is not None else yaml.safe_load((FIXTURES / "template_notification.yml").read_text())
    inputs = inputs if inputs is not None else {"subject": "  Notice  ", "body": "First paragraph.\nSecond paragraph."}
    with factory.begin() as session:
        _loaded_workflow8 = session.get(Workflow, workflow.id)
        assert _loaded_workflow8 is not None
        _loaded_workflow8.graph = json.dumps(graph)
        _loaded_dify_builder_test_input9 = session.get(DifyBuilderTestInput, tid)
        assert _loaded_dify_builder_test_input9 is not None
        _loaded_dify_builder_test_input9.inputs = inputs
    if sample is not None:
        with factory() as session:
            _loaded_workflow16 = session.get(Workflow, workflow.id)
            assert _loaded_workflow16 is not None
            revision = execution_revision(_loaded_workflow16)
        envelope = BuilderExecutionPolicyService(factory).stamp_http_fixtures(
            app.id,
            actor,
            base_app_revision=revision,
            fixtures=(sample,),
        )
        with factory.begin() as session:
            _loaded_dify_builder_test_input17 = session.get(DifyBuilderTestInput, tid)
            assert _loaded_dify_builder_test_input17 is not None
            _loaded_dify_builder_test_input17.http_fixtures = envelope.model_dump(mode="json")
    return inputs


def assert_template_native_rows(
    owner: NativeOwner, result: Run, want: str, node_ids: tuple[str, ...] = ("start", "template", "end")
) -> None:
    """Assert worker/SQL proof rather than granting success from rendered text."""
    factory, actor, app, workflow, sid, tid = owner
    assert result.execution_refusal is None
    assert result.status == "succeeded"
    assert result.dify_run_id
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.sealed
    assert summary.safety_outcome == "restricted_execution_completed"
    assert summary.mode == "restricted"
    assert summary.sandbox_profile == "disabled"
    assert summary.native_run_id == result.dify_run_id
    assert summary.blocked_node_ids == ()
    assert summary.simulated_node_ids == ()
    assert result.verification.terminal_outputs == {"notification_markdown": want}
    assert result.verification.executed_node_ids == list(node_ids)
    with factory() as session:
        native = session.get(WorkflowRun, result.dify_run_id)
        assert native is not None
        request = session.get(DifyBuilderExecutionRequest, summary.request_id)
        assert request is not None
        assert native is not None
        assert request is not None
        nodes = list(
            session.scalars(
                select(WorkflowNodeExecutionModel)
                .where(WorkflowNodeExecutionModel.workflow_run_id == native.id)
                .order_by(WorkflowNodeExecutionModel.index)
            )
        )
        assert (native.tenant_id, native.app_id, native.workflow_id, native.created_by) == (
            actor.tenant_id,
            app.id,
            workflow.id,
            actor.account_id,
        )
        assert str(native.status) == "succeeded"
        assert native.finished_at is not None
        assert native.total_steps == len(node_ids)
        assert native.exceptions_count == 0
        assert native.outputs_dict == {"notification_markdown": want}
        assert [node.node_id for node in nodes] == list(node_ids)
        assert [node.index for node in nodes] == list(range(1, len(node_ids) + 1))
        assert all(node.status == "succeeded" and node.finished_at and node.node_execution_id for node in nodes)
        assert all(
            (node.tenant_id, node.app_id, node.workflow_id, node.created_by)
            == (
                actor.tenant_id,
                app.id,
                workflow.id,
                actor.account_id,
            )
            for node in nodes
        )
        assert request.state == "sealed"
        assert request.native_run_id == native.id
        assert (request.session_id, request.test_input_id) == (sid, tid)
        assert request.completion_fingerprint
        assert request.observations == []
        draft = session.get(Workflow, workflow.id)
        assert draft is not None
        # The Build handler supplies these review metadata fields around the
        # port result; every native/proof field remains the actual port result.
        reviewed = replace(result, kind="verify", immutable=True, session_id=sid)
        decision = publication_decision(
            reviewed,
            session_id=sid,
            current_revision=execution_revision(draft),
            current_graph_revision=executable_graph_revision(dict(draft.graph_dict)),
        )
        assert decision.allowed
        assert decision.reason == "eligible"
        assert (
            publication_decision(
                reviewed,
                session_id=sid,
                current_revision="stale",
                current_graph_revision=executable_graph_revision(dict(draft.graph_dict)),
            ).reason
            == "stale_revision"
        )


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
@pytest.mark.parametrize(
    ("inputs", "want"),
    [
        pytest.param(
            {"subject": "  Notice  ", "body": "First paragraph.\nSecond paragraph."},
            "## Notice\n\nFirst paragraph.\nSecond paragraph.",
            id="paragraphs",
        ),
        pytest.param({"subject": "", "body": ""}, "", id="empty-both"),
        pytest.param({"subject": " \t", "body": "\n "}, "", id="whitespace-both"),
        pytest.param({"subject": " Notice ", "body": " \n"}, "## Notice", id="subject-only"),
        pytest.param({"subject": " \t", "body": "  First\nSecond  "}, "  First\nSecond  ", id="body-verbatim"),
        pytest.param(
            {"subject": "Data", "body": "{{ cycler.__init__.__globals__ }}"},
            "## Data\n\n{{ cycler.__init__.__globals__ }}",
            id="input-stays-data",
        ),
    ],
)
def test_composed_template_exact_outputs_are_sealed_native_sql_success(
    native_owner: NativeOwner, inputs: Inputs, want: str
) -> None:
    result = run_port(native_owner, configure_template(native_owner, inputs=inputs))
    # Admission refusal here is the meaningful missing-feature RED.
    assert_template_native_rows(native_owner, result, want)


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
def test_composed_renamed_template_and_multi_template_chain(native_owner: NativeOwner) -> None:
    graph = yaml.safe_load((FIXTURES / "template_notification.yml").read_text())
    graph["nodes"][0]["data"]["variables"] = [{"variable": "heading", "label": "Heading", "type": "text-input"}]
    graph["nodes"][1]["data"].update(
        template="{% if heading|trim %}[{{ heading|trim }}]{% else %}none{% endif %}",
        variables=[{"variable": "heading", "value_selector": ["start", "heading"]}],
    )
    graph["nodes"].insert(
        2,
        {
            "id": "format",
            "data": {
                "type": "template-transform",
                "template": "Update: {{ prior }}",
                "variables": [{"variable": "prior", "value_selector": ["template", "output"]}],
            },
        },
    )
    graph["nodes"][-1]["data"]["outputs"][0]["value_selector"] = ["format", "output"]
    graph["edges"] = [
        {"source": "start", "target": "template"},
        {"source": "template", "target": "format"},
        {"source": "format", "target": "end"},
    ]
    result = run_port(native_owner, configure_template(native_owner, graph=graph, inputs={"heading": " News "}))
    assert_template_native_rows(native_owner, result, "Update: [News]", ("start", "template", "format", "end"))


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
def test_composed_http_body_to_template_remains_sealed_simulation(native_owner: NativeOwner) -> None:
    graph = yaml.safe_load((FIXTURES / "template_notification.yml").read_text())
    http = yaml.safe_load((FIXTURES / "http_text.yml").read_text())["nodes"][1]
    http["data"]["url"] = "https://sample.invalid/fixed"
    graph["nodes"].insert(1, http)
    graph["nodes"][2]["data"].update(
        template="Recorded: {{ body }}",
        variables=[{"variable": "body", "value_selector": ["http", "body"]}],
    )
    graph["edges"] = [
        {"source": "start", "target": "http"},
        {"source": "http", "target": "template"},
        {"source": "template", "target": "end"},
    ]
    sample = HttpResponseFixtureV1(
        node_id="http",
        source="user_sample",
        status_code=200,
        content_type="text/plain",
        body="native fixture ✓",
    )
    result = run_port(native_owner, configure_template(native_owner, graph=graph, sample=sample))
    assert result.execution_refusal is None
    assert result.status == "succeeded"
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.sealed
    assert (summary.mode, summary.safety_outcome, summary.simulated_node_ids) == (
        "mock",
        "simulation_completed",
        ("http",),
    )
    with native_owner[0]() as session:
        native = session.get(WorkflowRun, result.dify_run_id)
        assert native is not None
        request = session.get(DifyBuilderExecutionRequest, summary.request_id)
        assert request is not None
        assert str(native.status) == "succeeded"
        assert native.outputs_dict == {"notification_markdown": "Recorded: native fixture ✓"}
        assert [o["kind"] for o in request.observations] == ["fixture_served"]
        assert [o["node_id"] for o in request.observations] == ["http"]
        assert request.state == "sealed"
    assert is_execution_policy_blocker(result)
    assert (
        publication_decision(
            replace(result, kind="verify", immutable=True, session_id=native_owner[4]),
            session_id=native_owner[4],
            current_revision=result.verification.execution_revision,
            current_graph_revision=result.verification.executed_graph_revision,
        ).reason
        == "simulation_only"
    )


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
@pytest.mark.parametrize(
    "mutation",
    ["dead-branch", "syntax", "source-over", "downstream", "object-input"],
)
def test_composed_unsafe_template_refuses_without_native_allocation(native_owner: NativeOwner, mutation: str) -> None:
    graph = yaml.safe_load((FIXTURES / "template_notification.yml").read_text())
    inputs: Inputs = {"subject": "Notice", "body": "Body"}
    data = graph["nodes"][1]["data"]
    if mutation == "dead-branch":
        data["template"] = "{% if false %}{{ subject.__class__ }}{% endif %}safe"
    elif mutation == "syntax":
        data["template"] = "{% if subject %}SECRET-TEMPLATE"
    elif mutation == "source-over":
        data["template"] = "é" * 8193
    elif mutation == "downstream":
        data["variables"][0]["value_selector"] = ["end", "notification_markdown"]
    else:
        inputs["body"] = {"secret": "SECRET-INPUT"}
    result = run_port(native_owner, configure_template(native_owner, graph=graph, inputs=inputs))
    assert result.execution_refusal is not None
    assert result.dify_run_id == ""
    assert result.per_node == []
    assert is_execution_policy_blocker(result)
    assert "SECRET-" not in result.error
    with native_owner[0]() as session:
        assert session.scalars(select(WorkflowRun).where(WorkflowRun.app_id == native_owner[2].id)).first() is None
        assert (
            session.scalars(
                select(WorkflowNodeExecutionModel).where(
                    WorkflowNodeExecutionModel.app_id == native_owner[2].id,
                )
            ).first()
            is None
        )


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
def test_composed_template_cumulative_output_overflow_is_native_failure(native_owner: NativeOwner) -> None:
    graph = yaml.safe_load((FIXTURES / "template_notification.yml").read_text())
    graph["nodes"][1]["data"]["template"] = "{{body}}{{body}}"
    inputs = {"subject": "Notice", "body": "é" * 16385}
    result = run_port(native_owner, configure_template(native_owner, graph=graph, inputs=inputs))
    assert result.execution_refusal is None
    assert result.dify_run_id
    assert result.status == "failed"
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.sealed
    assert summary.safety_outcome == "native_failed"
    assert "é" * 32 not in result.error
    with native_owner[0]() as session:
        native = session.get(WorkflowRun, result.dify_run_id)
        assert native is not None
        request = session.get(DifyBuilderExecutionRequest, summary.request_id)
        assert request is not None
        nodes = list(
            session.scalars(
                select(WorkflowNodeExecutionModel)
                .where(
                    WorkflowNodeExecutionModel.workflow_run_id == native.id,
                )
                .order_by(WorkflowNodeExecutionModel.index)
            )
        )
        assert native.status == "failed"
        assert [(node.node_id, node.status) for node in nodes] == [("start", "succeeded"), ("template", "failed")]
        assert request.state == "sealed"
        assert request.observations == []
    assert (
        publication_decision(
            replace(result, kind="verify", immutable=True, session_id=native_owner[4]),
            session_id=native_owner[4],
            current_revision=result.verification.execution_revision,
            current_graph_revision=result.verification.executed_graph_revision,
        ).allowed
        is False
    )


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
@pytest.mark.parametrize("missing", ["template-row", "raw-binding", "effective-input", "worker-completion"])
def test_composed_template_text_without_complete_sql_proof_cannot_publish(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, missing: str
) -> None:
    from sqlalchemy import delete

    real_seal = BuilderExecutionPolicyService.seal

    def before_seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
        assert completion.worker_finished
        with native_owner[0].begin() as session:
            native = session.get(WorkflowRun, completion.native_run_id)
            assert native is not None
            assert str(native.status) == "succeeded"
            native_outputs = native.outputs_dict
            assert native_outputs == {"notification_markdown": "## Notice\n\nFirst paragraph.\nSecond paragraph."}
            if missing == "template-row":
                session.execute(
                    delete(WorkflowNodeExecutionModel).where(
                        WorkflowNodeExecutionModel.workflow_run_id == native.id,
                        WorkflowNodeExecutionModel.node_id == "template",
                    )
                )
            elif missing == "raw-binding":
                graph = native.graph_dict
                graph["nodes"][1]["data"]["template"] = "changed after native output"
                native.graph = json.dumps(graph)
            elif missing == "effective-input":
                native.inputs = '{"subject":"changed","body":"Body"}'
        if missing == "worker-completion":
            completion = completion.model_copy(update={"worker_finished": False})
        return real_seal(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", before_seal)
    result = run_port(native_owner, configure_template(native_owner))
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.sealed
    assert summary.safety_outcome == "execution_evidence_unknown"
    assert (
        publication_decision(
            replace(result, kind="verify", immutable=True, session_id=native_owner[4]),
            session_id=native_owner[4],
            current_revision=result.verification.execution_revision,
            current_graph_revision=result.verification.executed_graph_revision,
        ).allowed
        is False
    )


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
def test_composed_template_seal_replay_rejects_changed_output(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from services.dify_builder.application.execution_policy import BuilderExecutionPolicyError

    real_seal = BuilderExecutionPolicyService.seal
    captured = []

    def observe(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
        captured.append(completion)
        return real_seal(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", observe)
    result = run_port(native_owner, configure_template(native_owner))
    assert_template_native_rows(native_owner, result, "## Notice\n\nFirst paragraph.\nSecond paragraph.")
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert len(captured) == 1
    service = BuilderExecutionPolicyService(native_owner[0])
    assert summary is not None
    assert real_seal(service, request_id=summary.request_id, completion=captured[0]) == summary
    with native_owner[0].begin() as session:
        _loaded_workflow_run10 = session.get(WorkflowRun, result.dify_run_id)
        assert _loaded_workflow_run10 is not None
        _loaded_workflow_run10.outputs = '{"notification_markdown":"changed after seal"}'
    with pytest.raises(BuilderExecutionPolicyError, match="conflicting_execution_completion"):
        real_seal(service, request_id=summary.request_id, completion=captured[0])


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
def test_composed_template_normal_workflow_citation_defaults_are_preserved(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    from core.rag.retrieval.dataset_retrieval import DatasetRetrieval

    retrieval = Mock(side_effect=AssertionError("citation display metadata initiated retrieval"))
    monkeypatch.setattr(DatasetRetrieval, "retrieve", retrieval)
    inputs = configure_template(native_owner)
    features: dict[str, object] = {
        "retriever_resource": {"enabled": True},
        "file_upload": {},
        "text_to_speech": {"enabled": False, "voice": "", "language": ""},
        "sensitive_word_avoidance": {"enabled": False},
    }
    factory, _, _, workflow, _, _ = native_owner
    with factory.begin() as session:
        _loaded_workflow11 = session.get(Workflow, workflow.id)
        assert _loaded_workflow11 is not None
        _loaded_workflow11._features = json.dumps(features)
    result = run_port(native_owner, inputs)
    # This actual normal metadata previously refused before allocating a run.
    assert_template_native_rows(native_owner, result, "## Notice\n\nFirst paragraph.\nSecond paragraph.")
    with factory() as session:
        _loaded_workflow18 = session.get(Workflow, workflow.id)
        assert _loaded_workflow18 is not None
        assert _loaded_workflow18.features_dict == features
        _loaded_workflow21 = session.get(Workflow, workflow.id)
        assert _loaded_workflow21 is not None
        assert _loaded_workflow21.features_dict["retriever_resource"]["enabled"] is True
    retrieval.assert_not_called()


@pytest.mark.usefixtures("no_live", "no_jinja_compilation")
@pytest.mark.parametrize(
    ("before", "after"), [(True, False), (False, True)], ids=["enabled-to-disabled", "disabled-to-enabled"]
)
def test_composed_citation_display_change_invalidates_reserved_template_context(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, before: bool, after: bool
) -> None:

    factory, _, app, workflow, _, _ = native_owner
    inputs = configure_template(native_owner)
    with factory.begin() as session:
        _loaded_workflow12 = session.get(Workflow, workflow.id)
        assert _loaded_workflow12 is not None
        _loaded_workflow12._features = json.dumps({"retriever_resource": {"enabled": before}})
    original = _BuilderExecutionLaunch.__call__

    def change_before_admission(
        launch: _BuilderExecutionLaunch,
        workflow: Workflow,
        app: App,
        entity: WorkflowAppGenerateEntity,
        root_node_id: str,
        resume: bool,
    ) -> BuilderExecutionRecorder:
        with factory.begin() as session:
            _loaded_workflow19 = session.get(Workflow, workflow.id)
            assert _loaded_workflow19 is not None
            _loaded_workflow19._features = json.dumps({"retriever_resource": {"enabled": after}})
        return original(launch, workflow, app, entity, root_node_id, resume)

    monkeypatch.setattr(_BuilderExecutionLaunch, "__call__", change_before_admission)
    result = run_port(native_owner, inputs)
    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "stale_execution_revision"
    assert result.dify_run_id == ""
    assert result.per_node == []
    assert is_execution_policy_blocker(result)
    with factory() as session:
        assert session.scalars(select(WorkflowRun).where(WorkflowRun.app_id == app.id)).first() is None
        assert (
            session.scalars(
                select(WorkflowNodeExecutionModel).where(WorkflowNodeExecutionModel.app_id == app.id)
            ).first()
            is None
        )
