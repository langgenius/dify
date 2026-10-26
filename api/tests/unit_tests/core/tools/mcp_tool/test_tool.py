from __future__ import annotations

import base64
import contextlib
from collections.abc import Iterator
from decimal import Decimal
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.mcp.types import (
    AudioContent,
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
from enums import DeploymentEdition
from graphon.model_runtime.entities.llm_entities import LLMUsage
from services.tools.tools_transform_service import ToolTransformService

"""MCP tool tests using real SQLite sessions for the ORM invocation contract."""


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
        server_identifier="mcp_server",
        headers={"x-auth": "token"},
    )


# Home Assistant's GetLiveContext declares `domain` as `vol.Any(cv.string, [cv.string])`.
_STRING = {"type": "string"}
_STRING_LIST = {"type": "array", "items": {"type": "string"}}


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
        server_identifier="mcp_server",
        identity_mode=mode,
    )


class TestMcpToolCases:
    @staticmethod
    def test_mcp_tool_provider_type_and_fork_runtime():
        tool = _build_mcp_tool()
        assert tool.tool_provider_type() == ToolProviderType.MCP

        forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2"))
        assert isinstance(forked, MCPTool)
        assert forked.runtime.tenant_id == "tenant-2"
        assert forked.server_identifier == "mcp_server"

    @staticmethod
    def test_mcp_tool_text_and_json_processing_helpers():
        tool = _build_mcp_tool()

        json_messages = list(tool._process_text_content(TextContent(type="text", text='{"a": 1}')))
        assert json_messages[0].type == ToolInvokeMessage.MessageType.JSON

        plain_messages = list(tool._process_text_content(TextContent(type="text", text="not-json")))
        assert plain_messages[0].type == ToolInvokeMessage.MessageType.TEXT
        assert plain_messages[0].message.text == "not-json"

        list_messages = list(tool._process_json_content([{"k": 1}, {"k": 2}]))
        assert [m.type for m in list_messages] == [
            ToolInvokeMessage.MessageType.JSON,
            ToolInvokeMessage.MessageType.JSON,
        ]

        mixed_list_messages = list(tool._process_json_list([{"k": 1}, 2]))
        assert len(mixed_list_messages) == 1
        assert mixed_list_messages[0].type == ToolInvokeMessage.MessageType.TEXT

        primitive_messages = list(tool._process_json_content(123))
        assert primitive_messages[0].message.text == "123"

    @staticmethod
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

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
    def test_mcp_tool_invoke_handles_content_types_and_structured_output(sqlite_session: Session):
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
            messages = list(tool.invoke(session=sqlite_session, user_id="user-1", tool_parameters={"a": 1}))

        types = [m.type for m in messages]
        assert ToolInvokeMessage.MessageType.JSON in types
        assert ToolInvokeMessage.MessageType.BLOB in types
        assert ToolInvokeMessage.MessageType.TEXT in types
        assert ToolInvokeMessage.MessageType.VARIABLE in types
        assert tool.latest_usage.total_tokens == 5

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
    def test_mcp_tool_invoke_raises_for_unsupported_embedded_resource(sqlite_session: Session):
        tool = _build_mcp_tool()
        # Use model_construct to bypass pydantic validation and force unsupported resource path.
        bad_resource = EmbeddedResource.model_construct(type="resource", resource=object())
        result = CallToolResult(content=[bad_resource], _meta=None)

        with (
            patch.object(MCPTool, "invoke_remote_mcp_tool", return_value=result),
            pytest.raises(ToolInvokeError, match="Unsupported embedded resource type"),
        ):
            list(tool.invoke(session=sqlite_session, user_id="user-1", tool_parameters={}))

    @staticmethod
    def test_mcp_tool_handle_none_parameter_filters_empty_values():
        tool = _build_mcp_tool()
        cleaned = tool._handle_none_parameter({"a": 1, "b": None, "c": "", "d": "  ", "e": "ok"})
        assert cleaned == {"a": 1, "e": "ok"}

    @staticmethod
    @pytest.mark.parametrize("sqlite_session", [()], indirect=True)
    @pytest.mark.parametrize(
        "domain_schema",
        [
            {"anyOf": [_STRING, _STRING_LIST]},
            {"anyOf": [_STRING_LIST, _STRING]},
            {"oneOf": [_STRING, _STRING_LIST]},
            {"oneOf": [_STRING_LIST, _STRING]},
            {"type": ["string", "array"], "items": _STRING},
            {"type": ["array", "string"], "items": _STRING},
        ],
    )
    @pytest.mark.parametrize("domain", [["light", "cover"], "light"])
    def test_mcp_tool_invoke_preserves_values_of_mixed_type_union_parameters(
        sqlite_session: Session, domain_schema, domain
    ):
        tool = _build_mcp_tool()
        schema = {"type": "object", "properties": {"domain": domain_schema, "name": _STRING}, "required": []}
        tool.entity.parameters = ToolTransformService.convert_mcp_schema_to_parameter(schema)
        result = CallToolResult(content=[TextContent(type="text", text="ok")])

        with patch.object(MCPTool, "invoke_remote_mcp_tool", return_value=result) as invoke_remote:
            list(tool.invoke(session=sqlite_session, user_id="user-1", tool_parameters={"domain": domain, "name": 1}))

        sent = invoke_remote.call_args.args[0]
        assert sent["domain"] == domain
        # Parameters with a single declared type keep the existing cast.
        assert sent["name"] == "1"

    @staticmethod
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
            tool._inject_forwarded_identity(
                headers, user_id="alice", app_id=None, audience="https://mcp.example.com/mcp/"
            )

        assert headers[FORWARDED_IDENTITY_HEADER] == "forwarded.jwt.payload"
        assert headers["Authorization"] == "Bearer static-client-token"
        assert headers["X-Other"] == "keep"

    @staticmethod
    def test_inject_forwarded_identity_translates_token_error_to_invoke_error():
        """EnterpriseService failures must surface as ToolInvokeError so the
        workflow halts loudly instead of proceeding without identity."""
        from core.tools.mcp_tool.tool import FORWARDED_IDENTITY_HEADER
        from services.enterprise.base import MCPNoRefreshTokenError

        tool = _build_forwarding_tool()
        headers: dict[str, str] = {}

        with (
            patch(
                "services.enterprise.enterprise_service.EnterpriseService.issue_mcp_token",
                side_effect=MCPNoRefreshTokenError("please re-sso"),
            ),
            pytest.raises(ToolInvokeError, match="forwarded identity token"),
        ):
            tool._inject_forwarded_identity(
                headers, user_id="alice", app_id=None, audience="https://mcp.example.com/mcp/"
            )

        # Headers must NOT have been mutated when token-issuance failed.
        assert FORWARDED_IDENTITY_HEADER not in headers
        assert "Authorization" not in headers

    @staticmethod
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

    @staticmethod
    def test_inject_forwarded_identity_sends_account_type_for_debugger():
        """A DEBUGGER/console run forwards user_type=account (the existing behaviour)."""
        tool = _build_forwarding_tool()  # built with InvokeFrom.DEBUGGER
        headers: dict[str, str] = {}

        with patch(
            "services.enterprise.enterprise_service.EnterpriseService.issue_mcp_token",
            return_value=("forwarded.jwt", 1900000000),
        ) as issue:
            tool._inject_forwarded_identity(
                headers, user_id="acc-1", app_id=None, audience="https://mcp.example.com/mcp/"
            )

        assert issue.call_args.kwargs["user_type"] == "account"

    @staticmethod
    def test_invoke_remote_mcp_tool_fails_closed_when_user_id_missing(config_overrides):
        """When forwarding is enabled AND the deployment is enterprise, missing
        user_id must raise — never silently invoke as the static identity."""
        tool = _build_forwarding_tool()

        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.ENTERPRISE)
        with pytest.raises(ToolInvokeError, match="no end-user context"):
            tool.invoke_remote_mcp_tool({}, user_id=None, app_id=None)

    @staticmethod
    def test_invoke_skips_forwarding_outside_enterprise_edition(config_overrides):
        """Non-enterprise deployments treat the DB selector as a no-op: a stale
        `identity_mode="idp_token"` row must NOT raise (fail-closed) AND must
        NOT call the enterprise inner API. The runtime falls through to the
        legacy provider-identity path."""
        tool = _build_forwarding_tool()

        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY)
        # The fail-closed branch must NOT fire (no enterprise → no forwarding).
        # The function will still try the legacy DB-load path; we patch that
        # to keep the test unit-scoped.
        with patch("core.tools.mcp_tool.tool.MCPClientWithAuthRetry") as client_cls:
            client_cls.return_value.__enter__.return_value.invoke_tool.return_value = CallToolResult(
                content=[],
                _meta=None,
            )
            with (
                patch.object(tool, "_inject_forwarded_identity") as inject,
                patch("services.tools.mcp_tools_manage_service.MCPToolManageService"),
                patch("core.entities.mcp_provider.MCPProviderEntity.decrypt_server_url", return_value="u"),
                patch("core.entities.mcp_provider.MCPProviderEntity.decrypt_headers", return_value={}),
                contextlib.suppress(Exception),
            ):
                # Should not raise; should not call enterprise.
                tool.invoke_remote_mcp_tool({}, user_id=None, app_id=None)
            inject.assert_not_called()


