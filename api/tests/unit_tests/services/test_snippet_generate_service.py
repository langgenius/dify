import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from core.workflow.snippet_start import SNIPPET_VIRTUAL_START_NODE_ID
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.snippet_generate_service import SnippetGenerateService


def _workflow(graph: dict) -> Workflow:
    return Workflow(
        id="workflow-1",
        tenant_id="tenant-1",
        app_id="snippet-1",
        type=WorkflowType.WORKFLOW,
        kind=WorkflowKind.SNIPPET,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(graph),
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )


def test_filter_virtual_start_events_keeps_blocking_response_unchanged():
    response = {"data": {"outputs": {"text": "ok"}}}

    assert SnippetGenerateService._filter_virtual_start_events(response) is response


def test_filter_virtual_start_events_removes_virtual_start_node_events():
    stream = iter(
        [
            {"event": "node_started", "data": {"node_id": SNIPPET_VIRTUAL_START_NODE_ID}},
            {"event": "node_finished", "data": {"node_id": "llm-1"}},
            "raw-event",
        ]
    )

    filtered = SnippetGenerateService._filter_virtual_start_events(stream)

    assert list(filtered) == [{"event": "node_finished", "data": {"node_id": "llm-1"}}, "raw-event"]


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        ("raw-event", False),
        ({"event": "message", "data": {"node_id": SNIPPET_VIRTUAL_START_NODE_ID}}, False),
        ({"event": "node_started", "data": "not-a-dict"}, False),
        ({"event": "node_started", "data": {"node_id": SNIPPET_VIRTUAL_START_NODE_ID}}, True),
    ],
)
def test_is_virtual_start_event(message, expected):
    assert SnippetGenerateService._is_virtual_start_event(message) is expected


def test_ensure_start_node_returns_workflow_when_start_already_exists():
    workflow = _workflow({"nodes": [{"id": "start", "data": {"type": "start"}}], "edges": []})
    snippet = SimpleNamespace(input_fields_list=[])

    result = SnippetGenerateService._ensure_start_node(workflow, snippet)

    assert result is workflow


def test_ensure_start_node_injects_virtual_start_for_root_candidates(monkeypatch):
    graph = {
        "nodes": [
            {"id": "llm-1", "data": {"type": "llm"}},
            {"id": "answer-1", "data": {"type": "answer"}},
        ],
        "edges": [{"source": "llm-1", "target": "answer-1"}],
    }
    workflow = _workflow(graph)
    snippet = SimpleNamespace(
        input_fields_list=[
            {
                "variable": "query",
                "label": "Query",
                "type": "text-input",
                "required": True,
                "max_length": 128,
            }
        ]
    )
    make_transient = Mock()
    monkeypatch.setattr("services.snippet_generate_service.make_transient", make_transient)

    result = SnippetGenerateService._ensure_start_node(workflow, snippet)

    assert result is workflow
    updated_graph = workflow.graph_dict
    assert updated_graph["nodes"][0]["id"] == SNIPPET_VIRTUAL_START_NODE_ID
    assert updated_graph["nodes"][0]["data"]["variables"][0]["max_length"] == 128
    assert updated_graph["edges"][-1]["source"] == SNIPPET_VIRTUAL_START_NODE_ID
    assert updated_graph["edges"][-1]["target"] == "llm-1"
    make_transient.assert_called_once_with(workflow)


def test_parse_files_returns_empty_when_upload_config_disabled(monkeypatch):
    workflow = _workflow({"nodes": [], "edges": []})
    monkeypatch.setattr("services.snippet_generate_service.FileUploadConfigManager.convert", Mock(return_value=None))

    assert SnippetGenerateService.parse_files(workflow, files=[{"id": "file-1"}]) == []


def test_parse_files_delegates_to_file_factory(monkeypatch):
    workflow = _workflow({"nodes": [], "edges": []})
    upload_config = SimpleNamespace(enabled=True)
    files = [SimpleNamespace(id="file-1")]
    monkeypatch.setattr(
        "services.snippet_generate_service.FileUploadConfigManager.convert", Mock(return_value=upload_config)
    )
    build_from_mappings = Mock(return_value=files)
    monkeypatch.setattr("services.snippet_generate_service.file_factory.build_from_mappings", build_from_mappings)

    result = SnippetGenerateService.parse_files(workflow, files=[{"id": "file-1"}])

    assert result == files
    build_from_mappings.assert_called_once()


def test_generate_raises_when_draft_workflow_missing(monkeypatch):
    monkeypatch.setattr(
        "services.snippet_generate_service.SnippetService",
        lambda: SimpleNamespace(get_draft_workflow=Mock(return_value=None)),
    )

    with pytest.raises(ValueError, match="Workflow not initialized"):
        SnippetGenerateService.generate(
            snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
            user=SimpleNamespace(id="user-1"),
            args={"inputs": {}},
            invoke_from="debugger",
        )


def test_run_published_delegates_to_workflow_generator_non_streaming(monkeypatch):
    workflow = _workflow({"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []})
    snippet = SimpleNamespace(id="snippet-1", tenant_id="tenant-1", input_fields_list=[])
    user = SimpleNamespace(id="user-1")
    generator = SimpleNamespace(generate=Mock(return_value={"data": {"outputs": {"answer": "ok"}}}))

    monkeypatch.setattr(
        "services.snippet_generate_service.SnippetService",
        lambda: SimpleNamespace(get_published_workflow=Mock(return_value=workflow)),
    )
    ensure_start_node = Mock(return_value=workflow)
    monkeypatch.setattr(SnippetGenerateService, "_ensure_start_node", ensure_start_node)
    monkeypatch.setattr("services.snippet_generate_service.WorkflowAppGenerator", Mock(return_value=generator))

    result = SnippetGenerateService.run_published(
        snippet=snippet,
        user=user,
        args={"inputs": {"query": "hello"}},
        invoke_from="service-api",
    )

    assert result == {"data": {"outputs": {"answer": "ok"}}}
    ensure_start_node.assert_called_once_with(workflow, snippet)
    generator.generate.assert_called_once()
    kwargs = generator.generate.call_args.kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["streaming"] is False
    assert kwargs["call_depth"] == 0


def test_run_published_raises_when_published_workflow_missing(monkeypatch):
    monkeypatch.setattr(
        "services.snippet_generate_service.SnippetService",
        lambda: SimpleNamespace(get_published_workflow=Mock(return_value=None)),
    )

    with pytest.raises(ValueError, match="No published workflow found"):
        SnippetGenerateService.run_published(
            snippet=SimpleNamespace(id="snippet-1", tenant_id="tenant-1"),
            user=SimpleNamespace(id="user-1"),
            args={"inputs": {}},
            invoke_from="service-api",
        )
