import json
import unittest.mock
from copy import deepcopy

import pytest
from sqlalchemy.orm import Session, sessionmaker

from controllers.console.app.workflow import LoopNodeRunPayload
from core.app.app_config.features.file_upload.manager import FileUploadConfigManager
from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.snippet_start import SNIPPET_VIRTUAL_START_NODE_ID
from graphon.file import FileUploadConfig
from graphon.file.models import File
from graphon.graph import Graph
from graphon.runtime import RuntimeState, VariablePool
from models.account import Account
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionModel
from services.snippet_generate_service import SnippetGenerateService
from services.snippet_service import SnippetService
from services.workflow_service import WorkflowService
from tests.helpers.unit.model_factories import make_account, make_workflow
from tests.workflow_test_utils import build_test_graph_init_params


def _workflow(graph: dict) -> Workflow:
    return make_workflow(workflow_id="workflow-1", app_id="snippet-1", kind=WorkflowKind.SNIPPET, graph=graph)


def _snippet(*, input_fields: list[dict] | None = None) -> CustomizedSnippet:
    return CustomizedSnippet(
        id="snippet-1",
        tenant_id="tenant-1",
        name="Snippet",
        description="",
        type=SnippetType.NODE,
        created_by="account-1",
        input_fields=json.dumps(input_fields) if input_fields else None,
    )


def _account(account_id: str = "user-1") -> Account:
    return make_account(account_id=account_id, name="Test User", email=f"{account_id}@example.com")


def _set_draft_workflow(
    monkeypatch: pytest.MonkeyPatch,
    workflow: Workflow | None,
) -> None:
    def get_draft_workflow(_self, *, snippet):
        _ = snippet
        return workflow

    monkeypatch.setattr(SnippetService, "get_draft_workflow", get_draft_workflow)


def _set_published_workflow(
    monkeypatch: pytest.MonkeyPatch,
    workflow: Workflow | None,
) -> None:
    monkeypatch.setattr(SnippetService, "get_published_workflow", lambda _self, _snippet: workflow)


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
    snippet = _snippet()

    result = SnippetGenerateService._ensure_start_node(workflow, snippet)

    assert result is workflow


def test_ensure_start_node_injects_virtual_start_for_root_candidates(monkeypatch: pytest.MonkeyPatch):
    graph = {
        "nodes": [
            {"id": "llm-1", "data": {"type": "llm"}},
            {"id": "answer-1", "data": {"type": "answer"}},
        ],
        "edges": [{"source": "llm-1", "target": "answer-1"}],
    }
    workflow = _workflow(graph)
    snippet = _snippet(
        input_fields=[
            {
                "variable": "query",
                "label": "Query",
                "type": "text-input",
                "required": True,
                "max_length": 128,
            }
        ]
    )
    make_transient = unittest.mock.Mock()
    monkeypatch.setattr("services.snippet_generate_service.make_transient", make_transient)

    result = SnippetGenerateService._ensure_start_node(workflow, snippet)

    assert result is workflow
    updated_graph = workflow.graph_dict
    assert updated_graph["nodes"][0]["id"] == SNIPPET_VIRTUAL_START_NODE_ID
    assert updated_graph["nodes"][0]["data"]["variables"][0]["max_length"] == 128
    assert updated_graph["edges"][-1]["source"] == SNIPPET_VIRTUAL_START_NODE_ID
    assert updated_graph["edges"][-1]["target"] == "llm-1"
    make_transient.assert_called_once_with(workflow)


