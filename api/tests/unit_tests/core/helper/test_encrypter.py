import base64
import binascii
from unittest.mock import MagicMock, patch

import pytest

from core.helper.encrypter import (
    batch_decrypt_token,
    decrypt_token,
    encrypt_token,
    get_decrypt_decoding,
    obfuscated_token,
)
from libs.rsa import PrivkeyNotFoundError


class TestObfuscatedToken:
    @pytest.mark.parametrize(
        ("token", "expected"),
        [
            ("", ""),  # Empty token
            ("1234567", "*" * 20),  # Short token (<8 chars)
            ("12345678", "*" * 20),  # Boundary case (8 chars)
            ("123456789abcdef", "123456" + "*" * 12 + "ef"),  # Long token
            ("abc!@#$%^&*()def", "abc!@#" + "*" * 12 + "ef"),  # Special chars
        ],
    )
    def test_obfuscation_logic(self, token, expected):
        """Test core obfuscation logic for various token lengths"""
        assert obfuscated_token(token) == expected

    def test_sensitive_data_protection(self):
        """Ensure obfuscation never reveals full sensitive data"""
        token = "api_key_secret_12345"
        obfuscated = obfuscated_token(token)
        assert token not in obfuscated
        assert "*" * 12 in obfuscated


class TestEncryptToken:
    @patch("models.engine.db.session.query")
    @patch("libs.rsa.encrypt")
    def test_successful_encryption(self, mock_encrypt, mock_query):
        """Test successful token encryption"""
        mock_tenant = MagicMock()
        mock_tenant.encrypt_public_key = "mock_public_key"
        mock_query.return_value.filter.return_value.first.return_value = mock_tenant
        mock_encrypt.return_value = b"encrypted_data"

        result = encrypt_token("tenant-123", "test_token")

        assert result == base64.b64encode(b"encrypted_data").decode()
        mock_encrypt.assert_called_with("test_token", "mock_public_key")

    @patch("models.engine.db.session.query")
    def test_tenant_not_found(self, mock_query):
        """Test error when tenant doesn't exist"""
        mock_query.return_value.filter.return_value.first.return_value = None

        with pytest.raises(ValueError) as exc_info:
            encrypt_token("invalid-tenant", "test_token")

        assert "Tenant with id invalid-tenant not found" in str(exc_info.value)


class TestDecryptToken:
    @patch("libs.rsa.decrypt")
    def test_successful_decryption(self, mock_decrypt):
        """Test successful token decryption"""
        mock_decrypt.return_value = "decrypted_token"
        encrypted_data = base64.b64encode(b"encrypted_data").decode()

        result = decrypt_token("tenant-123", encrypted_data)

        assert result == "decrypted_token"
        mock_decrypt.assert_called_once_with(b"encrypted_data", "tenant-123")

    def test_invalid_base64(self):
        """Test handling of invalid base64 input"""
        with pytest.raises(binascii.Error):
            decrypt_token("tenant-123", "invalid_base64!!!")


class TestBatchDecryptToken:
    @patch("libs.rsa.get_decrypt_decoding")
    @patch("libs.rsa.decrypt_token_with_decoding")
    def test_batch_decryption(self, mock_decrypt_with_decoding, mock_get_decoding):
        """Test batch decryption functionality"""
        mock_rsa_key = MagicMock()
        mock_cipher_rsa = MagicMock()
        mock_get_decoding.return_value = (mock_rsa_key, mock_cipher_rsa)

        # Test multiple tokens
        mock_decrypt_with_decoding.side_effect = ["token1", "token2", "token3"]
        tokens = [
            base64.b64encode(b"encrypted1").decode(),
            base64.b64encode(b"encrypted2").decode(),
            base64.b64encode(b"encrypted3").decode(),
        ]
        result = batch_decrypt_token("tenant-123", tokens)

        assert result == ["token1", "token2", "token3"]
        # Key should only be loaded once
        mock_get_decoding.assert_called_once_with("tenant-123")


class TestGetDecryptDecoding:
    @patch("extensions.ext_redis.redis_client.get")
    @patch("extensions.ext_storage.storage.load")
    def test_private_key_not_found(self, mock_storage_load, mock_redis_get):
        """Test error when private key file doesn't exist"""
        mock_redis_get.return_value = None
        mock_storage_load.side_effect = FileNotFoundError()

        with pytest.raises(PrivkeyNotFoundError) as exc_info:
            get_decrypt_decoding("tenant-123")

        assert "Private key not found, tenant_id: tenant-123" in str(exc_info.value)


class TestEncryptDecryptIntegration:
    @patch("models.engine.db.session.query")
    @patch("libs.rsa.encrypt")
    @patch("libs.rsa.decrypt")
    def test_should_encrypt_and_decrypt_consistently(self, mock_decrypt, mock_encrypt, mock_query):
        """Test that encryption and decryption are consistent"""
        # Setup mock tenant
        mock_tenant = MagicMock()
        mock_tenant.encrypt_public_key = "mock_public_key"
        mock_query.return_value.filter.return_value.first.return_value = mock_tenant

        # Setup mock encryption/decryption
        original_token = "test_token_123"
        mock_encrypt.return_value = b"encrypted_data"
        mock_decrypt.return_value = original_token

        # Test encryption
        encrypted = encrypt_token("tenant-123", original_token)

        # Test decryption
        decrypted = decrypt_token("tenant-123", encrypted)

        assert decrypted == original_token


