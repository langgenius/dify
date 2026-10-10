"""Real Graphon engine and Dify factory, with row-backed restricted receipts."""

import hashlib
import hmac
import json
import time
from pathlib import Path
from typing import override

import pytest
import yaml
from sqlalchemy import event, select
from sqlalchemy.exc import OperationalError

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.dify_builder.execution_policy import canonical_digest
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool
from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.entities import GraphInitParams
from graphon.graph import Graph
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_engine.layers.base import GraphEngineLayer
from graphon.graph_events import (
    GraphRunFailedEvent,
    GraphRunPartialSucceededEvent,
    GraphRunSucceededEvent,
    NodeRunSucceededEvent,
)
from graphon.nodes.end.end_node import EndNode
from graphon.nodes.http_request.node import HttpRequestNode
from graphon.nodes.start.start_node import StartNode
from graphon.runtime import GraphRuntimeState, VariablePool
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.workflow import Workflow
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from services.dify_builder.revision import execution_revision
from tests.unit_tests.core.dify_builder.test_execution_policy import fixture
from tests.unit_tests.services.dify_builder.test_execution_policy_service import owned as owned  # noqa: PLC0414

FIXTURES = Path(__file__).parents[4] / "fixtures/workflow/builder_restricted"


class ThrowingLayer(GraphEngineLayer):
    def on_graph_start(self):
        pass

    def on_event(self, event):
        pass

    def on_graph_end(self, error):
        pass

    @override
    def on_node_run_start(self, node):
        _ = node
        raise RuntimeError("observer is unavailable")


def prepare_native(owned, name, *, samples=(), inputs=None, http_data=None):
    db_factory, actor, app, workflow, sid, tid = owned
    graph_config = yaml.safe_load((FIXTURES / name).read_text())
    if http_data is not None:
        graph_config["nodes"][1]["data"].update(http_data)
    inputs = inputs if inputs is not None else {"path": "resolved-secret"}
    workflow.graph = json.dumps(graph_config)
    service = BuilderExecutionPolicyService(db_factory)
    with db_factory.begin() as db:
        db.get(Workflow, workflow.id).graph = workflow.graph
        db.get(DifyBuilderTestInput, tid).inputs = inputs
    if samples:
        envelope = service.stamp_http_fixtures(
            app.id, actor, base_app_revision=execution_revision(workflow), fixtures=samples
        )
        with db_factory.begin() as db:
            db.get(DifyBuilderTestInput, tid).http_fixtures = envelope.model_dump(mode="json")
    context = service.prepare(
        session_id=sid,
        test_input_id=tid,
        app_id=app.id,
        actor=actor,
        workflow=workflow,
        submitted_inputs=inputs,
        effective_inputs=inputs,
    )
    service.claim_launch(context=context, native_run_id="native-run", task_id="native-task")
    recorder = service.recorder(context=context, native_run_id="native-run", task_id="native-task")
    params = GraphInitParams(
        workflow_id=workflow.id,
        graph_config=graph_config,
        call_depth=0,
        run_context=build_dify_run_context(
            tenant_id=actor.tenant_id,
            app_id=app.id,
            user_id=actor.account_id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            builder_execution=context,
        ),
    )
    pool = VariablePool()
    add_node_inputs_to_pool(pool, node_id="start", inputs=inputs)
    state = GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())
    factory = DifyNodeFactory(graph_init_params=params, graph_runtime_state=state, execution_recorder=recorder)
    return factory, context, recorder


def execute_native(factory, *, throwing=False):
    graph = Graph.init(graph_config=factory.graph_init_params.graph_config, node_factory=factory, root_node_id="start")
    engine = GraphEngine(
        workflow_id=factory.graph_init_params.workflow_id,
        graph=graph,
        graph_runtime_state=factory.graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(min_workers=1, max_workers=1),
    )
    if throwing:
        engine.layer(ThrowingLayer())
    events = []
    error = None
    try:
        events.extend(iter_dify_graph_engine_events(engine))
    except RuntimeError as caught:
        error = caught
    return graph, events, error


def receipts(owned):
    with owned[0]() as db:
        row = db.scalar(select(DifyBuilderExecutionRequest))
        assert (row.native_run_id, row.task_id) == ("native-run", "native-task")
        return row.observations


