"""Enterprise keeps operational metadata and measurement contracts when content is hidden."""

import json

import pytest

from enterprise.telemetry.enterprise_trace import EnterpriseTraceClient
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


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
                "metadata": {
                    "index": 4,
                    "iteration_id": "iteration-1",
                    "iteration_index": 2,
                    "predecessor_node_id": "node-1",
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