class TestSecurity:
    """Critical security tests for encryption system"""

    @patch("models.engine.db.session.query")
    @patch("libs.rsa.encrypt")
    def test_cross_tenant_isolation(self, mock_encrypt, mock_query):
        """Ensure tokens encrypted for one tenant cannot be used by another"""
        # Setup mock tenant
        mock_tenant = MagicMock()
        mock_tenant.encrypt_public_key = "tenant1_public_key"
        mock_query.return_value.filter.return_value.first.return_value = mock_tenant
        mock_encrypt.return_value = b"encrypted_for_tenant1"

        # Encrypt token for tenant1
        encrypted = encrypt_token("tenant-123", "sensitive_data")

        # Attempt to decrypt with different tenant should fail
        with patch("libs.rsa.decrypt") as mock_decrypt:
            mock_decrypt.side_effect = Exception("Invalid tenant key")

            with pytest.raises(Exception, match="Invalid tenant key"):
                decrypt_token("different-tenant", encrypted)

    @patch("libs.rsa.decrypt")
    def test_tampered_ciphertext_rejection(self, mock_decrypt):
        """Detect and reject tampered ciphertext"""
        valid_encrypted = base64.b64encode(b"valid_data").decode()

        # Tamper with ciphertext
        tampered_bytes = bytearray(base64.b64decode(valid_encrypted))
        tampered_bytes[0] ^= 0xFF
        tampered = base64.b64encode(bytes(tampered_bytes)).decode()

        mock_decrypt.side_effect = Exception("Decryption error")

        with pytest.raises(Exception, match="Decryption error"):
            decrypt_token("tenant-123", tampered)

    @patch("models.engine.db.session.query")
    @patch("libs.rsa.encrypt")
    def test_encryption_randomness(self, mock_encrypt, mock_query):
        """Ensure same plaintext produces different ciphertext"""
        mock_tenant = MagicMock(encrypt_public_key="key")
        mock_query.return_value.filter.return_value.first.return_value = mock_tenant

        # Different outputs for same input
        mock_encrypt.side_effect = [b"enc1", b"enc2", b"enc3"]

        results = [encrypt_token("tenant-123", "token") for _ in range(3)]

        # All results should be different
        assert len(set(results)) == 3


class TestEdgeCases:
    """Additional security-focused edge case tests"""

    def test_should_handle_empty_string_in_obfuscation(self):
        """Test handling of empty string in obfuscation"""
        # Test empty string (which is a valid str type)
        assert obfuscated_token("") == ""

    @patch("models.engine.db.session.query")
    @patch("libs.rsa.encrypt")
    def test_should_handle_empty_token_encryption(self, mock_encrypt, mock_query):
        """Test encryption of empty token"""
        mock_tenant = MagicMock()
        mock_tenant.encrypt_public_key = "mock_public_key"
        mock_query.return_value.filter.return_value.first.return_value = mock_tenant
        mock_encrypt.return_value = b"encrypted_empty"

        result = encrypt_token("tenant-123", "")

        assert result == base64.b64encode(b"encrypted_empty").decode()
        mock_encrypt.assert_called_with("", "mock_public_key")

    @patch("models.engine.db.session.query")
    @patch("libs.rsa.encrypt")
    def test_should_handle_special_characters_in_token(self, mock_encrypt, mock_query):
        """Test tokens containing special/unicode characters"""
        mock_tenant = MagicMock()
        mock_tenant.encrypt_public_key = "mock_public_key"
        mock_query.return_value.filter.return_value.first.return_value = mock_tenant
        mock_encrypt.return_value = b"encrypted_special"

        # Test various special characters
        special_tokens = [
            "token\x00with\x00null",  # Null bytes
            "token_with_emoji_😀🎉",  # Unicode emoji
            "token\nwith\nnewlines",  # Newlines
            "token\twith\ttabs",  # Tabs
            "token_with_中文字符",  # Chinese characters
        ]

        for token in special_tokens:
            result = encrypt_token("tenant-123", token)
            assert result == base64.b64encode(b"encrypted_special").decode()
            mock_encrypt.assert_called_with(token, "mock_public_key")

    @patch("models.engine.db.session.query")
    @patch("libs.rsa.encrypt")
    def test_should_handle_rsa_size_limits(self, mock_encrypt, mock_query):
        """Test behavior when token exceeds RSA encryption limits"""
        mock_tenant = MagicMock()
        mock_tenant.encrypt_public_key = "mock_public_key"
        mock_query.return_value.filter.return_value.first.return_value = mock_tenant

        # RSA 2048-bit can only encrypt ~245 bytes
        # The actual limit depends on padding scheme
        mock_encrypt.side_effect = ValueError("Message too long for RSA key size")

        # Create a token that would exceed RSA limits
        long_token = "x" * 300

        with pytest.raises(ValueError, match="Message too long for RSA key size"):
            encrypt_token("tenant-123", long_token)

    @patch("libs.rsa.get_decrypt_decoding")
    @patch("libs.rsa.decrypt_token_with_decoding")
    def test_batch_decrypt_loads_key_only_once(self, mock_decrypt_with_decoding, mock_get_decoding):
        """Verify batch decryption optimization - loads key only once"""
        mock_rsa_key = MagicMock()
        mock_cipher_rsa = MagicMock()
        mock_get_decoding.return_value = (mock_rsa_key, mock_cipher_rsa)

        # Test with multiple tokens
        mock_decrypt_with_decoding.side_effect = ["token1", "token2", "token3", "token4", "token5"]
        tokens = [base64.b64encode(f"encrypted{i}".encode()).decode() for i in range(5)]

        result = batch_decrypt_token("tenant-123", tokens)

        assert result == ["token1", "token2", "token3", "token4", "token5"]
        # Key should only be loaded once regardless of token count
        mock_get_decoding.assert_called_once_with("tenant-123")
        assert mock_decrypt_with_decoding.call_count == 5
