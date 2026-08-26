"""Unit tests for MCP provider get_provider logic."""

from unittest.mock import MagicMock
import uuid

import pytest
from services.tools.mcp_tools_manage_service import MCPToolManageService
from models.tools import MCPToolProvider


def test_get_provider_with_non_uuid_identifier():
    """Verify that non-UUID provider_id falls back to server_identifier query."""
    mock_session = MagicMock()
    mock_provider = MCPToolProvider(
        name="Test MCP",
        server_identifier="my-mcp-server",
        server_url="https://example.com",
        server_url_hash="hash",
        icon="icon",
        tenant_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
    )
    mock_session.scalar.return_value = mock_provider

    service = MCPToolManageService(session=mock_session)
    provider = service.get_provider(provider_id="my-mcp-server", tenant_id=mock_provider.tenant_id)

    assert provider == mock_provider
    mock_session.scalar.assert_called_once()


def test_get_provider_with_valid_uuid():
    """Verify that valid UUID provider_id queries by id column."""
    mock_session = MagicMock()
    test_id = str(uuid.uuid4())
    mock_provider = MCPToolProvider(
        name="Test MCP",
        server_identifier="my-mcp-server",
        server_url="https://example.com",
        server_url_hash="hash",
        icon="icon",
        tenant_id=str(uuid.uuid4()),
        user_id=str(uuid.uuid4()),
    )
    mock_session.scalar.return_value = mock_provider

    service = MCPToolManageService(session=mock_session)
    provider = service.get_provider(provider_id=test_id, tenant_id=mock_provider.tenant_id)

    assert provider == mock_provider
    mock_session.scalar.assert_called_once()
