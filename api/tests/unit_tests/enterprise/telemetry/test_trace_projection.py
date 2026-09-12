"""Enterprise keeps operational metadata and measurement contracts when content is hidden."""

import json
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import Mock
from uuid import uuid4

import pytest
from opentelemetry.proto.metrics.v1.metrics_pb2 import Metric

from core.ops.otlp_trace import otlp_value
from core.ops.trace_data import CompletedTrace, TraceSource
from core.ops.workflow_trace import WorkflowTraceRecorder
from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient
from graphon.engine_events import GraphRunAbortedEvent, GraphRunSucceededEvent, NodeRunSucceededEvent
from graphon.enums import WorkflowNodeExecutionMetadataKey
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.node_events import NodeRunResult
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace
from tests.unit_tests.core.ops.test_workflow_trace_limits import start_node, workflow_node


@pytest.mark.parametrize("include_content", [True, False])
@pytest.mark.parametrize("node_type", ["llm", "question-classifier", "parameter-extractor", "code"])
def test_recorded_node_inputs_keep_variables_separate_from_prompts(
    include_content: bool, node_type: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()))
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="draft",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type=node_type)
    start_node(recorder, node)
    variables = {"query": "private query", "parameters": ["category"]}
    prompts = [{"role": "user", "text": "Rendered private query with instructions"}]
    started = datetime.now(UTC)
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type=node_type,
            start_at=started,
            finished_at=started + timedelta(seconds=1),
            node_run_result=NodeRunResult(inputs=variables, process_data={"prompts": prompts}, outputs={}),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    send_traces, log = Mock(), Mock()
    monkeypatch.setattr(client.otlp, "send_traces", send_traces)
    monkeypatch.setattr(client.otlp, "send_metrics", Mock())
    monkeypatch.setattr(client.logger, "info", log)
    client.export_trace(CompletedTrace.model_validate_json(submitted[0].model_dump_json()))
    exported = send_traces.call_args.args[0].resource_spans[0].scope_spans[0].spans[-1]
    for fields in (
        {item.key: item.value.string_value for item in exported.attributes},
        log.call_args.kwargs["extra"]["attributes"],
    ):
        if include_content:
            assert json.loads(fields["dify.node.inputs"]) == variables
            assert json.loads(fields["dify.node.process_data"]) == {"prompts": prompts}
        else:
            assert fields["dify.node.inputs"] == f"ref:node_execution_id={node.execution_id}"
            assert "private" not in str(fields)


@pytest.mark.parametrize("include_content", [True, False])
def test_recorded_workflow_stop_keeps_its_error_counter(include_content: bool, monkeypatch: pytest.MonkeyPatch) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    recorder.on_event(GraphRunAbortedEvent(reason="Workflow execution stopped"))
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    assert trace.spans[0].status == "cancelled"
    assert trace.spans[0].error == "Workflow execution stopped"

    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    send_metrics = Mock()
    monkeypatch.setattr(client.otlp, "send_metrics", send_metrics)
    monkeypatch.setattr(client.otlp, "send_traces", Mock())
    monkeypatch.setattr(client.logger, "info", Mock())
    client.export_trace(trace)
    metrics = {metric.name: Metric.FromString(metric.SerializeToString()) for metric in send_metrics.call_args.args[0]}
    error = metrics["dify.errors.total"].sum.data_points[0]
    assert error.as_int == 1
    assert {item.key: item.value.string_value for item in error.attributes} == {
        "tenant_id": source.tenant_id,
        "app_id": source.app_id,
        "type": "workflow",
    }
    request = metrics["dify.requests.total"].sum.data_points[0]
    assert {item.key: item.value.string_value for item in request.attributes}["status"] == "stopped"


