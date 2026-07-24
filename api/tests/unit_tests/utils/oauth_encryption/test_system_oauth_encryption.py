import base64
import hashlib
from unittest.mock import patch

import pytest
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad

from core.tools.utils.system_oauth_encryption import (
    OAuthEncryptionError,
    SystemOAuthEncrypter,
    create_system_oauth_encrypter,
    decrypt_system_oauth_params,
    encrypt_system_oauth_params,
    get_system_oauth_encrypter,
)


class TestSystemOAuthEncrypter:
    """Test cases for SystemOAuthEncrypter class"""

    def test_init_with_secret_key(self):
        """Test initialization with provided secret key"""
        secret_key = "test_secret_key"
        encrypter = SystemOAuthEncrypter(secret_key=secret_key)
        expected_key = hashlib.sha256(secret_key.encode()).digest()
        assert encrypter.key == expected_key

    def test_init_with_none_secret_key(self):
        """Test initialization with None secret key falls back to config"""
        with patch("core.tools.utils.system_oauth_encryption.dify_config") as mock_config:
            mock_config.SECRET_KEY = "config_secret"
            encrypter = SystemOAuthEncrypter(secret_key=None)
            expected_key = hashlib.sha256(b"config_secret").digest()
            assert encrypter.key == expected_key

    def test_init_with_empty_secret_key(self):
        """Test initialization with empty secret key"""
        encrypter = SystemOAuthEncrypter(secret_key="")
        expected_key = hashlib.sha256(b"").digest()
        assert encrypter.key == expected_key

    def test_init_without_secret_key_uses_config(self):
        """Test initialization without secret key uses config"""
        with patch("core.tools.utils.system_oauth_encryption.dify_config") as mock_config:
            mock_config.SECRET_KEY = "default_secret"
            encrypter = SystemOAuthEncrypter()
            expected_key = hashlib.sha256(b"default_secret").digest()
            assert encrypter.key == expected_key

    def test_encrypt_oauth_params_basic(self):
        """Test basic OAuth parameters encryption"""
        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypter.encrypt_oauth_params(oauth_params)

        assert isinstance(encrypted, str)
        assert len(encrypted) > 0
        # Should be valid base64
        try:
            base64.b64decode(encrypted)
        except Exception:
            pytest.fail("Encrypted result is not valid base64")

    def test_encrypt_oauth_params_empty_dict(self):
        """Test encryption with empty dictionary"""
        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {}

        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_oauth_params_complex_data(self):
        """Test encryption with complex data structures"""
        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {
            "client_id": "test_id",
            "client_secret": "test_secret",
            "scopes": ["read", "write", "admin"],
            "metadata": {"issuer": "test_issuer", "expires_in": 3600, "is_active": True},
            "numeric_value": 42,
            "boolean_value": False,
            "null_value": None,
        }

        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_oauth_params_unicode_data(self):
        """Test encryption with unicode data"""
        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {"client_id": "test_id", "client_secret": "test_secret", "description": "This is a test case 🚀"}

        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_oauth_params_large_data(self):
        """Test encryption with large data"""
        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {
            "client_id": "test_id",
            "large_data": "x" * 10000,  # 10KB of data
        }

        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_oauth_params_invalid_input(self):
        """Test encryption with invalid input types"""
        encrypter = SystemOAuthEncrypter("test_secret")

        with pytest.raises(Exception):  # noqa: B017
            encrypter.encrypt_oauth_params(None)

        with pytest.raises(Exception):  # noqa: B017
            encrypter.encrypt_oauth_params("not_a_dict")

    def test_decrypt_oauth_params_basic(self):
        """Test basic OAuth parameters decryption"""
        encrypter = SystemOAuthEncrypter("test_secret")
        original_params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypter.encrypt_oauth_params(original_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_oauth_params_empty_dict(self):
        """Test decryption of empty dictionary"""
        encrypter = SystemOAuthEncrypter("test_secret")
        original_params = {}

        encrypted = encrypter.encrypt_oauth_params(original_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_oauth_params_complex_data(self):
        """Test decryption with complex data structures"""
        encrypter = SystemOAuthEncrypter("test_secret")
        original_params = {
            "client_id": "test_id",
            "client_secret": "test_secret",
            "scopes": ["read", "write", "admin"],
            "metadata": {"issuer": "test_issuer", "expires_in": 3600, "is_active": True},
            "numeric_value": 42,
            "boolean_value": False,
            "null_value": None,
        }

        encrypted = encrypter.encrypt_oauth_params(original_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_oauth_params_unicode_data(self):
        """Test decryption with unicode data"""
        encrypter = SystemOAuthEncrypter("test_secret")
        original_params = {
            "client_id": "test_id",
            "client_secret": "test_secret",
            "description": "This is a test case 🚀",
        }

        encrypted = encrypter.encrypt_oauth_params(original_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_oauth_params_large_data(self):
        """Test decryption with large data"""
        encrypter = SystemOAuthEncrypter("test_secret")
        original_params = {
            "client_id": "test_id",
            "large_data": "x" * 10000,  # 10KB of data
        }

        encrypted = encrypter.encrypt_oauth_params(original_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_oauth_params_invalid_base64(self):
        """Test decryption with invalid base64 data"""
        encrypter = SystemOAuthEncrypter("test_secret")

        with pytest.raises(OAuthEncryptionError):
            encrypter.decrypt_oauth_params("invalid_base64!")

    def test_decrypt_oauth_params_empty_string(self):
        """Test decryption with empty string"""
        encrypter = SystemOAuthEncrypter("test_secret")

        with pytest.raises(ValueError) as exc_info:
            encrypter.decrypt_oauth_params("")

        assert "encrypted_data cannot be empty" in str(exc_info.value)

    def test_decrypt_oauth_params_non_string_input(self):
        """Test decryption with non-string input"""
        encrypter = SystemOAuthEncrypter("test_secret")

        with pytest.raises(ValueError) as exc_info:
            encrypter.decrypt_oauth_params(123)

        assert "encrypted_data must be a string" in str(exc_info.value)

        with pytest.raises(ValueError) as exc_info:
            encrypter.decrypt_oauth_params(None)

        assert "encrypted_data must be a string" in str(exc_info.value)

    def test_decrypt_oauth_params_too_short_data(self):
        """Test decryption with too short encrypted data"""
        encrypter = SystemOAuthEncrypter("test_secret")

        # Create data that's too short (less than 32 bytes)
        short_data = base64.b64encode(b"short").decode()

        with pytest.raises(OAuthEncryptionError) as exc_info:
            encrypter.decrypt_oauth_params(short_data)

        assert "Invalid encrypted data format" in str(exc_info.value)

    def test_decrypt_oauth_params_corrupted_data(self):
        """Test decryption with corrupted data"""
        encrypter = SystemOAuthEncrypter("test_secret")

        # Create corrupted data (valid base64 but invalid encrypted content)
        corrupted_data = base64.b64encode(b"x" * 48).decode()  # 48 bytes of garbage

        with pytest.raises(OAuthEncryptionError):
            encrypter.decrypt_oauth_params(corrupted_data)

    def test_decrypt_oauth_params_wrong_key(self):
        """Test decryption with wrong key"""
        encrypter1 = SystemOAuthEncrypter("secret1")
        encrypter2 = SystemOAuthEncrypter("secret2")

        original_params = {"client_id": "test_id", "client_secret": "test_secret"}
        encrypted = encrypter1.encrypt_oauth_params(original_params)

        with pytest.raises(OAuthEncryptionError):
            encrypter2.decrypt_oauth_params(encrypted)

    def test_encryption_decryption_consistency(self):
        """Test that encryption and decryption are consistent"""
        encrypter = SystemOAuthEncrypter("test_secret")

        test_cases = [
            {},
            {"simple": "value"},
            {"client_id": "id", "client_secret": "secret"},
            {"complex": {"nested": {"deep": "value"}}},
            {"unicode": "test 🚀"},
            {"numbers": 42, "boolean": True, "null": None},
            {"array": [1, 2, 3, "four", {"five": 5}]},
        ]

        for original_params in test_cases:
            encrypted = encrypter.encrypt_oauth_params(original_params)
            decrypted = encrypter.decrypt_oauth_params(encrypted)
            assert decrypted == original_params, f"Failed for case: {original_params}"

    def test_encryption_randomness(self):
        """Test that encryption produces different results for same input"""
        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted1 = encrypter.encrypt_oauth_params(oauth_params)
        encrypted2 = encrypter.encrypt_oauth_params(oauth_params)

        # Should be different due to random IV
        assert encrypted1 != encrypted2

        # But should decrypt to same result
        decrypted1 = encrypter.decrypt_oauth_params(encrypted1)
        decrypted2 = encrypter.decrypt_oauth_params(encrypted2)
        assert decrypted1 == decrypted2 == oauth_params

    def test_different_secret_keys_produce_different_results(self):
        """Test that different secret keys produce different encrypted results"""
        encrypter1 = SystemOAuthEncrypter("secret1")
        encrypter2 = SystemOAuthEncrypter("secret2")

        oauth_params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted1 = encrypter1.encrypt_oauth_params(oauth_params)
        encrypted2 = encrypter2.encrypt_oauth_params(oauth_params)

        # Should produce different encrypted results
        assert encrypted1 != encrypted2

        # But each should decrypt correctly with its own key
        decrypted1 = encrypter1.decrypt_oauth_params(encrypted1)
        decrypted2 = encrypter2.decrypt_oauth_params(encrypted2)
        assert decrypted1 == decrypted2 == oauth_params

    @patch("core.tools.utils.system_oauth_encryption.get_random_bytes")
    def test_encrypt_oauth_params_crypto_error(self, mock_get_random_bytes):
        """Test encryption when crypto operation fails"""
        mock_get_random_bytes.side_effect = Exception("Crypto error")

        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {"client_id": "test_id"}

        with pytest.raises(OAuthEncryptionError) as exc_info:
            encrypter.encrypt_oauth_params(oauth_params)

        assert "Encryption failed" in str(exc_info.value)

    @patch("core.tools.utils.system_oauth_encryption.TypeAdapter")
    def test_encrypt_oauth_params_serialization_error(self, mock_type_adapter):
        """Test encryption when JSON serialization fails"""
        mock_type_adapter.return_value.dump_json.side_effect = Exception("Serialization error")

        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {"client_id": "test_id"}

        with pytest.raises(OAuthEncryptionError) as exc_info:
            encrypter.encrypt_oauth_params(oauth_params)

        assert "Encryption failed" in str(exc_info.value)

    def test_decrypt_oauth_params_invalid_json(self):
        """Test decryption with invalid JSON data"""
        encrypter = SystemOAuthEncrypter("test_secret")

        # Create valid encrypted data but with invalid JSON content
        iv = get_random_bytes(16)
        cipher = AES.new(encrypter.key, AES.MODE_CBC, iv)
        invalid_json = b"invalid json content"
        padded_data = pad(invalid_json, AES.block_size)
        encrypted_data = cipher.encrypt(padded_data)
        combined = iv + encrypted_data
        encoded = base64.b64encode(combined).decode()

        with pytest.raises(OAuthEncryptionError):
            encrypter.decrypt_oauth_params(encoded)

    def test_key_derivation_consistency(self):
        """Test that key derivation is consistent"""
        secret_key = "test_secret"
        encrypter1 = SystemOAuthEncrypter(secret_key)
        encrypter2 = SystemOAuthEncrypter(secret_key)

        assert encrypter1.key == encrypter2.key

        # Keys should be 32 bytes (256 bits)
        assert len(encrypter1.key) == 32


class TestFactoryFunctions:
    """Test cases for factory functions"""

    def test_create_system_oauth_encrypter_with_secret(self):
        """Test factory function with secret key"""
        secret_key = "test_secret"
        encrypter = create_system_oauth_encrypter(secret_key)

        assert isinstance(encrypter, SystemOAuthEncrypter)
        expected_key = hashlib.sha256(secret_key.encode()).digest()
        assert encrypter.key == expected_key

    def test_create_system_oauth_encrypter_without_secret(self):
        """Test factory function without secret key"""
        with patch("core.tools.utils.system_oauth_encryption.dify_config") as mock_config:
            mock_config.SECRET_KEY = "config_secret"
            encrypter = create_system_oauth_encrypter()

            assert isinstance(encrypter, SystemOAuthEncrypter)
            expected_key = hashlib.sha256(b"config_secret").digest()
            assert encrypter.key == expected_key

    def test_create_system_oauth_encrypter_with_none_secret(self):
        """Test factory function with None secret key"""
        with patch("core.tools.utils.system_oauth_encryption.dify_config") as mock_config:
            mock_config.SECRET_KEY = "config_secret"
            encrypter = create_system_oauth_encrypter(None)

            assert isinstance(encrypter, SystemOAuthEncrypter)
            expected_key = hashlib.sha256(b"config_secret").digest()
            assert encrypter.key == expected_key


class TestGlobalEncrypterInstance:
    """Test cases for global encrypter instance"""

    def test_get_system_oauth_encrypter_singleton(self):
        """Test that get_system_oauth_encrypter returns singleton instance"""
        # Clear the global instance first
        import core.tools.utils.system_oauth_encryption

        core.tools.utils.system_oauth_encryption._oauth_encrypter = None

        encrypter1 = get_system_oauth_encrypter()
        encrypter2 = get_system_oauth_encrypter()

        assert encrypter1 is encrypter2
        assert isinstance(encrypter1, SystemOAuthEncrypter)

    def test_get_system_oauth_encrypter_uses_config(self):
        """Test that global encrypter uses config"""
        # Clear the global instance first
        import core.tools.utils.system_oauth_encryption

        core.tools.utils.system_oauth_encryption._oauth_encrypter = None

        with patch("core.tools.utils.system_oauth_encryption.dify_config") as mock_config:
            mock_config.SECRET_KEY = "global_secret"
            encrypter = get_system_oauth_encrypter()

            expected_key = hashlib.sha256(b"global_secret").digest()
            assert encrypter.key == expected_key


class TestConvenienceFunctions:
    """Test cases for convenience functions"""

    def test_encrypt_system_oauth_params(self):
        """Test encrypt_system_oauth_params convenience function"""
        oauth_params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypt_system_oauth_params(oauth_params)

        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_decrypt_system_oauth_params(self):
        """Test decrypt_system_oauth_params convenience function"""
        oauth_params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypt_system_oauth_params(oauth_params)
        decrypted = decrypt_system_oauth_params(encrypted)

        assert decrypted == oauth_params

    def test_convenience_functions_consistency(self):
        """Test that convenience functions work consistently"""
        test_cases = [
            {},
            {"simple": "value"},
            {"client_id": "id", "client_secret": "secret"},
            {"complex": {"nested": {"deep": "value"}}},
            {"unicode": "test 🚀"},
            {"numbers": 42, "boolean": True, "null": None},
        ]

        for original_params in test_cases:
            encrypted = encrypt_system_oauth_params(original_params)
            decrypted = decrypt_system_oauth_params(encrypted)
            assert decrypted == original_params, f"Failed for case: {original_params}"

    def test_convenience_functions_with_errors(self):
        """Test convenience functions with error conditions"""
        # Test encryption with invalid input
        with pytest.raises(Exception):  # noqa: B017
            encrypt_system_oauth_params(None)

        # Test decryption with invalid input
        with pytest.raises(ValueError):
            decrypt_system_oauth_params("")

        with pytest.raises(ValueError):
            decrypt_system_oauth_params(None)


class TestErrorHandling:
    """Test cases for error handling"""

    def test_oauth_encryption_error_inheritance(self):
        """Test that OAuthEncryptionError is a proper exception"""
        error = OAuthEncryptionError("Test error")
        assert isinstance(error, Exception)
        assert str(error) == "Test error"

    def test_oauth_encryption_error_with_cause(self):
        """Test OAuthEncryptionError with cause"""
        original_error = ValueError("Original error")
        error = OAuthEncryptionError("Wrapper error")
        error.__cause__ = original_error

        assert isinstance(error, Exception)
        assert str(error) == "Wrapper error"
        assert error.__cause__ is original_error

    def test_error_messages_are_informative(self):
        """Test that error messages are informative"""
        encrypter = SystemOAuthEncrypter("test_secret")

        # Test empty string error
        with pytest.raises(ValueError) as exc_info:
            encrypter.decrypt_oauth_params("")
        assert "encrypted_data cannot be empty" in str(exc_info.value)

        # Test non-string error
        with pytest.raises(ValueError) as exc_info:
            encrypter.decrypt_oauth_params(123)
        assert "encrypted_data must be a string" in str(exc_info.value)

        # Test invalid format error
        short_data = base64.b64encode(b"short").decode()
        with pytest.raises(OAuthEncryptionError) as exc_info:
            encrypter.decrypt_oauth_params(short_data)
        assert "Invalid encrypted data format" in str(exc_info.value)


class TestEdgeCases:
    """Test cases for edge cases and boundary conditions"""

    def test_very_long_secret_key(self):
        """Test with very long secret key"""
        long_secret = "x" * 10000
        encrypter = SystemOAuthEncrypter(long_secret)

        # Key should still be 32 bytes due to SHA-256
        assert len(encrypter.key) == 32

        # Should still work normally
        oauth_params = {"client_id": "test_id"}
        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)
        assert decrypted == oauth_params

    def test_special_characters_in_secret_key(self):
        """Test with special characters in secret key"""
        special_secret = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~test🚀"
        encrypter = SystemOAuthEncrypter(special_secret)

        oauth_params = {"client_id": "test_id"}
        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)
        assert decrypted == oauth_params

    def test_empty_values_in_oauth_params(self):
        """Test with empty values in oauth params"""
        oauth_params = {
            "client_id": "",
            "client_secret": "",
            "empty_dict": {},
            "empty_list": [],
            "empty_string": "",
            "zero": 0,
            "false": False,
            "none": None,
        }

        encrypter = SystemOAuthEncrypter("test_secret")
        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)
        assert decrypted == oauth_params

    def test_deeply_nested_oauth_params(self):
        """Test with deeply nested oauth params"""
        oauth_params = {"level1": {"level2": {"level3": {"level4": {"level5": {"deep_value": "found"}}}}}}

        encrypter = SystemOAuthEncrypter("test_secret")
        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)
        assert decrypted == oauth_params

    def test_oauth_params_with_all_json_types(self):
        """Test with all JSON-supported data types"""
        oauth_params = {
            "string": "test_string",
            "integer": 42,
            "float": 3.14159,
            "boolean_true": True,
            "boolean_false": False,
            "null_value": None,
            "empty_string": "",
            "array": [1, "two", 3.0, True, False, None],
            "object": {"nested_string": "nested_value", "nested_number": 123, "nested_bool": True},
        }

        encrypter = SystemOAuthEncrypter("test_secret")
        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)
        assert decrypted == oauth_params


class TestPerformance:
    """Test cases for performance considerations"""

    def test_large_oauth_params(self):
        """Test with large oauth params"""
        large_value = "x" * 100000  # 100KB
        oauth_params = {"client_id": "test_id", "large_data": large_value}

        encrypter = SystemOAuthEncrypter("test_secret")
        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)
        assert decrypted == oauth_params

    def test_many_fields_oauth_params(self):
        """Test with many fields in oauth params"""
        oauth_params = {f"field_{i}": f"value_{i}" for i in range(1000)}

        encrypter = SystemOAuthEncrypter("test_secret")
        encrypted = encrypter.encrypt_oauth_params(oauth_params)
        decrypted = encrypter.decrypt_oauth_params(encrypted)
        assert decrypted == oauth_params

    def test_repeated_encryption_decryption(self):
        """Test repeated encryption and decryption operations"""
        encrypter = SystemOAuthEncrypter("test_secret")
        oauth_params = {"client_id": "test_id", "client_secret": "test_secret"}

        # Test multiple rounds of encryption/decryption
        for i in range(100):
            encrypted = encrypter.encrypt_oauth_params(oauth_params)
            decrypted = encrypter.decrypt_oauth_params(encrypted)
            assert decrypted == oauth_params
