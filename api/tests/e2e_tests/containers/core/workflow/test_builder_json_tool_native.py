"""Composed JSON Builder path: real port, worker, Graphon nodes and PostgreSQL rows.

Only installed daemon metadata and the daemon invoke transport are controlled.
These tests establish Builder ownership and wiring, not installed parser semantics.
"""

import json
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import NotRequired, TypedDict
from uuid import uuid4

import pytest
from sqlalchemy import select

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.app.workflow.retry_history import RETRY_HISTORY_PROCESS_DATA_KEY
from core.plugin.entities.plugin import PluginInstallation
from core.plugin.entities.plugin_daemon import PluginToolProviderEntity
from core.tools import tool_manager as manager_module
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.plugin_tool import tool as plugin_tool_module
from core.tools.plugin_tool.provider import PluginToolProviderController
from core.tools.tool_manager import ToolManager
from models.dify_builder import DifyBuilderExecutionRequest, DifyBuilderTestInput
from models.workflow import Workflow, WorkflowNodeExecutionModel, WorkflowRun
from runtime_contracts.builder.execution import (
    BuilderExecutionObservation,
    BuilderExecutionPolicyError,
    ExecutionEvidenceSummary,
    JsonToolExecutionContext,
    canonical_digest,
)
from services.app_generate_service import AppGenerateService
from services.dify_builder import json_tool_metadata as metadata
from services.dify_builder.application.execution_policy import TrustedExecutionCompletion
from services.dify_builder.dify_port import WorkflowServiceDifyPort, _BuilderExecutionLaunch
from services.dify_builder.execution_policy_service import BuilderExecutionPolicyService
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import NativeOwner
from tests.test_containers_integration_tests.core.workflow.test_builder_restricted_native import (
    native_owner as native_owner,  # noqa: PLC0414
)
from tests.unit_tests.services.dify_builder.test_json_tool_execution import add_native_editor_metadata
from tests.unit_tests.services.dify_builder.test_json_tool_metadata import _installation, _provider


class _JsonSealCapture(TypedDict):
    completion: NotRequired[TrustedExecutionCompletion]
    receipt: NotRequired[dict[str, object]]


FIXTURE = Path(__file__).parents[3] / "fixtures/workflow/builder_restricted/json_parse.yml"


def _configure(
    owner: NativeOwner, *, ensure_ascii: bool, wrapped: bool, echo_start: bool = False, editor_metadata: bool = False
) -> dict[str, str]:
    factory, _, _, workflow, _, test_input_id = owner
    graph = json.loads(FIXTURE.read_text())
    graph["nodes"][1]["data"]["tool_configurations"]["ensure_ascii"] = (
        {"type": "constant", "value": ensure_ascii} if wrapped else ensure_ascii
    )
    if echo_start:
        graph["nodes"][2]["data"]["outputs"].append({"variable": "echo", "value_selector": ["node1", "payload"]})
    if editor_metadata:
        add_native_editor_metadata(graph)
    inputs = {"payload": '{"greeting":"café"}', "json_path": "$.greeting"}
    with factory.begin() as db:
        _loaded_workflow1 = db.get(Workflow, workflow.id)
        assert _loaded_workflow1 is not None
        _loaded_workflow1.graph = json.dumps(graph, ensure_ascii=False)
        _loaded_dify_builder_test_input2 = db.get(DifyBuilderTestInput, test_input_id)
        assert _loaded_dify_builder_test_input2 is not None
        _loaded_dify_builder_test_input2.inputs = inputs
    return inputs


