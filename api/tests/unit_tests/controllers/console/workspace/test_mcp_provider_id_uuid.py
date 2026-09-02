"""Regression tests for #41649.

The MCP provider Pydantic payloads used to accept any string as
``provider_id``. The PUT/DELETE/auth endpoints would then pass that
string to SQLAlchemy, which raised a Postgres
``InvalidTextRepresentation: invalid input syntax for type uuid: "fast-mcp"``
and bubbled back as a generic 500. The fix validates ``provider_id`` as
a UUID at the Pydantic layer so the API returns a clean 400 instead.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.console.workspace.tool_providers import (
    MCPAuthPayload,
    MCPProviderDeletePayload,
    MCPProviderUpdatePayload,
)

_UUID = "11111111-2222-3333-4444-555555555555"


class TestMCPProviderUpdatePayloadProviderIdIsUUID:
    def test_accepts_valid_uuid(self):
        payload = MCPProviderUpdatePayload(
            provider_id=_UUID,
            server_url="https://example.test",
            name="n",
            icon="i",
            icon_type="emoji",
            server_identifier="fast-mcp",
        )
        assert payload.provider_id == _UUID

    def test_rejects_non_uuid_string(self):
        with pytest.raises(ValidationError) as exc_info:
            MCPProviderUpdatePayload(
                provider_id="fast-mcp",
                server_url="https://example.test",
                name="n",
                icon="i",
                icon_type="emoji",
                server_identifier="fast-mcp",
            )
        assert "provider_id" in str(exc_info.value)

    def test_rejects_empty_string(self):
        with pytest.raises(ValidationError) as exc_info:
            MCPProviderUpdatePayload(
                provider_id="",
                server_url="https://example.test",
                name="n",
                icon="i",
                icon_type="emoji",
                server_identifier="fast-mcp",
            )
        assert "provider_id" in str(exc_info.value)


class TestMCPProviderDeletePayloadProviderIdIsUUID:
    def test_accepts_valid_uuid(self):
        assert MCPProviderDeletePayload(provider_id=_UUID).provider_id == _UUID

    def test_rejects_non_uuid_string(self):
        with pytest.raises(ValidationError) as exc_info:
            MCPProviderDeletePayload(provider_id="not-a-uuid")
        assert "provider_id" in str(exc_info.value)


class TestMCPAuthPayloadProviderIdIsUUID:
    def test_accepts_valid_uuid(self):
        assert MCPAuthPayload(provider_id=_UUID).provider_id == _UUID

    def test_rejects_non_uuid_string(self):
        with pytest.raises(ValidationError) as exc_info:
            MCPAuthPayload(provider_id="not-a-uuid")
        assert "provider_id" in str(exc_info.value)
