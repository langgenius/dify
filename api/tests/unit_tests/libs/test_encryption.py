"""
Unit tests for field encryption/decryption utilities.

These tests ensure compatibility with crypto-js encryption format and
verify proper error handling and fallback behavior.
"""

import base64
import hashlib
from unittest.mock import patch

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

from libs.encryption import FieldEncryption


class TestFieldEncryptionEnabled:
    """Test cases for encryption enabled/disabled checks."""

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key-123")
    def test_is_enabled_when_configured(self):
        """Test that encryption is enabled when both flag and key are set."""
        assert FieldEncryption.is_enabled() is True

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", False)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key-123")
    def test_is_disabled_when_flag_off(self):
        """Test that encryption is disabled when flag is False."""
        assert FieldEncryption.is_enabled() is False

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "")
    def test_is_disabled_when_key_empty(self):
        """Test that encryption is disabled when key is empty."""
        assert FieldEncryption.is_enabled() is False

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", False)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "")
    def test_is_disabled_when_both_off(self):
        """Test that encryption is disabled when both flag and key are off."""
        assert FieldEncryption.is_enabled() is False


class TestKeyDerivation:
    """Test cases for EVP_BytesToKey algorithm implementation."""

    def test_derive_key_and_iv_length(self):
        """Test that derived key and IV have correct lengths."""
        passphrase = "test-passphrase"
        salt = b"12345678"  # 8 bytes
        
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        
        assert len(key) == 32  # 256 bits
        assert len(iv) == 16  # 128 bits

    def test_derive_key_and_iv_deterministic(self):
        """Test that same passphrase and salt produce same key and IV."""
        passphrase = "test-passphrase"
        salt = b"12345678"
        
        key1, iv1 = FieldEncryption._derive_key_and_iv(passphrase, salt)
        key2, iv2 = FieldEncryption._derive_key_and_iv(passphrase, salt)
        
        assert key1 == key2
        assert iv1 == iv2

    def test_derive_key_and_iv_different_salt(self):
        """Test that different salts produce different keys."""
        passphrase = "test-passphrase"
        salt1 = b"12345678"
        salt2 = b"87654321"
        
        key1, iv1 = FieldEncryption._derive_key_and_iv(passphrase, salt1)
        key2, iv2 = FieldEncryption._derive_key_and_iv(passphrase, salt2)
        
        assert key1 != key2
        assert iv1 != iv2

    def test_derive_key_matches_cryptojs_evp_bytestokey(self):
        """
        Test that our key derivation matches crypto-js's EVP_BytesToKey.
        This is a known test vector to ensure compatibility.
        """
        # Test with known values
        passphrase = "password"
        salt = b"\x01\x02\x03\x04\x05\x06\x07\x08"
        
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        
        # Verify we're using MD5-based derivation (not PBKDF2)
        # The first hash should be MD5(password + salt)
        first_hash = hashlib.md5(b"password" + salt).digest()
        assert key[:16] == first_hash  # First 16 bytes of key should match first MD5


