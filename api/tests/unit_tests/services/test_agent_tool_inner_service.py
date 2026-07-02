"""Unit tests for the Agent tool inner invoke service."""

from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.errors import (
    ToolInvokeError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from services.agent_tool_inner_service import AgentToolInnerService
from services.entities.agent_tool_inner import AgentToolInvokeRequest
from services.errors.agent_tool_inner import AgentToolInnerServiceError


def _request() -> AgentToolInvokeRequest:
    return AgentToolInvokeRequest.model_validate(
        {
            "caller": {
                "tenant_id": "tenant-1",
                "user_id": "user-1",
                "user_from": "account",
                "app_id": "app-1",
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


def test_invoke_uses_agent_tool_runtime_and_returns_observation() -> None:
    fake_tool = MagicMock()
    fake_app = MagicMock(id="app-1", tenant_id="tenant-1")
    session = MagicMock()
    session.get.return_value = fake_app

    with (
        patch(
            "services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime",
            return_value=fake_tool,
        ) as mock_get_runtime,
        patch("services.agent_tool_inner_service.ToolEngine.generic_invoke", return_value=_messages()) as mock_invoke,
        patch(
            "services.agent_tool_inner_service.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=lambda messages, **_kwargs: messages,
        ),
    ):
        response = AgentToolInnerService().invoke(_request(), session=session)

    assert response.observation == "ok"
    assert response.metadata == {
        "provider_type": "plugin",
        "provider_id": "langgenius/search/search",
        "tool_name": "search",
    }
    agent_tool = mock_get_runtime.call_args.kwargs["agent_tool"]
    assert agent_tool.provider_type is ToolProviderType.PLUGIN
    assert agent_tool.tool_parameters == {"region": "us"}
    mock_invoke.assert_called_once()


def test_invoke_raises_app_not_found_when_session_has_no_app() -> None:
    session = MagicMock()
    session.get.return_value = None

    with pytest.raises(AgentToolInnerServiceError) as exc_info:
        AgentToolInnerService().invoke(_request(), session=session)

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404
    assert exc_info.value.description == "App not found."


def test_invoke_raises_app_tenant_mismatch_when_app_belongs_to_other_tenant() -> None:
    fake_app = MagicMock(id="app-1", tenant_id="tenant-2")
    session = MagicMock()
    session.get.return_value = fake_app

    with pytest.raises(AgentToolInnerServiceError) as exc_info:
        AgentToolInnerService().invoke(_request(), session=session)

    assert exc_info.value.error_code == "app_tenant_mismatch"
    assert exc_info.value.status_code == 403
    assert exc_info.value.description == "App does not belong to the caller tenant."


def test_invoke_maps_tool_runtime_app_not_found_value_error_to_specific_error_code() -> None:
    fake_tool = MagicMock()
    fake_app = MagicMock(id="app-1", tenant_id="tenant-1")
    session = MagicMock()
    session.get.return_value = fake_app

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=fake_tool),
        patch("services.agent_tool_inner_service.ToolEngine.generic_invoke", side_effect=ValueError("app not found")),
    ):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            AgentToolInnerService().invoke(_request(), session=session)

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404
    assert exc_info.value.description == "App not found."


def test_invoke_maps_tool_invoke_error_without_private_tool_engine_helper() -> None:
    fake_tool = MagicMock()
    fake_app = MagicMock(id="app-1", tenant_id="tenant-1")
    session = MagicMock()
    session.get.return_value = fake_app

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=fake_tool),
        patch(
            "services.agent_tool_inner_service.ToolEngine.generic_invoke",
            side_effect=ToolInvokeError("workflow crashed"),
        ),
    ):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            AgentToolInnerService().invoke(_request(), session=session)

    assert exc_info.value.error_code == "agent_tool_invoke_failed"


@pytest.mark.parametrize(
    ("error", "expected_code"),
    [
        (ToolProviderNotFoundError("provider gone"), "agent_tool_declaration_not_found"),
        (ToolProviderCredentialValidationError("credential invalid"), "agent_tool_credential_invalid"),
        (ToolParameterValidationError("query is required"), "tool_parameters_invalid"),
    ],
)
def test_invoke_maps_runtime_lookup_errors_to_service_error_codes(error: Exception, expected_code: str) -> None:
    fake_app = MagicMock(id="app-1", tenant_id="tenant-1")
    session = MagicMock()
    session.get.return_value = fake_app

    with patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", side_effect=error):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            AgentToolInnerService().invoke(_request(), session=session)

    assert exc_info.value.error_code == expected_code