@pytest.fixture(autouse=True)
def forbid_live(monkeypatch):
    import core.workflow.node_factory as module
    import graphon.nodes.http_request.node as http_module
    from core.helper import ssrf_proxy
    from core.helper.code_executor.code_executor import CodeExecutor
    from core.plugin.impl import oauth
    from core.tools.tool_manager import ToolManager

    def forbidden(*_args, **_kwargs):
        raise AssertionError("live owner reached")

    for name in (
        "build_dify_model_access",
        "DefaultWorkflowCodeExecutor",
        "DifyFileReferenceFactory",
        "DifyToolFileManager",
        "DifyToolNodeRuntime",
        "DifyHumanInputNodeRuntime",
        "CodeExecutorJinja2TemplateRenderer",
        "PluginAgentStrategyResolver",
        "PluginAgentStrategyPresentationProvider",
        "AgentRuntimeSupport",
        "DifyPromptMessageSerializer",
        "DifyRetrieverAttachmentLoader",
        "build_dify_llm_file_saver",
    ):
        monkeypatch.setattr(module, name, forbidden)
    for name in ("get", "head", "post", "put", "patch", "delete"):
        monkeypatch.setattr(ssrf_proxy.graphon_ssrf_proxy, name, forbidden)
    monkeypatch.setattr(http_module, "get_http_client", forbidden)
    monkeypatch.setattr(CodeExecutor, "execute_workflow_code_template", forbidden)
    monkeypatch.setattr(ToolManager, "get_workflow_tool_runtime", forbidden)
    monkeypatch.setattr(oauth, "OAuthHandler", forbidden)


@pytest.mark.parametrize("throwing", [False, True])
def test_native_scalar_outputs_survive_throwing_observers(owned, throwing):
    factory, context, recorder = prepare_native(owned, "scalar.yml", inputs={"text": "真实 native"})
    graph, events, error = execute_native(factory, throwing=throwing)
    assert error is None
    assert type(graph.nodes["start"]) is StartNode
    assert type(graph.nodes["end"]) is EndNode
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"out": "真实 native"}]
    assert {e.node_id for e in events if isinstance(e, NodeRunSucceededEvent)} == {"start", "end"}
    assert recorder.healthy
    assert receipts(owned) == []


@pytest.mark.parametrize(("body", "content_type"), [('{"sample":true}', "application/json"), ("你好 🌍", "text/plain")])
def test_native_dynamic_http_fixture_outputs_and_durable_binding(owned, body, content_type):
    factory, context, recorder = prepare_native(
        owned, "http_text.yml", samples=(fixture(body=body, content_type=content_type),)
    )
    graph, events, error = execute_native(factory)
    assert type(graph.nodes["http"]) is HttpRequestNode
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"status": 201, "text": body}]
    assert {e.node_id for e in events if isinstance(e, NodeRunSucceededEvent)} == {"start", "http", "end"}
    observations = receipts(owned)
    assert len(observations) == 1
    receipt = observations[0]
    assert receipt["kind"] == "fixture_served"
    assert receipt["request_id"] == context.request_id
    assert receipt["node_id"] == "http"
    assert receipt["implementation_version"] == "graphon.nodes.http_request.node.HttpRequestNode:1"
    assert receipt["fixture_digest"] == context.fixture_digest
    expected_request = canonical_digest(
        {
            "method": "GET",
            "url": "https://sample.invalid/resolved-secret",
            "kwargs": {
                "max_retries": 0,
                "data": None,
                "files": None,
                "json": None,
                "content": "",
                "headers": {},
                "params": None,
                "timeout": (10, 10, 10),
                "ssl_verify": True,
                "follow_redirects": True,
            },
            "context_digest": context.context_digest,
            "node_id": "http",
            "invocation_id": receipt["invocation_id"],
        }
    )
    assert (
        receipt["request_hmac"]
        == hmac.new(factory._request_hmac_key, expected_request.encode("ascii"), hashlib.sha256).hexdigest()
    )
    assert "resolved-secret" not in json.dumps(observations)
    assert recorder.healthy


@pytest.mark.parametrize(
    "headers",
    [
        "Content-Type: application/json; charset=utf-8",
        "Content-Type: APPLICATION/JSON; CHARSET=UTF-8",
        "CONTENT-TYPE: APPLICATION/JSON",
        "Content-Type: TEXT/PLAIN; CHARSET=UTF-8",
        "content-type: TEXT/PLAIN",
    ],
)
def test_admitted_fixed_header_case_serves_actual_native_fixture(owned, headers):
    body = '{"sample":true}'
    factory, _, recorder = prepare_native(
        owned,
        "http_text.yml",
        samples=(fixture(body=body, content_type="application/json"),),
        http_data={"headers": headers},
    )
    graph, events, error = execute_native(factory)
    assert type(graph.nodes["http"]) is HttpRequestNode
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"status": 201, "text": body}]
    assert {e.node_id for e in events if isinstance(e, NodeRunSucceededEvent)} == {"start", "http", "end"}
    observations = receipts(owned)
    assert len(observations) == 1
    assert observations[0]["kind"] == "fixture_served"
    assert recorder.healthy


