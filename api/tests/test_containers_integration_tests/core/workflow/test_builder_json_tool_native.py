"""Composed JSON Builder path: real port, worker, Graphon nodes and PostgreSQL rows.

Only installed daemon metadata and the daemon invoke transport are controlled.
These tests establish Builder ownership and wiring, not installed parser semantics.
"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from core.tools import tool_manager as manager_module
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.plugin_tool import tool as plugin_tool_module
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from services.dify_builder import json_tool_metadata as metadata
from services.dify_builder.dify_port import WorkflowServiceDifyPort, _BuilderExecutionLaunch
from services.dify_builder.execution_contracts import (
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    JsonToolExecutionContext,
    canonical_digest,
)
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_json_tool_metadata import _installation, _provider

FIXTURE = Path(__file__).parents[3] / "fixtures/workflow/builder_restricted/json_parse.yml"


def _configure(owner, *, ensure_ascii: bool, wrapped: bool) -> dict[str, str]:
    factory, _, _, workflow, _, test_input_id = owner
    graph = json.loads(FIXTURE.read_text())
    graph["nodes"][1]["data"]["tool_configurations"]["ensure_ascii"] = (
        {"type": "constant", "value": ensure_ascii} if wrapped else ensure_ascii
    )
    inputs = {"payload": '{"greeting":"café"}', "json_path": "$.greeting"}
    with factory.begin() as db:
        db.get(Workflow, workflow.id).graph = json.dumps(graph, ensure_ascii=False)
        db.get(DifyBuilderTestInput, test_input_id).inputs = inputs
    return inputs


def _external_json_transport(monkeypatch, tenant_id: str, *, text: str = "café") -> list[dict]:
    """Return the reviewed declaration from daemon owners and count native calls."""
    provider = _provider()
    calls: list[dict] = []

    class Installer:
        def fetch_plugin_installation_by_ids(self, actual_tenant, plugin_ids):
            assert (actual_tenant, plugin_ids) == (tenant_id, [metadata.PLUGIN_ID])
            return [_installation(tenant_id=tenant_id)]

    class Manager:
        def fetch_tool_provider(self, actual_tenant, provider_id):
            assert (actual_tenant, provider_id) == (tenant_id, metadata.PROVIDER_ID)
            return provider

        def invoke(self, **kwargs):
            assert kwargs["tenant_id"] == tenant_id
            assert kwargs["tool_provider"] == metadata.PROVIDER_ID
            assert kwargs["tool_name"] == metadata.TOOL_NAME
            assert kwargs["credentials"] == {}
            assert kwargs["confirmed_dispatch_headers"] is None
            calls.append(kwargs["tool_parameters"])
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT,
                message=ToolInvokeMessage.TextMessage(text=text),
            )

    monkeypatch.setattr(metadata, "PluginInstaller", Installer)
    monkeypatch.setattr(metadata, "PluginToolManager", Manager)
    monkeypatch.setattr(manager_module, "PluginToolManager", Manager)
    monkeypatch.setattr(plugin_tool_module, "PluginToolManager", Manager)
    monkeypatch.setattr(
        ToolManager,
        "get_plugin_provider",
        classmethod(
            lambda _cls, _provider_id, actual_tenant: PluginToolProviderController(
                entity=provider.declaration,
                plugin_id=provider.plugin_id,
                plugin_unique_identifier=provider.plugin_unique_identifier,
                tenant_id=actual_tenant,
            )
        ),
    )
    return calls


@pytest.mark.parametrize(
    ("ensure_ascii", "wrapped"),
    [(True, False), (False, False), (True, True), (False, True)],
    ids=["raw-true", "raw-false", "constant-true", "constant-false"],
)
def test_json_native_port_worker_graphon_run_and_end_seal(native_owner, monkeypatch, ensure_ascii, wrapped):
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=ensure_ascii, wrapped=wrapped)
    calls = _external_json_transport(monkeypatch, actor.tenant_id)
    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )
    assert result.execution_refusal is None
    assert result.status == "succeeded"
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.policy_version == "builder-json-parse-v1"
    assert summary.safety_outcome == "restricted_execution_completed"
    assert calls == [{"content": inputs["payload"], "json_filter": inputs["json_path"], "ensure_ascii": ensure_ascii}]
    with factory() as db:
        request = db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id))
        assert request is not None
        context = JsonToolExecutionContext.model_validate(request.context)
        assert context.qualified_tool.final_parameters_digest == canonical_digest(calls[0])
        assert (request.state, request.native_run_id, summary.native_run_id) == (
            "sealed",
            summary.native_run_id,
            result.dify_run_id,
        )
        assert len(request.observations) == 1
        receipt = BuilderExecutionObservation.model_validate(request.observations[0])
        assert receipt.kind == "qualified_json_completed"
        native = db.get(WorkflowRun, summary.native_run_id)
        assert native is not None
        nodes = list(
            db.scalars(
                select(WorkflowNodeExecutionModel)
                .where(WorkflowNodeExecutionModel.workflow_run_id == native.id)
                .order_by(WorkflowNodeExecutionModel.index)
            )
        )
        assert [(node.index, node.node_id, node.status) for node in nodes] == [
            (1, "node1", "succeeded"),
            (2, "node2", "succeeded"),
            (3, "node3", "succeeded"),
        ]
        assert receipt.native_node_execution_id == nodes[1].node_execution_id
        assert nodes[1].outputs_dict["text"] == "café"
        assert nodes[2].outputs_dict["result"] == "café"
        assert native.outputs_dict["result"] == "café"


@pytest.mark.parametrize(
    "poison",
    ["request_owner", "native_owner", "saved_input", "native_graph", "native_input", "tool_node", "receipt", "retry"],
)
def test_json_seal_refuses_cross_owner_and_corrupt_native_proof(native_owner, monkeypatch, poison):
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=False, wrapped=True)
    calls = _external_json_transport(monkeypatch, actor.tenant_id)
    original_seal = BuilderExecutionPolicyService.seal

    def poison_then_seal(service, *, request_id, completion):
        with factory.begin() as db:
            request = db.get(DifyBuilderExecutionRequest, request_id)
            assert request is not None
            native = db.get(WorkflowRun, request.native_run_id)
            assert native is not None
            nodes = list(
                db.scalars(
                    select(WorkflowNodeExecutionModel)
                    .where(WorkflowNodeExecutionModel.workflow_run_id == native.id)
                    .order_by(WorkflowNodeExecutionModel.index)
                )
            )
            assert len(nodes) == 3
            if poison == "request_owner":
                request.actor_id = str(uuid4())
            elif poison == "native_owner":
                native.tenant_id = str(uuid4())
            elif poison == "saved_input":
                db.get(DifyBuilderTestInput, test_input_id).inputs = {**inputs, "payload": "{}"}
            elif poison == "native_graph":
                graph = native.graph_dict
                graph["nodes"][1]["data"]["tool_name"] = "other"
                native.graph = json.dumps(graph)
            elif poison == "native_input":
                native.inputs = json.dumps({"payload": "{}", "json_path": "$.greeting"})
            elif poison == "tool_node":
                nodes[1].node_execution_id = str(uuid4())
            elif poison == "receipt":
                receipts = list(request.observations)
                receipts[0] = {**receipts[0], "native_text_output_digest": "0" * 64}
                request.observations = receipts
            else:
                nodes[1].process_data = json.dumps({RETRY_HISTORY_PROCESS_DATA_KEY: [{"retry_index": 1}]})
        return original_seal(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", poison_then_seal)
    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )
    assert len(calls) == 1
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.policy_version == "builder-json-parse-v1"
    assert summary.safety_outcome == "execution_evidence_unknown"


def test_concurrent_json_launch_claim_dispatches_at_most_once(native_owner, monkeypatch):
    """Two real PostgreSQL contenders can pass preflight; one enters application invocation."""
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=True, wrapped=False)
    _external_json_transport(monkeypatch, actor.tenant_id)
    service = BuilderExecutionPolicyService(factory)
    with factory() as db:
        draft = db.get(Workflow, workflow.id)
        owned_app = db.get(type(app), app.id)
        db.expunge_all()
    context = service.prepare(
        session_id=session_id,
        test_input_id=test_input_id,
        app_id=app.id,
        actor=actor,
        workflow=draft,
        submitted_inputs=inputs,
        effective_inputs=inputs,
    )
    assert isinstance(context, JsonToolExecutionContext)
    barrier = threading.Barrier(3)
    entered = []
    refused = []

    def compete(index):
        launch = _BuilderExecutionLaunch(service, context)
        entity = SimpleNamespace(
            builder_execution=context,
            files=[],
            single_iteration_run=None,
            single_loop_run=None,
            invoke_from=InvokeFrom.DEBUGGER,
            app_config=SimpleNamespace(
                app_id=app.id,
                tenant_id=actor.tenant_id,
                workflow_id=workflow.id,
                app_mode="workflow",
            ),
            user_id=actor.account_id,
            inputs=inputs,
            call_depth=0,
            workflow_execution_id=str(uuid4()),
            task_id=str(uuid4()),
        )
        barrier.wait()
        try:
            recorder = launch(draft, owned_app, entity, "node1", False)
            assert recorder.healthy
            entered.append(index)
        except BuilderExecutionPolicyError as error:
            refused.append(error.reason_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(compete, index) for index in range(2)]
        barrier.wait()
        for future in futures:
            future.result()
    assert len(entered) == 1
    assert entered[0] in {0, 1}
    assert refused == ["execution_already_claimed"]
    with factory() as db:
        request = db.get(DifyBuilderExecutionRequest, context.request_id)
        assert request.state == "running"
        assert request.native_run_id is not None
        assert request.task_id is not None
