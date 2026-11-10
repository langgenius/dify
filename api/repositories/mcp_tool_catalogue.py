"""Tenant-scoped cached MCP declarations, without secret or network access.

The native MCP schema converter owns parameter mapping. Discovery selects only
public columns, preserves the server identifier used by ToolManager, and treats
cached authentication as configuration evidence, never live runtime success.
"""

import json
import logging
from typing import TYPE_CHECKING

from jsonschema import Draft202012Validator, SchemaError
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.mcp.types import Tool as RemoteMCPTool
from core.tools.mcp_tool.provider import MCPToolProviderController
from models.tools import MCPToolProvider

if TYPE_CHECKING:
    from core.workflow.generator.tool_catalogue import ToolCatalogueEntry

logger = logging.getLogger(__name__)


def list_mcp_tool_metadata(tenant_id: str) -> list["ToolCatalogueEntry"]:
    """Return owned public cached actions; malformed providers/actions are omitted.

    Requires an admitted workspace identity. Every query is tenant scoped and
    reads no URL, header, credential or creator columns. No remote refresh,
    decryption or authorization occurs; source query failures propagate for the
    caller to report an incomplete inventory. MCP's native owner exposes these
    providers workspace-wide, independently of builtin credential visibility.
    """
    statement = select(
        MCPToolProvider.tenant_id,
        MCPToolProvider.server_identifier,
        MCPToolProvider.name,
        MCPToolProvider.tools,
        MCPToolProvider.authed,
    ).where(MCPToolProvider.tenant_id == tenant_id)
    with session_factory.create_session() as session:
        rows = session.execute(statement).mappings().all()

    entries: list[ToolCatalogueEntry] = []
    for row in rows:
        try:
            server = row["server_identifier"]
            if row["tenant_id"] != tenant_id or not isinstance(server, str) or not server.strip():
                raise ValueError("Invalid MCP provider identity")
            if not isinstance(row["name"], str):
                raise ValueError("Invalid MCP provider label")
            tools = json.loads(row["tools"])
            if not isinstance(tools, list):
                raise ValueError("Invalid cached MCP declarations")
        except (TypeError, ValueError):
            logger.warning("Workflow generator: invalid public MCP provider metadata; skipping provider")
        else:
            for raw_tool in tools:
                try:
                    tool = RemoteMCPTool.model_validate(raw_tool)
                    if not tool.name.strip():
                        raise ValueError("Invalid MCP action identity")
                    Draft202012Validator.check_schema(tool.inputSchema)
                    if tool.outputSchema is not None:
                        Draft202012Validator.check_schema(tool.outputSchema)
                    parameters = MCPToolProviderController.parameters_from_schema(tool.inputSchema)
                    entries.append(
                        {
                            "provider_name": server,
                            "provider_type": "mcp",
                            "plugin_id": "",
                            "provider_label": row["name"],
                            "tool_name": tool.name,
                            "tool_label": tool.title or tool.name,
                            "description": tool.description or "",
                            "parameters": [parameter.model_dump(mode="json") for parameter in parameters],
                            "input_schema": tool.inputSchema,
                            "output_schema": tool.outputSchema or {},
                            "needs_credentials": True,
                            "mcp_cached_auth": row["authed"] is True,
                        }
                    )
                except (TypeError, ValueError, AttributeError, SchemaError):
                    # Do not log raw declarations or validation exceptions: a
                    # malformed cached declaration may contain arbitrary text.
                    logger.warning("Workflow generator: invalid public MCP action metadata; skipping action")
    return entries
