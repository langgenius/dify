import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import httpx


class MCPError(Exception):
    pass


class MCPConnectionError(MCPError):
    pass


class MCPAuthError(MCPConnectionError):
    def __init__(
        self,
        message: str | None = None,
        response: "httpx.Response | None" = None,
        www_authenticate_header: str | None = None,
    ):
        """
        MCP Authentication Error.

        Args:
            message: Error message
            response: HTTP response object (will extract WWW-Authenticate header if provided)
            www_authenticate_header: Pre-extracted WWW-Authenticate header value
        """
        super().__init__(message or "Authentication failed")

        # Extract OAuth metadata hints from WWW-Authenticate header
        if response is not None:
            www_authenticate_header = response.headers.get("WWW-Authenticate")

        self.resource_metadata_url: str | None = None
        self.scope_hint: str | None = None

        if www_authenticate_header:
            self.resource_metadata_url = self._extract_field(www_authenticate_header, "resource_metadata")
            self.scope_hint = self._extract_field(www_authenticate_header, "scope")

    @staticmethod
    def _extract_field(www_auth: str, field_name: str) -> str | None:
        """Extract a specific field from the WWW-Authenticate header."""
        # Pattern to match field="value" or field=value
        pattern = rf'{field_name}="([^"]*)"'
        match = re.search(pattern, www_auth)
        if match:
            return match.group(1)

        # Try without quotes
        pattern = rf"{field_name}=([^\s,]+)"
        match = re.search(pattern, www_auth)
        if match:
            return match.group(1)

        return None


class MCPRefreshTokenError(MCPError):
    pass
