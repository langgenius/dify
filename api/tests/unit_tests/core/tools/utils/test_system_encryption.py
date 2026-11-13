from __future__ import annotations

import base64
import hashlib
from collections.abc import Callable
from unittest.mock import MagicMock, patch

import pytest
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Util.Padding import pad

from core.tools.utils import system_encryption as encryption
from core.tools.utils.system_encryption import (
    EncryptionError,
    SystemEncrypter,
    create_system_encrypter,
    decrypt_system_params,
    encrypt_system_params,
    get_system_encrypter,
)
from tests.helpers.unit.config_override import apply_config_overrides


def test_system_encrypter_roundtrip() -> None:
    encrypter = SystemEncrypter(secret_key="test-secret")
    payload = {"client_id": "cid", "client_secret": "csecret", "grant_type": "authorization_code"}

    encrypted = encrypter.encrypt_params(payload)
    decrypted = encrypter.decrypt_params(encrypted)

    assert encrypted
    assert dict(decrypted) == payload


def test_system_encrypter_decrypt_validates_input() -> None:
    encrypter = SystemEncrypter(secret_key="test-secret")

    with pytest.raises(ValueError, match="must be a string"):
        encrypter.decrypt_params(123)  # type: ignore[arg-type]

    with pytest.raises(ValueError, match="cannot be empty"):
        encrypter.decrypt_params("")


def test_system_encrypter_raises_error_for_invalid_ciphertext() -> None:
    encrypter = SystemEncrypter(secret_key="test-secret")

    with pytest.raises(EncryptionError, match="Decryption failed"):
        encrypter.decrypt_params("not-base64")