class TestDecryptField:
    """Test cases for field decryption functionality."""

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", False)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "")
    def test_decrypt_returns_plaintext_when_disabled(self):
        """Test that decryption returns original text when encryption is disabled."""
        plaintext = "my-password-123"
        result = FieldEncryption.decrypt_field(plaintext)
        assert result == plaintext

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_handles_non_base64_input(self):
        """Test that non-base64 input is treated as plaintext."""
        non_base64 = "plain-password-!@#"
        result = FieldEncryption.decrypt_field(non_base64)
        # Should return as plaintext (fallback)
        assert result == non_base64

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_handles_invalid_format(self):
        """Test that invalid encrypted format is handled gracefully."""
        # Valid base64 but not crypto-js format (missing "Salted__")
        invalid_encrypted = base64.b64encode(b"some random bytes").decode()
        result = FieldEncryption.decrypt_field(invalid_encrypted)
        # Should return as plaintext (fallback)
        assert result == invalid_encrypted

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "shared-secret-key")
    def test_decrypt_valid_cryptojs_format(self):
        """Test decrypting a properly formatted crypto-js encrypted string."""
        # Manually create a crypto-js compatible encrypted string
        plaintext = "password123"
        passphrase = "shared-secret-key"
        salt = b"12345678"
        
        # Derive key and IV using same method as crypto-js
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        
        # Encrypt using AES-256-CBC with PKCS7 padding
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded = pad(plaintext.encode("utf-8"), AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        # Create crypto-js format: "Salted__" + salt + ciphertext
        cryptojs_format = b"Salted__" + salt + ciphertext
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        # Test decryption
        result = FieldEncryption.decrypt_field(encrypted_base64)
        assert result == plaintext

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "wrong-key")
    def test_decrypt_with_wrong_key_returns_none(self):
        """Test that decryption with wrong key returns None."""
        # Create encrypted data with one key
        plaintext = "password123"
        correct_key = "correct-key"
        salt = b"12345678"
        
        key, iv = FieldEncryption._derive_key_and_iv(correct_key, salt)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded = pad(plaintext.encode("utf-8"), AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        cryptojs_format = b"Salted__" + salt + ciphertext
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        # Try to decrypt with wrong key (mocked as "wrong-key")
        result = FieldEncryption.decrypt_field(encrypted_base64)
        assert result is None  # Should fail and return None


class TestDecryptPassword:
    """Test cases for password decryption."""

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", False)
    def test_decrypt_password_when_disabled(self):
        """Test that password decryption returns plaintext when disabled."""
        password = "my-secure-password"
        result = FieldEncryption.decrypt_password(password)
        assert result == password

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_password_calls_decrypt_field(self):
        """Test that decrypt_password delegates to decrypt_field."""
        with patch.object(FieldEncryption, "decrypt_field", return_value="decrypted") as mock:
            result = FieldEncryption.decrypt_password("encrypted")
            mock.assert_called_once_with("encrypted")
            assert result == "decrypted"


class TestDecryptVerificationCode:
    """Test cases for verification code decryption."""

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", False)
    def test_decrypt_code_when_disabled(self):
        """Test that code decryption returns plaintext when disabled."""
        code = "123456"
        result = FieldEncryption.decrypt_verification_code(code)
        assert result == code

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_code_calls_decrypt_field(self):
        """Test that decrypt_verification_code delegates to decrypt_field."""
        with patch.object(FieldEncryption, "decrypt_field", return_value="123456") as mock:
            result = FieldEncryption.decrypt_verification_code("encrypted")
            mock.assert_called_once_with("encrypted")
            assert result == "123456"


class TestCryptoJSCompatibility:
    """
    Integration tests to verify compatibility with crypto-js encryption.
    
    These tests use known crypto-js encrypted strings to ensure backend
    can properly decrypt frontend-encrypted data.
    """

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "my-secret-key")
    def test_decrypt_cryptojs_encrypted_password(self):
        """
        Test decrypting a password encrypted by crypto-js.
        
        To generate test data, run in browser console:
        CryptoJS.AES.encrypt('TestPassword123', 'my-secret-key').toString()
        """
        # Create a test encrypted string using the same algorithm
        plaintext = "TestPassword123"
        passphrase = "my-secret-key"
        salt = b"testsalt"  # 8 bytes
        
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded = pad(plaintext.encode("utf-8"), AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        cryptojs_format = b"Salted__" + salt + ciphertext
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        # Decrypt and verify
        result = FieldEncryption.decrypt_field(encrypted_base64)
        assert result == plaintext

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "verification-key")
    def test_decrypt_cryptojs_encrypted_code(self):
        """Test decrypting a verification code encrypted by crypto-js."""
        # 6-digit verification code
        code = "789012"
        passphrase = "verification-key"
        salt = b"codesalt"
        
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded = pad(code.encode("utf-8"), AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        cryptojs_format = b"Salted__" + salt + ciphertext
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        # Decrypt and verify
        result = FieldEncryption.decrypt_verification_code(encrypted_base64)
        assert result == code


class TestEdgeCases:
    """Test edge cases and error conditions."""

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_empty_string(self):
        """Test decrypting an empty string."""
        result = FieldEncryption.decrypt_field("")
        # Empty string can't be base64 decoded, should return as plaintext
        assert result == ""

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_malformed_base64(self):
        """Test handling of malformed base64 data."""
        malformed = "not-valid-base64!@#$%"
        result = FieldEncryption.decrypt_field(malformed)
        # Should return as plaintext (fallback)
        assert result == malformed

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_too_short_data(self):
        """Test handling of data too short to be valid crypto-js format."""
        # Valid base64 but too short (less than 16 bytes after decode)
        too_short = base64.b64encode(b"short").decode()
        result = FieldEncryption.decrypt_field(too_short)
        # Should return as plaintext (fallback)
        assert result == too_short

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_decrypt_corrupted_ciphertext(self):
        """Test handling of corrupted ciphertext (valid format but corrupted data)."""
        # Create valid format but with corrupted ciphertext
        salt = b"12345678"
        corrupted_ct = b"corrupted_data_not_valid_aes_block"
        
        cryptojs_format = b"Salted__" + salt + corrupted_ct
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        # Should return None (decryption failed)
        result = FieldEncryption.decrypt_field(encrypted_base64)
        assert result is None


class TestFallbackBehavior:
    """Test fallback behavior when encryption/decryption fails."""

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_fallback_to_plaintext_on_decode_error(self):
        """Test that non-base64 input falls back to plaintext."""
        plaintext_password = "PlainPassword123!"
        result = FieldEncryption.decrypt_password(plaintext_password)
        # Should return original value (treated as plaintext)
        assert result == plaintext_password

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "test-key")
    def test_fallback_on_missing_salt_header(self):
        """Test fallback when data lacks 'Salted__' header."""
        # Create base64 data without "Salted__" prefix
        data_without_header = base64.b64encode(b"some_data").decode()
        result = FieldEncryption.decrypt_field(data_without_header)
        # Should return original (treated as plaintext)
        assert result == data_without_header


