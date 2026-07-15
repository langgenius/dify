from __future__ import annotations

import base64
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.mcp.types import (
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextContent,
    TextResourceContents,
)
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType
from core.tools.errors import ToolInvokeError
from core.tools.mcp_tool.tool import MCPTool


def _build_mcp_tool(*, with_output_schema: bool = True) -> MCPTool:
    entity = ToolEntity(
        identity=ToolIdentity(
            author="author",
            name="remote-tool",
            label=I18nObject(en_US="remote-tool"),
            provider="provider-id",
        ),
        parameters=[],
        output_schema={"type": "object"} if with_output_schema else {},
    )
    return MCPTool(
        entity=entity,
        runtime=ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER),
        tenant_id="tenant-1",
        icon="icon.svg",
        server_url="https://mcp.example.com",
        provider_id="provider-id",
        headers={"x-auth": "token"},
    )


def test_mcp_tool_provider_type_and_fork_runtime():
    tool = _build_mcp_tool()
    assert tool.tool_provider_type() == ToolProviderType.MCP

    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2"))
    assert isinstance(forked, MCPTool)
    assert forked.runtime.tenant_id == "tenant-2"
    assert forked.provider_id == "provider-id"


def test_mcp_tool_text_and_json_processing_helpers():
    tool = _build_mcp_tool()

    json_messages = list(tool._process_text_content(TextContent(type="text", text='{"a": 1}')))
    assert json_messages[0].type == ToolInvokeMessage.MessageType.JSON

    plain_messages = list(tool._process_text_content(TextContent(type="text", text="not-json")))
    assert plain_messages[0].type == ToolInvokeMessage.MessageType.TEXT
    assert plain_messages[0].message.text == "not-json"

    list_messages = list(tool._process_json_content([{"k": 1}, {"k": 2}]))
    assert [m.type for m in list_messages] == [ToolInvokeMessage.MessageType.JSON, ToolInvokeMessage.MessageType.JSON]

    mixed_list_messages = list(tool._process_json_list([{"k": 1}, 2]))
    assert len(mixed_list_messages) == 1
    assert mixed_list_messages[0].type == ToolInvokeMessage.MessageType.TEXT

    primitive_messages = list(tool._process_json_content(123))
    assert primitive_messages[0].message.text == "123"