@pytest.mark.parametrize("include_content", [True, False])
def test_recorded_tool_node_exports_its_name_in_spans_and_logs(
    include_content: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = TraceSource(tenant_id=str(uuid4()), app_id=str(uuid4()), operation_id=str(uuid4()), actor_id="user")
    submitted: list[CompletedTrace] = []
    recorder = WorkflowTraceRecorder(
        source=source,
        workflow_id="workflow",
        workflow_version="1",
        inputs={},
        submit_completed_trace=lambda trace: submitted.append(trace) is None,
    )
    node = workflow_node(source, node_type="tool")
    start_node(recorder, node)
    started = datetime.now(UTC)
    recorder.on_event(
        NodeRunSucceededEvent(
            id=node.execution_id,
            node_id=node.id,
            node_type="tool",
            start_at=started,
            finished_at=started + timedelta(seconds=1),
            node_run_result=NodeRunResult(
                inputs={"query": "private question"},
                outputs={"answer": "private answer"},
                metadata={WorkflowNodeExecutionMetadataKey.TOOL_INFO: {"tool_name": "google_search"}},
            ),
        )
    )
    recorder.on_event(GraphRunSucceededEvent())
    assert recorder.finish_workflow_trace()
    trace = CompletedTrace.model_validate_json(submitted[0].model_dump_json())
    assert trace.spans[-1].attributes["metadata"] == {"tool_info": {"tool_name": "google_search"}}

    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    send_traces = Mock()
    log = Mock()
    monkeypatch.setattr(client.otlp, "send_traces", send_traces)
    monkeypatch.setattr(client.otlp, "send_metrics", Mock())
    monkeypatch.setattr(client.logger, "info", log)
    client.export_trace(trace)
    exported = send_traces.call_args.args[0].resource_spans[0].scope_spans[0].spans[-1]
    attributes = {item.key: item.value.string_value for item in exported.attributes}
    log_attributes = log.call_args.kwargs["extra"]["attributes"]
    for fields in (attributes, log_attributes):
        assert fields["gen_ai.tool.name"] == "google_search"
        assert fields["dify.node.title"] == node.title
        if not include_content:
            assert "private" not in str(fields)


@pytest.mark.parametrize("operation_type", ["node_execution", "draft_node_execution"])
@pytest.mark.parametrize("tool_info", [None, "invalid", {}])
def test_explicit_tool_name_survives_missing_or_invalid_tool_metadata(operation_type: str, tool_info: object) -> None:
    trace = make_completed_trace()
    span = trace.spans[-1].model_copy(update={"attributes": {"tool_name": "search", "tool_info": tool_info}})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": False})
    attributes = client._attributes(trace, span, operation_type)
    assert attributes["gen_ai.tool.name"] == "search"


@pytest.mark.parametrize(
    ("operation_type", "prefix", "extra_fields"),
    [
        ("workflow", "dify.workflow", ("query",)),
        ("node_execution", "dify.node", ("process_data",)),
        ("draft_node_execution", "dify.node", ("process_data",)),
        ("message", "dify.message", ()),
        ("tool", "dify.tool", ("parameters", "config")),
        ("moderation", "dify.moderation", ("query", "preset_response")),
        ("suggested_question", "dify.suggested_question", ("questions",)),
        ("dataset_retrieval", "dify.retrieval", ("query",)),
        ("generate_name", "dify.generate_name", ()),
        ("rule_generate", "dify.prompt_generation", ("instruction", "output")),
    ],
)
def test_content_fields_keep_their_json_string_contract(
    operation_type: str, prefix: str, extra_fields: tuple[str, ...]
) -> None:
    trace = make_completed_trace()
    inputs = {"query": "private question"}
    outputs = ["private answer", "another answer"]
    span = trace.spans[0].model_copy(
        update={
            "inputs": inputs,
            "outputs": outputs,
            "attributes": {
                "query": inputs,
                "process_data": inputs,
                "tool_parameters": inputs,
                "tool_config": inputs,
                "preset_response": inputs,
            },
        }
    )
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": True})
    attributes = client._attributes(trace, span, operation_type)
    for field in ("inputs", "outputs", *extra_fields):
        value = attributes[f"{prefix}.{field}"]
        assert otlp_value(value).WhichOneof("value") == "string_value"
        assert json.loads(value) == (outputs if field in {"outputs", "output", "questions"} else inputs)


@pytest.mark.parametrize("value", [None, "plain text"])
def test_content_preserves_plain_strings_and_absent_values(value: str | None) -> None:
    trace = make_completed_trace()
    span = trace.spans[0].model_copy(update={"inputs": value, "outputs": value, "attributes": {"query": value}})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": True})
    attributes = client._attributes(trace, span, "workflow")
    for field in ("inputs", "outputs", "query"):
        if value is None:
            assert f"dify.workflow.{field}" not in attributes
        else:
            assert attributes[f"dify.workflow.{field}"] == value


@pytest.mark.parametrize("include_content", [True, False])
def test_retrieval_documents_keep_the_metadata_projection(include_content: bool) -> None:
    trace = make_completed_trace()
    message_id = str(uuid4())
    trace = trace.model_copy(update={"source": trace.source.model_copy(update={"message_id": message_id})})
    documents = [
        {
            "page_content": "private document text",
            "metadata": {
                "dataset_id": "dataset",
                "document_id": "document",
                "segment_id": "segment",
                "score": 0.75,
                "dataset_name": "Knowledge",
                "other": "private metadata",
            },
        },
        {"page_content": "private document without metadata", "metadata": None},
        "invalid document entry",
    ]
    span = trace.spans[0].model_copy(update={"outputs": {"documents": documents}})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    attributes = client._attributes(trace, span, "dataset_retrieval")
    if include_content:
        assert json.loads(attributes["dify.dataset.documents"]) == [
            {"dataset_id": "dataset", "document_id": "document", "segment_id": "segment", "score": 0.75},
            {"dataset_id": None, "document_id": None, "segment_id": None, "score": None},
        ]
        assert json.loads(attributes["output.value"]) == {"documents": documents}
        assert json.loads(attributes["dify.retrieval.outputs"]) == {"documents": documents}
    else:
        assert attributes["dify.dataset.documents"] == f"ref:message_id={message_id}"
        assert "private" not in str(attributes)


@pytest.mark.parametrize("external_trace_id", [None, "external-request-trace"])
@pytest.mark.parametrize("operation_type", ["generate_name", "rule_generate", "code_generate", "structured_output"])
def test_generation_content_references_use_the_original_identity(
    external_trace_id: str | None, operation_type: str
) -> None:
    trace = make_completed_trace()
    conversation_id = str(uuid4())
    trace = trace.model_copy(
        update={
            "source": trace.source.model_copy(
                update={
                    "conversation_id": conversation_id,
                    "message_id": str(uuid4()),
                    "external_trace_id": external_trace_id,
                }
            )
        }
    )
    span = trace.spans[0].model_copy(update={"inputs": "private instruction", "outputs": "private output"})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": False})
    attributes = client._attributes(trace, span, operation_type)
    if operation_type == "generate_name":
        reference = f"ref:conversation_id={conversation_id}"
        fields = ("dify.generate_name.inputs", "dify.generate_name.outputs")
    else:
        # The producer supplies no external trace ID by default, as in the previous TraceTask.
        reference = f"ref:trace_id={external_trace_id}"
        fields = ("dify.prompt_generation.instruction", "dify.prompt_generation.output")
    for field in ("input.value", "output.value", *fields):
        assert attributes[field] == reference
    assert "private" not in str(attributes)


@pytest.mark.parametrize("include_content", [True, False])
@pytest.mark.parametrize("operation_type", ["node_execution", "draft_node_execution", "rule_generate"])
@pytest.mark.parametrize("price", [None, "0", "0.0012"])
@pytest.mark.parametrize("usage_field", ["total_price", "total_cost"])
def test_serialized_usage_prices_remain_numeric_attributes(
    include_content: bool, operation_type: str, price: str | None, usage_field: str
) -> None:
    usage = (
        LLMUsage.empty_usage()
        .model_copy(update={"total_price": Decimal(price or "0"), "currency": "USD"})
        .model_dump(mode="json")
    )
    captured_price = usage.pop("total_price")
    if price is not None:
        usage[usage_field] = captured_price
    trace = make_completed_trace()
    span = trace.spans[-1].model_copy(update={"usage": usage})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    attributes = client._attributes(trace, span, operation_type)
    prefix = "dify.prompt_generation" if operation_type == "rule_generate" else "dify.node"
    if operation_type == "rule_generate" and price is None:
        assert f"{prefix}.total_price" not in attributes
        assert f"{prefix}.currency" not in attributes
        return
    value = attributes[f"{prefix}.total_price"]
    assert value == float(price or "0")
    assert otlp_value(value).WhichOneof("value") == "double_value"
    assert attributes[f"{prefix}.currency"] == "USD"


@pytest.mark.parametrize(
    ("operation_type", "status", "expected", "has_error"),
    [
        ("workflow", "ok", "succeeded", False),
        ("workflow", "handled_error", "partial-succeeded", False),
        ("workflow", "cancelled", "stopped", False),
        ("workflow", "incomplete", "unknown", False),
        ("workflow", "error", "failed", True),
        ("node_execution", "handled_error", "exception", True),
        ("node_execution", "cancelled", "stopped", False),
        ("node_execution", "incomplete", "unknown", False),
    ],
)
def test_business_outcomes_do_not_become_unconditional_success(
    operation_type: str, status: str, expected: str, has_error: bool
) -> None:
    trace = make_completed_trace()
    span = (trace.spans[0] if operation_type == "workflow" else trace.spans[-1]).model_copy(update={"status": status})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "protocol": "http/protobuf"})
    metrics = client._metrics(trace, span, operation_type)
    request = next(metric for metric in metrics if metric.name == "dify.requests.total")
    assert (
        next(item.value.string_value for item in request.sum.data_points[0].attributes if item.key == "status")
        == expected
    )
    assert any(metric.name == "dify.errors.total" for metric in metrics) is has_error
    attributes = client._attributes(trace, span, operation_type)
    key = "dify.workflow.status" if operation_type == "workflow" else "dify.node.status"
    assert attributes[key] == expected


