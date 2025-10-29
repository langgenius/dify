"""Unit tests for MCP error classes."""

import pytest

from core.mcp.error import MCPAuthError, MCPConnectionError, MCPError, MCPRefreshTokenError


class TestMCPError:
    """Test MCPError base exception class."""

    def test_mcp_error_creation(self):
        """Test creating MCPError instance."""
        error = MCPError("Test error message")
        assert str(error) == "Test error message"
        assert isinstance(error, Exception)

    def test_mcp_error_inheritance(self):
        """Test MCPError inherits from Exception."""
        error = MCPError()
        assert isinstance(error, Exception)
        assert type(error).__name__ == "MCPError"

    def test_mcp_error_with_empty_message(self):
        """Test MCPError with empty message."""
        error = MCPError()
        assert str(error) == ""

    def test_mcp_error_raise(self):
        """Test raising MCPError."""
        with pytest.raises(MCPError) as exc_info:
            raise MCPError("Something went wrong")

        assert str(exc_info.value) == "Something went wrong"


class TestMCPConnectionError:
    """Test MCPConnectionError exception class."""

    def test_mcp_connection_error_creation(self):
        """Test creating MCPConnectionError instance."""
        error = MCPConnectionError("Connection failed")
        assert str(error) == "Connection failed"
        assert isinstance(error, MCPError)
        assert isinstance(error, Exception)

    def test_mcp_connection_error_inheritance(self):
        """Test MCPConnectionError inheritance chain."""
        error = MCPConnectionError()
        assert isinstance(error, MCPConnectionError)
        assert isinstance(error, MCPError)
        assert isinstance(error, Exception)

    def test_mcp_connection_error_raise(self):
        """Test raising MCPConnectionError."""
        with pytest.raises(MCPConnectionError) as exc_info:
            raise MCPConnectionError("Unable to connect to server")

        assert str(exc_info.value) == "Unable to connect to server"

    def test_mcp_connection_error_catch_as_mcp_error(self):
        """Test catching MCPConnectionError as MCPError."""
        with pytest.raises(MCPError) as exc_info:
            raise MCPConnectionError("Connection issue")

        assert isinstance(exc_info.value, MCPConnectionError)
        assert str(exc_info.value) == "Connection issue"


class TestMCPAuthError:
    """Test MCPAuthError exception class."""

    def test_mcp_auth_error_creation(self):
        """Test creating MCPAuthError instance."""
        error = MCPAuthError("Authentication failed")
        assert str(error) == "Authentication failed"
        assert isinstance(error, MCPConnectionError)
        assert isinstance(error, MCPError)
        assert isinstance(error, Exception)

    def test_mcp_auth_error_inheritance(self):
        """Test MCPAuthError inheritance chain."""
        error = MCPAuthError()
        assert isinstance(error, MCPAuthError)
        assert isinstance(error, MCPConnectionError)
        assert isinstance(error, MCPError)
        assert isinstance(error, Exception)

    def test_mcp_auth_error_raise(self):
        """Test raising MCPAuthError."""
        with pytest.raises(MCPAuthError) as exc_info:
            raise MCPAuthError("Invalid credentials")

        assert str(exc_info.value) == "Invalid credentials"

    def test_mcp_auth_error_catch_hierarchy(self):
        """Test catching MCPAuthError at different levels."""
        # Catch as MCPAuthError
        with pytest.raises(MCPAuthError) as exc_info:
            raise MCPAuthError("Auth specific error")
        assert str(exc_info.value) == "Auth specific error"

        # Catch as MCPConnectionError
        with pytest.raises(MCPConnectionError) as exc_info:
            raise MCPAuthError("Auth connection error")
        assert isinstance(exc_info.value, MCPAuthError)
        assert str(exc_info.value) == "Auth connection error"

        # Catch as MCPError
        with pytest.raises(MCPError) as exc_info:
            raise MCPAuthError("Auth base error")
        assert isinstance(exc_info.value, MCPAuthError)
        assert str(exc_info.value) == "Auth base error"


