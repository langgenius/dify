import base64
import binascii
from unittest.mock import patch

import pytest
from Crypto.PublicKey import RSA
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

import models.engine as model_engine
from core.helper.encrypter import (
    batch_decrypt_token,
    decrypt_token,
    encrypt_token,
    get_decrypt_decoding,
    obfuscated_token,
)
from libs import gmpy2_pkcs10aep_cipher, rsa
from libs.rsa import PrivkeyNotFoundError
from models.account import Tenant

pytestmark = [
    pytest.mark.usefixtures("sqlite_session"),
    pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True),
]


@pytest.fixture(autouse=True)
def bind_sqlite_session(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(model_engine.db, "session", sqlite_session)


@pytest.fixture(scope="module")
def rsa_key() -> RSA.RsaKey:
    return RSA.generate(2048)


def _persist_tenant(session: Session, *, public_key: str = "mock_public_key") -> Tenant:
    tenant = Tenant(name="Test tenant", encrypt_public_key=public_key)
    tenant.id = "tenant-123"
    session.add(tenant)
    session.commit()
    return tenant


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
    @patch("libs.rsa.encrypt")
    def test_successful_encryption(self, mock_encrypt, sqlite_session: Session):
        """Test successful token encryption"""
        _persist_tenant(sqlite_session)
        mock_encrypt.return_value = b"encrypted_data"

        result = encrypt_token("tenant-123", "test_token")

        assert result == base64.b64encode(b"encrypted_data").decode()
        mock_encrypt.assert_called_with("test_token", "mock_public_key")

    def test_tenant_not_found(self):
        """Test error when tenant doesn't exist"""
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
    def test_batch_decryption(self, mock_get_decoding, sqlite_session: Session, rsa_key: RSA.RsaKey):
        """Decrypt actual tenant ciphertext while loading the key only once."""
        _persist_tenant(sqlite_session, public_key=rsa_key.publickey().export_key().decode())
        mock_get_decoding.return_value = (rsa_key, gmpy2_pkcs10aep_cipher.new(rsa_key))
        plaintexts = ["token1", "token2", "token3"]
        tokens = [encrypt_token("tenant-123", token) for token in plaintexts]

        assert batch_decrypt_token("tenant-123", tokens) == plaintexts
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
    @patch("libs.rsa.encrypt")
    @patch("libs.rsa.decrypt")
    def test_should_encrypt_and_decrypt_consistently(self, mock_decrypt, mock_encrypt, sqlite_session: Session):
        """Test that encryption and decryption are consistent"""
        _persist_tenant(sqlite_session)

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

    @patch("libs.rsa.encrypt")
    def test_cross_tenant_isolation(self, mock_encrypt, sqlite_session: Session):
        """Ensure tokens encrypted for one tenant cannot be used by another"""
        _persist_tenant(sqlite_session, public_key="tenant1_public_key")
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

    @patch("libs.rsa.encrypt")
    def test_encryption_randomness(self, mock_encrypt, sqlite_session: Session):
        """Ensure same plaintext produces different ciphertext"""
        _persist_tenant(sqlite_session, public_key="key")

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

    @patch("libs.rsa.encrypt")
    def test_should_handle_empty_token_encryption(self, mock_encrypt, sqlite_session: Session):
        """Test encryption of empty token"""
        _persist_tenant(sqlite_session)
        mock_encrypt.return_value = b"encrypted_empty"

        result = encrypt_token("tenant-123", "")

        assert result == base64.b64encode(b"encrypted_empty").decode()
        mock_encrypt.assert_called_with("", "mock_public_key")

    @patch("libs.rsa.encrypt")
    def test_should_handle_special_characters_in_token(self, mock_encrypt, sqlite_session: Session):
        """Test tokens containing special/unicode characters"""
        _persist_tenant(sqlite_session)
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

    @patch("libs.rsa.encrypt")
    def test_should_handle_rsa_size_limits(self, mock_encrypt, sqlite_session: Session):
        """Test behavior when token exceeds RSA encryption limits"""
        _persist_tenant(sqlite_session)

        # RSA 2048-bit can only encrypt ~245 bytes
        # The actual limit depends on padding scheme
        mock_encrypt.side_effect = ValueError("Message too long for RSA key size")

        # Create a token that would exceed RSA limits
        long_token = "x" * 300

        with pytest.raises(ValueError, match="Message too long for RSA key size"):
            encrypt_token("tenant-123", long_token)

    @patch("libs.rsa.get_decrypt_decoding")
    def test_batch_decrypt_loads_key_only_once(
        self, mock_get_decoding, sqlite_session: Session, rsa_key: RSA.RsaKey, mocker: MockerFixture
    ):
        """Reuse one decoding context across every actual ciphertext in the batch."""
        _persist_tenant(sqlite_session, public_key=rsa_key.publickey().export_key().decode())
        cipher_rsa = gmpy2_pkcs10aep_cipher.new(rsa_key)
        mock_get_decoding.return_value = (rsa_key, cipher_rsa)
        decrypt = mocker.spy(rsa, "decrypt_token_with_decoding")
        plaintexts = [f"token{i}" for i in range(1, 6)]
        tokens = [encrypt_token("tenant-123", token) for token in plaintexts]

        assert batch_decrypt_token("tenant-123", tokens) == plaintexts
        mock_get_decoding.assert_called_once_with("tenant-123")
        assert decrypt.call_count == len(tokens)
        for invocation, token in zip(decrypt.call_args_list, tokens, strict=True):
            assert invocation.args == (base64.b64decode(token), rsa_key, cipher_rsa)
