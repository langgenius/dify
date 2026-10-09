"""Unit tests for workflow-as-tool behavior with real SQLite ORM boundaries."""

import json
import threading
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, cast
from unittest.mock import Mock, create_autospec, patch

import pytest
from sqlalchemy import Engine, Table, inspect
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
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
from core.tools.errors import ToolInvokeError, ToolNotFoundError
from graphon.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.base import TypeBase
from models.enums import EndUserType
from models.model import App, AppMode, EndUser
from models.workflow import Workflow, WorkflowType
from repositories.tools.workflow_repository import WorkflowToolRepository
from services.tools.workflow.tool import WorkflowTool
from services.workflow.execution.ports import WorkflowRuntime

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


def _record_calls(
    *, return_value: Any = None, side_effect: list[Any] | None = None
) -> tuple[Callable[..., Any], list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []
    responses = iter(side_effect) if side_effect is not None else None

    def call(*_args: Any, **kwargs: Any) -> Any:
        calls.append(kwargs)
        if responses is not None:
            return next(responses)
        return return_value

    return call, calls


@pytest.fixture
def sqlite_tool_db(
    sqlite_engine: Engine,
) -> Iterator[SqliteToolDb]:
    """Bind service-owned sessions to SQLite."""
    models = (App, Workflow, EndUser, Account, Tenant, TenantAccountJoin)
    TypeBase.metadata.create_all(sqlite_engine, tables=[cast(Table, model.__table__) for model in models])
    session_maker = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with session_maker() as caller_session:
        yield SqliteToolDb(engine=sqlite_engine, session_maker=session_maker, caller_session=caller_session)


def _persist_tenant(db: SqliteToolDb, *, tenant_id: str = TENANT_ID) -> Tenant:
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    db.caller_session.add(tenant)
    db.caller_session.commit()
    return tenant


def _persist_account(db: SqliteToolDb, *, tenant_id: str = TENANT_ID) -> Account:
    if db.caller_session.get(Tenant, tenant_id) is None:
        tenant = Tenant(name="Tenant")
        tenant.id = tenant_id
        db.caller_session.add(tenant)
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


def _build_tool(
    *,
    tenant_id: str = "test_tool",
    workflow_app_id: str = "app-1",
    version: str = "1",
    workflow_runtime: WorkflowRuntime,
) -> WorkflowTool:
    entity = ToolEntity(
        identity=ToolIdentity(author="test", name="test tool", label=I18nObject(en_US="test tool"), provider="test"),
        parameters=[],
        description=None,
        has_runtime_parameters=False,
    )
    runtime = ToolRuntime(tenant_id=tenant_id, invoke_from=InvokeFrom.EXPLORE)
    return WorkflowTool(
        draft_variable_saver=Mock(
            return_value=create_autospec(DraftVariableSaverFactory, instance=True, spec_set=True)
        ),
        workflow_app_id=workflow_app_id,
        workflow_as_tool_id="wf-tool-1",
        version=version,
        workflow_entities={},
        workflow_call_depth=1,
        entity=entity,
        runtime=runtime,
        workflow_runtime=workflow_runtime,
        queries=workflow_runtime.tools,
    )


def test_workflow_tool_should_raise_tool_invoke_error_when_result_has_error_field(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure that WorkflowTool will throw a `ToolInvokeError` exception when
    `WorkflowAppGenerator.generate` returns a result with `error` key inside
    the `data` element.
    """
    tool = _build_tool(workflow_runtime=workflow_runtime)

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Resolve a persisted account without exercising the lookup in this behavior test.
    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    # replace `WorkflowAppGenerator.generate` 's return value.
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate",
        lambda *args, **kwargs: {"data": {"error": "oops"}},
    )

    with pytest.raises(ToolInvokeError) as exc_info:
        # WorkflowTool always returns a generator, so we need to iterate to
        # actually `run` the tool.
        list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))
    assert exc_info.value.args == ("oops",)


def test_workflow_tool_does_not_use_pause_state_config(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure pause_state_config is passed as None."""
    tool = _build_tool(workflow_runtime=workflow_runtime)

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))

    call_kwargs = generate_calls[-1]
    assert "pause_state_config" in call_kwargs
    assert call_kwargs["pause_state_config"] is None


