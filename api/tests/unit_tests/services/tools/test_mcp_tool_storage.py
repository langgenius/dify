from core.mcp.types import Tool as MCPTool
from services.tools.mcp_tools_manage_service import serialize_mcp_tool_for_storage


def test_serialize_mcp_tool_omits_null_optional_fields() -> None:
    tool = MCPTool(
        name="web_search_exa",
        description=None,
        inputSchema={"type": "object", "properties": {}},
    )

    data = serialize_mcp_tool_for_storage(tool)

    assert data["name"] == "web_search_exa"
    assert data["description"] == ""
    assert "title" not in data
    assert "outputSchema" not in data
    assert "_meta" not in data
