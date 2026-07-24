"""Unit tests for the Agent tool inner invoke service with SQLite-backed app lookup."""

from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.orm import Session

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolProviderType
from core.tools.entities.ui_entities import ToolUIMessage
from core.tools.errors import (
    ToolInvokeError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from models.enums import AppStatus
from models.model import App, AppMode
from services.agent_tool_inner_service import AgentToolInnerService
from services.entities.agent_tool_inner import AgentToolInvokeRequest
from services.errors.agent_tool_inner import AgentToolInnerServiceError

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


def _ui_messages() -> Generator[ToolInvokeMessage, None, None]:
    yield ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.TEXT,
        message=ToolInvokeMessage.TextMessage(text="Sunny"),
    )
    yield ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.UI,
        message=ToolUIMessage.model_validate(
            {
                "protocol": "a2ui",
                "protocol_version": "v0.9.1",
                "messages": [
                    {
                        "version": "v0.9.1",
                        "createSurface": {
                            "surfaceId": "weather",
                            "catalogId": "https://dify.ai/a2ui/catalog/v1",
                        },
                    },
                    {
                        "version": "v0.9.1",
                        "updateComponents": {
                            "surfaceId": "weather",
                            "components": [
                                {
                                    "id": "root",
                                    "component": "Text",
                                    "text": "Sunny",
                                }
                            ],
                        },
                    },
                ],
            }
        ),
    )


def _oversized_ui_messages() -> Generator[ToolInvokeMessage, None, None]:
    yield ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.TEXT,
        message=ToolInvokeMessage.TextMessage(text="Sunny"),
    )
    for index in range(17):
        surface_id = f"weather-{index}"
        yield ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.UI,
            message=ToolUIMessage(
                messages=[
                    {
                        "version": "v0.9.1",
                        "createSurface": {
                            "surfaceId": surface_id,
                            "catalogId": "https://dify.ai/a2ui/catalog/v1",
                        },
                    },
                    {
                        "version": "v0.9.1",
                        "updateComponents": {
                            "surfaceId": surface_id,
                            "components": [{"id": "root", "component": "Text", "text": "Sunny"}],
                        },
                    },
                ]
            ),
        )


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_uses_agent_tool_runtime_and_returns_observation(sqlite_session: Session) -> None:
    fake_tool = MagicMock()
    _persist_app(sqlite_session)

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
        response = AgentToolInnerService().invoke(_request(), session=sqlite_session)

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
    assert mock_invoke.call_args.kwargs["session"] is sqlite_session
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_keeps_ui_in_messages_and_out_of_observation(sqlite_session: Session) -> None:
    _persist_app(sqlite_session)

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=MagicMock()),
        patch("services.agent_tool_inner_service.ToolEngine.generic_invoke", return_value=_ui_messages()),
        patch(
            "services.agent_tool_inner_service.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=lambda messages, **_kwargs: messages,
        ),
    ):
        response = AgentToolInnerService().invoke(_request(), session=sqlite_session)

    assert response.observation == "Sunny"
    assert response.messages[1] == {
        "type": "ui",
        "message": {
            "protocol": "a2ui",
            "protocol_version": "v0.9.1",
            "messages": [
                {
                    "version": "v0.9.1",
                    "createSurface": {
                        "surfaceId": "weather",
                        "catalogId": "https://dify.ai/a2ui/catalog/v1",
                    },
                },
                {
                    "version": "v0.9.1",
                    "updateComponents": {
                        "surfaceId": "weather",
                        "components": [
                            {
                                "id": "root",
                                "component": "Text",
                                "text": "Sunny",
                            }
                        ],
                    },
                },
            ],
        },
        "meta": None,
    }


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_drops_oversized_ui_batch_without_losing_observation(sqlite_session: Session) -> None:
    _persist_app(sqlite_session)

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=MagicMock()),
        patch(
            "services.agent_tool_inner_service.ToolEngine.generic_invoke",
            return_value=_oversized_ui_messages(),
        ),
        patch(
            "services.agent_tool_inner_service.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=lambda messages, **_kwargs: messages,
        ),
    ):
        response = AgentToolInnerService().invoke(_request(), session=sqlite_session)

    assert response.observation == "Sunny"
    assert [message["type"] for message in response.messages] == ["text"]


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_raises_app_not_found_when_session_has_no_app(sqlite_session: Session) -> None:
    with pytest.raises(AgentToolInnerServiceError) as exc_info:
        AgentToolInnerService().invoke(_request(), session=sqlite_session)

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404
    assert exc_info.value.description == "App not found."
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_raises_app_tenant_mismatch_when_app_belongs_to_other_tenant(sqlite_session: Session) -> None:
    _persist_app(sqlite_session, tenant_id=OTHER_TENANT_ID)

    with pytest.raises(AgentToolInnerServiceError) as exc_info:
        AgentToolInnerService().invoke(_request(), session=sqlite_session)

    assert exc_info.value.error_code == "app_tenant_mismatch"
    assert exc_info.value.status_code == 403
    assert exc_info.value.description == "App does not belong to the caller tenant."
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_maps_tool_runtime_app_not_found_value_error_to_specific_error_code(
    sqlite_session: Session,
) -> None:
    fake_tool = MagicMock()
    _persist_app(sqlite_session)

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=fake_tool),
        patch("services.agent_tool_inner_service.ToolEngine.generic_invoke", side_effect=ValueError("app not found")),
    ):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            AgentToolInnerService().invoke(_request(), session=sqlite_session)

    assert exc_info.value.error_code == "app_not_found"
    assert exc_info.value.status_code == 404
    assert exc_info.value.description == "App not found."
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_invoke_maps_tool_invoke_error_without_private_tool_engine_helper(sqlite_session: Session) -> None:
    fake_tool = MagicMock()
    _persist_app(sqlite_session)

    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=fake_tool),
        patch(
            "services.agent_tool_inner_service.ToolEngine.generic_invoke",
            side_effect=ToolInvokeError("workflow crashed"),
        ),
    ):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            AgentToolInnerService().invoke(_request(), session=sqlite_session)

    assert exc_info.value.error_code == "agent_tool_invoke_failed"
    assert sqlite_session.in_transaction()


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
    error: Exception,
    expected_code: str,
    sqlite_session: Session,
) -> None:
    _persist_app(sqlite_session)

    with patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", side_effect=error):
        with pytest.raises(AgentToolInnerServiceError) as exc_info:
            AgentToolInnerService().invoke(_request(), session=sqlite_session)

    assert exc_info.value.error_code == expected_code
    assert sqlite_session.in_transaction()
