import time
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import jwt
import pytest
from werkzeug.exceptions import Unauthorized

from libs.passport import PassportService


class TestPassportService:
    """Test PassportService JWT operations"""

    @pytest.fixture
    def passport_service(self):
        """Create PassportService instance with test secret key"""
        with patch("libs.passport.dify_config") as mock_config:
            mock_config.SECRET_KEY = "test-secret-key-for-testing"
            return PassportService()

    @pytest.fixture
    def another_passport_service(self):
        """Create another PassportService instance with different secret key"""
        with patch("libs.passport.dify_config") as mock_config:
            mock_config.SECRET_KEY = "another-secret-key-for-testing"
            return PassportService()

    # Core functionality tests
    def test_should_issue_and_verify_token(self, passport_service):
        """Test complete JWT lifecycle: issue and verify"""
        payload = {"user_id": "123", "app_code": "test-app"}
        token = passport_service.issue(payload)

        # Verify token format
        assert isinstance(token, str)
        assert len(token.split(".")) == 3  # JWT format: header.payload.signature

        # Verify token content
        decoded = passport_service.verify(token)
        assert decoded == payload

    def test_should_handle_different_payload_types(self, passport_service):
        """Test issuing and verifying tokens with different payload types"""
        test_cases = [
            {"string": "value"},
            {"number": 42},
            {"float": 3.14},
            {"boolean": True},
            {"null": None},
            {"array": [1, 2, 3]},
            {"nested": {"key": "value"}},
            {"unicode": "中文测试"},
            {"emoji": "🔐"},
            {},  # Empty payload
        ]

        for payload in test_cases:
            token = passport_service.issue(payload)
            decoded = passport_service.verify(token)
            assert decoded == payload

    # Security tests
    def test_should_reject_modified_token(self, passport_service):
        """Test that any modification to token invalidates it"""
        token = passport_service.issue({"user": "test"})

        # Test multiple modification points
        test_positions = [0, len(token) // 3, len(token) // 2, len(token) - 1]

        for pos in test_positions:
            if pos < len(token) and token[pos] != ".":
                # Change one character
                tampered = token[:pos] + ("X" if token[pos] != "X" else "Y") + token[pos + 1 :]
                with pytest.raises(Unauthorized):
                    passport_service.verify(tampered)

    def test_should_reject_token_with_different_secret_key(self, passport_service, another_passport_service):
        """Test key isolation - token from one service should not work with another"""
        payload = {"user_id": "123", "app_code": "test-app"}
        token = passport_service.issue(payload)

        with pytest.raises(Unauthorized) as exc_info:
            another_passport_service.verify(token)
        assert str(exc_info.value) == "401 Unauthorized: Invalid token signature."

    def test_should_use_hs256_algorithm(self, passport_service):
        """Test that HS256 algorithm is used for signing"""
        payload = {"test": "data"}
        token = passport_service.issue(payload)

        # Decode header without relying on JWT internals
        # Use jwt.get_unverified_header which is a public API
        header = jwt.get_unverified_header(token)
        assert header["alg"] == "HS256"

    def test_should_reject_token_with_wrong_algorithm(self, passport_service):
        """Test rejection of token signed with different algorithm"""
        payload = {"user_id": "123"}

        # Create token with different algorithm
        with patch("libs.passport.dify_config") as mock_config:
            mock_config.SECRET_KEY = "test-secret-key-for-testing"
            # Create token with HS512 instead of HS256
            wrong_alg_token = jwt.encode(payload, mock_config.SECRET_KEY, algorithm="HS512")

        # Should fail because service expects HS256
        # JWT library raises InvalidAlgorithmError which is not caught by PassportService
        with pytest.raises(jwt.exceptions.InvalidAlgorithmError):
            passport_service.verify(wrong_alg_token)

    # Exception handling tests
    def test_should_handle_invalid_tokens(self, passport_service):
        """Test handling of various invalid token formats"""
        invalid_tokens = [
            ("not.a.token", "Invalid token."),
            ("invalid-jwt-format", "Invalid token."),
            ("xxx.yyy.zzz", "Invalid token."),
            ("a.b", "Invalid token."),  # Missing signature
            ("", "Invalid token."),  # Empty string
            ("   ", "Invalid token."),  # Whitespace
            (None, "Invalid token."),  # None value
            # Malformed base64
            ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.INVALID_BASE64!@#$.signature", "Invalid token."),
        ]

        for invalid_token, expected_message in invalid_tokens:
            with pytest.raises(Unauthorized) as exc_info:
                passport_service.verify(invalid_token)
            assert expected_message in str(exc_info.value)

    def test_should_reject_expired_token(self, passport_service):
        """Test rejection of expired token"""
        past_time = datetime.now(UTC) - timedelta(hours=1)
        payload = {"user_id": "123", "exp": past_time.timestamp()}

        with patch("libs.passport.dify_config") as mock_config:
            mock_config.SECRET_KEY = "test-secret-key-for-testing"
            token = jwt.encode(payload, mock_config.SECRET_KEY, algorithm="HS256")

        with pytest.raises(Unauthorized) as exc_info:
            passport_service.verify(token)
        assert str(exc_info.value) == "401 Unauthorized: Token has expired."

    # Configuration tests
    def test_should_handle_empty_secret_key(self):
        """Test behavior when SECRET_KEY is empty"""
        with patch("libs.passport.dify_config") as mock_config:
            mock_config.SECRET_KEY = ""
            service = PassportService()

            # Empty secret key should still work but is insecure
            payload = {"test": "data"}
            token = service.issue(payload)
            decoded = service.verify(token)
            assert decoded == payload

    def test_should_handle_none_secret_key(self):
        """Test behavior when SECRET_KEY is None"""
        with patch("libs.passport.dify_config") as mock_config:
            mock_config.SECRET_KEY = None
            service = PassportService()

            payload = {"test": "data"}
            # JWT library will raise TypeError when secret is None
            with pytest.raises((TypeError, jwt.exceptions.InvalidKeyError)):
                service.issue(payload)

    # Boundary condition tests
    def test_should_handle_large_payload(self, passport_service):
        """Test handling of large payload"""
        # Test with 100KB instead of 1MB for faster tests
        large_data = "x" * (100 * 1024)
        payload = {"data": large_data}

        token = passport_service.issue(payload)
        decoded = passport_service.verify(token)

        assert decoded["data"] == large_data

    def test_should_handle_special_characters_in_payload(self, passport_service):
        """Test handling of special characters in payload"""
        special_payloads = [
            {"special": "!@#$%^&*()"},
            {"quotes": 'He said "Hello"'},
            {"backslash": "path\\to\\file"},
            {"newline": "line1\nline2"},
            {"unicode": "🔐🔑🛡️"},
            {"mixed": "Test123!@#中文🔐"},
        ]

        for payload in special_payloads:
            token = passport_service.issue(payload)
            decoded = passport_service.verify(token)
            assert decoded == payload

    # Real-world usage scenarios
    def test_should_handle_web_user_authentication_scenario(self, passport_service):
        """Test typical web user authentication flow"""
        # User login - issue token
        user_payload = {
            "user_id": "user-123",
            "app_code": "web-app",
            "app_id": "app-456",
            "iss": "dify",
            "iat": int(time.time()),
        }
        token = passport_service.issue(user_payload)

        # Verify token on subsequent request
        decoded = passport_service.verify(token)

        assert decoded["user_id"] == user_payload["user_id"]
        assert decoded["app_code"] == user_payload["app_code"]
        assert decoded["app_id"] == user_payload["app_id"]
        assert "iat" in decoded

    def test_should_handle_api_bearer_token_scenario(self, passport_service):
        """Test API authentication with Bearer token"""
        # API client gets token
        api_payload = {
            "client_id": "api-client-789",
            "scopes": ["read", "write"],
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,  # 1 hour expiry
        }
        token = passport_service.issue(api_payload)

        # Verify token in API request
        decoded = passport_service.verify(token)

        assert decoded["client_id"] == api_payload["client_id"]
        assert decoded["scopes"] == api_payload["scopes"]
        assert decoded["exp"] > time.time()  # Not expired

    def test_should_handle_token_refresh_scenario(self, passport_service):
        """Test token refresh scenario"""
        # Original token
        original_payload = {
            "user_id": "123",
            "session_id": "session-abc",
            "iat": int(time.time()),
        }
        original_token = passport_service.issue(original_payload)
        decoded = passport_service.verify(original_token)

        # Issue new token with updated timestamp
        refresh_payload = {
            **decoded,
            "iat": int(time.time()),
            "refreshed": True,
        }
        refreshed_token = passport_service.issue(refresh_payload)

        # Verify refreshed token
        refreshed_decoded = passport_service.verify(refreshed_token)

        assert refreshed_decoded["user_id"] == original_payload["user_id"]
        assert refreshed_decoded["session_id"] == original_payload["session_id"]
        assert refreshed_decoded["refreshed"] is True
        assert refreshed_decoded["iat"] >= decoded["iat"]

    # Concurrent access test
    def test_should_handle_concurrent_token_operations(self, passport_service):
        """Test concurrent token issue and verify operations"""
        import concurrent.futures

        def issue_and_verify(index):
            payload = {"thread_id": index, "data": f"thread-{index}"}
            token = passport_service.issue(payload)
            decoded = passport_service.verify(token)
            return decoded["thread_id"] == index

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(issue_and_verify, i) for i in range(100)]
            results = [future.result() for future in concurrent.futures.as_completed(futures)]

        assert all(results)
        assert len(results) == 100