def test_json_caller_explicit_read_session_closes_before_native_spawn(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Inspect the actual Session passed to generation at its worker-thread handoff."""
    _, actor, app, _, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=True, wrapped=False)
    _external_json_transport(monkeypatch, actor.tenant_id)
    caller_session = None
    at_spawn = []
    original_generate = AppGenerateService.generate.__func__
    original_start = threading.Thread.start

    def capture_generation(cls: type[AppGenerateService], *args: object, **kwargs: object) -> object:
        nonlocal caller_session
        caller_session = kwargs["session"]
        return original_generate(cls, *args, **kwargs)

    def capture_spawn(thread: threading.Thread) -> None:
        from types import FunctionType, MethodType

        target = thread._target
        if isinstance(target, (FunctionType, MethodType)) and target.__name__ == "_generate_worker":
            assert caller_session is not None
            at_spawn.append(caller_session.in_transaction())
        return original_start(thread)

    monkeypatch.setattr(AppGenerateService, "generate", classmethod(capture_generation))
    monkeypatch.setattr(threading.Thread, "start", capture_spawn)
    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )
    assert result.status == "succeeded"
    assert at_spawn == [False]


def _external_json_transport(
    monkeypatch: pytest.MonkeyPatch,
    tenant_id: str,
    *,
    text: str = "café",
    metadata_calls: list[str] | None = None,
    runtime_type: str = "local",
) -> list[dict[str, object]]:
    """Return the reviewed declaration from daemon owners and count native calls."""
    provider = _provider()
    calls: list[dict[str, object]] = []

    class Installer:
        def fetch_plugin_installation_by_ids(
            self, actual_tenant: str, plugin_ids: list[str]
        ) -> list[PluginInstallation]:
            if metadata_calls is not None:
                metadata_calls.append("installation")
            assert (actual_tenant, plugin_ids) == (tenant_id, [metadata.PLUGIN_ID])
            return [_installation(tenant_id=tenant_id, runtime_type=runtime_type)]

    class Manager:
        def fetch_tool_provider(self, actual_tenant: str, provider_id: str) -> PluginToolProviderEntity:
            if metadata_calls is not None:
                metadata_calls.append("provider")
            assert (actual_tenant, provider_id) == (tenant_id, metadata.PROVIDER_ID)
            return provider

        def invoke(self, **kwargs: object) -> Iterator[ToolInvokeMessage]:
            assert kwargs["tenant_id"] == tenant_id
            assert kwargs["tool_provider"] == metadata.PROVIDER_ID
            assert kwargs["tool_name"] == metadata.TOOL_NAME
            assert kwargs["credentials"] == {}
            assert kwargs["confirmed_dispatch_headers"] is None
            parameters = kwargs["tool_parameters"]
            assert isinstance(parameters, dict)
            calls.append(parameters)
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
def test_json_native_port_worker_graphon_run_and_end_seal(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, ensure_ascii: bool, wrapped: bool
) -> None:
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
        assert nodes[1].outputs_dict is not None
        assert nodes is not None
        assert nodes[1].outputs_dict["text"] == "café"
        assert nodes[2].outputs_dict is not None
        assert nodes[2].outputs_dict["result"] == "café"
        assert native.outputs_dict["result"] == "café"


def test_serverless_json_native_owned_prepare_run_and_seal(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, app, _, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=False, wrapped=True)
    metadata_calls: list[str] = []
    calls = _external_json_transport(
        monkeypatch, actor.tenant_id, runtime_type="serverless", metadata_calls=metadata_calls
    )

    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )

    assert result.execution_refusal is None
    assert result.status == "succeeded"
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.safety_outcome == "restricted_execution_completed"
    assert summary.sealed is True
    assert calls == [{"content": inputs["payload"], "json_filter": inputs["json_path"], "ensure_ascii": False}]
    assert metadata_calls.count("installation") >= 2
    with factory() as db:
        request = db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id))
        assert request is not None
        context = JsonToolExecutionContext.model_validate(request.context)
        assert context.qualified_tool.runtime_type == "serverless"
        assert context.qualified_tool.qualification_digest == (
            "b3728bbec6b6fcb4c9bd4677fb519994ebd4666c182c542a8acd0c0e5ef89c03"
        )
        assert (request.state, request.native_run_id) == ("sealed", summary.native_run_id)
        assert len(request.observations) == 1
        receipt = BuilderExecutionObservation.model_validate(request.observations[0])
        assert receipt.kind == "qualified_json_completed"
        assert receipt.qualification_digest == context.qualified_tool.qualification_digest
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
        assert native.outputs_dict["result"] == "café"


def test_native_editor_metadata_serverless_json_prepare_run_and_seal(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=True, wrapped=True, editor_metadata=True)
    with factory() as db:
        _loaded_workflow3 = db.get(Workflow, workflow.id)
        assert _loaded_workflow3 is not None
        saved_graph = _loaded_workflow3.graph
        graph = json.loads(saved_graph)
        assert graph["nodes"][1]["data"]["is_team_authorization"] is True
        assert graph["nodes"][1]["data"]["provider_show_name"] == "JSON Process"
        assert graph["nodes"][2]["data"]["outputs"][0]["value_type"] == "string"
    calls = _external_json_transport(monkeypatch, actor.tenant_id, runtime_type="serverless")

    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )

    assert result.execution_refusal is None
    assert result.status == "succeeded"
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.safety_outcome == "restricted_execution_completed"
    assert summary.sealed is True
    assert calls == [{"content": inputs["payload"], "json_filter": inputs["json_path"], "ensure_ascii": True}]
    with factory() as db:
        _loaded_workflow8 = db.get(Workflow, workflow.id)
        assert _loaded_workflow8 is not None
        assert _loaded_workflow8.graph == saved_graph
        request = db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id))
        assert request is not None
        context = JsonToolExecutionContext.model_validate(request.context)
        assert context.qualified_tool.runtime_type == "serverless"
        assert context.qualified_tool.qualification_digest == (
            "b3728bbec6b6fcb4c9bd4677fb519994ebd4666c182c542a8acd0c0e5ef89c03"
        )
        assert (request.state, request.native_run_id) == ("sealed", summary.native_run_id)
        assert len(request.observations) == 1
        receipt = BuilderExecutionObservation.model_validate(request.observations[0])
        assert receipt.kind == "qualified_json_completed"
        assert receipt.native_node_execution_id is not None
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
        assert nodes[1].outputs_dict is not None
        assert nodes is not None
        assert nodes[1].outputs_dict["text"] == "café"
        assert native.outputs_dict["result"] == "café"


@pytest.mark.parametrize("ui_identifier", ["missing", "null"], ids=["missing", "null"])
def test_json_optional_graph_plugin_identifier_seals_without_saved_graph_rewrite(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, ui_identifier: str
) -> None:
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=False, wrapped=True)
    with factory() as db:
        _loaded_workflow9 = db.get(Workflow, workflow.id)
        assert _loaded_workflow9 is not None
        graph = json.loads(_loaded_workflow9.graph)
    tool = graph["nodes"][1]["data"]
    assert tool["tool_configurations"]["ensure_ascii"] == {"type": "constant", "value": False}
    if ui_identifier == "missing":
        del tool["plugin_unique_identifier"]
    else:
        tool["plugin_unique_identifier"] = None
    saved_graph = json.dumps(graph, ensure_ascii=False)
    with factory.begin() as db:
        _loaded_workflow4 = db.get(Workflow, workflow.id)
        assert _loaded_workflow4 is not None
        _loaded_workflow4.graph = saved_graph
    calls = _external_json_transport(monkeypatch, actor.tenant_id)

    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )

    assert result.execution_refusal is None
    assert result.status == "succeeded"
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.safety_outcome == "restricted_execution_completed"
    assert calls == [{"content": inputs["payload"], "json_filter": inputs["json_path"], "ensure_ascii": False}]
    with factory() as db:
        _loaded_workflow10 = db.get(Workflow, workflow.id)
        assert _loaded_workflow10 is not None
        assert _loaded_workflow10.graph == saved_graph
        request = db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id))
        assert request is not None
        assert request.state == "sealed"
        assert len(request.observations) == 1
        assert BuilderExecutionObservation.model_validate(request.observations[0]).kind == "qualified_json_completed"
        native = db.get(WorkflowRun, summary.native_run_id)
        assert native is not None
        nodes = list(
            db.scalars(
                select(WorkflowNodeExecutionModel)
                .where(WorkflowNodeExecutionModel.workflow_run_id == native.id)
                .order_by(WorkflowNodeExecutionModel.index)
            )
        )
        assert [(node.node_id, node.status) for node in nodes] == [
            ("node1", "succeeded"),
            ("node2", "succeeded"),
            ("node3", "succeeded"),
        ]
        assert nodes[2].outputs_dict == {"result": "café"}


def test_json_supplied_mismatched_graph_plugin_identifier_refuses_before_allocation(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=False, wrapped=True)
    graph = json.loads(FIXTURE.read_text())
    graph["nodes"][1]["data"]["plugin_unique_identifier"] = "different-installation"
    with factory.begin() as db:
        _loaded_workflow5 = db.get(Workflow, workflow.id)
        assert _loaded_workflow5 is not None
        _loaded_workflow5.graph = json.dumps(graph, ensure_ascii=False)
    metadata_calls: list[str] = []
    calls = _external_json_transport(monkeypatch, actor.tenant_id, metadata_calls=metadata_calls)

    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )

    assert result.execution_refusal is not None
    assert result.execution_refusal.reason_code == "unsupported_json_tool_configuration"
    assert calls == []
    assert metadata_calls == []
    with factory() as db:
        assert (
            db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id)) is None
        )
        assert db.scalar(select(WorkflowRun).where(WorkflowRun.app_id == app.id)) is None


def test_json_constant_only_graph_without_start_inputs_seals_native_completion(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    graph = json.loads(FIXTURE.read_text())
    graph["nodes"][0]["data"]["variables"] = []
    graph["nodes"][1]["data"]["tool_parameters"] = {
        "content": {"type": "constant", "value": '{"x":1}'},
        "json_filter": {"type": "constant", "value": "$.x"},
    }
    graph["nodes"][1]["data"]["tool_configurations"]["ensure_ascii"] = False
    saved_graph = json.dumps(graph, ensure_ascii=False)
    with factory.begin() as db:
        _loaded_workflow6 = db.get(Workflow, workflow.id)
        assert _loaded_workflow6 is not None
        _loaded_workflow6.graph = saved_graph
        _loaded_dify_builder_test_input7 = db.get(DifyBuilderTestInput, test_input_id)
        assert _loaded_dify_builder_test_input7 is not None
        _loaded_dify_builder_test_input7.inputs = {}
    calls = _external_json_transport(monkeypatch, actor.tenant_id, text="1")

    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, {}, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )

    assert result.execution_refusal is None
    assert result.status == "succeeded"
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.safety_outcome == "restricted_execution_completed"
    assert calls == [{"content": '{"x":1}', "json_filter": "$.x", "ensure_ascii": False}]
    with factory() as db:
        _loaded_workflow11 = db.get(Workflow, workflow.id)
        assert _loaded_workflow11 is not None
        assert _loaded_workflow11.graph == saved_graph
        request = db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id))
        assert request is not None
        assert request.state == "sealed"
        assert len(request.observations) == 1
        native = db.get(WorkflowRun, summary.native_run_id)
        assert native is not None
        nodes = list(
            db.scalars(
                select(WorkflowNodeExecutionModel)
                .where(WorkflowNodeExecutionModel.workflow_run_id == native.id)
                .order_by(WorkflowNodeExecutionModel.index)
            )
        )
        assert [(node.node_id, node.status) for node in nodes] == [
            ("node1", "succeeded"),
            ("node2", "succeeded"),
            ("node3", "succeeded"),
        ]
        assert nodes[2].outputs_dict == {"result": "1"}
        assert native.outputs_dict == {"result": "1"}


@pytest.mark.parametrize(
    "poison",
    ["request_owner", "native_owner", "saved_input", "native_graph", "native_input", "tool_node", "receipt", "retry"],
)
def test_json_seal_refuses_cross_owner_and_corrupt_native_proof(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, poison: str
) -> None:
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=False, wrapped=True)
    calls = _external_json_transport(monkeypatch, actor.tenant_id)
    original_seal = BuilderExecutionPolicyService.seal

    def poison_then_seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
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
                _loaded_dify_builder_test_input12 = db.get(DifyBuilderTestInput, test_input_id)
                assert _loaded_dify_builder_test_input12 is not None
                _loaded_dify_builder_test_input12.inputs = {**inputs, "payload": "{}"}
            elif poison == "native_graph":
                graph = native.graph_dict
                graph["nodes"][1]["data"]["tool_name"] = "other"
                native.graph = json.dumps(graph)
            elif poison == "native_input":
                native.inputs = json.dumps({"payload": "{}", "json_path": "$.greeting"})
            elif poison == "tool_node":
                nodes[1].node_execution_id = str(uuid4())
            elif poison == "receipt":
                receipts: list[dict[str, object]] = list(request.observations)
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


@pytest.mark.parametrize("poison", ["none", "changed_start", "missing_start", "extra_output"])
def test_json_native_end_matches_tool_and_start_selectors_exactly(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, poison: str
) -> None:
    factory, actor, app, _, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=False, wrapped=True, echo_start=True)
    calls = _external_json_transport(monkeypatch, actor.tenant_id)
    original_seal = BuilderExecutionPolicyService.seal

    def poison_then_seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
        if poison != "none":
            with factory.begin() as db:
                request = db.get(DifyBuilderExecutionRequest, request_id)
                assert request is not None
                native = db.get(WorkflowRun, request.native_run_id)
                assert native is not None
                end = db.scalar(
                    select(WorkflowNodeExecutionModel).where(
                        WorkflowNodeExecutionModel.workflow_run_id == native.id,
                        WorkflowNodeExecutionModel.node_id == "node3",
                    )
                )
                assert end is not None
                assert end.outputs_dict is not None
                outputs = dict(end.outputs_dict)
                if poison == "changed_start":
                    outputs["echo"] = "wrong"
                elif poison == "missing_start":
                    outputs.pop("echo")
                else:
                    outputs["unexpected"] = "extra"
                end.outputs = json.dumps(outputs, ensure_ascii=False)
                native.outputs = json.dumps(outputs, ensure_ascii=False)
        return original_seal(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", poison_then_seal)
    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )
    assert calls == [{"content": inputs["payload"], "json_filter": inputs["json_path"], "ensure_ascii": False}]
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.safety_outcome == (
        "restricted_execution_completed" if poison == "none" else "execution_evidence_unknown"
    )
    if poison == "none":
        with factory() as db:
            native = db.get(WorkflowRun, summary.native_run_id)
            assert native is not None
            assert native.outputs_dict == {"result": "café", "echo": inputs["payload"]}


@pytest.mark.parametrize(
    "poison",
    [
        "missing_receipt",
        "duplicate_receipt",
        "post_binding_drift",
        "worker_unseen",
        "worker_failed",
        "incomplete_response",
        "unhealthy_recorder",
    ],
)
def test_json_first_seal_requires_single_trusted_completed_observation(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch, poison: str
) -> None:
    factory, actor, app, _, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=True, wrapped=False)
    calls = _external_json_transport(monkeypatch, actor.tenant_id)
    original_seal = BuilderExecutionPolicyService.seal

    def poison_then_seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
        if poison.endswith("receipt") or poison == "post_binding_drift":
            with factory.begin() as db:
                request = db.get(DifyBuilderExecutionRequest, request_id)
                assert request is not None
                receipts: list[dict[str, object]] = list(request.observations)
                assert len(receipts) == 1
                if poison == "missing_receipt":
                    receipts = []
                elif poison == "duplicate_receipt":
                    receipts.append(dict(receipts[0]))
                else:
                    receipts[0] = {**receipts[0], "post_binding_digest": "0" * 64}
                request.observations = receipts
        else:
            updates = {
                "worker_unseen": {"worker_finished": False, "worker_exit": "not_observed"},
                "worker_failed": {"worker_finished": True, "worker_exit": "failed"},
                "incomplete_response": {"response_completed": False},
                "unhealthy_recorder": {"recorder_healthy": False},
            }
            completion = completion.model_copy(update=updates[poison])
        return original_seal(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", poison_then_seal)
    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )
    assert len(calls) == 1
    assert result.verification is not None
    summary = result.verification.execution_evidence
    assert summary is not None
    assert summary.safety_outcome == "execution_evidence_unknown"
    with factory() as db:
        request = db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id))
        assert request is not None
        assert request.state == "sealed"
        assert request.completion_summary is not None
        assert request.completion_summary["safety_outcome"] == "execution_evidence_unknown"


def test_json_unknown_first_seal_cannot_upgrade_after_receipt_repair(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    factory, actor, app, _, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=True, wrapped=False)
    _external_json_transport(monkeypatch, actor.tenant_id)
    original_seal = BuilderExecutionPolicyService.seal
    captured: _JsonSealCapture = {}

    def poison_first_seal(
        service: BuilderExecutionPolicyService, *, request_id: str, completion: TrustedExecutionCompletion
    ) -> ExecutionEvidenceSummary:
        captured["completion"] = completion
        with factory.begin() as db:
            request = db.get(DifyBuilderExecutionRequest, request_id)
            assert request is not None
            captured["receipt"] = dict(request.observations[0])
            request.observations = []
        return original_seal(service, request_id=request_id, completion=completion)

    monkeypatch.setattr(BuilderExecutionPolicyService, "seal", poison_first_seal)
    result = WorkflowServiceDifyPort().run_draft(
        app.id, actor, inputs, lambda _: None, session_id=session_id, test_input_id=test_input_id
    )
    assert result.verification is not None
    assert result.verification.execution_evidence is not None
    assert result.verification.execution_evidence.safety_outcome == "execution_evidence_unknown"
    with factory.begin() as db:
        request = db.scalar(select(DifyBuilderExecutionRequest).where(DifyBuilderExecutionRequest.app_id == app.id))
        assert request is not None
        request.observations = [captured["receipt"]]
        request_id = request.id
    with pytest.raises(BuilderExecutionPolicyError, match="conflicting_execution_completion"):
        original_seal(BuilderExecutionPolicyService(factory), request_id=request_id, completion=captured["completion"])


def test_concurrent_json_launch_claim_dispatches_at_most_once(
    native_owner: NativeOwner, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two real PostgreSQL contenders can pass preflight; one enters application invocation."""
    factory, actor, app, workflow, session_id, test_input_id = native_owner
    inputs = _configure(native_owner, ensure_ascii=True, wrapped=False)
    _external_json_transport(monkeypatch, actor.tenant_id)
    service = BuilderExecutionPolicyService(factory)
    with factory() as db:
        draft = db.get(Workflow, workflow.id)
        assert draft is not None
        owned_app = db.get(type(app), app.id)
        assert owned_app is not None
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

    def compete(index: int) -> None:
        launch = _BuilderExecutionLaunch(service, context)
        entity = WorkflowAppGenerateEntity.model_construct(
            builder_execution=context,
            files=[],
            single_iteration_run=None,
            single_loop_run=None,
            invoke_from=InvokeFrom.DEBUGGER,
            app_config=WorkflowUIBasedAppConfig.model_construct(
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
        assert request is not None
        assert request.state == "running"
        assert request.native_run_id is not None
        assert request.task_id is not None