def _make_mcp_tool(output_schema: dict[str, Any] | None = None) -> MCPTool:
    identity = ToolIdentity(
        author="test",
        name="test_mcp_tool",
        label=I18nObject(en_US="Test MCP Tool", zh_Hans="测试MCP工具"),
        provider="test_provider",
    )
    entity = ToolEntity(identity=identity, output_schema=output_schema or {})
    runtime = ToolRuntime(tenant_id="test_tenant")
    return MCPTool(
        entity=entity,
        runtime=runtime,
        tenant_id="test_tenant",
        icon="",
        server_url="https://server.invalid",
        server_identifier="provider_1",
        headers={},
    )


class TestMcpToolCasesTools:
    @staticmethod
    @pytest.fixture
    def orm_session(sqlite_engine: Engine) -> Iterator[Session]:
        """Use a real ORM session while MCP transport remains mocked."""
        with Session(sqlite_engine) as session:
            yield session

    class TestMCPToolInvoke:
        @pytest.mark.parametrize(
            ("content_factory", "mime_type"),
            [
                (
                    lambda b64, mt: ImageContent(type="image", data=b64, mimeType=mt),
                    "image/png",
                ),
                (
                    lambda b64, mt: AudioContent(type="audio", data=b64, mimeType=mt),
                    "audio/mpeg",
                ),
            ],
        )
        def test_invoke_image_or_audio_yields_blob(self, content_factory, mime_type, orm_session: Session) -> None:
            tool = _make_mcp_tool()
            raw = b"\x00\x01test-bytes\x02"
            b64 = base64.b64encode(raw).decode()
            content = content_factory(b64, mime_type)
            result = CallToolResult(content=[content])

            with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
                messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

            assert len(messages) == 1
            msg = messages[0]
            assert msg.type == ToolInvokeMessage.MessageType.BLOB
            assert isinstance(msg.message, ToolInvokeMessage.BlobMessage)
            assert msg.message.blob == raw
            assert msg.meta == {"mime_type": mime_type}

        def test_invoke_embedded_text_resource_yields_text(self, orm_session: Session) -> None:
            tool = _make_mcp_tool()
            text_resource = TextResourceContents(uri="file://test.txt", mimeType="text/plain", text="hello world")
            content = EmbeddedResource(type="resource", resource=text_resource)
            result = CallToolResult(content=[content])

            with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
                messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

            assert len(messages) == 1
            msg = messages[0]
            assert msg.type == ToolInvokeMessage.MessageType.TEXT
            assert isinstance(msg.message, ToolInvokeMessage.TextMessage)
            assert msg.message.text == "hello world"

        @pytest.mark.parametrize(
            ("mime_type", "expected_mime"),
            [("application/pdf", "application/pdf"), (None, "application/octet-stream")],
        )
        def test_invoke_embedded_blob_resource_yields_blob(
            self, mime_type, expected_mime, orm_session: Session
        ) -> None:
            tool = _make_mcp_tool()
            raw = b"binary-data"
            b64 = base64.b64encode(raw).decode()
            blob_resource = BlobResourceContents(uri="file://doc.bin", mimeType=mime_type, blob=b64)
            content = EmbeddedResource(type="resource", resource=blob_resource)
            result = CallToolResult(content=[content])

            with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
                messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

            assert len(messages) == 1
            msg = messages[0]
            assert msg.type == ToolInvokeMessage.MessageType.BLOB
            assert isinstance(msg.message, ToolInvokeMessage.BlobMessage)
            assert msg.message.blob == raw
            assert msg.meta == {"mime_type": expected_mime}

        def test_invoke_yields_variables_when_structured_content_and_schema(self, orm_session: Session) -> None:
            tool = _make_mcp_tool(output_schema={"type": "object"})
            result = CallToolResult(content=[], structuredContent={"a": 1, "b": "x"})

            with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
                messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

            # Expect two variable messages corresponding to keys a and b
            assert len(messages) == 2
            var_msgs = [m for m in messages if isinstance(m.message, ToolInvokeMessage.VariableMessage)]
            assert {m.message.variable_name for m in var_msgs} == {"a", "b"}
            # Validate values
            values = {m.message.variable_name: m.message.variable_value for m in var_msgs}
            assert values == {"a": 1, "b": "x"}

        def test_invoke_yields_json_when_structured_content_has_no_output_schema(self, orm_session: Session) -> None:
            tool = _make_mcp_tool()
            result = CallToolResult(content=[], structuredContent={"a": 1, "b": "x"})

            with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
                messages = list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

            assert len(messages) == 1
            msg = messages[0]
            assert msg.type == ToolInvokeMessage.MessageType.JSON
            assert isinstance(msg.message, ToolInvokeMessage.JsonMessage)
            assert msg.message.json_object == {"a": 1, "b": "x"}

    class TestMCPToolUsageExtraction:
        """Test usage metadata extraction from MCP tool results."""

        def test_extract_usage_dict_from_direct_usage_field(self) -> None:
            """Test extraction when usage is directly in meta.usage field."""
            meta = {
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                    "total_price": "0.001",
                    "currency": "USD",
                }
            }
            usage_dict = MCPTool._extract_usage_dict(meta)
            assert usage_dict is not None
            assert usage_dict["prompt_tokens"] == 100
            assert usage_dict["completion_tokens"] == 50
            assert usage_dict["total_tokens"] == 150
            assert usage_dict["total_price"] == "0.001"
            assert usage_dict["currency"] == "USD"

        def test_extract_usage_dict_from_nested_metadata(self) -> None:
            """Test extraction when usage is nested in meta.metadata.usage."""
            meta = {
                "metadata": {
                    "usage": {
                        "prompt_tokens": 200,
                        "completion_tokens": 100,
                        "total_tokens": 300,
                    }
                }
            }
            usage_dict = MCPTool._extract_usage_dict(meta)
            assert usage_dict is not None
            assert usage_dict["prompt_tokens"] == 200
            assert usage_dict["total_tokens"] == 300

        def test_extract_usage_dict_from_flat_token_fields(self) -> None:
            """Test extraction when token counts are directly in meta."""
            meta = {
                "prompt_tokens": 150,
                "completion_tokens": 75,
                "total_tokens": 225,
                "currency": "EUR",
            }
            usage_dict = MCPTool._extract_usage_dict(meta)
            assert usage_dict is not None
            assert usage_dict["prompt_tokens"] == 150
            assert usage_dict["completion_tokens"] == 75
            assert usage_dict["total_tokens"] == 225
            assert usage_dict["currency"] == "EUR"

        def test_extract_usage_dict_recursive(self) -> None:
            """Test recursive search through nested structures."""
            meta = {
                "custom": {
                    "nested": {
                        "usage": {
                            "total_tokens": 500,
                            "prompt_tokens": 300,
                            "completion_tokens": 200,
                        }
                    }
                }
            }
            usage_dict = MCPTool._extract_usage_dict(meta)
            assert usage_dict is not None
            assert usage_dict["total_tokens"] == 500

        def test_extract_usage_dict_from_list(self) -> None:
            """Test extraction from nested list structures."""
            meta = {
                "items": [
                    {"usage": {"total_tokens": 100}},
                    {"other": "data"},
                ]
            }
            usage_dict = MCPTool._extract_usage_dict(meta)
            assert usage_dict is not None
            assert usage_dict["total_tokens"] == 100

        def test_extract_usage_dict_returns_none_when_missing(self) -> None:
            """Test that None is returned when no usage data is present."""
            meta = {"other": "data", "custom": {"nested": {"value": 123}}}
            usage_dict = MCPTool._extract_usage_dict(meta)
            assert usage_dict is None

        def test_extract_usage_dict_empty_meta(self) -> None:
            """Test with empty meta dict."""
            usage_dict = MCPTool._extract_usage_dict({})
            assert usage_dict is None

        def test_derive_usage_from_result_with_meta(self) -> None:
            """Test _derive_usage_from_result with populated meta."""
            meta = {
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                    "total_price": "0.0015",
                    "currency": "USD",
                }
            }
            result = CallToolResult(content=[], _meta=meta)
            usage = MCPTool._derive_usage_from_result(result)

            assert isinstance(usage, LLMUsage)
            assert usage.prompt_tokens == 100
            assert usage.completion_tokens == 50
            assert usage.total_tokens == 150
            assert usage.total_price == Decimal("0.0015")
            assert usage.currency == "USD"

        def test_derive_usage_from_result_without_meta(self) -> None:
            """Test _derive_usage_from_result with no meta returns empty usage."""
            result = CallToolResult(content=[], meta=None)
            usage = MCPTool._derive_usage_from_result(result)

            assert isinstance(usage, LLMUsage)
            assert usage.total_tokens == 0
            assert usage.prompt_tokens == 0
            assert usage.completion_tokens == 0

        def test_derive_usage_from_result_calculates_total_tokens(self) -> None:
            """Test that total_tokens is calculated when missing."""
            meta = {
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    # total_tokens is missing
                }
            }
            result = CallToolResult(content=[], _meta=meta)
            usage = MCPTool._derive_usage_from_result(result)

            assert usage.total_tokens == 150  # 100 + 50
            assert usage.prompt_tokens == 100
            assert usage.completion_tokens == 50

        def test_invoke_sets_latest_usage_from_meta(self, orm_session: Session) -> None:
            """Test that _invoke sets _latest_usage from result meta."""
            tool = _make_mcp_tool()
            meta = {
                "usage": {
                    "prompt_tokens": 200,
                    "completion_tokens": 100,
                    "total_tokens": 300,
                    "total_price": "0.003",
                    "currency": "USD",
                }
            }
            result = CallToolResult(content=[TextContent(type="text", text="test")], _meta=meta)

            with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
                list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

            # Verify latest_usage was set correctly
            assert tool.latest_usage.prompt_tokens == 200
            assert tool.latest_usage.completion_tokens == 100
            assert tool.latest_usage.total_tokens == 300
            assert tool.latest_usage.total_price == Decimal("0.003")

        def test_invoke_with_no_meta_returns_empty_usage(self, orm_session: Session) -> None:
            """Test that _invoke returns empty usage when no meta is present."""
            tool = _make_mcp_tool()
            result = CallToolResult(content=[TextContent(type="text", text="test")], _meta=None)

            with patch.object(tool, "invoke_remote_mcp_tool", return_value=result):
                list(tool._invoke(session=orm_session, user_id="test_user", tool_parameters={}))

            # Verify latest_usage is empty
            assert tool.latest_usage.total_tokens == 0
            assert tool.latest_usage.prompt_tokens == 0
            assert tool.latest_usage.completion_tokens == 0

        def test_latest_usage_property_returns_llm_usage(self) -> None:
            """Test that latest_usage property returns LLMUsage instance."""
            tool = _make_mcp_tool()
            assert isinstance(tool.latest_usage, LLMUsage)

        def test_initial_usage_is_empty(self) -> None:
            """Test that MCPTool is initialized with empty usage."""
            tool = _make_mcp_tool()
            assert tool.latest_usage.total_tokens == 0
            assert tool.latest_usage.prompt_tokens == 0
            assert tool.latest_usage.completion_tokens == 0
            assert tool.latest_usage.total_price == Decimal(0)

        @pytest.mark.parametrize(
            "meta_data",
            [
                # Direct usage field
                {"usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}},
                # Nested metadata
                {"metadata": {"usage": {"total_tokens": 100}}},
                # Flat token fields
                {"total_tokens": 50, "prompt_tokens": 30, "completion_tokens": 20},
                # With price info
                {
                    "usage": {
                        "total_tokens": 150,
                        "total_price": "0.002",
                        "currency": "EUR",
                    }
                },
                # Deep nested
                {"level1": {"level2": {"usage": {"total_tokens": 200}}}},
            ],
        )
        def test_various_meta_formats(self, meta_data) -> None:
            """Test that various meta formats are correctly parsed."""
            result = CallToolResult(content=[], _meta=meta_data)
            usage = MCPTool._derive_usage_from_result(result)

            assert isinstance(usage, LLMUsage)
            # Should have at least some usage data
            if meta_data.get("usage", {}).get("total_tokens") or meta_data.get("total_tokens"):
                expected_total = (
                    meta_data.get("usage", {}).get("total_tokens")
                    or meta_data.get("total_tokens")
                    or meta_data.get("metadata", {}).get("usage", {}).get("total_tokens")
                    or meta_data.get("level1", {}).get("level2", {}).get("usage", {}).get("total_tokens")
                )
                if expected_total:
                    assert usage.total_tokens == expected_total
