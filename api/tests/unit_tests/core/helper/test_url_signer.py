from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest

from core.helper.url_signer import SignedUrlParams, UrlSigner


class TestUrlSigner:
    """Test cases for UrlSigner class"""

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    def test_should_generate_signed_url_params(self):
        """Test generation of signed URL parameters with all required fields"""
        sign_key = "test-sign-key"
        prefix = "test-prefix"

        params = UrlSigner.get_signed_url_params(sign_key, prefix)

        # Verify the returned object and required fields
        assert isinstance(params, SignedUrlParams)
        assert params.sign_key == sign_key
        assert params.timestamp is not None
        assert params.nonce is not None
        assert params.sign is not None

        # Verify nonce format (32 character hex string)
        assert len(params.nonce) == 32
        assert all(c in "0123456789abcdef" for c in params.nonce)

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    def test_should_generate_complete_signed_url(self):
        """Test generation of complete signed URL with query parameters"""
        base_url = "https://example.com/api/test"
        sign_key = "test-sign-key"
        prefix = "test-prefix"

        signed_url = UrlSigner.get_signed_url(base_url, sign_key, prefix)

        # Parse URL and verify structure
        parsed = urlparse(signed_url)
        assert f"{parsed.scheme}://{parsed.netloc}{parsed.path}" == base_url

        # Verify query parameters
        query_params = parse_qs(parsed.query)
        assert "timestamp" in query_params
        assert "nonce" in query_params
        assert "sign" in query_params

        # Verify each parameter has exactly one value
        assert len(query_params["timestamp"]) == 1
        assert len(query_params["nonce"]) == 1
        assert len(query_params["sign"]) == 1

        # Verify parameter values are not empty
        assert query_params["timestamp"][0]
        assert query_params["nonce"][0]
        assert query_params["sign"][0]

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    def test_should_verify_valid_signature(self):
        """Test verification of valid signature"""
        sign_key = "test-sign-key"
        prefix = "test-prefix"

        # Generate and verify signature
        params = UrlSigner.get_signed_url_params(sign_key, prefix)

        is_valid = UrlSigner.verify(
            sign_key=sign_key, timestamp=params.timestamp, nonce=params.nonce, sign=params.sign, prefix=prefix
        )

        assert is_valid is True

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    @pytest.mark.parametrize(
        ("field", "modifier"),
        [
            ("sign_key", lambda _: "wrong-sign-key"),
            ("timestamp", lambda t: str(int(t) + 1000)),
            ("nonce", lambda _: "different-nonce-123456789012345"),
            ("prefix", lambda _: "wrong-prefix"),
            ("sign", lambda s: s + "tampered"),
        ],
    )
    def test_should_reject_invalid_signature_params(self, field, modifier):
        """Test signature verification rejects invalid parameters"""
        sign_key = "test-sign-key"
        prefix = "test-prefix"

        # Generate valid signed parameters
        params = UrlSigner.get_signed_url_params(sign_key, prefix)

        # Prepare verification parameters
        verify_params = {
            "sign_key": sign_key,
            "timestamp": params.timestamp,
            "nonce": params.nonce,
            "sign": params.sign,
            "prefix": prefix,
        }

        # Modify the specific field
        verify_params[field] = modifier(verify_params[field])

        # Verify should fail
        is_valid = UrlSigner.verify(**verify_params)
        assert is_valid is False

    @patch("configs.dify_config.SECRET_KEY", None)
    def test_should_raise_error_without_secret_key(self):
        """Test that signing fails when SECRET_KEY is not configured"""
        with pytest.raises(Exception) as exc_info:
            UrlSigner.get_signed_url_params("key", "prefix")

        assert "SECRET_KEY is not set" in str(exc_info.value)

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    def test_should_generate_unique_signatures(self):
        """Test that different inputs produce different signatures"""
        params1 = UrlSigner.get_signed_url_params("key1", "prefix1")
        params2 = UrlSigner.get_signed_url_params("key2", "prefix2")

        # Different inputs should produce different signatures
        assert params1.sign != params2.sign
        assert params1.nonce != params2.nonce

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    def test_should_handle_special_characters(self):
        """Test handling of special characters in parameters"""
        special_cases = [
            "test with spaces",
            "test/with/slashes",
            "test中文字符",
        ]

        for sign_key in special_cases:
            params = UrlSigner.get_signed_url_params(sign_key, "prefix")

            # Should generate valid signature and verify correctly
            is_valid = UrlSigner.verify(
                sign_key=sign_key, timestamp=params.timestamp, nonce=params.nonce, sign=params.sign, prefix="prefix"
            )
            assert is_valid is True

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    def test_should_ensure_nonce_randomness(self):
        """Test that nonce is random for each generation - critical for security"""
        sign_key = "test-sign-key"
        prefix = "test-prefix"

        # Generate multiple nonces
        nonces = set()
        for _ in range(5):
            params = UrlSigner.get_signed_url_params(sign_key, prefix)
            nonces.add(params.nonce)

        # All nonces should be unique
        assert len(nonces) == 5

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    @patch("time.time", return_value=1234567890)
    @patch("os.urandom", return_value=b"\xab\xcd\xef\x12\x34\x56\x78\x90\xab\xcd\xef\x12\x34\x56\x78\x90")
    def test_should_produce_consistent_signatures(self, mock_urandom, mock_time):
        """Test that same inputs produce same signature - ensures deterministic behavior"""
        sign_key = "test-sign-key"
        prefix = "test-prefix"

        # Generate signature multiple times with same inputs (time and nonce are mocked)
        params1 = UrlSigner.get_signed_url_params(sign_key, prefix)
        params2 = UrlSigner.get_signed_url_params(sign_key, prefix)

        # With mocked time and random, should produce identical results
        assert params1.timestamp == params2.timestamp
        assert params1.nonce == params2.nonce
        assert params1.sign == params2.sign

        # Verify the signature is valid
        assert UrlSigner.verify(
            sign_key=sign_key, timestamp=params1.timestamp, nonce=params1.nonce, sign=params1.sign, prefix=prefix
        )

    @patch("configs.dify_config.SECRET_KEY", "test-secret-key-12345")
    def test_should_handle_empty_strings(self):
        """Test handling of empty string parameters - common edge case"""
        # Empty sign_key and prefix should still work
        params = UrlSigner.get_signed_url_params("", "")
        assert params.sign is not None

        # Should verify correctly
        is_valid = UrlSigner.verify(
            sign_key="", timestamp=params.timestamp, nonce=params.nonce, sign=params.sign, prefix=""
        )
        assert is_valid is True
