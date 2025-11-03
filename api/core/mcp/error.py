class MCPError(Exception):
    pass


class MCPConnectionError(MCPError):
    pass


class MCPAuthError(MCPConnectionError):
    pass


class MCPRefreshTokenError(MCPError):
    pass
