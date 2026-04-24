from types import SimpleNamespace

from core.app.entities.app_invoke_entities import InvokeFrom
from services.snippet_generate_service import SnippetGenerateService


def test_generate_filters_virtual_start_events(monkeypatch) -> None:
    snippet = SimpleNamespace(id="snippet-id", tenant_id="tenant-id")
    user = SimpleNamespace(id="user-id")
    workflow = SimpleNamespace(id="workflow-id")

    monkeypatch.setattr(
        "services.snippet_generate_service.SnippetService",
        lambda: SimpleNamespace(get_draft_workflow=lambda *, snippet: workflow),
    )
    monkeypatch.setattr(
        SnippetGenerateService,
        "_ensure_start_node",
        classmethod(lambda cls, workflow, snippet: workflow),
    )

    stream_messages = iter(
        [
            {"event": "workflow_started", "data": {"id": "run-1"}},
            {
                "event": "node_started",
                "data": {"node_id": SnippetGenerateService._VIRTUAL_START_NODE_ID, "title": "Start"},
            },
            {
                "event": "node_finished",
                "data": {"node_id": SnippetGenerateService._VIRTUAL_START_NODE_ID, "status": "succeeded"},
            },
            {"event": "node_started", "data": {"node_id": "code-node", "title": "Code"}},
            {"event": "node_finished", "data": {"node_id": "code-node", "status": "succeeded"}},
            {"event": "workflow_finished", "data": {"id": "run-1", "status": "succeeded"}},
        ]
    )

    monkeypatch.setattr(
        "services.snippet_generate_service.WorkflowAppGenerator.generate",
        lambda self, **kwargs: stream_messages,
    )
    monkeypatch.setattr(
        "services.snippet_generate_service.WorkflowAppGenerator.convert_to_event_stream",
        lambda generator: list(generator),
    )

    response = SnippetGenerateService.generate(
        snippet=snippet,
        user=user,
        args={"inputs": {}},
        invoke_from=InvokeFrom.DEBUGGER,
        streaming=True,
    )

    assert response == [
        {"event": "workflow_started", "data": {"id": "run-1"}},
        {"event": "node_started", "data": {"node_id": "code-node", "title": "Code"}},
        {"event": "node_finished", "data": {"node_id": "code-node", "status": "succeeded"}},
        {"event": "workflow_finished", "data": {"id": "run-1", "status": "succeeded"}},
    ]


def test_filter_virtual_start_events_returns_blocking_response_unchanged() -> None:
    blocking_response = {"task_id": "task-1", "data": {"status": "succeeded"}}

    assert SnippetGenerateService._filter_virtual_start_events(blocking_response) is blocking_response