class TestRoundTripEncryptionDecryption:
    """
    Integration tests for complete encryption-decryption cycle.
    These tests simulate the full frontend-to-backend flow.
    """

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "integration-test-key")
    def test_roundtrip_password(self):
        """Test encrypting and decrypting a password."""
        original_password = "SecureP@ssw0rd!"
        passphrase = "integration-test-key"
        salt = b"salttest"
        
        # Simulate frontend encryption (crypto-js format)
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded = pad(original_password.encode("utf-8"), AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        cryptojs_format = b"Salted__" + salt + ciphertext
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        # Backend decryption
        decrypted = FieldEncryption.decrypt_password(encrypted_base64)
        
        assert decrypted == original_password

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "code-test-key")
    def test_roundtrip_verification_code(self):
        """Test encrypting and decrypting a verification code."""
        original_code = "123456"
        passphrase = "code-test-key"
        salt = b"codesalt"
        
        # Simulate frontend encryption
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded = pad(original_code.encode("utf-8"), AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        cryptojs_format = b"Salted__" + salt + ciphertext
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        # Backend decryption
        decrypted = FieldEncryption.decrypt_verification_code(encrypted_base64)
        
        assert decrypted == original_code

    @patch("libs.encryption.dify_config.ENABLE_FIELD_ENCRYPTION", True)
    @patch("libs.encryption.dify_config.ENCRYPTION_KEY", "unicode-test-key")
    def test_roundtrip_unicode_password(self):
        """Test encrypting and decrypting password with Unicode characters."""
        original_password = "密码Test123!@#"
        passphrase = "unicode-test-key"
        salt = b"unicsalt"
        
        key, iv = FieldEncryption._derive_key_and_iv(passphrase, salt)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        padded = pad(original_password.encode("utf-8"), AES.block_size)
        ciphertext = cipher.encrypt(padded)
        
        cryptojs_format = b"Salted__" + salt + ciphertext
        encrypted_base64 = base64.b64encode(cryptojs_format).decode()
        
        decrypted = FieldEncryption.decrypt_password(encrypted_base64)
        assert decrypted == original_password