def test_partial_capture_does_not_change_a_known_successful_business_outcome() -> None:
    trace = make_completed_trace().model_copy(update={"complete": False, "truncation": {"reasons": ["span_limit"]}})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example"})
    attributes = client._attributes(trace, trace.spans[0], "workflow")
    assert attributes["dify.workflow.status"] == "succeeded"
    assert attributes["dify.trace.complete"] is False


@pytest.mark.parametrize("include_content", [True, False])
def test_node_metadata_and_dimensions_survive_content_policy(include_content: bool) -> None:
    trace = make_completed_trace()
    node = trace.spans[-1].model_copy(
        update={
            "span_name": "Fetch articles",
            "span_type": "tool",
            "inputs": "private question",
            "outputs": "private answer",
            "attributes": {
                "node_type": "tool",
                "node_version": "2",
                "model_name": "model",
                "model_provider": "provider",
                "app_name": "App",
                "workspace_name": "Workspace",
                "triggered_from": "debugger",
                "plugin_name": "search-plugin",
                "credential_name": "Workspace credential",
                "credential_id": "credential-id",
                "prompts": "private prompt",
                "process_data": {"prompts": "private rendered prompt"},
                "index": 4,
                "predecessor_node_id": "node-1",
                "metadata": {
                    "iteration_id": "iteration-1",
                    "iteration_index": 2,
                },
            },
        }
    )
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": include_content})
    attributes = client._attributes(trace, node, "node_execution")
    assert attributes["dify.node.title"] == "Fetch articles"
    assert attributes["dify.node.type"] == "tool"
    assert attributes["dify.node.version"] == "2"
    assert attributes["dify.node.index"] == 4
    assert attributes["dify.node.predecessor_node_id"] == "node-1"
    assert attributes["dify.node.iteration_index"] == 2
    assert attributes["dify.node.elapsed_time"] == 2
    assert attributes["dify.app.name"] == "App"
    assert attributes["dify.workspace.name"] == "Workspace"
    assert attributes["dify.invoke_from"] == "debugger"
    assert attributes["dify.plugin.name"] == "search-plugin"
    assert attributes["dify.credential.id"] == "credential-id"
    assert attributes["gen_ai.request.model"] == "model"
    if include_content:
        assert attributes["dify.node.inputs"] == "private question"
    else:
        assert "private" not in str(attributes)
        assert attributes["dify.node.inputs"] == f"ref:node_execution_id={node.node_execution_id}"
        assert attributes["dify.node.process_data"] == attributes["dify.node.inputs"]
    metrics = client._metrics(trace, node, "node_execution")
    request = next(metric for metric in metrics if metric.name == "dify.requests.total")
    assert {item.key: item.value.string_value for item in request.sum.data_points[0].attributes} == {
        "tenant_id": trace.source.tenant_id,
        "app_id": trace.source.app_id,
        "type": "node",
        "status": "succeeded",
        "node_type": "tool",
        "model_provider": "provider",
        "model_name": "model",
    }
    duration = next(metric for metric in metrics if metric.name == "dify.node.duration")
    assert {item.key: item.value.string_value for item in duration.histogram.data_points[0].attributes} == {
        "tenant_id": trace.source.tenant_id,
        "app_id": trace.source.app_id,
        "node_type": "tool",
        "model_provider": "provider",
        "model_name": "model",
        "plugin_name": "search-plugin",
    }