def test_system_helpers_use_global_cached_instance(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(encryption, "_encrypter", None)
    apply_config_overrides(monkeypatch, SECRET_KEY="global-secret")

    first = encryption.get_system_encrypter()
    second = encryption.get_system_encrypter()
    assert first is second

    encrypted = encryption.encrypt_system_params({"k": "v"})
    assert encryption.decrypt_system_params(encrypted) == {"k": "v"}


def test_create_system_encrypter_factory() -> None:
    encrypter = encryption.create_system_encrypter(secret_key="factory-secret")
    assert isinstance(encrypter, SystemEncrypter)


class TestSystemEncrypter:
    """Test cases for SystemEncrypter class"""

    def test_init_with_secret_key(self) -> None:
        """Test initialization with provided secret key"""
        secret_key = "test_secret_key"
        encrypter = SystemEncrypter(secret_key=secret_key)
        expected_key = hashlib.sha256(secret_key.encode()).digest()
        assert encrypter.key == expected_key

    def test_init_with_none_secret_key(self, config_overrides: Callable[..., None]) -> None:
        """Test initialization with None secret key falls back to config"""
        config_overrides(SECRET_KEY="config_secret")
        encrypter = SystemEncrypter(secret_key=None)
        expected_key = hashlib.sha256(b"config_secret").digest()
        assert encrypter.key == expected_key

    def test_init_with_empty_secret_key(self) -> None:
        """Test initialization with empty secret key"""
        encrypter = SystemEncrypter(secret_key="")
        expected_key = hashlib.sha256(b"").digest()
        assert encrypter.key == expected_key

    def test_init_without_secret_key_uses_config(self, config_overrides: Callable[..., None]) -> None:
        """Test initialization without secret key uses config"""
        config_overrides(SECRET_KEY="default_secret")
        encrypter = SystemEncrypter()
        expected_key = hashlib.sha256(b"default_secret").digest()
        assert encrypter.key == expected_key

    def test_encrypt_params_basic(self) -> None:
        """Test basic parameters encryption"""
        encrypter = SystemEncrypter("test_secret")
        params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypter.encrypt_params(params)

        assert isinstance(encrypted, str)
        assert len(encrypted) > 0
        # Should be valid base64
        try:
            base64.b64decode(encrypted)
        except Exception:
            pytest.fail("Encrypted result is not valid base64")

    def test_encrypt_params_empty_dict(self) -> None:
        """Test encryption with empty dictionary"""
        encrypter = SystemEncrypter("test_secret")
        params = {}

        encrypted = encrypter.encrypt_params(params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_params_complex_data(self) -> None:
        """Test encryption with complex data structures"""
        encrypter = SystemEncrypter("test_secret")
        params = {
            "client_id": "test_id",
            "client_secret": "test_secret",
            "scopes": ["read", "write", "admin"],
            "metadata": {"issuer": "test_issuer", "expires_in": 3600, "is_active": True},
            "numeric_value": 42,
            "boolean_value": False,
            "null_value": None,
        }

        encrypted = encrypter.encrypt_params(params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_params_unicode_data(self) -> None:
        """Test encryption with unicode data"""
        encrypter = SystemEncrypter("test_secret")
        params = {"client_id": "test_id", "client_secret": "test_secret", "description": "This is a test case 🚀"}

        encrypted = encrypter.encrypt_params(params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_params_large_data(self) -> None:
        """Test encryption with large data"""
        encrypter = SystemEncrypter("test_secret")
        params = {
            "client_id": "test_id",
            "large_data": "x" * 10000,  # 10KB of data
        }

        encrypted = encrypter.encrypt_params(params)
        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_encrypt_params_invalid_input(self) -> None:
        """Test encryption with invalid input types"""
        encrypter = SystemEncrypter("test_secret")

        with pytest.raises(Exception, match="Encryption failed: 'NoneType' object is not iterable"):
            encrypter.encrypt_params(None)  # pyrefly: ignore[bad-argument-type]

        with pytest.raises(
            Exception, match=("Encryption failed: dictionary update sequence element \\#0 has length 1; 2 is required")
        ):
            encrypter.encrypt_params("not_a_dict")  # pyrefly: ignore[bad-argument-type]

    def test_decrypt_params_basic(self) -> None:
        """Test basic parameters decryption"""
        encrypter = SystemEncrypter("test_secret")
        original_params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypter.encrypt_params(original_params)
        decrypted = encrypter.decrypt_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_params_empty_dict(self) -> None:
        """Test decryption of empty dictionary"""
        encrypter = SystemEncrypter("test_secret")
        original_params = {}

        encrypted = encrypter.encrypt_params(original_params)
        decrypted = encrypter.decrypt_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_params_complex_data(self) -> None:
        """Test decryption with complex data structures"""
        encrypter = SystemEncrypter("test_secret")
        original_params = {
            "client_id": "test_id",
            "client_secret": "test_secret",
            "scopes": ["read", "write", "admin"],
            "metadata": {"issuer": "test_issuer", "expires_in": 3600, "is_active": True},
            "numeric_value": 42,
            "boolean_value": False,
            "null_value": None,
        }

        encrypted = encrypter.encrypt_params(original_params)
        decrypted = encrypter.decrypt_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_params_unicode_data(self) -> None:
        """Test decryption with unicode data"""
        encrypter = SystemEncrypter("test_secret")
        original_params = {
            "client_id": "test_id",
            "client_secret": "test_secret",
            "description": "This is a test case 🚀",
        }

        encrypted = encrypter.encrypt_params(original_params)
        decrypted = encrypter.decrypt_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_params_large_data(self) -> None:
        """Test decryption with large data"""
        encrypter = SystemEncrypter("test_secret")
        original_params = {
            "client_id": "test_id",
            "large_data": "x" * 10000,  # 10KB of data
        }

        encrypted = encrypter.encrypt_params(original_params)
        decrypted = encrypter.decrypt_params(encrypted)

        assert decrypted == original_params

    def test_decrypt_params_invalid_base64(self) -> None:
        """Test decryption with invalid base64 data"""
        encrypter = SystemEncrypter("test_secret")

        with pytest.raises(EncryptionError):
            encrypter.decrypt_params("invalid_base64!")

    def test_decrypt_params_empty_string(self) -> None:
        """Test decryption with empty string"""
        encrypter = SystemEncrypter("test_secret")

        with pytest.raises(ValueError, match="encrypted_data cannot be empty") as exc_info:
            encrypter.decrypt_params("")

        assert "encrypted_data cannot be empty" in str(exc_info.value)

    def test_decrypt_params_non_string_input(self) -> None:
        """Test decryption with non-string input"""
        encrypter = SystemEncrypter("test_secret")

        with pytest.raises(ValueError, match="encrypted_data must be a string") as exc_info:
            encrypter.decrypt_params(123)  # pyrefly: ignore[bad-argument-type]

        assert "encrypted_data must be a string" in str(exc_info.value)

        with pytest.raises(ValueError, match="encrypted_data must be a string") as exc_info:
            encrypter.decrypt_params(None)  # pyrefly: ignore[bad-argument-type]

        assert "encrypted_data must be a string" in str(exc_info.value)

    def test_decrypt_params_too_short_data(self) -> None:
        """Test decryption with too short encrypted data"""
        encrypter = SystemEncrypter("test_secret")

        # Create data that's too short (less than 32 bytes)
        short_data = base64.b64encode(b"short").decode()

        with pytest.raises(EncryptionError) as exc_info:
            encrypter.decrypt_params(short_data)

        assert "Invalid encrypted data format" in str(exc_info.value)

    def test_decrypt_params_corrupted_data(self) -> None:
        """Test decryption with corrupted data"""
        encrypter = SystemEncrypter("test_secret")

        # Create corrupted data (valid base64 but invalid encrypted content)
        corrupted_data = base64.b64encode(b"x" * 48).decode()  # 48 bytes of garbage

        with pytest.raises(EncryptionError):
            encrypter.decrypt_params(corrupted_data)

    def test_decrypt_params_wrong_key(self) -> None:
        """Test decryption with wrong key"""
        encrypter1 = SystemEncrypter("secret1")
        encrypter2 = SystemEncrypter("secret2")

        original_params = {"client_id": "test_id", "client_secret": "test_secret"}
        encrypted = encrypter1.encrypt_params(original_params)

        with pytest.raises(EncryptionError):
            encrypter2.decrypt_params(encrypted)

    def test_encryption_decryption_consistency(self) -> None:
        """Test that encryption and decryption are consistent"""
        encrypter = SystemEncrypter("test_secret")

        test_cases = [
            dict[str, object](),
            {"simple": "value"},
            {"client_id": "id", "client_secret": "secret"},
            {"complex": {"nested": {"deep": "value"}}},
            {"unicode": "test 🚀"},
            {"numbers": 42, "boolean": True, "null": None},
            {"array": [1, 2, 3, "four", {"five": 5}]},
        ]

        for original_params in test_cases:
            encrypted = encrypter.encrypt_params(original_params)
            decrypted = encrypter.decrypt_params(encrypted)
            assert decrypted == original_params, f"Failed for case: {original_params}"

    def test_encryption_randomness(self) -> None:
        """Test that encryption produces different results for same input"""
        encrypter = SystemEncrypter("test_secret")
        params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted1 = encrypter.encrypt_params(params)
        encrypted2 = encrypter.encrypt_params(params)

        # Should be different due to random IV
        assert encrypted1 != encrypted2

        # But should decrypt to same result
        decrypted1 = encrypter.decrypt_params(encrypted1)
        decrypted2 = encrypter.decrypt_params(encrypted2)
        assert decrypted1 == decrypted2 == params

    def test_different_secret_keys_produce_different_results(self) -> None:
        """Test that different secret keys produce different encrypted results"""
        encrypter1 = SystemEncrypter("secret1")
        encrypter2 = SystemEncrypter("secret2")

        params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted1 = encrypter1.encrypt_params(params)
        encrypted2 = encrypter2.encrypt_params(params)

        # Should produce different encrypted results
        assert encrypted1 != encrypted2

        # But each should decrypt correctly with its own key
        decrypted1 = encrypter1.decrypt_params(encrypted1)
        decrypted2 = encrypter2.decrypt_params(encrypted2)
        assert decrypted1 == decrypted2 == params

    @patch("core.tools.utils.system_encryption.get_random_bytes")
    def test_encrypt_params_crypto_error(self, mock_get_random_bytes: MagicMock) -> None:
        """Test encryption when crypto operation fails"""
        mock_get_random_bytes.side_effect = Exception("Crypto error")

        encrypter = SystemEncrypter("test_secret")
        params = {"client_id": "test_id"}

        with pytest.raises(EncryptionError) as exc_info:
            encrypter.encrypt_params(params)

        assert "Encryption failed" in str(exc_info.value)

    @patch("core.tools.utils.system_encryption.TypeAdapter")
    def test_encrypt_params_serialization_error(self, mock_type_adapter: MagicMock) -> None:
        """Test encryption when JSON serialization fails"""
        mock_type_adapter.return_value.dump_json.side_effect = Exception("Serialization error")

        encrypter = SystemEncrypter("test_secret")
        params = {"client_id": "test_id"}

        with pytest.raises(EncryptionError) as exc_info:
            encrypter.encrypt_params(params)

        assert "Encryption failed" in str(exc_info.value)

    def test_decrypt_params_invalid_json(self) -> None:
        """Test decryption with invalid JSON data"""
        encrypter = SystemEncrypter("test_secret")

        # Create valid encrypted data but with invalid JSON content
        iv = get_random_bytes(16)
        cipher = AES.new(encrypter.key, AES.MODE_CBC, iv)
        invalid_json = b"invalid json content"
        padded_data = pad(invalid_json, AES.block_size)
        encrypted_data = cipher.encrypt(padded_data)
        combined = iv + encrypted_data
        encoded = base64.b64encode(combined).decode()

        with pytest.raises(EncryptionError):
            encrypter.decrypt_params(encoded)

    def test_key_derivation_consistency(self) -> None:
        """Test that key derivation is consistent"""
        secret_key = "test_secret"
        encrypter1 = SystemEncrypter(secret_key)
        encrypter2 = SystemEncrypter(secret_key)

        assert encrypter1.key == encrypter2.key

        # Keys should be 32 bytes (256 bits)
        assert len(encrypter1.key) == 32


class TestFactoryFunctions:
    """Test cases for factory functions"""

    def test_create_system_encrypter_with_secret(self) -> None:
        """Test factory function with secret key"""
        secret_key = "test_secret"
        encrypter = create_system_encrypter(secret_key)

        assert isinstance(encrypter, SystemEncrypter)
        expected_key = hashlib.sha256(secret_key.encode()).digest()
        assert encrypter.key == expected_key

    def test_create_system_encrypter_without_secret(self, config_overrides: Callable[..., None]) -> None:
        """Test factory function without secret key"""
        config_overrides(SECRET_KEY="config_secret")
        encrypter = create_system_encrypter()

        assert isinstance(encrypter, SystemEncrypter)
        expected_key = hashlib.sha256(b"config_secret").digest()
        assert encrypter.key == expected_key

    def test_create_system_encrypter_with_none_secret(self, config_overrides: Callable[..., None]) -> None:
        """Test factory function with None secret key"""
        config_overrides(SECRET_KEY="config_secret")
        encrypter = create_system_encrypter(None)

        assert isinstance(encrypter, SystemEncrypter)
        expected_key = hashlib.sha256(b"config_secret").digest()
        assert encrypter.key == expected_key


class TestGlobalEncrypterInstance:
    """Test cases for global encrypter instance"""

    def test_get_system_encrypter_singleton(self) -> None:
        """Test that get_system_encrypter returns singleton instance"""
        # Clear the global instance first
        import core.tools.utils.system_encryption

        core.tools.utils.system_encryption._encrypter = None

        encrypter1 = get_system_encrypter()
        encrypter2 = get_system_encrypter()

        assert encrypter1 is encrypter2
        assert isinstance(encrypter1, SystemEncrypter)

    def test_get_system_encrypter_uses_config(self, config_overrides: Callable[..., None]) -> None:
        """Test that global encrypter uses config"""
        # Clear the global instance first
        import core.tools.utils.system_encryption

        core.tools.utils.system_encryption._encrypter = None

        config_overrides(SECRET_KEY="global_secret")
        encrypter = get_system_encrypter()

        expected_key = hashlib.sha256(b"global_secret").digest()
        assert encrypter.key == expected_key


class TestConvenienceFunctions:
    """Test cases for convenience functions"""

    def test_encrypt_system_params(self) -> None:
        """Test encrypt_system_params convenience function"""
        params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypt_system_params(params)

        assert isinstance(encrypted, str)
        assert len(encrypted) > 0

    def test_decrypt_system_params(self) -> None:
        """Test decrypt_system_params convenience function"""
        params = {"client_id": "test_id", "client_secret": "test_secret"}

        encrypted = encrypt_system_params(params)
        decrypted = decrypt_system_params(encrypted)

        assert decrypted == params

    def test_convenience_functions_consistency(self) -> None:
        """Test that convenience functions work consistently"""
        test_cases = [
            dict[str, object](),
            {"simple": "value"},
            {"client_id": "id", "client_secret": "secret"},
            {"complex": {"nested": {"deep": "value"}}},
            {"unicode": "test 🚀"},
            {"numbers": 42, "boolean": True, "null": None},
        ]

        for original_params in test_cases:
            encrypted = encrypt_system_params(original_params)
            decrypted = decrypt_system_params(encrypted)
            assert decrypted == original_params, f"Failed for case: {original_params}"

    def test_convenience_functions_with_errors(self) -> None:
        """Test convenience functions with error conditions"""
        # Test encryption with invalid input
        with pytest.raises(Exception, match="Encryption failed: 'NoneType' object is not iterable"):
            encrypt_system_params(None)  # pyrefly: ignore[bad-argument-type]

        # Test decryption with invalid input
        with pytest.raises(ValueError, match="encrypted_data cannot be empty"):
            decrypt_system_params("")

        with pytest.raises(ValueError, match="encrypted_data must be a string"):
            decrypt_system_params(None)  # pyrefly: ignore[bad-argument-type]


class TestErrorHandling:
    """Test cases for error handling"""

    def test_encryption_error_inheritance(self) -> None:
        """Test that EncryptionError is a proper exception"""
        error = EncryptionError("Test error")
        assert isinstance(error, Exception)
        assert str(error) == "Test error"

    def test_encryption_error_with_cause(self) -> None:
        """Test EncryptionError with cause"""
        original_error = ValueError("Original error")
        error = EncryptionError("Wrapper error")
        error.__cause__ = original_error

        assert isinstance(error, Exception)
        assert str(error) == "Wrapper error"
        assert error.__cause__ is original_error

    def test_error_messages_are_informative(self) -> None:
        """Test that error messages are informative"""
        encrypter = SystemEncrypter("test_secret")

        # Test empty string error
        with pytest.raises(ValueError, match="encrypted_data cannot be empty") as exc_info:
            encrypter.decrypt_params("")
        assert "encrypted_data cannot be empty" in str(exc_info.value)

        # Test non-string error
        with pytest.raises(ValueError, match="encrypted_data must be a string") as exc_info:
            encrypter.decrypt_params(123)  # pyrefly: ignore[bad-argument-type]
        assert "encrypted_data must be a string" in str(exc_info.value)

        # Test invalid format error
        short_data = base64.b64encode(b"short").decode()
        with pytest.raises(EncryptionError) as exc_info:
            encrypter.decrypt_params(short_data)
        assert "Invalid encrypted data format" in str(exc_info.value)


class TestEdgeCases:
    """Test cases for edge cases and boundary conditions"""

    def test_very_long_secret_key(self) -> None:
        """Test with very long secret key"""
        long_secret = "x" * 10000
        encrypter = SystemEncrypter(long_secret)

        # Key should still be 32 bytes due to SHA-256
        assert len(encrypter.key) == 32

        # Should still work normally
        params = {"client_id": "test_id"}
        encrypted = encrypter.encrypt_params(params)
        decrypted = encrypter.decrypt_params(encrypted)
        assert decrypted == params

    def test_special_characters_in_secret_key(self) -> None:
        """Test with special characters in secret key"""
        special_secret = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~test🚀"
        encrypter = SystemEncrypter(special_secret)

        params = {"client_id": "test_id"}
        encrypted = encrypter.encrypt_params(params)
        decrypted = encrypter.decrypt_params(encrypted)
        assert decrypted == params

    def test_empty_values_in_params(self) -> None:
        """Test with empty values in params"""
        params = {
            "client_id": "",
            "client_secret": "",
            "empty_dict": dict[str, object](),
            "empty_list": list[object](),
            "empty_string": "",
            "zero": 0,
            "false": False,
            "none": None,
        }

        encrypter = SystemEncrypter("test_secret")
        encrypted = encrypter.encrypt_params(params)
        decrypted = encrypter.decrypt_params(encrypted)
        assert decrypted == params

    def test_deeply_nested_params(self) -> None:
        """Test with deeply nested params"""
        params = {"level1": {"level2": {"level3": {"level4": {"level5": {"deep_value": "found"}}}}}}

        encrypter = SystemEncrypter("test_secret")
        encrypted = encrypter.encrypt_params(params)
        decrypted = encrypter.decrypt_params(encrypted)
        assert decrypted == params

    def test_params_with_all_json_types(self) -> None:
        """Test with all JSON-supported data types"""
        params = {
            "string": "test_string",
            "integer": 42,
            "float": float("3.14159"),
            "boolean_true": True,
            "boolean_false": False,
            "null_value": None,
            "empty_string": "",
            "array": [1, "two", 3.0, True, False, None],
            "object": {"nested_string": "nested_value", "nested_number": 123, "nested_bool": True},
        }

        encrypter = SystemEncrypter("test_secret")
        encrypted = encrypter.encrypt_params(params)
        decrypted = encrypter.decrypt_params(encrypted)
        assert decrypted == params


class TestPerformance:
    """Test cases for performance considerations"""

    def test_large_params(self) -> None:
        """Test with large params"""
        large_value = "x" * 100000  # 100KB
        params = {"client_id": "test_id", "large_data": large_value}

        encrypter = SystemEncrypter("test_secret")
        encrypted = encrypter.encrypt_params(params)
        decrypted = encrypter.decrypt_params(encrypted)
        assert decrypted == params

    def test_many_fields_params(self) -> None:
        """Test with many fields in params"""
        params = {f"field_{i}": f"value_{i}" for i in range(1000)}

        encrypter = SystemEncrypter("test_secret")
        encrypted = encrypter.encrypt_params(params)
        decrypted = encrypter.decrypt_params(encrypted)
        assert decrypted == params

    def test_repeated_encryption_decryption(self) -> None:
        """Test repeated encryption and decryption operations"""
        encrypter = SystemEncrypter("test_secret")
        params = {"client_id": "test_id", "client_secret": "test_secret"}

        # Test multiple rounds of encryption/decryption
        for _i in range(100):
            encrypted = encrypter.encrypt_params(params)
            decrypted = encrypter.decrypt_params(encrypted)
            assert decrypted == params
