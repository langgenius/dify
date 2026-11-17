"""Real MCP provider fixtures for authentication tests."""

from datetime import datetime

from core.entities.mcp_provider import MCPProviderEntity


def make_provider(credentials: dict[str, object]) -> MCPProviderEntity:
    return MCPProviderEntity(
        id="provider-id",
        tenant_id="tenant-id",
        user_id="user-id",
        server_identifier="test-server",
        name="Test server",
        server_url="https://api.example.com",
        headers={},
        timeout=30,
        sse_read_timeout=300,
        authed=False,
        credentials=credentials,
        tools=[],
        icon="",
        created_at=datetime(2024, 1, 1),
        updated_at=datetime(2024, 1, 1),
    )