def test_message_streaming_fields_and_metric_model_dimensions_are_not_content() -> None:
    trace = make_completed_trace()
    message = trace.spans[0].model_copy(
        update={
            "span_type": "operation",
            "attributes": {
                "operation_type": "message",
                "model_name": "model",
                "model_provider": "provider",
                "from_source": "api",
            },
            "usage": {"time_to_first_token": 0.25, "time_to_generate": 1.5},
        }
    )
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": False})
    attributes = client._attributes(trace, message, "message")
    assert attributes["dify.streaming"] is True
    assert attributes["dify.message.time_to_first_token"] == 0.25
    assert attributes["dify.message.streaming_duration"] == 1.5
    metrics = client._metrics(trace, message, "message")
    for metric in (metric for metric in metrics if metric.HasField("histogram")):
        labels = {item.key: item.value.string_value for item in metric.histogram.data_points[0].attributes}
        assert labels == {
            "tenant_id": trace.source.tenant_id,
            "app_id": trace.source.app_id,
            "model_name": "model",
            "model_provider": "provider",
        }


def test_retrieval_metrics_use_each_returned_datasets_model() -> None:
    trace = make_completed_trace()
    retrieval = trace.spans[0].model_copy(
        update={
            "span_type": "retrieval",
            "outputs": {
                "documents": [
                    {"page_content": "private one", "metadata": {"dataset_id": "one"}},
                    {"page_content": "private two", "metadata": {"dataset_id": "two"}},
                ]
            },
            "attributes": {
                "dataset_models": {
                    "one": {
                        "dataset_name": "First",
                        "embedding_model_provider": "openai",
                        "embedding_model": "embedding-one",
                    },
                    "two": {
                        "dataset_name": "Second",
                        "embedding_model_provider": "other",
                        "embedding_model": "embedding-two",
                    },
                }
            },
        }
    )
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": False})
    assert client._operation_type(retrieval) == "dataset_retrieval"
    metrics = client._metrics(trace, retrieval, "dataset_retrieval")
    labels = [
        {item.key: item.value.string_value for item in metric.sum.data_points[0].attributes}
        for metric in metrics
        if metric.name == "dify.dataset.retrievals.total"
    ]
    assert [(item["dataset_id"], item["embedding_model_provider"], item["embedding_model"]) for item in labels] == [
        ("one", "openai", "embedding-one"),
        ("two", "other", "embedding-two"),
    ]
    attributes = client._attributes(trace, retrieval, "dataset_retrieval")
    assert json.loads(attributes["dify.dataset.name"]) == ["First", "Second"]
    assert "private" not in str(attributes)


