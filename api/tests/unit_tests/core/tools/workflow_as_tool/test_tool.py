"""Unit tests for workflow-as-tool behavior with real SQLite ORM boundaries."""

import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, Mock, patch

import pytest
from sqlalchemy import Engine, inspect
from sqlalchemy.orm import Session, sessionmaker

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
from core.tools.workflow_as_tool import tool as workflow_tool_module
from core.tools.workflow_as_tool.tool import WorkflowTool
from graphon.file import FILE_MODEL_IDENTITY, FileTransferMethod, FileType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.workflow import Workflow, WorkflowType

TENANT_ID = "00000000-0000-0000-0000-000000000001"
OTHER_TENANT_ID = "00000000-0000-0000-0000-000000000002"
APP_ID = "00000000-0000-0000-0000-000000000003"
ACCOUNT_ID = "00000000-0000-0000-0000-000000000004"
END_USER_ID = "00000000-0000-0000-0000-000000000005"
CREATOR_ID = "00000000-0000-0000-0000-000000000006"


@dataclass(frozen=True)
class SqliteToolDb:
    engine: Engine
    session_maker: sessionmaker[Session]
    caller_session: Session


@pytest.fixture
def sqlite_tool_db(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> Iterator[SqliteToolDb]:
    """Bind service-owned sessions and Account tenant reloads to SQLite."""
    models = (App, Workflow, EndUser, Account, Tenant, TenantAccountJoin)
    TypeBase.metadata.create_all(sqlite_engine, tables=[model.__table__ for model in models])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    monkeypatch.setattr(workflow_tool_module.session_factory, "create_session", session_maker)

    from models import account as account_module

    monkeypatch.setattr(account_module, "db", SimpleNamespace(engine=sqlite_engine))
    with session_maker() as caller_session:
        yield SqliteToolDb(engine=sqlite_engine, session_maker=session_maker, caller_session=caller_session)


def _persist_tenant(db: SqliteToolDb, *, tenant_id: str = TENANT_ID) -> Tenant:
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    db.caller_session.add(tenant)
    db.caller_session.commit()
    return tenant


def _persist_account(db: SqliteToolDb, *, tenant_id: str = TENANT_ID) -> Account:
    account = Account(name="Account", email="account@example.com")
    account.id = ACCOUNT_ID
    join = TenantAccountJoin(
        tenant_id=tenant_id,
        account_id=account.id,
        current=True,
        role=TenantAccountRole.NORMAL,
    )
    db.caller_session.add_all([account, join])
    db.caller_session.commit()
    return account


def _persist_end_user(
    db: SqliteToolDb,
    *,
    end_user_id: str = END_USER_ID,
    tenant_id: str = TENANT_ID,
) -> EndUser:
    end_user = EndUser(
        id=end_user_id,
        tenant_id=tenant_id,
        app_id=APP_ID,
        type=EndUserType.SERVICE_API,
        name="End user",
        session_id="end-user-session",
    )
    db.caller_session.add(end_user)
    db.caller_session.commit()
    return end_user


def _persist_app(db: SqliteToolDb) -> App:
    app = App(
        id=APP_ID,
        tenant_id=TENANT_ID,
        name="Workflow app",
        description="",
        mode=AppMode.WORKFLOW,
        icon_type=None,
        icon="",
        icon_background=None,
        app_model_config_id=None,
        workflow_id=None,
        enable_site=False,
        enable_api=True,
        max_active_requests=None,
        created_by=CREATOR_ID,
    )
    db.caller_session.add(app)
    db.caller_session.commit()
    return app


def _persist_workflow(db: SqliteToolDb, *, version: str, workflow_id: str | None = None) -> Workflow:
    workflow = Workflow.new(
        tenant_id=TENANT_ID,
        app_id=APP_ID,
        type=WorkflowType.WORKFLOW.value,
        version=version,
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by=CREATOR_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = workflow_id or str(uuid.uuid4())
    db.caller_session.add(workflow)
    db.caller_session.commit()
    return workflow


def _build_tool(*, tenant_id: str = "test_tool", workflow_app_id: str = "app-1", version: str = "1") -> WorkflowTool:
    entity = ToolEntity(
        identity=ToolIdentity(author="test", name="test tool", label=I18nObject(en_US="test tool"), provider="test"),
        parameters=[],
        description=None,
        has_runtime_parameters=False,
    )
    runtime = ToolRuntime(tenant_id=tenant_id, invoke_from=InvokeFrom.EXPLORE)
    return WorkflowTool(
        workflow_app_id=workflow_app_id,
        workflow_as_tool_id="wf-tool-1",
        version=version,
        workflow_entities={},
        workflow_call_depth=1,
        entity=entity,
        runtime=runtime,
    )


def test_workflow_tool_should_raise_tool_invoke_error_when_result_has_error_field(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
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
        list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))
    assert exc_info.value.args == ("oops",)


def test_workflow_tool_does_not_use_pause_state_config(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure pause_state_config is passed as None."""
    tool = _build_tool()

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))

    call_kwargs = generate_mock.call_args.kwargs
    assert "pause_state_config" in call_kwargs
    assert call_kwargs["pause_state_config"] is None


def test_workflow_tool_passes_parent_trace_context_from_runtime(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure nested workflow runtime metadata is forwarded as parent trace context."""
    tool = _build_tool()
    tool.set_parent_trace_context(
        parent_workflow_run_id="outer-workflow-run-1",
        parent_node_execution_id="outer-node-execution-1",
    )

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))

    call_kwargs = generate_mock.call_args.kwargs
    assert call_kwargs["args"]["parent_trace_context"].model_dump() == {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    }