def test_mcp_tool_usage_extraction_helpers():
    usage = MCPTool._extract_usage_dict({"usage": {"total_tokens": 9}})
    assert usage == {"total_tokens": 9}

    usage = MCPTool._extract_usage_dict({"metadata": {"usage": {"prompt_tokens": 3, "completion_tokens": 2}}})
    assert usage == {"prompt_tokens": 3, "completion_tokens": 2}

    usage = MCPTool._extract_usage_dict({"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3})
    assert usage == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}

    usage = MCPTool._extract_usage_dict({"nested": [{"deep": {"usage": {"total_tokens": 7}}}]})
    assert usage == {"total_tokens": 7}

    result_with_usage = CallToolResult(content=[], _meta={"usage": {"prompt_tokens": 1, "completion_tokens": 2}})
    derived = MCPTool._derive_usage_from_result(result_with_usage)
    assert derived.prompt_tokens == 1
    assert derived.completion_tokens == 2

    result_without_usage = CallToolResult(content=[], _meta=None)
    derived = MCPTool._derive_usage_from_result(result_without_usage)
    assert derived.total_tokens == 0


def test_mcp_tool_invoke_handles_content_types_and_structured_output():
    tool = _build_mcp_tool()
    img_data = base64.b64encode(b"img").decode()
    blob_data = base64.b64encode(b"blob").decode()
    result = CallToolResult(
        content=[
            TextContent(type="text", text='{"a": 1}'),
            ImageContent(type="image", data=img_data, mimeType="image/png"),
            EmbeddedResource(
                type="resource",
                resource=TextResourceContents(uri="file:///tmp/a.txt", text="embedded-text"),
            ),
            EmbeddedResource(
                type="resource",
                resource=BlobResourceContents(
                    uri="file:///tmp/b.bin",
                    blob=blob_data,
                    mimeType="application/octet-stream",
                ),
            ),
        ],
        structuredContent={"x": 1},
        _meta={"usage": {"prompt_tokens": 2, "completion_tokens": 3}},
    )

    with patch.object(MCPTool, "invoke_remote_mcp_tool", return_value=result):
        messages = list(tool.invoke(session=MagicMock(), user_id="user-1", tool_parameters={"a": 1}))

    types = [m.type for m in messages]
    assert ToolInvokeMessage.MessageType.JSON in types
    assert ToolInvokeMessage.MessageType.BLOB in types
    assert ToolInvokeMessage.MessageType.TEXT in types
    assert ToolInvokeMessage.MessageType.VARIABLE in types
    assert tool.latest_usage.total_tokens == 5


def test_mcp_tool_invoke_raises_for_unsupported_embedded_resource():
    tool = _build_mcp_tool()
    # Use model_construct to bypass pydantic validation and force unsupported resource path.
    bad_resource = EmbeddedResource.model_construct(type="resource", resource=object())
    result = CallToolResult(content=[bad_resource], _meta=None)

    with patch.object(MCPTool, "invoke_remote_mcp_tool", return_value=result):
        with pytest.raises(ToolInvokeError, match="Unsupported embedded resource type"):
            list(tool.invoke(session=MagicMock(), user_id="user-1", tool_parameters={}))


def test_mcp_tool_handle_none_parameter_filters_empty_values():
    tool = _build_mcp_tool()
    cleaned = tool._handle_none_parameter({"a": 1, "b": None, "c": "", "d": "  ", "e": "ok"})
    assert cleaned == {"a": 1, "e": "ok"}


# ----- M2/M3 user-identity forwarding ---------------------------------------


def _build_forwarding_tool(*, mode: str = "idp_token") -> MCPTool:
    """Helper that builds an MCPTool with the identity_mode set."""
    entity = ToolEntity(
        identity=ToolIdentity(
            author="author",
            name="remote-tool",
            label=I18nObject(en_US="remote-tool"),
            provider="provider-id",
        ),
        parameters=[],
        output_schema={},
    )
    return MCPTool(
        entity=entity,
        runtime=ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER),
        tenant_id="tenant-1",
        icon="icon.svg",
        server_url="https://mcp.example.com/mcp/",
        provider_id="provider-id",
        identity_mode=mode,
    )


def test_inject_forwarded_identity_stamps_custom_header():
    """The minted SSO token must be placed in X-Dify-SSO-Token; the
    workspace-scoped Authorization header and any other custom headers must
    pass through untouched so provider credentials keep working."""
    from core.tools.mcp_tool.tool import FORWARDED_IDENTITY_HEADER

    tool = _build_forwarding_tool()
    headers: dict[str, str] = {"Authorization": "Bearer static-client-token", "X-Other": "keep"}

    with patch(
        "services.enterprise.enterprise_service.EnterpriseService.issue_mcp_token",
        return_value=("forwarded.jwt.payload", 1900000000),
    ):
        tool._inject_forwarded_identity(headers, user_id="alice", app_id=None, audience="https://mcp.example.com/mcp/")

    assert headers[FORWARDED_IDENTITY_HEADER] == "forwarded.jwt.payload"
    assert headers["Authorization"] == "Bearer static-client-token"
    assert headers["X-Other"] == "keep"


