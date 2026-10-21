"""Unit tests for the Agent tool inner invoke service with SQLite-backed app lookup."""

from collections.abc import Generator
from typing import Literal
from unittest.mock import MagicMock, patch

import pytest
import sqlalchemy.orm
from pydantic import JsonValue
from sqlalchemy.orm import Session

from core.tools.entities.tool_entities import ToolInvokeMessage, ToolParameter, ToolProviderType
from core.tools.errors import (
    ToolInvokeError,
    ToolParameterValidationError,
    ToolProviderCredentialValidationError,
    ToolProviderNotFoundError,
)
from core.tools.plugin_tool.tool import PluginTool
from models.enums import AppStatus
from models.model import App, AppMode
from models.tools import ToolFile
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


def _messages() -> Generator[ToolInvokeMessage]:
    yield ToolInvokeMessage(
        type=ToolInvokeMessage.MessageType.TEXT,
        message=ToolInvokeMessage.TextMessage(text="ok"),
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


# These ordinary boundary tests execute the real ToolEngine, Tool casts and
# PluginTool converter. Only provider dispatch and durable file storage are doubled.
def _ordinary_plugin(parameters: list[ToolParameter], runtime_parameters: dict[str, JsonValue]) -> PluginTool:
    from core.app.entities.app_invoke_entities import InvokeFrom
    from core.tools.__base.tool_runtime import ToolRuntime
    from core.tools.entities.common_entities import I18nObject
    from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeFrom
    from core.tools.plugin_tool.tool import PluginTool

    return PluginTool(
        entity=ToolEntity(
            identity=ToolIdentity(
                author="test", name="search", label=I18nObject(en_US="search"), provider="langgenius/search/search"
            ),
            parameters=parameters,
        ),
        runtime=ToolRuntime(
            tenant_id=TENANT_ID,
            user_id=USER_ID,
            tool_id="selected-tool",
            invoke_from=InvokeFrom.SERVICE_API,
            tool_invoke_from=ToolInvokeFrom.AGENT,
            credentials={"api_key": "synthetic-only"},
            runtime_parameters=runtime_parameters,
        ),
        tenant_id=TENANT_ID,
        icon="icon.svg",
        plugin_unique_identifier="langgenius/search:synthetic",
    )


def _parameter(name: str, kind: str, **kwargs: object) -> ToolParameter:
    from core.tools.entities.tool_entities import ToolParameter

    return ToolParameter.model_validate({"name": name, "label": {"en_US": name}, "type": kind, "form": "llm", **kwargs})


DAEMON_FILE: dict[str, JsonValue] = {
    "dify_model_identity": "__dify__file__",
    "type": "document",
    "url": "https://files.example.test/signed",
    "filename": "sample.txt",
    "mime_type": "text/plain",
    "extension": ".txt",
    "size": 7,
}


@pytest.mark.parametrize(
    ("kind", "value", "expected"),
    [
        ("file", DAEMON_FILE, DAEMON_FILE),
        ("file", [DAEMON_FILE], DAEMON_FILE),
        ("files", DAEMON_FILE, [DAEMON_FILE]),
        ("files", [DAEMON_FILE], [DAEMON_FILE]),
        ("system-files", [DAEMON_FILE], [DAEMON_FILE]),
    ],
)
@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_actual_plugin_cast_frontend_and_converter_preserve_file_wire(
    kind: str, value: JsonValue, expected: JsonValue, sqlite_session: sqlalchemy.orm.Session
) -> None:
    parameter = _parameter("input", kind)
    assert parameter.type.cast_value(value) == expected
    assert parameter.init_frontend_parameter(value) == expected
    tool = _ordinary_plugin([parameter], {})
    with patch("core.tools.plugin_tool.tool.PluginToolManager.invoke", return_value=_messages()) as dispatch:
        message = list(tool.invoke(sqlite_session, USER_ID, {"input": value}))[0].message
        assert isinstance(message, ToolInvokeMessage.TextMessage)
        assert message.text == "ok"
    assert dispatch.call_args.kwargs["tool_parameters"] == {"input": expected}


@pytest.mark.parametrize("provider_type", ["plugin", "builtin"])
@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_ordinary_plugin_service_preserves_prepared_live_values_and_cached_runtime(
    provider_type: Literal["plugin", "builtin"], sqlite_session: sqlalchemy.orm.Session
) -> None:
    from copy import deepcopy

    _persist_app(sqlite_session)
    configured: dict[str, JsonValue] = {"input": "/sandbox/configured.txt", "query": "configured", "hidden": "stored"}
    tool = _ordinary_plugin(
        [
            _parameter("input", "file"),
            _parameter("query", "string"),
            _parameter("count", "number"),
            _parameter("enabled", "boolean"),
        ],
        configured,
    )
    before = tool.runtime.model_dump()
    cached_parameters = tool.runtime.runtime_parameters
    request = _request()
    request.tool.provider_type = provider_type
    request.tool.runtime_parameters = deepcopy(configured)
    request.tool.tool_parameters = {
        "input": DAEMON_FILE,
        "query": "live",
        "hidden": "stored",
        "count": 2,
        "enabled": False,
    }
    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=tool) as lookup,
        patch("core.tools.plugin_tool.tool.PluginToolManager.invoke", return_value=_messages()) as dispatch,
    ):
        response = AgentToolInnerService().invoke(request, session=sqlite_session)
    assert response.observation == "ok"
    sent = dispatch.call_args.kwargs
    assert sent["tool_parameters"] == request.tool.tool_parameters
    assert sent["credentials"] == {"api_key": "synthetic-only"}
    assert sent["tenant_id"] == TENANT_ID
    assert sent["user_id"] == USER_ID
    assert sent["tool_provider"] == tool.entity.identity.provider
    assert sent["app_id"] == APP_ID
    assert sent["conversation_id"] == "conversation-1"
    assert sent["confirmed_dispatch_headers"] is None
    assert lookup.call_args.kwargs["agent_tool"].credential_id == "credential-1"
    assert lookup.call_args.kwargs["agent_tool"].tool_parameters == configured
    assert tool.runtime.model_dump() == before
    assert tool.runtime.runtime_parameters is cached_parameters