def test_draft_node_keeps_its_request_type() -> None:
    trace = make_completed_trace()
    node = trace.spans[-1].model_copy(
        update={"attributes": {"operation_type": "draft_node_execution", "node_type": "llm"}}
    )
    client = EnterpriseTraceClient({"endpoint": "https://collector.example"})
    operation_type = client._operation_type(node)
    assert operation_type == "draft_node_execution"
    metrics = client._metrics(trace, node, operation_type)
    request = next(metric for metric in metrics if metric.name == "dify.requests.total")
    assert (
        next(item.value.string_value for item in request.sum.data_points[0].attributes if item.key == "type")
        == "draft_node"
    )


@pytest.mark.parametrize(("status", "message_status"), [("ok", "normal"), ("error", "error")])
def test_message_preserves_legacy_status_and_invocation_source_labels(status: str, message_status: str) -> None:
    trace = make_completed_trace()
    message = trace.spans[0].model_copy(
        update={
            "span_type": "operation",
            "status": status,
            "attributes": {
                "operation_type": "message",
                "status": message_status,
                "from_source": "console",
                "invoke_from": "debugger",
            },
        }
    )
    client = EnterpriseTraceClient({"endpoint": "https://collector.example", "include_content": False})
    attributes = client._attributes(trace, message, "message")
    assert attributes["dify.message.status"] == message_status
    assert attributes["dify.invoke_from"] == "console"
    requests = next(
        metric for metric in client._metrics(trace, message, "message") if metric.name == "dify.requests.total"
    )
    labels = {item.key: item.value.string_value for item in requests.sum.data_points[0].attributes}
    assert labels["status"] == message_status
    assert labels["invoke_from"] == "console"


def test_nested_workflow_root_remains_a_workflow_with_inherited_host_node_id() -> None:
    trace = make_completed_trace()
    root = trace.spans[-1].model_copy(update={"span_type": "workflow", "status": "handled_error"})
    client = EnterpriseTraceClient({"endpoint": "https://collector.example"})
    operation_type = client._operation_type(root)
    assert operation_type == "workflow"
    assert client._attributes(trace, root, operation_type)["dify.workflow.status"] == "partial-succeeded"
    total = next(
        metric for metric in client._metrics(trace, root, operation_type) if metric.name == "dify.tokens.total"
    )
    labels = {item.key: item.value.string_value for item in total.sum.data_points[0].attributes}
    assert labels["node_type"] == ""
    assert labels["model_name"] == ""
