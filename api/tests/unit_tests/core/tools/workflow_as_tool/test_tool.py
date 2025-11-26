from unittest.mock import Mock

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import StreamEvent
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.workflow_as_tool.tool import WorkflowTool


def _build_tool(monkeypatch: pytest.MonkeyPatch) -> WorkflowTool:
    entity = ToolEntity(
        identity=ToolIdentity(author="test", name="test tool", label=I18nObject(en_US="test tool"), provider="test"),
        parameters=[],
        description=None,
        has_runtime_parameters=False,
    )
    runtime = ToolRuntime(tenant_id="test_tool", invoke_from=InvokeFrom.EXPLORE)
    tool = WorkflowTool(
        workflow_app_id="",
        workflow_as_tool_id="",
        version="1",
        workflow_entities={},
        workflow_call_depth=1,
        entity=entity,
        runtime=runtime,
    )

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)
    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)
    return tool


def test_workflow_tool_should_raise_tool_invoke_error_when_result_has_error_field(monkeypatch: pytest.MonkeyPatch):
    """Ensure that WorkflowTool will throw a `ToolInvokeError` exception when
    `WorkflowAppGenerator.generate` returns a result with `error` key inside
    the `data` element.
    """
    tool = _build_tool(monkeypatch)
    # replace `WorkflowAppGenerator.generate` 's return value.
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate",
        lambda *args, **kwargs: {"data": {"error": "oops"}},
    )

    with pytest.raises(ToolInvokeError) as exc_info:
        # WorkflowTool always returns a generator, so we need to iterate to
        # actually `run` the tool.
        list(tool.invoke("test_user", {}))
    assert exc_info.value.args == ("oops",)


def test_workflow_tool_streams_events(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool(monkeypatch)

    def _generator(*args, **kwargs):
        def _iter():
            yield {
                "event": StreamEvent.NODE_STARTED.value,
                "workflow_run_id": "run",
                "data": {"id": "node-1"},
            }
            yield {
                "event": StreamEvent.TEXT_CHUNK.value,
                "workflow_run_id": "run",
                "data": {"text": "partial"},
            }
            yield {
                "event": StreamEvent.MESSAGE_FILE.value,
                "workflow_run_id": "run",
                "url": "https://example/file",
                "type": "image/png",
                "belongs_to": "assistant",
            }
            yield {
                "event": StreamEvent.WORKFLOW_FINISHED.value,
                "workflow_run_id": "run",
                "data": {"outputs": {"answer": "done", "extra": 1}, "error": None},
            }

        return _iter()

    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", _generator)

    messages = list(tool.invoke("test_user", {}))

    text_messages = [msg.message.text for msg in messages if msg.type == ToolInvokeMessage.MessageType.TEXT]
    assert text_messages == ["partial"]

    json_messages = [msg.message.json_object for msg in messages if msg.type == ToolInvokeMessage.MessageType.JSON]
    assert json_messages == [{"answer": "done", "extra": 1}]

    link_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.LINK]
    assert len(link_messages) == 1
    meta = link_messages[0].meta
    assert meta is not None
    assert meta["event"] == StreamEvent.MESSAGE_FILE.value


def test_workflow_tool_streams_non_answer_chunks(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool(monkeypatch)

    def _generator(*args, **kwargs):
        def _iter():
            yield {
                "event": StreamEvent.TEXT_CHUNK.value,
                "workflow_run_id": "run",
                "data": {"text": "code output", "from_variable_selector": ["node", "text"]},
            }
            yield {
                "event": StreamEvent.WORKFLOW_FINISHED.value,
                "workflow_run_id": "run",
                "data": {"outputs": {"answer": "final answer"}},
            }

        return _iter()

    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", _generator)

    messages = list(tool.invoke("test_user", {}))
    text_messages = [msg.message.text for msg in messages if msg.type == ToolInvokeMessage.MessageType.TEXT]
    assert text_messages == ["code output"]

    json_messages = [msg.message.json_object for msg in messages if msg.type == ToolInvokeMessage.MessageType.JSON]
    assert json_messages == [{"answer": "final answer"}]


def test_workflow_tool_streaming_error_event(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool(monkeypatch)

    def _generator(*args, **kwargs):
        def _iter():
            yield {"event": StreamEvent.ERROR.value, "message": "stream exploded"}

        return _iter()

    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", _generator)

    with pytest.raises(ToolInvokeError) as exc_info:
        list(tool.invoke("test_user", {}))

    assert "stream exploded" in str(exc_info.value)


def test_workflow_tool_blocks_when_streaming_not_supported(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool(monkeypatch)

    captured_kwargs = {}

    def _blocking_generate(*args, **kwargs):
        captured_kwargs.update(kwargs)
        return {"data": {"outputs": {"answer": "final"}, "error": None}}

    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", _blocking_generate)
    monkeypatch.setattr(tool, "_workflow_supports_streaming", lambda workflow: False)

    messages = list(tool.invoke("test_user", {}))

    assert captured_kwargs.get("streaming") is False
    text_messages = [msg.message.text for msg in messages if msg.type == ToolInvokeMessage.MessageType.TEXT]
    assert text_messages == ["final"]
    json_messages = [msg.message.json_object for msg in messages if msg.type == ToolInvokeMessage.MessageType.JSON]
    assert json_messages == [{"answer": "final"}]