def _nested_snippet_graph(ownership: str, outer_type: str) -> dict:
    inner_type = "iteration" if outer_type == "loop" else "loop"
    nodes = []
    for node_id, node_type in (("outer", outer_type), ("inner", inner_type)):
        data = {"type": node_type, "title": node_id, "start_node_id": f"{node_id}-start"}
        if node_type == "loop":
            data.update(loop_count=1, break_conditions=[], logical_operator="and")
        else:
            data.update(iterator_selector=["input", "items"], output_selector=[node_id, "item"])
        nodes.extend(
            [
                {"id": node_id, "data": data},
                {"id": f"{node_id}-start", "data": {"type": f"{node_type}-start", "title": "Container start"}},
            ]
        )
    nodes.append({"id": "output", "data": {"type": "end", "title": "Output", "outputs": []}})
    owners = {"outer-start": "outer", "inner": "outer", "inner-start": "inner"}
    for node in nodes:
        owner = owners.get(node["id"], "")
        if ownership == "canonical":
            node["data"]["container_id"] = owner
            node["parentId"] = "stale-parent"
            node["data"].update(iteration_id="stale-iteration", loop_id="stale-loop")
        elif ownership == "parent":
            if owner:
                node["parentId"] = owner
        elif owner:
            node["data"][f"{outer_type}_id"] = "outer"
            if owner == "inner":
                node["data"][f"{inner_type}_id"] = "inner"
    return {
        "nodes": nodes,
        "edges": [{"source": "outer", "target": "output"}, {"source": "outer-start", "target": "inner"}],
    }


@pytest.mark.parametrize("ownership", ["canonical", "parent", "legacy"])
@pytest.mark.parametrize("outer_type", ["iteration", "loop"])
def test_virtual_start_preserves_nested_container_graphs(ownership: str, outer_type: str) -> None:
    graph_config = _nested_snippet_graph(ownership, outer_type)
    original = deepcopy(graph_config)

    injected = SnippetGenerateService._inject_virtual_start_node(graph_config, [])

    assert [edge["target"] for edge in injected["edges"] if edge["source"] == SNIPPET_VIRTUAL_START_NODE_ID] == [
        "outer"
    ]
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(graph_config=injected),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0),
    )
    graph = Graph.init(graph_config=injected, node_factory=factory, root_node_id=SNIPPET_VIRTUAL_START_NODE_ID)
    assert set(graph.nodes) == {SNIPPET_VIRTUAL_START_NODE_ID, "outer", "output"}
    for container_id, expected in (("outer", {"outer-start", "inner"}), ("inner", {"inner-start"})):
        graph = Graph.init(
            graph_config=graph.graph_config,
            node_factory=graph.node_factory,
            root_node_id=f"{container_id}-start",
            container_id=container_id,
        )
        assert set(graph.nodes) == expected
    assert graph_config == original


def test_virtual_start_connects_all_flat_roots_without_changing_the_input() -> None:
    graph_config = {
        "nodes": [{"id": node_id, "data": {"type": "end"}} for node_id in ("first", "second", "downstream")],
        "edges": [{"source": "first", "target": "downstream"}],
    }
    original = deepcopy(graph_config)

    injected = SnippetGenerateService._inject_virtual_start_node(graph_config, [])

    assert [edge["target"] for edge in injected["edges"] if edge["source"] == SNIPPET_VIRTUAL_START_NODE_ID] == [
        "first",
        "second",
    ]
    assert graph_config == original


def test_virtual_start_does_not_promote_disconnected_owned_nodes() -> None:
    graph_config = _nested_snippet_graph("canonical", "loop")
    graph_config["nodes"].append({"id": "detached", "data": {"type": "end", "container_id": "inner"}})

    injected = SnippetGenerateService._inject_virtual_start_node(graph_config, [])

    assert [edge["target"] for edge in injected["edges"] if edge["source"] == SNIPPET_VIRTUAL_START_NODE_ID] == [
        "outer"
    ]


def test_virtual_start_keeps_missing_container_ownership_invalid() -> None:
    graph_config = _nested_snippet_graph("legacy", "loop")
    nodes = {node["id"]: node for node in graph_config["nodes"]}
    nodes["inner-start"]["data"]["container_id"] = "missing-container"
    original = deepcopy(graph_config)

    injected = SnippetGenerateService._inject_virtual_start_node(graph_config, [])

    assert not any(
        edge["source"] == SNIPPET_VIRTUAL_START_NODE_ID and edge["target"] == "inner-start"
        for edge in injected["edges"]
    )
    factory = DifyNodeFactory(
        init_params=build_test_graph_init_params(graph_config=injected),
        runtime_state=RuntimeState(workflow_id="workflow", variable_pool=VariablePool(), start_at=0.0),
    )
    with pytest.raises(ValueError, match="unknown or cyclic containers"):
        Graph.init(graph_config=injected, node_factory=factory, root_node_id=SNIPPET_VIRTUAL_START_NODE_ID)
    assert graph_config == original


