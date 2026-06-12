from __future__ import annotations

import base64
import json
import logging
from collections.abc import Generator, Mapping
from typing import Any, cast, override

from configs import dify_config
from core.entities.mcp_provider import IdentityMode
from core.mcp.auth_client import MCPClientWithAuthRetry
from core.mcp.error import MCPConnectionError
from core.mcp.types import (
    AudioContent,
    BlobResourceContents,
    CallToolResult,
    EmbeddedResource,
    ImageContent,
    TextContent,
    TextResourceContents,
)
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.tool_entities import ToolEntity, ToolInvokeMessage, ToolProviderType
from core.tools.errors import ToolInvokeError
from graphon.model_runtime.entities.llm_entities import LLMUsage, LLMUsageMetadata

logger = logging.getLogger(__name__)

# Custom header used to carry the forwarded SSO access token. Picked to avoid
# stomping on the workspace-scoped Authorization header (provider OAuth /
# user-supplied custom credentials), which would silently break those flows.
FORWARDED_IDENTITY_HEADER = "X-Dify-SSO-Token"


class MCPTool(Tool):
    def __init__(
        self,
        entity: ToolEntity,
        runtime: ToolRuntime,
        tenant_id: str,
        icon: str,
        server_url: str,
        provider_id: str,
        headers: dict[str, str] | None = None,
        timeout: float | None = None,
        sse_read_timeout: float | None = None,
        identity_mode: IdentityMode = IdentityMode.OFF,
    ):
        super().__init__(entity, runtime)
        self.tenant_id = tenant_id
        self.icon = icon
        self.server_url = server_url
        self.provider_id = provider_id
        self.headers = headers or {}
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout
        self.identity_mode: IdentityMode = identity_mode
        self._latest_usage = LLMUsage.empty_usage()

    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.MCP

    @override
    def _invoke(
        self,
        user_id: str,
        tool_parameters: dict[str, Any],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        result = self.invoke_remote_mcp_tool(tool_parameters, user_id=user_id, app_id=app_id)

        # Extract usage metadata from MCP protocol's _meta field
        self._latest_usage = self._derive_usage_from_result(result)

        # handle dify tool output
        for content in result.content:
            match content:
                case TextContent():
                    yield from self._process_text_content(content)
                case ImageContent() | AudioContent():
                    yield self.create_blob_message(
                        blob=base64.b64decode(content.data), meta={"mime_type": content.mimeType}
                    )
                case EmbeddedResource():
                    resource = content.resource
                    match resource:
                        case TextResourceContents():
                            yield self.create_text_message(resource.text)
                        case BlobResourceContents():
                            mime_type = resource.mimeType or "application/octet-stream"
                            yield self.create_blob_message(
                                blob=base64.b64decode(resource.blob), meta={"mime_type": mime_type}
                            )
                        case _:
                            raise ToolInvokeError(f"Unsupported embedded resource type: {type(resource)}")
                case _:
                    logger.warning("Unsupported content type=%s", type(content))

        # handle MCP structured output
        if self.entity.output_schema and result.structuredContent:
            for k, v in result.structuredContent.items():
                yield self.create_variable_message(k, v)

    def _process_text_content(self, content: TextContent) -> Generator[ToolInvokeMessage, None, None]:
        """Process text content and yield appropriate messages."""
        # Check if content looks like JSON before attempting to parse
        text = content.text.strip()
        if text and text[0] in ("{", "[") and text[-1] in ("}", "]"):
            try:
                content_json = json.loads(text)
                yield from self._process_json_content(content_json)
                return
            except json.JSONDecodeError:
                pass

        # If not JSON or parsing failed, treat as plain text
        yield self.create_text_message(content.text)

    def _process_json_content(self, content_json: Any) -> Generator[ToolInvokeMessage, None, None]:
        """Process JSON content based on its type."""
        if isinstance(content_json, dict):
            yield self.create_json_message(content_json)
        elif isinstance(content_json, list):
            yield from self._process_json_list(content_json)
        else:
            # For primitive types (str, int, bool, etc.), convert to string
            yield self.create_text_message(str(content_json))

    def _process_json_list(self, json_list: list) -> Generator[ToolInvokeMessage, None, None]:
        """Process a list of JSON items."""
        if any(not isinstance(item, dict) for item in json_list):
            # If the list contains any non-dict item, treat the entire list as a text message.
            yield self.create_text_message(str(json_list))
            return

        # Otherwise, process each dictionary as a separate JSON message.
        for item in json_list:
            yield self.create_json_message(item)

    @property
    def latest_usage(self) -> LLMUsage:
        return self._latest_usage

    @classmethod
    def _derive_usage_from_result(cls, result: CallToolResult) -> LLMUsage:
        """
        Extract usage metadata from MCP tool result's _meta field.

        The MCP protocol's _meta field (aliased as 'meta' in Python) can contain
        usage information such as token counts, costs, and other metadata.

        Args:
            result: The CallToolResult from MCP tool invocation

        Returns:
            LLMUsage instance with values from meta or empty_usage if not found
        """
        # Extract usage from the meta field if present
        if result.meta:
            usage_dict = cls._extract_usage_dict(result.meta)
            if usage_dict is not None:
                return LLMUsage.from_metadata(cast(LLMUsageMetadata, cast(object, dict(usage_dict))))

        return LLMUsage.empty_usage()

    @classmethod
    def _extract_usage_dict(cls, payload: Mapping[str, Any]) -> Mapping[str, Any] | None:
        """
        Recursively search for usage dictionary in the payload.

        The MCP protocol's _meta field can contain usage data in various formats:
        - Direct usage field: {"usage": {...}}
        - Nested in metadata: {"metadata": {"usage": {...}}}
        - Or nested within other fields

        Args:
            payload: The payload to search for usage data

        Returns:
            The usage dictionary if found, None otherwise
        """
        # Check for direct usage field
        usage_candidate = payload.get("usage")
        if isinstance(usage_candidate, Mapping):
            return usage_candidate

        # Check for metadata nested usage
        metadata_candidate = payload.get("metadata")
        if isinstance(metadata_candidate, Mapping):
            usage_candidate = metadata_candidate.get("usage")
            if isinstance(usage_candidate, Mapping):
                return usage_candidate

        # Check for common token counting fields directly in payload
        # Some MCP servers may include token counts directly
        if "total_tokens" in payload or "prompt_tokens" in payload or "completion_tokens" in payload:
            usage_dict: dict[str, Any] = {}
            for key in (
                "prompt_tokens",
                "completion_tokens",
                "total_tokens",
                "prompt_unit_price",
                "completion_unit_price",
                "total_price",
                "currency",
                "prompt_price_unit",
                "completion_price_unit",
                "prompt_price",
                "completion_price",
                "latency",
                "time_to_first_token",
                "time_to_generate",
            ):
                if key in payload:
                    usage_dict[key] = payload[key]
            if usage_dict:
                return usage_dict

        # Recursively search through nested structures
        for value in payload.values():
            if isinstance(value, Mapping):
                found = cls._extract_usage_dict(value)
                if found is not None:
                    return found
            elif isinstance(value, list) and not isinstance(value, (str, bytes, bytearray)):
                for item in value:
                    if isinstance(item, Mapping):
                        found = cls._extract_usage_dict(item)
                        if found is not None:
                            return found
        return None

    @override
    def fork_tool_runtime(self, runtime: ToolRuntime) -> MCPTool:
        return MCPTool(
            entity=self.entity,
            runtime=runtime,
            tenant_id=self.tenant_id,
            icon=self.icon,
            server_url=self.server_url,
            provider_id=self.provider_id,
            headers=self.headers,
            timeout=self.timeout,
            sse_read_timeout=self.sse_read_timeout,
            identity_mode=self.identity_mode,
        )

    def _handle_none_parameter(self, parameter: dict[str, Any]) -> dict[str, Any]:
        """
        in mcp tool invoke, if the parameter is empty, it will be set to None
        """
        return {
            key: value
            for key, value in parameter.items()
            if value is not None and not (isinstance(value, str) and value.strip() == "")
        }

    @property
    def _forwarding_requested(self) -> bool:
        """True only when the configured identity_mode wants forwarding AND
        the deployment actually has the enterprise side that can mint tokens.
        Non-enterprise installs treat the DB value as a no-op — a stale row
        won't trigger a 5xx against a missing inner-API endpoint."""
        return self.identity_mode != IdentityMode.OFF and dify_config.ENTERPRISE_ENABLED

    def invoke_remote_mcp_tool(
        self,
        tool_parameters: dict[str, Any],
        user_id: str | None = None,
        app_id: str | None = None,
    ) -> CallToolResult:
        # Fail closed: forwarding requires user_id (refuse before any DB I/O).
        if self._forwarding_requested and not user_id:
            raise ToolInvokeError(
                "Forward-user-identity is enabled for this MCP provider but no end-user context was supplied."
            )

        headers = self.headers.copy() if self.headers else {}
        tool_parameters = self._handle_none_parameter(tool_parameters)

        from sqlalchemy.orm import Session

        from extensions.ext_database import db
        from services.tools.mcp_tools_manage_service import MCPToolManageService

        # Step 1: Load provider entity and credentials in a short-lived session
        # This minimizes database connection hold time
        with Session(db.engine, expire_on_commit=False) as session:
            mcp_service = MCPToolManageService(session=session)
            provider_entity = mcp_service.get_provider_entity(self.provider_id, self.tenant_id, by_server_id=True)

            # Decrypt and prepare all credentials before closing session
            server_url = provider_entity.decrypt_server_url()
            headers = provider_entity.decrypt_headers()

            # Try to get existing token and add to headers
            if not headers:
                tokens = provider_entity.retrieve_tokens()
                if tokens and tokens.access_token:
                    headers["Authorization"] = f"{tokens.token_type.capitalize()} {tokens.access_token}"

        # Forwarded identity rides in a custom header so workspace-scoped
        # provider credentials (Authorization / custom Headers) keep working
        # untouched. The MCP server is expected to read X-Dify-SSO-Token
        # when identity forwarding is configured.
        forward_identity_active = False
        if self._forwarding_requested and user_id:
            self._inject_forwarded_identity(headers, user_id=user_id, app_id=app_id, audience=server_url)
            forward_identity_active = True

        # Step 2: Session is now closed, perform network operations without holding database connection
        # MCPClientWithAuthRetry will create a new session lazily only if auth retry is needed
        try:
            with MCPClientWithAuthRetry(
                server_url=server_url,
                headers=headers,
                timeout=self.timeout,
                sse_read_timeout=self.sse_read_timeout,
                provider_entity=provider_entity,
                forward_identity_active=forward_identity_active,
            ) as mcp_client:
                return mcp_client.invoke_tool(tool_name=self.entity.identity.name, tool_args=tool_parameters)
        except MCPConnectionError as e:
            raise ToolInvokeError(f"Failed to connect to MCP server: {e}") from e
        except Exception as e:
            raise ToolInvokeError(f"Failed to invoke tool: {e}") from e

    def _inject_forwarded_identity(
        self,
        headers: dict[str, str],
        *,
        user_id: str,
        app_id: str | None,
        audience: str,
    ) -> None:
        """Call the enterprise IssueMCPToken endpoint and stamp the issued
        token into X-Dify-SSO-Token.

        A custom header is used (rather than Authorization) so it composes
        with workspace-scoped provider credentials — the user may have OAuth
        tokens or a custom Authorization header configured on the MCP
        provider, and forwarding must not silently overwrite them.

        Errors are surfaced as ToolInvokeError so the workflow halts with a
        clear message instead of silently dropping identity and hitting the
        MCP server unauthenticated.
        """
        from services.enterprise.base import MCPTokenError
        from services.enterprise.enterprise_service import EnterpriseService

        try:
            token, _expires_at = EnterpriseService.issue_mcp_token(
                user_id=user_id,
                tenant_id=self.tenant_id,
                app_id=app_id,
                audience=audience,
            )
        except MCPTokenError as e:
            raise ToolInvokeError(f"Failed to obtain forwarded identity token: {e}") from e
        headers[FORWARDED_IDENTITY_HEADER] = token