class TestErrorHierarchy:
    """Test the complete error hierarchy."""

    def test_exception_hierarchy(self):
        """Test the complete exception hierarchy."""
        # Create instances
        base_error = MCPError("base")
        connection_error = MCPConnectionError("connection")
        auth_error = MCPAuthError("auth")
        refresh_error = MCPRefreshTokenError("refresh")

        # Test type relationships
        assert not isinstance(base_error, MCPConnectionError)
        assert not isinstance(base_error, MCPAuthError)

        assert isinstance(connection_error, MCPError)
        assert not isinstance(connection_error, MCPAuthError)

        assert isinstance(auth_error, MCPError)
        assert isinstance(auth_error, MCPConnectionError)

        assert isinstance(refresh_error, MCPError)
        assert not isinstance(refresh_error, MCPConnectionError)
        assert not isinstance(refresh_error, MCPAuthError)

    def test_error_handling_patterns(self):
        """Test common error handling patterns."""

        def raise_auth_error():
            raise MCPAuthError("401 Unauthorized")

        def raise_connection_error():
            raise MCPConnectionError("Connection timeout")

        def raise_base_error():
            raise MCPError("Generic error")

        def raise_refresh_error():
            raise MCPRefreshTokenError("Token expired")

        # Pattern 1: Catch specific errors first
        errors_caught = []

        for error_func in [raise_auth_error, raise_connection_error, raise_base_error, raise_refresh_error]:
            try:
                error_func()
            except MCPRefreshTokenError:
                errors_caught.append("refresh")
            except MCPAuthError:
                errors_caught.append("auth")
            except MCPConnectionError:
                errors_caught.append("connection")
            except MCPError:
                errors_caught.append("base")

        assert errors_caught == ["auth", "connection", "base", "refresh"]

        # Pattern 2: Catch all as base error
        for error_func in [raise_auth_error, raise_connection_error, raise_base_error, raise_refresh_error]:
            with pytest.raises(MCPError) as exc_info:
                error_func()
            assert isinstance(exc_info.value, MCPError)

    def test_error_with_cause(self):
        """Test errors with cause (chained exceptions)."""
        original_error = ValueError("Original error")

        def raise_chained_error():
            try:
                raise original_error
            except ValueError as e:
                raise MCPConnectionError("Connection failed") from e

        with pytest.raises(MCPConnectionError) as exc_info:
            raise_chained_error()

        assert str(exc_info.value) == "Connection failed"
        assert exc_info.value.__cause__ == original_error

        def raise_refresh_chained_error():
            try:
                raise original_error
            except ValueError as e:
                raise MCPRefreshTokenError("Refresh token failed") from e

        with pytest.raises(MCPRefreshTokenError) as refresh_exc_info:
            raise_refresh_chained_error()

        assert str(refresh_exc_info.value) == "Refresh token failed"
        assert refresh_exc_info.value.__cause__ == original_error

    def test_error_comparison(self):
        """Test error instance comparison."""
        error1 = MCPError("Test message")
        error2 = MCPError("Test message")
        error3 = MCPError("Different message")

        # Errors are not equal even with same message (different instances)
        assert error1 != error2
        assert error1 != error3

        # But they have the same type
        assert type(error1) == type(error2) == type(error3)

    def test_error_representation(self):
        """Test error string representation."""
        base_error = MCPError("Base error message")
        connection_error = MCPConnectionError("Connection error message")
        auth_error = MCPAuthError("Auth error message")
        refresh_error = MCPRefreshTokenError("Refresh token error message")

        assert repr(base_error) == "MCPError('Base error message')"
        assert repr(connection_error) == "MCPConnectionError('Connection error message')"
        assert repr(auth_error) == "MCPAuthError('Auth error message')"
        assert repr(refresh_error) == "MCPRefreshTokenError('Refresh token error message')"


class TestMCPRefreshTokenError:
    """Test MCPRefreshTokenError exception class."""

    def test_mcp_refresh_token_error_creation(self):
        """Test creating MCPRefreshTokenError instance."""
        error = MCPRefreshTokenError("Refresh token invalid")
        assert str(error) == "Refresh token invalid"
        assert isinstance(error, MCPError)
        assert isinstance(error, Exception)

    def test_mcp_refresh_token_error_inheritance(self):
        """Test MCPRefreshTokenError inheritance chain."""
        error = MCPRefreshTokenError()
        assert isinstance(error, MCPRefreshTokenError)
        assert isinstance(error, MCPError)
        assert isinstance(error, Exception)

    def test_mcp_refresh_token_error_raise(self):
        """Test raising MCPRefreshTokenError."""
        with pytest.raises(MCPRefreshTokenError) as exc_info:
            raise MCPRefreshTokenError("Token refresh required")

        assert str(exc_info.value) == "Token refresh required"

    def test_mcp_refresh_token_error_catch_hierarchy(self):
        """Test catching MCPRefreshTokenError at different levels."""
        # Catch as MCPRefreshTokenError
        with pytest.raises(MCPRefreshTokenError) as exc_info:
            raise MCPRefreshTokenError("Refresh specific error")
        assert str(exc_info.value) == "Refresh specific error"

        # Catch as MCPError
        with pytest.raises(MCPError) as base_exc_info:
            raise MCPRefreshTokenError("Refresh base error")
        assert isinstance(base_exc_info.value, MCPRefreshTokenError)
        assert str(base_exc_info.value) == "Refresh base error"