@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_ordinary_plugin_service_multiple_select_uses_actual_full_declaration(
    sqlite_session: sqlalchemy.orm.Session,
) -> None:
    _persist_app(sqlite_session)
    parameter = _parameter("selection", "select", multiple=True, options=[{"value": "a", "label": {"en_US": "A"}}])
    tool = _ordinary_plugin([parameter], {})
    request = _request()
    request.tool.tool_parameters = {"selection": ["a"]}
    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=tool),
        patch("core.tools.plugin_tool.tool.PluginToolManager.invoke", return_value=_messages()) as dispatch,
    ):
        AgentToolInnerService().invoke(request, session=sqlite_session)
        assert dispatch.call_args.kwargs["tool_parameters"]["selection"] == ["a"]
        request.tool.tool_parameters = {"selection": ["invalid"]}
        with pytest.raises(AgentToolInnerServiceError, match="not in options"):
            AgentToolInnerService().invoke(request, session=sqlite_session)
        assert dispatch.call_count == 1


@pytest.mark.parametrize("multiple", [False, True])
@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_api_multiple_metadata_exposes_existing_agent_select_wire_gap(
    multiple: bool, sqlite_session: sqlalchemy.orm.Session
) -> None:
    parameter = _parameter("selection", "select", multiple=multiple, options=[{"value": "a", "label": {"en_US": "A"}}])
    tool = _ordinary_plugin([parameter], {})
    with patch("core.tools.plugin_tool.tool.PluginToolManager.invoke", return_value=_messages()) as dispatch:
        if multiple:
            with pytest.raises(ValueError, match="must be a list"):
                list(tool.invoke(sqlite_session, USER_ID, {"selection": "['a']"}))
            dispatch.assert_not_called()
            assert parameter.init_frontend_parameter(["a"]) == ["a"]
        else:
            list(tool.invoke(sqlite_session, USER_ID, {"selection": "['a']"}))
            assert dispatch.call_args.kwargs["tool_parameters"]["selection"] == "['a']"
            assert parameter.init_frontend_parameter("a") == "a"


@pytest.mark.parametrize("provider_type", ["builtin", "api", "workflow", "mcp"])
@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_non_plugin_runtime_keeps_existing_configured_precedence(
    provider_type: Literal["plugin", "builtin"], sqlite_session: sqlalchemy.orm.Session
) -> None:
    from core.tools.__base.tool import Tool

    class OrdinaryTool(Tool):
        def tool_provider_type(self) -> ToolProviderType:
            return ToolProviderType.value_of(provider_type)

        def _invoke(
            self,
            session: object,
            user_id: object,
            tool_parameters: dict[str, JsonValue],
            conversation_id: object = None,
            app_id: object = None,
            message_id: object = None,
        ) -> Generator[ToolInvokeMessage]:
            del session, user_id, conversation_id, app_id, message_id
            yield ToolInvokeMessage(
                type=ToolInvokeMessage.MessageType.TEXT,
                message=ToolInvokeMessage.TextMessage.model_validate({"text": tool_parameters["query"]}),
            )

    _persist_app(sqlite_session)
    fixture = _ordinary_plugin([_parameter("query", "string")], {"query": "configured"})
    tool = OrdinaryTool(fixture.entity, fixture.runtime)
    request = _request()
    request.tool.provider_type = provider_type
    with patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=tool):
        assert AgentToolInnerService().invoke(request, session=sqlite_session).observation == "configured"
    assert tool.runtime is fixture.runtime