def test_virtual_start_rejects_ambiguous_legacy_container_ownership() -> None:
    graph_config = _nested_snippet_graph("legacy", "loop")
    nodes = {node["id"]: node for node in graph_config["nodes"]}
    del nodes["inner"]["data"]["loop_id"]
    original = deepcopy(graph_config)

    with pytest.raises(ValueError, match="ambiguous legacy container owners"):
        SnippetGenerateService._inject_virtual_start_node(graph_config, [])
    assert graph_config == original


def test_parse_files_returns_empty_when_upload_config_disabled(monkeypatch: pytest.MonkeyPatch):
    workflow = _workflow({"nodes": [], "edges": []})

    def convert(_config, is_vision):
        _ = is_vision

    monkeypatch.setattr(FileUploadConfigManager, "convert", convert)

    assert SnippetGenerateService.parse_files(workflow, files=[{"id": "file-1"}]) == []


def test_parse_files_delegates_to_file_factory(monkeypatch: pytest.MonkeyPatch):
    workflow = _workflow({"nodes": [], "edges": []})
    upload_config = FileUploadConfig()
    files = [File.model_construct(id="file-1")]

    def convert(_config, is_vision):
        _ = is_vision
        return upload_config

    monkeypatch.setattr(FileUploadConfigManager, "convert", convert)
    captured: dict[str, object] = {}

    def build_from_mappings(**kwargs):
        captured.update(kwargs)
        return files

    monkeypatch.setattr("services.snippet_generate_service.file_factory.build_from_mappings", build_from_mappings)

    result = SnippetGenerateService.parse_files(workflow, files=[{"id": "file-1"}])

    assert result == files
    assert captured["tenant_id"] == workflow.tenant_id
    assert captured["config"] is upload_config


def test_generate_raises_when_draft_workflow_missing(
    monkeypatch: pytest.MonkeyPatch,
    unbound_session_factory: sessionmaker[Session],
):
    _set_draft_workflow(monkeypatch, None)

    with pytest.raises(ValueError, match="Workflow not initialized"):
        SnippetGenerateService.generate(
            snippet=_snippet(),
            user=_account(),
            args={"inputs": {}},
            invoke_from="debugger",
            session_maker=unbound_session_factory,
        )


