"""Unit tests for workflow-as-tool behavior.

StubSession/StubScalars emulate SQLAlchemy session/scalars with minimal methods
(`scalar`, `scalars`, `expunge`, `commit`, `refresh`, context manager) to keep
database access mocked and predictable in tests.
"""

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolParameter,
    ToolProviderType,
)
from core.tools.errors import ToolInvokeError
from core.tools.workflow_as_tool.tool import WorkflowTool
from core.workflow.file import FILE_MODEL_IDENTITY


class StubScalars:
    def __init__(self, value: Any) -> None:
        self._value = value

    def first(self) -> Any:
        return self._value


class StubSession:
    def __init__(self, *, scalar_results: list[Any] | None = None, scalars_results: list[Any] | None = None) -> None:
        self.scalar_results = list(scalar_results or [])
        self.scalars_results = list(scalars_results or [])
        self.expunge_calls: list[object] = []

    def scalar(self, _stmt: Any) -> Any:
        return self.scalar_results.pop(0)

    def scalars(self, _stmt: Any) -> StubScalars:
        return StubScalars(self.scalars_results.pop(0))

    def expunge(self, value: Any) -> None:
        self.expunge_calls.append(value)

    def begin(self) -> "StubSession":
        return self

    def commit(self) -> None:
        pass

    def refresh(self, _value: Any) -> None:
        pass

    def close(self) -> None:
        pass

    def __enter__(self) -> "StubSession":
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        return False


def _build_tool() -> WorkflowTool:
    entity = ToolEntity(
        identity=ToolIdentity(author="test", name="test tool", label=I18nObject(en_US="test tool"), provider="test"),
        parameters=[],
        description=None,
        has_runtime_parameters=False,
    )
    runtime = ToolRuntime(tenant_id="test_tool", invoke_from=InvokeFrom.EXPLORE)
    return WorkflowTool(
        workflow_app_id="app-1",
        workflow_as_tool_id="wf-tool-1",
        version="1",
        workflow_entities={},
        workflow_call_depth=1,
        entity=entity,
        runtime=runtime,
    )


def test_workflow_tool_should_raise_tool_invoke_error_when_result_has_error_field(monkeypatch: pytest.MonkeyPatch):
    """Ensure that WorkflowTool will throw a `ToolInvokeError` exception when
    `WorkflowAppGenerator.generate` returns a result with `error` key inside
    the `data` element.
    """
    tool = _build_tool()

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Mock user resolution to avoid database access
    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

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


def test_workflow_tool_does_not_use_pause_state_config(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool()

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke("test_user", {}))

    call_kwargs = generate_mock.call_args.kwargs
    assert "pause_state_config" in call_kwargs
    assert call_kwargs["pause_state_config"] is None


def test_workflow_tool_should_generate_variable_messages_for_outputs(monkeypatch: pytest.MonkeyPatch):
    """Test that WorkflowTool should generate variable messages when there are outputs"""
    tool = _build_tool()

    # Mock workflow outputs
    mock_outputs = {"result": "success", "count": 42, "data": {"key": "value"}}

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Mock user resolution to avoid database access
    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    # replace `WorkflowAppGenerator.generate` 's return value.
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate",
        lambda *args, **kwargs: {"data": {"outputs": mock_outputs}},
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    # Execute tool invocation
    messages = list(tool.invoke("test_user", {}))

    # Verify variable messages
    variable_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.VARIABLE]
    assert len(variable_messages) == 3

    # Verify content of each variable message
    variable_dict = {msg.message.variable_name: msg.message.variable_value for msg in variable_messages}
    assert variable_dict["result"] == "success"
    assert variable_dict["count"] == 42
    assert variable_dict["data"] == {"key": "value"}

    # Verify text message
    text_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.TEXT]
    assert len(text_messages) == 1
    assert json.loads(text_messages[0].message.text) == mock_outputs

    # Verify JSON message
    json_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.JSON]
    assert len(json_messages) == 1
    assert json_messages[0].message.json_object == mock_outputs


def test_workflow_tool_should_handle_empty_outputs(monkeypatch: pytest.MonkeyPatch):
    """Test that WorkflowTool should handle empty outputs correctly"""
    tool = _build_tool()

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Mock user resolution to avoid database access
    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    # replace `WorkflowAppGenerator.generate` 's return value.
    monkeypatch.setattr(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate",
        lambda *args, **kwargs: {"data": {}},
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    # Execute tool invocation
    messages = list(tool.invoke("test_user", {}))

    # Verify generated messages
    # Should contain: 0 variable messages + 1 text message + 1 JSON message = 2 messages
    assert len(messages) == 2

    # Verify no variable messages
    variable_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.VARIABLE]
    assert len(variable_messages) == 0

    # Verify text message
    text_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.TEXT]
    assert len(text_messages) == 1
    assert text_messages[0].message.text == "{}"

    # Verify JSON message
    json_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.JSON]
    assert len(json_messages) == 1
    assert json_messages[0].message.json_object == {}