@pytest.mark.parametrize(
    ("output_kind", "expected_type", "observation"),
    [
        ("text", "text", "text output"),
        ("json", "json", '{"answer": 2}'),
        ("link", "link", "result link: https://example.test/result. please tell user to check it."),
        ("image", "image_link", "image has been created and sent to user already"),
        ("blob", "binary_link", "/files/tools/output-id.txt"),
        ("file", "link", "/files/tools/output-id.txt"),
        ("file_mapping", None, ""),
    ],
)
@pytest.mark.parametrize("sqlite_session", [(App,)], indirect=True)
def test_api_output_observation_and_file_messages_use_existing_owners(
    output_kind: str, expected_type: str | None, observation: str, sqlite_session: sqlalchemy.orm.Session
) -> None:

    from core.workflow.file_reference import build_file_reference
    from graphon.file import File, FileTransferMethod, FileType

    _persist_app(sqlite_session)
    kind = ToolInvokeMessage.MessageType
    if output_kind == "json":
        message = ToolInvokeMessage(type=kind.JSON, message=ToolInvokeMessage.JsonMessage(json_object={"answer": 2}))
    elif output_kind == "blob":
        message = ToolInvokeMessage(
            type=kind.BLOB,
            message=ToolInvokeMessage.BlobMessage(blob=b"synthetic"),
            meta={"mime_type": "text/plain", "filename": "sample.txt"},
        )
    elif output_kind in {"file", "file_mapping"}:
        file = File(
            file_type=FileType.DOCUMENT,
            transfer_method=FileTransferMethod.TOOL_FILE,
            reference=build_file_reference(record_id="output-id"),
            filename="sample.txt",
            extension=".txt",
            mime_type="text/plain",
            size=7,
        )
        message = ToolInvokeMessage(
            type=kind.FILE,
            message=ToolInvokeMessage.FileMessage(file_marker="file_marker"),
            meta={"file": file if output_kind == "file" else file.model_dump(mode="json")},
        )
    else:
        message = ToolInvokeMessage(
            type=kind(output_kind),
            message=ToolInvokeMessage.TextMessage(
                text={
                    "text": "text output",
                    "link": "https://example.test/result",
                    "image": "https://example.test/image.png",
                }[output_kind]
            ),
        )
    tool = _ordinary_plugin([], {})
    stored = ToolFile(
        user_id="user",
        tenant_id="tenant",
        conversation_id=None,
        file_key="file",
        name="sample.png" if output_kind == "image" else "sample.txt",
        mimetype="image/png" if output_kind == "image" else "text/plain",
    )
    stored.id = "output-id"
    with (
        patch("services.agent_tool_inner_service.ToolManager.get_agent_tool_runtime", return_value=tool),
        patch("core.tools.plugin_tool.tool.PluginToolManager.invoke", return_value=iter([message])),
        patch(
            "core.tools.utils.message_transformer.ToolFileManager.create_file_by_url", return_value=stored
        ) as download,
        patch("core.tools.utils.message_transformer.ToolFileManager.create_file_by_raw", return_value=stored) as upload,
    ):
        response = AgentToolInnerService().invoke(_request(), session=sqlite_session)
    assert observation in response.observation
    assert [item["type"] for item in response.messages] == ([expected_type] if expected_type else [])
    assert download.call_count == (output_kind == "image")
    assert upload.call_count == (output_kind == "blob")
    for call in download.call_args_list + upload.call_args_list:
        assert call.kwargs["tenant_id"] == TENANT_ID
        assert call.kwargs["user_id"] == USER_ID
        assert call.kwargs["conversation_id"] == "conversation-1"
    if output_kind in {"image", "blob", "file"}:
        meta = response.messages[0]["meta"]
        assert isinstance(meta, dict)
        assert meta["tool_file_id"] == "output-id"
    if output_kind == "file_mapping":
        assert response.observation == ""  # A raw JSON file meta mapping is not an API graphon File.