def test_generate_delegates_to_workflow_generator_and_filters_stream(
    monkeypatch: pytest.MonkeyPatch,
    unbound_session_factory: sessionmaker[Session],
):
    workflow = _workflow({"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []})
    snippet = _snippet()
    user = _account()
    raw_stream = iter(
        [
            {"event": "node_started", "data": {"node_id": SNIPPET_VIRTUAL_START_NODE_ID}},
            {"event": "node_finished", "data": {"node_id": "llm-1"}},
        ]
    )
    generate_kwargs: dict[str, object] = {}
    ensure_calls: list[tuple[Workflow, CustomizedSnippet]] = []
    converted: list[object] = []

    def generate(_self, **kwargs):
        generate_kwargs.update(kwargs)
        return raw_stream

    def ensure_start_node(_cls, current_workflow, current_snippet):
        ensure_calls.append((current_workflow, current_snippet))
        return current_workflow

    def convert_to_event_stream(response):
        converted.append(response)
        return response

    _set_draft_workflow(monkeypatch, workflow)
    monkeypatch.setattr(WorkflowAppGenerator, "generate", generate)
    monkeypatch.setattr(WorkflowAppGenerator, "convert_to_event_stream", staticmethod(convert_to_event_stream))
    monkeypatch.setattr(SnippetGenerateService, "_ensure_start_node", classmethod(ensure_start_node))

    result = SnippetGenerateService.generate(
        snippet=snippet,
        user=user,
        args={"inputs": {"query": "hello"}},
        invoke_from="debugger",
        session_maker=unbound_session_factory,
    )

    assert list(result) == [{"event": "node_finished", "data": {"node_id": "llm-1"}}]
    assert ensure_calls == [(workflow, snippet)]
    kwargs = generate_kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["workflow"] is workflow
    assert kwargs["user"] is user
    assert kwargs["streaming"] is True
    assert kwargs["call_depth"] == 0
    assert len(converted) == 1


def test_run_published_delegates_to_workflow_generator_non_streaming(
    monkeypatch: pytest.MonkeyPatch,
    unbound_session_factory: sessionmaker[Session],
):
    workflow = _workflow({"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []})
    snippet = _snippet()
    user = _account()
    generate_kwargs: dict[str, object] = {}
    ensure_calls: list[tuple[Workflow, CustomizedSnippet]] = []

    def generate(_self, **kwargs):
        generate_kwargs.update(kwargs)
        return {"data": {"outputs": {"answer": "ok"}}}

    def ensure_start_node(_cls, current_workflow, current_snippet):
        ensure_calls.append((current_workflow, current_snippet))
        return current_workflow

    _set_published_workflow(monkeypatch, workflow)
    monkeypatch.setattr(WorkflowAppGenerator, "generate", generate)
    monkeypatch.setattr(SnippetGenerateService, "_ensure_start_node", classmethod(ensure_start_node))

    result = SnippetGenerateService.run_published(
        snippet=snippet,
        user=user,
        args={"inputs": {"query": "hello"}},
        invoke_from="service-api",
        session_maker=unbound_session_factory,
    )

    assert result == {"data": {"outputs": {"answer": "ok"}}}
    assert ensure_calls == [(workflow, snippet)]
    kwargs = generate_kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["streaming"] is False
    assert kwargs["call_depth"] == 0


def test_ensure_start_node_for_worker_delegates(monkeypatch: pytest.MonkeyPatch):
    workflow = _workflow({"nodes": [], "edges": []})
    snippet = _snippet()
    ensure_calls: list[tuple[Workflow, CustomizedSnippet]] = []

    def ensure_start_node(_cls, current_workflow, current_snippet):
        ensure_calls.append((current_workflow, current_snippet))
        return current_workflow

    monkeypatch.setattr(SnippetGenerateService, "_ensure_start_node", classmethod(ensure_start_node))

    result = SnippetGenerateService.ensure_start_node_for_worker(workflow, snippet)

    assert result is workflow
    assert ensure_calls == [(workflow, snippet)]


def test_run_draft_node_delegates_to_workflow_service(
    monkeypatch: pytest.MonkeyPatch,
    unbound_session_factory: sessionmaker[Session],
):
    workflow = _workflow({"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []})
    snippet = _snippet()
    account = _account("account-1")
    execution = WorkflowNodeExecutionModel(id="execution-1")
    run_kwargs: dict[str, object] = {}

    def run_draft_workflow_node(_self, **kwargs):
        run_kwargs.update(kwargs)
        return execution

    workflow_service = WorkflowService(unbound_session_factory)
    _set_draft_workflow(monkeypatch, workflow)
    monkeypatch.setattr(WorkflowService, "run_draft_workflow_node", run_draft_workflow_node)
    monkeypatch.setattr("services.snippet_generate_service.WorkflowService", lambda: workflow_service)

    result = SnippetGenerateService.run_draft_node(
        snippet=snippet,
        node_id="llm-1",
        user_inputs={"query": "hello"},
        account=account,
        query="question",
        files=[],
        session_maker=unbound_session_factory,
    )

    assert result is execution
    kwargs = run_kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["draft_workflow"] is workflow
    assert kwargs["node_id"] == "llm-1"
    assert kwargs["user_inputs"] == {"query": "hello"}
    assert kwargs["account"] is account
    assert kwargs["query"] == "question"
    assert kwargs["files"] == []


def test_run_draft_node_raises_when_draft_workflow_missing(
    monkeypatch: pytest.MonkeyPatch,
    unbound_session_factory: sessionmaker[Session],
):
    _set_draft_workflow(monkeypatch, None)

    with pytest.raises(ValueError, match="Workflow not initialized"):
        SnippetGenerateService.run_draft_node(
            snippet=_snippet(),
            node_id="llm-1",
            user_inputs={},
            account=_account("account-1"),
            session_maker=unbound_session_factory,
        )


def test_generate_single_iteration_delegates_to_workflow_generator(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workflow = _workflow({"nodes": [{"id": "iteration-1", "data": {"type": "iteration"}}], "edges": []})
    snippet = _snippet()
    user = _account()
    response = iter(["event"])
    generate_kwargs: dict[str, object] = {}
    converted: list[object] = []

    def single_iteration_generate(_self, **kwargs):
        generate_kwargs.update(kwargs)
        return response

    def convert_to_event_stream(item):
        converted.append(item)
        return item

    _set_draft_workflow(monkeypatch, workflow)
    monkeypatch.setattr(WorkflowAppGenerator, "single_iteration_generate", single_iteration_generate)
    monkeypatch.setattr(WorkflowAppGenerator, "convert_to_event_stream", staticmethod(convert_to_event_stream))

    result = SnippetGenerateService.generate_single_iteration(
        snippet=snippet,
        user=user,
        node_id="iteration-1",
        args={"inputs": {"items": [1]}},
        session_maker=sqlite_session_factory,
    )

    assert list(result) == ["event"]
    kwargs = generate_kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["workflow"] is workflow
    assert kwargs["node_id"] == "iteration-1"
    assert kwargs["user"] is user
    assert kwargs["streaming"] is True
    assert isinstance(kwargs["session"], Session)
    assert converted == [response]


def test_generate_single_iteration_raises_when_draft_workflow_missing(
    monkeypatch: pytest.MonkeyPatch, unbound_session_factory: sessionmaker[Session]
):
    _set_draft_workflow(monkeypatch, None)

    with pytest.raises(ValueError, match="Workflow not initialized"):
        SnippetGenerateService.generate_single_iteration(
            snippet=_snippet(),
            user=_account(),
            node_id="iteration-1",
            args={"inputs": {}},
            session_maker=unbound_session_factory,
        )


def test_generate_single_loop_delegates_to_workflow_generator(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workflow = _workflow({"nodes": [{"id": "loop-1", "data": {"type": "loop"}}], "edges": []})
    snippet = _snippet()
    user = _account()
    response = iter(["event"])
    generate_kwargs: dict[str, object] = {}
    converted: list[object] = []

    def single_loop_generate(_self, **kwargs):
        generate_kwargs.update(kwargs)
        return response

    def convert_to_event_stream(item):
        converted.append(item)
        return item

    _set_draft_workflow(monkeypatch, workflow)
    monkeypatch.setattr(WorkflowAppGenerator, "single_loop_generate", single_loop_generate)
    monkeypatch.setattr(WorkflowAppGenerator, "convert_to_event_stream", staticmethod(convert_to_event_stream))

    result = SnippetGenerateService.generate_single_loop(
        snippet=snippet,
        user=user,
        node_id="loop-1",
        args=LoopNodeRunPayload(inputs={"items": [1]}),
        session_maker=sqlite_session_factory,
    )

    assert list(result) == ["event"]
    kwargs = generate_kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["workflow"] is workflow
    assert kwargs["node_id"] == "loop-1"
    assert kwargs["user"] is user
    assert kwargs["streaming"] is True
    assert isinstance(kwargs["session"], Session)
    assert converted == [response]


def test_generate_single_loop_raises_when_draft_workflow_missing(
    monkeypatch: pytest.MonkeyPatch, unbound_session_factory: sessionmaker[Session]
):
    _set_draft_workflow(monkeypatch, None)

    with pytest.raises(ValueError, match="Workflow not initialized"):
        SnippetGenerateService.generate_single_loop(
            snippet=_snippet(),
            user=_account(),
            node_id="loop-1",
            args=LoopNodeRunPayload(inputs={}),
            session_maker=unbound_session_factory,
        )


def test_run_published_raises_when_published_workflow_missing(
    monkeypatch: pytest.MonkeyPatch,
    unbound_session_factory: sessionmaker[Session],
):
    _set_published_workflow(monkeypatch, None)

    with pytest.raises(ValueError, match="No published workflow found"):
        SnippetGenerateService.run_published(
            snippet=_snippet(),
            user=_account(),
            args={"inputs": {}},
            invoke_from="service-api",
            session_maker=unbound_session_factory,
        )