def test_workflow_tool_passes_parent_trace_session_id(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure nested workflows inherit the parent observability session ID."""
    tool = _build_tool()
    tool.entity.parameters = [
        ToolParameter.get_simple_instance(
            name="trace_session_id",
            llm_description="User workflow input",
            typ=ToolParameter.ToolParameterType.STRING,
            required=False,
        ),
    ]
    tool.set_trace_session_id("session-1")

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {"trace_session_id": "user-input-session"}))

    call_kwargs = generate_mock.call_args.kwargs
    assert call_kwargs["args"]["inputs"]["trace_session_id"] == "user-input-session"
    assert call_kwargs["args"]["trace_session_id"] == "session-1"


def test_workflow_tool_keeps_user_inputs_named_like_trace_runtime_keys(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure private trace context does not overwrite same-named workflow inputs."""
    tool = _build_tool()
    tool.entity.parameters = [
        ToolParameter.get_simple_instance(
            name="outer_workflow_run_id",
            llm_description="User workflow input",
            typ=ToolParameter.ToolParameterType.STRING,
            required=False,
        ),
        ToolParameter.get_simple_instance(
            name="outer_node_execution_id",
            llm_description="User node input",
            typ=ToolParameter.ToolParameterType.STRING,
            required=False,
        ),
    ]
    tool.set_parent_trace_context(
        parent_workflow_run_id="outer-workflow-run-1",
        parent_node_execution_id="outer-node-execution-1",
    )

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(
        tool.invoke(
            sqlite_tool_db.caller_session,
            "test_user",
            {
                "outer_workflow_run_id": "user-workflow-input",
                "outer_node_execution_id": "user-node-input",
            },
        )
    )

    call_kwargs = generate_mock.call_args.kwargs
    assert call_kwargs["args"]["inputs"]["outer_workflow_run_id"] == "user-workflow-input"
    assert call_kwargs["args"]["inputs"]["outer_node_execution_id"] == "user-node-input"
    assert call_kwargs["args"]["parent_trace_context"].model_dump() == {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    }


def test_workflow_tool_can_clear_parent_trace_context(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure reused WorkflowTool instances do not keep stale parent trace context."""
    tool = _build_tool()
    tool.set_parent_trace_context(
        parent_workflow_run_id="outer-workflow-run-1",
        parent_node_execution_id="outer-node-execution-1",
    )
    tool.clear_parent_trace_context()

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))

    call_kwargs = generate_mock.call_args.kwargs
    assert "parent_trace_context" not in call_kwargs["args"]


def test_workflow_tool_can_clear_trace_session_id(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure reused WorkflowTool instances do not keep stale trace session IDs."""
    tool = _build_tool()
    tool.set_trace_session_id("session-1")
    tool.clear_trace_session_id()

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))

    call_kwargs = generate_mock.call_args.kwargs
    assert "trace_session_id" not in call_kwargs["args"]


