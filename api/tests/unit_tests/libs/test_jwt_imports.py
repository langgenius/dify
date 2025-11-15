"""Test PyJWT import paths to catch changes in library structure."""

import pytest


class TestPyJWTImports:
    """Test PyJWT import paths used throughout the codebase."""

    def test_invalid_token_error_import(self):
        """Test that InvalidTokenError can be imported as used in login controller."""
        # This test verifies the import path used in controllers/web/login.py:2
        # If PyJWT changes this import path, this test will fail early
        try:
            from jwt import InvalidTokenError

            # Verify it's the correct exception class
            assert issubclass(InvalidTokenError, Exception)

            # Test that it can be instantiated
            error = InvalidTokenError("test error")
            assert str(error) == "test error"

        except ImportError as e:
            pytest.fail(f"Failed to import InvalidTokenError from jwt: {e}")

    def test_jwt_exceptions_import(self):
        """Test that jwt.exceptions imports work as expected."""
        # Alternative import path that might be used
        try:
            # Verify it's the same class as the direct import
            from jwt import InvalidTokenError
            from jwt.exceptions import InvalidTokenError as InvalidTokenErrorAlt

            assert InvalidTokenError is InvalidTokenErrorAlt

        except ImportError as e:
            pytest.fail(f"Failed to import InvalidTokenError from jwt.exceptions: {e}")

    def test_other_jwt_exceptions_available(self):
        """Test that other common JWT exceptions are available."""
        # Test other exceptions that might be used in the codebase
        try:
            from jwt import DecodeError, ExpiredSignatureError, InvalidSignatureError

            # Verify they are exception classes
            assert issubclass(DecodeError, Exception)
            assert issubclass(ExpiredSignatureError, Exception)
            assert issubclass(InvalidSignatureError, Exception)

        except ImportError as e:
            pytest.fail(f"Failed to import JWT exceptions: {e}")

    def test_jwt_main_functions_available(self):
        """Test that main JWT functions are available."""
        try:
            from jwt import decode, encode

            # Verify they are callable
            assert callable(decode)
            assert callable(encode)

        except ImportError as e:
            pytest.fail(f"Failed to import JWT main functions: {e}")