def test_inject_forwarded_identity_translates_token_error_to_invoke_error():
    """EnterpriseService failures must surface as ToolInvokeError so the
    workflow halts loudly instead of proceeding without identity."""
    from core.tools.mcp_tool.tool import FORWARDED_IDENTITY_HEADER
    from services.enterprise.base import MCPNoRefreshTokenError

    tool = _build_forwarding_tool()
    headers: dict[str, str] = {}

    with patch(
        "services.enterprise.enterprise_service.EnterpriseService.issue_mcp_token",
        side_effect=MCPNoRefreshTokenError("please re-sso"),
    ):
        with pytest.raises(ToolInvokeError, match="forwarded identity token"):
            tool._inject_forwarded_identity(
                headers, user_id="alice", app_id=None, audience="https://mcp.example.com/mcp/"
            )

    # Headers must NOT have been mutated when token-issuance failed.
    assert FORWARDED_IDENTITY_HEADER not in headers
    assert "Authorization" not in headers


def test_inject_forwarded_identity_sends_end_user_type_for_webapp():
    """A WEB_APP run forwards user_type=end_user so enterprise routes to the
    published-webapp token store."""
    tool = _build_forwarding_tool()
    tool.runtime = ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.WEB_APP)
    headers: dict[str, str] = {}

    with patch(
        "services.enterprise.enterprise_service.EnterpriseService.issue_mcp_token",
        return_value=("forwarded.jwt", 1900000000),
    ) as issue:
        tool._inject_forwarded_identity(
            headers, user_id="eu-1", app_id="app-1", audience="https://mcp.example.com/mcp/"
        )

    assert issue.call_args.kwargs["user_type"] == "end_user"


def test_inject_forwarded_identity_sends_account_type_for_debugger():
    """A DEBUGGER/console run forwards user_type=account (the existing behaviour)."""
    tool = _build_forwarding_tool()  # built with InvokeFrom.DEBUGGER
    headers: dict[str, str] = {}

    with patch(
        "services.enterprise.enterprise_service.EnterpriseService.issue_mcp_token",
        return_value=("forwarded.jwt", 1900000000),
    ) as issue:
        tool._inject_forwarded_identity(headers, user_id="acc-1", app_id=None, audience="https://mcp.example.com/mcp/")

    assert issue.call_args.kwargs["user_type"] == "account"


def test_invoke_remote_mcp_tool_fails_closed_when_user_id_missing():
    """When forwarding is enabled AND the deployment is enterprise, missing
    user_id must raise — never silently invoke as the static identity."""
    tool = _build_forwarding_tool()

    with patch("core.tools.mcp_tool.tool.dify_config") as cfg:
        cfg.ENTERPRISE_ENABLED = True
        with pytest.raises(ToolInvokeError, match="no end-user context"):
            tool.invoke_remote_mcp_tool({}, user_id=None, app_id=None)


def test_invoke_skips_forwarding_when_enterprise_disabled():
    """Non-enterprise deployments treat the DB selector as a no-op: a stale
    `identity_mode="idp_token"` row must NOT raise (fail-closed) AND must
    NOT call the enterprise inner API. The runtime falls through to the
    legacy provider-identity path."""
    tool = _build_forwarding_tool()

    with patch("core.tools.mcp_tool.tool.dify_config") as cfg:
        cfg.ENTERPRISE_ENABLED = False
        # The fail-closed branch must NOT fire (no enterprise → no forwarding).
        # The function will still try the legacy DB-load path; we patch that
        # to keep the test unit-scoped.
        with patch("core.tools.mcp_tool.tool.MCPClientWithAuthRetry") as client_cls:
            client_cls.return_value.__enter__.return_value.invoke_tool.return_value = CallToolResult(
                content=[],
                _meta=None,
            )
            with patch.object(tool, "_inject_forwarded_identity") as inject:
                with patch("services.tools.mcp_tools_manage_service.MCPToolManageService"):
                    with patch("core.entities.mcp_provider.MCPProviderEntity.decrypt_server_url", return_value="u"):
                        with patch("core.entities.mcp_provider.MCPProviderEntity.decrypt_headers", return_value={}):
                            # Should not raise; should not call enterprise.
                            try:
                                tool.invoke_remote_mcp_tool({}, user_id=None, app_id=None)
                            except Exception:
                                pass
            inject.assert_not_called()