@pytest.mark.parametrize(
    "runtime_parameters",
    [
        {},
        {"outer_workflow_run_id": "outer-workflow-run-1"},
        {"outer_node_execution_id": "outer-node-execution-1"},
        {"outer_workflow_run_id": None, "outer_node_execution_id": None},
    ],
)
def test_workflow_tool_omits_parent_trace_context_when_runtime_is_incomplete(
    monkeypatch: pytest.MonkeyPatch,
    runtime_parameters: dict[str, Any],
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure incomplete runtime metadata does not leak parent trace context into generator args."""
    tool = _build_tool()
    tool.runtime.runtime_parameters = runtime_parameters

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    mock_user = Mock()
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: mock_user)

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))

    call_kwargs = generate_mock.call_args.kwargs
    assert "parent_trace_context" not in call_kwargs["args"]


def test_workflow_tool_should_generate_variable_messages_for_outputs(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
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
    messages = list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))

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


def test_workflow_tool_should_handle_empty_outputs(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
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
    messages = list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {}))

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


@pytest.mark.parametrize(
    ("var_name", "var_value"),
    [
        ("string_var", "test string"),
        ("int_var", 42),
        ("float_var", 3.14),
        ("bool_var", True),
        ("list_var", [1, 2, 3]),
        ("dict_var", {"key": "value"}),
    ],
)
def test_create_variable_message(var_name, var_value):
    """Create variable messages for multiple value types."""
    tool = _build_tool()

    message = tool.create_variable_message(var_name, var_value)

    assert message.type == ToolInvokeMessage.MessageType.VARIABLE
    assert message.message.variable_name == var_name
    assert message.message.variable_value == var_value
    assert message.message.stream is False


def test_create_file_message_should_include_file_marker():
    """Ensure file message includes marker and meta payload."""
    tool = _build_tool()

    file_obj = object()
    message = tool.create_file_message(file_obj)  # type: ignore[arg-type]

    assert message.type == ToolInvokeMessage.MessageType.FILE
    assert message.message.file_marker == "file_marker"
    assert message.meta == {"file": file_obj}


def test_resolve_user_from_database_falls_back_to_end_user(sqlite_tool_db: SqliteToolDb):
    """Ensure worker context can resolve EndUser when Account is missing."""
    _persist_tenant(sqlite_tool_db)
    end_user = _persist_end_user(sqlite_tool_db)
    other_tenant_end_user = _persist_end_user(
        sqlite_tool_db,
        end_user_id="00000000-0000-0000-0000-000000000007",
        tenant_id=OTHER_TENANT_ID,
    )

    tool = _build_tool(tenant_id=TENANT_ID)
    tool.runtime.invoke_from = InvokeFrom.SERVICE_API

    resolved_user = tool._resolve_user_from_database(user_id=end_user.id)

    assert isinstance(resolved_user, EndUser)
    assert resolved_user.id == end_user.id
    assert resolved_user.tenant_id == TENANT_ID
    assert inspect(resolved_user).detached is True
    assert tool._resolve_user_from_database(user_id=other_tenant_end_user.id) is None


def test_resolve_user_from_database_returns_none_when_no_tenant(sqlite_tool_db: SqliteToolDb):
    """Return None if tenant cannot be found in worker context."""
    tool = _build_tool(tenant_id=OTHER_TENANT_ID)
    tool.runtime.invoke_from = InvokeFrom.SERVICE_API

    resolved_user = tool._resolve_user_from_database(user_id="any")

    assert resolved_user is None


def test_workflow_tool_provider_type_and_fork_runtime():
    """Verify provider type and forked runtime behavior."""
    tool = _build_tool()
    assert tool.tool_provider_type() == ToolProviderType.WORKFLOW
    assert tool.latest_usage.total_tokens == 0

    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2", invoke_from=InvokeFrom.DEBUGGER))
    assert isinstance(forked, WorkflowTool)
    assert forked.workflow_app_id == tool.workflow_app_id
    assert forked.runtime.tenant_id == "tenant-2"


def test_derive_usage_from_top_level_usage_key():
    """Derive usage from top-level usage dict."""
    usage = WorkflowTool._derive_usage_from_result({"usage": {"total_tokens": 12, "total_price": "0.2"}})
    assert usage.total_tokens == 12


def test_derive_usage_from_metadata_usage():
    """Derive usage from metadata usage dict."""
    metadata_usage = WorkflowTool._derive_usage_from_result({"metadata": {"usage": {"total_tokens": 7}}})
    assert metadata_usage.total_tokens == 7


def test_derive_usage_from_totals():
    """Derive usage from top-level totals fields."""
    totals_usage = WorkflowTool._derive_usage_from_result(
        {"total_tokens": "9", "total_price": "1.3", "currency": "USD"}
    )
    assert totals_usage.total_tokens == 9
    assert str(totals_usage.total_price) == "1.3"


def test_derive_usage_from_empty():
    """Default usage values when result is empty."""
    empty_usage = WorkflowTool._derive_usage_from_result({})
    assert empty_usage.total_tokens == 0


def test_extract_usage_from_nested():
    """Extract nested usage dict from result payloads."""
    nested = WorkflowTool._extract_usage_dict({"nested": [{"data": {"usage": {"total_tokens": 3}}}]})
    assert nested == {"total_tokens": 3}


def test_invoke_raises_when_user_not_found(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Raise ToolInvokeError when user resolution fails."""
    tool = _build_tool()
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: None)

    with pytest.raises(ToolInvokeError, match="User not found"):
        list(tool.invoke(sqlite_tool_db.caller_session, "missing", {}))


