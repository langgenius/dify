import json
from types import SimpleNamespace
from unittest.mock import Mock, create_autospec

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.snippet_start import SNIPPET_VIRTUAL_START_NODE_ID
from models.account import Account
from models.snippet import CustomizedSnippet, SnippetType
from models.workflow import Workflow, WorkflowKind, WorkflowNodeExecutionModel
from services.snippet_generate_service import SnippetGenerateService
from services.workflow.execution.ports import WorkflowRuntime
from services.workflow.variable_contracts import WorkflowExecutionVariables
from services.workflow_service import WorkflowService
from tests.unit_tests.model_factories import make_account, make_workflow


class SnippetReader:
    workflow: Workflow | None = None

    def get_draft_workflow(self, snippet: CustomizedSnippet) -> Workflow | None:
        assert snippet.id == "snippet-1"
        return self.workflow


@pytest.fixture
def snippet_reader() -> SnippetReader:
    return SnippetReader()


@pytest.fixture
def generation(
    snippet_reader: SnippetReader,
    workflow_variables: WorkflowExecutionVariables,
    sqlite_session_factory: sessionmaker[Session],
    *,
    workflow_runtime: WorkflowRuntime,
) -> SnippetGenerateService:
    return SnippetGenerateService(
        snippets=snippet_reader,
        variables=workflow_variables,
        workflows=WorkflowService(sqlite_session_factory),
        runtime=workflow_runtime,
    )


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


@pytest.mark.parametrize("entry", ["generate", "iteration", "loop"])
def test_debug_generators_use_injected_variable_dependencies(
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
    workflow_variables: WorkflowExecutionVariables,
    monkeypatch: pytest.MonkeyPatch,
    entry: str,
) -> None:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from graphon.enums import BuiltinNodeTypes
    from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator

    workflow = _workflow({"nodes": [{"id": "start", "data": {"type": "start"}}], "edges": []})
    snippet_reader.workflow = workflow
    user = _account()
    calls: list[str] = []

    def execute(generator: WorkflowAppGenerator, **_kwargs: object) -> dict[str, str]:
        assert generator._draft_variable_loader == workflow_variables.workflow_loader
        assert generator._draft_variable_saver == workflow_variables.saver_factory
        saver = generator._get_draft_var_saver_factory(InvokeFrom.DEBUGGER, user, tenant_id=workflow.tenant_id)
        saver(workflow.app_id, "node", BuiltinNodeTypes.CODE, "execution").save(
            process_data=None, outputs={"text": "injected"}
        )
        loader = workflow_variables.workflow_loader(workflow, user.id)
        assert loader.load_variables([["node", "text"]])[0].value == "injected"
        calls.append(entry)
        return {"result": "ready"}

    method = {"generate": "generate", "iteration": "single_iteration_generate", "loop": "single_loop_generate"}[entry]
    monkeypatch.setattr(WorkflowAppGenerator, method, execute)
    if entry == "generate":
        result = generation.generate(_snippet(), user, {}, InvokeFrom.DEBUGGER, streaming=False)
    elif entry == "iteration":
        result = generation.generate_single_iteration(_snippet(), user, "node", {}, streaming=False)
    else:
        result = generation.generate_single_loop(_snippet(), user, "node", {}, streaming=False)
    assert result == {"result": "ready"}
    assert calls == [entry]


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


def test_parse_files_returns_empty_when_upload_config_disabled(monkeypatch: pytest.MonkeyPatch):
    workflow = _workflow({"nodes": [], "edges": []})
    monkeypatch.setattr("services.snippet_generate_service.FileUploadConfigManager.convert", Mock(return_value=None))

    assert SnippetGenerateService.parse_files(workflow, files=[{"id": "file-1"}]) == []


def test_parse_files_delegates_to_file_factory(monkeypatch: pytest.MonkeyPatch):
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


def test_generate_raises_when_draft_workflow_missing(
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
):
    snippet_reader.workflow = None

    with pytest.raises(ValueError, match="Workflow not initialized"):
        generation.generate(
            snippet=_snippet(),
            user=_account(),
            args={"inputs": {}},
            invoke_from="debugger",
        )


