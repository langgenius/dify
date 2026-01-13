from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.workflow_as_tool.tool import WorkflowTool


def test_workflow_tool_should_raise_tool_invoke_error_when_result_has_error_field(monkeypatch: pytest.MonkeyPatch):
    """Ensure that WorkflowTool will throw a `ToolInvokeError` exception when
    `WorkflowAppGenerator.generate` returns a result with `error` key inside
    the `data` element.
    """
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

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Mock user resolution to avoid database access
    from unittest.mock import Mock

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


def test_workflow_tool_should_generate_variable_messages_for_outputs(monkeypatch: pytest.MonkeyPatch):
    """Test that WorkflowTool should generate variable messages when there are outputs"""
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

    # Mock workflow outputs
    mock_outputs = {"result": "success", "count": 42, "data": {"key": "value"}}

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Mock user resolution to avoid database access
    from unittest.mock import Mock

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

    # Verify generated messages
    # Should contain: 3 variable messages + 1 text message + 1 JSON message = 5 messages
    assert len(messages) == 5

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
    assert '{"result": "success", "count": 42, "data": {"key": "value"}}' in text_messages[0].message.text

    # Verify JSON message
    json_messages = [msg for msg in messages if msg.type == ToolInvokeMessage.MessageType.JSON]
    assert len(json_messages) == 1
    assert json_messages[0].message.json_object == mock_outputs


def test_workflow_tool_should_handle_empty_outputs(monkeypatch: pytest.MonkeyPatch):
    """Test that WorkflowTool should handle empty outputs correctly"""
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

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Mock user resolution to avoid database access
    from unittest.mock import Mock

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


def test_resolve_user_from_database_falls_back_to_end_user(monkeypatch: pytest.MonkeyPatch):
    """Ensure worker context can resolve EndUser when Account is missing."""

    class StubSession:
        def __init__(self, results: list):
            self.results = results

        def scalar(self, _stmt):
            return self.results.pop(0)

        # SQLAlchemy Session APIs used by code under test
        def expunge(self, *_args, **_kwargs):
            pass

        def close(self):
            pass

        # support `with session_factory.create_session() as session:`
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            self.close()

    tenant = SimpleNamespace(id="tenant_id")
    end_user = SimpleNamespace(id="end_user_id", tenant_id="tenant_id")

    # Monkeypatch session factory to return our stub session
    monkeypatch.setattr(
        "core.tools.workflow_as_tool.tool.session_factory.create_session",
        lambda: StubSession([tenant, None, end_user]),
    )

    entity = ToolEntity(
        identity=ToolIdentity(author="test", name="test tool", label=I18nObject(en_US="test tool"), provider="test"),
        parameters=[],
        description=None,
        has_runtime_parameters=False,
    )
    runtime = ToolRuntime(tenant_id="tenant_id", invoke_from=InvokeFrom.SERVICE_API)
    tool = WorkflowTool(
        workflow_app_id="",
        workflow_as_tool_id="",
        version="1",
        workflow_entities={},
        workflow_call_depth=1,
        entity=entity,
        runtime=runtime,
    )

    resolved_user = tool._resolve_user_from_database(user_id=end_user.id)

    assert resolved_user is end_user


def test_resolve_user_from_database_returns_none_when_no_tenant(monkeypatch: pytest.MonkeyPatch):
    """Return None if tenant cannot be found in worker context."""

    class StubSession:
        def __init__(self, results: list):
            self.results = results

        def scalar(self, _stmt):
            return self.results.pop(0)

        def expunge(self, *_args, **_kwargs):
            pass

        def close(self):
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            self.close()

    # Monkeypatch session factory to return our stub session with no tenant
    monkeypatch.setattr(
        "core.tools.workflow_as_tool.tool.session_factory.create_session",
        lambda: StubSession([None]),
    )

    entity = ToolEntity(
        identity=ToolIdentity(author="test", name="test tool", label=I18nObject(en_US="test tool"), provider="test"),
        parameters=[],
        description=None,
        has_runtime_parameters=False,
    )
    runtime = ToolRuntime(tenant_id="missing_tenant", invoke_from=InvokeFrom.SERVICE_API)
    tool = WorkflowTool(
        workflow_app_id="",
        workflow_as_tool_id="",
        version="1",
        workflow_entities={},
        workflow_call_depth=1,
        entity=entity,
        runtime=runtime,
    )

    resolved_user = tool._resolve_user_from_database(user_id="any")

    assert resolved_user is None