def test_resolve_user_from_database_returns_account(sqlite_tool_db: SqliteToolDb):
    """Resolve Account and set tenant in worker context."""
    tenant = _persist_tenant(sqlite_tool_db)
    account = _persist_account(sqlite_tool_db)
    tool = _build_tool(tenant_id=TENANT_ID)

    resolved = tool._resolve_user_from_database(user_id=account.id)
    assert isinstance(resolved, Account)
    assert resolved.id == account.id
    assert resolved.current_tenant_id == tenant.id
    assert inspect(resolved).detached is True


def test_get_workflow_and_get_app_db_branches(sqlite_tool_db: SqliteToolDb):
    """Cover workflow/app retrieval branches and error cases."""
    app = _persist_app(sqlite_tool_db)
    specific_workflow = _persist_workflow(sqlite_tool_db, version="1")
    latest_workflow = _persist_workflow(sqlite_tool_db, version="2")
    _persist_workflow(sqlite_tool_db, version=Workflow.VERSION_DRAFT)
    tool = _build_tool(tenant_id=TENANT_ID, workflow_app_id=APP_ID)

    latest = tool._get_workflow(APP_ID, "")
    specific = tool._get_workflow(APP_ID, "1")
    resolved_app = tool._get_app(APP_ID)

    assert latest.id == latest_workflow.id
    assert specific.id == specific_workflow.id
    assert resolved_app.id == app.id
    assert inspect(latest).detached is True
    assert inspect(specific).detached is True
    assert inspect(resolved_app).detached is True

    with pytest.raises(ValueError, match="workflow not found"):
        tool._get_workflow(APP_ID, "missing")
    with pytest.raises(ValueError, match="app not found"):
        tool._get_app("00000000-0000-0000-0000-000000000099")


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
    """Transform args into parameters and files payloads."""
    tool = _setup_transform_args_tool(monkeypatch)
    build_file_from_stored_mapping = MagicMock(
        side_effect=[
            SimpleNamespace(
                transfer_method=FileTransferMethod.TOOL_FILE,
                type=FileType.IMAGE,
                reference="tool-1",
                generate_url=lambda: None,
            ),
            SimpleNamespace(
                transfer_method=FileTransferMethod.LOCAL_FILE,
                type=FileType.DOCUMENT,
                reference="upload-1",
                generate_url=lambda: None,
            ),
            SimpleNamespace(
                transfer_method=FileTransferMethod.REMOTE_URL,
                type=FileType.DOCUMENT,
                reference=None,
                generate_url=lambda: "https://example.com/a.pdf",
            ),
        ]
    )
    monkeypatch.setattr(
        "core.tools.workflow_as_tool.tool.build_file_from_stored_mapping",
        build_file_from_stored_mapping,
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
    assert build_file_from_stored_mapping.call_count == 3
    assert all(call.kwargs["tenant_id"] == "test_tool" for call in build_file_from_stored_mapping.call_args_list)


def test_transform_args_invalid_files(monkeypatch: pytest.MonkeyPatch):
    """Ignore invalid file entries while keeping params."""
    tool = _setup_transform_args_tool(monkeypatch)
    invalid_params, invalid_files = tool._transform_args({"query": "hello", "files": [{"invalid": True}]})
    assert invalid_params == {"query": "hello"}
    assert invalid_files == []


@pytest.mark.parametrize("empty_value", [None, "", [], [None], [""]])
def test_transform_args_normalizes_optional_files_parameter(
    monkeypatch: pytest.MonkeyPatch,
    empty_value: Any,
):
    """Pass optional workflow file-list inputs as an empty list when no files were provided."""
    tool = _build_tool()
    images_param = ToolParameter.get_simple_instance(
        name="images",
        llm_description="images",
        typ=ToolParameter.ToolParameterType.FILES,
        required=False,
    )
    images_param.form = ToolParameter.ToolParameterForm.FORM
    monkeypatch.setattr(tool, "get_merged_runtime_parameters", lambda: [images_param])

    params, files = tool._transform_args({"images": empty_value})

    assert params == {"images": []}
    assert files == []


def test_workflow_tool_invocation_normalizes_optional_files_parameter(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
):
    """Ensure casted empty FILES values do not reach workflow input validation as [None]."""
    tool = _build_tool()
    images_param = ToolParameter.get_simple_instance(
        name="images",
        llm_description="images",
        typ=ToolParameter.ToolParameterType.FILES,
        required=False,
    )
    images_param.form = ToolParameter.ToolParameterForm.FORM
    tool.entity.parameters = [images_param]

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: Mock())

    generate_mock = MagicMock(return_value={"data": {}})
    monkeypatch.setattr("core.app.apps.workflow.app_generator.WorkflowAppGenerator.generate", generate_mock)

    list(tool.invoke(sqlite_tool_db.caller_session, "test_user", {"images": None}))

    call_kwargs = generate_mock.call_args.kwargs
    assert call_kwargs["args"]["inputs"]["images"] == []


def test_extract_files():
    """Extract file outputs into result and file list."""
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
    """Map tool/local file transfer methods into output shape."""
    tool = _build_tool()
    tool_file = tool._update_file_mapping({"transfer_method": "tool_file", "related_id": "tool-1"})
    assert tool_file["tool_file_id"] == "tool-1"
    local_file = tool._update_file_mapping({"transfer_method": "local_file", "related_id": "upload-1"})
    assert local_file["upload_file_id"] == "upload-1"