def test_generate_delegates_to_workflow_generator_and_filters_stream(
    monkeypatch: pytest.MonkeyPatch,
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
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
    generator = SimpleNamespace(generate=Mock(return_value=raw_stream))
    workflow_generator_class = Mock(return_value=generator)
    workflow_generator_class.convert_to_event_stream = Mock(side_effect=lambda response: response)

    snippet_reader.workflow = workflow
    ensure_start_node = Mock(return_value=workflow)
    monkeypatch.setattr(SnippetGenerateService, "_ensure_start_node", ensure_start_node)
    monkeypatch.setattr("services.snippet_generate_service.WorkflowAppGenerator", workflow_generator_class)

    result = generation.generate(
        snippet=snippet,
        user=user,
        args={"inputs": {"query": "hello"}},
        invoke_from="debugger",
    )

    assert [json.loads(event.removeprefix("data: ")) for event in result] == [
        {"event": "node_finished", "data": {"node_id": "llm-1"}}
    ]
    ensure_start_node.assert_called_once_with(workflow, snippet)
    generator.generate.assert_called_once()
    kwargs = generator.generate.call_args.kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["workflow"] is workflow
    assert kwargs["user"] is user
    assert kwargs["streaming"] is True
    assert kwargs["call_depth"] == 0


def test_run_draft_node_delegates_to_workflow_service(
    *,
    workflow_variables: WorkflowExecutionVariables,
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
):
    workflow = _workflow({"nodes": [{"id": "llm-1", "data": {"type": "llm"}}], "edges": []})
    snippet = _snippet()
    account = _account("account-1")
    execution = WorkflowNodeExecutionModel(id="execution-1")
    workflow_service = create_autospec(WorkflowService, instance=True, spec_set=True)
    workflow_service.run_draft_workflow_node.return_value = execution

    snippet_reader.workflow = workflow
    generation._workflows = workflow_service

    result = generation.run_draft_node(
        snippet=snippet,
        node_id="llm-1",
        user_inputs={"query": "hello"},
        account=account,
        query="question",
        files=[],
    )

    assert result is execution
    workflow_service.run_draft_workflow_node.assert_called_once()
    kwargs = workflow_service.run_draft_workflow_node.call_args.kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["draft_workflow"] is workflow
    assert kwargs["node_id"] == "llm-1"
    assert kwargs["user_inputs"] == {"query": "hello"}
    assert kwargs["account"] is account
    assert kwargs["query"] == "question"
    assert kwargs["files"] == []
    assert kwargs["variables"] is workflow_variables


def test_run_draft_node_raises_when_draft_workflow_missing(
    *,
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
):
    snippet_reader.workflow = None

    with pytest.raises(ValueError, match="Workflow not initialized"):
        generation.run_draft_node(
            snippet=_snippet(),
            node_id="llm-1",
            user_inputs={},
            account=_account("account-1"),
        )


def test_generate_single_iteration_delegates_to_workflow_generator(
    monkeypatch: pytest.MonkeyPatch,
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
) -> None:
    workflow = _workflow({"nodes": [{"id": "iteration-1", "data": {"type": "iteration"}}], "edges": []})
    snippet = _snippet()
    user = _account()
    response = iter(["event"])
    generator = SimpleNamespace(single_iteration_generate=Mock(return_value=response))
    workflow_generator_class = Mock(return_value=generator)
    workflow_generator_class.convert_to_event_stream = Mock(side_effect=lambda item: item)

    snippet_reader.workflow = workflow
    monkeypatch.setattr("services.snippet_generate_service.WorkflowAppGenerator", workflow_generator_class)

    result = generation.generate_single_iteration(
        snippet=snippet,
        user=user,
        node_id="iteration-1",
        args={"inputs": {"items": [1]}},
    )

    assert list(result) == ["event: event\n\n"]
    generator.single_iteration_generate.assert_called_once()
    kwargs = generator.single_iteration_generate.call_args.kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["workflow"] is workflow
    assert kwargs["node_id"] == "iteration-1"
    assert kwargs["user"] is user
    assert kwargs["streaming"] is True
    assert "session" not in kwargs


def test_generate_single_iteration_raises_when_draft_workflow_missing(
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
):
    snippet_reader.workflow = None

    with pytest.raises(ValueError, match="Workflow not initialized"):
        generation.generate_single_iteration(
            snippet=_snippet(),
            user=_account(),
            node_id="iteration-1",
            args={"inputs": {}},
        )


def test_generate_single_loop_delegates_to_workflow_generator(
    monkeypatch: pytest.MonkeyPatch,
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
) -> None:
    workflow = _workflow({"nodes": [{"id": "loop-1", "data": {"type": "loop"}}], "edges": []})
    snippet = _snippet()
    user = _account()
    response = iter(["event"])
    generator = SimpleNamespace(single_loop_generate=Mock(return_value=response))
    workflow_generator_class = Mock(return_value=generator)
    workflow_generator_class.convert_to_event_stream = Mock(side_effect=lambda item: item)

    snippet_reader.workflow = workflow
    monkeypatch.setattr("services.snippet_generate_service.WorkflowAppGenerator", workflow_generator_class)

    result = generation.generate_single_loop(
        snippet=snippet,
        user=user,
        node_id="loop-1",
        args={"inputs": {"items": [1]}},
    )

    assert list(result) == ["event: event\n\n"]
    generator.single_loop_generate.assert_called_once()
    kwargs = generator.single_loop_generate.call_args.kwargs
    assert kwargs["app_model"].id == "snippet-1"
    assert kwargs["workflow"] is workflow
    assert kwargs["node_id"] == "loop-1"
    assert kwargs["user"] is user
    assert kwargs["streaming"] is True
    assert "session" not in kwargs


def test_generate_single_loop_raises_when_draft_workflow_missing(
    generation: SnippetGenerateService,
    snippet_reader: SnippetReader,
):
    snippet_reader.workflow = None

    with pytest.raises(ValueError, match="Workflow not initialized"):
        generation.generate_single_loop(
            snippet=_snippet(),
            user=_account(),
            node_id="loop-1",
            args={"inputs": {}},
        )