def test_workflow_tool_passes_parent_trace_context_from_runtime(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure nested workflow runtime metadata is forwarded as parent trace context."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    tool.set_parent_trace_context(
        parent_workflow_run_id="outer-workflow-run-1",
        parent_node_execution_id="outer-node-execution-1",
    )

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))

    call_kwargs = generate_calls[-1]
    assert call_kwargs["args"]["parent_trace_context"].model_dump() == {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    }


def test_workflow_tool_passes_parent_trace_session_id(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure nested workflows inherit the parent observability session ID."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
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

    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(
        tool.invoke(
            session=sqlite_tool_db.caller_session,
            user_id="test_user",
            tool_parameters={"trace_session_id": "user-input-session"},
        )
    )

    call_kwargs = generate_calls[-1]
    assert call_kwargs["args"]["inputs"]["trace_session_id"] == "user-input-session"
    assert call_kwargs["args"]["trace_session_id"] == "session-1"


def test_workflow_tool_keeps_user_inputs_named_like_trace_runtime_keys(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure private trace context does not overwrite same-named workflow inputs."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
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

    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(
        tool.invoke(
            session=sqlite_tool_db.caller_session,
            user_id="test_user",
            tool_parameters={
                "outer_workflow_run_id": "user-workflow-input",
                "outer_node_execution_id": "user-node-input",
            },
        )
    )

    call_kwargs = generate_calls[-1]
    assert call_kwargs["args"]["inputs"]["outer_workflow_run_id"] == "user-workflow-input"
    assert call_kwargs["args"]["inputs"]["outer_node_execution_id"] == "user-node-input"
    assert call_kwargs["args"]["parent_trace_context"].model_dump() == {
        "parent_workflow_run_id": "outer-workflow-run-1",
        "parent_node_execution_id": "outer-node-execution-1",
    }


def test_workflow_tool_can_clear_parent_trace_context(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure reused WorkflowTool instances do not keep stale parent trace context."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    tool.set_parent_trace_context(
        parent_workflow_run_id="outer-workflow-run-1",
        parent_node_execution_id="outer-node-execution-1",
    )
    tool.clear_parent_trace_context()

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))

    call_kwargs = generate_calls[-1]
    assert "parent_trace_context" not in call_kwargs["args"]


def test_workflow_tool_can_clear_trace_session_id(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure reused WorkflowTool instances do not keep stale trace session IDs."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    tool.set_trace_session_id("session-1")
    tool.clear_trace_session_id()

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))

    call_kwargs = generate_calls[-1]
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
    *,
    workflow_runtime: WorkflowRuntime,
) -> None:
    """Ensure incomplete runtime metadata does not leak parent trace context into generator args."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    tool.runtime.runtime_parameters = runtime_parameters

    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))

    call_kwargs = generate_calls[-1]
    assert "parent_trace_context" not in call_kwargs["args"]


def test_workflow_tool_should_generate_variable_messages_for_outputs(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Test that WorkflowTool should generate variable messages when there are outputs"""
    tool = _build_tool(workflow_runtime=workflow_runtime)

    # Mock workflow outputs
    mock_outputs = {"result": "success", "count": 42, "data": {"key": "value"}}

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Resolve a persisted account without exercising the lookup in this behavior test.
    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    # replace `WorkflowAppGenerator.generate` 's return value.
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate",
        lambda *args, **kwargs: {"data": {"outputs": mock_outputs}},
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    # Execute tool invocation
    messages = list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))

    # Verify variable messages
    variable_messages = [msg.message for msg in messages if isinstance(msg.message, ToolInvokeMessage.VariableMessage)]
    assert len(variable_messages) == 3

    # Verify content of each variable message
    variable_dict = {message.variable_name: message.variable_value for message in variable_messages}
    assert variable_dict["result"] == "success"
    assert variable_dict["count"] == 42
    assert variable_dict["data"] == {"key": "value"}

    # Verify text message
    text_messages = [msg.message for msg in messages if isinstance(msg.message, ToolInvokeMessage.TextMessage)]
    assert len(text_messages) == 1
    assert json.loads(text_messages[0].text) == mock_outputs

    # Verify JSON message
    json_messages = [msg.message for msg in messages if isinstance(msg.message, ToolInvokeMessage.JsonMessage)]
    assert len(json_messages) == 1
    assert json_messages[0].json_object == mock_outputs


