"""Unit tests for the Agent tool inner invoke service with SQLite-backed app lookup."""

from collections.abc import Generator
from dataclasses import replace
from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import Connection, Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType
from core.tools.errors import (
    ToolInvokeError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from core.tools.plugin_tool.tool import PluginTool
from extensions.application_services.workflow import WorkflowExecutionDependencies
from models.enums import AppStatus
from models.model import App, AppMode
from repositories.app.agent_app_repository import AgentAppRepository
from services.agent.tool_invocation_service import AgentToolInnerService
from services.entities.agent_tool_inner import AgentToolInvokeRequest
from services.errors.agent_tool_inner import AgentToolInnerServiceError
from services.tools.agent_invocation_gateway import AgentToolInvocationGateway
from services.tools.tool_manager import ToolManager
from services.workflow.execution.ports import WorkflowRuntime, WorkflowToolInvoker
from services.workflow.variable_contracts import WorkflowExecutionVariables

TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
USER_ID = "33333333-3333-3333-3333-333333333333"
APP_ID = "44444444-4444-4444-4444-444444444444"


def _persist_app(sqlite_session: Session, *, tenant_id: str = TENANT_ID) -> App:
    app = App(
        id=APP_ID,
        tenant_id=tenant_id,
        name="Test App",
        description="",
        mode=AppMode.CHAT,
        status=AppStatus.NORMAL,
        enable_site=False,
        enable_api=False,
        max_active_requests=None,
    )
    sqlite_session.add(app)
    sqlite_session.commit()
    sqlite_session.expunge_all()
    return app


def _request() -> AgentToolInvokeRequest:
    return AgentToolInvokeRequest.model_validate(
        {
            "caller": {
                "tenant_id": TENANT_ID,
                "user_id": USER_ID,
                "user_from": "account",
                "app_id": APP_ID,
                "invoke_from": "service-api",
                "conversation_id": "conversation-1",
                "workflow_id": "workflow-1",
                "workflow_run_id": "workflow-run-1",
                "node_id": "node-1",
                "node_execution_id": "node-exec-1",
                "agent_id": "agent-1",
                "agent_config_version_id": "snapshot-1",
            },
            "tool": {
                "provider_type": "plugin",
                "provider_id": "langgenius/search/search",
                "tool_name": "search",
                "credential_id": "credential-1",
                "tool_parameters": {"query": "dify"},
                "runtime_parameters": {"region": "us"},
            },
        }
    )


def _messages() -> Generator[ToolInvokeMessage, None, None]:
    yield ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.TEXT,
        message=ToolInvokeMessage.TextMessage(text="ok"),
    )


def _tool() -> Tool:
    return create_autospec(Tool, instance=True, spec_set=True)


def _variables() -> WorkflowExecutionVariables:
    return create_autospec(WorkflowExecutionVariables, instance=True, spec_set=True)


