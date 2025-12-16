"""
Unit tests for field encoding/decoding utilities.

These tests verify Base64 encoding/decoding functionality and
proper error handling and fallback behavior.
"""

import base64

from libs.encryption import FieldEncryption


class TestDecodeField:
    """Test cases for field decoding functionality."""

    def test_decode_valid_base64(self):
        """Test decoding a valid Base64 encoded string."""
        plaintext = "password123"
        encoded = base64.b64encode(plaintext.encode("utf-8")).decode()

        result = FieldEncryption.decrypt_field(encoded)
        assert result == plaintext

    def test_decode_handles_non_base64_input(self):
        """Test that non-base64 input is treated as plaintext (fallback)."""
        non_base64 = "plain-password-!@#"
        result = FieldEncryption.decrypt_field(non_base64)
        # Should return as plaintext (fallback for compatibility)
        assert result == non_base64

    def test_decode_unicode_text(self):
        """Test decoding Base64 encoded Unicode text."""
        plaintext = "密码Test123"
        encoded = base64.b64encode(plaintext.encode("utf-8")).decode()

        result = FieldEncryption.decrypt_field(encoded)
        assert result == plaintext

    def test_decode_empty_string(self):
        """Test decoding an empty string."""
        result = FieldEncryption.decrypt_field("")
        # Empty string fallback to plaintext
        assert result == ""

    def test_decode_special_characters(self):
        """Test decoding with special characters."""
        plaintext = "P@ssw0rd!#$%^&*()"
        encoded = base64.b64encode(plaintext.encode("utf-8")).decode()

        result = FieldEncryption.decrypt_field(encoded)
        assert result == plaintext


class TestDecodePassword:
    """Test cases for password decoding."""

    def test_decode_password_base64(self):
        """Test decoding a Base64 encoded password."""
        password = "SecureP@ssw0rd!"
        encoded = base64.b64encode(password.encode("utf-8")).decode()

        result = FieldEncryption.decrypt_password(encoded)
        assert result == password

    def test_decode_password_plaintext_fallback(self):
        """Test that plaintext passwords are handled (fallback)."""
        password = "PlainPassword"
        result = FieldEncryption.decrypt_password(password)
        # Fallback: return as-is
        assert result == password


class TestDecodeVerificationCode:
    """Test cases for verification code decoding."""

    def test_decode_code_base64(self):
        """Test decoding a Base64 encoded verification code."""
        code = "789012"
        encoded = base64.b64encode(code.encode("utf-8")).decode()

        result = FieldEncryption.decrypt_verification_code(encoded)
        assert result == code

    def test_decode_code_plaintext_fallback(self):
        """Test that plaintext codes are handled (fallback)."""
        code = "123456"
        result = FieldEncryption.decrypt_verification_code(code)
        # Fallback: return as-is
        assert result == code


class TestRoundTripEncodingDecoding:
    """
    Integration tests for complete encoding-decoding cycle.
    These tests simulate the full frontend-to-backend flow using Base64.
    """

    def test_roundtrip_password(self):
        """Test encoding and decoding a password."""
        original_password = "SecureP@ssw0rd!"

        # Simulate frontend encoding (Base64)
        encoded = base64.b64encode(original_password.encode("utf-8")).decode()

        # Backend decoding
        decoded = FieldEncryption.decrypt_password(encoded)

        assert decoded == original_password

    def test_roundtrip_verification_code(self):
        """Test encoding and decoding a verification code."""
        original_code = "123456"

        # Simulate frontend encoding
        encoded = base64.b64encode(original_code.encode("utf-8")).decode()

        # Backend decoding
        decoded = FieldEncryption.decrypt_verification_code(encoded)

        assert decoded == original_code

    def test_roundtrip_unicode_password(self):
        """Test encoding and decoding password with Unicode characters."""
        original_password = "密码Test123!@#"

        # Frontend encoding
        encoded = base64.b64encode(original_password.encode("utf-8")).decode()

        # Backend decoding
        decoded = FieldEncryption.decrypt_password(encoded)

        assert decoded == original_password

    def test_roundtrip_long_password(self):
        """Test encoding and decoding a long password."""
        original_password = "ThisIsAVeryLongPasswordWithLotsOfCharacters123!@#$%^&*()"

        encoded = base64.b64encode(original_password.encode("utf-8")).decode()
        decoded = FieldEncryption.decrypt_password(encoded)

        assert decoded == original_password

    def test_roundtrip_with_whitespace(self):
        """Test encoding and decoding with whitespace."""
        original_password = "pass word with spaces"

        encoded = base64.b64encode(original_password.encode("utf-8")).decode()
        decoded = FieldEncryption.decrypt_field(encoded)

        assert decoded == original_password