@pytest.mark.parametrize("throwing", [False, True])
def test_reached_native_http_denial_has_durable_evidence(owned, throwing):
    factory, context, recorder = prepare_native(owned, "http_text.yml")
    graph, events, error = execute_native(factory, throwing=throwing)
    assert type(graph.nodes["http"]) is HttpRequestNode
    assert isinstance(error, RuntimeError)
    assert str(error) == "execution_policy: http_fixture_missing"
    assert any(isinstance(e, GraphRunFailedEvent) for e in events)
    assert not any(isinstance(e, GraphRunSucceededEvent) for e in events)
    assert receipts(owned)[0]["kind"] == "effect_blocked"
    assert receipts(owned)[0]["reason_code"] == "http_fixture_missing"
    assert "resolved-secret" not in str(events[-1])


@pytest.mark.parametrize("throwing", [False, True])
def test_native_default_output_success_keeps_blocked_evidence(owned, throwing):
    factory, context, recorder = prepare_native(owned, "http_default_output.yml")
    _, events, error = execute_native(factory, throwing=throwing)
    assert error is None
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunPartialSucceededEvent)] == [
        {"status": 599, "text": "denied default"}
    ]
    assert any(isinstance(e, NodeRunSucceededEvent) and e.node_id == "end" for e in events)
    assert [e.exceptions_count for e in events if isinstance(e, GraphRunPartialSucceededEvent)] == [1]
    assert receipts(owned)[0]["kind"] == "effect_blocked"


def test_recorder_db_failure_prevents_fixture_return_and_poisons_shared_latch(owned):
    factory, context, recorder = prepare_native(owned, "http_text.yml", samples=(fixture(),))
    engine = owned[0].kw["bind"]

    def fail_append(_connection, _cursor, statement, parameters, _context, _executemany):
        if statement.startswith("UPDATE dify_builder_execution_requests"):
            raise OperationalError(statement, parameters, RuntimeError("database append unavailable"))

    event.listen(engine, "before_cursor_execute", fail_append)
    try:
        _, events, error = execute_native(factory)
        assert isinstance(error, RuntimeError)
        assert "execution_recorder_failed" in str(error)
        assert not any(isinstance(e, GraphRunSucceededEvent) for e in events)
        assert not recorder.healthy
        assert receipts(owned) == []
        from core.dify_builder.execution_policy import BuilderExecutionPolicyError

        with pytest.raises(BuilderExecutionPolicyError, match="missing_execution_recorder"):
            factory.with_runtime_state(factory.graph_runtime_state)
    finally:
        event.remove(engine, "before_cursor_execute", fail_append)


@pytest.mark.parametrize(
    "body",
    [
        {"type": "raw-text", "data": [{"type": "text", "value": "{{#start.path#}}"}]},
        {"type": "json", "data": [{"type": "text", "value": '{"path":"{{#start.path#}}"}'}]},
    ],
)
def test_native_text_request_bodies_and_params_resolve_without_file_capabilities(owned, body):
    factory, _, _ = prepare_native(
        owned,
        "http_text.yml",
        samples=(fixture(),),
        http_data={"method": "POST", "body": body, "params": "path: {{#start.path#}}"},
    )
    _, events, error = execute_native(factory)
    assert error is None
    assert [e.outputs for e in events if isinstance(e, GraphRunSucceededEvent)] == [{"status": 201, "text": "sample"}]
    assert receipts(owned)[0]["kind"] == "fixture_served"


def test_native_retries_append_distinct_denials_without_outbound_calls(owned):
    factory, _, _ = prepare_native(
        owned,
        "http_text.yml",
        http_data={"retry_config": {"retry_enabled": True, "max_retries": 1, "retry_interval": 1}},
    )
    _, events, error = execute_native(factory)
    assert isinstance(error, RuntimeError)
    assert any(isinstance(e, GraphRunFailedEvent) for e in events)
    observations = receipts(owned)
    assert len(observations) == 2
    assert {o["kind"] for o in observations} == {"effect_blocked"}
    assert len({o["invocation_id"] for o in observations}) == 2
    assert len({o["observation_id"] for o in observations}) == 2