def _service(
    session: Session,
    runtime: WorkflowRuntime,
    variables: WorkflowExecutionVariables | None = None,
) -> AgentToolInnerService:
    return AgentToolInnerService(
        apps=AgentAppRepository(session_factory=sessionmaker(bind=session.get_bind(), expire_on_commit=False)),
        tools=AgentToolInvocationGateway(
            variables=variables if variables is not None else _variables(),
            runtime=runtime,
        ),
    )


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
@pytest.mark.parametrize("fail_during_stream", [False, True])
def test_app_lookup_releases_connection_before_tool_setup_and_stream_consumption(
    sqlite_session: Session,
    sqlite_engine: Engine,
    workflow_runtime: WorkflowRuntime,
    monkeypatch: pytest.MonkeyPatch,
    fail_during_stream: bool,
) -> None:
    _persist_app(sqlite_session)
    active: set[Connection] = set()
    begin, finish = active.add, active.discard
    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", finish)
    event.listen(sqlite_engine, "rollback", finish)
    tool = PluginTool(
        entity=ToolEntity(
            identity=ToolIdentity(
                author="author", name="search", provider="provider", label=I18nObject(en_US="Search")
            ),
            parameters=[],
        ),
        runtime=ToolRuntime(tenant_id=TENANT_ID, invoke_from=InvokeFrom.SERVICE_API, runtime_parameters={}),
        tenant_id=TENANT_ID,
        icon="icon.svg",
        plugin_unique_identifier="plugin-id",
    )
    calls = []

    def resolve_runtime(**_kwargs: object) -> Tool:
        assert not active
        calls.append("setup")
        return tool

    class PluginTransport:
        def invoke(self, **kwargs: object) -> Generator[ToolInvokeMessage, None, None]:
            assert not active
            assert kwargs["tenant_id"] == TENANT_ID
            assert kwargs["app_id"] == APP_ID
            calls.append("stream")
            yield tool.create_text_message("ok")
            assert not active
            if fail_during_stream:
                raise ToolInvokeError("stream interrupted")

    monkeypatch.setattr(ToolManager, "get_agent_tool_runtime", resolve_runtime)
    monkeypatch.setattr("core.tools.plugin_tool.tool.PluginToolManager", PluginTransport)
    try:
        service = _service(sqlite_session, workflow_runtime)
        if fail_during_stream:
            with pytest.raises(AgentToolInnerServiceError) as raised:
                service.invoke(_request())
            assert raised.value.error_code == "agent_tool_invoke_failed"
        else:
            assert service.invoke(_request()).observation == "ok"
        assert calls == ["setup", "stream"]
        assert not active
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", finish)
        event.remove(sqlite_engine, "rollback", finish)


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_uses_agent_tool_runtime_and_returns_observation(
    sqlite_session: Session, *, workflow_runtime: WorkflowExecutionDependencies
) -> None:
    fake_tool = _tool()
    variables = _variables()
    tool_invoker = create_autospec(WorkflowToolInvoker, instance=True, spec_set=True)
    tool_invoker.return_value = _messages()
    runtime = replace(workflow_runtime, tool_invoker=tool_invoker)
    _persist_app(sqlite_session)

    with (
        patch(
            "services.tools.agent_invocation_gateway.ToolManager.get_agent_tool_runtime",
            return_value=fake_tool,
        ) as mock_get_runtime,
        patch(
            "services.tools.agent_invocation_gateway.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=lambda messages, **_kwargs: messages,
        ),
    ):
        response = _service(sqlite_session, runtime, variables).invoke(_request())

    assert response.observation == "ok"
    assert response.metadata == {
        "provider_type": "plugin",
        "provider_id": "langgenius/search/search",
        "tool_name": "search",
    }
    agent_tool = mock_get_runtime.call_args.kwargs["agent_tool"]
    assert mock_get_runtime.call_args.kwargs["draft_variable_saver"] is variables.saver_factory
    assert agent_tool.provider_type is ToolProviderType.PLUGIN
    assert agent_tool.tool_parameters == {"region": "us"}
    tool_invoker.assert_called_once()
    assert "session" not in tool_invoker.call_args.kwargs
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_raises_app_not_found(sqlite_session: Session, *, workflow_runtime: WorkflowRuntime) -> None:
    with pytest.raises(AgentToolInnerServiceError) as exc_info:
        _service(sqlite_session, workflow_runtime).invoke(_request())

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404
    assert exc_info.value.description == "App not found."
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_raises_app_tenant_mismatch_when_app_belongs_to_other_tenant(
    sqlite_session: Session, *, workflow_runtime: WorkflowRuntime
) -> None:
    _persist_app(sqlite_session, tenant_id=OTHER_TENANT_ID)

    with pytest.raises(AgentToolInnerServiceError) as exc_info:
        _service(sqlite_session, workflow_runtime).invoke(_request())

    assert exc_info.value.error_code == "app_tenant_mismatch"
    assert exc_info.value.status_code == 403
    assert exc_info.value.description == "App does not belong to the caller tenant."
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_maps_tool_runtime_app_not_found_value_error_to_specific_error_code(
    sqlite_session: Session, *, workflow_runtime: WorkflowExecutionDependencies
) -> None:
    fake_tool = _tool()
    tool_invoker = create_autospec(WorkflowToolInvoker, instance=True, spec_set=True)
    tool_invoker.side_effect = ValueError("app not found")
    runtime = replace(workflow_runtime, tool_invoker=tool_invoker)
    _persist_app(sqlite_session)

    with patch("services.tools.agent_invocation_gateway.ToolManager.get_agent_tool_runtime", return_value=fake_tool):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            _service(sqlite_session, runtime).invoke(_request())

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404
    assert exc_info.value.description == "App not found."
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_maps_tool_invoke_error_without_private_tool_engine_helper(
    sqlite_session: Session, *, workflow_runtime: WorkflowExecutionDependencies
) -> None:
    fake_tool = _tool()
    tool_invoker = create_autospec(WorkflowToolInvoker, instance=True, spec_set=True)
    tool_invoker.side_effect = ToolInvokeError("workflow crashed")
    runtime = replace(workflow_runtime, tool_invoker=tool_invoker)
    _persist_app(sqlite_session)

    with patch("services.tools.agent_invocation_gateway.ToolManager.get_agent_tool_runtime", return_value=fake_tool):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            _service(sqlite_session, runtime).invoke(_request())

    assert exc_info.value.error_code == "agent_tool_invoke_failed"
    assert not sqlite_session.in_transaction()


@pytest.mark.parametrize(
    ("error", "expected_code"),
    [
        (ToolProviderNotFoundError("provider gone"), "agent_tool_declaration_not_found"),
        (ToolProviderCredentialValidationError("credential invalid"), "agent_tool_credential_invalid"),
        (ToolParameterValidationError("query is required"), "tool_parameters_invalid"),
    ],
)
@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_maps_runtime_lookup_errors_to_service_error_codes(
    error: Exception, expected_code: str, sqlite_session: Session, *, workflow_runtime: WorkflowRuntime
) -> None:
    _persist_app(sqlite_session)

    with patch("services.tools.agent_invocation_gateway.ToolManager.get_agent_tool_runtime", side_effect=error):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            _service(sqlite_session, workflow_runtime).invoke(_request())

    assert exc_info.value.error_code == expected_code
    assert not sqlite_session.in_transaction()