def test_create_variable_message():
    """Test the functionality of creating variable messages"""
    tool = _build_tool()

    # Test different types of variable values
    test_cases = [
        ("string_var", "test string"),
        ("int_var", 42),
        ("float_var", 3.14),
        ("bool_var", True),
        ("list_var", [1, 2, 3]),
        ("dict_var", {"key": "value"}),
    ]

    for var_name, var_value in test_cases:
        message = tool.create_variable_message(var_name, var_value)

        assert message.type == ToolInvokeMessage.MessageType.VARIABLE
        assert message.message.variable_name == var_name
        assert message.message.variable_value == var_value
        assert message.message.stream is False


def test_create_file_message_should_include_file_marker():
    tool = _build_tool()

    file_obj = object()
    message = tool.create_file_message(file_obj)  # type: ignore[arg-type]

    assert message.type == ToolInvokeMessage.MessageType.FILE
    assert message.message.file_marker == "file_marker"
    assert message.meta == {"file": file_obj}


def test_resolve_user_from_database_falls_back_to_end_user(monkeypatch: pytest.MonkeyPatch):
    """Ensure worker context can resolve EndUser when Account is missing."""

    tenant = SimpleNamespace(id="tenant_id")
    end_user = SimpleNamespace(id="end_user_id", tenant_id="tenant_id")

    # Monkeypatch session factory to return our stub session
    monkeypatch.setattr(
        "core.tools.workflow_as_tool.tool.session_factory.create_session",
        lambda: StubSession(scalar_results=[tenant, None, end_user]),
    )

    tool = _build_tool()
    tool.runtime.invoke_from = InvokeFrom.SERVICE_API
    tool.runtime.tenant_id = "tenant_id"

    resolved_user = tool._resolve_user_from_database(user_id=end_user.id)

    assert resolved_user is end_user


def test_resolve_user_from_database_returns_none_when_no_tenant(monkeypatch: pytest.MonkeyPatch):
    """Return None if tenant cannot be found in worker context."""

    # Monkeypatch session factory to return our stub session with no tenant
    monkeypatch.setattr(
        "core.tools.workflow_as_tool.tool.session_factory.create_session",
        lambda: StubSession(scalar_results=[None]),
    )

    tool = _build_tool()
    tool.runtime.invoke_from = InvokeFrom.SERVICE_API
    tool.runtime.tenant_id = "missing_tenant"

    resolved_user = tool._resolve_user_from_database(user_id="any")

    assert resolved_user is None


def test_workflow_tool_provider_type_and_fork_runtime():
    tool = _build_tool()
    assert tool.tool_provider_type() == ToolProviderType.WORKFLOW
    assert tool.latest_usage.total_tokens == 0

    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2", invoke_from=InvokeFrom.DEBUGGER))
    assert isinstance(forked, WorkflowTool)
    assert forked.workflow_app_id == tool.workflow_app_id
    assert forked.runtime.tenant_id == "tenant-2"


def test_derive_usage_from_top_level_usage_key():
    usage = WorkflowTool._derive_usage_from_result({"usage": {"total_tokens": 12, "total_price": "0.2"}})
    assert usage.total_tokens == 12


def test_derive_usage_from_metadata_usage():
    metadata_usage = WorkflowTool._derive_usage_from_result({"metadata": {"usage": {"total_tokens": 7}}})
    assert metadata_usage.total_tokens == 7


def test_derive_usage_from_totals():
    totals_usage = WorkflowTool._derive_usage_from_result(
        {"total_tokens": "9", "total_price": "1.3", "currency": "USD"}
    )
    assert totals_usage.total_tokens == 9
    assert str(totals_usage.total_price) == "1.3"


def test_derive_usage_from_empty():
    empty_usage = WorkflowTool._derive_usage_from_result({})
    assert empty_usage.total_tokens == 0


def test_extract_usage_from_nested():
    nested = WorkflowTool._extract_usage_dict({"nested": [{"data": {"usage": {"total_tokens": 3}}}]})
    assert nested == {"total_tokens": 3}


def test_invoke_raises_when_user_not_found(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool()
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: None)

    with pytest.raises(ToolInvokeError, match="User not found"):
        list(tool.invoke("missing", {}))


def test_resolve_user_from_database_returns_account(monkeypatch: pytest.MonkeyPatch):
    tenant = SimpleNamespace(id="tenant_id")
    account = SimpleNamespace(id="account_id", current_tenant=None)
    session = StubSession(scalar_results=[tenant, account])

    monkeypatch.setattr("core.tools.workflow_as_tool.tool.session_factory.create_session", lambda: session)
    tool = _build_tool()
    tool.runtime.tenant_id = "tenant_id"

    resolved = tool._resolve_user_from_database(user_id="account_id")
    assert resolved is account
    assert account.current_tenant is tenant
    assert session.expunge_calls == [account]