def test_workflow_tool_should_handle_empty_outputs(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Test that WorkflowTool should handle empty outputs correctly"""
    tool = _build_tool(workflow_runtime=workflow_runtime)

    # needs to patch those methods to avoid database access.
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)

    # Resolve a persisted account without exercising the lookup in this behavior test.
    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    # replace `WorkflowAppGenerator.generate` 's return value.
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate",
        lambda *args, **kwargs: {"data": {}},
    )
    monkeypatch.setattr("libs.login.current_user", lambda *args, **kwargs: None)

    # Execute tool invocation
    messages = list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="test_user", tool_parameters={}))

    # Verify generated messages
    # Should contain: 0 variable messages + 1 text message + 1 JSON message = 2 messages
    assert len(messages) == 2

    # Verify no variable messages
    variable_messages = [msg.message for msg in messages if isinstance(msg.message, ToolInvokeMessage.VariableMessage)]
    assert len(variable_messages) == 0

    # Verify text message
    text_messages = [msg.message for msg in messages if isinstance(msg.message, ToolInvokeMessage.TextMessage)]
    assert len(text_messages) == 1
    assert text_messages[0].text == "{}"

    # Verify JSON message
    json_messages = [msg.message for msg in messages if isinstance(msg.message, ToolInvokeMessage.JsonMessage)]
    assert len(json_messages) == 1
    assert json_messages[0].json_object == {}


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
def test_create_variable_message(var_name: str, var_value: object, *, workflow_runtime: WorkflowRuntime) -> None:
    """Create variable messages for multiple value types."""
    tool = _build_tool(workflow_runtime=workflow_runtime)

    message = tool.create_variable_message(var_name, var_value)

    assert message.type == ToolInvokeMessage.MessageType.VARIABLE
    assert isinstance(message.message, ToolInvokeMessage.VariableMessage)
    assert message.message.variable_name == var_name
    assert message.message.variable_value == var_value
    assert message.message.stream is False


def test_create_file_message_should_include_file_marker(*, workflow_runtime: WorkflowRuntime) -> None:
    """Ensure file message includes marker and meta payload."""
    tool = _build_tool(workflow_runtime=workflow_runtime)

    file_obj = object()
    message = tool.create_file_message(file_obj)  # type: ignore[arg-type]

    assert message.type == ToolInvokeMessage.MessageType.FILE
    assert isinstance(message.message, ToolInvokeMessage.FileMessage)
    assert message.message.file_marker == "file_marker"
    assert message.meta == {"file": file_obj}


def test_resolve_tenant_user_falls_back_to_end_user(
    sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure worker context can resolve EndUser when Account is missing."""
    _persist_tenant(sqlite_tool_db)
    end_user = _persist_end_user(sqlite_tool_db)
    other_tenant_end_user = _persist_end_user(
        sqlite_tool_db,
        end_user_id="00000000-0000-0000-0000-000000000007",
        tenant_id=OTHER_TENANT_ID,
    )

    tool = _build_tool(tenant_id=TENANT_ID, workflow_runtime=workflow_runtime)
    tool.runtime.invoke_from = InvokeFrom.SERVICE_API

    resolved_user = tool._resolve_user(user_id=end_user.id)

    assert isinstance(resolved_user, EndUser)
    assert resolved_user.id == end_user.id
    assert resolved_user.tenant_id == TENANT_ID
    assert inspect(resolved_user).detached is True
    assert tool._resolve_user(user_id=other_tenant_end_user.id) is None


def test_resolve_tenant_user_returns_none_when_no_tenant(
    sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Return None if tenant cannot be found in worker context."""
    tool = _build_tool(tenant_id=OTHER_TENANT_ID, workflow_runtime=workflow_runtime)
    tool.runtime.invoke_from = InvokeFrom.SERVICE_API

    resolved_user = tool._resolve_user(user_id="any")

    assert resolved_user is None


def test_workflow_tool_provider_type_and_fork_runtime(*, workflow_runtime: WorkflowRuntime) -> None:
    """Verify provider type and forked runtime behavior."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    assert tool.tool_provider_type() == ToolProviderType.WORKFLOW
    assert tool.latest_usage.total_tokens == 0

    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2", invoke_from=InvokeFrom.DEBUGGER))
    assert isinstance(forked, WorkflowTool)
    assert forked.workflow_app_id == tool.workflow_app_id
    assert forked.runtime.tenant_id == "tenant-2"


def test_derive_usage_from_top_level_usage_key() -> None:
    """Derive usage from top-level usage dict."""
    usage = WorkflowTool._derive_usage_from_result({"usage": {"total_tokens": 12, "total_price": "0.2"}})
    assert usage.total_tokens == 12


def test_derive_usage_from_metadata_usage() -> None:
    """Derive usage from metadata usage dict."""
    metadata_usage = WorkflowTool._derive_usage_from_result({"metadata": {"usage": {"total_tokens": 7}}})
    assert metadata_usage.total_tokens == 7


def test_derive_usage_from_totals() -> None:
    """Derive usage from top-level totals fields."""
    totals_usage = WorkflowTool._derive_usage_from_result(
        {"total_tokens": "9", "total_price": "1.3", "currency": "USD"}
    )
    assert totals_usage.total_tokens == 9
    assert str(totals_usage.total_price) == "1.3"


def test_derive_usage_from_empty() -> None:
    """Default usage values when result is empty."""
    empty_usage = WorkflowTool._derive_usage_from_result({})
    assert empty_usage.total_tokens == 0


def test_extract_usage_from_nested() -> None:
    """Extract nested usage dict from result payloads."""
    nested = WorkflowTool._extract_usage_dict({"nested": [{"data": {"usage": {"total_tokens": 3}}}]})
    assert nested == {"total_tokens": 3}


def test_invoke_raises_when_user_not_found(
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Raise ToolInvokeError when user resolution fails."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    monkeypatch.setattr(tool, "_get_app", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_get_workflow", lambda *args, **kwargs: None)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: None)

    with pytest.raises(ToolInvokeError, match="User not found"):
        list(tool.invoke(session=sqlite_tool_db.caller_session, user_id="missing", tool_parameters={}))


def test_resolve_tenant_user_returns_account(
    sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Resolve Account and set tenant in worker context."""
    tenant = _persist_tenant(sqlite_tool_db)
    account = _persist_account(sqlite_tool_db)
    tool = _build_tool(tenant_id=TENANT_ID, workflow_runtime=workflow_runtime)

    resolved = tool._resolve_user(user_id=account.id)
    assert isinstance(resolved, Account)
    assert resolved.id == account.id
    assert resolved.current_tenant_id == tenant.id
    assert inspect(resolved).detached is True


def test_get_workflow_and_get_app_db_branches(
    sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Cover workflow/app retrieval branches and error cases."""
    app = _persist_app(sqlite_tool_db)
    specific_workflow = _persist_workflow(sqlite_tool_db, version="1")
    latest_workflow = _persist_workflow(sqlite_tool_db, version="2")
    _persist_workflow(sqlite_tool_db, version=Workflow.VERSION_DRAFT)
    tool = _build_tool(tenant_id=TENANT_ID, workflow_app_id=APP_ID, workflow_runtime=workflow_runtime)

    latest = tool._get_workflow(APP_ID, "")
    specific = tool._get_workflow(APP_ID, "1")
    resolved_app = tool._get_app(APP_ID)

    assert latest.id == latest_workflow.id
    assert specific.id == specific_workflow.id
    assert resolved_app.id == app.id
    assert inspect(latest).detached is True
    assert inspect(specific).detached is True
    assert inspect(resolved_app).detached is True

    with pytest.raises(ToolNotFoundError, match="workflow not found"):
        tool._get_workflow(APP_ID, "missing")
    with pytest.raises(ToolNotFoundError, match="app not found"):
        tool._get_app("00000000-0000-0000-0000-000000000099")


def _setup_transform_args_tool(monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime) -> WorkflowTool:
    """Build a WorkflowTool and stub merged runtime parameters for files/query."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
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


def test_transform_args_valid_files(monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime) -> None:
    """Transform args into parameters and files payloads."""
    tool = _setup_transform_args_tool(monkeypatch, workflow_runtime=workflow_runtime)
    build_file_from_stored_mapping, build_file_calls = _record_calls(
        side_effect=[
            File(
                transfer_method=FileTransferMethod.TOOL_FILE,
                type=FileType.IMAGE,
                reference="tool-1",
            ),
            File(
                transfer_method=FileTransferMethod.LOCAL_FILE,
                type=FileType.DOCUMENT,
                reference="upload-1",
            ),
            File(
                transfer_method=FileTransferMethod.REMOTE_URL,
                type=FileType.DOCUMENT,
                remote_url="https://example.com/a.pdf",
            ),
        ]
    )
    monkeypatch.setattr(
        "services.tools.workflow.tool.build_file_from_stored_mapping",
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
    assert len(build_file_calls) == 3
    assert all(call["tenant_id"] == "test_tool" for call in build_file_calls)


def test_transform_args_invalid_files(monkeypatch: pytest.MonkeyPatch, *, workflow_runtime: WorkflowRuntime) -> None:
    """Ignore invalid file entries while keeping params."""
    tool = _setup_transform_args_tool(monkeypatch, workflow_runtime=workflow_runtime)
    invalid_params, invalid_files = tool._transform_args({"query": "hello", "files": [{"invalid": True}]})
    assert invalid_params == {"query": "hello"}
    assert invalid_files == []


@pytest.mark.parametrize("empty_value", [None, "", [], [None], [""]])
def test_transform_args_normalizes_optional_files_parameter(
    monkeypatch: pytest.MonkeyPatch, empty_value: Any, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Pass optional workflow file-list inputs as an empty list when no files were provided."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
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
    monkeypatch: pytest.MonkeyPatch, sqlite_tool_db: SqliteToolDb, *, workflow_runtime: WorkflowRuntime
) -> None:
    """Ensure casted empty FILES values do not reach workflow input validation as [None]."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
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
    user = _persist_account(sqlite_tool_db)
    monkeypatch.setattr(tool, "_resolve_user", lambda *args, **kwargs: user)

    generate, generate_calls = _record_calls(return_value={"data": {}})
    monkeypatch.setattr(
        "services.workflow.execution.adapters.workflow.app_generator.WorkflowAppGenerator.generate", generate
    )

    list(
        tool.invoke(
            session=sqlite_tool_db.caller_session,
            user_id="test_user",
            tool_parameters={"images": None},
        )
    )

    call_kwargs = generate_calls[-1]
    assert call_kwargs["args"]["inputs"]["images"] == []


def test_extract_files(*, workflow_runtime: WorkflowRuntime) -> None:
    """Extract file outputs into result and file list."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    built_files = [
        File(
            id="file-1",
            type=FileType.IMAGE,
            transfer_method=FileTransferMethod.TOOL_FILE,
            reference="tool-file-1",
        ),
        File(
            id="file-2",
            type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.LOCAL_FILE,
            reference="upload-file-2",
        ),
    ]
    with patch("services.tools.workflow.tool.build_from_mapping", side_effect=built_files):
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


def test_update_file_mapping(*, workflow_runtime: WorkflowRuntime) -> None:
    """Map tool/local file transfer methods into output shape."""
    tool = _build_tool(workflow_runtime=workflow_runtime)
    tool_file = tool._update_file_mapping({"transfer_method": "tool_file", "related_id": "tool-1"})
    assert tool_file["tool_file_id"] == "tool-1"
    local_file = tool._update_file_mapping({"transfer_method": "local_file", "related_id": "upload-1"})
    assert local_file["upload_file_id"] == "upload-1"


@pytest.mark.parametrize("invoke_from", [InvokeFrom.DEBUGGER, InvokeFrom.EXPLORE])
@pytest.mark.parametrize("entry", ["transform", "workflow"])
def test_composed_tool_fork_runs_real_generator_with_injected_draft_saver(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_tool_db: SqliteToolDb,
    invoke_from: InvokeFrom,
    entry: str,
    workflow_runtime: WorkflowRuntime,
    *,
    workflow_queries: WorkflowToolRepository,
) -> None:
    from flask import Flask
    from sqlalchemy import select

    from core.app.apps import base_app_queue_manager
    from core.app.entities.app_invoke_entities import UserFrom, build_dify_run_context
    from core.ops.ops_trace_manager import TraceQueueManager
    from extensions.application_services.workflow_variables import build_workflow_variable_service
    from graphon.nodes import BuiltinNodeTypes
    from graphon.nodes.tool.entities import ToolNodeData
    from graphon.runtime import GraphRuntimeState, VariablePool
    from models.tools import WorkflowToolProvider
    from models.workflow import WorkflowDraftVariable
    from services.tools import tools_transform_service
    from services.workflow.execution.adapters.node_factory import DifyGraphInitContext, DifyNodeFactory
    from services.workflow.execution.adapters.workflow import app_generator as generator_module
    from services.workflow.execution.adapters.workflow.app_generator import WorkflowAppGenerator

    account = _persist_account(sqlite_tool_db)
    app = _persist_app(sqlite_tool_db)
    workflow = _persist_workflow(sqlite_tool_db, version="1")
    workflow.graph = json.dumps(
        {"nodes": [{"id": "start", "data": {"type": "start", "title": "Start", "variables": []}}], "edges": []}
    )
    provider = WorkflowToolProvider(
        name="nested_workflow",
        label="Nested workflow",
        icon="icon.svg",
        app_id=app.id,
        version="1",
        user_id=account.id,
        tenant_id=app.tenant_id,
        description="",
        parameter_configuration="[]",
    )
    sqlite_tool_db.caller_session.add(provider)
    sqlite_tool_db.caller_session.commit()
    variables = build_workflow_variable_service(database_client=sqlite_tool_db.session_maker)
    saver = variables.saver_factory
    resolver = workflow_runtime.agent_bindings
    if entry == "transform":
        controller = tools_transform_service.ToolTransformService.workflow_provider_to_controller(
            provider,
            draft_variable_saver=saver,
            workflow_runtime=workflow_runtime,
            queries=workflow_queries,
        )
        original = controller.get_tools(app.tenant_id)[0]
        tool = original.fork_tool_runtime(ToolRuntime(tenant_id=app.tenant_id, invoke_from=invoke_from))
    else:
        run_context = build_dify_run_context(
            tenant_id=app.tenant_id,
            app_id=app.id,
            user_id=account.id,
            user_from=UserFrom.ACCOUNT,
            invoke_from=invoke_from,
        )
        state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
        factory = DifyNodeFactory.from_graph_init_context(
            graph_init_context=DifyGraphInitContext(
                workflow_id=workflow.id, graph_config=workflow.graph_dict, run_context=run_context, call_depth=0
            ),
            graph_runtime_state=state,
            draft_variable_saver=saver,
            agent_binding_resolver=resolver,
            workflow_runtime=workflow_runtime,
        ).with_runtime_state(state)
        runtime = factory._tool_runtime
        handle = runtime.get_runtime(
            node_id="outer-tool-node",
            node_data=ToolNodeData(
                title="Nested workflow",
                provider_id=provider.id,
                provider_type="workflow",
                provider_name=provider.name,
                tool_name=provider.name,
                tool_label=provider.label,
                tool_configurations={},
                tool_parameters={},
            ),
            variable_pool=state.variable_pool,
        )
        tool = runtime._tool_from_handle(handle)
        assert isinstance(tool, WorkflowTool)
    assert tool._draft_variable_saver is saver

    monkeypatch.setattr(base_app_queue_manager.redis_client, "setex", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        generator_module,
        "TraceQueueManager",
        Mock(return_value=create_autospec(TraceQueueManager, instance=True, spec_set=True)),
    )
    monkeypatch.setattr(WorkflowAppGenerator, "_generate_worker", staticmethod(lambda **_kwargs: None))
    outputs = {"result": "nested result"}

    def handle_response(
        self: WorkflowAppGenerator, *, draft_var_saver_factory: DraftVariableSaverFactory, **_kwargs: Any
    ) -> dict[str, Any]:
        draft_var_saver_factory(app.id, "nested-node", BuiltinNodeTypes.LLM, "nested-execution").save(
            process_data=None, outputs=outputs
        )
        return {"data": {"outputs": outputs}}

    monkeypatch.setattr(WorkflowAppGenerator, "_handle_response", handle_response)
    monkeypatch.setattr(
        generator_module.WorkflowAppGenerateResponseConverter, "convert", lambda *, response, invoke_from: response
    )
    with Flask(__name__).app_context():
        messages = list(tool._invoke(session=sqlite_tool_db.caller_session, user_id=account.id, tool_parameters={}))
    assert messages
    with sqlite_tool_db.session_maker() as session:
        saved = session.scalar(select(WorkflowDraftVariable).where(WorkflowDraftVariable.node_id == "nested-node"))
        if invoke_from == InvokeFrom.DEBUGGER:
            assert saved is not None
            assert saved.user_id == account.id
            assert saved.app_id == app.id
            assert saved.get_value().value == outputs["result"]
        else:
            assert saved is None


@pytest.mark.parametrize("invoke_from", [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API])
def test_nested_workflow_preserves_admitted_end_user_and_resolves_agent_binding(
    sqlite_tool_db: SqliteToolDb,
    workflow_runtime: WorkflowRuntime,
    monkeypatch: pytest.MonkeyPatch,
    invoke_from: InvokeFrom,
    config_overrides: Callable[..., None],
) -> None:
    """Exercise tool admission, generator, worker, runner and node construction across apps."""
    from flask import Flask

    from core.ops.ops_trace_manager import OpsTraceManager
    from enums.agent import WorkflowAgentBindingType
    from models.tools import WorkflowToolProvider
    from services.tools.workflow.provider import WorkflowToolProviderController
    from services.workflow.execution.adapters.agent_v2.agent_node import DifyAgentNode
    from services.workflow.execution.adapters.workflow import app_generator as generator_module
    from services.workflow.execution.adapters.workflow_entry import WorkflowEntry
    from tests.unit_tests.core.workflow.nodes.agent_v2.test_binding_resolver import _agent, _binding, _snapshot
    from tests.unit_tests.model_factories import make_app

    config_overrides(AGENT_BACKEND_USE_FAKE=True)
    account = _persist_account(sqlite_tool_db)
    child = _persist_app(sqlite_tool_db)
    outer = make_app(app_id=str(uuid.uuid4()), tenant_id=child.tenant_id)
    user = _persist_end_user(sqlite_tool_db)
    user.app_id = outer.id
    user.session_id = "customer-42"
    workflow = _persist_workflow(sqlite_tool_db, version="1")
    workflow.graph = json.dumps(
        {
            "nodes": [
                {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
                {
                    "id": "agent-node",
                    "data": {"type": "agent", "version": "2", "title": "Agent", "agent_node_kind": "dify_agent"},
                },
            ],
            "edges": [{"source": "start", "target": "agent-node", "sourceHandle": "source", "targetHandle": "target"}],
        }
    )
    agent = _agent(tenant_id=child.tenant_id)
    sqlite_tool_db.caller_session.add_all([outer, agent])
    sqlite_tool_db.caller_session.flush()
    snapshot = _snapshot(tenant_id=child.tenant_id, agent_id=agent.id)
    sqlite_tool_db.caller_session.add(snapshot)
    sqlite_tool_db.caller_session.flush()
    ids = {"tenant_id": child.tenant_id, "app_id": child.id, "workflow_id": workflow.id, "node_id": "agent-node"}
    sqlite_tool_db.caller_session.add(
        _binding(
            ids=ids,
            agent_id=agent.id,
            snapshot_id=snapshot.id,
            binding_type=WorkflowAgentBindingType.INLINE_AGENT,
        )
    )
    provider = WorkflowToolProvider(
        tenant_id=child.tenant_id,
        app_id=child.id,
        user_id=account.id,
        name="child",
        label="Child",
        icon="",
        description="",
        version="1",
        parameter_configuration="[]",
    )
    sqlite_tool_db.caller_session.add(provider)
    sqlite_tool_db.caller_session.commit()
    controller = WorkflowToolProviderController.from_db(
        provider,
        queries=workflow_runtime.tools,
        workflow_runtime=workflow_runtime,
        draft_variable_saver=None,
    )
    tool = controller.get_tools(child.tenant_id)[0].fork_tool_runtime(
        ToolRuntime(tenant_id=child.tenant_id, invoke_from=invoke_from)
    )
    monkeypatch.setattr(OpsTraceManager, "get_ops_trace_instance", lambda *_args: None)
    resolved: list[tuple[str, str]] = []

    def probe_engine(entry: WorkflowEntry) -> Iterator[object]:
        engine = entry.graph_engine
        pool = engine._graph_runtime_state.variable_pool
        node = engine._graph.nodes["agent-node"]
        assert isinstance(node, DifyAgentNode)
        bundle = node._binding_resolver.resolve(
            tenant_id=child.tenant_id,
            app_id=child.id,
            workflow_id=workflow.id,
            node_id="agent-node",
        )
        user_id = pool.get(["sys", "user_id"])
        assert user_id is not None
        assert isinstance(user_id.value, str)
        resolved.append((user_id.value, bundle.snapshot.id))
        return iter(())

    monkeypatch.setattr(WorkflowEntry, "run", probe_engine)

    def execute_worker(
        *, worker: threading.Thread, respond: Callable[[], object]
    ) -> dict[str, dict[str, dict[str, str]]]:
        del respond
        worker.run()
        assert resolved == [("customer-42", snapshot.id)]
        return {"data": {"outputs": {"caller": resolved[0][0]}}}

    monkeypatch.setattr(generator_module, "generate_response", execute_worker)
    with Flask(__name__).app_context():
        result = list(
            tool._invoke(
                session=sqlite_tool_db.caller_session,
                user_id=user.id,
                tool_parameters={},
                app_id=outer.id,
            )
        )
    assert any(item.type == ToolInvokeMessage.MessageType.VARIABLE for item in result)
    # Tool admission must still reject an external identity from another tenant.
    foreign_user = _persist_end_user(sqlite_tool_db, end_user_id=str(uuid.uuid4()), tenant_id=OTHER_TENANT_ID)
    with pytest.raises(ToolInvokeError, match="User not found"):
        list(
            tool._invoke(
                session=sqlite_tool_db.caller_session,
                user_id=foreign_user.id,
                tool_parameters={},
                app_id=outer.id,
            )
        )