def test_get_workflow_and_get_app_db_branches(monkeypatch: pytest.MonkeyPatch):
    tool = _build_tool()
    latest_workflow = SimpleNamespace(id="wf-latest")
    specific_workflow = SimpleNamespace(id="wf-v1")
    app = SimpleNamespace(id="app-1")
    sessions = iter(
        [
            StubSession(scalar_results=[], scalars_results=[latest_workflow]),
            StubSession(scalar_results=[specific_workflow], scalars_results=[]),
            StubSession(scalar_results=[app], scalars_results=[]),
        ]
    )
    monkeypatch.setattr(
        "core.tools.workflow_as_tool.tool.session_factory.create_session",
        lambda: next(sessions),
    )

    assert tool._get_workflow("app-1", "") is latest_workflow
    assert tool._get_workflow("app-1", "1") is specific_workflow
    assert tool._get_app("app-1") is app

    monkeypatch.setattr(
        "core.tools.workflow_as_tool.tool.session_factory.create_session",
        lambda: StubSession(scalar_results=[None, None], scalars_results=[None]),
    )
    with pytest.raises(ValueError, match="workflow not found"):
        tool._get_workflow("app-1", "1")
    with pytest.raises(ValueError, match="app not found"):
        tool._get_app("app-1")


def _setup_transform_args_tool(monkeypatch: pytest.MonkeyPatch) -> WorkflowTool:
    """Build a WorkflowTool and stub merged runtime parameters for files/query."""
    tool = _build_tool()
    files_param = ToolParameter.get_simple_instance(
        name="files",
        llm_description="files",
        typ=ToolParameter.ToolParameterType.SYSTEM_FILES,
        required=False,
    )
    files_param.form = ToolParameter.ToolParameterForm.FORM
    text_param = ToolParameter.get_simple_instance(
        name="query",
        llm_description="query",
        typ=ToolParameter.ToolParameterType.STRING,
        required=False,
    )
    text_param.form = ToolParameter.ToolParameterForm.FORM

    monkeypatch.setattr(tool, "get_merged_runtime_parameters", lambda: [files_param, text_param])
    return tool


def test_transform_args_valid_files(monkeypatch: pytest.MonkeyPatch):
    tool = _setup_transform_args_tool(monkeypatch)
    monkeypatch.setattr(
        "core.workflow.file.models.helpers.get_signed_tool_file_url",
        lambda tool_file_id, extension, for_external=True: f"https://files/{tool_file_id}{extension}",
    )

    params, files = tool._transform_args(
        {
            "query": "hello",
            "files": [
                {
                    "tenant_id": "tenant-1",
                    "type": "image",
                    "transfer_method": "tool_file",
                    "related_id": "tool-1",
                    "extension": ".png",
                },
                {
                    "tenant_id": "tenant-1",
                    "type": "document",
                    "transfer_method": "local_file",
                    "related_id": "upload-1",
                },
                {
                    "tenant_id": "tenant-1",
                    "type": "document",
                    "transfer_method": "remote_url",
                    "remote_url": "https://example.com/a.pdf",
                },
            ],
        }
    )
    assert params == {"query": "hello"}
    assert any(file_item.get("tool_file_id") == "tool-1" for file_item in files)
    assert any(file_item.get("upload_file_id") == "upload-1" for file_item in files)
    assert any(file_item.get("url") == "https://example.com/a.pdf" for file_item in files)


def test_transform_args_invalid_files(monkeypatch: pytest.MonkeyPatch):
    tool = _setup_transform_args_tool(monkeypatch)
    invalid_params, invalid_files = tool._transform_args({"query": "hello", "files": [{"invalid": True}]})
    assert invalid_params == {"query": "hello"}
    assert invalid_files == []


def test_extract_files():
    tool = _build_tool()
    built_files = [
        SimpleNamespace(id="file-1"),
        SimpleNamespace(id="file-2"),
    ]
    with patch("core.tools.workflow_as_tool.tool.build_from_mapping", side_effect=built_files):
        outputs = {
            "attachments": [
                {
                    "dify_model_identity": FILE_MODEL_IDENTITY,
                    "transfer_method": "tool_file",
                    "related_id": "r1",
                }
            ],
            "single_file": {
                "dify_model_identity": FILE_MODEL_IDENTITY,
                "transfer_method": "local_file",
                "related_id": "r2",
            },
            "text": "ok",
        }
        result, extracted_files = tool._extract_files(outputs)

    assert result["text"] == "ok"
    assert len(extracted_files) == 2


def test_update_file_mapping():
    tool = _build_tool()
    tool_file = tool._update_file_mapping({"transfer_method": "tool_file", "related_id": "tool-1"})
    assert tool_file["tool_file_id"] == "tool-1"
    local_file = tool._update_file_mapping({"transfer_method": "local_file", "related_id": "upload-1"})
    assert local_file["upload_file_id"] == "upload-1"
